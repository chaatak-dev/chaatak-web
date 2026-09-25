/**
 * One climate analysis, end to end: resolve the place, read the archive,
 * compute, attach provenance.
 *
 * The place goes through the SAME resolver as everything else in Chaatak —
 * the gazetteer first, a geocoder only for what it lacks, and a refusal when
 * neither can confirm the name. An unresolved place is reported as such; a
 * neighbouring district is never substituted for it.
 */

import { placeResolver } from '../weather/source';
import type { Location, NoData, PlaceResolver } from '../weather/types';
import { ARCHIVE_DATASET, ARCHIVE_PATH, ARCHIVE_SOURCE, dailyArchive, type ArchiveRequest, type DailyArchive, type ArchiveFailure } from './archive';
import { analyse, spanFor } from './analyse';
import { PARAMS, type ClimateQuery } from './params';
import type { ClimateAnalysis, ClimateResponse } from './types';

export type ClimateDeps = {
  resolver: PlaceResolver;
  archive: (request: ArchiveRequest) => Promise<DailyArchive | ArchiveFailure>;
};

const defaultDeps = (): ClimateDeps => ({
  resolver: placeResolver(),
  archive: (request) => dailyArchive(request),
});

export async function runClimateAnalysis(
  query: ClimateQuery,
  deps: ClimateDeps = defaultDeps(),
): Promise<ClimateResponse> {
  const resolved: Location | NoData = await deps.resolver.resolve(query.place);
  if ('kind' in resolved) return { kind: 'unresolved', noData: resolved };

  const span = spanFor(query);
  const bundles = [...new Set(query.params.map((p) => PARAMS[p].bundle))];
  const archive = await deps.archive({
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    timezone: resolved.timezone,
    start: span.start,
    end: span.end,
    bundles,
  });

  if (archive.kind === 'archiveFailure') {
    return { kind: 'failed', reason: archive.reason, checkedAt: archive.checkedAt };
  }

  const result = analyse(archive, query);
  if (result.params.every((p) => !p.available)) {
    return { kind: 'failed', reason: 'noValues', checkedAt: new Date().toISOString() };
  }

  const analysis: ClimateAnalysis = {
    kind: 'analysis',
    query,
    place: {
      name: resolved.name,
      district: resolved.admin2 ?? null,
      state: resolved.admin1 ?? null,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      resolvedBy: resolved.resolvedBy,
    },
    ...result,
    provenance: {
      source: ARCHIVE_SOURCE,
      dataset: ARCHIVE_DATASET,
      nature: 'reanalysis',
      endpoint: ARCHIVE_PATH,
      issuedAt: archive.dates[archive.dates.length - 1],
      timeBasis: 'through',
      fetchedAt: archive.fetchedAt,
      grid: archive.grid,
    },
  };
  return analysis;
}
