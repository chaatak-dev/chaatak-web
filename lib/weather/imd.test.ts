import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  hazardCodes,
  imdDistrictId,
  issuedAtFrom,
  rowToWarnings,
  severityFromColour,
  warningRows,
} from './imd';
import type { DistrictId } from './types';

const DISTRICT = 'Barabanki' as DistrictId;
const ENDPOINT = '/api/v1/districtwarning';

/** One real row, copied from a live response for Obj_id 573. */
const LIVE_ROW = {
  Obj_id: '573',
  Date: '2026-09-21',
  District: 'NICOBAR',
  Day_1: '2,4,8',
  Day_2: '4,8',
  Day_3: '4,8',
  Day_4: '4,8',
  Day_5: '1',
  Day1_Color: '3',
  Day2_Color: '3',
  Day3_Color: '3',
  Day4_Color: '3',
  Day5_Color: '4',
  updated_at: '2026-09-21 07:53:58',
};

/* ---- the colour scale, which runs downwards --------------------------- */

test('IMD colours map DOWNWARDS onto severity', () => {
  // The single most dangerous line in the adapter. Reading this the intuitive
  // way round renders every green day as orange and every red one as no
  // warning at all. Established from 3,590 day-slots across all 718
  // districts, because IMD publishes no legend endpoint.
  assert.equal(severityFromColour('1'), 'warning'); // red
  assert.equal(severityFromColour('2'), 'alert'); //   orange
  assert.equal(severityFromColour('3'), 'watch'); //   yellow
  assert.equal(severityFromColour('4'), 'none'); //    green
});

test('a colour arrives as a string or a number and means the same thing', () => {
  assert.equal(severityFromColour(3), 'watch');
  assert.equal(severityFromColour(' 1 '), 'warning');
});

test('a colour outside the four is refused, never rounded to the nearest', () => {
  for (const value of ['0', '5', '', 'red', 'orange', null, undefined, {}, []]) {
    assert.equal(severityFromColour(value), null, JSON.stringify(value));
  }
});

/* ---- hazard codes ----------------------------------------------------- */

test('code 1 is IMD saying nothing is in force, not a hazard', () => {
  assert.deepEqual(hazardCodes('1'), []);
  assert.deepEqual(hazardCodes('2,4,8'), ['2', '4', '8']);
  assert.deepEqual(hazardCodes('4, 8'), ['4', '8']);
  assert.deepEqual(hazardCodes(''), []);
  assert.deepEqual(hazardCodes(null), []);
});

/* ---- dates ------------------------------------------------------------ */

test('the five days are counted from the bulletin date', () => {
  assert.equal(addDays('2026-09-21', 0), '2026-09-21');
  assert.equal(addDays('2026-09-21', 4), '2026-09-25');
  // Month and year boundaries, which is where naive arithmetic breaks.
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('not-a-date', 1), null);
});

test('IMD stamps its bulletin time in IST with no offset, so one is supplied', () => {
  // Read as UTC this would be five and a half hours wrong, which puts a
  // warning in the wrong part of the day.
  assert.equal(issuedAtFrom('2026-09-21 07:53:58'), '2026-09-21T02:23:58.000Z');
  assert.equal(issuedAtFrom('nonsense'), null);
  assert.equal(issuedAtFrom(null), null);
});

/* ---- the payload ------------------------------------------------------ */

test('IMD returns a bare array, and anything else is not understood', () => {
  assert.deepEqual(warningRows([LIVE_ROW]), [LIVE_ROW]);
  // null means "we did not understand this" and becomes noData. An empty
  // array means IMD said nothing is in force. Collapsing the first into the
  // second would turn a parsing failure into an all-clear.
  assert.equal(warningRows({ status: 'ok' }), null);
  assert.equal(warningRows('nope'), null);
  assert.equal(warningRows(null), null);
});

