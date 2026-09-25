/**
 * The climate record: ERA5 reanalysis, day by day, from Open-Meteo's archive.
 *
 * Separate from lib/weather/open-meteo.ts on purpose. That adapter answers
 * "what happened here last week" for the conversation, and its cache is
 * tuned to a present that moves. This one fetches decades at a time, once,
 * and is never consulted by the forecast, the chat or the alert daemon.
 *
 * ONE REQUEST PER ANALYSIS, BECAUSE OF HOW THE ARCHIVE COUNTS. Open-Meteo
 * weighs a call by its length: a 35-year daily series is hundreds of
 * "calls" against a free-tier budget of 600 a minute. Measured against the
 * live service, one such request is accepted and the next inside the same
 * minute is refused. So:
 *
 *   - every variable an analysis needs travels in ONE request, never one
 *     per variable;
 *   - the core bundle is always fetched whole, so switching from the
 *     temperature preset to the rainfall one is a cache hit, not a call;
 *   - a cached series answers any later request it COVERS — a longer range
 *     or a larger bundle serves a shorter or smaller one;
 *   - two people asking the same thing at once share one upstream request.
 *
 * A refusal is reported as exactly that — the archive is busy — and never
 * cached, never retried in a loop, never answered from anywhere else.
 */

import type { Bundle } from './params';
import { PARAMS } from './params';

export const ARCHIVE_SOURCE = 'Open-Meteo';
export const ARCHIVE_DATASET = 'ERA5';
export const ARCHIVE_HOST = 'https://archive-api.open-meteo.com';
export const ARCHIVE_PATH = '/v1/archive';

/** Decades of daily values take a few seconds to assemble upstream. */
const TIMEOUT_MS = 25_000;

/**
 * Complete years of reanalysis do not change from one day to the next;
 * ERA5's preliminary months are revised, but not within a week.
 */
export const ARCHIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Each entry is a few megabytes at most; the cap keeps an instance bounded. */
const MAX_ENTRIES = 24;

/** The fields each bundle carries, derived from the parameter catalogue. */
export function bundleFields(bundle: Bundle): string[] {
  return [...new Set(Object.values(PARAMS).filter((p) => p.bundle === bundle).map((p) => p.field))];
}

/** A place's grid cell, as the archive itself reported it. */
export type GridCell = { latitude: number; longitude: number; elevation: number | null };

export type DailyArchive = {
  kind: 'archive';
  /** YYYY-MM-DD, oldest first, consecutive. */
  dates: string[];
  /** Keyed by Open-Meteo field. A null is a day the source did not give. */
  columns: Record<string, (number | null)[]>;
  /** Keyed by Open-Meteo field, exactly as the source's unit block states. */
  units: Record<string, string>;
  grid: GridCell;
  fetchedAt: string;
};

export type ArchiveFailureReason =
  /** The free tier's per-minute budget is spent. Try again in a minute. */
  | 'rateLimited'
  /** Timed out, refused, or answered with something that is not a series. */
  | 'unreachable'
  /** The source answered, and holds nothing for this place and period. */
  | 'noValues';

export type ArchiveFailure = {
  kind: 'archiveFailure';
  reason: ArchiveFailureReason;
  checkedAt: string;
};

export type ArchiveRequest = {
  latitude: number;
  longitude: number;
  timezone: string;
  /** YYYY-MM-DD inclusive. */
  start: string;
  end: string;
  bundles: Bundle[];
};

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/* ------------------------------------------------------------------ */
/* The cache                                                           */
/* ------------------------------------------------------------------ */

type Entry = {
  place: string;
  start: string;
  end: string;
  fields: Set<string>;
  archive: DailyArchive;
  expiresAt: number;
};

const entries: Entry[] = [];
const inFlight = new Map<string, Promise<DailyArchive | ArchiveFailure>>();

/** Two decimals is ~1 km: the same gazetteer place always lands on one key. */
function placeKey(request: ArchiveRequest): string {
  return `${request.latitude.toFixed(2)},${request.longitude.toFixed(2)}`;
}

function fieldsFor(bundles: Bundle[]): string[] {
  // The core bundle always travels: it is what almost every analysis reads,
  // and fetching it alongside costs nothing extra in the archive's counting.
  const wanted = new Set<Bundle>(['core', ...bundles]);
  return [...wanted].flatMap(bundleFields);
}

function sliceArchive(archive: DailyArchive, start: string, end: string): DailyArchive {
  const from = archive.dates.indexOf(start);
  const to = archive.dates.indexOf(end);
  if (from === 0 && to === archive.dates.length - 1) return archive;
  const columns: DailyArchive['columns'] = {};
  for (const [field, values] of Object.entries(archive.columns)) {
    columns[field] = values.slice(from, to + 1);
  }
  return { ...archive, dates: archive.dates.slice(from, to + 1), columns };
}

