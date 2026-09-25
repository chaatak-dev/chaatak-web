/**
 * What climate analysis can be asked about, and how each thing is summed up.
 *
 * Shared by the page and the server: pure data, no network, no Node APIs.
 *
 * ONE DATASET FOR EVERYTHING. Every parameter here is read from ERA5, the
 * ECMWF reanalysis, through Open-Meteo's archive — never a blend of ERA5 for
 * some years and a forecast archive or ERA5-Land for others. A trend drawn
 * across a change of dataset measures the change of dataset as much as the
 * climate, and a reader cannot see the seam.
 *
 * A parameter is listed only if ERA5 serves it daily for the whole record
 * and the summary written against it means something. Verified against the
 * live archive, not assumed from the docs.
 */

export type ClimateParam =
  | 'tMean'
  | 'tMax'
  | 'tMin'
  | 'precip'
  | 'rainyDays'
  | 'humidity'
  | 'dewPoint'
  | 'windMean'
  | 'windMax'
  | 'gusts'
  | 'pressure'
  | 'cloud'
  | 'sunshine'
  | 'et0'
  | 'vpd'
  | 'soilTemp'
  | 'soilMoisture';

/**
 * How a period's days become one number.
 *
 *   mean   the average of the daily values        temperature, humidity, wind
 *   sum    the total of the daily values          rainfall, evapotranspiration
 *   count  the number of days meeting a rule      rainy days
 */
export type Aggregate = 'mean' | 'sum' | 'count';

/** Which upstream request a parameter travels in. See lib/climate/archive.ts. */
export type Bundle = 'core' | 'extended';

export type ParamGroup = 'temperature' | 'rain' | 'air' | 'wind' | 'land';

export type ParamSpec = {
  key: ClimateParam;
  group: ParamGroup;
  /** Open-Meteo's daily variable. */
  field: string;
  bundle: Bundle;
  aggregate: Aggregate;
  /**
   * The unit shown. For a direct value it must match upstream's own unit
   * block, and the adapter refuses a mismatch rather than mislabelling.
   */
  unit: string;
  /** What upstream reports, where the value is converted (seconds → hours). */
  upstreamUnit?: string;
  /** Decimal places the summary is shown at. */
  decimals: number;
  /**
   * The year × month grid shows departures from the baseline for a quantity
   * that has a natural "normal" (temperature), and plain values for one whose
   * zero means something (rainfall).
   */
  heatmap: 'anomaly' | 'value';
};

/**
 * IMD's rainy day: 2.5 mm or more in 24 hours. IMD's own definition is used
 * rather than the WMO 1 mm wet day, because this is an Indian product read
 * against IMD's bulletins.
 */
export const RAINY_DAY_MM = 2.5;

/** IMD's "heavy rain" category begins at 64.5 mm in 24 hours. */
export const HEAVY_RAIN_MM = 64.5;

/** An absolute heat threshold with meaning across the Indian plains. */
export const HOT_DAY_C = 40;

/** Relative extremes: above the baseline's 90th percentile of daily values. */
export const EXTREME_PERCENTILE = 90;

/** Daily mean relative humidity at or above this is a humid day. */
export const HUMID_DAY_PCT = 80;

