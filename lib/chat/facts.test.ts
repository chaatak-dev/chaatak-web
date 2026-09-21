import { test } from 'node:test';
import assert from 'node:assert/strict';

import { warningFacts } from './facts';
import type { DistrictId, NoData, NoWarning, Warning } from '../weather/types';

const DISTRICT = 'Nicobar' as DistrictId;

function warning(
  severity: Warning['severity'],
  code: string,
  from: string,
  to = from,
): Warning {
  return {
    kind: 'warning',
    id: `imd:573:${from}`,
    code,
    severity,
    district: DISTRICT,
    validFrom: `${from}T00:00:00+05:30`,
    validTo: `${to}T00:00:00+05:30`,
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

/* ---- warnings reach the model at all ---------------------------------- */

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
});

test('the warning carries its own source, not the one that supplied the temperature', () => {
  const facts = warningFacts([warning('alert', '4', '2026-09-21')], 'en');
  assert.ok('inForce' in facts);
  assert.equal(facts.source, 'IMD');
});

/* ---- hazard codes become words ---------------------------------------- */

test('IMD code numbers are replaced by IMD own words', () => {
  // Chat used to read out "codes 2, 4 and 8", which means nothing to anyone.
  // The words come from IMD's published code table, never from a guess.
  const facts = warningFacts([warning('watch', '2,4,8', '2026-09-21')], 'en');
  assert.ok('inForce' in facts);
  assert.deepEqual(facts.inForce[0].hazards, [
    'Heavy Rain',
    'Thunderstorm & Lightning, Squall etc',
    'Strong Surface Winds',
  ]);
});

test('the hazards are named in the language of the answer', () => {
  const facts = warningFacts([warning('warning', '17', '2026-09-21')], 'hi');
  assert.ok('inForce' in facts);
  assert.deepEqual(facts.inForce[0].hazards, ['अत्यधिक भारी वर्षा']);
});

test('code 1 is not a hazard, because it means no warning', () => {
  const facts = warningFacts([warning('watch', '1,2', '2026-09-21')], 'en');
  assert.ok('inForce' in facts);
  assert.deepEqual(facts.inForce[0].hazards, ['Heavy Rain']);
});

test('a code IMD has not published is reported, never dropped or guessed', () => {
  // An unrecognised code means IMD is saying something this build does not
  // understand. Losing it silently would hide a hazard.
  const facts = warningFacts([warning('alert', '4,99', '2026-09-21')], 'en');
  assert.ok('inForce' in facts);
  assert.deepEqual(facts.inForce[0].hazards, ['Thunderstorm & Lightning, Squall etc']);
  assert.deepEqual(facts.inForce[0].unrecognisedCodes, ['99']);
});

/* ---- timestamps a person can read ------------------------------------- */

test('validity is an IST date, not a machine timestamp', () => {
  // Chat used to read out "2026-09-21T00:00:00+05:30" aloud.
  const facts = warningFacts([warning('watch', '2', '2026-09-21')], 'en');
  assert.ok('inForce' in facts);
  // Month abbreviation follows the platform's CLDR data ("Sep" or "Sept"),
  // so the assertion pins the parts that matter and not that spelling.
  assert.match(facts.inForce[0].when, /^21 Sept? 2026$/);
  assert.ok(!JSON.stringify(facts).includes('T00:00:00'), 'an ISO stamp leaked through');
});

test('a window spanning two days says both', () => {
  const facts = warningFacts([warning('alert', '2', '2026-09-21', '2026-09-22')], 'en');
  assert.ok('inForce' in facts);
  assert.match(facts.inForce[0].when, /^21 Sept? 2026 to 22 Sept? 2026$/);
});

test('the issue time is IST, named as IST', () => {
  // 09:14:06 UTC is 14:44 in India. Shown as UTC it is five and a half hours
  // from what the reader's clock says.
  const facts = warningFacts([warning('watch', '2', '2026-09-21')], 'en');
  assert.ok('inForce' in facts);
  assert.match(String(facts.issuedAt), /^21 Sept? 2026, 14:44 IST$/);
});

test('no raw ISO timestamp survives anywhere in the fact set', () => {
  const facts = warningFacts(
    [warning('watch', '2,4', '2026-09-21'), warning('alert', '17', '2026-09-25')],
    'en',
  );
  assert.doesNotMatch(JSON.stringify(facts), /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
});

/* ---- the distinction that matters most -------------------------------- */

test('nothing in force is an empty list, and says who checked and when', () => {
  const facts = warningFacts(NO_WARNING, 'en');
  assert.ok('inForce' in facts);
  assert.deepEqual(facts.inForce, []);
  assert.equal(facts.source, 'IMD');
  assert.match(String(facts.issuedAt), /^21 Sept? 2026, 12:55 IST$/);
});

test('not knowing is NOT an empty list', () => {
  // Collapsing "we could not reach IMD" into "nothing is in force" turns a
  // lookup failure into an all-clear.
  const facts = warningFacts(NO_DATA, 'en');
  assert.ok(!('inForce' in facts));
  assert.ok('unavailable' in facts);
  assert.match(facts.unavailable, /could not be reached/i);
});

test('the unavailable statement is written in the language of the answer', () => {
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

test('an empty warning array is still "nothing in force", not "unknown"', () => {
  const facts = warningFacts([], 'en');
  assert.ok('inForce' in facts);
  assert.deepEqual(facts.inForce, []);
  assert.equal(facts.source, null);
});
