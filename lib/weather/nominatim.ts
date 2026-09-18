/**
 * Nominatim (OpenStreetMap) as a place resolver for Devanagari queries.
 *
 * Why this exists: Open-Meteo's geocoder returns nothing at all for Devanagari
 * input — not for मुंबई, not for जयपुर, not for गाज़ियाबाद. Hindi speech
 * recognition returns Devanagari, so without this, voice in Hindi cannot
 * resolve a single place.
 *
 * Transliterating to Latin first was tried and rejected. It does not fail
 * loudly, it fails wrongly: a naive transliteration of जयपुर matches Jayapura
 * in Indonesia, लखनऊ matches a village in Nepal, and बाराबंकी matches a
 * Barabānki in Odisha rather than the one in Uttar Pradesh. Handing someone
 * the forecast for the wrong district is the exact failure this system exists
 * to prevent, so the query goes to a geocoder that reads the script natively.
 *
 * A geocode is not a weather value, so this is a PlaceResolver and not a
 * WeatherSource. It stays in place after the Phase 4 IMD swap.
 */

import { TTL, cached } from '../cache';
import type { Location, NoData, NoDataReason, PlaceResolver } from './types';

const SOURCE = 'OpenStreetMap';
const HOST = 'https://nominatim.openstreetmap.org';
const SEARCH_PATH = '/search';
const TIMEOUT_MS = 8000;

/**
 * Nominatim's usage policy requires an identifying User-Agent and asks that
 * results be cached rather than re-requested. The 24h geocode TTL in
 * `cached()` is what satisfies the second half.
 */
const USER_AGENT = 'Chaatak/0.1 (SIH2026 PS26068; https://chaatak.com)';

/**
 * Anything past the Latin blocks was not typed in Latin.
 *
 * Deliberately not a list of Indic blocks — this asks a simpler question than
 * the geocoder routing in places.ts does, and copying that list here is how
 * the two would drift apart when a language is added.
 */
const NON_LATIN = /[^\u0000-\u02AF]/;

/**
 * Devanagari is written in India and Nepal, and both keep a single timezone
 * nationwide — so this is an exact lookup, not an approximation of a zone from
 * a coordinate. Nominatim does not report timezones of its own.
 */
const COUNTRY_ZONES: Record<string, string> = {
  in: 'Asia/Kolkata',
  np: 'Asia/Kathmandu',
};

type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state_district?: string;
  state?: string;
  country?: string;
  country_code?: string;
};

type NominatimHit = {
  name?: string;
  lat?: string;
  lon?: string;
  address?: NominatimAddress;
};

function noData(
  reason: NoDataReason,
  statement: { hi: string; en: string },
): NoData {
  return {
    kind: 'noData',
    reason,
    source: SOURCE,
    endpoint: SEARCH_PATH,
    checkedAt: new Date().toISOString(),
    statement,
  };
}

export const nominatimPlaces: PlaceResolver = {
  name: SOURCE,

  async resolve(query: string): Promise<Location | NoData> {
    const trimmed = query.trim();
    if (!trimmed) {
      return noData('unknownPlace', {
        hi: 'कोई जगह नहीं लिखी गई।',
        en: 'No place was entered.',
      });
    }

    // Answer in the script the question was asked in. This resolver used to
    // serve Devanagari queries only, so `hi` was hardcoded and always right.
    // It now also backs up the Latin path, and asking for Hindi there came
    // back with मुंबई for "Mumbai" — switching script on someone who typed
    // Latin, which is the one thing the language rules never allow.
    const answerIn = NON_LATIN.test(trimmed) ? 'hi' : 'en';

    const url =
      `${HOST}${SEARCH_PATH}?q=${encodeURIComponent(trimmed)}` +
      `&format=jsonv2&limit=1&addressdetails=1` +
      `&countrycodes=${Object.keys(COUNTRY_ZONES).join(',')}` +
      `&accept-language=${answerIn}`;

    return cached<Location | NoData>(
      `nominatim:${answerIn}:${trimmed.toLowerCase()}`,
      TTL.geocode,
      async () => {
        let hits: NominatimHit[];
        try {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { accept: 'application/json', 'user-agent': USER_AGENT },
            cache: 'no-store',
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          hits = (await res.json()) as NominatimHit[];
        } catch {
          return noData('lookupFailed', {
            hi: 'स्रोत से संपर्क नहीं हो सका। थोड़ी देर बाद फिर कोशिश करें।',
            en: 'The source could not be reached. Try again in a moment.',
          });
        }

        const hit = Array.isArray(hits) ? hits[0] : undefined;
        const latitude = Number(hit?.lat);
        const longitude = Number(hit?.lon);

        if (
          !hit ||
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude)
        ) {
          // Nominatim correctly returns nothing for a whole spoken sentence.
          // That is an honest answer, and the copy says what to do about it.
          return noData('unknownPlace', {
            hi: `"${trimmed}" से कोई जगह नहीं मिली। सिर्फ़ जगह का नाम बोलें या लिखें।`,
            en: `No place matched "${trimmed}". Say or type just the place name.`,
          });
        }

        const address = hit.address ?? {};
        const countryCode = (address.country_code ?? '').toLowerCase();

        return {
          name:
            hit.name ||
            address.city ||
            address.town ||
            address.village ||
            trimmed,
          admin1: address.state,
          // Nominatim's state_district is the district — what Phase 4 maps to
          // an IMD Obj_id.
          admin2: address.state_district ?? address.county,
          country: address.country ?? '',
          countryCode: countryCode.toUpperCase(),
          latitude,
          longitude,
          timezone: COUNTRY_ZONES[countryCode] ?? 'Asia/Kolkata',
          resolvedBy: SOURCE,
          endpoint: SEARCH_PATH,
        } satisfies Location;
      },
      (result) => !('kind' in result) || result.reason !== 'lookupFailed',
    );
  },
};
