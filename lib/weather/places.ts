/**
 * Resolving a typed place name to a point on the map.
 *
 * The authoritative gazetteer answers first, and answers almost everything. A
 * general geocoder is consulted only for what it does not hold.
 *
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

import { matchPlace } from './gazetteer/match';
import { GAZETTEER_SOURCE, nearestDistrict } from './gazetteer/index';
import { normalise } from './gazetteer/normalise';
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

/**
 * India keeps one timezone nationwide, and the gazetteer holds only Indian
 * places, so this is exact rather than an approximation from a coordinate.
 */
const INDIA_TZ = 'Asia/Kolkata';

/** A gazetteer hit, in the shape everything above the adapters expects. */
function locate(match: NonNullable<ReturnType<typeof matchPlace>>): Location {
  const { entry } = match;
  return {
    name: entry.name,
    admin1: entry.state ?? undefined,
    admin2: entry.district ?? undefined,
    country: 'India',
    countryCode: 'IN',
    latitude: entry.latitude,
    longitude: entry.longitude,
    timezone: INDIA_TZ,
    // Provenance names what actually answered, and says whether the spelling
    // had to be repaired to get there.
    resolvedBy: `Chaatak gazetteer (${GAZETTEER_SOURCE})`,
    endpoint: match.how === 'exact' ? 'gazetteer:exact' : `gazetteer:fuzzy:${match.distance}`,
  };
}

/**
 * Whether a geocoder's answer may be used at all.
 *
 * The fallback exists for one thing: villages too small for the gazetteer. It
 * is not a general search, and treating it as one is how the wrong place gets
 * on screen. Measured against the live chain, an unchecked fallback returned
 * England for "London" and a Mumbai housing society called "THE KARACHI
 * CITIZEN chs" for "Karachi" — both real coordinates, both with a full
 * provenance line, neither the place anyone asked about.
 *
 * Two conditions, and a result must meet both:
 *
 *   - It is in India. IMD issues no warning for anywhere else, so a foreign
 *     result is useless even when it is the correct foreign place.
 *   - Its name is recognisably the name that was typed. A geocoder ranks by
 *     its own relevance and will happily return a housing society whose name
 *     merely contains the query; requiring the names to match rejects that
 *     without needing to know what a housing society is.
 */
export function usableGeocode(query: string, place: Location): boolean {
  if (place.countryCode !== 'IN') return false;

  const asked = normalise(query);
  const got = normalise(place.name);
  if (!asked || !got) return false;

  // Exactly, after normalisation. Repairing a misspelling is the gazetteer's
  // job, against a closed set of Indian places where a correction can be
  // checked for ambiguity. A geocoder does its own fuzzy matching against the
  // whole world and cannot be asked whether it was sure: allowing it even one
  // edit turned "Tokyo" into Takyo in Arunachal Pradesh. Here the only
  // question is where a name we already have is, not what it might have been.
  return asked === got;
}

/**
 * Attach the district a geocoded point falls in.
 *
 * Every answer leaving this module names the unit IMD would warn on, whether
 * it came from the gazetteer or from a geocoder.
 */
function withDistrict(place: Location): Location {
  if (place.admin2) return place;
  const district = nearestDistrict(place.latitude, place.longitude);
  if (!district) return place;
  return {
    ...place,
    admin1: place.admin1 ?? district.state ?? undefined,
    admin2: district.district ?? district.name,
  };
}

/**
 * We looked and could not confirm the place.
 *
 * Stated as a fact about our knowledge rather than as an error, because that
 * is what it is: the gazetteer does not hold this name and no geocoder
 * returned something in India that matches it.
 */
function unknownPlace(query: string): NoData {
  return {
    kind: 'noData',
    reason: 'unknownPlace',
    source: 'Chaatak place router',
    endpoint: 'gazetteer + geocoders',
    checkedAt: new Date().toISOString(),
    statement: {
      hi: `"${query}" से कोई जगह नहीं मिली। सिर्फ़ जगह का नाम बोलें या लिखें।`,
      en: `No place matched "${query}". Say or type just the place name.`,
    },
  };
}

export const routedPlaces: PlaceResolver = {
  name: 'Chaatak place router',

  async resolve(query: string): Promise<Location | NoData> {
    // 1. The authoritative set, offline: every district IMD warns on, plus
    //    every town of 50,000 or more, under all their names in all seven
    //    scripts. It repairs misspellings, costs no network call, and cannot
    //    return a place outside India because it does not contain one.
    const known = matchPlace(query);
    if (known) return locate(known);

    // 2. Everything else is a village too small for the gazetteer. Only here
    //    does a general geocoder get asked, and its answer is still checked.

    // Devanagari and the other Indic scripts: Open-Meteo cannot read them at
    // all, so there is only one geocoder to ask.
    if (needsIndicGeocoder(query)) {
      const indic = await nominatimPlaces.resolve(query);
      if ('kind' in indic) return indic;
      return usableGeocode(query, indic) ? withDistrict(indic) : unknownPlace(query);
    }

    // Only NoData carries a `kind`, so this narrows to Location — the same
    // guard the API routes use.
    const first = await openMeteoPlaces.resolve(query);
    if (!('kind' in first) && isCorroborated(first) && usableGeocode(query, first)) {
      return withDistrict(first);
    }

    // Either nothing came back, or what came back cannot be corroborated.
    // Ask the independent index. Each resolver stamps its own name and
    // endpoint onto what it returns, so provenance always names the geocoder
    // that actually answered.
    const second = await nominatimPlaces.resolve(query);
    if (!('kind' in second) && usableGeocode(query, second)) return withDistrict(second);

    // FAIL CLOSED. The gazetteer does not hold it, and no geocoder returned
    // something that is both in India and the name that was asked for. An
    // explicit no-data state is the honest answer; a plausible wrong district
    // is the failure this whole module is arranged to prevent.
    return 'kind' in second ? second : unknownPlace(query);
  },
};
