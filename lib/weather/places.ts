/**
 * Picking a geocoder by script.
 *
 * Open-Meteo's geocoder cannot read Devanagari and Nominatim can, so the
 * choice is made on the bytes of the query, not on anything about the user.
 *
 * This is script routing, NOT language detection. It inspects which writing
 * system the string is in so it can call an API able to parse it, and behaves
 * identically whether the string was spoken or typed. The user's language
 * choice is a separate, explicit control and is never inferred from input.
 */

import { nominatimPlaces } from './nominatim';
import { openMeteoPlaces } from './open-meteo';
import type { Location, NoData, PlaceResolver } from './types';

/** Devanagari block. Covers Hindi, Marathi and Nepali. */
const DEVANAGARI = /[ऀ-ॿ]/;

export function isDevanagari(text: string): boolean {
  return DEVANAGARI.test(text);
}

export const routedPlaces: PlaceResolver = {
  name: 'Chaatak place router',

  async resolve(query: string): Promise<Location | NoData> {
    const resolver = isDevanagari(query) ? nominatimPlaces : openMeteoPlaces;
    // Each resolver stamps its own name and endpoint onto what it returns, so
    // provenance always names the geocoder that actually answered.
    return resolver.resolve(query);
  },
};