export const PARAMS: Record<ClimateParam, ParamSpec> = {
  tMean: { key: 'tMean', group: 'temperature', field: 'temperature_2m_mean', bundle: 'core', aggregate: 'mean', unit: '°C', decimals: 1, heatmap: 'anomaly' },
  tMax: { key: 'tMax', group: 'temperature', field: 'temperature_2m_max', bundle: 'core', aggregate: 'mean', unit: '°C', decimals: 1, heatmap: 'anomaly' },
  tMin: { key: 'tMin', group: 'temperature', field: 'temperature_2m_min', bundle: 'core', aggregate: 'mean', unit: '°C', decimals: 1, heatmap: 'anomaly' },
  precip: { key: 'precip', group: 'rain', field: 'precipitation_sum', bundle: 'core', aggregate: 'sum', unit: 'mm', decimals: 0, heatmap: 'value' },
  // Derived from the same daily rainfall, so it travels with it.
  rainyDays: { key: 'rainyDays', group: 'rain', field: 'precipitation_sum', bundle: 'core', aggregate: 'count', unit: 'days', decimals: 0, heatmap: 'value' },
  humidity: { key: 'humidity', group: 'air', field: 'relative_humidity_2m_mean', bundle: 'core', aggregate: 'mean', unit: '%', decimals: 0, heatmap: 'anomaly' },
  dewPoint: { key: 'dewPoint', group: 'air', field: 'dew_point_2m_mean', bundle: 'core', aggregate: 'mean', unit: '°C', decimals: 1, heatmap: 'anomaly' },
  windMean: { key: 'windMean', group: 'wind', field: 'wind_speed_10m_mean', bundle: 'core', aggregate: 'mean', unit: 'km/h', decimals: 1, heatmap: 'anomaly' },
  windMax: { key: 'windMax', group: 'wind', field: 'wind_speed_10m_max', bundle: 'core', aggregate: 'mean', unit: 'km/h', decimals: 1, heatmap: 'anomaly' },
  gusts: { key: 'gusts', group: 'wind', field: 'wind_gusts_10m_max', bundle: 'extended', aggregate: 'mean', unit: 'km/h', decimals: 1, heatmap: 'anomaly' },
  pressure: { key: 'pressure', group: 'air', field: 'pressure_msl_mean', bundle: 'extended', aggregate: 'mean', unit: 'hPa', decimals: 1, heatmap: 'anomaly' },
  cloud: { key: 'cloud', group: 'air', field: 'cloud_cover_mean', bundle: 'extended', aggregate: 'mean', unit: '%', decimals: 0, heatmap: 'anomaly' },
  sunshine: { key: 'sunshine', group: 'air', field: 'sunshine_duration', bundle: 'extended', aggregate: 'mean', unit: 'h', upstreamUnit: 's', decimals: 1, heatmap: 'anomaly' },
  et0: { key: 'et0', group: 'land', field: 'et0_fao_evapotranspiration', bundle: 'core', aggregate: 'sum', unit: 'mm', decimals: 0, heatmap: 'value' },
  vpd: { key: 'vpd', group: 'land', field: 'vapour_pressure_deficit_max', bundle: 'extended', aggregate: 'mean', unit: 'kPa', decimals: 2, heatmap: 'anomaly' },
  soilTemp: { key: 'soilTemp', group: 'land', field: 'soil_temperature_0_to_7cm_mean', bundle: 'extended', aggregate: 'mean', unit: '°C', decimals: 1, heatmap: 'anomaly' },
  soilMoisture: { key: 'soilMoisture', group: 'land', field: 'soil_moisture_0_to_7cm_mean', bundle: 'extended', aggregate: 'mean', unit: 'm³/m³', decimals: 3, heatmap: 'anomaly' },
};

export const PARAM_KEYS = Object.keys(PARAMS) as ClimateParam[];

export const PARAM_GROUPS: { group: ParamGroup; params: ClimateParam[] }[] = [
  { group: 'temperature', params: ['tMean', 'tMax', 'tMin'] },
  { group: 'rain', params: ['precip', 'rainyDays'] },
  { group: 'air', params: ['humidity', 'dewPoint', 'cloud', 'sunshine', 'pressure'] },
  { group: 'wind', params: ['windMean', 'windMax', 'gusts'] },
  { group: 'land', params: ['et0', 'vpd', 'soilTemp', 'soilMoisture'] },
];

/** More than this and the page stops being readable on a phone. */
export const MAX_PARAMS = 4;

export function isParam(value: unknown): value is ClimateParam {
  return typeof value === 'string' && value in PARAMS;
}

/* ------------------------------------------------------------------ */
/* Seasons, baselines, resolution                                      */
/* ------------------------------------------------------------------ */

