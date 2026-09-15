import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ageLabel, staleness } from './cache';
import type { CachedAnswer } from './cache';

/**
 * The staleness rule, which is the provenance rule wearing different clothes.
 * An old warning shown without its age is worse than no warning.
 */

const NOW = new Date('2026-09-15T17:10:00+05:30');

function entry(over: Partial<CachedAnswer> = {}): CachedAnswer {
  return {
    text: 'बाराबंकी में भारी बारिश की चेतावनी है।',
    lang: 'hi',
    issuedAt: '2026-09-15T16:30:00+05:30',
    cachedAt: '2026-09-15T16:31:00+05:30',
    validTo: '2026-09-15T22:00:00+05:30',
    grounding: {} as CachedAnswer['grounding'],
    ...over,
  };
}

test('age is computed from the issue time, at read', () => {
  // Stored age is the lie this guards: "40 minutes ago" written yesterday
  // still reads as 40 minutes today.
  assert.equal(staleness(entry(), NOW).ageMinutes, 40);

  const later = new Date('2026-09-16T17:10:00+05:30');
  assert.equal(staleness(entry(), later).ageMinutes, 40 + 24 * 60);
});

test('a warning inside its window is stale but not expired', () => {
  const s = staleness(entry(), NOW);
  assert.equal(s.expired, false);
  assert.equal(s.ageMinutes, 40);
});

test('a warning past its validity window is expired', () => {
  // The floor on staleness. An expired red warning shown offline reads as
  // live danger, so it stops being a warning and becomes noData.
  const s = staleness(entry({ validTo: '2026-09-15T16:30:00+05:30' }), NOW);
  assert.equal(s.expired, true);
});

test('an answer with no validity window never expires, only ages', () => {
  // An ordinary forecast has no window to elapse. It gets older; it does not
  // become dangerous.
  const s = staleness(entry({ validTo: null }), NOW);
  assert.equal(s.expired, false);
  assert.ok(s.ageMinutes > 0);
});

test('staleness has no ceiling', () => {
  const ancient = staleness(
    entry({ issuedAt: '2026-01-01T00:00:00+05:30', validTo: null }),
    NOW,
  );
  assert.ok(ancient.ageMinutes > 300_000);
  assert.equal(ancient.expired, false);
});

test('a clock skewed into the future reads as just now, never negative', () => {
  const s = staleness(entry({ issuedAt: '2026-09-15T18:00:00+05:30' }), NOW);
  assert.equal(s.ageMinutes, 0);
});

test('age reads in whichever unit is honest', () => {
  assert.equal(ageLabel(0, 'en'), 'just now');
  assert.equal(ageLabel(40, 'en'), '40 minutes ago');
  assert.equal(ageLabel(90, 'en'), '1 hours ago');
  assert.equal(ageLabel(60 * 30, 'en'), '1 days ago');

  assert.equal(ageLabel(0, 'hi'), 'अभी-अभी');
  assert.equal(ageLabel(40, 'hi'), '40 मिनट पहले');
  assert.equal(ageLabel(180, 'hi'), '3 घंटे पहले');
});
