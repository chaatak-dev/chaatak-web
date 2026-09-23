/**
 * The pattern layer: regex and keyword tables, no model call.
 *
 * This is load-bearing architecture, not an optimisation. We are on free
 * tiers with no billing, so the common questions — a bare place name,
 * "<place> mein mausam", "kal barish", "aaj ka mausam" — must never reach a
 * provider. The LLM is the exception path.
 *
 * How a place is extracted: every recognised keyword and particle is blanked
 * out of the ORIGINAL string, and the longest surviving run is the place. It
 * is therefore always a verbatim substring of what the user said — never
 * reassembled, never case-folded, never transliterated. गाज़ियाबाद stays
 * गाज़ियाबाद, which is the only form the geocoder that reads Devanagari can
 * use.
 */

import { GAZETTEER } from './gazetteer';
import { findPlace, type PlaceEvidence } from './place-extract';
import { LOCATION_FILLER, wantsCurrentLocation } from './location-intent';
import { isLexiconWord } from '../i18n/detect';
import { matchPlace } from '../weather/gazetteer/match';
import type {
  CannotParse,
  CurrentLocationQuery,
  Intent,
  ParseContext,
  ParseResult,
  Parser,
  TimeWindow,
  Variable,
} from './types';

/* ------------------------------------------------------------------ */
/* Keyword tables                                                      */
/* ------------------------------------------------------------------ */

type TimeKeyword = { words: string[]; window: TimeWindow };

/**
 * कल means both "tomorrow" and "yesterday" in Hindi, disambiguated by verb
 * tense. It is read as tomorrow here: forecast is what is being asked for
 * essentially always, and we hold no historical data to serve the other
 * reading with. The same applies to परसों. This is a documented convention,
 * and a past-tense question lands on an honest noData rather than a wrong
 * number.
 */
const TIME_KEYWORDS: TimeKeyword[] = [
  { words: ['अभी', 'इस वक्त', 'इस समय', 'abhi', 'right now', 'now'], window: { kind: 'now' } },
  { words: ['आज', 'aaj', 'today'], window: { kind: 'day', offset: 0 } },
  { words: ['कल', 'kal', 'tomorrow'], window: { kind: 'day', offset: 1 } },
  { words: ['परसों', 'परसो', 'parson', 'parso'], window: { kind: 'day', offset: 2 } },
  {
    words: ['इस हफ़्ते', 'इस हफ्ते', 'is hafte', 'this week', 'hafte'],
    window: { kind: 'range', days: 7 },
  },
];

/*
 * Spellings as people type them, not as a dictionary has them: romanised
 * Hindi has no standard spelling, and "baarish" missing from this list left
 * the word standing as a possible PLACE NAME in "last baarish kab hui?".
 * Common misspellings of the English words are here for the same reason.
 */
const VARIABLE_KEYWORDS: { words: string[]; variable: Variable }[] = [
  {
    words: [
      'बारिश', 'बरसात', 'वर्षा', 'बूंदाबांदी', 'बूँदाबाँदी', 'barish', 'baarish',
      'baarishein', 'barsaat', 'barsat', 'varsha', 'boondabaandi', 'rain', 'raining',
      'rainfall', 'rained', 'rains', 'rainy', 'drizzle', 'shower', 'showers',
      'precipitation',
    ],
    variable: 'rain',
  },
  {
    words: [
      'तापमान', 'गर्मी', 'ठंड', 'ठंडी', 'सर्दी', 'taapman', 'tapman', 'tapmaan',
      'taapmaan', 'garmi', 'thand', 'thandi', 'sardi', 'temperature', 'temp',
      'tempreture', 'temprature', 'temperture', 'hot', 'cold', 'heat',
    ],
    variable: 'temperature',
  },
  {
    words: ['हवा', 'हवाएँ', 'आंधी', 'आँधी', 'hawa', 'hawaa', 'aandhi', 'andhi', 'wind', 'windy', 'winds', 'breeze'],
    variable: 'wind',
  },
  { words: ['आर्द्रता', 'नमी', 'उमस', 'humidity', 'humid', 'nami', 'umas'], variable: 'humidity' },
  { words: ['मौसम', 'मोसम', 'mausam', 'mosam', 'mousam', 'mausum', 'weather', 'wether'], variable: 'all' },
];

