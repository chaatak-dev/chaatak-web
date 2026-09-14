/**
 * Open-Meteo, behind the shared interfaces.
 *
 * The development source while IMD API access is pending. Everything above
 * this file is source-agnostic: when the IMD adapter lands in Phase 4, one
 * config value changes and nothing else does.
 *
 * Every number returned from here came out of an upstream response body. There
 * is no estimation, no interpolation between places, and no substitution from
 * a second source when the first is quiet. Missing stays missing.
 */

import { TTL, cached } from '../cache';
import type {
  DistrictId,
  Forecast,
  ForecastDay,
  Location,
  Measurement,
  MeasurementKey,
  NoData,
  NoDataReason,
  NoWarning,
  PlaceResolver,
  Reading,
  Warning,
  WeatherSource,
} from './types';

const SOURCE = 'Open-Meteo';
const GEOCODE_HOST = 'https://geocoding-api.open-meteo.com';
const FORECAST_HOST = 'https://api.open-meteo.com';
const TIMEOUT_MS = 8000;

/* ------------------------------------------------------------------ */
/* Upstream response shapes                                            */
/* ------------------------------------------------------------------ */

type GeocodeHit = {
  name?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  country?: string;
  country_code?: string;
  admin1?: string;
  admin2?: string;
};

type GeocodeBody = { results?: GeocodeHit[]; error?: boolean; reason?: string };

