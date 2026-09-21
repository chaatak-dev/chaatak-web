/**
 * IMD, behind the shared interfaces.
 *
 * The India Meteorological Department is the authority this whole system
 * exists to relay. Everything above the adapter layer is unchanged by its
 * arrival — that is what the interface was for.
 *
 * WHAT IS IMPLEMENTED HERE
 *
 * District warnings, from `api/v1/districtwarning?id=<obj_id>`, which is the
 * one endpoint verified to answer with real data.
 *
 * Current conditions and the forecast are NOT served from IMD yet. Their
 * endpoints are keyed on station and city identifiers, and the mapping from a
 * place to those identifiers has not been verified against live responses.
 * Rather than guess at it, those two methods return `noData` and the composite
 * source below keeps serving them from Open-Meteo, each value carrying its own
 * source in its own provenance line. A visitor is never told IMD said
 * something IMD did not say.
 *
 * ASSUMPTIONS, marked because they are assumptions
 *
 * The severity scale is IMD's published colour scale — green, yellow, orange,
 * red — which is the same taxonomy the warning templates are keyed on, so that
 * mapping is grounded rather than invented.
 *
 * The SHAPE of the district warning payload is not. It is read defensively and
 * anything not understood is rejected as a whole. That direction is
 * deliberate: a half-read warning is worse than no warning, because it looks
 * like an answer.
 */

import { TTL, cached } from '../cache';
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
 * IMD's colour scale, which is the taxonomy the templates are keyed on.
 *
 * Deliberately exhaustive and deliberately unforgiving: a colour that is not
 * one of these four is not mapped to the nearest one, it is refused. Guessing
 * that an unknown word means "orange" is how a real warning gets softened, and
 * softening is the failure the verification gate cannot catch.
 */
const SEVERITY_BY_COLOUR: Record<string, Severity> = {
  green: 'none',
  yellow: 'watch',
  orange: 'alert',
  red: 'warning',
};

export function severityFromColour(value: unknown): Severity | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  return SEVERITY_BY_COLOUR[key] ?? null;
}

/* ------------------------------------------------------------------ */
/* The district identifier                                             */
/* ------------------------------------------------------------------ */

/**
 * IMD keys district warnings on a numeric object id, not on a district name.
 *
 * Chaatak's `DistrictId` currently carries a name, so a numeric id is passed
 * straight through and anything else is refused. Refused, and not guessed:
 * mapping "Barabanki" onto a number without IMD's own district list would be
 * inventing the single field that decides whose warning someone is shown.
 *
 * The list endpoint that would close this gap has not been identified against
 * a live response yet. Until it is, a caller must supply the numeric id.
 */
export function imdDistrictId(district: DistrictId): string | null {
  const raw = String(district).trim();
  return /^\d+$/.test(raw) ? raw : null;
}

/* ------------------------------------------------------------------ */
/* Warnings                                                            */
/* ------------------------------------------------------------------ */

type RawWarning = Record<string, unknown>;

function firstString(row: RawWarning, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

/**
 * Pull the rows out of whatever envelope IMD wrapped them in.
 *
 * An array, or an object with the array under a common key. Anything else
 * returns null, which the caller turns into noData rather than into silence.
 */
export function warningRows(payload: unknown): RawWarning[] | null {
  if (Array.isArray(payload)) return payload as RawWarning[];
  if (payload && typeof payload === 'object') {
    for (const key of ['data', 'warnings', 'result', 'records']) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as RawWarning[];
    }
  }
  return null;
}

/**
 * One IMD row into one Warning, or nothing.
 *
 * Every field that a warning cannot be rendered without is required. A row
 * missing any of them is dropped rather than defaulted, because every default
 * available here — a severity, a validity window — is a claim about weather.
 */
export function toWarning(
  row: RawWarning,
  district: DistrictId,
  endpoint: string,
  issuedAt: string | null,
): Warning | null {
  const severity = severityFromColour(
    firstString(row, ['colour', 'color', 'warning_colour', 'warning_color', 'severity']),
  );
  if (severity === null) return null;

  const code = firstString(row, ['warning_code', 'code', 'hazard_code', 'warning_type']);
  if (!code) return null;

  const validFrom = firstString(row, ['valid_from', 'validFrom', 'from', 'start', 'date']);
  const validTo = firstString(row, ['valid_to', 'validTo', 'to', 'end']);
  if (!validFrom || !validTo) return null;

  const id = firstString(row, ['id', 'warning_id', 'uid']) ?? `${district}:${code}:${validFrom}`;

  return {
    kind: 'warning',
    id,
    code,
    severity,
    district,
    validFrom,
    validTo,
    provenance: {
      source: SOURCE,
      endpoint,
      issuedAt: issuedAt ?? validFrom,
      timeBasis: issuedAt ? 'issued' : 'valid',
    },
  };
}

async function fetchWarnings(
  district: DistrictId,
  credentials: ImdCredentials,
): Promise<Warning[] | NoWarning | NoData> {
  const endpoint = imdEndpoint(WARNING_PATH);
  const objId = imdDistrictId(district);

  if (!objId) {
    return noData('unknownPlace', endpoint, {
      hi: 'इस ज़िले के लिए IMD की पहचान संख्या अभी उपलब्ध नहीं है।',
      en: 'No IMD district identifier is available for this district yet.',
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
    // after discarding it: a loop here would hammer the sign-in endpoint on a
    // credential that has genuinely been revoked.
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
    // Understood nothing. Not "no warning" — we do not know.
    return noData('lookupFailed', endpoint, {
      hi: 'IMD का जवाब पहचाना नहीं गया।',
      en: 'IMD returned a response in an unrecognised shape.',
    });
  }

  const issuedAt =
    (payload && typeof payload === 'object'
      ? firstString(payload as RawWarning, ['issued_at', 'issuedAt', 'issue_time', 'bulletin_time'])
      : null) ?? null;

  const warnings = rows
    .map((row) => toWarning(row, district, endpoint, issuedAt))
    .filter((w): w is Warning => w !== null)
    // Green is IMD saying there is nothing in force, not a warning to show.
    .filter((w) => w.severity !== 'none');

  if (rows.length > 0 && warnings.length === 0) {
    // Rows arrived and none became a warning. Either everything was green, or
    // nothing was understood, and those are different answers. Only treat it
    // as "asked, nothing in force" when at least one row was readable.
    const readable = rows.some(
      (row) => severityFromColour(
        firstString(row, ['colour', 'color', 'warning_colour', 'warning_color', 'severity']),
      ) !== null,
    );
    if (!readable) {
      return noData('lookupFailed', endpoint, {
        hi: 'IMD का जवाब पहचाना नहीं गया।',
        en: 'IMD returned a response in an unrecognised shape.',
      });
    }
  }

  if (warnings.length === 0) {
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
 * Composed rather than split into two config values because a visitor asks one
 * question and every value that comes back carries its own provenance. The
 * temperature says Open-Meteo and the warning says IMD, which is the truth.
 * When IMD's station mapping is verified, the two delegations below become
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
      // Configuration faults are thrown, not swallowed: the route layer
      // decides how much of one a visitor may see.
      throw error;
    }

    // IMD asks callers to cache. A district warning is a bulletin, not a
    // live reading, so the nowcast TTL is the right shape of freshness.
    return cached(
      `imd:warnings:${district}`,
      TTL.warnings,
      () => fetchWarnings(district, credentials),
    );
  },
};
