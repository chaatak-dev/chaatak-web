import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS, boundContext } from './context';
import type { Message } from './types';

/**
 * What must survive trimming, and what must go first.
 *
 * The rule being guarded: standing state and the current turn's facts are
 * never dropped, because they are what make the answer correct and they are
 * small. History is what gets cut, oldest-first, in whole messages.
 */

let n = 0;
function msg(role: Message['role'], text: string): Message {
  n += 1;
  return { id: `m${n}`, role, text, lang: 'hi', at: '2026-09-15T10:00:00+05:30' };
}

function exchange(count: number, size = 20): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < count; i++) {
    out.push(msg('user', `u${i}`.padEnd(size, 'x')));
    out.push(msg('assistant', `a${i}`.padEnd(size, 'y')));
  }
  return out;
}

const STANDING = {
  place: 'बाराबंकी',
  resolvedPlace: null,
  intent: 'forecast' as const,
  timeWindow: { kind: 'day' as const, offset: 2 },
  variable: 'rain' as const,
  setAt: '2026-09-15T10:00:00+05:30',
};

test('short conversations pass through untouched', () => {
  const messages = exchange(2);
  const ctx = boundContext(messages, STANDING, null);

  assert.equal(ctx.history.length, 4);
  assert.equal(ctx.standing?.place, 'बाराबंकी');
});

test('history is trimmed oldest-first, in whole messages', () => {
  const messages = exchange(LIMITS.maxTurns);
  const ctx = boundContext(messages, STANDING, null);

  assert.ok(ctx.history.length <= LIMITS.maxTurns);
  // The most recent turn always survives; the oldest is what went.
  assert.equal(ctx.history.at(-1)?.text, messages.at(-1)?.text);
  assert.notEqual(ctx.history[0]?.text, messages[0]?.text);
});

test('the character budget is respected', () => {
  const messages = exchange(10, 2000);
  const ctx = boundContext(messages, STANDING, null);

  const chars = ctx.history.reduce((sum, t) => sum + t.text.length, 0);
  assert.ok(
    chars <= LIMITS.maxChars,
    `history was ${chars} chars, budget is ${LIMITS.maxChars}`,
  );
});

test('standing state survives even when history is cut to nothing', () => {
  // Standing state is tiny and is what makes "और अगले दिन?" resolvable, so it
  // is never what gets dropped to save room.
  const messages = exchange(30, 4000);
  const ctx = boundContext(messages, STANDING, null);

  assert.equal(ctx.standing?.place, 'बाराबंकी');
  assert.equal(ctx.standing?.variable, 'rain');
});

test('the newest message is kept whole, truncating an older one instead', () => {
  const huge = [msg('user', 'old'.repeat(5000)), msg('user', 'the newest question')];
  const ctx = boundContext(huge, STANDING, null);

  assert.equal(ctx.history.at(-1)?.text, 'the newest question');
});

test('only the current turn\'s facts are carried', () => {
  // The whole point: a number from an earlier turn must not be in the set the
  // gate checks against, or this morning's reading passes as current.
  const facts = { current: { temperature: 25.2 } };
  const ctx = boundContext(exchange(3), STANDING, facts);

  assert.deepEqual(ctx.facts, facts);

  const none = boundContext(exchange(3), STANDING, null);
  assert.equal(none.facts, null);
});

test('no standing state is a valid starting point', () => {
  const ctx = boundContext(exchange(1), null, null);
  assert.equal(ctx.standing, null);
});
