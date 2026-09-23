/**
 * What a turn IS, decided before anything decides where it is about.
 *
 * THE ARCHITECTURAL FIX. The pipeline used to be "parse a weather query; if
 * the parse has no keywords, the whole message must be a place". So "ohh
 * really" was geocoded, "wassup" was geocoded, and the reply to both was
 * "No place matched". This file inverts that order:
 *
 *   1. what kind of turn is this — social talk, a language request, a
 *      question, a follow-up, a correction, a bare place, something else
 *   2. only then, if it is about the weather, does it name a place, carry
 *      the conversation's place, mean "here" — or need one
 *
 * and the place resolver runs only when step 2 says a place was actually
 * given or is actually needed. There is no path from "not understood" to the
 * geocoder: a turn this file cannot read goes to the classifier, and a turn
 * the classifier cannot read (or cannot be asked about) gets a sentence
 * asking what was meant.
 *
 * WHAT COUNTS AS A PLACE, exhaustively:
 *   - a word a locative particle marks: "Lucknow mein", "weather in Lucknow"
 *   - a name the gazetteer recognises, in a message made of nothing else
 *   - a name offered as a correction or a change: "actually X", "what about X"
 *   - the answer to "which place?", when that is what was just asked
 *   - a name the classifier extracted, verbatim, from the message
 *
 * Deterministic, synchronous and free. The model is the exception path, used
 * only for what none of this can read.
 */

import type { LanguageCode, ScriptCode } from '../i18n/languages';
import { isLexiconWord, type TurnLanguage } from '../i18n/detect';
import { barePlace, readShape } from '../parse/patterns';
import { addDays, isPastWindow, readTime } from '../parse/time';
import type { Intent, TimeWindow, Variable } from '../parse/types';
import { normaliseSocial, readSocial, type SocialKind } from './social';
import type { StandingQuery } from './types';

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */

export type PlaceRef =
  /** Named in THIS turn, verbatim. */
  | { kind: 'named'; text: string }
  /** The conversation's place, carried from an earlier turn. */
  | { kind: 'carried' }
  /** Wherever the person is. */
  | { kind: 'here' }
  /** None given and none to carry: the answer has to ask. */
  | { kind: 'none' };

export type WeatherPlan = {
  act: 'weather';
  /**
   * How the turn relates to the conversation, which is what the reply is
   * phrased around: a fresh question, a follow-up that inherits, a bare place
   * answering or changing the question, or a correction of the last place.
   */
  turn: 'query' | 'followup' | 'place' | 'correction' | 'clarify';
  place: PlaceRef;
  intent: Intent;
  window: TimeWindow;
  variable: Variable;
  /** For a correction: the place the person said they did not mean. */
  rejected?: string;
};

export type Plan =
  | WeatherPlan
  | { act: 'social'; kind: SocialKind }
  /** "Hindi mein batao": answer in this language from now on. */
  | { act: 'language'; lang: Pick<TurnLanguage, 'code' | 'script'> }
  /** In scope, needs conversation rather than values: "what does orange alert mean". */
  | { act: 'about' }
  | { act: 'outOfScope' }
  /**
   * Could not be read, and no model was available to read it. Carries the
   * text when it might have been a place, so the reply can say how to ask.
   */
  | { act: 'unclear'; maybePlace?: string };

export type TurnContext = {
  standing: StandingQuery | null;
  /** YYYY-MM-DD in IST, the calendar the question is asked on. */
  today: string;
};

/* ------------------------------------------------------------------ */
/* Intent from time                                                    */
/* ------------------------------------------------------------------ */

/**
 * What a window asks for. Past windows are history, future ones forecast,
 * and a warning question stays one whatever its window.
 */
export function intentFor(
  window: TimeWindow,
  opts: { warning?: boolean; past?: boolean; today: string },
): Intent {
  if (opts.warning) return 'warning';
  if (window.kind === 'day' && window.offset === 0) return opts.past ? 'history' : 'current';
  if (window.kind === 'now') return 'current';
  if (isPastWindow(window, opts.today)) return 'history';
  return 'forecast';
}

