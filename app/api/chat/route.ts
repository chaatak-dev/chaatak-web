/**
 * POST /api/chat
 *
 *   parse → fetch → render → VERIFY → ship
 *
 * Runs server-side so no provider key or upstream endpoint reaches the
 * browser. An answer always ships: if the model is out or the gate rejects,
 * the template goes instead and the user never learns a provider failed.
 */

import { isConfigurationError, mayRevealConfiguration } from '@/lib/errors';
import { answerStyle, isLanguageCode, replyLanguage } from '@/lib/i18n/languages';
import { currentUser } from '@/lib/auth/server';
import { persistTurn } from '@/lib/accounts/persist';
import { conversationTitle } from '@/lib/accounts/title';
import type { ConversationId } from '@/lib/accounts/types';
import { resolvePoint } from '@/lib/weather/point';
import { readCoords } from '@/lib/chat/coords';
import { readPreference } from '@/lib/i18n/preferences';
import { wantsCurrentLocation } from '@/lib/parse/location-intent';
import { ASK_FOR_LOCATION } from '@/lib/chat/scope';
import { classify } from '@/lib/chat/classify';
import { boundContext } from '@/lib/chat/context';
import { warningFacts } from '@/lib/chat/facts';
import { REDIRECT } from '@/lib/chat/scope';
import type { FactsSnapshot, Grounding, Message, StandingQuery } from '@/lib/chat/types';
import { logQuery } from '@/lib/log';
import { GAZETTEER } from '@/lib/parse/gazetteer';
import { patternParser } from '@/lib/parse/patterns';
import { writeReply } from '@/lib/render/reply';
import type { InterfaceLang } from '@/lib/i18n/languages';
import type { SpeechLang } from '@/lib/speech/types';
import { OUTLOOK_DAYS, type WeatherSnapshot } from '@/lib/weather/api';
import { placeResolver, weatherSource } from '@/lib/weather/source';
import { conditionFor } from '@/lib/weather/wmo';
import { scriptOf } from '@/lib/weather/gazetteer/normalise';
import type { DistrictId, Severity } from '@/lib/weather/types';

type ChatRequest = {
  question?: string;
  lang?: string;
  history?: Message[];
  standing?: StandingQuery | null;
  /**
   * Which conversation to write this turn into. Null starts one. Ignored
   * entirely for a guest — there is nothing to write into.
   */
  conversationId?: string | null;
  /** The client's id for this exchange, so a resend is not a second copy. */
  clientId?: string;
  /**
   * The browser's current position, sent ONLY when the person has just been
   * asked for it. Used to name a place and then discarded: nothing stores a
   * coordinate, and a question that named a place ignores this field.
   */
  coords?: { latitude?: unknown; longitude?: unknown } | null;
  /**
   * The language to answer in, when the person has named one.
   *
   * `auto` — the default — means mirror whatever they wrote, which is what
   * this route has always done. An explicit value is a setting they went and
   * changed, so it is honoured rather than second-guessed by the script of
   * the question.
   */
  assistantLang?: string;
};

