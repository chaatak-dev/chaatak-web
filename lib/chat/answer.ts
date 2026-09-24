/**
 * The chat pipeline, callable from any client.
 *
 *   language → understand → place (only if needed) → fetch → render → VERIFY → ship
 *
 * One pipeline for every way a question arrives: typed on the web, spoken on
 * the web, sent from Telegram. A spoken turn is a typed turn with a
 * recogniser's language attached; there is no voice-only path, because a
 * second path would be a second place deciding what counts as a weather
 * value, which is the one decision this product cannot afford to make twice.
 *
 * THE ORDER IS THE FIX. The language is decided first, from the turn and its
 * conversation, and handed to the response layer rather than left to it. Then
 * the turn is understood — social, a question, a follow-up, a correction — and
 * only a turn that actually gives or needs a place reaches the place
 * resolver. "ohh really" is a reaction and gets a reply; it is never a
 * geocoder query again.
 *
 * Nothing here knows who is asking or where the answer is going. Identity,
 * persistence and presentation belong to the caller.
 *
 * An answer always comes back. If the model is out or the gate rejects, the
 * template goes instead — a template written for the question that was asked.
 */

import { severityWords } from '../alerts/templates';
import {
  chromeLanguage,
  conversationLanguage,
  readTurnLanguage,
  resolveTurnLanguage,
  speechLanguage,
  styleFor,
  templateLanguage,
  type TemplateLang,
  type TurnLanguage,
} from '../i18n/detect';
import { language, type InterfaceLang, type LanguageCode, type ScriptCode } from '../i18n/languages';
import type { LanguagePreference } from '../i18n/preferences';
import type { TitleInput } from '../accounts/title';
import { logQuery } from '../log';
import { GAZETTEER, HINDI_NAME } from '../parse/gazetteer';
import { devanagariName } from '../weather/gazetteer/match';
import { todayInIndia } from '../parse/time';
import type { TimeWindow } from '../parse/types';
import { writeReply } from '../render/reply';
import { languageAck, unknownPlace, weatherTemplate } from '../render/templates';
import type { SpeechLang } from '../speech/types';
import type { WeatherSnapshot } from '../weather/api';
import { resolvePoint } from '../weather/point';
import { snapshotFor, worstSeverity } from '../weather/snapshot';
import { placeResolver, weatherSource } from '../weather/source';
import type { Forecast, History, HistoryRequest, Location, NoData, Provenance } from '../weather/types';
import { classify } from './classify';
import { boundContext } from './context';
import type { Coords } from './coords';
import { warningFacts } from './facts';
import { fetchHistory, todayAt, type HistoryResult } from './history-answer';
import { ASK_FOR_LOCATION, REDIRECT } from './scope';
import { socialReply, UNCLEAR, unclearPlace } from './social';
import {
  currentFacts,
  describeAsked,
  focusDates,
  historyFacts,
  historyNature,
  outlookFacts,
  type TurnFacts,
} from './turn-facts';
import type { FactsSnapshot, Grounding, Message, StandingQuery } from './types';
import { fallbackPlan, understandLocally, type Plan, type WeatherPlan } from './understand';

export type AnswerInput = {
  question: string;
  /**
   * The client's voice or device language. A fallback only: it breaks a tie
   * the words cannot (a bare numeral, Hindi or Marathi) and is never read as
   * evidence of what was typed.
   */
  lang: SpeechLang;
  /**
   * The language a recogniser DETECTED for this turn, when it was spoken.
   * Evidence about the turn, unlike `lang`.
   */
  heard?: LanguageCode | null;
  /** The assistant preference: `auto` resolves per turn. */
  assistant: LanguagePreference;
  history: Message[];
  standing: StandingQuery | null;
  /**
   * A position, sent ONLY after the person has been asked for it. Used to
   * name a place and then discarded; a question that named a place ignores it.
   */
  coords: Coords | null;
};

