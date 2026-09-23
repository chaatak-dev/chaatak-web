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
  History,
  HistoryDay,
  HistoryHour,
  HistoryRequest,
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
const ARCHIVE_HOST = 'https://archive-api.open-meteo.com';
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
  hourly_units?: Record<string, string>;
  hourly?: Record<string, Array<number | string | null>>;
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
            /*
             * A MODEL, and it says so. Open-Meteo's `current` block is a
             * numerical weather model evaluated for this coordinate and this
             * hour — not a thermometer at this spot. Describing it as an
             * observation would be a lie of category, and the interface
             * renders this word where it used to render an API path.
             */
            nature: 'model',
            observedAt: null,
            fetchedAt: new Date().toISOString(),
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
      // So "what about wind?" and "will it rain tomorrow?" can be answered
      // for a day that has not happened, from values the model issued.
      `,wind_speed_10m_max,precipitation_probability_max` +
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

        // A value whose unit the source did not state is not a value, so
        // wind and probability exist only when their units do.
        const windUnit = dailyUnits.wind_speed_10m_max;
        const probabilityUnit = dailyUnits.precipitation_probability_max;

        const forecastDays: ForecastDay[] = dates.map((date, i) => ({
          date: String(date),
          conditionCode: numberOrNull(daily.weather_code?.[i]),
          // Upstream sends null for days past the model horizon. Null is
          // carried through and rendered as absent, never filled in.
          maxTemp: numberOrNull(daily.temperature_2m_max?.[i]),
          minTemp: numberOrNull(daily.temperature_2m_min?.[i]),
          precipitationSum: numberOrNull(daily.precipitation_sum?.[i]),
          maxWind: typeof windUnit === 'string' ? numberOrNull(daily.wind_speed_10m_max?.[i]) : null,
          precipitationProbability:
            typeof probabilityUnit === 'string'
              ? numberOrNull(daily.precipitation_probability_max?.[i])
              : null,
        }));

        return {
          kind: 'forecast',
          days: forecastDays,
          units: {
            temperature: temperatureUnit,
            precipitation: precipitationUnit,
            ...(typeof windUnit === 'string' ? { wind: windUnit } : {}),
            ...(typeof probabilityUnit === 'string' ? { probability: probabilityUnit } : {}),
          },
          provenance: {
            source: SOURCE,
            endpoint: FORECAST_PATH,
            issuedAt: toIsoWithOffset(stamp, body.utc_offset_seconds ?? 0),
            timeBasis: 'updated',
            nature: 'model',
            observedAt: null,
            fetchedAt: new Date().toISOString(),
          },
        } satisfies Forecast;
      },
      (result) => !('reason' in result) || result.reason !== 'lookupFailed',
    );
  },

  /**
   * The past, from whichever of Open-Meteo's two records covers it.
   *
   *   the last 92 days   the forecast endpoint's own archive: the opening
   *                      hours of successive model runs, hour by hour, up to
   *                      the latest complete hour — `archivedForecast`
   *   anything older     ERA5 reanalysis from the archive endpoint, day by
   *                      day — `reanalysis`
   *
   * Neither is a rain gauge, and neither is dressed as one. An hour or a day
   * that has not finished is never in the answer: today's afternoon forecast
   * is not history, and a past-tense question that the record cannot answer
   * gets `noData`, never the present or the forecast instead.
   */
  async getHistory(loc: Location, request: HistoryRequest): Promise<History | NoData> {
    if (request.kind === 'recent') {
      const pastDays = Math.max(1, Math.min(RECENT_DAYS_MAX, Math.round(request.pastDays)));
      return recentHistory(loc, pastDays, true);
    }

    const today = todayFor(loc.timezone);
    const yesterday = shiftDate(today, -1);
    const to = request.to < yesterday ? request.to : yesterday;
    if (request.from > to) return noData('notInBulletin', FORECAST_PATH, NOT_YET);

    // One question may not ask for months of days.
    const from = daysFrom(request.from, to) > HISTORY_SPAN_MAX ? shiftDate(to, -(HISTORY_SPAN_MAX - 1)) : request.from;

    const back = daysFrom(from, today);
    if (back <= RECENT_DAYS_MAX) {
      const recent = await recentHistory(loc, back, false);
      if ('kind' in recent && recent.kind === 'noData') return recent;
      return sliceDays(recent as History, from, to);
    }
    return reanalysis(loc, from, to);
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

/* ------------------------------------------------------------------ */
/* The past                                                            */
/* ------------------------------------------------------------------ */

/** How far back the forecast endpoint's own archive reaches. */
export const RECENT_DAYS_MAX = 92;

/** The most days one history request may span. */
const HISTORY_SPAN_MAX = 62;

const ARCHIVE_PATH = '/v1/archive';

const HISTORY_DAILY =
  'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,' +
  'precipitation_hours,wind_speed_10m_max';
const HISTORY_HOURLY = 'precipitation,rain,temperature_2m';

const NO_HISTORY = {
  hi: 'इस अवधि के लिए स्रोत के पास पिछला आँकड़ा नहीं है।',
  en: 'The source holds no past values for that period.',
};

const NOT_YET = {
  hi: 'वह दिन अभी पूरा नहीं हुआ है, इसलिए उसका रिकॉर्ड नहीं हो सकता।',
  en: 'That day has not finished yet, so there is no record of it.',
};

const NOT_IN_REANALYSIS = {
  hi: 'पुनर्विश्लेषण में इन दिनों के आँकड़े अभी नहीं आए हैं।',
  en: 'The reanalysis does not cover those days yet.',
};

/** Today's calendar date in a zone, YYYY-MM-DD. */
function todayFor(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`. */
function daysFrom(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** The whole days in a body, oldest first, up to (not including) `before`. */
function readDays(body: ForecastBody, before: string | null): HistoryDay[] {
  const daily = body.daily;
  const dates = daily?.time;
  if (!daily || !Array.isArray(dates)) return [];

  const days: HistoryDay[] = [];
  dates.forEach((date, i) => {
    const day = String(date);
    if (before !== null && day >= before) return;
    days.push({
      date: day,
      conditionCode: numberOrNull(daily.weather_code?.[i]),
      maxTemp: numberOrNull(daily.temperature_2m_max?.[i]),
      minTemp: numberOrNull(daily.temperature_2m_min?.[i]),
      precipitationSum: numberOrNull(daily.precipitation_sum?.[i]),
      rainSum: numberOrNull(daily.rain_sum?.[i]),
      precipitationHours: numberOrNull(daily.precipitation_hours?.[i]),
      maxWind: numberOrNull(daily.wind_speed_10m_max?.[i]),
    });
  });
  return days;
}

/**
 * The hours in a body that have ENDED by `now`, oldest first.
 *
 * An hourly value is labelled with the end of its hour, so the label is
 * compared with now directly: 14:00 at 14:20 is complete, 15:00 is still a
 * forecast and is dropped.
 */
function readHours(body: ForecastBody, now: string, offset: number): HistoryHour[] {
  const hourly = body.hourly;
  const times = hourly?.time;
  if (!hourly || !Array.isArray(times)) return [];

  const hours: HistoryHour[] = [];
  times.forEach((time, i) => {
    const label = String(time);
    if (label > now) return;
    hours.push({
      time: toIsoWithOffset(label, offset),
      precipitation: numberOrNull(hourly.precipitation?.[i]),
      rain: numberOrNull(hourly.rain?.[i]),
      temperature: numberOrNull(hourly.temperature_2m?.[i]),
    });
  });
  return hours;
}

/**
 * The recent past from the forecast endpoint's own archive.
 *
 * `hourly` is asked for only when the question needs hours (events, the last
 * 24 hours); a question about whole days does not pay for 2,000 of them.
 */
function recentHistory(loc: Location, pastDays: number, hourly: boolean): Promise<History | NoData> {
  const url =
    `${FORECAST_HOST}${FORECAST_PATH}?${baseParams(loc)}` +
    `&past_days=${pastDays}&forecast_days=1` +
    `&daily=${HISTORY_DAILY}` +
    (hourly ? `&hourly=${HISTORY_HOURLY}` : '') +
    // The attested "now" of the response: what separates a finished hour
    // from a forecast one. Not read as a value.
    `&current=temperature_2m`;

  return cached<History | NoData>(
    `history:recent:${loc.latitude},${loc.longitude}:${pastDays}:${hourly ? 'h' : 'd'}`,
    TTL.history,
    async () => {
      const body = await getJson<ForecastBody>(url);
      if (!body || body.error) return noData('lookupFailed', FORECAST_PATH, UNREACHABLE);

      const now = body.current?.time;
      const offset = body.utc_offset_seconds ?? 0;
      if (typeof now !== 'string') return noData('notInBulletin', FORECAST_PATH, NO_HISTORY);
      const today = now.slice(0, 10);

      const units = {
        precipitation: body.hourly_units?.precipitation ?? body.daily_units?.precipitation_sum,
        temperature: body.hourly_units?.temperature_2m ?? body.daily_units?.temperature_2m_max,
        wind: body.daily_units?.wind_speed_10m_max,
      };
      // Precipitation is what these questions are about; without its unit
      // the numbers are not usable, and a bare number is not shown.
      if (typeof units.precipitation !== 'string') {
        return noData('notInBulletin', FORECAST_PATH, NO_HISTORY);
      }

      // Only whole days — today is not over — and only finished hours.
      const days = readDays(body, today);
      const hours = hourly ? readHours(body, now, offset) : [];
      if (days.length === 0 && hours.length === 0) {
        return noData('notInBulletin', FORECAST_PATH, NO_HISTORY);
      }

      const lastHour = hours[hours.length - 1]?.time;
      const through = lastHour ?? toIsoWithOffset(`${days[days.length - 1].date}T23:59`, offset);

      return {
        kind: 'history',
        hours,
        days,
        units: {
          precipitation: units.precipitation,
          temperature: typeof units.temperature === 'string' ? units.temperature : '',
          wind: typeof units.wind === 'string' ? units.wind : '',
        },
        from: days[0]?.date ?? hours[0].time.slice(0, 10),
        to: lastHour ? lastHour.slice(0, 10) : days[days.length - 1].date,
        provenance: {
          source: SOURCE,
          endpoint: FORECAST_PATH,
          issuedAt: through,
          timeBasis: 'through',
          nature: 'archivedForecast',
          observedAt: null,
          fetchedAt: new Date().toISOString(),
        },
      } satisfies History;
    },
    (result) => !('reason' in result) || result.reason !== 'lookupFailed',
  );
}

/** A history cut down to calendar days `from`..`to`, restamped to match. */
function sliceDays(history: History, from: string, to: string): History | NoData {
  const days = history.days.filter((d) => d.date >= from && d.date <= to);
  if (days.length === 0) return noData('notInBulletin', history.provenance.endpoint, NO_HISTORY);
  const offset = /([+-]\d{2}:\d{2})$/.exec(history.provenance.issuedAt)?.[1] ?? '+00:00';
  return {
    ...history,
    hours: [],
    days,
    from: days[0].date,
    to: days[days.length - 1].date,
    provenance: { ...history.provenance, issuedAt: `${days[days.length - 1].date}T23:59:00${offset}` },
  };
}

/**
 * Days older than the forecast archive holds: ERA5 reanalysis.
 *
 * Named `era5` explicitly rather than left to "best match", so the nature the
 * interface states is the dataset that actually answered.
 */
function reanalysis(loc: Location, from: string, to: string): Promise<History | NoData> {
  const url =
    `${ARCHIVE_HOST}${ARCHIVE_PATH}?${baseParams(loc)}` +
    `&start_date=${from}&end_date=${to}&daily=${HISTORY_DAILY}&models=era5`;

  return cached<History | NoData>(
    `history:archive:${loc.latitude},${loc.longitude}:${from}:${to}`,
    TTL.archive,
    async () => {
      const body = await getJson<ForecastBody>(url);
      if (!body || body.error) return noData('lookupFailed', ARCHIVE_PATH, UNREACHABLE);

      const precipitationUnit = body.daily_units?.precipitation_sum;
      if (typeof precipitationUnit !== 'string') {
        return noData('notInBulletin', ARCHIVE_PATH, NO_HISTORY);
      }

      const days = readDays(body, null);
      // The reanalysis trails the present by days; a stretch it has not
      // reached yet comes back as nulls, and nulls are not a record.
      if (days.length === 0 || days.every((d) => d.precipitationSum === null && d.maxTemp === null)) {
        return noData('notInBulletin', ARCHIVE_PATH, NOT_IN_REANALYSIS);
      }

      const offset = body.utc_offset_seconds ?? 0;
      return {
        kind: 'history',
        hours: [],
        days,
        units: {
          precipitation: precipitationUnit,
          temperature: body.daily_units?.temperature_2m_max ?? '',
          wind: body.daily_units?.wind_speed_10m_max ?? '',
        },
        from: days[0].date,
        to: days[days.length - 1].date,
        provenance: {
          source: SOURCE,
          endpoint: ARCHIVE_PATH,
          issuedAt: toIsoWithOffset(`${days[days.length - 1].date}T23:59`, offset),
          timeBasis: 'through',
          nature: 'reanalysis',
          observedAt: null,
          fetchedAt: new Date().toISOString(),
          modelRun: 'ERA5',
        },
      } satisfies History;
    },
    (result) => !('reason' in result) || result.reason !== 'lookupFailed',
  );
}
