/**
 * Finding the place in a sentence — by evidence, not by position.
 *
 * TWO FAILURES, ONE CAUSE. The first version took "whatever is left once the
 * keywords are removed" as the place: "क्या आज घर से निकलूँ?" left निकलूँ — a
 * verb — and the geocoder found it in Nepal. The second took "whatever sits
 * next to a particle": "क्या मैं अपने दोस्त के साथ क्रिकेट खेल सकता हूँ कल शाम को?"
 * put दोस्त before के, and "kal office mein baarish hogi?", "मेरे घर में",
 * "will it rain at home", "kal shaadi mein", "mere bhai ki shaadi" and "what
 * about the evening?" all went to the geocoder the same way. A particle marks
 * a NOUN; it says nothing about whether the noun names a place. Both versions
 * resolved uncertainty by guessing, and a guess about WHERE is how a weather
 * system answers about the wrong place.
 *
 * So a place is claimed here only when it is certain:
 *
 *   1. a name the gazetteer holds, in a place slot — "Lucknow में",
 *      "Pune का मौसम", "weather in Ghaziabad"
 *   2. a name the gazetteer holds, standing alone among words that cannot be
 *      names — "kal lucknow barish?"
 *   3. the whole message, when it is nothing but a name (confirmed later, by
 *      the gazetteer, in `barePlace`)
 *
 * Anything else is `unsure`, and `unsure` never reaches a geocoder: it goes to
 * the classifier, which reads the conversation and can tell a village from a
 * friend. An unlisted village still works — through the classifier, as the
 * answer to "which place?", or offered after "what about" — just never on a
 * guess. When an unknown name sat in a real place slot it is passed along as
 * `candidate`, so a reply that cannot ask a model can at least ask the person.
 *
 * WHAT A SLOT IS is grammar, not a list of nouns:
 *
 *   - में / mein is locative: "X में" puts something IN X.
 *   - का / की / के / ka / ki / ke are possessive. "Lucknow का मौसम" is a place
 *     only because its head is weather; "दोस्त के साथ" is WITH a friend,
 *     "भाई की शादी" is a brother's wedding. So a possessive is a slot only when
 *     what follows is weather, a time, a word of nearness ("के पास", "ke
 *     aas-paas", "ilaake"), a question tail ("Mumbai ka?", "ke baare mein"),
 *     or nothing at all.
 *   - Latin "me" is the Hinglish locative only in the same positions: "Delhi
 *     me barish". Otherwise it is the English pronoun: "give me the weather".
 *   - "in" and "at" put the name AFTER them.
 *
 * Names grow to the right in India — Rampur Khas, Sultanpur Lodhi, Rampur
 * Kalan — so after "in", a known name followed by an unknown word is not that
 * known name: "in Rampur Khas" is not Rampur, and reading it so answered about
 * a real district elsewhere. Before में, the name ends at the particle, and a
 * known name there is the name ("ghar Lucknow में").
 */

/** Always locative: the word before is where something is. */
const LOCATIVE = new Set(['में', 'मे', 'mein']);

/** Possessive, or ambiguous with a pronoun: a slot only before a place-ful head. */
const HEADED = new Set(['का', 'की', 'के', 'ka', 'ki', 'ke', 'me', 'mai', 'mei']);

/** Prepositions that mark the word AFTER them. */
const BEFORE_NAME = new Set(['in', 'at']);

/**
 * Nearness and area — the heads that make a possessive locational:
 * "Lucknow के पास", "Delhi ke aas-paas", "Pune ke ilaake". A closed class of
 * relation words, the same way the particles themselves are.
 */
const NEARNESS = new Set([
  'पास', 'आसपास', 'आस-पास', 'नज़दीक', 'नजदीक', 'इलाके', 'इलाक़े', 'इलाका', 'इलाक़ा',
  'क्षेत्र', 'ज़िले', 'जिले', 'ज़िला', 'जिला', 'तरफ़', 'तरफ',
  'paas', 'pass', 'aas-paas', 'aaspaas', 'najdeek', 'nazdeek', 'nazdik', 'ilaake',
  'ilake', 'ilaka', 'area', 'zile', 'jile', 'zila', 'jila', 'district', 'taraf',
]);

