import { test } from 'node:test';
import assert from 'node:assert/strict';

import { completeWithFallback } from './chain';
import type { CompletionResult, LanguageModel } from './types';

/**
 * Fixtures before the implementation that uses them.
 *
 * The production constraint these guard: a rate limit must never surface. We
 * are on free tiers, so 429 is a normal operating condition, and the whole
 * point of the chain is that a user never learns it happened.
 */

function fake(
  name: string,
  behaviour: CompletionResult | 'unconfigured',
  calls?: string[],
): LanguageModel {
  return {
    name,
    model: `${name}-model`,
    configured: () => behaviour !== 'unconfigured',
    async complete() {
      calls?.push(name);
      if (behaviour === 'unconfigured') throw new Error('must not be called');
      return behaviour;
    },
  };
}

const ok = (name: string): CompletionResult => ({
  kind: 'ok',
  text: '{"understood":true}',
  provider: name,
  model: `${name}-model`,
  latencyMs: 12,
});

const REQ = { system: 's', user: 'u' };

test('a rate limit falls through to the next provider and never surfaces', async () => {
  const calls: string[] = [];
  const { result, attempted } = await completeWithFallback(
    [
      fake('primary', { kind: 'rateLimited', provider: 'primary' }, calls),
      fake('secondary', ok('secondary'), calls),
    ],
    REQ,
  );

  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;
  assert.equal(result.provider, 'secondary');
  assert.deepEqual(calls, ['primary', 'secondary']);
  assert.deepEqual(attempted, ['primary', 'secondary']);
});

test('an unconfigured provider is skipped without a network call', async () => {
  const calls: string[] = [];
  const { result, attempted } = await completeWithFallback(
    [fake('gemini', 'unconfigured', calls), fake('groq', ok('groq'), calls)],
    REQ,
  );

  assert.equal(result.kind, 'ok');
  // Never attempted, never called — an unkeyed provider costs nothing.
  assert.deepEqual(calls, ['groq']);
  assert.deepEqual(attempted, ['groq']);
});

test('every provider failing returns a typed result, not an exception', async () => {
  // The caller's correct response to this is the template answer. If the chain
  // threw, that fallback would become an error page instead.
  const { result } = await completeWithFallback(
    [
      fake('a', { kind: 'rateLimited', provider: 'a' }),
      fake('b', { kind: 'failed', provider: 'b', reason: 'bad json' }),
    ],
    REQ,
  );

  assert.notEqual(result.kind, 'ok');
  assert.ok(['rateLimited', 'failed', 'unavailable'].includes(result.kind));
});

test('no providers configured at all is survivable', async () => {
  const { result, attempted } = await completeWithFallback([], REQ);
  assert.equal(result.kind, 'unavailable');
  assert.deepEqual(attempted, []);
});

test('the first working provider wins and later ones are never called', async () => {
  const calls: string[] = [];
  await completeWithFallback(
    [fake('first', ok('first'), calls), fake('second', ok('second'), calls)],
    REQ,
  );
  assert.deepEqual(calls, ['first']);
});

test('concurrent callers do not interfere', async () => {
  // Assume concurrent users: the chain holds no mutable state between calls.
  const providers = [
    fake('primary', { kind: 'rateLimited', provider: 'primary' }),
    fake('secondary', ok('secondary')),
  ];

  const results = await Promise.all(
    Array.from({ length: 12 }, () => completeWithFallback(providers, REQ)),
  );

  for (const { result, attempted } of results) {
    assert.equal(result.kind, 'ok');
    assert.deepEqual(attempted, ['primary', 'secondary']);
  }
});

/* ---- the chain's own deadline ----------------------------------------- */

/** A provider that takes `ms` to fail, and records the timeout it was given. */
function slow(name: string, ms: number, seen: (number | undefined)[]): LanguageModel {
  return {
    name,
    model: `${name}-model`,
    configured: () => true,
    async complete(request) {
      seen.push(request.timeoutMs);
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { kind: 'failed', provider: name, reason: 'TimeoutError' };
    },
  };
}

test('each provider gets what is left of the deadline, capped by its own timeout', async () => {
  const seen: (number | undefined)[] = [];
  await completeWithFallback([slow('first', 0, seen)], { ...REQ, timeoutMs: 8_000, deadlineMs: 5_000 });
  assert.ok(seen[0] !== undefined && seen[0] <= 5_000 && seen[0] > 4_000, `got ${seen[0]}`);

  const roomy: (number | undefined)[] = [];
  await completeWithFallback([slow('first', 0, roomy)], { ...REQ, timeoutMs: 3_000, deadlineMs: 12_000 });
  assert.equal(roomy[0], 3_000, 'the per-provider timeout still caps it');
});

test('a provider that spends the deadline is not followed by another', async () => {
  const seen: (number | undefined)[] = [];
  const calls: string[] = [];
  const { result, attempted } = await completeWithFallback(
    [slow('hung', 80, seen), fake('next', ok('next'), calls)],
    // 80ms of a 1,050ms budget leaves under MIN_ATTEMPT_MS: not worth starting.
    { ...REQ, timeoutMs: 8_000, deadlineMs: 1_050 },
  );
  assert.deepEqual(attempted, ['hung']);
  assert.deepEqual(calls, [], 'the next provider was never called');
  assert.equal(result.kind, 'failed', 'the caller ships its template');
});

test('without a deadline, the chain behaves as it always did', async () => {
  const seen: (number | undefined)[] = [];
  const { result } = await completeWithFallback([slow('first', 0, seen), fake('second', ok('second'))], {
    ...REQ,
    timeoutMs: 8_000,
  });
  assert.equal(seen[0], 8_000);
  assert.equal(result.kind, 'ok');
});
