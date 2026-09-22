/**
 * The chat pipeline, callable from any client.
 *
 *   parse → fetch → render → VERIFY → ship
 *
 * This lived inside POST /api/chat, which was fine while the browser was the
 * only thing that asked questions. The Telegram bot asks the same questions
 * and must get the same answers — the same parser, the same place pipeline,
 * the same snapshot, the same gate — so the pipeline moved here and every
 * client calls it. A second copy for Telegram would have been a second place
 * deciding what counts as a weather value, which is the one decision this
 * product cannot afford to make twice.
 *
 * Nothing here knows who is asking or where the answer is going. Identity,
 * persistence and presentation belong to the caller: the web route saves the
 * turn into a signed-in person's history, and the bot formats it for a chat.
 *
 * An answer always comes back. If the model is out or the gate rejects, the
 * template goes instead and the user never learns a provider failed.
 */

import { answerStyle, replyLanguage, type InterfaceLang } from '../i18n/languages';
import type { LanguagePreference } from '../i18n/preferences';
import type { TitleInput } from '../accounts/title';
import { resolvePoint } from '../weather/point';
import type { Coords } from './coords';
import { wantsCurrentLocation } from '../parse/location-intent';
import { ASK_FOR_LOCATION, REDIRECT } from './scope';
import { classify } from './classify';
import { boundContext } from './context';
import { warningFacts } from './facts';
import type { FactsSnapshot, Grounding, Message, StandingQuery } from './types';
import { logQuery } from '../log';
import { GAZETTEER } from '../parse/gazetteer';
import { patternParser } from '../parse/patterns';
import { writeReply } from '../render/reply';
import type { SpeechLang } from '../speech/types';
import type { WeatherSnapshot } from '../weather/api';
import { placeResolver } from '../weather/source';
import { snapshotFor, worstSeverity } from '../weather/snapshot';
import { conditionFor } from '../weather/wmo';
import { scriptOf } from '../weather/gazetteer/normalise';
import type { Severity } from '../weather/types';

export type AnswerInput = {
  question: string;
  /**
   * The spoken or device language. Breaks the tie only when the question has
   * no letters to judge — a bare numeral, an emoji.
   */
  lang: SpeechLang;
  /**
   * The language to answer in, when the person has named one. `auto` means
   * mirror whatever they wrote.
   */
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
  lang: SpeechLang;
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
   * The weather this turn was answered from.
   *
   * Carried so a second surface shows the SAME numbers the answer used rather
   * than fetching its own — two independent fetches land in different cache
   * windows and disagree by a degree at exactly the moment somebody notices.
   */
  snapshot?: WeatherSnapshot;
  /** Where this turn was saved. Absent for a guest. */
  conversationId?: string;
  /** The conversation's title, when this turn is the one that set it. */
  conversationTitle?: string | null;
  /** Diagnostics, useful in the demo and harmless to expose. */
  meta: { parseLayer: string; fromModel: boolean; gate: string; latencyMs: number };
};

export type Answer = {
  reply: ChatReply;
  /**
   * The language templates and the warning taxonomy were written in this
   * turn. A client laying chrome around the answer uses the same one, so a
   * reply is never half one language and half another.
   */
  chrome: InterfaceLang;
  /** What a conversation title is composed from, for a caller that saves. */
  title: TitleInput;
};

