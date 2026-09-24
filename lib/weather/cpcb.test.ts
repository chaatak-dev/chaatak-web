import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_STATION_KM,
  cpcbAir,
  cpcbFeed,
  distanceKm,
  isUsable,
  parseCpcbTime,
  resetCpcbFeedState,
  resolveStation,
  stationAqi,
  stationsInBounds,
  toStations,
  verifyContract,
  type CpcbStation,
} from './cpcb';
import { airQualitySource, cpcbWithFallback, openMeteoAir } from './aqi';
import { CPCB_BANDS, cpcbBand } from './aqi-bands';
import { AQI_SCALES, aqiLayer, colourFor } from '../map/layers';
import { STRINGS } from '../i18n/strings';
import type { Location } from './types';

/**
 * CPCB is the primary air quality source, and every way it can fail to have an
 * answer must end in either CPCB's own reading or a modelled figure that says
 * it is modelled — never a modelled figure wearing CPCB's name.
 */

/** The schema exactly as the live API describes itself (2026-09-25). */
const LIVE_FIELDS = [
  { name: 'country', id: 'country', type: 'keyword' },
  { name: 'state', id: 'state', type: 'keyword' },
  { name: 'city', id: 'city', type: 'keyword' },
  { name: 'station', id: 'station', type: 'keyword' },
  { name: 'last_update', id: 'last_update', type: 'keyword' },
  { name: 'latitude', id: 'latitude', type: 'keyword' },
  { name: 'longitude', id: 'longitude', type: 'keyword' },
  { name: 'pollutant_id', id: 'pollutant_id', type: 'keyword' },
  { name: 'pollutant_min', id: 'min_value', type: 'keyword' },
  { name: 'pollutant_max', id: 'max_value', type: 'keyword' },
  { name: 'pollutant_avg', id: 'avg_value', type: 'keyword' },
];

const STAMP = '25-09-2026 00:00:00';
/** An hour after the stamp: a current reading. */
const NOW = new Date('2026-09-25T01:00:00+05:30');

function row(station: string, lat: string, lon: string, pollutant: string, avg: string, stamp = STAMP) {
  return {
    country: 'India',
    state: 'Bihar',
    city: 'Patna',
    station,
    last_update: stamp,
    latitude: lat,
    longitude: lon,
    pollutant_id: pollutant,
    min_value: avg,
    max_value: avg,
    avg_value: avg,
  };
}

/** Samanpura's seven rows, copied from the live response. Its AQI is PM10's 90. */
const SAMANPURA = [
  ['PM2.5', '58'],
  ['OZONE', '45'],
  ['PM10', '90'],
  ['SO2', '9'],
  ['CO', '84'],
  ['NO2', '10'],
  ['NH3', '7'],
].map(([p, v]) => row('Samanpura, Patna - BSPCB', '25.596727', '85.085624', p, v));

/** Patna, the canonical place, a little over 3 km from Samanpura. */
const PATNA: Location = {
  name: 'Patna',
  latitude: 25.6093,
  longitude: 85.1235,
  timezone: 'Asia/Kolkata',
} as Location;

function station(overrides: Partial<CpcbStation> = {}): CpcbStation {
  return {
    id: 'S',
    name: 'S',
    city: 'Patna',
    state: 'Bihar',
    latitude: 25.6,
    longitude: 85.1,
    updatedAt: '2026-09-25T00:00:00+05:30',
    subIndices: [
      { key: 'pm2_5', value: 120 },
      { key: 'no2', value: 30 },
      { key: 'o3', value: 40 },
    ],
    ...overrides,
  };
}

/* ---- the contract --------------------------------------------------- */

test('the live schema is accepted', () => {
  assert.equal(verifyContract({ field: LIVE_FIELDS, records: [] }), true);
});

