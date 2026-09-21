/**
 * Which IMD station, if any, speaks for a place.
 *
 * IMD publishes observations and city forecasts per station and gives no
 * coordinates for them. `npm run build:imd-stations` resolves each station's
 * name against the gazetteer and commits the result, dropping any station it
 * could not locate rather than placing it approximately.
 *
 * What is left here is the question that decides honesty: a station exists,
 * but is it near enough to speak for the place someone asked about?
 */

import data from './imd-stations.json';

export type ImdStation = {
  id: string;
  /** IMD's own name for the site, kept so the mapping stays auditable. */
  name: string;
  /** The gazetteer place its coordinates came from. */
  place: string;
  lat: number;
  lon: number;
};

export type StationKind = 'observation' | 'forecast';

/**
 * How far a station may be and still speak for a place.
 *
 * Chosen from the data rather than from taste. Across the 2,313 places in the
 * gazetteer, the nearest located station is a median 38km away for
 * observations and 18km for forecasts; at 50km, IMD covers 66% of places for
 * observations and 88% for forecasts.
 *
 * Fifty kilometres is about as far as a surface observation can be stretched
 * before it stops describing where you are — and there is no pressure to
 * stretch it, because what lies beyond is not a blank but Open-Meteo, under
 * its own name. Being strict here costs coverage of IMD specifically; it never
 * costs the user an answer. A loose ceiling would buy the opposite: an IMD
 * provenance line over a number measured somewhere else.
 */
export const MAX_STATION_KM = 50;

/** Equirectangular: exact enough at this scale and far cheaper than haversine. */
export function distanceKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const dy = (aLat - bLat) * 111.32;
  const dx = (aLon - bLon) * 111.32 * Math.cos((aLat * Math.PI) / 180);
  return Math.sqrt(dy * dy + dx * dx);
}

export function stations(kind: StationKind): ImdStation[] {
  return (kind === 'observation' ? data.observation : data.forecast) as ImdStation[];
}

export type NearestStation = { station: ImdStation; km: number };

/**
 * The nearest station within the ceiling, or nothing.
 *
 * Nothing is a real answer here and the caller must honour it: it means IMD
 * has no station close enough to speak for this place, and the reading has to
 * come from somewhere else and say so.
 */
export function nearestStation(
  kind: StationKind,
  latitude: number,
  longitude: number,
  maxKm = MAX_STATION_KM,
): NearestStation | null {
  let best: ImdStation | null = null;
  let bestKm = Infinity;

  for (const station of stations(kind)) {
    const km = distanceKm(latitude, longitude, station.lat, station.lon);
    if (km < bestKm) {
      bestKm = km;
      best = station;
    }
  }

  if (!best || bestKm > maxKm) return null;
  return { station: best, km: bestKm };
}

export const STATIONS_SOURCE = data.source;
export const STATIONS_GENERATED = data.generated;
