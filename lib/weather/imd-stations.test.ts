import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_STATION_KM,
  distanceKm,
  nearestStation,
  stations,
} from './imd-stations';

/**
 * A station speaks for a place only if it is near it.
 *
 * Getting this wrong does not produce an error — it produces another town's
 * temperature under IMD's name, which reads exactly like the truth.
 */

test('the register holds IMD stations that were actually located', () => {
  const observation = stations('observation');
  const forecast = stations('forecast');
  assert.ok(observation.length > 200, `only ${observation.length} observation stations`);
  assert.ok(forecast.length > 500, `only ${forecast.length} forecast stations`);

  for (const list of [observation, forecast]) {
    for (const s of list) {
      assert.match(s.id, /^\d+$/, `${s.name} has a non-numeric id`);
      assert.ok(s.name.trim().length > 0);
      // Located, not approximated: every station kept carries the gazetteer
      // place its coordinates came from, so the mapping stays auditable.
      assert.ok(s.place.trim().length > 0, `${s.name} has no source place`);
      // India's bounding box. A station outside it cannot speak for anywhere
      // Chaatak serves.
      assert.ok(s.lat > 6 && s.lat < 38, `${s.name} latitude ${s.lat}`);
      assert.ok(s.lon > 68 && s.lon < 98, `${s.name} longitude ${s.lon}`);
    }
  }
});

test('distance is measured in kilometres, allowing for latitude', () => {
  // A degree of longitude is shorter than a degree of latitude away from the
  // equator; ignoring that puts stations in the wrong order east to west.
  assert.ok(Math.abs(distanceKm(28.6, 77.2, 28.6, 77.2)) < 0.001);
  const oneDegreeNorth = distanceKm(28.6, 77.2, 29.6, 77.2);
  assert.ok(oneDegreeNorth > 108 && oneDegreeNorth < 115, String(oneDegreeNorth));
  const oneDegreeEast = distanceKm(28.6, 77.2, 28.6, 78.2);
  assert.ok(oneDegreeEast < oneDegreeNorth, 'longitude not corrected for latitude');
});

test('a place with a station on top of it resolves to that station', () => {
  for (const [name, lat, lon] of [
    ['Barabanki', 26.92, 81.2],
    ['Ahmedabad', 23.02, 72.58],
    ['New Delhi', 28.61, 77.21],
  ] as const) {
    const near = nearestStation('observation', lat, lon);
    assert.ok(near, `${name} found no station`);
    assert.ok(near.km <= MAX_STATION_KM, `${name} matched ${near.km}km away`);
  }
});

test('a place with no station near it resolves to nothing', () => {
  // Nicobar is an island group with no IMD observation station in the
  // register. The honest answer is "not IMD", and the caller falls back to a
  // source that says its own name.
  const near = nearestStation('observation', 7.03, 93.79);
  assert.equal(near, null);
});

test('the ceiling is enforced, not advisory', () => {
  // Somewhere deliberately far from anything: the middle of the Arabian Sea,
  // inside no station's reach.
  assert.equal(nearestStation('observation', 15.0, 68.5), null);
  assert.equal(nearestStation('forecast', 15.0, 68.5), null);
  // And a generous ceiling does find something, proving the null above is the
  // ceiling talking and not an empty register.
  const loose = nearestStation('observation', 15.0, 68.5, 2000);
  assert.ok(loose);
  assert.ok(loose.km > MAX_STATION_KM);
});

test('the two registers are independent', () => {
  // A place can have a forecast station near it and no observation station,
  // which is why the kind is a parameter rather than one shared list.
  const ids = new Set(stations('observation').map((s) => s.id));
  const forecastOnly = stations('forecast').filter((s) => !ids.has(s.id));
  assert.ok(forecastOnly.length > 0, 'the registers are identical, which is suspicious');
});

test('the nearest station really is the nearest', () => {
  const lat = 26.92;
  const lon = 81.2;
  const near = nearestStation('observation', lat, lon, 500);
  assert.ok(near);
  for (const s of stations('observation')) {
    assert.ok(
      distanceKm(lat, lon, s.lat, s.lon) >= near.km - 0.001,
      `${s.name} is closer than the one chosen`,
    );
  }
});
