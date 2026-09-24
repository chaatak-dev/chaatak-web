/**
 * CPCB's National Air Quality Index, from its real-time station feed.
 *
 * THE CONTRACT, AND WHERE EACH PART OF IT COMES FROM. Nothing here is taken
 * from a third-party example.
 *
 *   The resource. data.gov.in resource 3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69,
 *   published by CPCB as "Real time Air Quality Index from various
 *   locations", updated hourly. Its description: "Real time National Air
 *   Quality Index values from different monitoring stations across India."
 *
 *   The fields. The API describes its own schema in `field` on every
 *   response: country, state, city, station, last_update, latitude,
 *   longitude, pollutant_id, min_value, max_value, avg_value — all strings,
 *   one row per station per pollutant. `verifyContract` refuses a response
 *   whose schema lacks any field read below, rather than guessing.
 *
 *   What the values are. Index values — each pollutant's SUB-INDEX, not its
 *   concentration. The provider says so, and its own rows agree: CO reads
 *   1–198 across the network, which is impossible as mg/m³ and ordinary as a
 *   sub-index. So the station's AQI is formed the way CPCB defines the
 *   National AQI: the highest sub-index, and only when at least three
 *   pollutants report, one of them PM2.5 or PM10. Recomputing sub-indices
 *   from these numbers would treat an index as a concentration.
 *
 *   Time. `last_update` is "DD-MM-YYYY HH:mm:ss" with no zone. It is read as
 *   IST: CPCB is an Indian network, and read as UTC every stamp in the feed
 *   would sit five and a half hours in the future of the response's own
 *   `updated_date`. A stamp in the future is refused rather than trusted.
 *
 *   The data is unvalidated. The provider's note: "displayed live without
 *   human intervention … may display some errors or abnormal values." A
 *   reading is therefore always shown as a named station's observation with
 *   its time, never as a verified city figure.
 *
 * ONE FEED, ONE REQUEST. The whole network is about 3,500 rows and fits one
 * page, so the rail and the map both read one cached copy, and concurrent
 * misses share one in-flight request. Nothing asks CPCB per place.
 */

import { TTL, cached, forget } from '../cache';
import { cpcbBand } from './aqi-bands';
import { freshness } from './freshness';
import type { AirQuality, AirQualitySource } from './aqi';
import type { Location, NoData, Provenance } from './types';

export const CPCB_SOURCE = 'CPCB';
const HOST = 'https://api.data.gov.in';
const RESOURCE = '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69';
const ENDPOINT = `/resource/${RESOURCE}`;
const PAGE = 5000;
/** A bound on paging, so a malformed `total` cannot loop. */
const MAX_PAGES = 4;
const TIMEOUT_MS = 6000;
/** After a failure, how long to answer from memory instead of asking again. */
const FAILURE_BACKOFF_MS = 60 * 1000;

/**
 * How far a station may be from the place and still speak for it.
 *
 * Air quality changes across a city, let alone a district. Beyond this the
 * nearest station is describing somewhere else, and the modelled figure —
 * labelled as modelled — is the more honest answer.
 */
export const MAX_STATION_KM = 25;

/** Every field this adapter reads. A response without one is not the contract. */
const REQUIRED_FIELDS = [
  'state',
  'city',
  'station',
  'last_update',
  'latitude',
  'longitude',
  'pollutant_id',
  'avg_value',
] as const;

/** CPCB's pollutant ids, as the feed spells them, to the keys the rail shows. */
const POLLUTANT_KEY: Record<string, string> = {
  'PM2.5': 'pm2_5',
  PM10: 'pm10',
  NO2: 'no2',
  SO2: 'so2',
  OZONE: 'o3',
  CO: 'co',
  NH3: 'nh3',
};

const PARTICULATES = new Set(['pm2_5', 'pm10']);

/* ------------------------------------------------------------------ */
/* The feed                                                            */
/* ------------------------------------------------------------------ */

export type CpcbStation = {
  /** CPCB names every station uniquely; the feed has no other id. */
  id: string;
  name: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  /**
   * The row's own stamp, ISO with the IST offset. Where a station's rows
   * disagree, the oldest — a reading is as current as its stalest part.
   */
  updatedAt: string;
  subIndices: { key: string; value: number }[];
};

export type CpcbFeed =
  | { ok: true; stations: CpcbStation[] }
  | { ok: false; problem: 'unconfigured' | 'unreachable' | 'contract' };

type Row = Record<string, unknown>;
type Body = { field?: { id?: unknown }[]; records?: unknown; total?: unknown };

