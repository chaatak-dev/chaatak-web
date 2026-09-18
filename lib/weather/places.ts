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

/**
 * Reduce a place or administrative name to something comparable.
 *
 * Geocoders spell the same place several ways — "Barabanki" and "Bāra Bankī",
 * "Hisar" and "Hissār District" — so accents, spacing and the administrative
 * suffix all have to come off before two names can be compared at all.
 *
 * Latin only, by construction: it keeps [a-z0-9] and nothing else. Devanagari
 * queries never reach here, and anything that folds to an empty string is
 * treated as uncorroborated rather than silently matching.
 */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\b(?:district|dist|division|tehsil|taluka?)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Does the geocoder's own answer put this place somewhere consistent with its
 * name?
 *
 * Chaatak is district-based: warnings are issued per district, and admin2 is
 * what the IMD swap maps to a district id. A place that gives its district its
 * name — Ghaziabad in Ghaziabad, Nashik in Nashik — is corroborated by the
 * geocoder's own hierarchy. A place whose only match sits in an unrelated
 * district is exactly the ambiguity a single index cannot settle.
 *
 * That is the whole failure this exists for. Open-Meteo's index does not hold
 * the Uttar Pradesh district under the spelling "Barabanki" — it holds an
 * unrelated hamlet in Balangir, Odisha, and returns it as its ONLY result, so
 * no amount of ranking or re-reading that response can find the right answer.
 * The only way to detect a missing entry is to ask a second, independent index.
 *
 * Deliberately biased toward doubt. A false negative costs one cached lookup;
 * a false positive hands someone the forecast for a district 900km from the one
 * they asked about, under a provenance line stating the source and issue time.
 */
export function isCorroborated(place: Location): boolean {
  const name = fold(place.name);
  if (!name) return false;

  return [place.admin1, place.admin2]
    .filter((value): value is string => Boolean(value))
    .map(fold)
    .some((admin) => admin !== '' && (admin.includes(name) || name.includes(admin)));
}

export const routedPlaces: PlaceResolver = {
  name: 'Chaatak place router',

  async resolve(query: string): Promise<Location | NoData> {
    // Devanagari and the other Indic scripts: Open-Meteo cannot read them at
    // all, so there is nothing to validate and nothing to fall back from.
    if (needsIndicGeocoder(query)) return nominatimPlaces.resolve(query);

    // Only NoData carries a `kind`, so this narrows to Location — the same
    // guard the API routes use.
    const first = await openMeteoPlaces.resolve(query);
    if (!('kind' in first) && isCorroborated(first)) return first;

    // Either nothing came back, or what came back cannot be corroborated.
    // Ask the independent index. Each resolver stamps its own name and
    // endpoint onto what it returns, so provenance always names the geocoder
    // that actually answered.
    const second = await nominatimPlaces.resolve(query);
    if (!('kind' in second)) return second;

    // FAIL CLOSED. Two indexes and neither can confirm the place, so the
    // honest answer is that we do not know it — never the unvalidated guess.
    // Returning Open-Meteo's uncorroborated hit here would reintroduce the
    // exact bug, and shipping the wrong district quietly is worse than saying
    // nothing.
    return second;
  },
};
