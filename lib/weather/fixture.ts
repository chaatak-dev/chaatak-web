/**
 * A warning source that returns known warnings on demand.
 *
 * Open-Meteo has no warning product and IMD access is still pending, so the
 * alert pipeline is built against this. The point is to exercise the pipeline,
 * not to invent data: everything here is obviously synthetic, labelled as
 * such in its provenance, and selected only by an explicit config value.
 *
 * IMD swaps in behind the same WeatherSource interface with no change above
 * the adapter.
 */

import { openMeteo } from './open-meteo';
import type {
  DistrictId,
  Forecast,
  History,
  HistoryRequest,
  Location,
  NoData,
  NoWarning,
  Reading,
  Severity,
  Warning,
  WeatherSource,
} from './types';

const SOURCE = 'Fixture (synthetic)';
const ENDPOINT = '/fixture/warnings';

/**
 * The scenario the fixture is currently serving. Changed through
 * `setFixtureScenario` in tests, or FIXTURE_SCENARIO in a running server, so a
 * demo can move a warning through its whole life without editing code.
 */
export type FixtureScenario =
  /** Nothing in force anywhere. */
  | 'quiet'
  /** One orange warning, valid for six hours. */
  | 'orange'
  /** The same warning, restamped but otherwise identical. */
  | 'orangeRestamped'
  /** The same warning upgraded to red. */
  | 'red'
  /** The warning is gone while its window is still open — withdrawn. */
  | 'withdrawn'
  /**
   * The warning is still listed but its window has already closed. Polling
   * this marks it seen with a past validTo, so that switching to 'quiet'
   * afterwards exercises expiry rather than withdrawal.
   */
  | 'expired';

let scenario: FixtureScenario =
  (process.env.FIXTURE_SCENARIO as FixtureScenario) || 'quiet';

export function setFixtureScenario(next: FixtureScenario): void {
  scenario = next;
}

export function fixtureScenario(): FixtureScenario {
  return scenario;
}

/** The district the fixture issues warnings for. */
export const FIXTURE_DISTRICT = 'barabanki' as DistrictId;

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function build(severity: Severity, opts: { expired?: boolean } = {}): Warning {
  return {
    kind: 'warning',
    id: 'FIXTURE-BBK-0001',
    code: severity === 'warning' ? 'HR-4' : 'HR-3',
    severity,
    district: FIXTURE_DISTRICT,
    validFrom: hoursFromNow(-1),
    validTo: opts.expired ? hoursFromNow(-0.5) : hoursFromNow(6),
    provenance: {
      source: SOURCE,
      endpoint: ENDPOINT,
      // Restamped on every call, exactly as IMD is understood to do — which is
      // precisely what the fingerprint must ignore.
      issuedAt: new Date().toISOString(),
      timeBasis: 'issued',
    },
  };
}

function warningsFor(district: DistrictId): Warning[] {
  if (district !== FIXTURE_DISTRICT) return [];

  switch (scenario) {
    case 'orange':
    case 'orangeRestamped':
      return [build('alert')];
    case 'red':
      return [build('warning')];
    case 'expired':
      return [build('alert', { expired: true })];
    case 'quiet':
    case 'withdrawn':
    default:
      return [];
  }
}

export const fixtureSource: WeatherSource = {
  name: SOURCE,
  // Refused outright by weatherSource(); reachable only through
  // warningSource(), which the alert daemon alone calls.
  synthetic: true,

  // Current conditions and forecasts are not what this fixture is for, so it
  // defers to the real adapter rather than inventing readings.
  getCurrent(loc: Location): Promise<Reading | NoData> {
    return openMeteo.getCurrent(loc);
  },
  getForecast(loc: Location, days: number): Promise<Forecast | NoData> {
    return openMeteo.getForecast(loc, days);
  },
  getHistory(loc: Location, request: HistoryRequest): Promise<History | NoData> {
    return openMeteo.getHistory(loc, request);
  },

  async getWarnings(district: DistrictId): Promise<Warning[] | NoWarning | NoData> {
    const warnings = warningsFor(district);

    // Empty means asked-and-nothing-in-force, which is noWarning and not
    // noData. Adapters do this translation so no consumer has to interpret
    // emptiness for itself.
    if (warnings.length === 0) {
      return {
        kind: 'noWarning',
        source: SOURCE,
        endpoint: ENDPOINT,
        issuedAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
        timeBasis: 'issued',
      } satisfies NoWarning;
    }

    return warnings;
  },
};
