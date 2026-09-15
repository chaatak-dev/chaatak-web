/**
 * The one config value that switches sources.
 *
 * Phase 4 adds the IMD adapter and changes `WEATHER_SOURCE` to 'imd'. Nothing
 * above the adapter layer changes — that is the whole point of the interface.
 *
 * The place resolver is deliberately not switched with it: a geocode is not a
 * weather value, and IMD has no geocoder.
 */

import { openMeteo } from './open-meteo';
import { routedPlaces } from './places';
import type { PlaceResolver, WeatherSource } from './types';

const WEATHER_SOURCE = process.env.WEATHER_SOURCE ?? 'open-meteo';

const SOURCES: Record<string, WeatherSource> = {
  'open-meteo': openMeteo,
};

export function weatherSource(): WeatherSource {
  const source = SOURCES[WEATHER_SOURCE];
  if (!source) {
    throw new Error(
      `Unknown WEATHER_SOURCE "${WEATHER_SOURCE}". Known: ${Object.keys(SOURCES).join(', ')}`,
    );
  }
  return source;
}

/**
 * Routed by script: Open-Meteo for Latin, Nominatim for Devanagari. Not
 * switched by WEATHER_SOURCE — a geocode is not a weather value, and IMD has
 * no geocoder, so this survives the Phase 4 swap unchanged.
 */
export function placeResolver(): PlaceResolver {
  return routedPlaces;
}
