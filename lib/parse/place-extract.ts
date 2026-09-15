/**
 * Finding the place in a sentence — by evidence, not by elimination.
 *
 * The first version of this took "whatever is left once the keywords are
 * removed" as the place. That over-claims badly, and it over-claims in the
 * worst possible direction: "क्या आज घर से निकलूँ?" left निकलूँ standing — a
 * verb — which the geocoder duly matched to somewhere in Nepal, and the user
 * got a confident answer about the wrong country. Same failure class as the
 * transliteration trials, arriving through a different door.
 *
 * So a place is claimed only on positive evidence:
 *
 *   1. it sits immediately before a locative particle — में, का, mein, ka
 *   2. it follows an English preposition — in, at
 *   3. the whole message is the place, with no keywords in it at all
 *   4. what is left is a name we actually recognise
 *
 * Anything else defers to the LLM, which can tell a village from a verb.
 * Deferring costs a model call; guessing costs the user the wrong forecast.
 */

/** Particles that mark the word BEFORE them as a place. */
const LOCATIVE_AFTER = [
  'में', 'मे', 'का', 'की', 'के',
  'mein', 'me', 'ka', 'ki', 'ke',
];

/** Prepositions that mark the word AFTER them as a place. */
const LOCATIVE_BEFORE = ['in', 'at'];

/** Real place names in a spoken query run to three words at the very most. */
const MAX_PLACE_WORDS = 3;

function bounded(word: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{M}])${escaped}(?![\\p{L}\\p{M}])`, 'giu');
}

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
/** Blanked by the mask — a keyword stood here, not a place. */
const isMasked = (original: string, masked: string, i: number) =>
  !isSpace(original[i]) && masked[i] === ' ';

/**
 * The word IMMEDIATELY before `from`, or null if a keyword stands there.
 *
 * Refusing to skip over a blanked keyword is the point. "ऑरेंज अलर्ट का मतलब"
 * has अलर्ट sitting right before का; a version that skipped past it reached
 * back to ऑरेंज, called it a place, and went off to fetch the weather for a
 * question that was only ever asking what a warning colour means.
 */
function runBefore(
  original: string,
  masked: string,
  from: number,
): [number, number] | null {
  let end = from;
  while (end > 0 && isSpace(original[end - 1])) end -= 1;
  if (end === 0 || isMasked(original, masked, end - 1)) return null;

  let start = end;
  while (start > 0 && !isSpace(original[start - 1]) && masked[start - 1] !== ' ') {
    start -= 1;
  }
  return start < end ? [start, end] : null;
}

/** The word immediately after `from`, or null if a keyword stands there. */
function runAfter(
  original: string,
  masked: string,
  from: number,
): [number, number] | null {
  let start = from;
  while (start < original.length && isSpace(original[start])) start += 1;
  if (start >= original.length || isMasked(original, masked, start)) return null;

  let end = start;
  while (end < original.length && !isSpace(original[end]) && masked[end] !== ' ') {
    end += 1;
  }
  return end > start ? [start, end] : null;
}

function tidy(candidate: string): string | null {
  const trimmed = candidate.replace(/^[^\p{L}]+|[^\p{L}\p{M}]+$/gu, '').trim();
  if (!trimmed) return null;
  if (trimmed.split(/\s+/).length > MAX_PLACE_WORDS) return null;
  return trimmed;
}

export type PlaceEvidence =
  /**
   * Confident: claim it. `via` says on what grounds, because the parser
   * treats them differently — a bare place name stands alone, while a
   * locative match still needs the sentence to be about weather.
   */
  | { kind: 'found'; place: string; via: 'locative' | 'whole' | 'gazetteer' }
  /** No place in this message; a standing one may be inherited. */
  | { kind: 'none' }
  /** Something is here but we cannot tell if it is a place. Defer. */
  | { kind: 'unsure' };

export function findPlace(
  original: string,
  masked: string,
  hadKeyword: boolean,
  gazetteer: ReadonlySet<string>,
): PlaceEvidence {
  // 1. <place> में / <place> ka
  for (const particle of LOCATIVE_AFTER) {
    for (const match of original.matchAll(bounded(particle))) {
      const span = runBefore(original, masked, match.index);
      if (!span) continue;
      const place = tidy(original.slice(span[0], span[1]));
      if (place) return { kind: 'found', place, via: 'locative' };
    }
  }

  // 2. in <place> / at <place>
  for (const preposition of LOCATIVE_BEFORE) {
    for (const match of original.matchAll(bounded(preposition))) {
      const span = runAfter(original, masked, match.index + match[0].length);
      if (!span) continue;
      const place = tidy(original.slice(span[0], span[1]));
      if (place) return { kind: 'found', place, via: 'locative' };
    }
  }

  // What survived the masking, longest run first.
  const leftovers: string[] = [];
  for (const chunk of masked.split(' ')) {
    if (chunk.trim()) leftovers.push(chunk);
  }
  const spans: string[] = [];
  {
    let start = -1;
    for (let i = 0; i <= masked.length; i++) {
      const blank = i === masked.length || masked[i] === ' ';
      if (blank) {
        if (start >= 0) {
          spans.push(original.slice(start, i));
          start = -1;
        }
      } else if (start < 0) start = i;
    }
  }
  void leftovers;

  const candidates = spans
    .map(tidy)
    .filter((c): c is string => c !== null);

  // 3. Nothing was recognised at all, so the message IS the place.
  if (!hadKeyword) {
    const whole = tidy(original);
    return whole ? { kind: 'found', place: whole, via: 'whole' } : { kind: 'none' };
  }

  if (candidates.length === 0) return { kind: 'none' };

  // 4. A name we recognise. The gazetteer's second job: telling a place from
  //    a verb when position gives no hint.
  for (const candidate of candidates) {
    if (gazetteer.has(candidate.toLowerCase())) {
      return { kind: 'found', place: candidate, via: 'gazetteer' };
    }
  }

  // Something is standing here and we cannot tell what it is. The LLM can.
  return { kind: 'unsure' };
}
