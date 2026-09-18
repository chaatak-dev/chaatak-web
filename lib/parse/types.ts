/**
 * The structured query a natural-language question turns into.
 *
 * Parsing returns a complete query or an explicit `cannotParse`. There is no
 * partial result and no guess: a half-understood question about a cyclone is
 * more dangerous than an admitted failure to understand it.
 */

import type { LanguageCode } from '../i18n/languages';

/** Any of the seven. The parser sees what the user actually spoke. */
export type QueryLang = LanguageCode;

export type Intent =
  /** Conditions right now. */
  | 'current'
  /** A future day or range. */
  | 'forecast'
  /** Warnings in force. */
  | 'warning';

export type TimeWindow =
  | { kind: 'now' }
  /** Whole days from today. 0 = आज, 1 = कल, 2 = परसों. */
  | { kind: 'day'; offset: number }
  /** A span starting today, e.g. इस हफ़्ते. */
  | { kind: 'range'; days: number };

export type Variable =
  | 'all'
  | 'temperature'
  | 'rain'
  | 'wind'
  | 'humidity';

/** Which layer answered. Logged for every query. */
export type ParseLayer = 'pattern' | 'cache' | 'llm';

export type ParsedQuery = {
  kind: 'query';
  intent: Intent;
  /**
   * The place EXACTLY as the user said or typed it — the original substring,
   * never normalised, never transliterated, never case-folded.
   *
   * This matters more than it looks. Hindi speech returns Devanagari, and
   * Devanagari is the only form the geocoder that handles it can read. A
   * parser that helpfully rewrote गाज़ियाबाद as "Ghaziabad" would destroy the
   * exact thing the resolver needs.
   */
  place: string;
  /** True when the place came from context rather than from this sentence. */
  placeWasImplied: boolean;
  timeWindow: TimeWindow;
  variable: Variable;
  servedBy: ParseLayer;
};

export type CannotParse = {
  kind: 'cannotParse';
  reason:
    /** No place in the sentence and none remembered to fall back on. */
    | 'noPlace'
    /** Nothing in the sentence resolved to a question we can answer. */
    | 'notUnderstood';
  statement: { hi: string; en: string };
  servedBy: ParseLayer;
};

export type ParseResult = ParsedQuery | CannotParse;

export type ParseContext = {
  lang: QueryLang;
  /** The last place this user resolved, for questions that imply one. */
  lastPlace?: string;
};

/**
 * A parsing implementation. The pattern layer and the LLM layer both satisfy
 * this, which is what lets the orchestrator try them in order.
 */
export interface Parser {
  name: string;
  parse(text: string, ctx: ParseContext): Promise<ParseResult | null>;
}
