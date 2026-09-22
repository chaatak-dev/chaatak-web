/**
 * Freshness, and the rule it exists to hold: a stale value is never current.
 *
 * Chaatak showed an IMD observation from 12:00 under a sentence beginning
 * "अभी" at six in the evening. Nothing was invented and every part of it was
 * individually true. These are the assertions that make that combination
 * impossible to ship again.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { freshness, isCurrent, meaningfulTime } from './freshness';
import type { Provenance } from './types';

const NOW = new Date('2026-09-21T18:00:00+05:30');

function provenance(over: Partial<Provenance> = {}): Provenance {
  return {
    source: 'Open-Meteo',
    endpoint: '/v1/forecast',
    issuedAt: '2026-09-21T17:45:00+05:30',
    timeBasis: 'updated',
    nature: 'model',
    ...over,
  };
}

test('a value refreshed minutes ago is live', () => {
  const f = freshness(provenance(), NOW);
  assert.equal(f.state, 'live');
  assert.equal(f.ageMinutes, 15);
  assert.equal(isCurrent(provenance(), NOW), true);
});

/*
 * The exact case that shipped. A three-hourly station observation, served
 * hours later by an endpoint that always returns the last row.
 */
test('the six-hour-old IMD observation is stale, not current', () => {
  const stale = provenance({
    source: 'IMD',
    nature: 'observation',
    issuedAt: '2026-09-21T12:00:00+05:30',
    observedAt: '2026-09-21T12:00:00+05:30',
    timeBasis: 'issued',
  });

  const f = freshness(stale, NOW);
  assert.equal(f.ageMinutes, 360);
  assert.equal(f.state, 'stale');
  assert.equal(isCurrent(stale, NOW), false, 'this must never be called "now"');
});

test('an observation within the synoptic cycle is still usable, and says its age', () => {
  const recent = provenance({
    nature: 'observation',
    issuedAt: '2026-09-21T16:30:00+05:30',
    observedAt: '2026-09-21T16:30:00+05:30',
  });

  const f = freshness(recent, NOW);
  assert.equal(f.ageMinutes, 90);
  assert.equal(f.state, 'ageing', 'old enough to mention, not old enough to hide');
  assert.equal(isCurrent(recent, NOW), true);
});

/*
 * Fetching is not observing. This is the substitution the whole module
 * exists to refuse: a value does not become current because we asked for it
 * a second ago.
 */
test('fetching a stale value does not make it fresh', () => {
  const stale = provenance({
    nature: 'observation',
    issuedAt: '2026-09-21T06:00:00+05:30',
    observedAt: '2026-09-21T06:00:00+05:30',
    fetchedAt: NOW.toISOString(),
  });

  assert.equal(freshness(stale, NOW).state, 'stale');
  assert.equal(meaningfulTime(stale), '2026-09-21T06:00:00+05:30');
  assert.notEqual(meaningfulTime(stale), stale.fetchedAt);
});

test('the age is measured from the observation, not from the issue time', () => {
  // A bulletin issued at 17:00 about an observation taken at 12:00 is five
  // hours of information, however recently it was written up.
  const p = provenance({
    nature: 'observation',
    issuedAt: '2026-09-21T17:00:00+05:30',
    observedAt: '2026-09-21T12:00:00+05:30',
  });

  assert.equal(freshness(p, NOW).ageMinutes, 360);
  assert.equal(freshness(p, NOW).state, 'stale');
});

test('a warning is not stale merely because it was issued this morning', () => {
  // Its age is not its validity. A red warning issued at 06:00 for a window
  // ending at 21:00 is in force, and dimming it as "old" would be the wrong
  // signal in the one place this product cannot afford one.
  const bulletin = provenance({
    source: 'IMD',
    nature: 'bulletin',
    issuedAt: '2026-09-21T06:00:00+05:30',
    timeBasis: 'issued',
  });

  // Twelve hours on it is worth mentioning the age; it is never "stale", and
  // it never stops counting as in force.
  assert.notEqual(freshness(bulletin, NOW).state, 'stale');
  assert.equal(isCurrent(bulletin, NOW), true);
});

test('a value with no usable timestamp is stale, never assumed live', () => {
  const broken = provenance({ issuedAt: 'not a date', observedAt: null });
  assert.equal(freshness(broken, NOW).state, 'stale');
  assert.equal(isCurrent(broken, NOW), false);
});

test('a value stamped in the future is not given a negative age', () => {
  const ahead = provenance({ issuedAt: '2026-09-21T19:00:00+05:30' });
  assert.equal(freshness(ahead, NOW).ageMinutes, 0);
  assert.equal(freshness(ahead, NOW).state, 'live');
});

test('a value with no declared nature is held to the strictest threshold', () => {
  // Records written before `nature` existed. Assuming the loosest limit would
  // let exactly the wrong kind of value through.
  const old = provenance({ nature: undefined, issuedAt: '2026-09-21T14:30:00+05:30' });
  assert.equal(freshness(old, NOW).ageMinutes, 210);
  assert.equal(freshness(old, NOW).state, 'stale');
});