test('a schema missing any field the adapter reads is refused, not guessed at', () => {
  for (const id of ['station', 'latitude', 'longitude', 'last_update', 'pollutant_id', 'avg_value']) {
    const field = LIVE_FIELDS.filter((f) => f.id !== id);
    assert.equal(verifyContract({ field, records: [] }), false, `accepted without ${id}`);
  }
  assert.equal(verifyContract({ field: LIVE_FIELDS }), false, 'accepted with no records');
  assert.equal(verifyContract({ records: [] }), false, 'accepted with no schema');
});

test('last_update is read as IST, and nothing else is read at all', () => {
  assert.equal(parseCpcbTime('25-09-2026 00:00:00'), '2026-09-25T00:00:00+05:30');
  assert.equal(parseCpcbTime('2026-09-25T00:00:00Z'), null);
  assert.equal(parseCpcbTime('25/09/2026 00:00'), null);
  assert.equal(parseCpcbTime(''), null);
  assert.equal(parseCpcbTime(undefined), null);
});

/* ---- folding rows into stations ------------------------------------- */

test('seven pollutant rows become one station with seven sub-indices', () => {
  const [s] = toStations(SAMANPURA);
  assert.equal(s.name, 'Samanpura, Patna - BSPCB');
  assert.equal(s.latitude, 25.596727);
  assert.equal(s.subIndices.length, 7);
  assert.deepEqual(stationAqi(s), { value: 90, dominant: 'pm10' });
});

test('"NA" is an absent pollutant, never a zero', () => {
  const rows = [
    row('A', '25.6', '85.1', 'PM2.5', 'NA'),
    row('A', '25.6', '85.1', 'NO2', '20'),
    row('A', '25.6', '85.1', 'OZONE', '30'),
  ];
  const [s] = toStations(rows);
  assert.deepEqual(
    s.subIndices.map((x) => x.key),
    ['no2', 'o3'],
  );
});

test('a pollutant the adapter does not know still counts toward the AQI', () => {
  // Leaving it out could only make the AQI read lower than CPCB's.
  const rows = [
    row('A', '25.6', '85.1', 'PM10', '80'),
    row('A', '25.6', '85.1', 'NO2', '20'),
    row('A', '25.6', '85.1', 'Pb', '150'),
  ];
  assert.deepEqual(stationAqi(toStations(rows)[0]), { value: 150, dominant: 'pb' });
});

test('a station is as current as its stalest row', () => {
  const rows = [
    row('A', '25.6', '85.1', 'PM10', '80', '25-09-2026 00:00:00'),
    row('A', '25.6', '85.1', 'NO2', '20', '24-09-2026 18:00:00'),
  ];
  assert.equal(toStations(rows)[0].updatedAt, '2026-09-24T18:00:00+05:30');
});

test('a row without usable coordinates or time is dropped', () => {
  const rows = [
    row('A', 'NA', '85.1', 'PM10', '80'),
    row('B', '25.6', '85.1', 'PM10', '80', 'yesterday'),
  ];
  assert.equal(toStations(rows).length, 0);
});

/* ---- CPCB's AQI rule ------------------------------------------------- */

test('the AQI is the highest sub-index', () => {
  assert.deepEqual(stationAqi(station()), { value: 120, dominant: 'pm2_5' });
});

test('fewer than three pollutants: CPCB states no AQI, and neither do we', () => {
  assert.equal(
    stationAqi(station({ subIndices: [{ key: 'pm10', value: 80 }, { key: 'no2', value: 20 }] })),
    null,
  );
});

test('no particulate among them: no AQI, however many gases report', () => {
  assert.equal(
    stationAqi(
      station({
        subIndices: [
          { key: 'no2', value: 20 },
          { key: 'o3', value: 60 },
          { key: 'so2', value: 10 },
          { key: 'co', value: 70 },
        ],
      }),
    ),
    null,
  );
});

test('CPCB bands, at every edge', () => {
  const cases: [number, string][] = [
    [0, 'good'], [50, 'good'], [51, 'satisfactory'], [100, 'satisfactory'],
    [101, 'moderate'], [200, 'moderate'], [201, 'poor'], [300, 'poor'],
    [301, 'veryPoor'], [400, 'veryPoor'], [401, 'severe'], [500, 'severe'], [620, 'severe'],
  ];
  for (const [value, band] of cases) assert.equal(cpcbBand(value), band, String(value));
});