/* ------------------------------------------------------------------ */
/* Language requests                                                   */
/* ------------------------------------------------------------------ */

const LANGUAGE_WORDS: [string[], LanguageCode, ScriptCode][] = [
  [['hindi', 'हिंदी', 'हिन्दी'], 'hi', 'Deva'],
  [['english', 'angrezi', 'angreji', 'अंग्रेज़ी', 'अंग्रेजी', 'इंग्लिश'], 'en', 'Latn'],
  [['hinglish'], 'hi', 'Latn'],
  [['marathi', 'मराठी'], 'mr', 'Deva'],
  [['bengali', 'bangla', 'বাংলা'], 'bn', 'Beng'],
  [['gujarati', 'ગુજરાતી'], 'gu', 'Gujr'],
  [['tamil', 'தமிழ்'], 'ta', 'Taml'],
  [['punjabi', 'ਪੰਜਾਬੀ'], 'pa', 'Guru'],
];

/** The words that turn a language's name into a request for it. */
const LANGUAGE_REQUEST_WORDS = new Set(
  [
    'in', 'please', 'pls', 'plz', 'speak', 'talk', 'reply', 'answer', 'write', 'say',
    'mein', 'me', 'main', 'bolo', 'boliye', 'batao', 'bataiye', 'likho', 'baat', 'karo',
    'jawab', 'do', 'dijiye', 'can', 'you', 'could', 'switch', 'to', 'use', 'only',
    'में', 'बोलो', 'बोलिए', 'बताओ', 'बताइए', 'लिखो', 'बात', 'करो', 'जवाब', 'दो', 'दीजिए',
  ].map(normaliseSocial),
);

/** "Hindi mein batao", "reply in English", "हिंदी में बोलो" — or null. */
export function readLanguageRequest(text: string): Pick<TurnLanguage, 'code' | 'script'> | null {
  const tokens = normaliseSocial(text).split(' ').filter(Boolean);
  if (tokens.length === 0 || tokens.length > 6) return null;

  let found: Pick<TurnLanguage, 'code' | 'script'> | null = null;
  for (const token of tokens) {
    const named = LANGUAGE_WORDS.find(([names]) => names.map(normaliseSocial).includes(token));
    if (named) {
      if (found) return null; // two languages named: not a request we can read
      found = { code: named[1], script: named[2] };
      continue;
    }
    if (!LANGUAGE_REQUEST_WORDS.has(token)) return null;
  }
  // A bare language name is a request too ("Hindi?"), and so is "in Hindi".
  return found;
}

/* ------------------------------------------------------------------ */
/* Pieces of a turn                                                    */
/* ------------------------------------------------------------------ */

/** Words that name no place and must never be read as one. */
const DEICTIC = new Set(
  [
    'that', 'this', 'it', 'those', 'these', 'there', 'here', 'then', 'now', 'them',
    'woh', 'wo', 'vo', 'voh', 'ye', 'yeh', 'yah', 'is', 'us', 'uska', 'iska',
    'वो', 'वह', 'ये', 'यह', 'उसका', 'इसका', 'उस', 'इस',
  ].map(normaliseSocial),
);

/**
 * Could this be a name someone is offering as a place? Letters in one run of
 * one to four words, none of them a function word, a pronoun or a social
 * phrase. Used only where the grammar already says a place is being offered.
 */
