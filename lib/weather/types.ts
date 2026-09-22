/**
 * The data contract for every weather source.
 *
 * The one rule: this system never generates weather information, it only
 * retrieves and renders it. These types are how that rule is enforced in the
 * compiler rather than in review comments. A value that reaches the UI without
 * having come through one of these shapes is a bug.
 */

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

/**
 * What the upstream timestamp actually means. Sources differ, and rounding
 * them all to "issued" would over-claim.
 *
 *   issued  — the source stamped the bulletin when it published it (IMD).
 *   updated — the source last refreshed these values (Open-Meteo `current.time`).
 *   valid   — the values describe this moment, with no publication time given.
 */
export type TimeBasis = 'issued' | 'updated' | 'valid';

/**
 * What KIND of thing a number is.
 *
 * A model's output and a thermometer's reading are not the same claim, and
 * presenting one as the other is a lie of category rather than of value. IMD's
 * station rows are observations; Open-Meteo's `current` block is a model
 * evaluated at this hour; a district warning is a bulletin somebody issued.
 * The interface says which, because "31°C" means something different in each.
 */
export type ValueNature = 'observation' | 'model' | 'bulletin';

/**
 * Provenance is part of the value, never optional metadata. Any type carrying
 * a number carries one of these alongside it.
 *
 * FOUR TIMES, deliberately kept apart. They answer different questions and
 * collapsing them is how a six-hour-old observation ends up on screen under
 * the word "now":
 *
 *   observedAt  when an instrument actually measured it
 *   issuedAt    the meaningful upstream time — what `timeBasis` describes
 *   fetchedAt   when WE asked, which says nothing about the value
 *   modelRun    which run of a model produced it, where the provider says
 *
 * `fetchedAt` is never displayed as the value's time and never stands in for
 * one. A value that is six hours old does not become current because we
 * fetched it a second ago.
 */
export type Provenance = {
  /** Human name of the source, as displayed. */
  source: string;
  /**
   * The endpoint actually called. Kept for traceability and logs; NEVER
   * rendered — a visitor cannot act on `/api/v1/current_wx`, and a provenance
   * line that shows one is citing our plumbing rather than the source.
   */
  endpoint: string;
  /** ISO 8601 with offset. Always from upstream — never `Date.now()`. */
  issuedAt: string;
  timeBasis: TimeBasis;
  /** Observation, model output, or issued bulletin. Absent on older records. */
  nature?: ValueNature;
  /** When an instrument measured it, for sources that report one. */
  observedAt?: string | null;
  /** When we asked. Diagnostic only — never the value's time. */
  fetchedAt?: string;
  /** The model run this came from, where the provider names one. */
  modelRun?: string | null;
};

/* ------------------------------------------------------------------ */
/* The two absence states                                              */
/* ------------------------------------------------------------------ */

export type NoDataReason =
  /** The place resolver could not match the query to anywhere. */
  | 'unknownPlace'
  /** This source has no such product at all (Open-Meteo issues no warnings). */
  | 'noProduct'
  /** We asked and the request failed, timed out, or returned nonsense. */
  | 'lookupFailed'
  /** The source answered, but this field was absent from its response. */
  | 'notInBulletin';

/**
 * `noData` means WE DO NOT KNOW.
 *
 * No warning product exists for this source, or the lookup failed. This is
 * absence of information and is rendered as such: a grey field, a caps label,
 * a plain statement. It carries `checkedAt` — when we asked — and deliberately
 * has no `issuedAt`, because there is no bulletin to have been issued.
 *
 * Never render this as an estimate, and never fall back to another source
 * to fill it in.
 */
export type NoData = {
  kind: 'noData';
  reason: NoDataReason;
  source: string;
  endpoint: string;
  /** ISO 8601. When we asked. NOT an issue time — nothing was issued. */
  checkedAt: string;
  /** One sentence: what happened and, where useful, what to do about it. */
  statement: { hi: string; en: string };
};