export type ChatReply = {
  text: string;
  /** The language the answer is written in — decided before it was written. */
  lang: SpeechLang;
  /** Its script, where that is not the language's own: Hinglish is hi + Latn. */
  script: ScriptCode;
  /** The voice that can read it aloud: the answer's language, not the setting's. */
  speakAs: LanguageCode;
  grounding?: Grounding;
  standing: StandingQuery | null;
  /**
   * The question needs a place and none was given. The client may offer a
   * location — it does not ask for permission until this is true, and never
   * asks a second time after a refusal.
   */
  needsLocation?: true;
  /** The place was named by a coordinate, so the answer says which place. */
  usedDeviceLocation?: { name: string; district: string | null };
  /**
   * The weather this turn was answered from, so a second surface shows the
   * SAME numbers the answer used rather than fetching its own.
   */
  snapshot?: WeatherSnapshot;
  conversationId?: string;
  conversationTitle?: string | null;
  /** Diagnostics, useful in the demo and harmless to expose. */
  meta: {
    parseLayer: string;
    act: string;
    fromModel: boolean;
    gate: string;
    latencyMs: number;
    langBasis: TurnLanguage['basis'];
    langConfidence: TurnLanguage['confidence'];
  };
};

export type Answer = {
  reply: ChatReply;
  /**
   * The language templates and the warning taxonomy were written in this
   * turn. A client laying chrome around the answer uses the same one.
   */
  chrome: InterfaceLang;
  /** What a conversation title is composed from, for a caller that saves. */
  title: TitleInput;
};

/**
 * Everything the pipeline reaches outside itself for. Real by default; a test
 * replaces any of them to run a whole conversation with no network.
 */
export type AnswerDeps = {
  resolvePlace: (query: string) => Promise<Location | NoData>;
  snapshot: (place: Location) => Promise<WeatherSnapshot>;
  forecast: (place: Location, days: number) => Promise<Forecast | NoData>;
  history: (place: Location, request: HistoryRequest) => Promise<History | NoData>;
  classify: typeof classify;
  render: typeof writeReply;
  now: () => Date;
};

const REAL: AnswerDeps = {
  resolvePlace: (query) => placeResolver().resolve(query),
  snapshot: (place) => snapshotFor(place),
  forecast: (place, days) => weatherSource().getForecast(place, days),
  history: (place, request) => weatherSource().getHistory(place, request),
  classify,
  render: writeReply,
  now: () => new Date(),
};

/** The forecast the snapshot carries; a question further out fetches more. */
const SNAPSHOT_DAYS = 3;
const FORECAST_MAX_DAYS = 16;

/* ------------------------------------------------------------------ */
/* Reading what the client sent                                        */
/* ------------------------------------------------------------------ */

/**
 * The standing query, checked before it is trusted.
 *
 * It arrives from a browser or a stored Telegram session. Nothing in it is
 * used as a weather value: the place is re-resolved server-side from its
 * words, the severity can only make the gate stricter, and anything
 * malformed is dropped rather than half-used.
 */
function readStanding(raw: StandingQuery | null): StandingQuery | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<StandingQuery>;
  const window = readWindow(s.timeWindow) ?? { kind: 'now' };
  return {
    place: typeof s.place === 'string' && s.place.trim() ? s.place.trim().slice(0, 80) : null,
    resolvedPlace: s.resolvedPlace ?? null,
    intent: s.intent === 'forecast' || s.intent === 'warning' || s.intent === 'history' ? s.intent : 'current',
    timeWindow: window,
    variable:
      s.variable === 'temperature' || s.variable === 'rain' || s.variable === 'wind' || s.variable === 'humidity'
        ? s.variable
        : 'all',
    setAt: typeof s.setAt === 'string' ? s.setAt : new Date(0).toISOString(),
    lang: readTurnLanguage(s.lang),
    requestedLang: readTurnLanguage(s.requestedLang),
    pending:
      s.pending && typeof s.pending === 'object'
        ? {
            intent: s.pending.intent ?? 'current',
            timeWindow: readWindow(s.pending.timeWindow) ?? { kind: 'now' },
            variable: s.pending.variable ?? 'all',
          }
        : null,
    event: s.event && typeof s.event.start === 'string' && !Number.isNaN(Date.parse(s.event.start)) ? { start: s.event.start } : null,
    severity:
      s.severity === 'watch' || s.severity === 'alert' || s.severity === 'warning' || s.severity === 'none'
        ? s.severity
        : 'unknown',
  };
}

