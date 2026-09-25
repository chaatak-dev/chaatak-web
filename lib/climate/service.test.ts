import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ArchiveRequest } from './archive';
import { defaultQuery, lastCompleteYear, readQuery, writeQuery, type ClimateQuery } from './params';
import { runClimateAnalysis, type ClimateDeps } from './service';
import { syntheticArchive } from './synthetic';
import type { Location, NoData } from '../weather/types';

/**
 * The request, the place and the provenance.
 *
 *   - a query is validated strictly: an impossible year is refused, never
 *     clamped into a question nobody asked;
 *   - the place goes through Chaatak's own resolver, and an unresolved one
 *     stops the analysis before the archive is asked anything;
 *   - every result says it is ERA5 reanalysis, never an observation.
 */

const NOW = new Date('2026-09-25T00:00:00Z');

test('the default is a 1991–2020 baseline and the last complete year', () => {
  const d = defaultQuery(NOW);
  assert.equal(d.baseline, '1991-2020');
  assert.equal(d.to, 2025);
  // In the first days of January the year before last is still being filled in.
  assert.equal(lastCompleteYear(new Date('2026-01-05T00:00:00Z')), 2024);
  assert.equal(lastCompleteYear(new Date('2026-01-20T00:00:00Z')), 2025);
});

test('parameters are selected, deduplicated and capped', () => {
  const r = readQuery(new URLSearchParams('place=Pune&params=tMean,precip,tMean,bogus'), NOW);
  assert.ok(r.ok);
  assert.deepEqual(r.query.params, ['tMean', 'precip']);

  const none = readQuery(new URLSearchParams('place=Pune&params=bogus'), NOW);
  assert.deepEqual(none, { ok: false, problem: 'noParams' });

  const many = readQuery(new URLSearchParams('place=Pune&params=tMean,tMax,tMin,precip,humidity'), NOW);
  assert.deepEqual(many, { ok: false, problem: 'tooManyParams' });
});

test('impossible periods and baselines are refused, not clamped', () => {
  const bad = (qs: string) => readQuery(new URLSearchParams(`place=Pune&params=tMean&${qs}`), NOW);
  assert.deepEqual(bad('from=1930&to=2020'), { ok: false, problem: 'badPeriod' });
  assert.deepEqual(bad('from=2000&to=2026'), { ok: false, problem: 'badPeriod' }, 'the year is not over');
  assert.deepEqual(bad('from=2020&to=2021'), { ok: false, problem: 'badPeriod' });
  assert.deepEqual(bad('baseline=custom&bfrom=2000&bto=2005'), { ok: false, problem: 'badBaseline' });
  assert.deepEqual(bad('baseline=1900-1930'), { ok: false, problem: 'badBaseline' });
  assert.deepEqual(readQuery(new URLSearchParams('params=tMean'), NOW), { ok: false, problem: 'noPlace' });
});

test('a custom baseline and every option survive a round trip', () => {
  const r = readQuery(
    new URLSearchParams('place=Pune&from=1971&to=2020&baseline=custom&bfrom=1951&bto=1980&params=precip&res=monthly&season=monsoon&preset=rainfall'),
    NOW,
  );
  assert.ok(r.ok);
  assert.deepEqual([r.query.baselineFrom, r.query.baselineTo, r.query.season, r.query.resolution], [1951, 1980, 'monsoon', 'monthly']);
  const again = readQuery(writeQuery(r.query), NOW);
  assert.deepEqual(again, r);
});

const JAIPUR: Location = {
  name: 'Jaipur',
  admin1: 'Rajasthan',
  admin2: 'Jaipur',
  country: 'India',
  countryCode: 'IN',
  latitude: 26.926,
  longitude: 75.8235,
  timezone: 'Asia/Kolkata',
  resolvedBy: 'Chaatak gazetteer',
  endpoint: 'gazetteer:exact',
};

function query(overrides: Partial<ClimateQuery> = {}): ClimateQuery {
  return { ...defaultQuery(NOW), place: 'Jaipur', params: ['tMean', 'gusts'], ...overrides };
}

function deps(place: Location | NoData, archiveCalls: ArchiveRequest[] = []): ClimateDeps {
  return {
    resolver: { name: 'test', resolve: async () => place },
    archive: async (request) => {
      archiveCalls.push(request);
      return syntheticArchive(Number(request.start.slice(0, 4)), Number(request.end.slice(0, 4)), {
        temperature_2m_mean: (_, year) => 20 + 0.1 * (year - 1991),
        wind_gusts_10m_max: () => 30,
      });
    },
  };
}

test('an unresolved place stops before the archive, and says so', async () => {
  const unknown: NoData = {
    kind: 'noData',
    reason: 'unknownPlace',
    source: 'Chaatak place router',
    endpoint: 'gazetteer + geocoders',
    checkedAt: NOW.toISOString(),
    statement: { hi: 'x', en: 'No place matched "Xyzzy".' },
  };
  const calls: ArchiveRequest[] = [];
  const result = await runClimateAnalysis(query({ place: 'Xyzzy' }), deps(unknown, calls));
  assert.equal(result.kind, 'unresolved');
  assert.equal(calls.length, 0, 'no neighbouring place was tried instead');
});

test('the resolved place, not the typed text, is what is analysed and named', async () => {
  const calls: ArchiveRequest[] = [];
  const result = await runClimateAnalysis(query({ place: 'jaipur ' }), deps(JAIPUR, calls));
  assert.equal(result.kind, 'analysis');
  if (result.kind !== 'analysis') return;
  assert.equal(result.place.name, 'Jaipur');
  assert.equal(result.place.district, 'Jaipur');
  assert.equal(calls[0].latitude, JAIPUR.latitude);
  // One request, both bundles, both windows.
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].bundles.sort(), ['core', 'extended']);
  assert.equal(calls[0].start, '1991-01-01');
});

test('provenance says reanalysis, ERA5, and where the grid cell is', async () => {
  const result = await runClimateAnalysis(query(), deps(JAIPUR));
  assert.equal(result.kind, 'analysis');
  if (result.kind !== 'analysis') return;
  const p = result.provenance;
  assert.equal(p.nature, 'reanalysis');
  assert.notEqual(p.nature as string, 'observation');
  assert.equal(p.dataset, 'ERA5');
  assert.equal(p.source, 'Open-Meteo');
  assert.equal(p.timeBasis, 'through');
  assert.equal(p.issuedAt, '2025-12-31');
  assert.deepEqual(p.grid, { latitude: 27, longitude: 75.75, elevation: 442 });
  assert.deepEqual(result.baseline, { from: 1991, to: 2020 });
  assert.equal(result.lead, 'series');
});

test('an archive failure is reported with its reason, never filled in', async () => {
  const result = await runClimateAnalysis(query(), {
    resolver: { name: 'test', resolve: async () => JAIPUR },
    archive: async () => ({ kind: 'archiveFailure', reason: 'rateLimited', checkedAt: NOW.toISOString() }),
  });
  assert.equal(result.kind, 'failed');
  assert.equal(result.kind === 'failed' && result.reason, 'rateLimited');
});

test('if no chosen parameter has data, the analysis says there is none', async () => {
  const result = await runClimateAnalysis(query({ params: ['soilMoisture'] }), deps(JAIPUR));
  assert.equal(result.kind === 'failed' && result.reason, 'noValues');
});
