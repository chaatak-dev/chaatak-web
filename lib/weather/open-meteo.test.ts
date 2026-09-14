import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openMeteo } from './open-meteo';
import type { Location } from './types';

/**
 * The rule this guards: a value the source did not give is never filled in.
 *
 * Open-Meteo really does send nulls — the last day of a long request falls
 * past the model horizon and comes back `null` in every daily array. The
 * tempting accident, later, is to make those nulls tidy: default them to 0,
 * carry the previous day forward, drop the day from the list, or round-trip
 * them through something that turns null into NaN. Any of those puts a number
 * on screen that no source ever issued, which is the one thing this system
 * must not do.
 *
 * So: feed the adapter a response with a null day and assert the nulls come
 * out the other side as nulls, with the day still present.
 */

const GHAZIABAD: Location = {
  name: 'Ghaziabad',
  admin1: 'Uttar Pradesh',
  admin2: 'Ghaziabad',
  country: 'India',
  countryCode: 'IN',
  // Coordinates unique to this test so the adapter's TTL cache cannot serve
  // a real response recorded by another test or a warm process.
  latitude: 11.111,
  longitude: 22.222,
  timezone: 'Asia/Kolkata',
  resolvedBy: 'Open-Meteo',
  endpoint: '/v1/search',
};

/** Shaped exactly like a real Open-Meteo reply, third day past the horizon. */
const RESPONSE = {
  utc_offset_seconds: 19800,
  current_units: { time: 'iso8601', temperature_2m: '°C' },
  current: { time: '2026-09-15T01:45', temperature_2m: 25.2 },
  daily_units: {
    time: 'iso8601',
    temperature_2m_max: '°C',
    temperature_2m_min: '°C',
    precipitation_sum: 'mm',
  },
  daily: {
    time: ['2026-09-15', '2026-09-16', '2026-09-17'],
    weather_code: [95, 51, null],
    temperature_2m_max: [30.7, 31.4, null],
    temperature_2m_min: [24.9, null, null],
    precipitation_sum: [1.4, 0.2, null],
  },
};

test('getForecast carries upstream nulls through untouched', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(RESPONSE), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

  try {
    const forecast = await openMeteo.getForecast(GHAZIABAD, 3);

    assert.equal(forecast.kind, 'forecast', 'a valid response must not become noData');
    if (forecast.kind !== 'forecast') return;

    // The day upstream could not forecast is still listed. Dropping it would
    // silently shorten the outlook and hide that the source went quiet.
    assert.equal(forecast.days.length, 3);
    assert.equal(forecast.days[2].date, '2026-09-17');

    // Every absent field stays absent. Not 0, not NaN, not the day before.
    assert.equal(forecast.days[2].maxTemp, null);
    assert.equal(forecast.days[2].minTemp, null);
    assert.equal(forecast.days[2].precipitationSum, null);
    assert.equal(forecast.days[2].conditionCode, null);

    // A null in one field does not take the rest of the day with it.
    assert.equal(forecast.days[1].minTemp, null);
    assert.equal(forecast.days[1].maxTemp, 31.4);
    assert.equal(forecast.days[1].conditionCode, 51);

    // And the values that were given arrive exactly as sent, unrounded.
    assert.equal(forecast.days[0].maxTemp, 30.7);
    assert.equal(forecast.days[0].precipitationSum, 1.4);

    // Units come from the source's own units block, never hardcoded here.
    assert.equal(forecast.units.temperature, '°C');
    assert.equal(forecast.units.precipitation, 'mm');

    // Provenance is part of the value: the timestamp is upstream's, not ours.
    assert.equal(forecast.provenance.issuedAt, '2026-09-15T01:45:00+05:30');
    assert.equal(forecast.provenance.timeBasis, 'updated');
  } finally {
    globalThis.fetch = realFetch;
  }
});
