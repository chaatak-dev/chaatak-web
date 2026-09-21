/**
 * IMD, behind the shared interfaces.
 *
 * The India Meteorological Department is the authority this whole system
 * exists to relay. Everything above the adapter layer is unchanged by its
 * arrival — that is what the interface was for.
 *
 * WHAT IS IMPLEMENTED
 *
 * District warnings, from `api/v1/districtwarning?id=<Obj_id>`. Current
 * conditions and the forecast still come from Open-Meteo, and still say so in
 * their own provenance: IMD's station endpoints are keyed on station codes
 * whose mapping from a place has not been verified, and guessing it would put
 * another town's temperature on screen.
 *
 * THE PAYLOAD, as IMD actually returns it
 *
 *   { Obj_id, Date, District,
 *     Day_1 … Day_5, Day1_Color … Day5_Color, updated_at }
 *
 * One row per district, carrying five days at once. `Day_N` is a
 * comma-separated list of hazard codes and `DayN_Color` is the severity for
 * that day. `Date` is day one.
 *
 * THE COLOUR SCALE RUNS DOWNWARDS, and that is the single most dangerous
 * thing in this file. 1 is the most severe and 4 is the least — the opposite
 * of the obvious reading. Reading it the intuitive way would render every
 * green day as orange and every red one as no-warning at all.
 *
 * It is not documented anywhere IMD exposes; there is no legend endpoint, and
 * every candidate returns "API not found". So it was established from the data
 * itself, across all 718 districts and 3,590 day-slots in one bulletin:
 *
 *   colour 4 — 1,897 slots (53%), and hazard code "1" in 1,888 of them
 *   colour 3 — 1,541 slots (43%)
 *   colour 2 —   137 slots (3.8%)
 *   colour 1 —    15 slots (0.4%), and the only colour carrying code 17
 *
 * Code "1" means no warning, and it sits almost exclusively under colour 4, so
 * colour 4 is green. The frequencies then fall away monotonically as the
 * number falls, which is the shape of a severity scale and not of an arbitrary
 * one. `npm run verify:imd` re-derives this distribution against live data and
 * fails if the ordering stops holding, so the inference is checked rather than
 * trusted.
 */

import { TTL, cached } from '../cache';
import { isConfigurationError } from '../errors';
import { findImdDistrict } from './imd-districts';
import { forgetImdToken, imdCredentials, imdToken, type ImdCredentials } from './imd-auth';
import { imdEndpoint, imdFetch } from './imd-transport';
import { openMeteo } from './open-meteo';
import type {
  DistrictId,
  Forecast,
  Location,
  NoData,
  NoDataReason,
  NoWarning,
  Reading,
  Severity,
  Warning,
  WeatherSource,
} from './types';

const SOURCE = 'IMD';
const WARNING_PATH = 'api/v1/districtwarning';

/** IMD publishes on Indian Standard Time and stamps no offset. */
const IST_OFFSET = '+05:30';

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

/* ------------------------------------------------------------------ */
/* Severity                                                            */
/* ------------------------------------------------------------------ */

/**
 * IMD's numeric colour, onto the scale the templates are keyed on.
 *
 * Descending. See the file header for the evidence, and for why reading it
 * the other way round would be a safety failure in both directions at once.
 */
const SEVERITY_BY_COLOUR: Record<string, Severity> = {
  '1': 'warning', // red
  '2': 'alert', //   orange
  '3': 'watch', //   yellow
  '4': 'none', //    green
};

/**
 * Exhaustive and unforgiving. A colour outside the four is refused, never
 * rounded to the nearest: guessing that an unknown value means orange is how
 * a real warning gets softened, and softening is the one failure the
 * verification gate cannot catch.
 */
export function severityFromColour(value: unknown): Severity | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  return SEVERITY_BY_COLOUR[String(value).trim()] ?? null;
}

/** Hazard code 1 is IMD's way of saying nothing is in force. */
const NO_HAZARD = '1';

export function hazardCodes(value: unknown): string[] {
  if (typeof value !== 'string' && typeof value !== 'number') return [];
  return String(value)
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code !== '' && code !== NO_HAZARD);
}

/* ------------------------------------------------------------------ */
/* The district identifier                                             */
/* ------------------------------------------------------------------ */

/**
 * The IMD Obj_id for a district, from a numeric id or from a name.
 *
 * A name is resolved against IMD's own committed district register, never
 * against anything we made up. Unresolvable returns null and the caller says
 * so, because a warning attached to the wrong district is worse than none.
 */