export function nameLike(text: string): boolean {
  const cleaned = text.trim().replace(/[।?!.,…]+$/u, '').trim();
  if (!cleaned || /\d/.test(cleaned)) return false;
  const tokens = cleaned.split(/\s+/);
  if (tokens.length > 4) return false;
  if (!tokens.every((t) => /^[\p{L}\p{M}'’.-]+$/u.test(t))) return false;
  if (tokens.some((t) => DEICTIC.has(normaliseSocial(t)) || isLexiconWord(t))) return false;
  const social = readSocial(cleaned);
  return social.kind === null;
}

/** Strip trailing punctuation, keeping the words verbatim. */
function bare(text: string): string {
  return text.trim().replace(/[।?!.,…]+$/u, '').trim();
}

/** "and", "what about", "aur", "और" — a turn built on the last one. */
const FOLLOW_LEAD =
  /^(?:and\s+what\s+about|and\s+how\s+about|what\s+about|how\s+about|what\s+abt|and|then|also|aur\s+kya|aur\s+phir|aur|और\s+फिर|और|तो)(?![\p{L}\p{M}])[\s,]*/iu;

/** "Mumbai ka kya?", "कल का क्या?" — the Hindi shape of the same thing. */
const FOLLOW_TAIL =
  /[\s,]*(?:ka\s+kya|ki\s+kya|ke\s+kya|ka\s+haal|ke\s+baare\s+mein|ke\s+bare\s+me|का\s+क्या|की\s+क्या|के\s+क्या|का\s+हाल|के\s+बारे\s+में)\s*[?।!.]*$/iu;

/**
 * A correction with both places in it.
 *
 * The negator decides which one is meant, because the two languages put it
 * on opposite sides: English says "Lucknow, not Kanpur" (the first is meant),
 * Hindi says "Lucknow nahi, Kanpur" (the second is).
 */
function readTwoPlaceCorrection(body: string): { meant: string; rejected: string } | null {
  const text = bare(body);

  const english = /^(.+?)[,\s]+not\s+(.+)$/iu.exec(text);
  if (english && nameLike(english[1]) && nameLike(english[2])) {
    return { meant: english[1].trim(), rejected: english[2].trim() };
  }

  const notFirst = /^not\s+(.+?)[,\s]+(?:but\s+)?(.+)$/iu.exec(text);
  if (notFirst && nameLike(notFirst[1]) && nameLike(notFirst[2])) {
    return { meant: notFirst[2].trim(), rejected: notFirst[1].trim() };
  }

  const hindi = /^(.+?)\s+(?:nahi|nahin|नहीं|ना)(?![\p{L}\p{M}])[,\s]+(?:balki\s+|बल्कि\s+)?(.+)$/iu.exec(text);
  if (hindi && nameLike(hindi[1]) && nameLike(hindi[2])) {
    return { meant: hindi[2].trim(), rejected: hindi[1].trim() };
  }

  return null;
}

type Fragment = {
  place?: string;
  window?: TimeWindow;
  variable?: Variable;
  warning?: boolean;
  beforeThat?: boolean;
  past?: boolean;
  here?: boolean;
};

/**
 * What a short fragment adds — "tomorrow", "wind", "Mumbai", "before that" —
 * or null when it adds nothing this file can name.
 *
 * `offered` is true when the grammar around the fragment already says it is
 * being offered as a new value ("what about X", "actually X"), which is what
 * lets a name the gazetteer does not hold still count as a place.
 */
function readFragment(fragment: string, today: string, offered: boolean): Fragment | null {
  const text = bare(fragment).replace(/^(?:the|a)\s+/iu, '');
  if (!text) return null;

  const time = readTime(text, today);
  const shape = readShape(text);
  const out: Fragment = {};

  if (time.beforeThat) out.beforeThat = true;
  if (time.window) out.window = time.window;
  // "kab hui thi?" names no window; it asks when the last one was.
  else if (time.lastEvent && !time.beforeThat) out.window = { kind: 'lastEvent' };
  if (time.past) out.past = true;
  if (shape.variable) out.variable = shape.variable;
  if (shape.isWarning) out.warning = true;
  if (shape.wantsHere) out.here = true;

  // Past tense and no window: "did it rain?" asks when it last did; "was it
  // hot?" asks about yesterday. The same default the whole question uses.
  if (out.past && !out.window && !out.beforeThat) {
    out.window = out.variable === 'rain' ? { kind: 'lastEvent' } : { kind: 'day', offset: -1 };
  }

  if (shape.place.kind === 'found') {
    out.place = shape.place.place;
  } else if (offered && !out.window && !out.variable && !out.warning && !out.beforeThat && !out.here) {
    // Nothing else in it: an offered name is the place, confirmed or not.
    const known = barePlace(text);
    if (known) out.place = known.place;
    else if (nameLike(text)) out.place = text;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/* ------------------------------------------------------------------ */
/* Building a plan from the conversation                               */
/* ------------------------------------------------------------------ */

const DEFAULT = { intent: 'current' as Intent, window: { kind: 'now' } as TimeWindow, variable: 'all' as Variable };

/**
 * The question the conversation is on, if any: the standing query, or the
 * one still waiting for a place.
 */
function base(standing: StandingQuery | null) {
  if (standing?.pending) {
    return {
      intent: standing.pending.intent,
      window: standing.pending.timeWindow,
      variable: standing.pending.variable,
      hasPlace: false,
    };
  }
  if (standing) {
    return {
      intent: standing.intent,
      window: standing.timeWindow,
      variable: standing.variable,
      hasPlace: Boolean(standing.place),
    };
  }
  return { ...DEFAULT, hasPlace: false };
}

/** "and before that?" — one step further back from where the conversation is. */
function earlier(window: TimeWindow, standing: StandingQuery | null, today: string): TimeWindow | null {
  switch (window.kind) {
    case 'lastEvent':
      // The event already reported is the bound for the next search.
      return { kind: 'lastEvent', before: standing?.event?.start ?? window.before };
    case 'day':
      return { kind: 'day', offset: window.offset - 1 };
    case 'date':
      return { kind: 'date', date: addDays(window.date, -1) };
    case 'now':
      // Before "now" is the recent past: the last rain is the useful answer.
      return { kind: 'day', offset: -1 };
    default:
      void today;
      return null;
  }
}

/**
 * A fragment laid over the conversation's question.
 *
 * Whatever the fragment names replaces the conversation's value; whatever it
 * does not name is inherited. A new place keeps the topic ("Mumbai?" after
 * "will it rain tomorrow in Delhi?" is the same question about Mumbai), and
 * a new variable drops a warning topic back to the weather.
 */
function merge(fragment: Fragment, ctx: TurnContext, turn: WeatherPlan['turn']): WeatherPlan | null {
  const from = base(ctx.standing);

  let window = fragment.window ?? from.window;
  if (fragment.beforeThat) {
    const back = earlier(from.window, ctx.standing, ctx.today);
    if (!back) return null;
    window = back;
  }

  // The event cursor belongs to the place it was found at.
  if (fragment.place && window.kind === 'lastEvent') window = { kind: 'lastEvent' };

  const variable = fragment.variable ?? from.variable;
  const warning = fragment.warning ?? (from.intent === 'warning' && !fragment.variable);
  const past = fragment.past ?? (fragment.window ? false : from.intent === 'history');

  const place: PlaceRef = fragment.place
    ? { kind: 'named', text: fragment.place }
    : fragment.here
      ? { kind: 'here' }
      : from.hasPlace
        ? { kind: 'carried' }
        : { kind: 'none' };

  return {
    act: 'weather',
    turn,
    place,
    intent: intentFor(window, { warning, past, today: ctx.today }),
    window,
    variable,
  };
}

/* ------------------------------------------------------------------ */
/* The reading                                                         */
/* ------------------------------------------------------------------ */

/**
 * Everything this file can read without a model, or null to hand the turn to
 * the classifier. Never a geocode.
 */
export function understandLocally(text: string, ctx: TurnContext): Plan | null {
  const trimmed = text.trim();
  if (!trimmed) return { act: 'unclear' };

  // 0. "Hindi mein batao": the conversation changes language.
  const request = readLanguageRequest(trimmed);
  if (request) return { act: 'language', lang: request };

  // 1. Social talk, whole — "thanks", "ohh really", "wassup".
  const social = readSocial(trimmed);
  if (social.kind) return { act: 'social', kind: social.kind };

  const body = social.rest || trimmed;
  const correcting = social.correcting;
  const standing = ctx.standing;

  // 2. A correction naming both places: "I meant Lucknow, not Kanpur".
  const both = readTwoPlaceCorrection(body);
  if (both) {
    const plan = merge({ place: both.meant }, ctx, 'correction');
    return plan ? { ...plan, rejected: both.rejected } : null;
  }

  // 3. A fragment built on the last turn: "and tomorrow?", "what about
  //    wind?", "Mumbai ka kya?", "actually Mumbai", "tomorrow?".
  const lead = FOLLOW_LEAD.exec(body);
  const tail = FOLLOW_TAIL.exec(body);
  const inner = bare(
    body.slice(lead ? lead[0].length : 0, tail ? body.length - tail[0].length : body.length),
  );
  const offered = Boolean(lead || tail || correcting);
  const short = inner.split(/\s+/).filter(Boolean).length <= 3;

  if (offered || (standing && short)) {
    let fragment = inner ? readFragment(inner, ctx.today, offered) : null;
    // A place AND something to ask about it, with nothing marking it as a
    // follow-up, is a whole new question ("Delhi ka mausam"), not a fragment
    // of the last one — it must not inherit the last one's day.
    if (fragment && !offered && fragment.place && (fragment.variable || fragment.window)) {
      fragment = null;
    }
    if (fragment) {
      const turn: WeatherPlan['turn'] = correcting ? 'correction' : fragment.place && !lead && !tail ? 'place' : 'followup';
      const plan = merge(fragment, ctx, turn);
      if (plan) return plan;
    }
    // "and?" or "what about that?" — nothing this file can name.
    if (offered && !inner) return null;
  }

  // 4. A whole question.
  const shape = readShape(body);
  const time = readTime(body, ctx.today);
  const hasTime = time.window !== null || time.lastEvent;

  if (shape.weatherWord || hasTime || (shape.wantsHere && shape.place.kind !== 'found')) {
    // Something in the sentence might be a place and cannot be confirmed:
    // the classifier can tell a village from a verb; this file cannot.
    if (shape.place.kind === 'unsure' && !shape.wantsHere) return null;

    // A time word with nothing else in it and no conversation to attach it
    // to ("kal?") still asks about the weather; it will ask where.
    let window: TimeWindow = time.window ?? { kind: 'now' };
    const rainy = shape.variable === 'rain' || shape.variable === null;
    if (time.lastEvent && rainy && (!time.window || time.window.kind === 'lastEvent')) {
      window = { kind: 'lastEvent' };
    } else if (!time.window && time.past) {
      // "did it rain?" asks when it last did; "was it hot?" asks about yesterday.
      window = shape.variable === 'rain' ? { kind: 'lastEvent' } : { kind: 'day', offset: -1 };
    }

    const place: PlaceRef =
      shape.place.kind === 'found'
        ? { kind: 'named', text: shape.place.place }
        : shape.wantsHere
          ? { kind: 'here' }
          : standing?.place
            ? { kind: 'carried' }
            : { kind: 'none' };

    return {
      act: 'weather',
      turn: correcting && place.kind === 'named' ? 'correction' : 'query',
      place,
      intent: intentFor(window, { warning: shape.isWarning, past: time.past, today: ctx.today }),
      window,
      variable: shape.variable ?? 'all',
    };
  }

  // 5. A place and nothing else: "Lucknow", "लखनऊ?", "lucknow please".
  const known = barePlace(body);
  if (known) {
    const plan = merge({ place: known.place }, ctx, correcting ? 'correction' : 'place');
    if (plan) return plan;
  }

  // 6. A name offered where a place was asked for, or as a correction.
  if ((standing?.pending || correcting) && nameLike(body)) {
    return merge({ place: bare(body) }, ctx, correcting ? 'correction' : 'place');
  }

  // Nothing here to read. The classifier may; this file will not guess.
  return null;
}

/**
 * What to do when nothing could read the turn and no model can be asked.
 *
 * Never a geocode. If the message might have been a place, the reply says
 * how to ask about it; otherwise it asks what was meant.
 */
export function fallbackPlan(text: string): Plan {
  return nameLike(text) ? { act: 'unclear', maybePlace: bare(text) } : { act: 'unclear' };
}

/** True when a plan needs the conversation to have a place. */
export function needsPlace(plan: Plan): plan is WeatherPlan {
  return plan.act === 'weather';
}
