/**
 * The weather card's ground.
 *
 * Boundaries are worth asserting because they are invisible when wrong: a
 * card that reads "night" at five in the afternoon looks like a rendering
 * bug and is actually an off-by-one in a comparison.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { conditionGroup, skyPhase } from './sky';

const IST = 'Asia/Kolkata';
const at = (iso: string) => new Date(iso);

test('the sky is read from the PLACE clock, not the reader clock', () => {
  // 03:00 UTC is 08:30 in India: morning there whatever time it is here.
  assert.equal(skyPhase(IST, at('2026-09-21T03:00:00Z')), 'day');
  // The same instant in London is the small hours.
  assert.equal(skyPhase('Europe/London', at('2026-09-21T03:00:00Z')), 'night');
});

test('the boundaries fall where they are documented', () => {
  // IST is UTC+5:30, so these UTC instants are 04:30, 07:30, 12:00 and 20:30
  // local — one safely inside each band, and two straddling a boundary.
  assert.equal(skyPhase(IST, at('2026-09-20T23:00:00Z')), 'night', '04:30 IST');
  assert.equal(skyPhase(IST, at('2026-09-21T02:00:00Z')), 'dawn', '07:30 IST');
  assert.equal(skyPhase(IST, at('2026-09-21T06:30:00Z')), 'day', '12:00 IST');
  assert.equal(skyPhase(IST, at('2026-09-21T13:00:00Z')), 'dusk', '18:30 IST');
  assert.equal(skyPhase(IST, at('2026-09-21T15:00:00Z')), 'night', '20:30 IST');
});

test('night, dawn, day and dusk are all reachable', () => {
  const seen = new Set<string>();
  for (let h = 0; h < 24; h += 1) {
    const utcHour = String((h + 24 - 6) % 24).padStart(2, '0');
    seen.add(skyPhase(IST, at(`2026-09-21T${utcHour}:00:00Z`)));
  }
  assert.deepEqual([...seen].sort(), ['dawn', 'day', 'dusk', 'night']);
});

test('an unusable timezone falls back to day rather than throwing', () => {
  assert.equal(skyPhase('Not/AZone'), 'day');
});

test('WMO codes group the way a person would see them', () => {
  assert.equal(conditionGroup(0), 'clear');
  assert.equal(conditionGroup(1), 'clear');
  assert.equal(conditionGroup(3), 'cloud');
  assert.equal(conditionGroup(45), 'cloud', 'fog looks like cloud from underneath');
  assert.equal(conditionGroup(61), 'wet');
  assert.equal(conditionGroup(80), 'wet');
  assert.equal(conditionGroup(95), 'storm');
  assert.equal(conditionGroup(99), 'storm');
});

test('an unknown condition is cloud, never clear', () => {
  // Defaulting to clear would paint a bright card over weather nobody could
  // identify, which is the optimistic direction and the wrong one.
  assert.equal(conditionGroup(null), 'cloud');
});