/* ---- station resolution --------------------------------------------- */

test('the nearest station in range answers, with its name and distance', () => {
  const far = station({ id: 'Far', name: 'Far', latitude: 25.7, longitude: 85.2, subIndices: [
    { key: 'pm10', value: 300 }, { key: 'no2', value: 1 }, { key: 'o3', value: 1 },
  ] });
  const result = resolveStation([far, ...toStations(SAMANPURA)], PATNA, NOW);
  assert.equal(result.kind, 'reading');
  if (result.kind !== 'reading') return;
  assert.equal(result.air.station?.name, 'Samanpura, Patna - BSPCB');
  assert.equal(result.air.value, 90);
  const km = distanceKm(PATNA.latitude, PATNA.longitude, 25.596727, 85.085624);
  assert.equal(result.air.station?.distanceKm, Math.round(km * 10) / 10);
});

test('a CPCB reading carries CPCB provenance: source, observation, the station time', () => {
  const result = resolveStation(toStations(SAMANPURA), PATNA, NOW);
  assert.equal(result.kind, 'reading');
  if (result.kind !== 'reading') return;
  const { air } = result;
  assert.equal(air.standard, 'cpcb');
  assert.equal(air.band, 'satisfactory');
  assert.equal(air.measure, 'subIndex');
  assert.equal(air.provenance.source, 'CPCB');
  assert.equal(air.provenance.nature, 'observation');
  assert.equal(air.provenance.observedAt, '2026-09-25T00:00:00+05:30');
  assert.equal(air.provenance.issuedAt, '2026-09-25T00:00:00+05:30');
  assert.equal(air.provenance.timeBasis, 'updated');
  assert.ok(air.provenance.endpoint.startsWith('/resource/'));
  // Sub-indices have no unit, and the biggest comes first.
  assert.equal(air.components[0].key, 'pm10');
  assert.ok(air.components.every((c) => c.unit === ''));
});

test('nothing within range is "no station", never the nearest one far away', () => {
  const delhi = station({ latitude: 28.63, longitude: 77.22 });
  assert.deepEqual(resolveStation([delhi], PATNA, NOW), { kind: 'miss', miss: 'noStation' });
});

test('the range is a real limit', () => {
  // Due north of Patna by a little more and a little less than the limit.
  const perDegree = distanceKm(0, 0, 1, 0);
  const inside = station({ latitude: PATNA.latitude + (MAX_STATION_KM - 1) / perDegree, longitude: PATNA.longitude });
  const outside = station({ latitude: PATNA.latitude + (MAX_STATION_KM + 1) / perDegree, longitude: PATNA.longitude });
  assert.equal(resolveStation([inside], PATNA, NOW).kind, 'reading');
  assert.deepEqual(resolveStation([outside], PATNA, NOW), { kind: 'miss', miss: 'noStation' });
});

test('a nearer station with a stale reading is passed over for a current one', () => {
  const stale = station({ id: 'Stale', name: 'Stale', latitude: PATNA.latitude, longitude: PATNA.longitude,
    updatedAt: '2026-09-24T12:00:00+05:30' });
  const current = station({ id: 'Current', name: 'Current', latitude: 25.65, longitude: 85.15 });
  const result = resolveStation([stale, current], PATNA, NOW);
  assert.equal(result.kind === 'reading' && result.air.station?.name, 'Current');
});

test('a nearer station without a complete AQI is passed over too', () => {
  const partial = station({ id: 'Partial', name: 'Partial', latitude: PATNA.latitude, longitude: PATNA.longitude,
    subIndices: [{ key: 'pm10', value: 400 }] });
  const complete = station({ id: 'Complete', name: 'Complete', latitude: 25.65, longitude: 85.15 });
  const result = resolveStation([partial, complete], PATNA, NOW);
  assert.equal(result.kind === 'reading' && result.air.station?.name, 'Complete');
});

