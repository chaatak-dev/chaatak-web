import { test } from 'node:test';
import assert from 'node:assert/strict';

import { imdDistrictId, severityFromColour, toWarning, warningRows } from './imd';
import type { DistrictId } from './types';

const DISTRICT = '573' as DistrictId;
const ENDPOINT = '/api/v1/districtwarning';

/* ---- severity --------------------------------------------------------- */

test('IMD colours map onto the severity scale the templates are keyed on', () => {
  assert.equal(severityFromColour('green'), 'none');
  assert.equal(severityFromColour('yellow'), 'watch');
  assert.equal(severityFromColour('orange'), 'alert');
  assert.equal(severityFromColour('red'), 'warning');
});

test('colour matching survives the casing and padding a feed actually sends', () => {
  assert.equal(severityFromColour('ORANGE'), 'alert');
  assert.equal(severityFromColour('  Red '), 'warning');
});

test('an unrecognised colour is refused, never rounded to the nearest one', () => {
  // Guessing that an unknown word means orange is how a real warning gets
  // softened, and softening is the one failure the verification gate cannot
  // catch. Refusing loses a warning loudly; guessing loses one silently.
  for (const value of ['amber', 'severe', 'crimson', '', 'null', null, 7, undefined, {}]) {
    assert.equal(severityFromColour(value), null, String(value));
  }
});

/* ---- the district identifier ------------------------------------------ */

test('a numeric IMD district id passes through', () => {
  assert.equal(imdDistrictId('573' as DistrictId), '573');
  assert.equal(imdDistrictId(' 573 ' as DistrictId), '573');
});

test('a district NAME is refused rather than guessed at', () => {
  // Turning "Barabanki" into a number without IMD's own district list would
  // be inventing the single field that decides whose warning is shown.
  for (const name of ['Barabanki', 'बाराबंकी', '', '57a', 'district-573']) {
    assert.equal(imdDistrictId(name as DistrictId), null, name);
  }
});

/* ---- reading the payload ---------------------------------------------- */

test('rows are found whether IMD sends a bare array or wraps it', () => {
  assert.deepEqual(warningRows([{ a: 1 }]), [{ a: 1 }]);
  assert.deepEqual(warningRows({ data: [{ a: 1 }] }), [{ a: 1 }]);
  assert.deepEqual(warningRows({ warnings: [{ a: 1 }] }), [{ a: 1 }]);
  assert.deepEqual(warningRows([]), []);
});

test('an envelope with no rows in it is not read as an empty list', () => {
  // null means "we did not understand this", which becomes noData. An empty
  // array means "IMD says nothing is in force", which is noWarning. Collapsing
  // the first into the second would turn a parsing failure into an all-clear.
  assert.equal(warningRows({ status: 'ok' }), null);
  assert.equal(warningRows('nope'), null);
  assert.equal(warningRows(null), null);
  assert.equal(warningRows(42), null);
});

test('a complete row becomes a warning carrying IMD as its source', () => {
  const warning = toWarning(
    {
      colour: 'orange',
      warning_code: 'HEAVY_RAIN',
      valid_from: '2026-09-21T06:00:00Z',
      valid_to: '2026-09-21T18:00:00Z',
      id: 'w-1',
    },
    DISTRICT,
    ENDPOINT,
    '2026-09-21T05:30:00Z',
  );

  assert.ok(warning);
  assert.equal(warning.severity, 'alert');
  assert.equal(warning.code, 'HEAVY_RAIN');
  assert.equal(warning.district, DISTRICT);
  assert.equal(warning.provenance.source, 'IMD');
  assert.equal(warning.provenance.issuedAt, '2026-09-21T05:30:00Z');
  assert.equal(warning.provenance.timeBasis, 'issued');
});

test('without a bulletin time the provenance says so rather than inventing one', () => {
  const warning = toWarning(
    {
      colour: 'red',
      code: 'CYCLONE',
      from: '2026-09-21T06:00:00Z',
      to: '2026-09-22T06:00:00Z',
    },
    DISTRICT,
    ENDPOINT,
    null,
  );
  assert.ok(warning);
  // Falls back to the validity start and labels the basis honestly, instead
  // of stamping "issued" on a time nobody issued.
  assert.equal(warning.provenance.timeBasis, 'valid');
  assert.equal(warning.provenance.issuedAt, '2026-09-21T06:00:00Z');
});

test('a row missing anything a warning needs is dropped, not defaulted', () => {
  // Every default available here is a claim about weather: a severity nobody
  // issued, or a validity window nobody set.
  const incomplete = [
    { warning_code: 'X', valid_from: 'a', valid_to: 'b' },
    { colour: 'orange', valid_from: 'a', valid_to: 'b' },
    { colour: 'orange', warning_code: 'X', valid_to: 'b' },
    { colour: 'orange', warning_code: 'X', valid_from: 'a' },
    { colour: 'purple', warning_code: 'X', valid_from: 'a', valid_to: 'b' },
    {},
  ];
  for (const row of incomplete) {
    assert.equal(toWarning(row, DISTRICT, ENDPOINT, null), null, JSON.stringify(row));
  }
});

test('an id is derived rather than left blank when IMD omits one', () => {
  // Dispatch deduplicates on the warning id, so a blank one would make two
  // different warnings look like the same one.
  const warning = toWarning(
    { colour: 'yellow', code: 'THUNDER', from: '2026-09-21', to: '2026-09-22' },
    DISTRICT,
    ENDPOINT,
    null,
  );
  assert.ok(warning);
  assert.ok(warning.id.includes('573'));
  assert.ok(warning.id.includes('THUNDER'));
});
