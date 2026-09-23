import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addDays, daysBetween, isPastWindow, readDate, readTime } from './time';

/** A Tuesday, so weekday arithmetic has something to be wrong about. */
const TODAY = '2026-09-22';

function window(text: string) {
  return readTime(text, TODAY).window;
}

test('कल is yesterday in the past tense and tomorrow otherwise', () => {
  assert.deepEqual(window('कल बारिश हुई थी क्या?'), { kind: 'day', offset: -1 });
  assert.deepEqual(window('कल बारिश होगी क्या?'), { kind: 'day', offset: 1 });
  assert.deepEqual(window('kal baarish hui thi?'), { kind: 'day', offset: -1 });
  assert.deepEqual(window('kal baarish hogi?'), { kind: 'day', offset: 1 });
  // No verb at all: a weather service is asked about tomorrow.
  assert.deepEqual(window('और कल?'), { kind: 'day', offset: 1 });
  assert.deepEqual(window('कल का मौसम'), { kind: 'day', offset: 1 });
  assert.deepEqual(window('कल का मौसम कैसा था?'), { kind: 'day', offset: -1 });
});

test('परसों goes both ways too', () => {
  assert.deepEqual(window('परसों बारिश हुई थी'), { kind: 'day', offset: -2 });
  assert.deepEqual(window('परसों बारिश होगी'), { kind: 'day', offset: 2 });
});

test('"when did it last rain" is a last-event question, in every register', () => {
  for (const q of [
    'last baarish kab hui thi ghaziabad mein',
    'baarish kab hui thi?',
    'when did it last rain?',
    'when did it rain here last?',
    'बारिश कब हुई थी?',
    'आखिरी बार बारिश कब हुई?',
  ]) {
    const r = readTime(q, TODAY);
    assert.equal(r.lastEvent, true, q);
    assert.equal(r.past, true, q);
  }
});

test('"when will it rain" is not a last-event question', () => {
  const r = readTime('when will it rain?', TODAY);
  assert.equal(r.lastEvent, false);
  assert.equal(r.past, false);
  // "before" says earlier-than, not the past.
  assert.equal(readTime('will it rain before evening?', TODAY).past, false);
});

test('spans of the past', () => {
  assert.deepEqual(window('rainfall in the last 24 hours'), { kind: 'pastHours', hours: 24 });
  assert.deepEqual(window('pichhle 24 ghante mein kitni baarish'), { kind: 'pastHours', hours: 24 });
  assert.deepEqual(window('पिछले 24 घंटे में बारिश'), { kind: 'pastHours', hours: 24 });
  assert.deepEqual(window('rainfall in the last 7 days'), { kind: 'past', days: 7 });
  assert.deepEqual(window('पिछले 7 दिन में कितनी बारिश हुई'), { kind: 'past', days: 7 });
  assert.deepEqual(window('how much did it rain last week?'), { kind: 'past', days: 7 });
  assert.deepEqual(window('weather last week'), { kind: 'past', days: 7 });
  assert.deepEqual(window('pichhle hafte baarish hui?'), { kind: 'past', days: 7 });
});

test('a span is bounded, so one question cannot ask for a year of hours', () => {
  assert.deepEqual(window('last 400 days'), { kind: 'past', days: 31 });
  assert.deepEqual(window('last 500 hours'), { kind: 'pastHours', hours: 72 });
});

test('yesterday, and the day before', () => {
  assert.deepEqual(window('temperature yesterday'), { kind: 'day', offset: -1 });
  assert.deepEqual(window('what was the weather yesterday?'), { kind: 'day', offset: -1 });
  assert.deepEqual(window('rain day before yesterday'), { kind: 'day', offset: -2 });
  assert.deepEqual(window('3 days ago'), { kind: 'date', date: '2026-09-19' });
  assert.deepEqual(window('2 din pehle baarish hui thi?'), { kind: 'day', offset: -2 });
});

test('last night is the last 24 hours; tomorrow night is not', () => {
  assert.deepEqual(window('did it rain last night?'), { kind: 'pastHours', hours: 24 });
  assert.deepEqual(window('कल रात बारिश हुई थी?'), { kind: 'pastHours', hours: 24 });
  assert.deepEqual(window('कल रात बारिश होगी?'), { kind: 'day', offset: 1 });
  assert.deepEqual(window('will it rain overnight?'), null);
});

test('a named date, in three scripts of writing it', () => {
  assert.deepEqual(window('rainfall on 15 August'), { kind: 'date', date: '2026-08-15' });
  assert.deepEqual(window('how much did it rain on August 15?'), { kind: 'date', date: '2026-08-15' });
  assert.deepEqual(window('15 अगस्त को बारिश हुई थी?'), { kind: 'date', date: '2026-08-15' });
  assert.deepEqual(window('rain on 15/08/2025'), { kind: 'date', date: '2025-08-15' });
  assert.deepEqual(window('2026-07-01 ka mausam'), { kind: 'date', date: '2026-07-01' });
});

test('a yearless date takes its direction from the tense', () => {
  // Past tense: the last one that has happened.
  assert.equal(readDate('25 December', TODAY, 'past'), '2025-12-25');
  // Future tense: the next one.
  assert.equal(readDate('25 December', TODAY, 'future'), '2026-12-25');
  // No tense: the nearer.
  assert.equal(readDate('25 December', TODAY, 'either'), '2026-12-25');
  assert.equal(readDate('1 September', TODAY, 'either'), '2026-09-01');
  // Not a date at all.
  assert.equal(readDate('31 September', TODAY, 'past'), null);
  assert.equal(readDate('10 mm of rain', TODAY, 'past'), null);
});

test('weekdays: the last one in the past tense, the next one otherwise', () => {
  // 22 Sep 2026 is a Tuesday.
  assert.deepEqual(window('did it rain on Sunday?'), { kind: 'day', offset: -2 });
  assert.deepEqual(window('will it rain on Friday?'), { kind: 'day', offset: 3 });
  assert.deepEqual(window('is the sun out?'), null, '"sun" is not Sunday');
});

test('the future and the present are still read', () => {
  assert.deepEqual(window('weather tomorrow'), { kind: 'day', offset: 1 });
  assert.deepEqual(window('इस हफ़्ते बारिश'), { kind: 'range', days: 7 });
  assert.deepEqual(window('aaj ka mausam'), { kind: 'day', offset: 0 });
  assert.deepEqual(window('abhi kaisa hai'), { kind: 'now' });
  assert.equal(window('lucknow'), null);
});

test('"and before that?" is recognised in every register', () => {
  for (const q of ['and before that?', 'usse pehle?', 'उससे पहले?', 'what about before that']) {
    assert.equal(readTime(q, TODAY).beforeThat, true, q);
  }
});

test('Devanagari digits are read as digits', () => {
  assert.deepEqual(window('पिछले ७ दिन'), { kind: 'past', days: 7 });
});

test('calendar arithmetic', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-09-20', '2026-09-22'), 2);
  assert.equal(isPastWindow({ kind: 'date', date: '2026-09-01' }, TODAY), true);
  assert.equal(isPastWindow({ kind: 'date', date: '2026-12-25' }, TODAY), false);
});
