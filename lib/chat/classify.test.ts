import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toPlan, verbatimPlace } from './classify';
import type { StandingQuery } from './types';

/**
 * The classifier is the exception path, and its output is checked, not
 * trusted: a place it returns must be a slice of what the person wrote.
 */

const ctx = (standing: StandingQuery | null = null) => ({ standing, today: '2026-09-22' });

const raw = {
  act: 'weather' as const,
  social: '' as const,
  place: '',
  placeIsHere: false,
  usesContext: false,
  topic: '' as const,
  dayOffset: 0,
  pastDays: 0,
  pastHours: 0,
  date: '',
  lastRain: false,
  beforePrevious: false,
  variable: '' as const,
};

test('a place the person did not write is dropped, not resolved', () => {
  // The model "helpfully" transliterated. The resolver never sees its spelling.
  assert.equal(verbatimPlace('गाज़ियाबाद में बारिश', 'Ghaziabad'), null);
  assert.equal(verbatimPlace('will it rain tomorrow', 'Delhi'), null, 'an invented place');
  // Case aside, the person's own spelling comes back — not the model's.
  assert.equal(verbatimPlace('rain in rampur khas?', 'Rampur Khas'), 'rampur khas');

  const plan = toPlan({ ...raw, place: 'Ghaziabad', topic: 'current' }, 'गाज़ियाबाद में बारिश', ctx());
  assert.equal(plan.act, 'weather');
  if (plan.act !== 'weather') return;
  assert.deepEqual(plan.place, { kind: 'none' }, 'no verbatim place, nothing carried: ask');
});

test('a social or out-of-scope reading is never a place', () => {
  assert.deepEqual(toPlan({ ...raw, act: 'social', social: 'reaction', place: 'ohh really' }, 'ohh really', ctx()), {
    act: 'social',
    kind: 'reaction',
  });
  assert.deepEqual(toPlan({ ...raw, act: 'outOfScope' }, 'write me a poem', ctx()), { act: 'outOfScope' });
});

test('history readings map to past windows', () => {
  const last = toPlan({ ...raw, topic: 'history', lastRain: true, place: 'Pune' }, 'kab barsa tha Pune mein', ctx());
  assert.equal(last.act === 'weather' && last.intent, 'history');
  assert.deepEqual(last.act === 'weather' && last.window, { kind: 'lastEvent' });

  const days = toPlan({ ...raw, topic: 'history', pastDays: 10 }, 'das din ka hisaab', ctx());
  assert.deepEqual(days.act === 'weather' && days.window, { kind: 'past', days: 10 });
});

test('a follow-up inherits what it does not say', () => {
  const standing: StandingQuery = {
    place: 'Lucknow',
    resolvedPlace: null,
    intent: 'forecast',
    timeWindow: { kind: 'day', offset: 1 },
    variable: 'rain',
    setAt: '2026-09-22T00:00:00Z',
  };
  const plan = toPlan({ ...raw, usesContext: true, variable: 'wind' }, 'aur hawa ka kya scene', ctx(standing));
  assert.equal(plan.act, 'weather');
  if (plan.act !== 'weather') return;
  assert.deepEqual(plan.place, { kind: 'carried' });
  assert.deepEqual(plan.window, { kind: 'day', offset: 1 });
  assert.equal(plan.variable, 'wind');
});

test('a wild offset from the model is bounded', () => {
  const plan = toPlan({ ...raw, topic: 'forecast', dayOffset: 400 }, 'kabhi bhi', ctx());
  assert.deepEqual(plan.act === 'weather' && plan.window, { kind: 'day', offset: 15 });
});