/** Question tails a possessive can end in: "Mumbai ka kya?", "Lucknow ke baare mein". */
const TAIL = new Set(['क्या', 'हाल', 'बारे', 'kya', 'haal', 'baare', 'bare']);

/** Real place names in a spoken query run to three words at the very most. */
const MAX_PLACE_WORDS = 3;

export type PlaceEvidence =
  /**
   * Certain: claim it. `via` says on what grounds, because the parser treats
   * them differently — a bare place name stands alone, while a locative match
   * still needs the sentence to be about weather.
   */
  | { kind: 'found'; place: string; via: 'locative' | 'whole' | 'gazetteer' }
  /** No place in this message; a standing one may be inherited. */
  | { kind: 'none' }
  /**
   * Something here might be a place and cannot be confirmed. Defer — never
   * geocode. `candidate` is an unknown name a real place slot offered.
   */
  | { kind: 'unsure'; candidate?: string };

export type PlaceClues = {
  /** A name the gazetteer holds exactly — never a word of ordinary speech. */
  isKnown: (name: string) => boolean;
  /** Weather or time: the heads that make "X ka ___" about a place. */
  isWeatherOrTime: (word: string) => boolean;
  /** A word of ordinary speech: never a place, and never in the way of one. */
  isOrdinary: (word: string) => boolean;
};

type Token = {
  text: string;
  start: number;
  end: number;
  /** A keyword the pattern layer recognised: a time, a weather word, a particle. */
  keyword: boolean;
  /** Ordinary speech — a pronoun, a copula, a social word. */
  ordinary: boolean;
  /** Punctuation between this token and the next ends a phrase. */
  breakAfter: boolean;
};