/**
 * The standing, for a conversation that arrived without one.
 *
 * A conversation reopened from history starts its view with no standing —
 * the transcript is stored, the view's working state is not — so "and
 * tomorrow?" as its first question would be asked "which place?" about a
 * conversation that has been about Lucknow all along. The last turn that
 * reported values says where the conversation was.
 *
 * By NAME only, re-resolved like any carried place. Nothing in a stored turn
 * is used as a value, and a severity read from one can only make the gate
 * stricter.
 */
function standingFromHistory(history: Message[]): StandingQuery | null {
  const last = [...history].reverse().find((m) => m.role === 'assistant' && m.grounding?.place?.name);
  if (!last?.grounding) return null;
  return readStanding({
    place: last.grounding.place.name,
    resolvedPlace: null,
    intent: 'current',
    timeWindow: { kind: 'now' },
    variable: 'all',
    setAt: typeof last.at === 'string' ? last.at : new Date(0).toISOString(),
    severity: last.grounding.severity,
  });
}

function readWindow(raw: unknown): TimeWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
  switch (w.kind) {
    case 'now':
      return { kind: 'now' };
    case 'day': {
      const offset = int(w.offset, -3650, 16);
      if (offset === null) return null;
      const part = w.part === 'morning' || w.part === 'afternoon' || w.part === 'evening' || w.part === 'night' ? w.part : null;
      return part ? { kind: 'day', offset, part } : { kind: 'day', offset };
    }
    case 'range': {
      const days = int(w.days, 1, 16);
      return days === null ? null : { kind: 'range', days };
    }
    case 'past': {
      const days = int(w.days, 1, 31);
      return days === null ? null : { kind: 'past', days };
    }
    case 'pastHours': {
      const hours = int(w.hours, 1, 72);
      return hours === null ? null : { kind: 'pastHours', hours };
    }
    case 'date':
      return typeof w.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.date) ? { kind: 'date', date: w.date } : null;
    case 'lastEvent':
      return typeof w.before === 'string' && !Number.isNaN(Date.parse(w.before))
        ? { kind: 'lastEvent', before: w.before }
        : { kind: 'lastEvent' };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* The pipeline                                                        */
/* ------------------------------------------------------------------ */

export async function answerQuestion(input: AnswerInput, overrides: Partial<AnswerDeps> = {}): Promise<Answer> {
  const deps: AnswerDeps = { ...REAL, ...overrides };
  const started = Date.now();
  const now = deps.now();
  const today = todayInIndia(now);
  const { question, history } = input;
  const standing = readStanding(input.standing) ?? standingFromHistory(history);
  const turn: Turn = { input, deps, started, now, question, history, standing };

  /* ---- understand the turn: what IS it? --------------------------- */

  const ctx = { standing, today };
  const local = understandLocally(question, ctx);
  if (local) return settle(await respond(local, 'pattern', turn), started);

  const lastUser = [...history].reverse().find((m) => m.role === 'user' && m.text !== question)?.text;
  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')?.text;
  const classifying = deps.classify(question, ctx, { lastUser, lastAssistant });

  /*
   * ANSWERING WHILE THE CLASSIFIER READS. Advice — "can I play cricket
   * tomorrow evening?", "kal office mein baarish hogi?" — goes to the
   * classifier because nothing local can prove it names no other place. It
   * almost always confirms what the words already say: the conversation's
   * place, the time in the sentence. So that answer is fetched and written
   * WHILE the classifier reads, and ships only if the classifier agrees. If
   * it disagrees — it found a village the words did name — the guess is
   * dropped and its plan is answered as it always was. The classifier still
   * decides; only the waiting is gone. A reading already in the cache comes
   * back at once, and then nothing is guessed at all.
   */
  const guess = likelyPlan(question, ctx);
  let early: Promise<Answer | null> | null = null;
  if (guess && !(await settlesWithin(classifying, SPECULATE_AFTER_MS))) {
    early = respond(guess, 'llm', turn).catch(() => null);
  }

  const classified = await classifying;
  const parseLayer: ParseLayer = classified?.cacheHit ? 'cache' : 'llm';
  // Every provider out: what the words plainly say, on the conversation's
  // place — or ask what was meant. Never a geocode.
  const plan = classified?.plan ?? fallbackPlan(question, ctx);

  if (early && guess && samePlan(plan, guess)) {
    const answer = await early;
    if (answer) return settle(relabel(answer, parseLayer), started);
  }
  return settle(await respond(plan, parseLayer, turn), started);
}

