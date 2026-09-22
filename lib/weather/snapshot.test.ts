/**
 * The loudest severity in a snapshot — and the difference between "IMD says
 * nothing is in force" and "we do not know", which must never collapse.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { districtOf, warningsInForce, worstSeverity } from './snapshot';
import { GHAZIABAD, MODINAGAR, NO_WARNING_PRODUCT, orangeWarning } from '../telegram/fixtures';

test('the worst warning in force sets the severity', () => {
  const red = orangeWarning({ id: 'R', severity: 'warning' });
  assert.equal(worstSeverity([orangeWarning(), red]), 'warning');
  assert.equal(worstSeverity([orangeWarning()]), 'alert');
});

test('asked-and-nothing is none; could-not-ask is unknown', () => {
  assert.equal(
    worstSeverity({
      kind: 'noWarning',
      source: 'IMD',
      endpoint: 'x',
      issuedAt: null,
      checkedAt: new Date().toISOString(),
      timeBasis: 'issued',
    }),
    'none',
  );
  assert.equal(worstSeverity(NO_WARNING_PRODUCT), 'unknown');
  assert.equal(worstSeverity([]), 'unknown', 'an empty list says nothing, and nothing is not an all-clear');
});

test('warnings in force come loudest first; absence states have none', () => {
  const red = orangeWarning({ id: 'R', severity: 'warning' });
  assert.deepEqual(
    warningsInForce([orangeWarning(), red]).map((w) => w.severity),
    ['warning', 'alert'],
  );
  assert.deepEqual(warningsInForce(NO_WARNING_PRODUCT), []);
});

test('a town is warned under its district', () => {
  assert.equal(districtOf(GHAZIABAD), 'Ghaziabad');
  assert.equal(districtOf(MODINAGAR), 'Ghaziabad');
  assert.equal(districtOf({ ...GHAZIABAD, admin2: undefined, name: 'Somewhere' }), 'Somewhere');
});
