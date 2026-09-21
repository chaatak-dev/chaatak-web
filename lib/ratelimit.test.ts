/**
 * The mutation guard.
 *
 * The clock is injected on every call, so these are exact rather than timed —
 * a rate-limit test that sleeps is a test that fails on a slow machine.
 */

import { strict as assert } from 'node:assert';
import test, { beforeEach } from 'node:test';
import { LIMITS, rateLimit, resetRateLimits } from './ratelimit';

beforeEach(() => resetRateLimits());

test('attempts inside the limit are allowed', () => {
  for (let i = 0; i < 5; i += 1) {
    assert.equal(rateLimit('k', 5, 1000, 0).ok, true, `attempt ${i + 1}`);
  }
});

test('the attempt past the limit is refused', () => {
  for (let i = 0; i < 5; i += 1) rateLimit('k', 5, 1000, 0);
  assert.equal(rateLimit('k', 5, 1000, 0).ok, false);
});

test('a refusal says how long to wait', () => {
  for (let i = 0; i < 5; i += 1) rateLimit('k', 5, 10_000, 0);
  const refused = rateLimit('k', 5, 10_000, 2_000);

  assert.equal(refused.ok, false);
  assert.equal(refused.retryAfter, 8);
});

test('the window resets', () => {
  for (let i = 0; i < 5; i += 1) rateLimit('k', 5, 1000, 0);
  assert.equal(rateLimit('k', 5, 1000, 0).ok, false);
  assert.equal(rateLimit('k', 5, 1000, 1001).ok, true);
});

/*
 * Keys are per user per action. One person hitting the location limit must
 * not stop anyone else — or stop themselves from renaming a chat.
 */
test('one key does not spend another key budget', () => {
  for (let i = 0; i < 5; i += 1) rateLimit('locations:alice', 5, 1000, 0);

  assert.equal(rateLimit('locations:alice', 5, 1000, 0).ok, false);
  assert.equal(rateLimit('locations:bob', 5, 1000, 0).ok, true);
  assert.equal(rateLimit('conversations:alice', 5, 1000, 0).ok, true);
});

test('the configured limits are loose enough for ordinary use', () => {
  // Someone saving three places, renaming two chats and asking a dozen
  // questions in a minute is using the product. A limiter that catches them
  // is a bug, so the floor is asserted rather than left to judgement.
  assert.ok(LIMITS.locations.limit >= 10);
  assert.ok(LIMITS.conversations.limit >= 30);
  assert.ok(LIMITS.destructive.limit >= 3);

  for (const limit of Object.values(LIMITS)) {
    assert.ok(limit.windowMs > 0);
    assert.ok(limit.limit > 0);
  }
});
