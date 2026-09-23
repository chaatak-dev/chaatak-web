/**
 * Advice must never contradict an active warning.
 *
 * Two independent defences, because one is not enough:
 *
 *   STRUCTURAL — under an alert or warning the reply must OPEN with the
 *   injected severity string. Checked regardless of what follows.
 *
 *   LEXICAL — unnegated reassurance markers are rejected.
 *
 * The lexicon below WILL leak. Hindi has more ways to say "it's fine" than
 * any list will hold, and a model writing naturally will eventually find one.
 * That is precisely why the structural check exists and is not optional:
 * vocabulary catches phrasings, structure catches the shape of the answer.
 *
 * Both are biased toward rejection. A false positive ships the template, which
 * already states the severity verbatim; a false negative tells someone it is
 * safe during a cyclone.
 */

import { normaliseDigits } from './numbers';
import type { Severity } from '../weather/types';

/** Severities at which reassurance is forbidden outright. */
const LOUD: ReadonlySet<string> = new Set(['alert', 'warning']);

/** True for an orange or red warning: the level at which "it's fine" is never said. */
export function isLoud(severity: Severity | 'unknown'): boolean {
  return LOUD.has(severity);
}
/** Severities at which the severity string must at least be present. */
const NAMED: ReadonlySet<string> = new Set(['watch', 'alert', 'warning']);

/** Phrases that read as "conditions are fine" or "go ahead". */
const REASSURANCE = [
  // Hindi
  'ठीक है', 'ठीक रहेगा', 'सुरक्षित', 'कोई दिक्कत', 'कोई समस्या', 'कोई परेशानी',
  'कोई खतरा', 'चिंता की बात', 'चिंता मत', 'मौसम अच्छा', 'मौसम साफ',
  'मौसम साफ़', 'जा सकते', 'जा सकता', 'खेल सकते', 'खेल सकता', 'निकल सकते',
  'निकल सकता', 'कर सकते', 'आराम से', 'बेफिक्र', 'बिना डर',
  // English
  'fine', 'safe', 'no problem', 'no issue', 'no need to worry', 'go ahead',
  'should be okay', 'should be ok', 'good day for', 'you can', 'feel free',
  'no danger', 'all clear', 'pleasant',
];

/** Words that flip a marker's meaning when they sit just before it. */
const NEGATORS = [
  'नहीं', 'ना', 'मत', 'न', 'बिना',
  'not', "don't", 'do not', 'never', 'avoid', 'cannot', "can't", 'no',
  'unsafe', 'without',
];

/** How far back to look for a negator, in characters. */
const NEGATION_WINDOW = 28;

function normalise(text: string): string {
  return normaliseDigits(text).toLowerCase();
}

/**
 * Negators must match as whole words.
 *
 * Substring matching fails OPEN here, and badly: Hindi's negator न is a single
 * character that occurs inside perfectly ordinary words — लेकिन, चेतावनी,
 * निकलना — so a plain `includes` treats almost every sentence as negated and
 * quietly switches the whole lexical defence off. \b does not work for
 * Devanagari, hence the explicit letter-or-mark boundaries.
 */
const NEGATOR_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{M}])(?:${NEGATORS.map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('|')})(?![\\p{L}\\p{M}])`,
  'iu',
);

function isNegated(before: string, after: string): boolean {
  return NEGATOR_PATTERN.test(before) || NEGATOR_PATTERN.test(after);
}

/**
 * True when a reassurance marker appears with no negator in front of it.
 *
 * Scanning backwards by characters rather than tokens keeps this working for
 * Devanagari, where token boundaries are not what \b thinks they are.
 */
export function hasUnnegatedReassurance(text: string): string | null {
  const haystack = normalise(text);

  for (const marker of REASSURANCE) {
    const needle = marker.toLowerCase();
    let from = 0;

    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;

      const before = haystack.slice(Math.max(0, at - NEGATION_WINDOW), at);
      // Also look just past the marker: Hindi negates after the verb, as in
      // "सुरक्षित नहीं है".
      const after = haystack.slice(at + needle.length, at + needle.length + 14);

      if (!isNegated(before, after)) return marker;

      from = at + needle.length;
    }
  }
  return null;
}

/** Does the reply open with the severity, rather than burying it? */
export function opensWithSeverity(text: string, severity: string): boolean {
  const head = normalise(text).slice(0, severity.length + 40);
  return head.includes(normalise(severity));
}

export type AdviceVerdict =
  | { ok: true }
  | { ok: false; reason: 'severityNotLeading' | 'contradictsWarning'; detail: string };

export function checkAdvice(
  text: string,
  severity: Severity | 'unknown',
  severityStrings: string[],
): AdviceVerdict {
  if (!NAMED.has(severity) || severityStrings.length === 0) return { ok: true };

  const leading = severityStrings[0];

  // Structural first: it is the defence that does not depend on vocabulary.
  if (!opensWithSeverity(text, leading)) {
    return {
      ok: false,
      reason: 'severityNotLeading',
      detail: `reply does not open with the severity "${leading}"`,
    };
  }

  if (!LOUD.has(severity)) return { ok: true };

  const marker = hasUnnegatedReassurance(text);
  if (marker) {
    return {
      ok: false,
      reason: 'contradictsWarning',
      detail: `unnegated reassurance "${marker}" under severity "${severity}"`,
    };
  }

  return { ok: true };
}
