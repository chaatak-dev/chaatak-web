/**
 * The pipeline, lifted out of the web route so Telegram can share it.
 *
 * These are the paths that need no network: they are where a question stops
 * before any fetch, and they must stop in the same place for every client.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { answerQuestion } from './answer';
import { ASK_FOR_LOCATION } from './scope';
import type { StandingQuery } from './types';

const base = { lang: 'en' as const, assistant: 'auto' as const, history: [], standing: null, coords: null };

test('a weather question with no place asks for one, and says so structurally', async () => {
  const { reply, chrome } = await answerQuestion({ ...base, question: 'will it rain tomorrow?' });
  assert.equal(reply.needsLocation, true);
  assert.equal(reply.text, ASK_FOR_LOCATION.en);
  assert.equal(chrome, 'en');
  assert.equal(reply.snapshot, undefined, 'nothing was fetched');
});

test('the question is answered in the script it was asked in', async () => {
  const { reply, chrome } = await answerQuestion({ ...base, question: 'कल बारिश होगी?' });
  assert.equal(reply.needsLocation, true);
  assert.equal(chrome, 'hi');
  assert.equal(reply.text, ASK_FOR_LOCATION.hi);
});

test('"near me" asks for a location even when the conversation has a place', async () => {
  const standing: StandingQuery = {
    place: 'Delhi',
    resolvedPlace: null,
    intent: 'current',
    timeWindow: { kind: 'now' },
    variable: 'all',
    setAt: new Date().toISOString(),
  };
  const { reply } = await answerQuestion({ ...base, question: 'weather near me', standing });
  assert.equal(reply.needsLocation, true);
});

test('a coordinate outside India is refused honestly, with no fetch', async () => {
  const { reply } = await answerQuestion({
    ...base,
    question: 'weather near me',
    coords: { latitude: 51.5, longitude: -0.12 },
  });
  assert.equal(reply.needsLocation, undefined);
  assert.match(reply.text, /outside India/);
  assert.equal(reply.snapshot, undefined);
});

test('an explicit assistant language decides the chrome, not the script', async () => {
  const { reply, chrome } = await answerQuestion({
    ...base,
    assistant: 'hi',
    question: 'will it rain tomorrow?',
  });
  assert.equal(chrome, 'hi');
  assert.equal(reply.text, ASK_FOR_LOCATION.hi);
});

test('the title is composed from the parse, for a caller that saves', async () => {
  const { title } = await answerQuestion({ ...base, question: 'will it rain tomorrow?' });
  assert.equal(title.question, 'will it rain tomorrow?');
  assert.equal(title.lang, 'en');
});