/**
 * IMD's four seasons. None crosses a year boundary, so a season belongs to
 * exactly one calendar year and nothing has to be stitched.
 */
export const SEASONS = {
  annual: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  winter: [1, 2],
  preMonsoon: [3, 4, 5],
  monsoon: [6, 7, 8, 9],
  postMonsoon: [10, 11, 12],
} as const;

export type Season = keyof typeof SEASONS;
export const SEASON_KEYS = Object.keys(SEASONS) as Season[];

export type Resolution = 'annual' | 'monthly';

/**
 * WMO standard normals. 1991–2020 is the current one and the default;
 * 1961–1990 is the long-standing reference for "before recent warming"
 * comparisons; 1981–2010 is the normal most Indian references still quote.
 */
export const BASELINES = {
  '1991-2020': [1991, 2020],
  '1981-2010': [1981, 2010],
  '1961-1990': [1961, 1990],
} as const;

export type BaselineKey = keyof typeof BASELINES | 'custom';

/** ERA5 begins in 1940. */
export const FIRST_YEAR = 1940;

/** A baseline shorter than this averages weather, not climate. */
export const MIN_BASELINE_YEARS = 10;

/** Below this a trend line is noise with a slope. */
export const MIN_TREND_YEARS = 10;

export const MIN_PERIOD_YEARS = 3;

/**
 * The last year ERA5 holds in full. Its final days land roughly five days
 * after they happen, so January's first week still belongs to the year
 * before last. Only complete years are analysed: a year that has not ended
 * compared against whole ones reads as a record dry year every spring.
 */