/** "25-09-2026 00:00:00", read as IST. Null for anything else. */
export function parseCpcbTime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+05:30`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** A sub-index as the feed writes it: a number, or "NA" when the monitor had none. */
function subIndex(raw: unknown): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function text(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Whether a response is the documented shape.
 *
 * Checked against the schema the API itself sends. A renamed or missing field
 * fails loudly here, so it cannot turn into a silently empty network and a
 * fallback nobody notices.
 */
export function verifyContract(body: Body): boolean {
  if (!Array.isArray(body.records)) return false;
  if (!Array.isArray(body.field)) return false;
  const ids = new Set(body.field.map((f) => f?.id));
  return REQUIRED_FIELDS.every((id) => ids.has(id));
}

/** One row per station per pollutant, folded into one entry per station. */
export function toStations(records: Row[]): CpcbStation[] {
  const byStation = new Map<string, CpcbStation>();

  for (const row of records) {
    const name = text(row.station);
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    const updatedAt = parseCpcbTime(row.last_update);
    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !updatedAt) continue;

    let station = byStation.get(name);
    if (!station) {
      station = {
        id: name,
        name,
        city: text(row.city),
        state: text(row.state),
        latitude,
        longitude,
        updatedAt,
        subIndices: [],
      };
      byStation.set(name, station);
    } else if (Date.parse(updatedAt) < Date.parse(station.updatedAt)) {
      station.updatedAt = updatedAt;
    }

    const value = subIndex(row.avg_value);
    const id = text(row.pollutant_id);
    if (value === null || !id) continue;
    // An id this file does not know is still on the same scale, and still
    // counts: leaving it out could only ever make the AQI read lower.
    const key = POLLUTANT_KEY[id] ?? id.toLowerCase();
    if (!station.subIndices.some((s) => s.key === key)) station.subIndices.push({ key, value });
  }

  return [...byStation.values()];
}

/**
 * The station's AQI as CPCB defines it, or null when CPCB would not state one.
 *
 * The highest sub-index, and only with at least three pollutants reporting,
 * one of them particulate. A station reporting only ozone and NO2 does not
 * have an AQI, however confident its two numbers look.
 */
export function stationAqi(station: CpcbStation): { value: number; dominant: string } | null {
  const parts = station.subIndices;
  if (parts.length < 3) return null;
  if (!parts.some((p) => PARTICULATES.has(p.key))) return null;
  const top = parts.reduce((a, b) => (b.value > a.value ? b : a));
  return { value: top.value, dominant: top.key };
}

let inFlight: Promise<CpcbFeed> | null = null;
let failedUntil = 0;

async function fetchPage(key: string, offset: number): Promise<Body> {
  const url =
    `${HOST}${ENDPOINT}?api-key=${encodeURIComponent(key)}` +
    `&format=json&limit=${PAGE}&offset=${offset}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  // The status only. The URL carries the key and must never reach a log.
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Body;
}

async function loadFeed(): Promise<CpcbFeed> {
  const key = process.env.CPCB_DATA_GOV_API_KEY?.trim();
  if (!key) return { ok: false, problem: 'unconfigured' };

  let records: Row[] = [];
  try {
    const first = await fetchPage(key, 0);
    if (!verifyContract(first)) {
      console.warn('[cpcb] response does not match the documented schema; not used');
      return { ok: false, problem: 'contract' };
    }
    records = first.records as Row[];
    const total = Number(first.total);
    for (let page = 1; page < MAX_PAGES && Number.isFinite(total) && records.length < total; page += 1) {
      const next = await fetchPage(key, records.length);
      if (!Array.isArray(next.records) || next.records.length === 0) break;
      records = records.concat(next.records as Row[]);
    }
  } catch (error) {
    // The key travels in the URL, and some runtimes quote the URL in an
    // error. It is scrubbed from whatever is logged.
    const message = error instanceof Error ? error.message.replaceAll(key, '<key>') : 'unknown';
    console.warn('[cpcb] feed unreachable:', message);
    return { ok: false, problem: 'unreachable' };
  }

  return { ok: true, stations: toStations(records) };
}

/**
 * The whole network, from one cached copy.
 *
 * Concurrent callers share one request, a success is held for the feed's
 * cadence, and a failure is remembered briefly so a CPCB outage costs one
 * timeout a minute rather than one per visitor. A failure is never cached as
 * data.
 */