type ParseLayer = 'pattern' | 'cache' | 'llm';

/** Everything about the turn that answering it needs, whichever plan is answered. */
type Turn = {
  input: AnswerInput;
  deps: AnswerDeps;
  started: number;
  now: Date;
  question: string;
  history: Message[];
  standing: StandingQuery | null;
};

/** Below this, the classifier answered from its cache and there is nothing to hide. */
const SPECULATE_AFTER_MS = 60;

function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

/**
 * The plan worth answering before the classifier has read the turn: a
 * weather question the words plainly make, on the conversation's place.
 * Anything else — a named place, "here", no conversation yet — waits.
 */
function likelyPlan(question: string, ctx: { standing: StandingQuery | null; today: string }): WeatherPlan | null {
  if (!ctx.standing?.place) return null;
  const plan = fallbackPlan(question, ctx);
  return plan.act === 'weather' && plan.place.kind === 'carried' ? plan : null;
}

/**
 * The same question: the same place, window and topic. The variable may
 * narrow — an early answer written about all the weather already covers the
 * rain the classifier heard in "umbrella" — but never change.
 */
function samePlan(plan: Plan, guess: WeatherPlan): boolean {
  if (plan.act !== 'weather') return false;
  return (
    plan.place.kind === guess.place.kind &&
    plan.intent === guess.intent &&
    (plan.variable === guess.variable || guess.variable === 'all') &&
    JSON.stringify(plan.window) === JSON.stringify(guess.window)
  );
}

/** An answer written early, credited to the layer that confirmed it. */
function relabel(answer: Answer, parseLayer: ParseLayer): Answer {
  return { ...answer, reply: { ...answer.reply, meta: { ...answer.reply.meta, parseLayer } } };
}

/** The one answer this turn ships: logged once, with the time it really took. */
function settle(answer: Answer, started: number): Answer {
  const { reply } = answer;
  const latencyMs = Date.now() - started;
  logQuery({
    parseLayer: reply.meta.parseLayer as ParseLayer,
    cacheHit: reply.meta.parseLayer === 'cache',
    latencyMs,
    lang: `${reply.lang}-${reply.script}`,
    outcome: reply.needsLocation ? 'cannotParse' : 'answered',
    act: reply.meta.act as Plan['act'],
    langBasis: reply.meta.langBasis,
  });
  return { ...answer, reply: { ...reply, meta: { ...reply.meta, latencyMs } } };
}

/**
 * Answer a plan: decide the language, then — for a weather turn — find the
 * place, fetch, write and verify. Called once per turn, and a second time
 * only when an early answer was written for a plan the classifier did not
 * confirm.
 */
