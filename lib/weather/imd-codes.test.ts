import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IMD_COLOUR_NAMES,
  IMD_WARNING_CODES,
  NO_WARNING_CODE,
  hazardText,
  readHazards,
} from './imd-codes';
import { severityFromColour } from './imd';

/**
 * The code table is copied from IMD's published API reference. These tests
 * pin it, because the failure it guards against is silent: a wrong label
 * renders as fluent, plausible text and nothing downstream can catch it.
 */

test('all seventeen published codes are present, and nothing else is', () => {
  const keys = Object.keys(IMD_WARNING_CODES).map(Number).sort((a, b) => a - b);
  assert.deepEqual(keys, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
});

test('the English labels are IMD own words, verbatim', () => {
  // Copied from https://api.imd.gov.in/public/api_reference.html. Not
  // paraphrased, not tidied, not translated from anywhere.
  assert.equal(IMD_WARNING_CODES['1'].en, 'No Warning');
  assert.equal(IMD_WARNING_CODES['2'].en, 'Heavy Rain');
  assert.equal(IMD_WARNING_CODES['4'].en, 'Thunderstorm & Lightning, Squall etc');
  assert.equal(IMD_WARNING_CODES['8'].en, 'Strong Surface Winds');
  assert.equal(IMD_WARNING_CODES['9'].en, 'Heat Wave');
  assert.equal(IMD_WARNING_CODES['16'].en, 'Very Heavy Rain');
  assert.equal(IMD_WARNING_CODES['17'].en, 'Extremely Heavy Rain');
});

test('every code has both languages and neither is blank', () => {
  for (const [code, label] of Object.entries(IMD_WARNING_CODES)) {
    assert.ok(label.en.trim().length > 0, `${code} has no English`);
    assert.ok(label.hi.trim().length > 0, `${code} has no Hindi`);
    // A Hindi label that is just the English one would mean a translation was
    // skipped rather than written.
    assert.notEqual(label.hi, label.en, `${code} was never translated`);
  }
});

test('the rain scale keeps its three distinct steps', () => {
  // Heavy / Very Heavy / Extremely Heavy is the distinction that matters most
  // in this catalogue, and collapsing any two of them softens a warning.
  const rain = ['2', '16', '17'].map((c) => IMD_WARNING_CODES[c]);
  assert.equal(new Set(rain.map((r) => r.en)).size, 3);
  assert.equal(new Set(rain.map((r) => r.hi)).size, 3);
});

/* ---- reading a code list ---------------------------------------------- */

test('a comma-separated list becomes the hazards it names', () => {
  const { hazards, unrecognised } = readHazards('2,4,8', 'en');
  assert.deepEqual(hazards, [
    'Heavy Rain',
    'Thunderstorm & Lightning, Squall etc',
    'Strong Surface Winds',
  ]);
  assert.deepEqual(unrecognised, []);
});

test('code 1 is dropped, because it means no warning rather than a hazard', () => {
  assert.equal(NO_WARNING_CODE, '1');
  assert.deepEqual(readHazards('1', 'en').hazards, []);
  assert.deepEqual(readHazards('1,2', 'en').hazards, ['Heavy Rain']);
});

test('an unpublished code is reported, not dropped and not guessed', () => {
  const { hazards, unrecognised } = readHazards('2,99', 'en');
  assert.deepEqual(hazards, ['Heavy Rain']);
  assert.deepEqual(unrecognised, ['99']);
});

test('spacing and empty entries in the list are tolerated', () => {
  assert.deepEqual(readHazards(' 2 , 8 ', 'en').hazards, [
    'Heavy Rain',
    'Strong Surface Winds',
  ]);
  assert.deepEqual(readHazards('', 'en').hazards, []);
  assert.deepEqual(readHazards(null, 'en').hazards, []);
  assert.deepEqual(readHazards(2, 'en').hazards, ['Heavy Rain']);
});

test('hazards are joined with a separator that survives IMD own commas', () => {
  // "Thunderstorm & Lightning, Squall etc" contains a comma, so a
  // comma-joined list of hazards cannot be read back apart.
  const text = hazardText('2,4', 'en');
  assert.equal(text, 'Heavy Rain · Thunderstorm & Lightning, Squall etc');
});

test('an unpublished code shows as the code, never as a description', () => {
  assert.equal(hazardText('99', 'en'), 'code 99');
  assert.match(hazardText('99', 'hi'), /99/);
});

test('a list of nothing renders as nothing, so a caller can fall back', () => {
  assert.equal(hazardText('1', 'en'), '');
  assert.equal(hazardText('', 'en'), '');
});

/* ---- the colour scale, cross-checked ---------------------------------- */

test('the documented colour numbering matches the severity the adapter uses', () => {
  // IMD publishes 1 Red, 2 Orange, 3 Yellow, 4 Green -- descending. The
  // adapter derived the same order from the data before the reference was
  // found; this pins the two together so neither can drift.
  assert.deepEqual(IMD_COLOUR_NAMES, { '1': 'Red', '2': 'Orange', '3': 'Yellow', '4': 'Green' });
  assert.equal(severityFromColour('1'), 'warning'); // red
  assert.equal(severityFromColour('2'), 'alert'); //   orange
  assert.equal(severityFromColour('3'), 'watch'); //   yellow
  assert.equal(severityFromColour('4'), 'none'); //    green
});
