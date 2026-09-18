/**
 * Picking a geocoder by script.
 *
 * Open-Meteo's geocoder cannot read any Indic script and Nominatim can, so
 * the choice is made on the bytes of the query, not on anything about the
 * user.
 *
 * This is script routing, NOT language detection. It inspects which writing
 * system the string is in so it can call an API able to parse it, and behaves
 * identically whether the string was spoken or typed. The user's language
 * choice is a separate, explicit control and is never inferred from input.
 */

import { nominatimPlaces } from './nominatim';
import { openMeteoPlaces } from './open-meteo';
import type { Location, NoData, PlaceResolver } from './types';

/**
 * The Indic blocks Chaatak's languages are written in.
 *
 * Verified, not assumed: Open-Meteo's geocoder returns nothing for any of
 * them — not अમદાવાદ, not কলকাতা, not சென்னை, not ਅੰਮ੍ਰਿਤਸਰ, not पुणे — while
 * Nominatim resolves every one. Adding a language without adding its block
 * here would silently send that language's place names to a geocoder that
 * cannot read them.
 */
const INDIC_SCRIPTS = new RegExp(
  [
    '[\u0900-\u097F]', // Devanagari — Hindi, Marathi
    '[\u0980-\u09FF]', // Bengali
    '[\u0A00-\u0A7F]', // Gurmukhi — Punjabi
    '[\u0A80-\u0AFF]', // Gujarati
    '[\u0B80-\u0BFF]', // Tamil
  ].join('|'),
);

/** True when the text is in a script Open-Meteo's geocoder cannot read. */
export function needsIndicGeocoder(text: string): boolean {
  return INDIC_SCRIPTS.test(text);
}

/** Retained for callers that specifically mean Devanagari. */
export function isDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

export const routedPlaces: PlaceResolver = {
  name: 'Chaatak place router',

  async resolve(query: string): Promise<Location | NoData> {
    const resolver = needsIndicGeocoder(query) ? nominatimPlaces : openMeteoPlaces;
    // Each resolver stamps its own name and endpoint onto what it returns, so
    // provenance always names the geocoder that actually answered.
    return resolver.resolve(query);
  },
};
