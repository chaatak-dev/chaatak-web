/**
 * The gate, for a chat turn.
 *
 * Wraps the Phase 1 checks and adds what conversation introduces:
 *
 *   - a grounded/ungrounded split. A weather claim is a number adjacent to a
 *     unit or a variable, so an ungrounded turn is held to "no numeric weather
 *     claim" rather than "no numbers". Without that, "I can give you a 3-day
 *     forecast" is rejected for containing a 3, and a gate that strict gets
 *     switched off.
 *   - the advice-vs-warning check.
 *   - the place check, which applies to ungrounded turns too: a turn that
 *     fetched nothing may still name a place, and it must be the standing one
 *     rather than an invented one.
 *
 * Runs server-side on the assistant text BEFORE the message enters scrollback,
 * so a rejected reply can never be quoted by a later turn.
 */

import { detectScript, type ScriptCode } from '../i18n/languages';
import { checkAdvice, hasUnnegatedReassurance, isLoud } from './advice';
import { buildFacts, normalisePlace, verifyRender, type GateRejection } from './gate';
import { MEASUREMENT_WORDS, extractNumbers, findSpelledOutValue, normaliseDigits } from './numbers';
import type { FactsSnapshot } from '../chat/types';
import type { Severity } from '../weather/types';

export type ChatGateRejection =
  | GateRejection
  | 'severityNotLeading'
  | 'contradictsWarning'
  /** The reply came back in a script the user did not write in. */
  | 'scriptSwitched';

export type ChatVerdict =
  | { ok: true }
  | { ok: false; reason: ChatGateRejection; detail: string };

export type ChatGateInput = {
  /** The current turn's facts, or null when nothing was fetched. */
  facts: FactsSnapshot | null;
  /** Place strings legitimately in play: resolved place, or the standing one. */
  places: string[];
  severity: Severity | 'unknown';
  /** Injected verbatim; must survive unchanged and lead the reply. */
  severityStrings?: string[];
  gazetteer?: Set<string>;
  /** The script the reply must be in. Omitted only where there is no text to judge. */
  expectScript?: ScriptCode | null;
};

/** How far from a measurement word counts as "adjacent". */
const WINDOW = 4;

/**
 * Below this many letters there is no script to judge.
 *
 * "26 °C" is a perfectly good answer to a Hindi question, and its only letter
 * is the C in the unit — which would read as Latin and be rejected as a script
 * switch. A sentence in any of the seven clears this comfortably.
 */
const SCRIPT_MIN_LETTERS = 8;

function countLetters(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

/**
 * For an ungrounded turn: a numeral sitting next to a unit or a variable.
 * Nothing was fetched, so any such number is fabricated by definition.
 */
function numericWeatherClaim(text: string): string | null {
  const tokens = normaliseDigits(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}\p{M}.]+/u)
    .filter(Boolean);

  for (let i = 0; i < tokens.length; i++) {
    if (!MEASUREMENT_WORDS.has(tokens[i])) continue;

    const from = Math.max(0, i - WINDOW);
    const to = Math.min(tokens.length, i + WINDOW + 1);
    for (let j = from; j < to; j++) {
      if (j !== i && /^\d+(\.\d+)?$/.test(tokens[j])) {
        return tokens.slice(from, to).join(' ');
      }
    }
  }
  return null;
}

export function verifyReply(text: string, input: ChatGateInput): ChatVerdict {
  const severityStrings = input.severityStrings ?? [];

  // 0. The script the user wrote in. "Never switch script on the user" is a
  //    locked rule, and until now it lived only in the prompt — which drifted:
  //    Bengali and Punjabi questions came back in fluent Hindi. A rule that
  //    matters is checked, not requested, so a drift ships the template.
  //
  //    Script only. English-versus-Hinglish is a judgement a lexicon makes
  //    badly, and a safety gate should not be the thing guessing; the prompt
  //    names the target and this catches the unambiguous failure.
  if (input.expectScript && countLetters(text) >= SCRIPT_MIN_LETTERS) {
    const got = detectScript(text);
    if (got !== null && got !== input.expectScript) {
      return {
        ok: false,
        reason: 'scriptSwitched',
        detail: `asked in ${input.expectScript}, answered in ${got}`,
      };
    }
  }

  // 1. Advice must not contradict an active warning. Checked first: it is the
  //    failure with the worst consequence and the one the other checks cannot
  //    see, since a reassuring reply can be numerically spotless.
  const advice = checkAdvice(text, input.severity, severityStrings);
  if (!advice.ok) return advice;

  if (input.facts) {
    // 2. Grounded: the full Phase 1 gate. Every numeral must be in the data.
    const facts = buildFacts({
      payload: input.facts,
      places: input.places,
      severityStrings,
    });
    return verifyRender(text, facts, { gazetteer: input.gazetteer });
  }

  // 3. Ungrounded. No values were fetched, so the numeral rule narrows to
  //    weather claims specifically, but everything else still applies.

  // A turn that fetched nothing can still be the one that says "don't worry":
  // "ohh really?" after an answer that opened with a red warning. When the
  // conversation's place has a loud warning standing, reassurance is refused
  // here exactly as it is on a grounded turn.
  if (isLoud(input.severity)) {
    const marker = hasUnnegatedReassurance(text);
    if (marker) {
      return {
        ok: false,
        reason: 'contradictsWarning',
        detail: `unnegated reassurance "${marker}" with a ${input.severity} standing in the conversation`,
      };
    }
  }

  const spelled = findSpelledOutValue(text);
  if (spelled !== null) {
    return {
      ok: false,
      reason: 'numberWord',
      detail: `value written in words near a unit: "${spelled}"`,
    };
  }

  const claim = numericWeatherClaim(text);
  if (claim !== null) {
    return {
      ok: false,
      reason: 'unknownNumber',
      detail: `numeric weather claim with nothing fetched: "${claim}"`,
    };
  }

  for (const severity of severityStrings) {
    if (!text.includes(severity)) {
      return {
        ok: false,
        reason: 'severityAltered',
        detail: `injected severity "${severity}" is missing from the reply`,
      };
    }
  }

  // The place check still applies: a turn that fetched nothing may name a
  // place, and it must be one that was actually in play.
  if (input.gazetteer) {
    // Same normalisation as the grounded path, diacritic folding included.
    const allowed = new Set(input.places.map(normalisePlace));
    const haystack = normalisePlace(text);

    for (const candidate of input.gazetteer) {
      if (!candidate) continue;
      if (haystack.includes(candidate) && !allowed.has(candidate)) {
        return {
          ok: false,
          reason: 'unknownPlace',
          detail: `"${candidate}" was named but was never in play`,
        };
      }
    }
  }

  // Numbers far from any measurement word are not weather claims.
  void extractNumbers;
  return { ok: true };
}
