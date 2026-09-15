/**
 * Parse orchestration: patterns → cache → LLM.
 *
 * Order is the whole design. A provider call is the exception path, so the
 * cheap deterministic layer runs first and the cache absorbs the repeats
 * before anything reaches a model.
 */

import { TTL, cached } from '../cache';
import { patternParser } from './patterns';
import type { ParseContext, ParseResult, Parser } from './types';

/**
 * Cache key text. Lower-cased and whitespace-collapsed so "Aaj ka mausam" and
 * "aaj  ka   mausam" are one entry — but deliberately NOT transliterated,
 * because गाज़ियाबाद and "Ghaziabad" are different queries that reach
 * different geocoders.
 */
function normaliseForKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[।?!.]+$/u, '');
}

/** The LLM parser, registered by the provider layer. Absent until then. */
let llmParser: Parser | null = null;

export function registerLlmParser(parser: Parser | null): void {
  llmParser = parser;
}

export type ParseOutcome = {
  result: ParseResult;
  cacheHit: boolean;
};

export async function parseQuery(
  text: string,
  ctx: ParseContext,
): Promise<ParseOutcome> {
  // 1. Patterns. Returns null when it does not recognise the shape at all.
  const byPattern = await patternParser.parse(text, ctx);
  if (byPattern) return { result: byPattern, cacheHit: false };

  // 2. Cache, keyed on (normalisedText, lang). Only wraps the expensive path.
  //
  // The implied-place case is deliberately excluded from caching: the answer
  // depends on whose last place it was, and caching that would hand one
  // user's place to another.
  const key = `parse:${ctx.lang}:${normaliseForKey(text)}`;
  let servedFromCache = true;

  const result = await cached<ParseResult>(
    key,
    TTL.parse,
    async () => {
      servedFromCache = false;
      if (!llmParser) {
        return {
          kind: 'cannotParse' as const,
          reason: 'notUnderstood' as const,
          statement: {
            hi: 'यह समझ नहीं आया। सिर्फ़ जगह का नाम बोलें या लिखें।',
            en: 'That was not understood. Say or type just the place name.',
          },
          servedBy: 'pattern' as const,
        };
      }
      const parsed = await llmParser.parse(text, ctx);
      return (
        parsed ?? {
          kind: 'cannotParse' as const,
          reason: 'notUnderstood' as const,
          statement: {
            hi: 'यह समझ नहीं आया। सिर्फ़ जगह का नाम बोलें या लिखें।',
            en: 'That was not understood. Say or type just the place name.',
          },
          servedBy: 'llm' as const,
        }
      );
    },
    // A question that could not be understood stays not-understood, so it is
    // worth caching. Nothing transient is held.
    () => true,
  );

  return { result, cacheHit: servedFromCache };
}