export async function answerQuestion(input: AnswerInput): Promise<Answer> {
  const started = Date.now();
  const { question, lang, history } = input;
  const standing = input.standing ?? null;

  /**
   * The language this turn is answered in, taken from the script the user
   * wrote in rather than from the voice toggle. The toggle chooses a VOICE; it
   * must not decide the script of written text.
   *
   * The same value drives the warning taxonomy, so a reply can never come out
   * half English template and half Hindi condition word.
   */
  const chrome = replyLanguage(question, lang, input.assistant);
  /** Which language and script the model is told to write in, and is held to. */
  const answer = answerStyle(question, lang, input.assistant);

  /* ---- parse: patterns first, model only on a miss ---------------- */

  let parseLayer = 'pattern';
  let inScope = true;
  let needsWeather = true;
  let place = '';
  let intent = standing?.intent ?? 'current';
  let timeWindow = standing?.timeWindow ?? ({ kind: 'now' } as const);
  let variable = standing?.variable ?? ('all' as const);

  const byPattern = await patternParser.parse(question, {
    lang,
    lastPlace: standing?.place ?? undefined,
  });

  /**
   * True when the question asked about where the person IS.
   *
   * It overrides the standing place, which is the whole point of telling it
   * apart from "no place mentioned": someone who asked about Delhi and then
   * asks what it is like near them is asking about near them.
   */
  let wantsHere = false;

  if (byPattern?.kind === 'currentLocation') {
    // "weather near me". The place is named — it is here — so there is
    // nothing to ask about and nothing to inherit.
    wantsHere = true;
    needsWeather = true;
    intent = byPattern.intent;
    timeWindow = byPattern.timeWindow;
    variable = byPattern.variable;
  } else if (byPattern?.kind === 'query') {
    place = byPattern.placeWasImplied ? (standing?.place ?? '') : byPattern.place;
    intent = byPattern.intent;
    timeWindow = byPattern.timeWindow;
    variable = byPattern.variable;
  } else if (byPattern?.kind === 'cannotParse' && byPattern.reason === 'noPlace') {
    /*
     * "temperature". "will it rain?". "aaj ka mausam".
     *
     * The pattern layer returns noPlace for exactly one situation: it
     * recognised a weather question and found no place in the sentence, with
     * none carried over from the conversation. That is precisely what this
     * pipeline needs to know, and spending an LLM call rediscovering it on the
     * most common phrasings in the product would be waste.
     *
     * The model is the exception path, not the default.
     */
    needsWeather = true;
  } else {
    parseLayer = 'llm';
    const classified = await classify(question, standing);
    if (classified) {
      inScope = classified.inScope;
      needsWeather = classified.needsWeather;
      place = classified.place || (standing?.place ?? '');
      intent = classified.intent;
      timeWindow = classified.timeWindow;
      variable = classified.variable;
    } else {
      // Providers all out. Treat it as conversational and let the template
      // answer rather than refusing.
      needsWeather = false;
    }

    /*
     * The same rule, applied to whatever the model returned. If the question
     * says "here" and no real place came back, it is a current-location
     * question whichever layer read it.
     */
    if (needsWeather && inScope && wantsCurrentLocation(question)) {
      const namedSomewhere = Boolean(place) && !wantsCurrentLocation(place);
      if (!namedSomewhere) {
        wantsHere = true;
        place = '';
      }
    }
  }

  /**
   * The place a title is made of. The resolved, canonical name once there is
   * one; what the person typed until then.
   */
  let titlePlace: string | null = place || null;

  /** Every exit goes through this, so the title is composed the same way. */
  const done = (reply: ChatReply): Answer => ({
    reply,
    chrome,
    title: {
      question,
      place: titlePlace,
      intent,
      timeWindow,
      variable,
      lang: chrome,
    },
  });

  const meta = (fromModel = false, gate = 'skipped') => ({
    parseLayer,
    fromModel,
    gate,
    latencyMs: Date.now() - started,
  });

  /* ---- out of scope: one friendly line, no lecture ---------------- */

  if (!inScope) {
    logQuery({
      parseLayer: 'llm',
      cacheHit: false,
      latencyMs: Date.now() - started,
      lang,
      outcome: 'cannotParse',
    });
    return done({ text: REDIRECT[chrome], lang, standing, meta: meta() });
  }

  /* ---- fetch, when the answer needs values ------------------------ */

  let facts: FactsSnapshot | null = null;
  let snapshot: WeatherSnapshot | undefined;
  let grounding: Grounding | undefined;
  let severity: Severity | 'unknown' = 'unknown';
  let nextStanding = standing;
  const places: string[] = [];

  /*
   * "temperature", with no place in the sentence and none carried over.
   *
   * The question needs somewhere to be about, so this is where a location
   * earns its keep — and the ONLY place it is ever asked for. A coordinate
   * arrives only after the person has been asked once and said yes. Until
   * then the reply is a question, carrying `needsLocation` so the client can
   * offer a location beside it.
   */
  const point = input.coords;
  const wantsPlace = needsWeather && !place && (wantsHere || !standing?.place);
  let fromDevice: { name: string; district: string | null } | undefined;

  if (wantsPlace && point) {
    const here = resolvePoint(point.latitude, point.longitude);

    if ('kind' in here) {
      return done({ text: here.statement[chrome], lang, standing, meta: meta() });
    }

    // The canonical name takes over from here. Everything downstream sees a
    // place name exactly as if it had been typed, and the coordinate is not
    // referred to again.
    place = here.name;
    titlePlace = here.name;

    /*
     * Parse it again, now that there is somewhere for it to be about.
     *
     * "weather tomorrow" told the pattern layer everything except where.
     * Handing the resolved name back as the remembered place lets the same
     * parser produce the full query without a model.
     */
    const withPlace = await patternParser.parse(question, {
      lang,
      lastPlace: here.name,
    });

    if (withPlace?.kind === 'query') {
      intent = withPlace.intent;
      timeWindow = withPlace.timeWindow;
      variable = withPlace.variable;
    }
    // Said out loud in the reply, because an answer about somewhere the
    // person did not name has to state which somewhere.
    fromDevice = { name: here.name, district: here.admin2 ?? null };
  } else if (wantsPlace) {
    return done({
      text: ASK_FOR_LOCATION[chrome],
      lang,
      standing,
      needsLocation: true,
      meta: meta(),
    });
  }

  if (needsWeather && place) {
    const resolved = await placeResolver().resolve(place);

    if ('kind' in resolved) {
      // Unresolvable place: an honest statement, no model call at all.
      logQuery({
        parseLayer: parseLayer as 'pattern' | 'llm',
        cacheHit: false,
        latencyMs: Date.now() - started,
        lang,
        outcome: 'noData',
      });
      return done({ text: resolved.statement[chrome], lang, standing, meta: meta() });
    }

    /*
     * The place a title carries, in the script the question was written in.
     * Never switching script on the user applies to a label as much as to an
     * answer, so when the two disagree the user's own words win.
     */
    titlePlace =
      place && scriptOf(place) !== scriptOf(resolved.name) ? place : resolved.name;

    // The one canonical view of this location. Every client shows these
    // numbers and no others.
    snapshot = await snapshotFor(resolved);
    const { current, outlook, warnings } = snapshot;

    severity = worstSeverity(warnings);

    const provenance =
      current.kind === 'reading'
        ? current.provenance
        : outlook.kind === 'forecast'
          ? outlook.provenance
          : null;

    // Exactly what the model is shown is exactly what the gate verifies.
    //
    // Provenance is IN here, not just on the UI line. The model naturally
    // wants to say "as of 16:15", and without the issue time in the fact set
    // a perfectly true statement is rejected as an invented number.
    facts = {
      place: {
        name: resolved.name,
        district: resolved.admin2 ?? null,
        state: resolved.admin1 ?? null,
      },
      source: provenance
        ? {
            name: provenance.source,
            issuedAt: provenance.issuedAt,
            basis: provenance.timeBasis,
          }
        : null,
      current:
        current.kind === 'reading'
          ? {
              condition: conditionFor(current.conditionCode)?.[chrome] ?? null,
              measurements: current.measurements,
            }
          : { unavailable: current.statement[chrome] },
      outlook:
        outlook.kind === 'forecast'
          ? { days: outlook.days, units: outlook.units }
          : { unavailable: outlook.statement[chrome] },
      // Warnings belong in the fact set, not just in `severity`: asked "is
      // there a warning?" a model that cannot see them says no while five
      // are in force.
      warnings: warningFacts(warnings, chrome),
    };

    places.push(resolved.name);
    if (resolved.admin1) places.push(resolved.admin1);
    if (resolved.admin2) places.push(resolved.admin2);

    if (provenance) {
      grounding = { place: resolved, provenance, severity, facts };
    }

    nextStanding = {
      place,
      resolvedPlace: resolved,
      intent,
      timeWindow,
      variable,
      setAt: new Date().toISOString(),
    };
  } else if (standing?.place && !wantsHere) {
    // Ungrounded turn still carries the standing place, so the gate can tell
    // a legitimate reference from an invented one.
    places.push(standing.place);
    if (standing.resolvedPlace?.name) places.push(standing.resolvedPlace.name);
    if (standing.resolvedPlace?.admin1) places.push(standing.resolvedPlace.admin1);
  }

  /* ---- render, then verify ---------------------------------------- */

  const context = boundContext(history, nextStanding, facts);

  const fallback = facts
    ? buildTemplate(facts, chrome)
    : chrome === 'hi'
      ? 'मैं मौसम के बारे में बता सकता हूँ। किस जगह का पूछना है?'
      : 'I can help with the weather. Which place would you like?';

  const reply = await writeReply({
    question,
    lang,
    context,
    facts,
    places,
    severity,
    gazetteer: GAZETTEER,
    answer,
    fallback,
  });

  logQuery({
    parseLayer: parseLayer as 'pattern' | 'llm',
    cacheHit: false,
    provider: reply.provider,
    gate: reply.gate === 'skipped' ? undefined : (reply.gate as 'passed' | 'rejected'),
    gateReason: reply.gateReason,
    fellBackToTemplate: !reply.fromModel,
    latencyMs: Date.now() - started,
    lang,
    outcome: 'answered',
  });

  return done({
    text: reply.text,
    lang,
    grounding,
    standing: nextStanding,
    snapshot,
    usedDeviceLocation: fromDevice,
    meta: meta(reply.fromModel, reply.gate),
  });
}

/** The floor the system lands on when the model is out or the gate rejects. */
function buildTemplate(facts: FactsSnapshot, lang: InterfaceLang): string {
  const current = facts.current as
    | { condition: string | null; measurements: { key: string; value: number; unit: string }[] }
    | { unavailable: string };

  if ('unavailable' in current) return current.unavailable;

  const temperature = current.measurements.find((m) => m.key === 'temperature');
  const condition = current.condition;

  if (!temperature) {
    return condition ?? (lang === 'hi' ? 'जानकारी उपलब्ध नहीं है।' : 'No data available.');
  }

  return lang === 'hi'
    ? `${condition ? condition + '। ' : ''}अभी तापमान ${temperature.value} ${temperature.unit} है।`
    : `${condition ? condition + '. ' : ''}It is ${temperature.value} ${temperature.unit} right now.`;
}
