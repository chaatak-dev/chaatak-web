/**
 * One canonical weather snapshot for one resolved place, assembled on the
 * server.
 *
 * Every surface that shows weather gets it from here: the weather route the
 * rail calls, the chat pipeline, and the Telegram bot. It was written out
 * twice — once in the weather route and once in the chat route — and a third
 * copy for Telegram would have been three places deciding which source
 * answers what. There is one, so the three cannot drift apart.
 *
 * It does no arithmetic on any value, fills in no gap, and substitutes no
 * second source when the first is quiet. Current conditions and the outlook
 * come from Open-Meteo and warnings from IMD; that division is the adapters'
 * business, not this function's.
 */

import { OUTLOOK_DAYS, type WeatherSnapshot } from './api';
import { weatherSource } from './source';
import type { DistrictId, Location, Severity, Warning } from './types';

/** The district a place is warned under: the unit IMD issues warnings for. */
export function districtOf(place: Location): DistrictId {
  return (place.admin2 ?? place.name) as DistrictId;
}

export async function snapshotFor(place: Location): Promise<WeatherSnapshot> {
  const source = weatherSource();

  const [current, outlook, warnings] = await Promise.all([
    source.getCurrent(place),
    source.getForecast(place, OUTLOOK_DAYS),
    source.getWarnings(districtOf(place)),
  ]);

  return { place, current, outlook, warnings, fetchedAt: new Date().toISOString() };
}

const RANK: Record<Severity, number> = { none: 0, watch: 1, alert: 2, warning: 3 };

/**
 * The loudest severity in force, or `unknown` when the source could not say.
 *
 * `none` means IMD was asked and lists nothing. `unknown` means we do not
 * know — no warning product, or a failed lookup — and the two are kept apart
 * because collapsing them would turn a lookup failure into an all-clear.
 */
export function worstSeverity(
  warnings: WeatherSnapshot['warnings'],
): Severity | 'unknown' {
  if (Array.isArray(warnings)) {
    // Adapters never return an empty list, but if one did it would say
    // nothing, and nothing is not an all-clear.
    if (warnings.length === 0) return 'unknown';
    return warnings.reduce<Severity>(
      (worst, w) => (RANK[w.severity] > RANK[worst] ? w.severity : worst),
      'none',
    );
  }
  return warnings.kind === 'noWarning' ? 'none' : 'unknown';
}

/** The warnings in force, loudest first. Empty for noWarning and noData. */
export function warningsInForce(warnings: WeatherSnapshot['warnings']): Warning[] {
  if (!Array.isArray(warnings)) return [];
  return [...warnings].sort((a, b) => RANK[b.severity] - RANK[a.severity]);
}
