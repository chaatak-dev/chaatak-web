import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openMeteo } from './open-meteo';
import type { Location } from './types';

/**
 * The historical adapter's contract, against upstream-shaped responses:
 *
 *   - only finished hours and finished days are history
 *   - the recent past is an archived forecast, the older past a reanalysis,
 *     and neither is ever called an observation
 *   - a past-tense question the record cannot answer is noData — it never
 *     reaches for the present or the forecast
 *   - a settled answer is cached, a failed lookup is not
 */

let seq = 0;
/** A coordinate no other test uses, so the TTL cache cannot leak between tests. */
function place(): Location {
  seq += 1;
  return {
    name: 'Ghaziabad',
    admin1: 'Uttar Pradesh',
    admin2: 'Ghaziabad',
    country: 'India',
    countryCode: 'IN',
    latitude: 40 + seq / 1000,
    longitude: 50 + seq / 1000,
    timezone: 'Asia/Kolkata',
    resolvedBy: 'test',
    endpoint: 'test',
  };
}

type Call = { url: string };

async function withFetch<T>(
  respond: (url: string) => unknown,
  run: (calls: Call[]) => Promise<T>,
): Promise<T> {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    const body = respond(url);
    if (body === null) return new Response('upstream down', { status: 503 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}

/** Two past days and today, with hours running past "now" into the forecast. */
function recentBody(now = '2026-09-23T14:20') {
  return {
    utc_offset_seconds: 19800,
    current: { time: now, temperature_2m: 31 },
    hourly_units: { precipitation: 'mm', rain: 'mm', temperature_2m: '°C' },
    hourly: {
      time: ['2026-09-23T12:00', '2026-09-23T13:00', '2026-09-23T14:00', '2026-09-23T15:00', '2026-09-23T16:00'],
      precipitation: [0, 1.2, 0.8, 7.5, 9.9],
      rain: [0, 1.2, 0.8, 7.5, 9.9],
      temperature_2m: [30, 29, 28, 27, 26],
    },
    daily_units: { precipitation_sum: 'mm', temperature_2m_max: '°C', wind_speed_10m_max: 'km/h' },
    daily: {
      time: ['2026-09-21', '2026-09-22', '2026-09-23'],
      weather_code: [61, 3, 80],
      temperature_2m_max: [31.2, 33.4, 32],
      temperature_2m_min: [24.1, 25, 24],
      precipitation_sum: [12.4, 0, 19.4],
      rain_sum: [12.4, 0, 19.4],
      precipitation_hours: [5, 0, 4],
      wind_speed_10m_max: [14.2, 9.1, 20],
    },
  };
}

test('only finished hours and finished days are history', async () => {
  await withFetch(() => recentBody(), async () => {
    const history = await openMeteo.getHistory(place(), { kind: 'recent', pastDays: 2 });
    assert.equal(history.kind, 'history');
    if (history.kind !== 'history') return;

    // 15:00 and 16:00 are still a forecast at 14:20; they are not the past.
    assert.deepEqual(
      history.hours.map((h) => h.time),
      ['2026-09-23T12:00:00+05:30', '2026-09-23T13:00:00+05:30', '2026-09-23T14:00:00+05:30'],
    );
    // Today is not over, so it is not a history day either.
    assert.deepEqual(history.days.map((d) => d.date), ['2026-09-21', '2026-09-22']);
    // And the values that remain are exactly as upstream sent them.
    assert.equal(history.days[0].precipitationSum, 12.4);
  });
});

test('the recent past is an archived forecast, dated by its last value', async () => {
  await withFetch(() => recentBody(), async (calls) => {
    const history = await openMeteo.getHistory(place(), { kind: 'recent', pastDays: 2 });
    if (history.kind !== 'history') return assert.fail('expected history');
    assert.equal(history.provenance.nature, 'archivedForecast');
    assert.equal(history.provenance.timeBasis, 'through');
    assert.equal(history.provenance.issuedAt, '2026-09-23T14:00:00+05:30');
    assert.equal(history.provenance.source, 'Open-Meteo');
    assert.match(calls[0].url, /past_days=2/);
    assert.match(calls[0].url, /hourly=precipitation/);
  });
});

test('a date beyond the recent archive is answered by ERA5 reanalysis', async () => {
  const body = {
    utc_offset_seconds: 19800,
    daily_units: { precipitation_sum: 'mm', temperature_2m_max: '°C', wind_speed_10m_max: 'km/h' },
    daily: {
      time: ['2025-08-15'],
      weather_code: [63],
      temperature_2m_max: [30.1],
      temperature_2m_min: [25.2],
      precipitation_sum: [22.7],
      rain_sum: [22.7],
      precipitation_hours: [9],
      wind_speed_10m_max: [11],
    },
  };
  await withFetch(() => body, async (calls) => {
    const history = await openMeteo.getHistory(place(), { kind: 'dates', from: '2025-08-15', to: '2025-08-15' });
    if (history.kind !== 'history') return assert.fail('expected history');
    assert.match(calls[0].url, /archive-api\.open-meteo\.com\/v1\/archive/);
    assert.match(calls[0].url, /models=era5/);
    assert.equal(history.provenance.nature, 'reanalysis');
    assert.equal(history.provenance.modelRun, 'ERA5');
    assert.equal(history.days[0].precipitationSum, 22.7);
  });
});

test('the reanalysis not having reached a day yet is noData, never a zero', async () => {
  const body = {
    utc_offset_seconds: 19800,
    daily_units: { precipitation_sum: 'mm' },
    daily: { time: ['2025-06-01'], precipitation_sum: [null], temperature_2m_max: [null] },
  };
  await withFetch(() => body, async () => {
    const history = await openMeteo.getHistory(place(), { kind: 'dates', from: '2025-06-01', to: '2025-06-01' });
    assert.equal(history.kind, 'noData');
  });
});

test('a day that has not happened is noData, and nothing is fetched for it', async () => {
  await withFetch(() => recentBody(), async (calls) => {
    const history = await openMeteo.getHistory(place(), { kind: 'dates', from: '2099-01-01', to: '2099-01-02' });
    assert.equal(history.kind, 'noData');
    assert.equal(calls.length, 0, 'the forecast must never stand in for the past');
  });
});

test('a failed lookup is reported and not remembered; a settled one is', async () => {
  const where = place();
  let up = false;
  await withFetch(() => (up ? recentBody() : null), async (calls) => {
    const failed = await openMeteo.getHistory(where, { kind: 'recent', pastDays: 3 });
    assert.equal(failed.kind, 'noData');
    if (failed.kind === 'noData') assert.equal(failed.reason, 'lookupFailed');

    up = true;
    const ok = await openMeteo.getHistory(where, { kind: 'recent', pastDays: 3 });
    assert.equal(ok.kind, 'history');
    const again = await openMeteo.getHistory(where, { kind: 'recent', pastDays: 3 });
    assert.equal(again.kind, 'history');
    assert.equal(calls.length, 2, 'the failure was retried; the success was cached');
  });
});

test('the forecast now carries the day\'s strongest wind and chance of rain', async () => {
  const body = {
    utc_offset_seconds: 19800,
    current: { time: '2026-09-23T14:00', temperature_2m: 31 },
    daily_units: {
      temperature_2m_max: '°C',
      precipitation_sum: 'mm',
      wind_speed_10m_max: 'km/h',
      precipitation_probability_max: '%',
    },
    daily: {
      time: ['2026-09-23', '2026-09-24'],
      weather_code: [3, 61],
      temperature_2m_max: [33, 31],
      temperature_2m_min: [25, 24],
      precipitation_sum: [0, 4.2],
      wind_speed_10m_max: [12.5, 22.1],
      precipitation_probability_max: [10, 80],
    },
  };
  await withFetch(() => body, async () => {
    const forecast = await openMeteo.getForecast(place(), 2);
    if (forecast.kind !== 'forecast') return assert.fail('expected forecast');
    assert.equal(forecast.days[1].maxWind, 22.1);
    assert.equal(forecast.days[1].precipitationProbability, 80);
    assert.equal(forecast.units.wind, 'km/h');
    assert.equal(forecast.units.probability, '%');
  });
});