test('a live row becomes one warning per day that has one', () => {
  const { warnings, readable } = rowToWarnings(LIVE_ROW, DISTRICT, ENDPOINT);
  assert.equal(readable, true);
  // Days 1-4 are colour 3; day 5 is green and yields nothing.
  assert.equal(warnings.length, 4);

  const [first] = warnings;
  assert.equal(first.severity, 'watch');
  assert.equal(first.code, '2,4,8');
  assert.equal(first.district, DISTRICT);
  assert.equal(first.validFrom, '2026-09-21T00:00:00+05:30');
  assert.equal(first.validTo, '2026-09-22T00:00:00+05:30');
  assert.equal(first.provenance.source, 'IMD');
  assert.equal(first.provenance.issuedAt, '2026-09-21T02:23:58.000Z');
  assert.equal(first.provenance.timeBasis, 'issued');

  // Day four is still within the five-day window.
  assert.equal(warnings[3].validFrom, '2026-09-24T00:00:00+05:30');
});

test('a green day produces no warning at all', () => {
  const green = { ...LIVE_ROW };
  for (let d = 1; d <= 5; d++) {
    (green as Record<string, string>)[`Day${d}_Color`] = '4';
    (green as Record<string, string>)[`Day_${d}`] = '1';
  }
  const { warnings, readable } = rowToWarnings(green, DISTRICT, ENDPOINT);
  assert.equal(warnings.length, 0);
  // Understood, and it said nothing is in force. That is noWarning, which is
  // a different answer from noData.
  assert.equal(readable, true);
});

test('a row nobody can read is not mistaken for an all-clear', () => {
  const garbled = { ...LIVE_ROW };
  for (let d = 1; d <= 5; d++) {
    (garbled as Record<string, string>)[`Day${d}_Color`] = '9';
  }
  const { warnings, readable } = rowToWarnings(garbled, DISTRICT, ENDPOINT);
  assert.equal(warnings.length, 0);
  // The distinction the caller turns into noData rather than "nothing in
  // force". Silence about a cyclone is the dangerous direction.
  assert.equal(readable, false);
});

test('a row with no bulletin date yields nothing', () => {
  const { warnings, readable } = rowToWarnings({ ...LIVE_ROW, Date: '' }, DISTRICT, ENDPOINT);
  assert.equal(warnings.length, 0);
  assert.equal(readable, false);
});

test('a day with a severity but no hazard code still becomes a warning', () => {
  // IMD colouring a day without listing a code is IMD saying something is in
  // force. Dropping it because the code list was empty would lose it.
  const row = { ...LIVE_ROW, Day_1: '', Day1_Color: '1' };
  const { warnings } = rowToWarnings(row, DISTRICT, ENDPOINT);
  assert.equal(warnings[0].severity, 'warning');
  assert.equal(warnings[0].code, 'unspecified');
});

test('warning ids are stable across polls so dispatch deduplicates', () => {
  const a = rowToWarnings(LIVE_ROW, DISTRICT, ENDPOINT).warnings;
  const b = rowToWarnings(LIVE_ROW, DISTRICT, ENDPOINT).warnings;
  assert.deepEqual(a.map((w) => w.id), b.map((w) => w.id));
  assert.equal(new Set(a.map((w) => w.id)).size, a.length, 'ids collided within one row');
  assert.match(a[0].id, /^imd:573:2026-09-21:d1$/);
});

/* ---- the district join ------------------------------------------------ */

test('a numeric Obj_id passes straight through', () => {
  assert.equal(imdDistrictId('573' as DistrictId), '573');
});

test('a district name resolves against IMD own register', () => {
  // IMD spells several districts its own way, and refusing those would lose
  // real warnings for real places.
  assert.equal(imdDistrictId('Barabanki' as DistrictId), '440');
  assert.equal(imdDistrictId('Nainital' as DistrictId), '516');
  assert.equal(imdDistrictId('Kolkata' as DistrictId), '237');
  assert.equal(imdDistrictId('Tirunelveli' as DistrictId), '35');
});

test('a district IMD does not cover resolves to nothing, not to a neighbour', () => {
  // IMD's register holds 718 districts and does not cover the whole country.
  // Saying so is honest; attaching the nearest district's warning is not.
  for (const name of ['Zzzznotadistrict', '', 'Atlantis']) {
    assert.equal(imdDistrictId(name as DistrictId), null, name);
  }
});