type ForecastBody = {
  error?: boolean;
  reason?: string;
  utc_offset_seconds?: number;
  current_units?: Record<string, string>;
  current?: Record<string, number | string>;
  daily_units?: Record<string, string>;
  daily?: Record<string, Array<number | string | null>>;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function noData(
  reason: NoDataReason,
  endpoint: string,
  statement: { hi: string; en: string },
): NoData {
  return {
    kind: 'noData',
    reason,
    source: SOURCE,
    endpoint,
    checkedAt: new Date().toISOString(),
    statement,
  };
}

const UNREACHABLE = {
  hi: 'स्रोत से संपर्क नहीं हो सका। थोड़ी देर बाद फिर कोशिश करें।',
  en: 'The source could not be reached. Try again in a moment.',
};

const NO_VALUES = {
  hi: 'इस जगह के लिए स्रोत ने कोई मान नहीं दिया।',
  en: 'The source returned no values for this place.',
};

/** Fetch JSON, or null if anything at all went wrong. Callers decide the copy. */
async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
      // We run our own TTL cache; Next's fetch cache would double up.
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Open-Meteo reports local wall time with a separate offset. Recombining them
 * gives an unambiguous instant, so a displayed time can never drift by a zone.
 */
function toIsoWithOffset(localTime: string, offsetSeconds: number): string {
  const sign = offsetSeconds < 0 ? '-' : '+';
  const abs = Math.abs(offsetSeconds);
  const hh = String(Math.floor(abs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  const withSeconds = localTime.length === 16 ? `${localTime}:00` : localTime;
  return `${withSeconds}${sign}${hh}:${mm}`;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/* ------------------------------------------------------------------ */
/* Place resolution                                                    */
/* ------------------------------------------------------------------ */

const GEOCODE_PATH = '/v1/search';

export const openMeteoPlaces: PlaceResolver = {
  name: SOURCE,

  async resolve(query: string): Promise<Location | NoData> {
    const trimmed = query.trim();
    if (!trimmed) {
      return noData('unknownPlace', GEOCODE_PATH, {
        hi: 'कोई जगह नहीं लिखी गई।',
        en: 'No place was entered.',
      });
    }

    const url =
      `${GEOCODE_HOST}${GEOCODE_PATH}?name=${encodeURIComponent(trimmed)}` +
      `&count=1&language=en&format=json`;

    return cached<Location | NoData>(
      `geocode:${trimmed.toLowerCase()}`,
      TTL.geocode,
      async () => {
        const body = await getJson<GeocodeBody>(url);
        if (!body || body.error) {
          return noData('lookupFailed', GEOCODE_PATH, UNREACHABLE);
        }

        // A query that matches nothing comes back with no `results` key at all.
        const hit = body.results?.[0];
        if (
          !hit ||
          typeof hit.latitude !== 'number' ||
          typeof hit.longitude !== 'number'
        ) {
          return noData('unknownPlace', GEOCODE_PATH, {
            hi: `"${trimmed}" नाम की कोई जगह नहीं मिली। वर्तनी जाँचें, या पास के किसी शहर का नाम लिखें।`,
            en: `No place called "${trimmed}" was found. Check the spelling, or type a nearby town.`,
          });
        }

        return {
          name: hit.name ?? trimmed,
          admin1: hit.admin1,
          admin2: hit.admin2,
          country: hit.country ?? '',
          countryCode: hit.country_code ?? '',
          latitude: hit.latitude,
          longitude: hit.longitude,
          timezone: hit.timezone ?? 'UTC',
          resolvedBy: SOURCE,
          endpoint: GEOCODE_PATH,
        } satisfies Location;
      },
      // "No such place" stays true, so it is worth holding. A failed lookup is
      // transient and must not be remembered.
      (result) => !('kind' in result) || result.reason !== 'lookupFailed',
    );
  },
};

/* ------------------------------------------------------------------ */
/* Weather                                                             */
/* ------------------------------------------------------------------ */

const FORECAST_PATH = '/v1/forecast';

const CURRENT_FIELDS: Array<[MeasurementKey, string]> = [
  ['temperature', 'temperature_2m'],
  ['apparentTemperature', 'apparent_temperature'],
  ['humidity', 'relative_humidity_2m'],
  ['precipitation', 'precipitation'],
  ['windSpeed', 'wind_speed_10m'],
];

function baseParams(loc: Location): string {
  return (
    `latitude=${loc.latitude}&longitude=${loc.longitude}` +
    `&timezone=${encodeURIComponent(loc.timezone)}`
  );
}

export const openMeteo: WeatherSource = {
  name: SOURCE,

  async getCurrent(loc: Location): Promise<Reading | NoData> {
    const fields = CURRENT_FIELDS.map(([, api]) => api).join(',');
    const url =
      `${FORECAST_HOST}${FORECAST_PATH}?${baseParams(loc)}` +
      `&current=weather_code,${fields}`;

    return cached<Reading | NoData>(
      `current:${loc.latitude},${loc.longitude}`,
      TTL.current,
      async () => {
        const body = await getJson<ForecastBody>(url);
        if (!body || body.error) {
          return noData('lookupFailed', FORECAST_PATH, UNREACHABLE);
        }

        const current = body.current;
        const units = body.current_units;
        if (!current || !units || typeof current.time !== 'string') {
          return noData('notInBulletin', FORECAST_PATH, NO_VALUES);
        }

        const measurements: Measurement[] = [];
        for (const [key, apiField] of CURRENT_FIELDS) {
          const value = numberOrNull(current[apiField]);
          const unit = units[apiField];
          // A bare number is ambiguous and this is a safety interface, so a
          // value whose unit the source did not state is not rendered at all.
          if (value === null || typeof unit !== 'string') continue;
          measurements.push({ key, value, unit });
        }

        if (measurements.length === 0) {
          return noData('notInBulletin', FORECAST_PATH, NO_VALUES);
        }

        return {
          kind: 'reading',
          conditionCode: numberOrNull(current.weather_code),
          measurements,
          provenance: {
            source: SOURCE,
            endpoint: FORECAST_PATH,
            issuedAt: toIsoWithOffset(current.time, body.utc_offset_seconds ?? 0),
            // Open-Meteo stamps when these values were last refreshed, not when
            // a bulletin was published. Saying "issued" would over-claim.
            timeBasis: 'updated',
          },
        } satisfies Reading;
      },
      (result) => !('reason' in result) || result.reason !== 'lookupFailed',
    );
  },

  async getForecast(loc: Location, days: number): Promise<Forecast | NoData> {
    const url =
      `${FORECAST_HOST}${FORECAST_PATH}?${baseParams(loc)}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
      // Requested only to obtain the response's attested refresh time: the
      // daily block carries no timestamp of its own, and Open-Meteo sends no
      // Last-Modified header. The value itself is not read.
      `&current=temperature_2m` +
      `&forecast_days=${days}`;

    return cached<Forecast | NoData>(
      `daily:${loc.latitude},${loc.longitude}:${days}`,
      TTL.daily,
      async () => {
        const body = await getJson<ForecastBody>(url);
        if (!body || body.error) {
          return noData('lookupFailed', FORECAST_PATH, UNREACHABLE);
        }

        const daily = body.daily;
        const dailyUnits = body.daily_units;
        const dates = daily?.time;
        if (!daily || !dailyUnits || !Array.isArray(dates) || dates.length === 0) {
          return noData('notInBulletin', FORECAST_PATH, NO_VALUES);
        }

        const stamp = body.current?.time;
        if (typeof stamp !== 'string') {
          return noData('notInBulletin', FORECAST_PATH, NO_VALUES);
        }

        const temperatureUnit = dailyUnits.temperature_2m_max;
        const precipitationUnit = dailyUnits.precipitation_sum;
        if (
          typeof temperatureUnit !== 'string' ||
          typeof precipitationUnit !== 'string'
        ) {
          return noData('notInBulletin', FORECAST_PATH, NO_VALUES);
        }

        const forecastDays: ForecastDay[] = dates.map((date, i) => ({
          date: String(date),
          conditionCode: numberOrNull(daily.weather_code?.[i]),
          // Upstream sends null for days past the model horizon. Null is
          // carried through and rendered as absent, never filled in.
          maxTemp: numberOrNull(daily.temperature_2m_max?.[i]),
          minTemp: numberOrNull(daily.temperature_2m_min?.[i]),
          precipitationSum: numberOrNull(daily.precipitation_sum?.[i]),
        }));

        return {
          kind: 'forecast',
          days: forecastDays,
          units: { temperature: temperatureUnit, precipitation: precipitationUnit },
          provenance: {
            source: SOURCE,
            endpoint: FORECAST_PATH,
            issuedAt: toIsoWithOffset(stamp, body.utc_offset_seconds ?? 0),
            timeBasis: 'updated',
          },
        } satisfies Forecast;
      },
      (result) => !('reason' in result) || result.reason !== 'lookupFailed',
    );
  },

  /**
   * Open-Meteo has no warning product at all, so this is `noData` — we do not
   * know — and never `noWarning`, which would claim we asked and nothing is in
   * effect. Deriving a severity from a weather code here would be the
   * application generating a warning, which is the one thing it must not do.
   */
  async getWarnings(
    _district: DistrictId,
  ): Promise<Warning[] | NoWarning | NoData> {
    // No endpoint: there was nothing to call.
    return noData('noProduct', '', {
      hi: 'Open-Meteo चेतावनी जारी नहीं करता। IMD की चेतावनियाँ अभी जुड़ी नहीं हैं।',
      en: 'Open-Meteo does not issue warnings. IMD warning bulletins are not connected yet.',
    });
  },
};
