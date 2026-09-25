/**
 * Synthetic daily archives, for tests only.
 *
 * Nothing user-facing imports this. It builds series whose statistics are
 * known in advance — a steady warming of exactly 0.3 °C a year, rain on
 * exactly the days a test says — so the analysis can be checked against
 * arithmetic rather than against itself.
 */

import type { DailyArchive } from './archive';
import { PARAMS } from './params';

export type DayFn = (date: string, year: number, month: number, day: number) => number | null;

const UNITS: Record<string, string> = Object.fromEntries(
  Object.values(PARAMS).map((p) => [p.field, p.upstreamUnit ?? (p.aggregate === 'count' ? 'mm' : p.unit)]),
);

export function syntheticArchive(
  fromYear: number,
  toYear: number,
  fields: Record<string, DayFn>,
): DailyArchive {
  const dates: string[] = [];
  for (let t = Date.UTC(fromYear, 0, 1); t <= Date.UTC(toYear, 11, 31); t += 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  const columns: DailyArchive['columns'] = {};
  const units: DailyArchive['units'] = {};
  for (const [field, fn] of Object.entries(fields)) {
    columns[field] = dates.map((d) => fn(d, Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10))));
    units[field] = UNITS[field];
  }
  return {
    kind: 'archive',
    dates,
    columns,
    units,
    grid: { latitude: 27, longitude: 75.75, elevation: 442 },
    fetchedAt: '2026-09-25T00:00:00.000Z',
  };
}
