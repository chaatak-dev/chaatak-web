/**
 * Provider fallback.
 *
 * Tries each configured provider in order. A rate limit or an unavailable
 * provider moves to the next one; only a genuine content failure on the last
 * provider ends the chain. The caller gets a typed result either way and never
 * an exception, because the correct response to "every model is out" is a
 * template answer, not an error page.
 */

import type { CompletionRequest, CompletionResult, LanguageModel } from './types';

export type ChainOutcome = {
  result: CompletionResult;
  /** Providers tried, in order, for logging. */
  attempted: string[];
};

export async function completeWithFallback(
  providers: LanguageModel[],
  request: CompletionRequest,
): Promise<ChainOutcome> {
  const attempted: string[] = [];
  let last: CompletionResult | null = null;

  for (const provider of providers) {
    // Checked before the network call so an unkeyed provider costs nothing.
    if (!provider.configured()) {
      last = {
        kind: 'unavailable',
        provider: provider.name,
        reason: 'no API key configured',
      };
      continue;
    }

    attempted.push(provider.name);
    const result = await provider.complete(request);
    last = result;

    if (result.kind === 'ok') return { result, attempted };
    // rateLimited, unavailable and failed all mean: try the next one. A free
    // tier that is momentarily out is the expected case, not an incident.
  }

  return {
    result:
      last ?? {
        kind: 'unavailable',
        provider: 'none',
        reason: 'no providers configured',
      },
    attempted,
  };
}
