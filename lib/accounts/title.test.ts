/**
 * Conversation titles.
 *
 * The property that matters most is the one that is easiest to lose: a title
 * is made from a parse that already happened, so naming a conversation costs
 * nothing and calls no model. Every case below is pure — there is nothing to
 * stub, because there is nothing to call.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { conversationTitle, UNTITLED } from './title';

test('a place and a variable become the label', () => {
  assert.equal(
    conversationTitle({
      question: "What's the temperature in Delhi?",
      place: 'Delhi',
      intent: 'current',
      timeWindow: { kind: 'now' },
      variable: 'temperature',
      lang: 'en',
    }),
    'Delhi temperature',
  );
});

test('a future day is named', () => {
  assert.equal(
    conversationTitle({
      question: 'Will it rain in Ghaziabad tomorrow?',
      place: 'Ghaziabad',
      intent: 'forecast',
      timeWindow: { kind: 'day', offset: 1 },
      variable: 'rain',
      lang: 'en',
    }),
    'Ghaziabad rain tomorrow',
  );
});

test('today adds nothing, because every question is about now', () => {
  assert.equal(
    conversationTitle({
      question: 'aaj Nashik mein kitna garam hai',
      place: 'Nashik',
      intent: 'current',
      timeWindow: { kind: 'day', offset: 0 },
      variable: 'temperature',
      lang: 'en',
    }),
    'Nashik temperature',
  );
});

test('a warning question says so', () => {
  assert.equal(
    conversationTitle({
      question: 'any warnings for Barabanki',
      place: 'Barabanki',
      intent: 'warning',
      timeWindow: { kind: 'now' },
      variable: 'all',
      lang: 'en',
    }),
    'Barabanki warning',
  );
});

/*
 * The script rule, in a title. Devanagari in, Devanagari out — the recent
 * list is the person's own, and switching script on them there is the same
 * failure as switching it in an answer.
 */
test('a Hindi question gets a Hindi title, in Devanagari', () => {
  const title = conversationTitle({
    question: 'बाराबंकी में कल बारिश होगी?',
    place: 'बाराबंकी',
    intent: 'forecast',
    timeWindow: { kind: 'day', offset: 1 },
    variable: 'rain',
    lang: 'hi',
  });

  assert.equal(title, 'बाराबंकी बारिश कल');
  assert.match(title, /[ऀ-ॿ]/);
  assert.doesNotMatch(title, /[A-Za-z]/);
});

test('a range is counted in days', () => {
  assert.equal(
    conversationTitle({
      question: 'rain in Jaipur this week',
      place: 'Jaipur',
      intent: 'forecast',
      timeWindow: { kind: 'range', days: 7 },
      variable: 'rain',
      lang: 'en',
    }),
    'Jaipur rain 7 days',
  );
});

/*
 * A place on its own says nothing about what was asked. The question does, so
 * the question wins — a sidebar full of rows called "Delhi" is a sidebar
 * nobody can navigate.
 */
test('a place with nothing else falls back to the question', () => {
  assert.equal(
    conversationTitle({
      question: 'Delhi ka mausam kaisa hai',
      place: 'Delhi',
      intent: 'current',
      timeWindow: { kind: 'now' },
      variable: 'all',
      lang: 'en',
    }),
    'Delhi ka mausam kaisa hai',
  );
});

test('no place at all still produces the question', () => {
  assert.equal(
    conversationTitle({
      question: 'what does orange alert mean?',
      place: null,
      lang: 'en',
    }),
    'what does orange alert mean',
  );
});

test('trailing punctuation goes, including the Devanagari full stop', () => {
  assert.equal(
    conversationTitle({ question: 'आज बारिश होगी।', place: null, lang: 'hi' }),
    'आज बारिश होगी',
  );
});

test('whitespace collapses rather than being preserved', () => {
  assert.equal(
    conversationTitle({ question: '  kal   barish \n hogi  ', place: null, lang: 'en' }),
    'kal barish hogi',
  );
});

test('a long question is clamped at a word boundary', () => {
  const question =
    'should I go out this evening or wait until the rain has completely stopped';
  const title = conversationTitle({ question, place: null, lang: 'en' });

  assert.ok(title.length <= 49, `too long: ${title.length}`);
  assert.ok(title.endsWith('…'));

  // The kept part is a prefix of the question, and it ends where a word ends
  // — the next character in the original is a space, never a letter.
  const body = title.slice(0, -1);
  assert.ok(question.startsWith(body), `not a prefix: ${body}`);
  assert.equal(question.charAt(body.length), ' ');
});

test('an empty question produces an empty title rather than an invention', () => {
  assert.equal(conversationTitle({ question: '   ', place: null, lang: 'en' }), '');
});

test('the untitled label exists in both interface languages', () => {
  assert.equal(typeof UNTITLED.hi, 'string');
  assert.equal(typeof UNTITLED.en, 'string');
  assert.match(UNTITLED.hi, /[ऀ-ॿ]/);
});