const WARNING_KEYWORDS = [
  // Plurals are listed, not derived. Matching is whole-word — the boundary
  // that stops "alert" matching inside "alerted" also stops it matching
  // inside "alerts" — so "any warnings near me" was not recognised as a
  // warning question at all and fell through to the model.
  'चेतावनी', 'चेतावनियाँ', 'चेतावनियां', 'अलर्ट', 'खतरा',
  'chetavni', 'chetawani', 'alert', 'alerts', 'warning', 'warnings', 'danger',
  // Named hazards. A question about a cyclone is a warning question, not a
  // wind forecast, and routing it to the wrong intent in a warning system is
  // the kind of miss this product exists to avoid.
  'चक्रवात', 'तूफ़ान', 'तूफान', 'बाढ़', 'लू', 'chakravat', 'cyclone', 'cyclones',
  'storm', 'storms', 'flood', 'floods', 'heatwave', 'heatwaves', 'heat wave',
];

/**
 * Particles, verbs and question words that carry no query meaning. Removing
 * them is what leaves the place standing alone.
 */
const STOPWORDS = [
  // Hindi postpositions and copulas
  'में', 'मे', 'का', 'की', 'के', 'को', 'पर', 'से', 'है', 'हैं', 'होगी', 'होगा',
  'रहेगा', 'रहेगी', 'कैसा', 'कैसी', 'कैसे', 'क्या', 'कितना', 'कितनी', 'बताओ',
  'बताइए', 'ज़रा', 'जरा', 'और', 'लिए', 'वाला', 'वाली', 'हाल',
  // Hinglish / Latin
  'mein', 'me', 'mai', 'ka', 'ki', 'ke', 'ko', 'par', 'se', 'hai', 'hain',
  'hoga', 'hogi', 'rahega', 'rahegi', 'kaisa', 'kaisi', 'kaise', 'kya',
  'kitna', 'kitni', 'batao', 'bataiye', 'zara', 'aur', 'liye', 'wala', 'wali',
  'in', 'at', 'of', 'the', 'is', 'it', 'for', 'what', 'whats', 'hows', 'how',
  'will', 'be', 'like', 'there', 'tell', 'please', 'a', 'an', 'any', 'some',
  'koi', 'कोई', 'मेरे', 'mere', 'vahan', 'वहाँ', 'वहां',
  /*
   * The words the PAST is asked in. Without them "baarish kab hui thi?" left
   * kab, hui and thi standing as possible place names, and a question with no
   * place in it deferred to the model instead of asking "which place?".
   */
  'kab', 'when', 'hui', 'hua', 'huyi', 'huye', 'thi', 'tha', 'did', 'was', 'were',
  'rained', 'rainfall', 'much', 'many', 'yesterday', 'ago', 'last', 'past',
  'previous', 'week', 'weeks', 'month', 'day', 'days', 'hour', 'hours', 'time',
  'pichhle', 'pichle', 'pichhli', 'pichli', 'din', 'ghante', 'hafte', 'mahine',
  'baar', 'aakhri', 'akhri', 'gaya', 'gayi', 'padi', 'pada', 'barsi', 'barsa',
  'कब', 'हुई', 'हुआ', 'हुए', 'थी', 'था', 'थे', 'पिछले', 'पिछली', 'दिन', 'घंटे',
  'हफ़्ते', 'हफ्ते', 'बार', 'आखिरी', 'आख़िरी', 'गया', 'गई', 'पड़ी', 'बरसी',
  // And the future's, which the time reader now handles.
  'next', 'forecast', 'tonight', 'later', 'agle', 'agla', 'अगले',
];

