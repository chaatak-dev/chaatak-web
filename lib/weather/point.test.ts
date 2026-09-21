/**
 * Resolving a coordinate to a place.
 *
 * Two properties are worth more than the rest and both are asserted here:
 * the answer names the unit IMD warns on, and the coordinates that come back
 * are the GAZETTEER's rather than the device's. The second is the privacy
 * rule in code — a saved location must not record where somebody was
 * standing.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { resolvePoint } from './point';

/** Roughly the middle of each of these places. */
const GHAZIABAD = { latitude: 28.6692, longitude: 77.4538 };
const BARABANKI = { latitude: 26.9254, longitude: 81.1946 };
const MUMBAI = { latitude: 19.076, longitude: 72.8777 };

test('a point in India resolves to a place with a district', () => {
  const place = resolvePoint(GHAZIABAD.latitude, GHAZIABAD.longitude);

  assert.ok(!('kind' in place), 'expected a resolved place');
  assert.equal(place.countryCode, 'IN');
  assert.ok(place.name.length > 0);
  // A district is what IMD issues a warning for, so no answer leaves here
  // without one.
  assert.ok(place.admin2, 'no district on the resolved place');
});

test('every resolved point carries the district the alert side needs', () => {
  for (const point of [GHAZIABAD, BARABANKI, MUMBAI]) {
    const place = resolvePoint(point.latitude, point.longitude);
    assert.ok(!('kind' in place));
    assert.ok(place.admin2, `no district for ${JSON.stringify(point)}`);
    assert.equal(place.timezone, 'Asia/Kolkata');
  }
});

/*
 * The privacy rule, asserted rather than trusted. What comes back is the
 * town's coordinate, which is what gets stored and logged downstream.
 */
test("the answer carries the gazetteer's coordinates, not the device's", () => {
  const exact = { latitude: 26.9312, longitude: 81.2071 };
  const place = resolvePoint(exact.latitude, exact.longitude);

  assert.ok(!('kind' in place));
  assert.notEqual(place.latitude, exact.latitude);
  assert.notEqual(place.longitude, exact.longitude);
});

test('provenance names the gazetteer and the lookup that answered', () => {
  const place = resolvePoint(BARABANKI.latitude, BARABANKI.longitude);

  assert.ok(!('kind' in place));
  assert.match(place.resolvedBy, /gazetteer/i);
  assert.equal(place.endpoint, 'gazetteer:point');
});

test('a point outside India is an honest no-data state, not the nearest town', () => {
  // Central London.
  const place = resolvePoint(51.5072, -0.1276);

  assert.ok('kind' in place);
  assert.equal(place.kind, 'noData');
  assert.equal(place.reason, 'unknownPlace');
  assert.match(place.statement.en, /outside India/i);
  assert.ok(place.statement.hi.length > 0);
});

test('a point just outside the box is refused rather than snapped inwards', () => {
  // Off the coast, well south of the mainland.
  const place = resolvePoint(2.0, 80.0);
  assert.ok('kind' in place);
});

test('a nonsense coordinate is refused', () => {
  for (const [lat, lon] of [
    [Number.NaN, 77],
    [28, Number.POSITIVE_INFINITY],
    [999, 999],
  ]) {
    const place = resolvePoint(lat, lon);
    assert.ok('kind' in place, `expected noData for ${lat},${lon}`);
  }
});

test('a refusal carries a checked time and no issue time', () => {
  const place = resolvePoint(51.5072, -0.1276);

  assert.ok('kind' in place);
  assert.ok(!Number.isNaN(Date.parse(place.checkedAt)));
  // Nothing was issued, so there is no issuedAt to report.
  assert.ok(!('issuedAt' in place));
});
