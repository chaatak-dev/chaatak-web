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

import { checkAdvice } from './advice';
import { buildFacts, verifyRender, type GateRejection } from './gate';
import { MEASUREMENT_WORDS, extractNumbers, findSpelledOutValue, normaliseDigits } from './numbers';
import type { FactsSnapshot } from '../chat/types';
import type { Severity } from '../weather/types';

export type ChatGateRejection =
  | GateRejection
  | 'severityNotLeading'
  | 'contradictsWarning';

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
};

/** How far from a measurement word counts as "adjacent". */
const WINDOW = 4;

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
    const allowed = new Set(input.places.map((p) => p.toLowerCase().trim()));
    const haystack = normaliseDigits(text).toLowerCase();

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
