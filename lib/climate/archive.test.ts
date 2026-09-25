import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { bundleFields, clearArchiveCache, dailyArchive, readArchiveBody, type ArchiveRequest } from './archive';

/**
 * The archive adapter's contract.
 *
 * The free tier accepts roughly one multi-decade request a minute, so the
 * properties that matter are about how FEW requests leave: one per analysis,
 * none for a range a cached series already covers, one for two identical
 * requests in flight — and a refusal that is reported, not cached.
 */

beforeEach(() => clearArchiveCache());

function request(overrides: Partial<ArchiveRequest> = {}): ArchiveRequest {
  return {
    latitude: 26.926,
    longitude: 75.8235,
    timezone: 'Asia/Kolkata',
    start: '1991-01-01',
    end: '2025-12-31',
    bundles: ['core'],
    ...overrides,
  };
}

/** An upstream-shaped body for the dates and fields the URL asked for. */
function bodyFor(url: string) {
  const u = new URL(url);
  const start = Date.parse(`${u.searchParams.get('start_date')}T00:00:00Z`);
  const end = Date.parse(`${u.searchParams.get('end_date')}T00:00:00Z`);
  const time: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) time.push(new Date(t).toISOString().slice(0, 10));
  const fields = (u.searchParams.get('daily') ?? '').split(',');
  const daily: Record<string, unknown[]> = { time };
  const units: Record<string, string> = { time: 'iso8601' };
  for (const f of fields) {
    daily[f] = time.map(() => 1);
    units[f] = 'x';
  }
  return { latitude: 27, longitude: 75.75, elevation: 442, daily_units: units, daily };
}

function counting(respond: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    return respond(url);
  };
  return { calls, fetcher };
}

const ok = (url: string) => Response.json(bodyFor(url));

test('one request carries every field, names ERA5, and always includes the core bundle', async () => {
  const { calls, fetcher } = counting(ok);
  const result = await dailyArchive(request({ bundles: ['extended'] }), fetcher);
  assert.equal(result.kind, 'archive');
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]);
  assert.equal(url.searchParams.get('models'), 'era5');
  const daily = url.searchParams.get('daily')!.split(',');
  for (const f of [...bundleFields('core'), ...bundleFields('extended')]) assert.ok(daily.includes(f), f);
});

test('a cached series serves any shorter range and smaller bundle inside it, without a call', async () => {
  const { calls, fetcher } = counting(ok);
  await dailyArchive(request({ start: '1961-01-01', bundles: ['core', 'extended'] }), fetcher);
  const inner = await dailyArchive(request({ start: '2000-01-01', end: '2010-12-31' }), fetcher);
  assert.equal(calls.length, 1);
  assert.equal(inner.kind, 'archive');
  if (inner.kind !== 'archive') return;
  assert.equal(inner.dates[0], '2000-01-01');
  assert.equal(inner.dates[inner.dates.length - 1], '2010-12-31');
  assert.equal(inner.columns.temperature_2m_mean.length, inner.dates.length);

  // A range the cache does not cover goes upstream.
  await dailyArchive(request({ start: '1950-01-01' }), fetcher);
  assert.equal(calls.length, 2);
});

test('a different place is never served from another place’s cache', async () => {
  const { calls, fetcher } = counting(ok);
  await dailyArchive(request(), fetcher);
  await dailyArchive(request({ latitude: 19.07, longitude: 72.88 }), fetcher);
  assert.equal(calls.length, 2);
});

test('two identical requests in flight share one upstream call', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const { calls, fetcher } = counting(async (url) => {
    await gate;
    return ok(url);
  });
  const a = dailyArchive(request(), fetcher);
  const b = dailyArchive(request(), fetcher);
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls.length, 1);
  assert.equal(ra, rb);
});

test('a rate limit is reported as such and never cached', async () => {
  const { calls, fetcher } = counting(() =>
    Response.json({ error: true, reason: 'Minutely API request limit exceeded.' }, { status: 429 }),
  );
  const first = await dailyArchive(request(), fetcher);
  assert.deepEqual(first.kind === 'archiveFailure' && first.reason, 'rateLimited');
  await dailyArchive(request(), fetcher);
  assert.equal(calls.length, 2, 'the refusal was not remembered');
});

test('an outage is unreachable, and an empty answer is no values', async () => {
  const down = counting(() => {
    throw new Error('ECONNRESET');
  });
  const r1 = await dailyArchive(request(), down.fetcher);
  assert.equal(r1.kind === 'archiveFailure' && r1.reason, 'unreachable');

  const empty = counting(() => Response.json({ daily: { time: [] }, daily_units: {} }));
  const r2 = await dailyArchive(request({ latitude: 1, longitude: 1 }), empty.fetcher);
  assert.equal(r2.kind === 'archiveFailure' && r2.reason, 'noValues');
});

test('a field without its unit is dropped, not assumed', () => {
  const result = readArchiveBody(
    {
      daily: { time: ['2020-01-01'], temperature_2m_mean: [20], precipitation_sum: [1] },
      daily_units: { temperature_2m_mean: '°C' },
    },
    ['temperature_2m_mean', 'precipitation_sum'],
  );
  assert.equal(result.kind, 'archive');
  if (result.kind !== 'archive') return;
  assert.deepEqual(Object.keys(result.columns), ['temperature_2m_mean']);
});

test('a series of nothing but nulls is no values', () => {
  const result = readArchiveBody(
    { daily: { time: ['2020-01-01'], temperature_2m_mean: [null] }, daily_units: { temperature_2m_mean: '°C' } },
    ['temperature_2m_mean'],
  );
  assert.equal(result.kind === 'archiveFailure' && result.reason, 'noValues');
});
