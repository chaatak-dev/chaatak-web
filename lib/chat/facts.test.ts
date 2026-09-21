import { test } from 'node:test';
import assert from 'node:assert/strict';

import { warningFacts } from './facts';
import type { DistrictId, NoData, NoWarning, Warning } from '../weather/types';

const DISTRICT = 'Nicobar' as DistrictId;

function warning(severity: Warning['severity'], code: string, day: string): Warning {
  return {
    kind: 'warning',
    id: `imd:573:${day}`,
    code,
    severity,
    district: DISTRICT,
    validFrom: `${day}T00:00:00+05:30`,
    validTo: `${day}T23:59:59+05:30`,
    provenance: {
      source: 'IMD',
      endpoint: '/api/v1/districtwarning',
      issuedAt: '2026-09-21T09:14:06.000Z',
      timeBasis: 'issued',
    },
  };
}

const NO_WARNING: NoWarning = {
  kind: 'noWarning',
  source: 'IMD',
  endpoint: '/api/v1/districtwarning',
  issuedAt: '2026-09-21T07:25:49.000Z',
  checkedAt: '2026-09-21T10:00:00.000Z',
  timeBasis: 'issued',
};

const NO_DATA: NoData = {
  kind: 'noData',
  reason: 'lookupFailed',
  source: 'IMD',
  endpoint: '/api/v1/districtwarning',
  checkedAt: '2026-09-21T10:00:00.000Z',
  statement: { hi: 'IMD से संपर्क नहीं हो सका।', en: 'IMD could not be reached.' },
};

/* ---- the regression this exists for ----------------------------------- */

test('warnings in force reach the model, not just the severity check', () => {
  // The bug: severity was computed for the advice check and never handed to
  // the renderer, so chat said "no official warnings are listed" while five
  // real IMD watches were in force.
  const facts = warningFacts(
    [warning('watch', '2,4,8', '2026-09-21'), warning('watch', '4,8', '2026-09-22')],
    'en',
  );
  assert.ok('inForce' in facts);
  assert.equal(facts.inForce.length, 2);
  assert.equal(facts.inForce[0].severity, 'watch');
  assert.equal(facts.inForce[0].code, '2,4,8');
  assert.equal(facts.inForce[1].code, '4,8');
});

test('the warning carries its own source, not the one that supplied the temperature', () => {
  // Readings may come from elsewhere. One provenance cannot stand for both,
  // or an IMD warning ends up attributed to whoever gave us the temperature.
  const facts = warningFacts([warning('alert', '4', '2026-09-21')], 'en');
  assert.ok('inForce' in facts);
  assert.equal(facts.source, 'IMD');
  assert.equal(facts.issuedAt, '2026-09-21T09:14:06.000Z');
});

/* ---- the distinction that matters most -------------------------------- */

test('nothing in force is an empty list, and says who checked', () => {
  const facts = warningFacts(NO_WARNING, 'en');
  assert.ok('inForce' in facts);
  assert.deepEqual(facts.inForce, []);
  assert.equal(facts.source, 'IMD');
  assert.equal(facts.issuedAt, '2026-09-21T07:25:49.000Z');
});

test('not knowing is NOT an empty list', () => {
  // Collapsing "we could not reach IMD" into "nothing is in force" turns a
  // lookup failure into an all-clear. Silence about a cyclone is the
  // dangerous direction, so the two shapes are deliberately different.
  const facts = warningFacts(NO_DATA, 'en');
  assert.ok(!('inForce' in facts));
  assert.ok('unavailable' in facts);
  assert.match(facts.unavailable, /could not be reached/i);
});

test('the unavailable statement is written in the language of the answer', () => {
  assert.match((warningFacts(NO_DATA, 'hi') as { unavailable: string }).unavailable, /IMD/);
  assert.notEqual(
    (warningFacts(NO_DATA, 'hi') as { unavailable: string }).unavailable,
    (warningFacts(NO_DATA, 'en') as { unavailable: string }).unavailable,
  );
});

/* ---- severity is reported, never reinterpreted ------------------------ */

test('every severity level passes through exactly as issued', () => {
  for (const level of ['none', 'watch', 'alert', 'warning'] as const) {
    const facts = warningFacts([warning(level, '4', '2026-09-21')], 'en');
    assert.ok('inForce' in facts);
    assert.equal(facts.inForce[0].severity, level, level);
  }
});

test('the validity window survives, so a day can be named', () => {
  const facts = warningFacts([warning('watch', '4,8', '2026-09-25')], 'en');
  assert.ok('inForce' in facts);
  assert.equal(facts.inForce[0].validFrom, '2026-09-25T00:00:00+05:30');
  assert.equal(facts.inForce[0].validTo, '2026-09-25T23:59:59+05:30');
});

test('an empty warning array is still "nothing in force", not "unknown"', () => {
  const facts = warningFacts([], 'en');
  assert.ok('inForce' in facts);
  assert.deepEqual(facts.inForce, []);
  // No warnings means no provenance to borrow; null rather than invented.
  assert.equal(facts.source, null);
});