export type ChatReply = {
  text: string;
  lang: SpeechLang;
  grounding?: Grounding;
  standing: StandingQuery | null;
  /**
   * The question needs a place and none was given. The client may offer the
   * browser's location — it does not ask for permission until this is true,
   * and never asks a second time after a refusal.
   */
  needsLocation?: true;
  /** The place was named by a coordinate, so the answer says which place. */
  usedDeviceLocation?: { name: string; district: string | null };
  /**
   * The weather this turn was answered from.
   *
   * Carried so the rail shows the SAME numbers the answer used rather than
   * fetching its own — two independent fetches land in different cache
   * windows and disagree by a degree at exactly the moment somebody notices.
   * Not persisted with the message; the conversation stores the answer and
   * its provenance, not a snapshot that will be wrong tomorrow.
   */
  snapshot?: WeatherSnapshot;
  /** Where this turn was saved. Absent for a guest. */
  conversationId?: string;
  /** The conversation's title, when this turn is the one that set it. */
  conversationTitle?: string | null;
  /** Diagnostics, useful in the demo and harmless to expose. */
  meta: { parseLayer: string; fromModel: boolean; gate: string; latencyMs: number };
};

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: 'malformed body' }, { status: 400 });
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) return Response.json({ error: 'no question' }, { status: 400 });

  /*
   * Who is asking, if anyone.
   *
   * From the session cookie, never from the body — a request cannot name the
   * account it wants its history written into. A guest is the ordinary case
   * and costs nothing: `currentUser()` returns null and the turn is simply
   * not saved.
   */
  const askedAt = new Date().toISOString();
  const user = await currentUser().catch(() => null);
  const conversationId =
    typeof body.conversationId === 'string' && body.conversationId
      ? (body.conversationId as ConversationId)
      : null;
  const clientId =
    typeof body.clientId === 'string' && body.clientId
      ? body.clientId.slice(0, 80)
      : `turn:${askedAt}`;

  try {
  // Any of the seven. An unrecognised code falls back rather than throwing:
  // a bad language header should not cost someone their forecast.
  const lang: SpeechLang = isLanguageCode(body.lang) ? body.lang : 'hi';
  /**
   * The language this turn is answered in, taken from the script the user
   * wrote in rather than from the toggle. The toggle chooses a VOICE; it must
   * not decide the script of written text, or someone typing Hinglish with it
   * set to Hindi gets Devanagari back.
   *
   * The same value drives the warning taxonomy, so a reply can never come out
   * half English template and half Hindi condition word.
   */
  const assistant = readPreference(body.assistantLang);
  const chrome = replyLanguage(question, lang, assistant);
  /** Which language and script the model is told to write in, and is held to. */
  const answer = answerStyle(question, lang, assistant);
  const history = Array.isArray(body.history) ? body.history : [];
  const standing = body.standing ?? null;

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
     * recognised a weather question — a time word, a variable word or a
     * warning word — and found no place in the sentence, with none carried
     * over from the conversation. That is precisely what this route needs to
     * know, and it used to throw it away and spend an LLM call rediscovering
     * it, on the most common phrasings in the product.
     *
     * The model is the exception path, not the default. A question with no
     * place in it is not an exception; it is Tuesday.
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
     * The same rule, applied to whatever the model returned.
     *
     * A classifier asked for a place will happily answer "near me", and one
     * vocabulary check here is better than teaching it a second one. If the
     * question says "here" and no real place came back, it is a
     * current-location question whichever layer read it.
     */
    if (needsWeather && inScope && wantsCurrentLocation(question)) {
      const namedSomewhere = Boolean(place) && !wantsCurrentLocation(place);
      if (!namedSomewhere) {
        wantsHere = true;
        place = '';
      }
    }
  }

  /* ---- shipping an answer, and keeping it if there is an account --- */

  /**
   * The place a title is made of. The resolved, canonical name once there is
   * one; what the person typed until then.
   */
  let titlePlace: string | null = place || null;

  /**
   * Every exit from here goes through this.
   *
   * It exists so that history is written on ALL of them — the out-of-scope
   * line, the unresolvable place, and the ordinary answer alike. A
   * conversation that silently drops the turns it found awkward is worse than
   * one that keeps everything, because the gap is invisible.
   *
   * A guest skips it entirely. So does a failed write: `persistTurn` catches
   * its own errors and returns null, and the answer ships either way.
   */
  const ship = async (reply: ChatReply): Promise<Response> => {
    /*
     * A turn that only asks "which place?" is not saved.
     *
     * It is a request for input, not an answer, and the same question is
     * about to be asked again with a coordinate attached. Saving it would put
     * the question in the transcript twice with a prompt between the two
     * copies — which is what the person sees on screen for a moment and
     * exactly what they should not find there a week later.
     */
    if (user && !reply.needsLocation) {
      const saved = await persistTurn({
        userId: user.id,
        conversationId,
        clientId,
        question,
        questionLang: lang,
        askedAt,
        answer: reply.text,
        answerLang: reply.lang,
        grounding: reply.grounding,
        // Composed from the parse, not from a second model call: the place,
        // the variable and the day are already known by the time we are here.
        title: conversationTitle({
          question,
          place: titlePlace,
          intent,
          timeWindow,
          variable,
          lang: chrome,
        }),
      });

      if (saved) {
        reply.conversationId = saved.conversationId;
        reply.conversationTitle = saved.title;
      }
    }

    return Response.json(reply, { headers: { 'cache-control': 'no-store' } });
  };

  /* ---- out of scope: one friendly line, no lecture ---------------- */

  if (!inScope) {
    logQuery({
      parseLayer: 'llm',
      cacheHit: false,
      latencyMs: Date.now() - started,
      lang,
      outcome: 'cannotParse',
    });
    const reply: ChatReply = {
      text: REDIRECT[chrome],
      lang,
      standing,
      meta: {
        parseLayer,
        fromModel: false,
        gate: 'skipped',
        latencyMs: Date.now() - started,
      },
    };
    return ship(reply);
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
   * The question needs somewhere to be about, so this is where the browser's
   * location earns its keep — and the ONLY place it is ever asked for. The
   * permission prompt is not on page load, not on a question that named a
   * place, and not on a question that needs no place at all. It happens here,
   * because here is where the answer actually depends on it.
   *
   * A coordinate arrives only after the person has been asked once and said
   * yes. Until then the reply is a question, carrying `needsLocation` so the
   * interface can offer the prompt beside it.
   */
  const point = readCoords(body.coords);
  const wantsPlace = needsWeather && !place && (wantsHere || !standing?.place);
  let fromDevice: { name: string; district: string | null } | undefined;

  if (wantsPlace && point) {
    const here = resolvePoint(point.latitude, point.longitude);

    if ('kind' in here) {
      return ship({
        text: here.statement[chrome],
        lang,
        standing,
        meta: {
          parseLayer,
          fromModel: false,
          gate: 'skipped',
          latencyMs: Date.now() - started,
        },
      });
    }

    // The canonical name takes over from here. Everything downstream — the
    // fetch, the standing query, the title, the follow-up — sees a place name
    // exactly as if it had been typed, and the coordinate is not referred to
    // again.
    place = here.name;
    titlePlace = here.name;

    /*
     * Parse it again, now that there is somewhere for it to be about.
     *
     * "weather tomorrow" told the pattern layer everything except where, so
     * it answered noPlace and kept none of it. Handing the resolved name back
     * as the remembered place lets the same parser produce the full query —
     * the day, the variable, the intent — without a model and without this
     * route reimplementing what it already does.
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
    return ship({
      text: ASK_FOR_LOCATION[chrome],
      lang,
      standing,
      needsLocation: true,
      meta: {
        parseLayer,
        fromModel: false,
        gate: 'skipped',
        latencyMs: Date.now() - started,
      },
    });
  }

  if (needsWeather && place) {
    const resolved = await placeResolver().resolve(place);

    if ('kind' in resolved) {
      // Unresolvable place: an honest statement, no model call at all.
      const reply: ChatReply = {
        text: resolved.statement[chrome],
        lang,
        standing,
        meta: {
          parseLayer,
          fromModel: false,
          gate: 'skipped',
          latencyMs: Date.now() - started,
        },
      };
      logQuery({
        parseLayer: parseLayer as 'pattern' | 'llm',
        cacheHit: false,
        latencyMs: Date.now() - started,
        lang,
        outcome: 'noData',
      });
      return ship(reply);
    }

    /*
     * The place a title carries, in the script the question was written in.
     *
     * The gazetteer's canonical name is tidier — correct capitalisation, one
     * spelling — but it is Latin, and using it for a Devanagari question
     * produced "Barabanki बारिश कल": half the label in a script the person
     * did not write in. Never switching script on the user applies to the
     * sidebar as much as to an answer, so when the two disagree the user's
     * own words win.
     */
    titlePlace =
      place && scriptOf(place) !== scriptOf(resolved.name) ? place : resolved.name;

    const source = weatherSource();
    const district = (resolved.admin2 ?? resolved.name) as DistrictId;
    const [current, outlook, warnings] = await Promise.all([
      source.getCurrent(resolved),
      source.getForecast(resolved, OUTLOOK_DAYS),
      source.getWarnings(district),
    ]);

    if (Array.isArray(warnings) && warnings.length > 0) {
      severity = warnings.reduce<Severity>(
        (worst, w) =>
          ['none', 'watch', 'alert', 'warning'].indexOf(w.severity) >
          ['none', 'watch', 'alert', 'warning'].indexOf(worst)
            ? w.severity
            : worst,
        'none',
      );
    } else if (!Array.isArray(warnings) && warnings.kind === 'noWarning') {
      severity = 'none';
    }

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
    // a perfectly true statement is rejected as an invented number — which is
    // what happened the first time this ran.
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
      // Warnings belong in the fact set, not just in `severity`. Severity
      // reached the advice check but never the model, so asked "is there a
      // warning?" it answered truthfully about a DATA block that contained
      // none -- and said no while five were in force.
      warnings: warningFacts(warnings, chrome),
    };

    // The one canonical view of this location, handed to the rail as-is.
    snapshot = {
      place: resolved,
      current,
      outlook,
      warnings,
      fetchedAt: new Date().toISOString(),
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

  const payload: ChatReply = {
    text: reply.text,
    lang,
    grounding,
    standing: nextStanding,
    snapshot,
    usedDeviceLocation: fromDevice,
    meta: {
      parseLayer,
      fromModel: reply.fromModel,
      gate: reply.gate,
      latencyMs: Date.now() - started,
    },
  };

  return ship(payload);
  } catch (error) {
    /*
     * A misconfigured deployment is reported AS a misconfiguration.
     *
     * This route used to let a thrown guard escape as an opaque 500, which the
     * client rendered as "Could not reach the server. Check your connection" —
     * sending an operator to look at their wifi while the actual fault was an
     * environment variable. The message below names the variable, never a
     * value, so it is safe to show and is the one thing that points at the
     * cause.
     */
    const configuration = isConfigurationError(error);
    const message = error instanceof Error ? error.message : String(error);

    // Logged at full detail whatever the environment, so a production fault is
    // still findable in the platform logs even when the response withholds it.
    console.error(
      JSON.stringify({
        event: configuration ? 'chat.misconfigured' : 'chat.failed',
        error: message,
      }),
    );

    return Response.json(
      {
        error: {
          kind: configuration ? 'configuration' : 'internal',
          // Withheld in production: a visitor can act on "not your
          // connection", not on the name of an environment variable. An
          // internal error never surfaces detail at all — it can carry
          // anything.
          detail:
            configuration && mayRevealConfiguration() ? message : undefined,
        },
      },
      // 503, not 500: the service is unavailable until someone changes a
      // setting, which is a different thing from a request going wrong.
      { status: configuration ? 503 : 500, headers: { 'cache-control': 'no-store' } },
    );
  }
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
