import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  lastHours,
  lastRain,
  rainSpells,
  roundTenth,
  shiftIso,
  soFarOn,
  summariseDays,
} from './history';
import type { HistoryDay, HistoryHour } from './types';

/** Hourly series from a list of mm values, one per hour, ending 2026-09-22T20:00+05:30. */
function series(values: (number | null)[], end = '2026-09-22T20:00:00+05:30'): HistoryHour[] {
  return values.map((precipitation, i) => ({
    time: shiftIso(end, i - (values.length - 1)),
    precipitation,
    rain: precipitation,
    temperature: 25,
  }));
}

test('a lull shorter than three dry hours does not split a shower into two', () => {
  //          wet  wet  dry  dry  wet  | dry dry dry | wet
  const spells = rainSpells(series([2, 1.5, 0, 0, 0.5, 0, 0, 0, 3]));
  assert.equal(spells.length, 2);
  assert.equal(spells[0].total, 4);
  assert.equal(spells[0].wetHours, 3);
  assert.equal(spells[1].total, 3);
});

test('an hourly value is the hour BEFORE its label, so an event starts an hour early', () => {
  const hours = series([0, 0, 2.4, 0, 0, 0]);
  const [spell] = rainSpells(hours);
  // The 2.4 mm is labelled 17:00 and fell between 16:00 and 17:00.
  assert.equal(spell.end, '2026-09-22T17:00:00+05:30');
  assert.equal(spell.start, '2026-09-22T16:00:00+05:30');
});

test('the last hour above zero is not "the last rain"', () => {
  // Real rain, then a dry spell, then model drizzle-noise of 0.2 mm.
  const hours = series([4, 6.2, 1, 0, 0, 0, 0, 0, 0, 0, 0.2, 0, 0, 0]);
  const found = lastRain(hours);
  assert.ok(found.event);
  assert.equal(found.event.total, 11.2);
  // The trace is kept and reported as a trace, not as the last rain.
  assert.ok(found.traceSince);
  assert.equal(found.traceSince.total, 0.2);
});

test('a spell below the rain threshold on its own is not rain', () => {
  const found = lastRain(series([0, 0.3, 0.2, 0, 0, 0, 0]));
  assert.equal(found.event, null);
  assert.equal(found.traceSince?.total, 0.5);
});

test('"and before that?" walks back past the event already reported', () => {
  const hours = series([3, 2, 0, 0, 0, 0, 0, 5, 1, 0, 0, 0, 0]);
  const first = lastRain(hours);
  assert.ok(first.event);
  assert.equal(first.event.total, 6);

  const earlier = lastRain(hours, first.event.start);
  assert.ok(earlier.event);
  assert.equal(earlier.event.total, 5);
  assert.notEqual(earlier.event.start, first.event.start);

  const none = lastRain(hours, earlier.event.start);
  assert.equal(none.event, null);
});

test('rain still falling at the latest hour is ongoing', () => {
  const [spell] = rainSpells(series([0, 0, 1.2, 3.4]));
  assert.equal(spell.ongoing, true);
  const [over] = rainSpells(series([1.2, 3.4, 0, 0, 0]));
  assert.equal(over.ongoing, false);
});

test('a missing hour is unknown, never dry and never zero', () => {
  const spells = rainSpells(series([2, null, 3]));
  // The null ends the first spell honestly rather than bridging it.
  assert.equal(spells.length, 2);

  const sum = lastHours(series([1, null, 2]), 3);
  assert.equal(sum.total, 3);
  assert.equal(sum.missing, 1);
  assert.equal(sum.hours, 2);
});

test('the last 24 hours is the last 24 complete hours, at source precision', () => {
  const values = Array.from({ length: 30 }, (_, i) => (i >= 6 ? 0.1 : 5));
  const sum = lastHours(series(values), 24);
  // 24 × 0.1 without floating-point dust.
  assert.equal(sum.total, 2.4);
  assert.equal(sum.hours, 24);
  assert.equal(sum.to, '2026-09-22T20:00:00+05:30');
  assert.equal(sum.from, '2026-09-21T20:00:00+05:30');
});

test('today so far excludes the midnight hour, which belongs to yesterday', () => {
  const hours = series([9, 1, 2], '2026-09-22T02:00:00+05:30');
  // Labels: 00:00 (yesterday 23-24h), 01:00, 02:00.
  assert.equal(soFarOn(hours, '2026-09-22').total, 3);
});

function day(date: string, precipitationSum: number | null, maxTemp: number | null = 30, minTemp: number | null = 22): HistoryDay {
  return {
    date,
    conditionCode: 61,
    maxTemp,
    minTemp,
    precipitationSum,
    rainSum: precipitationSum,
    precipitationHours: 2,
    maxWind: 12,
  };
}

test('a span of days sums the upstream totals, and refuses a sum with a hole in it', () => {
  const days = [day('2026-09-16', 0), day('2026-09-17', 12.3), day('2026-09-18', 0.4, 35.1, 24)];
  const summary = summariseDays(days, '2026-09-16', '2026-09-18');
  assert.equal(summary.total, 12.7);
  assert.equal(summary.wetDays, 1);
  assert.deepEqual(summary.hottest, { date: '2026-09-18', value: 35.1 });

  const holed = summariseDays([...days, day('2026-09-19', null)], '2026-09-16', '2026-09-19');
  assert.equal(holed.total, null, 'a smaller number would be a smaller claim than the truth');

  // A day missing from the record entirely is the same hole.
  const short = summariseDays(days, '2026-09-15', '2026-09-18');
  assert.equal(short.total, null, 'three days of data is not a four-day total');
});

test('rounding is to the tenth the source reports', () => {
  assert.equal(roundTenth(0.1 + 0.2), 0.3);
  assert.equal(roundTenth(12.25), 12.3);
});

test('an instant moves by hours and keeps its own offset', () => {
  assert.equal(shiftIso('2026-09-22T00:00:00+05:30', -1), '2026-09-21T23:00:00+05:30');
  assert.equal(shiftIso('2026-09-22T00:00:00Z', 2), '2026-09-22T02:00:00Z');
});