/* ------------------------------------------------------------------ */
/* Matching helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * \b does not work for Devanagari, so boundaries are expressed as "not
 * preceded or followed by a letter or a combining mark". The \p{M} half
 * matters: without it, a keyword would match inside a word whose next
 * character is a vowel sign.
 */
function boundedPattern(word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `(?<![\\p{L}\\p{M}])${escaped}(?![\\p{L}\\p{M}])`;
}

function matches(text: string, word: string): boolean {
  return new RegExp(boundedPattern(word), 'iu').test(text);
}

/** Blanks every listed word out of the original string, preserving offsets. */
function blank(text: string, words: string[]): string {
  let out = text;
  // Longest first, so "इस हफ़्ते" is removed before "इस" could be.
  for (const word of [...words].sort((a, b) => b.length - a.length)) {
    out = out.replace(
      new RegExp(boundedPattern(word), 'giu'),
      (m) => ' '.repeat(m.length),
    );
  }
  return out;
}

/**
 * An English contraction's tail is never a place.
 *
 * Blanking keywords out of "what's the weather" leaves `'s` standing, and a
 * surviving run is exactly what the place extractor reads as "something here
 * might be a place name" — so it deferred to the model, conservatively and
 * wrongly, on one of the most common questions in the product. "whats the
 * weather" parsed fine; the apostrophe was the whole difference.
 *
 * Blanked as a unit, preserving offsets like every other mask, so the place
 * that survives is still a verbatim slice of what the person typed.
 *
 * Only the suffixes that are actually contractions, and only when nothing
 * follows them — so O'Sullivan and d'Souza keep their letters.
 */