export function cpcbFeed(): Promise<CpcbFeed> {
  if (Date.now() < failedUntil) {
    return Promise.resolve({ ok: false, problem: 'unreachable' });
  }
  if (inFlight) return inFlight;

  inFlight = cached<CpcbFeed>('cpcb:feed', TTL.airStations, loadFeed, (feed) => feed.ok)
    .then((feed) => {
      if (!feed.ok && feed.problem !== 'unconfigured') failedUntil = Date.now() + FAILURE_BACKOFF_MS;
      return feed;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** For tests: forget the cached feed, the in-flight request and any backoff. */
export function resetCpcbFeedState(): void {
  forget('cpcb:feed');
  inFlight = null;
  failedUntil = 0;
}

/* ------------------------------------------------------------------ */
/* Station resolution                                                  */
/* ------------------------------------------------------------------ */

/** Great-circle distance in kilometres. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function provenanceFor(station: CpcbStation): Provenance {
  return {
    source: CPCB_SOURCE,
    endpoint: ENDPOINT,
    issuedAt: station.updatedAt,
    timeBasis: 'updated',
    nature: 'observation',
    observedAt: station.updatedAt,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * May this station's reading be shown as current?
 *
 * Current by the observation threshold every other instrument reading is held
 * to, and not from the future — a future stamp means the time was misread,
 * not that the reading is fresh.
 */
export function isUsable(station: CpcbStation, now = new Date()): boolean {
  const at = Date.parse(station.updatedAt);
  if (Number.isNaN(at) || at > now.getTime() + 15 * 60 * 1000) return false;
  return freshness(provenanceFor(station), now).state !== 'stale';
}

/**
 * Why CPCB could not answer for a place, in words a reader can use.
 *
 *   noStation      no CPCB station within MAX_STATION_KM
 *   noCurrentData  stations are near, but none has a current, complete reading
 *   unavailable    the feed itself could not be read
 */
export type CpcbMiss = 'noStation' | 'noCurrentData' | 'unavailable';

export type CpcbResolution =
  | { kind: 'reading'; air: AirQuality }
  | { kind: 'miss'; miss: CpcbMiss };

/**
 * The reading for a place: the nearest station within range that has a
 * current, complete AQI.
 *
 * Nearest by the canonical place's coordinate. A nearer station with no
 * usable reading is passed over for the next one in range, and never averaged
 * with it: an AQI belongs to the station that measured it.
 */
export function resolveStation(
  stations: CpcbStation[],
  location: Location,
  now = new Date(),
): CpcbResolution {
  const inRange = stations
    .map((station) => ({
      station,
      km: distanceKm(location.latitude, location.longitude, station.latitude, station.longitude),
    }))
    .filter((s) => s.km <= MAX_STATION_KM)
    .sort((a, b) => a.km - b.km);

  if (inRange.length === 0) return { kind: 'miss', miss: 'noStation' };

  for (const { station, km } of inRange) {
    if (!isUsable(station, now)) continue;
    const aqi = stationAqi(station);
    if (!aqi) continue;

    return {
      kind: 'reading',
      air: {
        kind: 'aqi',
        value: aqi.value,
        standard: 'cpcb',
        band: cpcbBand(aqi.value),
        measure: 'subIndex',
        components: [...station.subIndices]
          .sort((a, b) => b.value - a.value)
          .map((s) => ({ key: s.key, value: s.value, unit: '' })),
        station: { id: station.id, name: station.name, distanceKm: Math.round(km * 10) / 10 },
        provenance: provenanceFor(station),
      },
    };
  }

  return { kind: 'miss', miss: 'noCurrentData' };
}

/** A place's CPCB reading, from the shared feed. */
export async function resolveCpcb(location: Location): Promise<CpcbResolution> {
  const feed = await cpcbFeed();
  if (!feed.ok) return { kind: 'miss', miss: 'unavailable' };
  return resolveStation(feed.stations, location);
}

/**
 * Every station with a current, complete AQI inside a box — the map's layer.
 *
 * The same feed, the same usability rule and the same AQI rule as the rail,
 * so a dot on the map and the rail's reading for that station are one number.
 * Bounded by the network itself: there are about five hundred stations.
 */
export function stationsInBounds(
  stations: CpcbStation[],
  bounds: { west: number; south: number; east: number; north: number },
  now = new Date(),
): { lat: number; lon: number; value: number; name: string; at: string }[] {
  const out: { lat: number; lon: number; value: number; name: string; at: string }[] = [];
  for (const station of stations) {
    if (
      station.latitude < bounds.south ||
      station.latitude > bounds.north ||
      station.longitude < bounds.west ||
      station.longitude > bounds.east
    ) {
      continue;
    }
    if (!isUsable(station, now)) continue;
    const aqi = stationAqi(station);
    if (!aqi) continue;
    out.push({
      lat: station.latitude,
      lon: station.longitude,
      value: aqi.value,
      name: station.name,
      at: station.updatedAt,
    });
  }
  return out;
}

function noData(miss: CpcbMiss): NoData {
  const statement = {
    noStation: {
      hi: `${MAX_STATION_KM} किमी के भीतर CPCB का कोई स्टेशन नहीं है।`,
      en: `No CPCB station within ${MAX_STATION_KM} km.`,
    },
    noCurrentData: {
      hi: 'पास के CPCB स्टेशनों का कोई ताज़ा, पूरा आँकड़ा नहीं है।',
      en: 'No nearby CPCB station has a current, complete reading.',
    },
    unavailable: {
      hi: 'CPCB का आँकड़ा अभी नहीं मिल सका।',
      en: 'CPCB data could not be fetched right now.',
    },
  }[miss];
  return {
    kind: 'noData',
    reason: miss === 'unavailable' ? 'lookupFailed' : 'notInBulletin',
    source: CPCB_SOURCE,
    endpoint: ENDPOINT,
    checkedAt: new Date().toISOString(),
    statement,
  };
}

/** CPCB alone, with no fallback: a miss is a miss. */
export const cpcbAir: AirQualitySource = {
  name: CPCB_SOURCE,
  standard: 'cpcb',
  async get(location: Location): Promise<AirQuality | NoData> {
    const result = await resolveCpcb(location);
    return result.kind === 'reading' ? result.air : noData(result.miss);
  },
};