test('stations in range but none current and complete: "no current data"', () => {
  const stale = station({ updatedAt: '2026-09-24T12:00:00+05:30' });
  const partial = station({ subIndices: [{ key: 'pm10', value: 80 }] });
  assert.deepEqual(resolveStation([stale, partial], PATNA, NOW), { kind: 'miss', miss: 'noCurrentData' });
});

test('an ageing reading is still shown; a stale one never is', () => {
  // The observation threshold: stale at four hours.
  assert.equal(isUsable(station({ updatedAt: '2026-09-24T22:00:00+05:30' }), NOW), true);
  assert.equal(isUsable(station({ updatedAt: '2026-09-24T20:30:00+05:30' }), NOW), false);
});

test('a stamp from the future is a misread time, not a fresh reading', () => {
  assert.equal(isUsable(station({ updatedAt: '2026-09-25T06:00:00+05:30' }), NOW), false);
});

/* ---- the feed, through fetch ---------------------------------------- */

const realFetch = globalThis.fetch;
const realWarn = console.warn;
const savedEnv = { ...process.env };
let calls: string[] = [];
let warnings: string[] = [];

type Responder = (url: string) => Response | Promise<Response>;

function stubFetch(respond: Responder) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return respond(url);
  }) as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** CPCB answers with `rows`; Open-Meteo answers with a modelled European 42. */
function upstream(rows: unknown[], opts: { cpcbStatus?: number; fields?: unknown[] } = {}): Responder {
  return (url) => {
    if (url.startsWith('https://api.data.gov.in/')) {
      if (opts.cpcbStatus && opts.cpcbStatus !== 200) return json({ error: 'no' }, opts.cpcbStatus);
      return json({ field: opts.fields ?? LIVE_FIELDS, records: rows, total: rows.length, count: rows.length });
    }
    if (url.startsWith('https://air-quality-api.open-meteo.com/')) {
      return json({
        utc_offset_seconds: 19800,
        current: { time: '2026-09-25T00:00', european_aqi: 42, pm2_5: 20.5 },
        current_units: { pm2_5: 'μg/m³' },
      });
    }
    throw new Error(`unexpected request ${url}`);
  };
}