const CONTRACTION_TAIL = /['’](?:s|re|m|ve|ll|t|d)(?![\p{L}\p{M}])/giu;

function blankContractions(text: string): string {
  return text.replace(CONTRACTION_TAIL, (m) => ' '.repeat(m.length));
}

const ALL_KEYWORDS = [
  ...TIME_KEYWORDS.flatMap((k) => k.words),
  ...VARIABLE_KEYWORDS.flatMap((k) => k.words),
  ...WARNING_KEYWORDS,
  ...STOPWORDS,
  /*
   * The words a "where I am" question is made of.
   *
   * Masked so none of them can survive as the longest remaining run and be
   * read as a name. "near me" put "near" immediately before the Hinglish
   * locative "me", so the extractor claimed it, geocoded it, and answered
   * about a place called Near.
   */
  ...LOCATION_FILLER,
];

/**
 * The place as a verbatim slice of the original text, or null when there is
 * no positive evidence of one. See place-extract.ts for why evidence rather
 * than elimination.
 */
export function extractPlace(text: string): string | null {
  const masked = blankContractions(blank(text, ALL_KEYWORDS));
  const evidence = findPlace(text, masked, masked !== text, GAZETTEER);
  if (evidence.kind !== 'found') return null;
  if (evidence.via === 'whole') return barePlace(text)?.place ?? null;
  return evidence.place;
}

/* ------------------------------------------------------------------ */
/* A message that is nothing but a place                               */
/* ------------------------------------------------------------------ */

/** Politeness and particles around a bare name: "Lucknow please", "Lucknow ka?". */
const AROUND_A_NAME = [
  'please', 'pls', 'plz', 'bhai', 'bhaiya', 'yaar', 'ji', 'sir', 'madam', 'ka',
  'ki', 'ke', 'mein', 'me', 'ko', 'का', 'की', 'के', 'में', 'को', 'जी',
];

export type BarePlace = { place: string; how: 'exact' | 'fuzzy' };

/**
 * The place, when the whole message is one: "Lucknow", "लखनऊ?", "lucknow
 * please". Otherwise null.
 *
 * THIS IS WHERE "ohh really" USED TO BECOME A PLACE. The old rule was "no
 * keyword in it, so the message IS the place" — which made every reaction,
 * greeting and typo a geocoder query. A whole message is now a place only
 * when the gazetteer — every district IMD warns on and every town of 50,000 —
 * recognises it, and only when none of its words is ordinary speech: the
 * gazetteer's fuzzy matcher reads "kitni" as Katni and "than" is an exact
 * alias of Thane, so a message made of talk is never matched however close
 * it comes.
 *
 * A village too small for the gazetteer is still reachable: in a sentence
 * ("Rampur Khas mein mausam"), as the answer to "which place?", after
 * "actually", or through the classifier — every one of them evidence that a
 * place is what the person meant. Only the guess is gone.
 */
export function barePlace(text: string): BarePlace | null {
  let candidate = text.trim().replace(/[।?!.,…]+$/u, '').trim();
  // Particles and politeness either side of the name, verbatim positions kept.
  for (let pass = 0; pass < 2; pass++) {
    for (const word of AROUND_A_NAME) {
      const edge = new RegExp(
        `^(?:${word})(?![\\p{L}\\p{M}])\\s*|\\s*(?<![\\p{L}\\p{M}])(?:${word})$`,
        'giu',
      );
      candidate = candidate.replace(edge, '').trim();
    }
    candidate = candidate.replace(/^[,\s]+|[,\s।?!.]+$/gu, '').trim();
  }

  if (!candidate) return null;
  const tokens = candidate.split(/\s+/);
  if (tokens.length > 4) return null;
  if (/\d/.test(candidate)) return null;
  if (tokens.some((token) => isLexiconWord(token.replace(/[^\p{L}\p{M}'’]/gu, '')))) return null;

  const match = matchPlace(candidate);
  if (!match) return null;
  return { place: candidate, how: match.how };
}

/* ------------------------------------------------------------------ */
/* The shape of a question                                             */
/* ------------------------------------------------------------------ */

export type QuestionShape = {
  /** The variable asked about, if a word for one was used. */
  variable: Variable | null;
  /** A warning, an alert, or a named hazard was asked about. */
  isWarning: boolean;
  /** A word for the weather, a variable, a hazard — anything that makes this weather talk. */
  weatherWord: boolean;
  /** Evidence of a place in the sentence. `whole` has already been confirmed. */
  place: PlaceEvidence;
  /** The question is about where the person is. */
  wantsHere: boolean;
};

/**
 * What a sentence says about weather, minus the time — which `readTime`
 * reads, because कल has to be read with its verb and this layer never did.
 */
export function readShape(text: string): QuestionShape {
  const trimmed = text.trim().replace(/[।?!.]+$/u, '').trim();

  let variable: Variable | null = null;
  for (const entry of VARIABLE_KEYWORDS) {
    if (entry.words.some((w) => matches(trimmed, w))) {
      variable = entry.variable;
      break;
    }
  }
  const isWarning = WARNING_KEYWORDS.some((w) => matches(trimmed, w));

  const masked = blankContractions(blank(trimmed, ALL_KEYWORDS));
  let place = findPlace(trimmed, masked, masked !== trimmed, GAZETTEER);

  // A "whole message" claim is only a claim once the gazetteer agrees.
  if (place.kind === 'found' && place.via === 'whole') {
    const bare = barePlace(trimmed);
    place = bare ? { kind: 'found', place: bare.place, via: 'gazetteer' } : { kind: 'unsure' };
  }

  return {
    variable,
    isWarning,
    weatherWord: variable !== null || isWarning,
    place,
    wantsHere: wantsCurrentLocation(trimmed),
  };
}

/* ------------------------------------------------------------------ */
/* The parser                                                          */
/* ------------------------------------------------------------------ */

function cannotParse(
  reason: CannotParse['reason'],
  statement: CannotParse['statement'],
): CannotParse {
  return { kind: 'cannotParse', reason, statement, servedBy: 'pattern' };
}

const NO_PLACE = cannotParse('noPlace', {
  hi: 'किस जगह के लिए? जगह का नाम बोलें या लिखें।',
  en: 'Which place? Say or type a place name.',
});

export const patternParser: Parser = {
  name: 'patterns',

  async parse(text: string, ctx: ParseContext): Promise<ParseResult | null> {
    const trimmed = text.trim().replace(/[।?!.]+$/u, '').trim();
    if (!trimmed) return NO_PLACE;

    let timeWindow: TimeWindow | null = null;
    for (const entry of TIME_KEYWORDS) {
      if (entry.words.some((w) => matches(trimmed, w))) {
        timeWindow = entry.window;
        break;
      }
    }

    let variable: Variable | null = null;
    for (const entry of VARIABLE_KEYWORDS) {
      if (entry.words.some((w) => matches(trimmed, w))) {
        variable = entry.variable;
        break;
      }
    }

    const isWarning = WARNING_KEYWORDS.some((w) => matches(trimmed, w));
    const recognisedShape = isWarning || timeWindow !== null || variable !== null;

    const masked = blankContractions(blank(trimmed, ALL_KEYWORDS));
    const evidence = findPlace(trimmed, masked, masked !== trimmed, GAZETTEER);

    /*
     * "Where I am" beats both the leftovers and the conversation.
     *
     * Ahead of the `unsure` defer below, because a sentence that says "near
     * me" has already named its place and there is nothing for the model to
     * disambiguate — "weather where I am" leaves "where" standing, which
     * would otherwise be deferred as a possible place name.
     *
     * Ahead of the standing place too: somebody who asked about Delhi and
     * then asks what it is like near them is asking about near them, and
     * inheriting Delhi would answer the wrong question confidently.
     *
     * It still has to be a weather question — `recognisedShape` — so a bare
     * "where am I?" is not claimed by the weather parser.
     */
    if (recognisedShape && evidence.kind !== 'found' && wantsCurrentLocation(trimmed)) {
      const window: TimeWindow = timeWindow ?? { kind: 'now' };
      return {
        kind: 'currentLocation',
        intent: isWarning
          ? 'warning'
          : window.kind === 'now' || (window.kind === 'day' && window.offset === 0)
            ? 'current'
            : 'forecast',
        timeWindow: window,
        variable: variable ?? 'all',
        servedBy: 'pattern',
      } satisfies CurrentLocationQuery;
    }

    // Something is standing in the sentence that may or may not be a place.
    // Guessing here is how "क्या आज घर से निकलूँ?" became a forecast for
    // Nepal, so this defers to the layer that can tell the difference.
    if (evidence.kind === 'unsure') return null;

    /*
     * The whole message, with no keyword in it at all. It is a place only if
     * the gazetteer says so — see `barePlace`. "ohh really" and "wassup"
     * were geocoded through here, one reply at a time, as "No place matched".
     */
    if (evidence.kind === 'found' && evidence.via === 'whole' && !barePlace(trimmed)) {
      return null;
    }

    const place = evidence.kind === 'found' ? evidence.place : null;

    /*
     * A locative particle proves where a place sits in a sentence; it proves
     * nothing about whether the sentence is about weather. "Python में list
     * कैसे sort करें?" has a perfectly good में, and claiming it here meant
     * the scope check never ran and Chaatak cheerfully answered a coding
     * question. So a locative claim also needs a weather word somewhere.
     *
     * A bare place name is the exception: nothing else was said, so there is
     * nothing to be about.
     */
    if (!recognisedShape && evidence.kind === 'found' && evidence.via !== 'whole') {
      return null;
    }

    // No place named here and nothing recognised either: not ours.
    if (!recognisedShape && place === null) return null;

    const resolvedPlace = place ?? ctx.lastPlace ?? null;
    if (resolvedPlace === null) return NO_PLACE;

    const window: TimeWindow = timeWindow ?? { kind: 'now' };

    let intent: Intent;
    if (isWarning) intent = 'warning';
    else if (window.kind === 'now') intent = 'current';
    else if (window.kind === 'day' && window.offset === 0) intent = 'current';
    else intent = 'forecast';

    return {
      kind: 'query',
      intent,
      place: resolvedPlace,
      placeWasImplied: place === null,
      timeWindow: window,
      variable: variable ?? 'all',
      servedBy: 'pattern',
    };
  },
};
