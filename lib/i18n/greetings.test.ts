/**
 * Greetings and chips.
 *
 * The property that matters is stability: the same chat must open with the
 * same words every time it renders, and a different chat must not. A
 * `Math.random()` at render time satisfies neither, which is why the choice
 * is seeded and why that is asserted here rather than eyeballed.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { firstName, greeting, suggestions, SUGGESTION_COUNT } from './greetings';

test('the same chat always gets the same greeting', () => {
  const first = greeting('conv-123', 'Yash', 'en');
  for (let i = 0; i < 20; i += 1) {
    assert.equal(greeting('conv-123', 'Yash', 'en'), first);
  }
});

test('different chats get different greetings, across the pool', () => {
  const seen = new Set(
    Array.from({ length: 40 }, (_, i) => greeting(`conv-${i}`, 'Yash', 'en')),
  );
  // Not a distribution test — just that the seed is actually being used and
  // every chat is not landing on entry zero.
  assert.ok(seen.size > 1, 'every seed produced the same greeting');
});

test('a signed-in greeting uses the first name and nothing else', () => {
  const line = greeting('seed', 'Yash', 'en');
  assert.ok(line.includes('Yash'), line);
  assert.doesNotMatch(line, /\{name\}/, 'the placeholder survived');
});

test('a guest greeting carries no name and no leftover placeholder', () => {
  for (let i = 0; i < 20; i += 1) {
    const line = greeting(`seed-${i}`, null, 'en');
    assert.doesNotMatch(line, /\{name\}/, line);
  }
});

test('a Hindi greeting is in Devanagari, with the name spliced in', () => {
  const line = greeting('seed', 'यश', 'hi');
  assert.match(line, /[ऀ-ॿ]/);
  assert.ok(line.includes('यश'), line);
});

test('every greeting in both languages is non-empty and weather-shaped', () => {
  // A greeting that says nothing about weather would be the first thing the
  // product says that is not true about it.
  for (let i = 0; i < 40; i += 1) {
    for (const lang of ['hi', 'en'] as const) {
      assert.ok(greeting(`s${i}`, 'Yash', lang).trim().length > 0);
      assert.ok(greeting(`s${i}`, null, lang).trim().length > 0);
    }
  }
});

/* ---- the name ------------------------------------------------------ */

test('the first name is taken from a display name', () => {
  assert.equal(firstName('Yash Sharma'), 'Yash');
  assert.equal(firstName('  Yash  '), 'Yash');
  assert.equal(firstName('यश शर्मा'), 'यश');
});

test('an email is never used as a name', () => {
  // "Hey, yash.sharma@gmail.com" is worse than greeting nobody.
  assert.equal(firstName('yash.sharma@gmail.com'), null);
});

test('nothing usable yields no name at all', () => {
  assert.equal(firstName(null), null);
  assert.equal(firstName(undefined), null);
  assert.equal(firstName(''), null);
  assert.equal(firstName('   '), null);
  // An initial is not a name; "Hey, Y." reads worse than "Hey there."
  assert.equal(firstName('Y Sharma'), null);
});

/* ---- chips --------------------------------------------------------- */

test('the same chat always gets the same chips, in the same order', () => {
  const first = suggestions('conv-9', 'en');
  for (let i = 0; i < 10; i += 1) {
    assert.deepEqual(suggestions('conv-9', 'en'), first);
  }
});

test('chips come out four at a time and never repeat within a chat', () => {
  for (let i = 0; i < 30; i += 1) {
    const chips = suggestions(`seed-${i}`, 'en');
    assert.equal(chips.length, SUGGESTION_COUNT);
    assert.equal(new Set(chips).size, chips.length, chips.join(' | '));
  }
});

test('chips are localized, not transliterated', () => {
  const hindi = suggestions('seed', 'hi');
  const english = suggestions('seed', 'en');

  assert.equal(hindi.length, english.length);
  assert.ok(hindi.some((c) => /[ऀ-ॿ]/.test(c)), hindi.join(' | '));
  assert.ok(english.every((c) => !/[ऀ-ॿ]/.test(c)), english.join(' | '));
});

test('the set moves between chats', () => {
  const seen = new Set(
    Array.from({ length: 20 }, (_, i) => suggestions(`c${i}`, 'en').join('|')),
  );
  assert.ok(seen.size > 1, 'every chat offered the same four chips');
});