/** A station whose stamp is always current, whenever the test runs. */
function freshRows(): ReturnType<typeof row>[] {
  const ist = new Date(Date.now() + 5.5 * 3600_000 - 20 * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${p(ist.getUTCDate())}-${p(ist.getUTCMonth() + 1)}-${ist.getUTCFullYear()} ` +
    `${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:00`;
  return SAMANPURA.map((r) => ({ ...r, last_update: stamp }));
}

/** Each test its own coordinate, so Open-Meteo's cache cannot answer across tests. */
let placeSeq = 0;
function placeNear(lat: number, lon: number): Location {
  placeSeq += 1;
  return { ...PATNA, latitude: lat + placeSeq * 1e-4, longitude: lon } as Location;
}

beforeEach(() => {
  calls = [];
  warnings = [];
  resetCpcbFeedState();
  process.env.CPCB_DATA_GOV_API_KEY = 'test-key-123';
  delete process.env.AIR_QUALITY_SOURCE;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

test('CPCB success: a station near the place answers as CPCB', async () => {
  stubFetch(upstream(freshRows()));
  const air = await cpcbWithFallback.get(placeNear(25.6093, 85.1235));
  assert.equal(air.kind, 'aqi');
  if (air.kind !== 'aqi') return;
  assert.equal(air.standard, 'cpcb');
  assert.equal(air.value, 90);
  assert.equal(air.station?.name, 'Samanpura, Patna - BSPCB');
  assert.equal(air.fallback, undefined);
  // CPCB only: a CPCB answer costs no model request.
  assert.equal(calls.filter((u) => u.includes('open-meteo')).length, 0);
});

test('the request is the documented one: the resource, JSON, the key as a parameter', async () => {
  stubFetch(upstream(freshRows()));
  await cpcbFeed();
  const url = new URL(calls[0]);
  assert.equal(url.origin, 'https://api.data.gov.in');
  assert.equal(url.pathname, '/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69');
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(url.searchParams.get('api-key'), 'test-key-123');
});

test('one CPCB request serves concurrent places, the map, and the next visitor', async () => {
  stubFetch(upstream(freshRows()));
  await Promise.all([
    cpcbWithFallback.get(placeNear(25.6093, 85.1235)),
    cpcbWithFallback.get(placeNear(25.6093, 85.1235)),
    cpcbFeed(),
  ]);
  await cpcbWithFallback.get(placeNear(25.6093, 85.1235));
  assert.equal(calls.filter((u) => u.includes('data.gov.in')).length, 1);
});

test('fallback, no station: the modelled figure, labelled modelled and European, with the reason', async () => {
  stubFetch(upstream(freshRows()));
  const air = await cpcbWithFallback.get(placeNear(22.72, 75.86)); // Indore: nothing near in these rows
  assert.equal(air.kind, 'aqi');
  if (air.kind !== 'aqi') return;
  assert.equal(air.standard, 'european');
  assert.equal(air.provenance.nature, 'model');
  assert.equal(air.provenance.source, 'Open-Meteo (CAMS)');
  assert.equal(air.station, null);
  assert.equal(air.measure, 'concentration');
  assert.deepEqual(air.fallback, { from: 'CPCB', miss: 'noStation', withinKm: MAX_STATION_KM });
});

test('fallback, stale data: stations near but none current', async () => {
  stubFetch(upstream(SAMANPURA.map((r) => ({ ...r, last_update: '01-01-2026 00:00:00' }))));
  const air = await cpcbWithFallback.get(placeNear(25.6093, 85.1235));
  assert.equal(air.kind === 'aqi' && air.standard, 'european');
  assert.equal(air.kind === 'aqi' && air.fallback?.miss, 'noCurrentData');
});

test('fallback, CPCB down: modelled, and CPCB is not asked again for a minute', async () => {
  stubFetch(upstream([], { cpcbStatus: 502 }));
  const first = await cpcbWithFallback.get(placeNear(25.6093, 85.1235));
  const second = await cpcbWithFallback.get(placeNear(25.6093, 85.1235));
  assert.equal(first.kind === 'aqi' && first.fallback?.miss, 'unavailable');
  assert.equal(second.kind === 'aqi' && second.fallback?.miss, 'unavailable');
  assert.equal(calls.filter((u) => u.includes('data.gov.in')).length, 1);
});

test('a response off the documented schema is not used', async () => {
  stubFetch(upstream(freshRows(), { fields: LIVE_FIELDS.filter((f) => f.id !== 'avg_value') }));
  const air = await cpcbWithFallback.get(placeNear(25.6093, 85.1235));
  assert.equal(air.kind === 'aqi' && air.standard, 'european');
  assert.equal(air.kind === 'aqi' && air.fallback?.miss, 'unavailable');
  assert.ok(warnings.some((w) => w.includes('documented schema')));
});

test('no key configured: CPCB is never called, and every reading is the labelled model', async () => {
  delete process.env.CPCB_DATA_GOV_API_KEY;
  stubFetch(upstream(freshRows()));
  const air = await cpcbWithFallback.get(placeNear(25.6093, 85.1235));
  assert.equal(air.kind === 'aqi' && air.standard, 'european');
  assert.equal(calls.filter((u) => u.includes('data.gov.in')).length, 0);
});

test('the key never reaches a log, even when an error quotes the URL', async () => {
  stubFetch((url) => {
    throw new Error(`request to ${url} failed`);
  });
  await cpcbFeed();
  assert.ok(warnings.length > 0);
  assert.ok(warnings.every((w) => !w.includes('test-key-123')), warnings.join('\n'));
});

test('CPCB alone does not fall back: a miss is noData, stated', async () => {
  stubFetch(upstream(freshRows()));
  const air = await cpcbAir.get(placeNear(22.72, 75.86));
  assert.equal(air.kind, 'noData');
  if (air.kind !== 'noData') return;
  assert.equal(air.source, 'CPCB');
  assert.match(air.statement.en, /No CPCB station within 25 km/);
  assert.equal(calls.filter((u) => u.includes('open-meteo')).length, 0);
});

/* ---- choosing the source -------------------------------------------- */

test('CPCB with the modelled fallback is the default', () => {
  assert.equal(airQualitySource(), cpcbWithFallback);
  assert.equal(airQualitySource().fallback, openMeteoAir);
});

test('the source switches on one config value', () => {
  process.env.AIR_QUALITY_SOURCE = 'open-meteo';
  assert.equal(airQualitySource(), openMeteoAir);
  process.env.AIR_QUALITY_SOURCE = 'cpcb-only';
  assert.equal(airQualitySource(), cpcbAir);
  assert.equal(airQualitySource().fallback, undefined);
  process.env.AIR_QUALITY_SOURCE = 'cpcb';
  assert.equal(airQualitySource(), cpcbWithFallback);
});

test('an unknown source name fails loudly instead of changing what the index means', () => {
  process.env.AIR_QUALITY_SOURCE = 'cpbc';
  assert.throws(() => airQualitySource(), /Unknown AIR_QUALITY_SOURCE "cpbc"/);
});

/* ---- the map and the rail agree ------------------------------------- */

test('a station on the map carries the same number the rail states for it', () => {
  const stations = toStations(SAMANPURA);
  const rail = resolveStation(stations, PATNA, NOW);
  const map = stationsInBounds(stations, { west: 84, south: 25, east: 86, north: 26 }, NOW);
  assert.equal(map.length, 1);
  assert.equal(rail.kind === 'reading' && rail.air.value, map[0].value);
  assert.equal(map[0].name, 'Samanpura, Patna - BSPCB');
  assert.equal(map[0].at, '2026-09-25T00:00:00+05:30');
});

test('the map shows only stations in view with a current, complete AQI', () => {
  const inView = station({ id: 'A', name: 'A' });
  const outOfView = station({ id: 'B', name: 'B', latitude: 28.6, longitude: 77.2 });
  const stale = station({ id: 'C', name: 'C', updatedAt: '2026-09-24T12:00:00+05:30' });
  const partial = station({ id: 'D', name: 'D', subIndices: [{ key: 'pm10', value: 50 }] });
  const shown = stationsInBounds([inView, outOfView, stale, partial], { west: 84, south: 25, east: 86, north: 26 }, NOW);
  assert.deepEqual(shown.map((s) => s.name), ['A']);
});

test('a dot on the map is coloured by the band the rail names', () => {
  // Stepped, from the same table: a value never sits in one band on the rail
  // and a neighbouring colour on the map.
  const layer = aqiLayer('cpcb');
  const colourOfBand = new Map(CPCB_BANDS.map(([, band], i) => [band, layer.stops[i][1]]));
  for (let v = 0; v <= 520; v += 1) {
    assert.equal(colourFor(layer, v), colourOfBand.get(cpcbBand(v)), String(v));
  }
});

test('the two AQI scales never share a legend', () => {
  assert.equal(AQI_SCALES.cpcb.kind, 'stations');
  assert.equal(AQI_SCALES.cpcb.unit, 'AQI');
  assert.equal(AQI_SCALES.european.kind, 'points');
  assert.equal(AQI_SCALES.european.unit, 'EAQI');
  assert.equal(aqiLayer('european').stepped, undefined);
  assert.equal(aqiLayer('european').field, 'european_aqi');
});

test('the FAQ states the same station range the adapter uses', () => {
  assert.ok(STRINGS['faq.a.aqi'].en.includes(`${MAX_STATION_KM} km`));
  assert.ok(STRINGS['faq.a.aqi'].hi.includes(`${MAX_STATION_KM} किमी`));
});