export function imdDistrictId(district: DistrictId): string | null {
  const raw = String(district).trim();
  if (/^\d+$/.test(raw)) return raw;
  return findImdDistrict(raw)?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* Reading the payload                                                 */
/* ------------------------------------------------------------------ */

type RawRow = Record<string, unknown>;

function text(row: RawRow, key: string): string | null {
  const value = row[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return null;
}

/** IMD returns a bare array. Anything else is not understood. */
export function warningRows(payload: unknown): RawRow[] | null {
  if (Array.isArray(payload)) return payload as RawRow[];
  if (payload && typeof payload === 'object') {
    for (const key of ['data', 'warnings', 'result']) {
      const value = (payload as RawRow)[key];
      if (Array.isArray(value)) return value as RawRow[];
    }
  }
  return null;
}

/**
 * "2026-09-21" plus N days, as a calendar date.
 *
 * Done entirely in UTC. Building the instant at IST midnight and then reading
 * the date back out of an ISO string returns the PREVIOUS day, because
 * midnight in Delhi is half past six the evening before in UTC — which shifted
 * every warning one day earlier. A calendar date is a calendar date; the IST
 * offset belongs on the timestamp built from it, not on the arithmetic.
 */
export function addDays(date: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const at = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return null;
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** "2026-09-21 07:53:58" in IST, as an instant. */
export function issuedAtFrom(updatedAt: string | null): string | null {
  if (!updatedAt) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(updatedAt.trim());
  if (!match) return null;
  const at = new Date(`${match[1]}T${match[2]}${IST_OFFSET}`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * One IMD row into the warnings it carries — up to five, one per day.
 *
 * A day whose colour is green produces nothing, because green is IMD stating
 * that nothing is in force. A day whose colour is not one of the four
 * produces nothing either, and is not silently treated as safe: the caller
 * distinguishes "no warnings" from "nothing understood".
 */
export function rowToWarnings(
  row: RawRow,
  district: DistrictId,
  endpoint: string,
): { warnings: Warning[]; readable: boolean } {
  const date = text(row, 'Date');
  const issuedAt = issuedAtFrom(text(row, 'updated_at'));
  const objId = text(row, 'Obj_id') ?? String(district);

  if (!date) return { warnings: [], readable: false };

  const warnings: Warning[] = [];
  let readable = false;

  for (let day = 1; day <= 5; day++) {
    const severity = severityFromColour(row[`Day${day}_Color`]);
    if (severity === null) continue;
    readable = true;
    if (severity === 'none') continue;

    const codes = hazardCodes(row[`Day_${day}`]);
    const validFrom = addDays(date, day - 1);
    const validTo = addDays(date, day);
    if (!validFrom || !validTo) continue;

    warnings.push({
      kind: 'warning',
      // Stable across polls for the same district, bulletin date and day, so
      // dispatch deduplicates on it instead of alerting once per poll.
      id: `imd:${objId}:${date}:d${day}`,
      // The hazard codes IMD listed. Kept verbatim; the template catalogue
      // renders them, and an unknown code renders as its severity alone
      // rather than as invented words.
      code: codes.length > 0 ? codes.join(',') : 'unspecified',
      severity,
      district,
      validFrom: `${validFrom}T00:00:00${IST_OFFSET}`,
      validTo: `${validTo}T00:00:00${IST_OFFSET}`,
      provenance: {
        source: SOURCE,
        endpoint,
        issuedAt: issuedAt ?? `${validFrom}T00:00:00${IST_OFFSET}`,
        timeBasis: issuedAt ? 'issued' : 'valid',
      },
    });
  }

  return { warnings, readable };
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

async function fetchWarnings(
  district: DistrictId,
  credentials: ImdCredentials,
): Promise<Warning[] | NoWarning | NoData> {
  const endpoint = imdEndpoint(WARNING_PATH);
  const objId = imdDistrictId(district);

  if (!objId) {
    // IMD's register holds 718 districts and does not cover every one in the
    // country. Saying so is honest; attaching a neighbour's warning is not.
    return noData('unknownPlace', endpoint, {
      hi: 'IMD इस ज़िले के लिए चेतावनी जारी नहीं करता।',
      en: 'IMD does not issue district warnings for this district.',
    });
  }

  const path = `${WARNING_PATH}?id=${encodeURIComponent(objId)}`;

  const call = async (): Promise<Response> => {
    const token = await imdToken(credentials);
    return imdFetch(path, {
      headers: {
        authorization: `Bearer ${token}`,
        'x-api-key': credentials.apiKey,
        accept: 'application/json',
      },
    });
  };

  let response: Response;
  try {
    response = await call();

    // A token can stop working before it is due to expire. One retry, once,
    // after discarding it — a loop here would hammer the sign-in endpoint on
    // a credential that has genuinely been revoked.
    if (response.status === 401) {
      forgetImdToken();
      response = await call();
    }
  } catch {
    return noData('lookupFailed', endpoint, {
      hi: 'IMD से संपर्क नहीं हो सका।',
      en: 'IMD could not be reached.',
    });
  }

  if (!response.ok) {
    return noData('lookupFailed', endpoint, {
      hi: 'IMD ने अभी जवाब नहीं दिया।',
      en: 'IMD did not answer just now.',
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return noData('lookupFailed', endpoint, {
      hi: 'IMD का जवाब पढ़ा नहीं जा सका।',
      en: 'IMD returned a response that could not be read.',
    });
  }

  const rows = warningRows(payload);
  if (rows === null) {
    return noData('lookupFailed', endpoint, {
      hi: 'IMD का जवाब पहचाना नहीं गया।',
      en: 'IMD returned a response in an unrecognised shape.',
    });
  }

  const warnings: Warning[] = [];
  let readable = false;
  for (const row of rows) {
    const parsed = rowToWarnings(row, district, endpoint);
    warnings.push(...parsed.warnings);
    readable ||= parsed.readable;
  }

  if (warnings.length === 0 && !readable) {
    // Rows arrived and not one day was understood. That is not an all-clear.
    return noData('lookupFailed', endpoint, {
      hi: 'IMD का जवाब पहचाना नहीं गया।',
      en: 'IMD returned a response in an unrecognised shape.',
    });
  }

  if (warnings.length === 0) {
    const issuedAt = issuedAtFrom(text(rows[0] ?? {}, 'updated_at'));
    return {
      kind: 'noWarning',
      source: SOURCE,
      endpoint,
      issuedAt,
      checkedAt: new Date().toISOString(),
      timeBasis: issuedAt ? 'issued' : 'valid',
    } satisfies NoWarning;
  }

  return warnings;
}

/* ------------------------------------------------------------------ */
/* The source                                                          */
/* ------------------------------------------------------------------ */

/**
 * IMD for warnings; Open-Meteo, still saying so, for readings.
 *
 * Composed rather than split across two config values because a visitor asks
 * one question and every value that comes back carries its own provenance.
 * The temperature says Open-Meteo and the warning says IMD, which is the
 * truth. When IMD's station mapping is verified those two delegations become
 * IMD calls and nothing above this file changes.
 */
export const imdSource: WeatherSource = {
  name: SOURCE,

  async getCurrent(location: Location): Promise<Reading | NoData> {
    return openMeteo.getCurrent(location);
  },

  async getForecast(location: Location, days: number): Promise<Forecast | NoData> {
    return openMeteo.getForecast(location, days);
  },

  async getWarnings(district: DistrictId): Promise<Warning[] | NoWarning | NoData> {
    let credentials: ImdCredentials;
    try {
      credentials = imdCredentials();
    } catch (error) {
      // A missing credential must not take the site down with it.
      //
      // The weather route fetches readings, forecast and warnings together,
      // so throwing from here rejects all three and returns a 500 for a page
      // that could still have shown the temperature. Warnings degrade to an
      // explicit no-data state instead — which is the honest thing to render
      // either way, since we genuinely do not know.
      //
      // Loud in the logs, quiet on screen: the fault names the exact variable
      // server-side, where an operator will see it, and a visitor is not shown
      // which environment variable is missing.
      if (isConfigurationError(error)) {
        console.error(`[imd] ${error.message}`);
        return noData('lookupFailed', imdEndpoint(WARNING_PATH), {
          hi: 'IMD की चेतावनियाँ अभी उपलब्ध नहीं हैं।',
          en: 'IMD warnings are not available right now.',
        });
      }
      throw error;
    }

    // IMD asks callers to cache, and this obliges — one upstream call serves
    // a burst of visitors asking about the same district.
    return cached(
      `imd:warnings:${district}`,
      TTL.warnings,
      () => fetchWarnings(district, credentials),
    );
  },
};
