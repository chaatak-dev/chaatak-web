/**
 * The verification gate.
 *
 *   parse → fetch → render → VERIFY → ship
 *
 * This is what lets the model write freely while remaining structurally
 * incapable of putting a weather value on screen that no source issued. It is
 * programmatic. It is not a prompt instruction, because a prompt instruction
 * is a request and this is a guarantee.
 *
 * On any rejection the render is thrown away, the template response ships
 * instead, and the rejection is logged. A rejected render is never repaired
 * and never partially used.
 */

import {
  extractNumbers,
  findSpelledOutValue,
  normaliseDigits,
} from './numbers';

export type GateRejection =
  /** A numeral in the output that was not in the data handed to the model. */
  | 'unknownNumber'
  /** A value written out in words next to a unit, dodging the numeral check. */
  | 'numberWord'
  /** A place named in the output that was never resolved. */
  | 'unknownPlace'
  /** An injected severity string came back altered or missing. */
  | 'severityAltered';

export type GateVerdict =
  | { ok: true }
  | { ok: false; reason: GateRejection; detail: string };

/**
 * Everything the model was shown. The rule is exactly "you may repeat what you
 * were given", so this is derived from the payload itself rather than
 * hand-listed — which keeps it correct when the payload changes.
 */
export type RenderFacts = {
  /** Every number in the payload, including those inside date and time strings. */
  numbers: Set<number>;
  /** Place strings the model was given: name, district, state, country. */
  places: Set<string>;
  /** Severity strings injected verbatim. Must survive unchanged. */
  severityStrings: string[];
};

/** Floating-point slack. 25.20 and 25.2 are the same number. */
const EPSILON = 1e-9;

function hasNumber(facts: RenderFacts, n: number): boolean {
  for (const known of facts.numbers) {
    if (Math.abs(known - n) < EPSILON) return true;
  }
  return false;
}

/**
 * Walks the payload handed to the model and collects every number in it —
 * numeric fields, and numbers embedded in strings such as "2026-09-17" or
 * "01:45". If the model was shown it, the model may say it.
 */
export function collectNumbers(payload: unknown, into = new Set<number>()): Set<number> {
  if (typeof payload === 'number') {
    if (Number.isFinite(payload)) into.add(payload);
    return into;
  }
  if (typeof payload === 'string') {
    for (const n of extractNumbers(payload)) into.add(n);
    return into;
  }
  if (Array.isArray(payload)) {
    for (const item of payload) collectNumbers(item, into);
    return into;
  }
  if (payload && typeof payload === 'object') {
    for (const value of Object.values(payload)) collectNumbers(value, into);
  }
  return into;
}

function normalisePlace(place: string): string {
  return normaliseDigits(place).toLowerCase().trim();
}

export function buildFacts(opts: {
  payload: unknown;
  places: string[];
  severityStrings?: string[];
}): RenderFacts {
  return {
    numbers: collectNumbers(opts.payload),
    places: new Set(opts.places.filter(Boolean).map(normalisePlace)),
    severityStrings: opts.severityStrings ?? [],
  };
}

export type GateOptions = {
  /**
   * Known place names used to catch a place the model named but never
   * resolved. Without it the place check can only verify what it recognises,
   * so the pattern layer's gazetteer is passed in here.
   */
  gazetteer?: Set<string>;
};

/**
 * Verify a rendered reply against the data it was built from.
 *
 * Checks run cheapest-first, and the first failure wins — there is nothing to
 * gain from enumerating every fault in output we are about to discard.
 */
export function verifyRender(
  rendered: string,
  facts: RenderFacts,
  options: GateOptions = {},
): GateVerdict {
  // 1. Severity, first: it is the failure the other checks cannot see. A
  //    softened "extremely heavy rain" is fluent and numerically spotless.
  for (const severity of facts.severityStrings) {
    if (!rendered.includes(severity)) {
      return {
        ok: false,
        reason: 'severityAltered',
        detail: `injected severity "${severity}" is missing from the render`,
      };
    }
  }

  // 2. A value spelled out in words, which carries no numeral to check.
  const spelled = findSpelledOutValue(rendered);
  if (spelled !== null) {
    return {
      ok: false,
      reason: 'numberWord',
      detail: `value written in words near a unit: "${spelled}"`,
    };
  }

  // 3. Every numeral must have been in the data. Devanagari digits are
  //    normalised first, so २५ is checked exactly as 25 is.
  for (const n of extractNumbers(rendered)) {
    if (!hasNumber(facts, n)) {
      return {
        ok: false,
        reason: 'unknownNumber',
        detail: `${n} does not appear in the fetched data`,
      };
    }
  }

  // 4. A place named but never resolved. Only places we can recognise can be
  //    caught, so this is a floor rather than a proof.
  if (options.gazetteer) {
    const haystack = normalisePlace(rendered);
    for (const candidate of options.gazetteer) {
      if (!candidate) continue;
      if (haystack.includes(candidate) && !facts.places.has(candidate)) {
        return {
          ok: false,
          reason: 'unknownPlace',
          detail: `"${candidate}" was named but never resolved`,
        };
      }
    }
  }

  return { ok: true };
}