async function respond(plan: Plan, parseLayer: ParseLayer, turn: Turn): Promise<Answer> {
  const { input, deps, started, now, question, history, standing } = turn;

  /* ---- decide the language, before anything is written ------------ */

  const previous = standing?.lang
    ? { ...standing.lang, confidence: 'medium' as const, basis: 'context' as const }
    : conversationLanguage(history.filter((m) => m.text !== question));

  let turnLang: TurnLanguage = resolveTurnLanguage(question, {
    assistant: input.assistant,
    previous,
    heard: input.heard ?? undefined,
    fallback: input.lang,
  });

  // A language asked for in words holds for the conversation. It beats the
  // turn's own script — that is what asking for it means — and the setting,
  // because it was said just now.
  const requested = plan.act === 'language' ? plan.lang : (standing?.requestedLang ?? null);
  if (requested) turnLang = { ...requested, confidence: 'high', basis: 'explicit' };

  const tlang = templateLanguage(turnLang);
  const chrome = chromeLanguage(turnLang);
  const style = styleFor(turnLang);

  /** The conversation carried forward, with this turn's language in it. */
  const carry = (patch: Partial<StandingQuery> = {}): StandingQuery | null => {
    const base = standing ?? (patch.place !== undefined || patch.pending ? emptyStanding(now) : null);
    if (!base) {
      // No conversation yet and nothing to start one with — except a
      // language, which is worth remembering for the next short turn.
      return {
        ...emptyStanding(now),
        lang: { code: turnLang.code, script: turnLang.script },
        requestedLang: requested,
        ...patch,
      };
    }
    return {
      ...base,
      lang: { code: turnLang.code, script: turnLang.script },
      requestedLang: requested,
      ...patch,
    };
  };

  /** What a conversation title is composed from, filled in as the turn is understood. */
  const title: Omit<TitleInput, 'question' | 'lang'> = { place: null };

  const reply = (
    text: string,
    extra: Partial<ChatReply> & { fromModel?: boolean; gate?: string } = {},
  ): Answer => {
    const { fromModel = false, gate = 'skipped', ...rest } = extra;
    return {
      reply: {
        text,
        lang: turnLang.code,
        script: turnLang.script,
        speakAs: speechLanguage(turnLang),
        standing: rest.standing !== undefined ? rest.standing : carry(),
        ...rest,
        meta: {
          parseLayer,
          act: plan.act,
          fromModel,
          gate,
          latencyMs: Date.now() - started,
          langBasis: turnLang.basis,
          langConfidence: turnLang.confidence,
        },
      },
      chrome,
      title: {
        question,
        ...title,
        lang: chrome,
      },
    };
  };

  /* ---- turns that need no weather --------------------------------- */

  switch (plan.act) {
    case 'language':
      return reply(languageAck(tlang, language(plan.lang.code).native));

    case 'outOfScope':
      return reply(REDIRECT[tlang]);

    case 'unclear':
      return reply(plan.maybePlace ? unclearPlace(tlang, plan.maybePlace) : UNCLEAR[tlang]);

    case 'social':
    case 'about': {
      const kind = plan.act === 'social' ? plan.kind : 'capabilities';
      const template = socialReply(kind, tlang, history.length, standing?.place ? placeLabel(standing, turnLang.script) : null);
      // Hindi, English and Hinglish have hand-written replies. The other
      // five, and every "about" question, are written by the model — with no
      // data and the gate watching for a stray number.
      const templated = plan.act === 'social' && (turnLang.code === 'en' || turnLang.code === 'hi' || turnLang.code === 'mr');
      if (templated) return reply(template);

      const rendered = await deps.render({
        question,
        lang: input.lang,
        answer: style,
        context: boundContext(history, standing, null),
        facts: null,
        places: standing ? knownPlaces(standing) : [],
        // Only ever stricter: a warning standing in the conversation still
        // forbids "don't worry" on a turn that fetched nothing.
        severity: standing?.severity ?? 'unknown',
        gazetteer: GAZETTEER,
        turn: [
          plan.act === 'about'
            ? 'The person is asking about a weather term or about Chaatak. Explain plainly.'
            : 'This is small talk, not a weather question. Reply in one short, warm line.',
        ],
        fallback: template,
      });
      return reply(rendered.text, { fromModel: rendered.fromModel, gate: rendered.gate });
    }
  }

  /* ---- a weather turn --------------------------------------------- */

  const weatherPlan: WeatherPlan = plan;
  title.intent = weatherPlan.intent;
  title.timeWindow = weatherPlan.window;
  title.variable = weatherPlan.variable;

  /** What is waiting on a place, if the place does not come. */
  const pending = {
    intent: weatherPlan.intent,
    timeWindow: stripCursor(weatherPlan.window),
    variable: weatherPlan.variable,
  };

  /* ---- the place, only because this turn needs one --------------- */

  let place: Location | null = null;
  let spoken: string | null = null;
  let fromDevice: { name: string; district: string | null } | undefined;

  const ref = weatherPlan.place;
  if (ref.kind === 'named') {
    spoken = ref.text;
  } else if (ref.kind === 'carried' && standing?.place) {
    spoken = standing.place;
  } else if (input.coords) {
    // "here", or no place at all, and the person has agreed to share one.
    const here = resolvePoint(input.coords.latitude, input.coords.longitude);
    if ('kind' in here) return reply(here.statement[chrome], { standing: carry({ pending }) });
    place = here;
    fromDevice = { name: here.name, district: here.admin2 ?? null };
  } else {
    // The one place a location is asked for: a question that needs one and
    // has none. The question is kept, so the place that comes next answers
    // it rather than starting over.
    return reply(ASK_FOR_LOCATION[tlang], { needsLocation: true, standing: carry({ pending }) });
  }

  if (!place && spoken) {
    const resolved = await deps.resolvePlace(spoken);
    if ('kind' in resolved) {
      // An honest statement, and the question still waiting for a place.
      title.place = spoken;
      return reply(unknownPlace(spoken, tlang, resolved.statement), { standing: carry({ pending }) });
    }
    place = resolved;
  }
  if (!place) return reply(ASK_FOR_LOCATION[tlang], { needsLocation: true, standing: carry({ pending }) });

  /*
   * The place as this answer names it, in the answer's script — never
   * switch script on the user, a label included. See `displayName`.
   */
  const label = displayName(place, turnLang.script, spoken);
  title.place = label;

  /* ---- fetch exactly what the question needs ---------------------- */

  const placeToday = todayAt(place, now);
  const snapshot = await deps.snapshot(place);
  const severity = worstSeverity(snapshot.warnings);
  const warnings = warningFacts(snapshot.warnings, chrome);

  let outlook: Forecast | NoData = snapshot.outlook;
  const reach = forecastReach(weatherPlan.window, placeToday);
  if ((weatherPlan.intent === 'forecast' || weatherPlan.intent === 'current') && reach > SNAPSHOT_DAYS) {
    outlook = await deps.forecast(place, Math.min(FORECAST_MAX_DAYS, reach));
  }

  let historyResult: HistoryResult | null = null;
  if (weatherPlan.intent === 'history') {
    historyResult = await fetchHistory(deps.history, place, weatherPlan.window, placeToday);
  }

  /* ---- the facts: what the model sees is what the gate verifies ---- */

  const facts: TurnFacts = {
    asked: { topic: weatherPlan.intent, variable: weatherPlan.variable, when: describeAsked(weatherPlan.window, placeToday) },
    place: { name: place.name, district: place.admin2 ?? null, state: place.admin1 ?? null },
    source: null,
    warnings,
  };

  let provenance: Provenance | null = null;

  if (historyResult) {
    facts.history = historyFacts(historyResult, { timeZone: place.timezone, today: placeToday, now, lang: chrome });
    const nature = historyNature(historyResult);
    if (nature) facts.historyNature = nature;
    if (historyResult.kind !== 'unavailable') provenance = historyResult.history.provenance;
  } else {
    facts.current = currentFacts(snapshot.current, chrome);
    facts.outlook = outlookFacts(outlook, placeToday, chrome);
    facts.focusDays = focusDates(outlook, weatherPlan.window, placeToday);
    if (outlook.kind === 'forecast' && facts.focusDays.length === 0 && weatherPlan.intent === 'forecast') {
      facts.horizonDays = outlook.days.length;
    }
    provenance = pickProvenance(weatherPlan, snapshot, outlook);
  }

  if (provenance) {
    facts.source = {
      name: provenance.source,
      nature: provenance.nature ?? null,
      issuedAt: provenance.issuedAt,
      basis: provenance.timeBasis,
    };
  }

  /* ---- render, then verify ----------------------------------------- */

  // Severity from the catalogue, verbatim, in the answer's taxonomy — and the
  // reply must OPEN with it. Hinglish reads the English taxonomy: its words
  // are human-translated into two languages, never re-worded into a third.
  const severityStrings =
    severity === 'watch' || severity === 'alert' || severity === 'warning'
      ? [severityWords(severity, chrome)]
      : [];

  const places = [
    place.name,
    place.admin1,
    place.admin2,
    label,
    spoken,
    weatherPlan.rejected,
    ...(standing ? knownPlaces(standing) : []),
  ].filter((p): p is string => Boolean(p));

  const nextStanding = carry({
    place: spoken ?? place.name,
    resolvedPlace: place,
    intent: weatherPlan.intent,
    timeWindow: stripCursorIfPlaceChanged(weatherPlan, standing),
    variable: weatherPlan.variable,
    setAt: now.toISOString(),
    pending: null,
    event:
      historyResult?.kind === 'lastRain' && historyResult.event
        ? { start: historyResult.event.start }
        : weatherPlan.intent === 'history' && weatherPlan.window.kind === 'lastEvent'
          ? null
          : samePlace(standing, spoken ?? place.name)
            ? (standing?.event ?? null)
            : null,
    severity,
  });

  const fallback = weatherTemplate({ plan: weatherPlan, facts, lang: tlang, place: label, severity });

  const rendered = await deps.render({
    question,
    lang: input.lang,
    answer: style,
    context: boundContext(history, nextStanding, facts as FactsSnapshot),
    facts: facts as FactsSnapshot,
    places,
    severity,
    severityStrings,
    gazetteer: GAZETTEER,
    turn: turnNotes(weatherPlan, label, fromDevice),
    fallback,
  });

  const grounding: Grounding | undefined = provenance
    ? { place, provenance, severity, facts: facts as FactsSnapshot }
    : undefined;

  return reply(rendered.text, {
    grounding,
    standing: nextStanding,
    snapshot,
    usedDeviceLocation: fromDevice,
    fromModel: rendered.fromModel,
    gate: rendered.gate,
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function emptyStanding(now: Date): StandingQuery {
  return {
    place: null,
    resolvedPlace: null,
    intent: 'current',
    timeWindow: { kind: 'now' },
    variable: 'all',
    setAt: now.toISOString(),
  };
}

/** Every name the conversation has legitimately used for its place. */
function knownPlaces(standing: StandingQuery): string[] {
  return [standing.place, standing.resolvedPlace?.name, standing.resolvedPlace?.admin1, standing.resolvedPlace?.admin2]
    .filter((p): p is string => Boolean(p));
}

/** The conversation's place, named the way an answer in this script names it. */
function placeLabel(standing: StandingQuery, script: ScriptCode): string {
  if (standing.resolvedPlace?.name) return displayName(standing.resolvedPlace, script, standing.place);
  return standing.place ?? '';
}

/**
 * What an answer calls its place.
 *
 * Latin answers use the canonical name — "Ghaziabad", not the "ghaziabad"
 * someone typed in a hurry. Devanagari answers use the person's own
 * Devanagari words when they wrote them; otherwise the hand-written Hindi
 * name, then the gazetteer's current Devanagari name, and only then the Latin
 * one. No name is ever produced by transliteration.
 */
function displayName(place: Location, script: ScriptCode, spoken: string | null): string {
  if (script !== 'Deva') return place.name;
  if (spoken && /[ऀ-ॿ]/.test(spoken)) return spoken;
  return HINDI_NAME.get(place.name.toLowerCase()) ?? devanagariName(place.name) ?? place.name;
}

function samePlace(standing: StandingQuery | null, place: string): boolean {
  return Boolean(standing?.place) && standing!.place!.toLowerCase() === place.toLowerCase();
}

/** A waiting question does not carry an event cursor: that belongs to a place. */
function stripCursor(window: TimeWindow): TimeWindow {
  return window.kind === 'lastEvent' ? { kind: 'lastEvent' } : window;
}

function stripCursorIfPlaceChanged(plan: WeatherPlan, standing: StandingQuery | null): TimeWindow {
  if (plan.window.kind !== 'lastEvent') return plan.window;
  const changed = plan.place.kind === 'named' && !samePlace(standing, plan.place.text);
  return changed ? { kind: 'lastEvent' } : plan.window;
}

/** How many days of forecast a window needs, counting today. */
function forecastReach(window: TimeWindow, today: string): number {
  switch (window.kind) {
    case 'day':
      return window.offset + 1;
    case 'range':
      return window.days;
    case 'date': {
      const days = Math.round((Date.parse(`${window.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
      return days + 1;
    }
    default:
      return 1;
  }
}

/**
 * The provenance line for a turn: what it actually reported.
 *
 * A warning question cites IMD's bulletin, not the model that supplied the
 * temperature beside it; a forecast question cites the forecast.
 */
function pickProvenance(plan: WeatherPlan, snapshot: WeatherSnapshot, outlook: Forecast | NoData): Provenance | null {
  if (plan.intent === 'warning') {
    const w = snapshot.warnings;
    if (Array.isArray(w) && w[0]) return w[0].provenance;
    if (!Array.isArray(w) && w.kind === 'noWarning') {
      return {
        source: w.source,
        endpoint: w.endpoint,
        issuedAt: w.issuedAt ?? w.checkedAt,
        timeBasis: w.issuedAt ? w.timeBasis : 'valid',
        nature: 'bulletin',
      };
    }
  }
  if (plan.intent === 'forecast' && outlook.kind === 'forecast') return outlook.provenance;
  if (snapshot.current.kind === 'reading') return snapshot.current.provenance;
  if (outlook.kind === 'forecast') return outlook.provenance;
  return null;
}

/** What the model is told about this turn, in a line each. */
function turnNotes(
  plan: WeatherPlan,
  place: string,
  fromDevice: { name: string; district: string | null } | undefined,
): string[] {
  const notes: string[] = [];
  if (plan.turn === 'followup') notes.push('A follow-up: it continues the previous question.');
  if (plan.turn === 'correction') {
    notes.push(
      plan.rejected
        ? `The person corrected the place: ${place}, not ${plan.rejected}. Acknowledge it in a few words.`
        : `The person corrected the place to ${place}. Acknowledge it in a few words.`,
    );
  }
  if (plan.turn === 'place') notes.push(`The person gave the place ${place} for the question being discussed.`);
  if (fromDevice) notes.push(`The place was taken from the device's location: say it is for ${place}.`);
  if (plan.window.kind === 'day' && plan.window.part) {
    notes.push(
      `They asked about the ${plan.window.part} of that day. The forecast is for the whole day, not by the hour: reason from the day's figures, say they are for the day, and never state a value as the ${plan.window.part}'s own.`,
    );
  }
  if (plan.window.kind === 'lastEvent' && plan.window.before) {
    notes.push('They asked about the rain BEFORE the one already mentioned; DATA.history holds that earlier one.');
  }
  return notes;
}

export type { TemplateLang };
