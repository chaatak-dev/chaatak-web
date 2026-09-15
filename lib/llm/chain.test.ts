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
