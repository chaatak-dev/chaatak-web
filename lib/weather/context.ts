'use client';

/**
 * The browser's one view of the weather at one place.
 *
 * WHY A CONTEXT AND NOT TWO FETCHES. The conversation and the rail are two
 * surfaces showing the same weather. If each asked for its own, they would
 * land in different cache windows and disagree by a degree — and they would
 * disagree visibly, side by side, at the moment somebody was reading both.
 * So there is one snapshot, and whoever obtains it first shares it.
 *
 * Two ways in, one shape out:
 *
 *   the chat route returns the snapshot it answered from → adopted as-is
 *   the rail needs a place the chat has not asked about → fetched here
 *
 * Neither path re-fetches what the other already has for the same place.
 */

import type { WeatherSnapshot } from './api';
import type { AirQuality } from './aqi';
import type { NoData } from './types';

/** What the rail is currently showing, and why. */
export type WeatherContextState =
  /** Nothing asked for yet. The rail shows its empty state and guesses nothing. */
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'ready'; snapshot: WeatherSnapshot }
  /** The place could not be resolved, in the resolver's own words. */
  | { status: 'unresolved'; noData: NoData }
  | { status: 'failed' };

/**
 * Where the rail's location came from.
 *
 * Shown, because "the place you asked about" and "where this device says you
 * are" are different claims and the interface must not blur them.
 */
export type WeatherOrigin = 'conversation' | 'device' | 'saved' | 'search';

/** A key that is the same for the same place, so a fetch can be skipped. */
export function locationKey(
  place: { latitude: number; longitude: number } | null | undefined,
): string | null {
  if (!place) return null;
  return `${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`;
}

/** True when the snapshot already describes this place. */
export function describesSame(
  state: WeatherContextState,
  place: { latitude: number; longitude: number } | null | undefined,
): boolean {
  if (state.status !== 'ready') return false;
  return locationKey(state.snapshot.place) === locationKey(place);
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

type WeatherApiResponse =
  | ({ kind: 'resolved' } & WeatherSnapshot)
  | { kind: 'unresolved'; noData: NoData };

/**
 * A snapshot for a named place or a point.
 *
 * Only called when the conversation has not already produced one for this
 * location — see `describesSame`.
 */
export async function fetchSnapshot(
  target: { place: string } | { latitude: number; longitude: number },
  signal?: AbortSignal,
): Promise<WeatherContextState> {
  const query =
    'place' in target
      ? `place=${encodeURIComponent(target.place)}`
      : `lat=${target.latitude}&lon=${target.longitude}`;

  try {
    const res = await fetch(`/api/weather?${query}`, { signal, cache: 'no-store' });
    if (!res.ok) return { status: 'failed' };

    const body = (await res.json()) as WeatherApiResponse;
    if (body.kind === 'unresolved') return { status: 'unresolved', noData: body.noData };

    return {
      status: 'ready',
      snapshot: {
        place: body.place,
        current: body.current,
        outlook: body.outlook,
        warnings: body.warnings,
        fetchedAt: body.fetchedAt ?? new Date().toISOString(),
      },
    };
  } catch (error) {
    // An aborted request is a request that was replaced, not one that failed.
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { status: 'loading', query };
    }
    return { status: 'failed' };
  }
}

export type AirQualityState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; air: AirQuality }
  | { status: 'unavailable'; noData: NoData }
  | { status: 'failed' };

/**
 * Air quality, asked for only when somebody selects that metric.
 *
 * A separate provider on a separate cadence, so a slow air-quality service
 * never delays the temperature.
 */
export async function fetchAirQuality(
  place: { latitude: number; longitude: number },
  signal?: AbortSignal,
): Promise<AirQualityState> {
  try {
    const res = await fetch(
      `/api/aqi?lat=${place.latitude}&lon=${place.longitude}`,
      { signal, cache: 'no-store' },
    );
    if (!res.ok) return { status: 'failed' };

    const body = (await res.json()) as
      | { kind: 'resolved'; air: AirQuality | NoData }
      | { kind: 'unresolved'; noData: NoData };

    if (body.kind === 'unresolved') return { status: 'unavailable', noData: body.noData };
    if ('kind' in body.air && body.air.kind === 'noData') {
      return { status: 'unavailable', noData: body.air };
    }
    return { status: 'ready', air: body.air as AirQuality };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { status: 'loading' };
    }
    return { status: 'failed' };
  }
}