/** A live cached series that covers this request, sliced to it. */
export function lookup(request: ArchiveRequest, now = Date.now()): DailyArchive | null {
  const place = placeKey(request);
  const fields = fieldsFor(request.bundles);
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.expiresAt <= now) {
      entries.splice(i, 1);
      continue;
    }
    if (
      entry.place === place &&
      entry.start <= request.start &&
      entry.end >= request.end &&
      fields.every((f) => entry.fields.has(f)) &&
      entry.archive.dates.includes(request.start) &&
      entry.archive.dates.includes(request.end)
    ) {
      return sliceArchive(entry.archive, request.start, request.end);
    }
  }
  return null;
}

function remember(request: ArchiveRequest, archive: DailyArchive, now = Date.now()): void {
  entries.push({
    place: placeKey(request),
    start: request.start,
    end: request.end,
    fields: new Set(Object.keys(archive.columns)),
    archive,
    expiresAt: now + ARCHIVE_TTL_MS,
  });
  while (entries.length > MAX_ENTRIES) entries.shift();
}

/** For tests: start from nothing. */
export function clearArchiveCache(): void {
  entries.length = 0;
  inFlight.clear();
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

export function archiveUrl(request: ArchiveRequest): string {
  const params = new URLSearchParams({
    latitude: request.latitude.toFixed(4),
    longitude: request.longitude.toFixed(4),
    start_date: request.start,
    end_date: request.end,
    daily: fieldsFor(request.bundles).join(','),
    // Named, not left to "best match": the dataset the page states is the
    // dataset that answered.
    models: 'era5',
    timezone: request.timezone,
  });
  return `${ARCHIVE_HOST}${ARCHIVE_PATH}?${params.toString()}`;
}

type ArchiveBody = {
  error?: boolean;
  reason?: string;
  latitude?: number;
  longitude?: number;
  elevation?: number;
  daily_units?: Record<string, string>;
  daily?: Record<string, unknown[]>;
};

function failure(reason: ArchiveFailureReason): ArchiveFailure {
  return { kind: 'archiveFailure', reason, checkedAt: new Date().toISOString() };
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Read the archive's body into columns, or say why it cannot be. */
export function readArchiveBody(body: ArchiveBody, fields: string[]): DailyArchive | ArchiveFailure {
  const time = body.daily?.time;
  if (!Array.isArray(time) || time.length === 0) return failure('noValues');
  const dates = time.filter((t): t is string => typeof t === 'string');
  if (dates.length !== time.length) return failure('unreachable');

  const columns: DailyArchive['columns'] = {};
  const units: DailyArchive['units'] = {};
  let anyValue = false;

  for (const field of fields) {
    const raw = body.daily?.[field];
    const unit = body.daily_units?.[field];
    // A field without its unit is not used: a number whose unit we would
    // have to assume is a number we would have to invent half of.
    if (!Array.isArray(raw) || raw.length !== dates.length || typeof unit !== 'string') continue;
    const values = raw.map(numberOrNull);
    if (values.some((v) => v !== null)) anyValue = true;
    columns[field] = values;
    units[field] = unit;
  }

  if (!anyValue) return failure('noValues');

  return {
    kind: 'archive',
    dates,
    columns,
    units,
    grid: {
      latitude: numberOrNull(body.latitude) ?? NaN,
      longitude: numberOrNull(body.longitude) ?? NaN,
      elevation: numberOrNull(body.elevation),
    },
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchUpstream(
  request: ArchiveRequest,
  fetcher: Fetcher,
): Promise<DailyArchive | ArchiveFailure> {
  let res: Response;
  try {
    res = await fetcher(archiveUrl(request), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
      // Our own cache holds the parsed series; Next's would double up and
      // cannot hold a body this size anyway.
      cache: 'no-store',
    });
  } catch {
    return failure('unreachable');
  }

  if (res.status === 429) return failure('rateLimited');
  if (!res.ok) return failure('unreachable');

  let body: ArchiveBody;
  try {
    body = (await res.json()) as ArchiveBody;
  } catch {
    return failure('unreachable');
  }
  if (body.error) {
    return failure(/limit/i.test(body.reason ?? '') ? 'rateLimited' : 'unreachable');
  }

  return readArchiveBody(body, fieldsFor(request.bundles));
}

/**
 * The daily series for one place and span, from cache when it can be.
 *
 * @param fetcher injectable for tests; the real `fetch` otherwise.
 */
export async function dailyArchive(
  request: ArchiveRequest,
  fetcher: Fetcher = fetch,
): Promise<DailyArchive | ArchiveFailure> {
  const hit = lookup(request);
  if (hit) return hit;

  const key = `${placeKey(request)}:${request.start}:${request.end}:${fieldsFor(request.bundles).join(',')}`;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = fetchUpstream(request, fetcher)
    .then((result) => {
      // Only a series is remembered. A refusal or an outage is a fact about
      // this minute, not about the place.
      if (result.kind === 'archive') remember(request, result);
      return result;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}