export function lastCompleteYear(now: Date = new Date()): number {
  const settled = new Date(now.getTime() - 10 * 86_400_000);
  return settled.getUTCFullYear() - 1;
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

export type PresetKey =
  | 'temperatureTrend'
  | 'rainfall'
  | 'heat'
  | 'seasonal'
  | 'rainSeasonality'
  | 'compare'
  | 'custom';

/** Which chart leads. The rest follow in a fixed order. */
export type LeadView = 'series' | 'indicators' | 'climatology' | 'heatmap' | 'multiples';

export type Preset = {
  key: PresetKey;
  params: ClimateParam[];
  resolution: Resolution;
  season: Season;
  lead: LeadView;
};

export const PRESETS: Record<PresetKey, Preset> = {
  temperatureTrend: { key: 'temperatureTrend', params: ['tMean', 'tMax', 'tMin'], resolution: 'annual', season: 'annual', lead: 'series' },
  rainfall: { key: 'rainfall', params: ['precip', 'rainyDays'], resolution: 'annual', season: 'annual', lead: 'series' },
  heat: { key: 'heat', params: ['tMax', 'tMin'], resolution: 'annual', season: 'preMonsoon', lead: 'indicators' },
  seasonal: { key: 'seasonal', params: ['tMean', 'precip', 'humidity'], resolution: 'monthly', season: 'annual', lead: 'climatology' },
  rainSeasonality: { key: 'rainSeasonality', params: ['precip'], resolution: 'monthly', season: 'annual', lead: 'heatmap' },
  compare: { key: 'compare', params: ['tMean', 'precip', 'humidity', 'windMean'], resolution: 'annual', season: 'annual', lead: 'multiples' },
  custom: { key: 'custom', params: ['tMean'], resolution: 'annual', season: 'annual', lead: 'series' },
};

export const PRESET_KEYS = Object.keys(PRESETS) as PresetKey[];

/* ------------------------------------------------------------------ */
/* The request                                                         */
/* ------------------------------------------------------------------ */

export type ClimateQuery = {
  place: string;
  from: number;
  to: number;
  baseline: BaselineKey;
  baselineFrom: number;
  baselineTo: number;
  params: ClimateParam[];
  resolution: Resolution;
  season: Season;
  preset: PresetKey;
};

export type QueryProblem =
  | 'noPlace'
  | 'badPeriod'
  | 'badBaseline'
  | 'noParams'
  | 'tooManyParams';

export function defaultQuery(now: Date = new Date()): Omit<ClimateQuery, 'place'> {
  const last = lastCompleteYear(now);
  return {
    from: 1991,
    to: last,
    baseline: '1991-2020',
    baselineFrom: 1991,
    baselineTo: 2020,
    params: [...PRESETS.temperatureTrend.params],
    resolution: 'annual',
    season: 'annual',
    preset: 'temperatureTrend',
  };
}

function int(value: string | null): number | null {
  if (value === null || !/^\d{4}$/.test(value.trim())) return null;
  return Number(value);
}

/**
 * Read and validate a query from URL parameters.
 *
 * Strict rather than forgiving: an out-of-range year is refused, not
 * clamped, because a clamped request answers a question nobody asked under a
 * provenance line that states the question it was given.
 */
export function readQuery(
  search: URLSearchParams,
  now: Date = new Date(),
): { ok: true; query: ClimateQuery } | { ok: false; problem: QueryProblem } {
  const defaults = defaultQuery(now);
  const last = lastCompleteYear(now);

  const place = (search.get('place') ?? '').trim().slice(0, 80);
  if (!place) return { ok: false, problem: 'noPlace' };

  const from = int(search.get('from')) ?? defaults.from;
  const to = int(search.get('to')) ?? defaults.to;
  if (from < FIRST_YEAR || to > last || to - from + 1 < MIN_PERIOD_YEARS) {
    return { ok: false, problem: 'badPeriod' };
  }

  const baselineRaw = search.get('baseline') ?? defaults.baseline;
  let baseline: BaselineKey;
  let baselineFrom: number;
  let baselineTo: number;
  if (baselineRaw === 'custom') {
    const bFrom = int(search.get('bfrom'));
    const bTo = int(search.get('bto'));
    if (bFrom === null || bTo === null) return { ok: false, problem: 'badBaseline' };
    baseline = 'custom';
    baselineFrom = bFrom;
    baselineTo = bTo;
  } else if (baselineRaw in BASELINES) {
    baseline = baselineRaw as keyof typeof BASELINES;
    [baselineFrom, baselineTo] = BASELINES[baseline];
  } else {
    return { ok: false, problem: 'badBaseline' };
  }
  if (
    baselineFrom < FIRST_YEAR ||
    baselineTo > last ||
    baselineTo - baselineFrom + 1 < MIN_BASELINE_YEARS
  ) {
    return { ok: false, problem: 'badBaseline' };
  }

  const params = [
    ...new Set((search.get('params') ?? '').split(',').map((p) => p.trim()).filter(isParam)),
  ];
  if (params.length === 0) return { ok: false, problem: 'noParams' };
  if (params.length > MAX_PARAMS) return { ok: false, problem: 'tooManyParams' };

  const resolutionRaw = search.get('res');
  const resolution: Resolution = resolutionRaw === 'monthly' ? 'monthly' : 'annual';

  const seasonRaw = search.get('season') ?? 'annual';
  const season: Season = seasonRaw in SEASONS ? (seasonRaw as Season) : 'annual';

  const presetRaw = search.get('preset') ?? 'custom';
  const preset: PresetKey = presetRaw in PRESETS ? (presetRaw as PresetKey) : 'custom';

  return {
    ok: true,
    query: { place, from, to, baseline, baselineFrom, baselineTo, params, resolution, season, preset },
  };
}

/** The inverse of readQuery, for the page's requests and shareable URLs. */
export function writeQuery(query: ClimateQuery): URLSearchParams {
  const search = new URLSearchParams({
    place: query.place,
    from: String(query.from),
    to: String(query.to),
    baseline: query.baseline,
    params: query.params.join(','),
    res: query.resolution,
    season: query.season,
    preset: query.preset,
  });
  if (query.baseline === 'custom') {
    search.set('bfrom', String(query.baselineFrom));
    search.set('bto', String(query.baselineTo));
  }
  return search;
}