const WORD = /[\p{L}\p{M}\p{N}'’-]+/gu;

function tokenize(original: string, masked: string, clues: PlaceClues): Token[] {
  const tokens: Token[] = [];
  for (const match of original.matchAll(WORD)) {
    const start = match.index;
    const end = start + match[0].length;
    const text = match[0];
    tokens.push({
      text,
      start,
      end,
      keyword: masked.slice(start, end).trim() === '',
      ordinary: clues.isOrdinary(text),
      breakAfter: false,
    });
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const between = original.slice(tokens[i].end, tokens[i + 1].start);
    tokens[i].breakAfter = /[,;:!?।|.()"“”]/u.test(between);
  }
  return tokens;
}

const lower = (text: string) => text.toLocaleLowerCase();

/** Could this token be part of a name? Not a keyword, not ordinary speech, has a letter. */
function nameish(token: Token): boolean {
  return !token.keyword && !token.ordinary && /\p{L}/u.test(token.text);
}

/** The verbatim text of tokens i..j inclusive. */
function slice(original: string, tokens: Token[], i: number, j: number): string {
  return original.slice(tokens[i].start, tokens[j].end);
}

/** A possessive (or Latin "me") marks a slot only before a place-ful head. */
function headIsPlaceful(tokens: Token[], particle: number, clues: PlaceClues): boolean {
  const next = tokens[particle + 1];
  if (!next || tokens[particle].breakAfter) return true; // "Mumbai ka?"
  const word = lower(next.text);
  return clues.isWeatherOrTime(next.text) || NEARNESS.has(word) || TAIL.has(word);
}

type Candidate = ({ certain: string } | { unknown: string }) & { span: number[] };

/**
 * The name in a slot, read from the words beside the particle.
 *
 * Before a particle the name ENDS at the particle: the longest known run
 * ending there is the name. After a preposition the name STARTS there and may
 * run on — so only a known run with nothing name-like after it is certain.
 */
function readSlot(original: string, tokens: Token[], particle: number, side: 'before' | 'after', clues: PlaceClues): Candidate | null {
  const span: number[] = [];
  if (side === 'before') {
    for (let i = particle - 1; i >= 0 && span.length < MAX_PLACE_WORDS; i--) {
      if (!nameish(tokens[i]) || tokens[i].breakAfter) break;
      span.unshift(i);
    }
  } else {
    for (let i = particle + 1; i < tokens.length && span.length < MAX_PLACE_WORDS; i++) {
      if (!nameish(tokens[i]) || (i > particle + 1 && tokens[i - 1].breakAfter)) break;
      span.push(i);
      if (tokens[i].breakAfter) break;
    }
  }
  if (span.length === 0) return null;

  const first = span[0];
  const last = span[span.length - 1];
  const whole = slice(original, tokens, first, last);
  if (clues.isKnown(whole)) return { certain: whole, span };

  if (side === 'before') {
    for (let from = first + 1; from <= last; from++) {
      const suffix = slice(original, tokens, from, last);
      if (clues.isKnown(suffix)) return { certain: suffix, span };
    }
  }
  return { unknown: whole, span };
}

export function findPlace(original: string, masked: string, hadKeyword: boolean, clues: PlaceClues): PlaceEvidence {
  // Nothing was recognised at all, so the message may BE the place. Only a
  // claim: the gazetteer confirms it or it is dropped (see `barePlace`).
  if (!hadKeyword) {
    const whole = original.replace(/^[^\p{L}]+|[^\p{L}\p{M}]+$/gu, '').trim();
    if (!whole) return { kind: 'none' };
    return whole.split(/\s+/).length <= MAX_PLACE_WORDS + 1
      ? { kind: 'found', place: whole, via: 'whole' }
      : { kind: 'unsure' };
  }

  const tokens = tokenize(original, masked, clues);
  const certain: string[] = [];
  const unknown: string[] = [];
  const inSlot = new Set<number>();

  tokens.forEach((token, i) => {
    const word = lower(token.text);
    let side: 'before' | 'after' | null = null;
    if (LOCATIVE.has(word)) side = 'before';
    else if (HEADED.has(word) && headIsPlaceful(tokens, i, clues)) side = 'before';
    else if (BEFORE_NAME.has(word)) side = 'after';
    if (!side) return;

    const candidate = readSlot(original, tokens, i, side, clues);
    if (!candidate) return;
    if ('certain' in candidate) certain.push(candidate.certain);
    else unknown.push(candidate.unknown);
    // Whatever the slot held is accounted for; it is not also a leftover.
    for (const j of candidate.span) inSlot.add(j);
  });

  const distinct = [...new Map(certain.map((c) => [lower(c), c])).values()];
  if (distinct.length === 1) return { kind: 'found', place: distinct[0], via: 'locative' };
  // Two places named ("Delhi mein ya Lucknow mein"): the classifier picks.
  if (distinct.length > 1) return { kind: 'unsure' };
  if (unknown.length > 0) return { kind: 'unsure', candidate: unknown[0] };

  // No slot: the words left over. A known name among words that cannot be
  // names is the place; a known name among other unknown words is not
  // certain — "papa ke saath kal mandi jaana hai" may mean the town of Mandi
  // or the market, and only the conversation can say which.
  const known: string[] = [];
  let unknownWords = 0;
  let i = 0;
  while (i < tokens.length) {
    if (!nameish(tokens[i]) || inSlot.has(i)) {
      i += 1;
      continue;
    }
    let end = i;
    while (end + 1 < tokens.length && nameish(tokens[end + 1]) && !inSlot.has(end + 1) && !tokens[end].breakAfter) end += 1;
    // Within the run, the longest known name from each position.
    let at = i;
    while (at <= end) {
      let matched = -1;
      for (let to = Math.min(end, at + MAX_PLACE_WORDS - 1); to >= at; to--) {
        if (clues.isKnown(slice(original, tokens, at, to))) {
          matched = to;
          break;
        }
      }
      if (matched >= 0) {
        known.push(slice(original, tokens, at, matched));
        at = matched + 1;
      } else {
        unknownWords += 1;
        at += 1;
      }
    }
    i = end + 1;
  }

  const places = [...new Map(known.map((k) => [lower(k), k])).values()];
  if (places.length === 1 && unknownWords === 0) return { kind: 'found', place: places[0], via: 'gazetteer' };
  if (places.length === 0 && unknownWords === 0) return { kind: 'none' };
  return { kind: 'unsure' };
}