/**
 * `noWarning` means WE ASKED AND NOTHING IS IN EFFECT.
 *
 * This is good news, not absence of information, and must not share a type or
 * a component with `noData`. It renders in the `--sev-none` treatment as a
 * positive statement.
 *
 * Phase 1 never produces this — Open-Meteo has no warning product, so its
 * adapter returns `noData`. Phase 4 will produce it whenever IMD answers with
 * an empty warning list. Adapters translate that emptiness here, so no
 * consumer ever has to interpret `[].length === 0` for itself.
 */
export type NoWarning = {
  kind: 'noWarning';
  source: string;
  endpoint: string;
  /** The bulletin's own time, when the source stamps one. Null when it does not. */
  issuedAt: string | null;
  /** ISO 8601. When we asked. Always present. */
  checkedAt: string;
  timeBasis: TimeBasis;
};

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

export type MeasurementKey =
  | 'temperature'
  | 'apparentTemperature'
  | 'humidity'
  | 'precipitation'
  | 'windSpeed';

export type Measurement = {
  key: MeasurementKey;
  value: number;
  /** Read from the source's own units block. A unit is a value too. */
  unit: string;
};

export type Reading = {
  kind: 'reading';
  /** Raw WMO code from upstream. Words come from a template keyed on it. */
  conditionCode: number | null;
  measurements: Measurement[];
  provenance: Provenance;
};

export type ForecastDay = {
  /** ISO calendar date, exactly as upstream gave it. */
  date: string;
  conditionCode: number | null;
  /** `null` means upstream omitted it. It is rendered as absent, never filled in. */
  maxTemp: number | null;
  minTemp: number | null;
  precipitationSum: number | null;
};

export type Forecast = {
  kind: 'forecast';
  days: ForecastDay[];
  units: { temperature: string; precipitation: string };
  provenance: Provenance;
};

/** IMD's warning scale. Drives layout, not accent colour. */
export type Severity = 'none' | 'watch' | 'alert' | 'warning';

/** Opaque in Phase 1. Phase 4 resolves lat/lon to IMD's district Obj_id. */
export type DistrictId = string & { readonly __brand: 'DistrictId' };

export type Warning = {
  kind: 'warning';
  id: string;
  /** IMD warning code. Rendered from a human-translated template, never MT. */
  code: string;
  severity: Severity;
  district: DistrictId;
  validFrom: string;
  validTo: string;
  provenance: Provenance;
};

/* ------------------------------------------------------------------ */
/* Places                                                              */
/* ------------------------------------------------------------------ */

export type Location = {
  name: string;
  /** State. */
  admin1?: string;
  /** District. Phase 4 maps this to a DistrictId. */
  admin2?: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  /** IANA zone, from the resolver. All times display in the place's own zone. */
  timezone: string;
  resolvedBy: string;
  endpoint: string;
};

/* ------------------------------------------------------------------ */
/* The interfaces                                                      */
/* ------------------------------------------------------------------ */

/**
 * Turning a typed place name into coordinates.
 *
 * Deliberately separate from `WeatherSource`. A geocode is not a weather value,
 * and IMD has no geocoder — so this stays Open-Meteo's even after the Phase 4
 * swap, while every actual measurement moves to IMD.
 */
export interface PlaceResolver {
  name: string;
  resolve(query: string): Promise<Location | NoData>;
}

/**
 * All weather sources sit behind this. Swapping sources must never require
 * touching application logic.
 */
export interface WeatherSource {
  name: string;
  /**
   * True for sources that return invented data.
   *
   * A synthetic source exists to exercise a pipeline, and must never reach a
   * real visitor. This flag is what the user-facing selector refuses on — a
   * property rather than a name, so renaming a fixture cannot slip it past
   * the guard. Absent means real.
   */
  synthetic?: true;
  getCurrent(loc: Location): Promise<Reading | NoData>;
  getForecast(loc: Location, days: number): Promise<Forecast | NoData>;
  /**
   * A returned `Warning[]` is guaranteed non-empty: adapters convert an empty
   * result into `noWarning` so consumers never interpret emptiness themselves.
   */
  getWarnings(district: DistrictId): Promise<Warning[] | NoWarning | NoData>;
}
