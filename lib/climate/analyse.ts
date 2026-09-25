/**
 * Turning decades of daily reanalysis into statistics a person can read.
 *
 * Pure: a daily series and a query in, numbers out. Nothing here fetches,
 * nothing here guesses, and nothing here reaches for a second source.
 *
 * THE RULES EVERY NUMBER FOLLOWS
 *
 *   - An average needs 90% of its days; a total or a count needs all of
 *     them. A month with a missing week is not a dry month, and summing it
 *     as if it were would invent a record.
 *   - A baseline average needs 80% of its years.
 *   - A trend needs at least ten years, and is called "clear" only when it
 *     passes a two-sided t-test at 95%. Otherwise the slope is still shown,
 *     labelled as not distinguishable from year-to-year variation.
 *   - An indicator that never fires at this place (no day ever reached
 *     40 °C) is left out, rather than drawn as a flat line of zeros that
 *     looks like a finding.
 *   - Rounding happens once, at the end, to the parameter's own precision.
 *     Differences are taken between unrounded values, so a displayed
 *     anomaly is the anomaly, not the difference of two rounded numbers.
 *
 * Nothing here says why a number changed. A difference from a baseline is
 * an observed (here: reanalysed) difference; attributing it to a cause is a
 * separate science this page does not do.
 */

import type { DailyArchive } from './archive';
import {
  EXTREME_PERCENTILE,
  HEAVY_RAIN_MM,
  HOT_DAY_C,
  HUMID_DAY_PCT,
  MIN_TREND_YEARS,
  PARAMS,
  PRESETS,
  RAINY_DAY_MM,
  SEASONS,
  type ClimateParam,
  type ClimateQuery,
  type ParamSpec,
} from './params';
import type {
  DistributionBin,
  Extreme,
  Indicator,
  IndicatorKey,
  MonthValue,
  ParamAnalysis,
  SeasonShare,
  Trend,
  YearValue,
} from './types';

/** Share of days an average needs. */
export const MEAN_COVERAGE = 0.9;
/** Share of baseline years a baseline average needs. */
export const BASELINE_COVERAGE = 0.8;
/** Years in the "recent" window. */
export const RECENT_YEARS = 10;

/* ------------------------------------------------------------------ */
/* Arithmetic                                                          */
/* ------------------------------------------------------------------ */

/** Round to `decimals`, and never return -0. */
export function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

function roundOrNull(n: number | null, decimals: number): number | null {
  return n === null || !Number.isFinite(n) ? null : round(n, decimals);
}

/** Mean of the non-null values, provided enough of them are present. */
export function meanOf(values: (number | null)[], minShare = 0): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0 || present.length / values.length < minShare) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

/** Linear-interpolated percentile, p in 0–100. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/**
 * Two-sided 95% critical values of Student's t by degrees of freedom.
 * Between listed rows the next-lower row is used, which is the stricter one.
 */
const T_975: [number, number][] = [
  [1, 12.706], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571], [6, 2.447],
  [7, 2.365], [8, 2.306], [9, 2.262], [10, 2.228], [11, 2.201], [12, 2.179],
  [13, 2.16], [14, 2.145], [15, 2.131], [16, 2.12], [17, 2.11], [18, 2.101],
  [19, 2.093], [20, 2.086], [22, 2.074], [24, 2.064], [26, 2.056], [28, 2.048],
  [30, 2.042], [40, 2.021], [50, 2.009], [60, 2.0], [80, 1.99], [100, 1.984],
  [120, 1.98],
];

export function tCritical(df: number): number {
  let value = T_975[0][1];
  for (const [d, t] of T_975) {
    if (d <= df) value = t;
  }
  return df > 120 ? 1.96 : value;
}

export type Fit = { slope: number; intercept: number; t: number; n: number };

/** Ordinary least squares with the slope's t statistic. */
export function linearFit(points: { x: number; y: number }[]): Fit | null {
  const n = points.length;
  if (n < 3) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (const p of points) sse += (p.y - (intercept + slope * p.x)) ** 2;
  const se = Math.sqrt(sse / (n - 2) / sxx);
  // A perfect line has no error; its slope is as clear as a slope can be.
  const t = se === 0 ? (slope === 0 ? 0 : Infinity) : slope / se;
  return { slope, intercept, t, n };
}

/** The trend of a yearly series, or null when there are too few years. */
export function trendOf(
  series: { year: number; value: number | null }[],
  decimals: number,
): Trend | null {
  const points = series
    .filter((p): p is { year: number; value: number } => p.value !== null)
    .map((p) => ({ x: p.year, y: p.value }));
  if (points.length < MIN_TREND_YEARS) return null;
  const fit = linearFit(points);
  if (!fit) return null;
  const first = points[0].x;
  const last = points[points.length - 1].x;
  return {
    perDecade: round(fit.slope * 10, decimals + 1),
    clear: Math.abs(fit.t) > tCritical(fit.n - 2),
    years: fit.n,
    start: { year: first, value: round(fit.intercept + fit.slope * first, decimals + 1) },
    end: { year: last, value: round(fit.intercept + fit.slope * last, decimals + 1) },
  };
}

/* ------------------------------------------------------------------ */
/* The calendar                                                        */
/* ------------------------------------------------------------------ */

/** Index ranges [start, end) of each month of each year in the series. */
type Calendar = Map<number, Map<number, [number, number]>>;

export function calendarOf(dates: string[]): Calendar {
  const calendar: Calendar = new Map();
  for (let i = 0; i < dates.length; i++) {
    const year = Number(dates[i].slice(0, 4));
    const month = Number(dates[i].slice(5, 7));
    let months = calendar.get(year);
    if (!months) {
      months = new Map();
      calendar.set(year, months);
    }
    const range = months.get(month);
    if (range) range[1] = i + 1;
    else months.set(month, [i, i + 1]);
  }
  return calendar;
}

function rangesFor(calendar: Calendar, year: number, months: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  const byMonth = calendar.get(year);
  for (const m of months) {
    const r = byMonth?.get(m);
    // A month the series does not reach is a month with no days, which the
    // coverage rule then refuses — it is never silently skipped.
    out.push(r ?? [0, 0]);
  }
  return out;
}

/** Calendar days in a month, so a month the series never reached counts as missing. */
function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function expectedDays(year: number, months: readonly number[]): number {
  return months.reduce((a, m) => a + daysIn(year, m), 0);
}

/**
 * One number for a stretch of days, or null when the record is too thin.
 * `expected` is the calendar's count, so days the series lacks entirely are
 * missing days, exactly like days it returned empty.
 */
export function aggregateDays(
  values: (number | null)[],
  ranges: [number, number][],
  expected: number,
  aggregate: 'mean' | 'sum' | 'count',
): number | null {
  let present = 0;
  let sum = 0;
  for (const [a, b] of ranges) {
    for (let i = a; i < b; i++) {
      const v = values[i];
      if (v === null || v === undefined) continue;
      present += 1;
      sum += v;
    }
  }
  if (expected === 0 || present === 0) return null;
  if (aggregate === 'mean') return present / expected >= MEAN_COVERAGE ? sum / present : null;
  return present === expected ? sum : null;
}

/* ------------------------------------------------------------------ */
/* Per-parameter daily values                                          */
/* ------------------------------------------------------------------ */

/**
 * A parameter's daily values in its display unit, or null when the archive
 * did not send the field in the unit it is catalogued in.
 */
export function dailyValues(spec: ParamSpec, archive: DailyArchive): (number | null)[] | null {
  const column = archive.columns[spec.field];
  const unit = archive.units[spec.field];
  if (!column || unit === undefined) return null;

  if (spec.aggregate === 'count') {
    if (unit !== 'mm') return null;
    return column.map((v) => (v === null ? null : v >= RAINY_DAY_MM ? 1 : 0));
  }
  if (spec.upstreamUnit) {
    if (unit !== spec.upstreamUnit) return null;
    // The one conversion: sunshine arrives in seconds and is read in hours.
    return column.map((v) => (v === null ? null : v / 3600));
  }
  return unit === spec.unit ? column : null;
}

/* ------------------------------------------------------------------ */
/* The analysis                                                        */
/* ------------------------------------------------------------------ */

type Context = {
  archive: DailyArchive;
  calendar: Calendar;
  query: ClimateQuery;
  months: readonly number[];
  periodYears: number[];
  baselineYears: number[];
  recentYears: number[];
};

function yearsBetween(from: number, to: number): number[] {
  const out: number[] = [];
  for (let y = from; y <= to; y++) out.push(y);
  return out;
}

function inYears(date: string, years: number[]): boolean {
  const y = Number(date.slice(0, 4));
  return y >= years[0] && y <= years[years.length - 1];
}

function inMonths(date: string, months: readonly number[]): boolean {
  return months.includes(Number(date.slice(5, 7)));
}

function extremeOf(
  items: { when: string; value: number | null }[],
  pick: 'max' | 'min',
  decimals: number,
): Extreme | null {
  let best: { when: string; value: number } | null = null;
  for (const item of items) {
    if (item.value === null) continue;
    if (!best || (pick === 'max' ? item.value > best.value : item.value < best.value)) {
      best = { when: item.when, value: item.value };
    }
  }
  return best ? { when: best.when, value: round(best.value, decimals) } : null;
}

function pctOf(anomaly: number | null, baseline: number | null): number | null {
  if (anomaly === null || baseline === null || baseline <= 0) return null;
  return round((anomaly / baseline) * 100, 0);
}

/** Days in the window meeting a rule, or null if any day is missing. */
function countDays(
  values: (number | null)[],
  ranges: [number, number][],
  expected: number,
  rule: (v: number) => boolean,
): number | null {
  let present = 0;
  let count = 0;
  for (const [a, b] of ranges) {
    for (let i = a; i < b; i++) {
      const v = values[i];
      if (v === null || v === undefined) continue;
      present += 1;
      if (rule(v)) count += 1;
    }
  }
  return present === expected && expected > 0 ? count : null;
}

/** Daily values in the chosen months of the given years. */
function daysOf(ctx: Context, values: (number | null)[], years: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < ctx.archive.dates.length; i++) {
    const date = ctx.archive.dates[i];
    const v = values[i];
    if (v !== null && inYears(date, years) && inMonths(date, ctx.months)) out.push(v);
  }
  return out;
}

function indicatorFrom(
  ctx: Context,
  key: IndicatorKey,
  param: ClimateParam,
  unit: 'days' | 'mm',
  threshold: number | null,
  thresholdUnit: string | null,
  perYear: (year: number) => { value: number | null; span?: { start: string; end: string } },
  decimals: number,
): Indicator {
  const spans = new Map<number, { start: string; end: string }>();
  const all = [...new Set([...ctx.baselineYears, ...ctx.periodYears])].sort((a, b) => a - b);
  const values = new Map<number, number | null>();
  for (const year of all) {
    const r = perYear(year);
    values.set(year, r.value);
    if (r.span) spans.set(year, r.span);
  }
  const annual = ctx.periodYears.map((year) => ({ year, value: values.get(year) ?? null }));
  const record = extremeOf(annual.map((a) => ({ when: String(a.year), value: a.value })), 'max', decimals);
  return {
    key,
    param,
    unit,
    threshold,
    thresholdUnit,
    annual,
    baseline: roundOrNull(meanOf(ctx.baselineYears.map((y) => values.get(y) ?? null), BASELINE_COVERAGE), 1),
    recent: roundOrNull(meanOf(ctx.recentYears.map((y) => values.get(y) ?? null), BASELINE_COVERAGE), 1),
    trend: trendOf(annual, 1),
    record,
    recordSpan: record ? spans.get(Number(record.when)) ?? null : null,
  };
}

/** True if the rule ever fired in any year analysed. */
function everFires(indicator: Indicator, baselineValues: (number | null)[]): boolean {
  return indicator.annual.some((a) => (a.value ?? 0) > 0) || baselineValues.some((v) => (v ?? 0) > 0);
}

function indicatorsFor(ctx: Context, spec: ParamSpec, values: (number | null)[]): Indicator[] {
  const ranges = (year: number) => rangesFor(ctx.calendar, year, ctx.months);
  const expected = (year: number) => expectedDays(year, ctx.months);
  const counter = (rule: (v: number) => boolean) => (year: number) => ({
    value: countDays(values, ranges(year), expected(year), rule),
  });
  const out: Indicator[] = [];

  const keepIfFires = (indicator: Indicator, rule: (v: number) => boolean) => {
    const baselineValues = ctx.baselineYears.map((y) => countDays(values, ranges(y), expected(y), rule));
    if (everFires(indicator, baselineValues)) out.push(indicator);
  };

  const relative = (key: IndicatorKey) => {
    const threshold = percentile(daysOf(ctx, values, ctx.baselineYears), EXTREME_PERCENTILE);
    if (threshold === null) return;
    const shown = round(threshold, spec.decimals);
    // The rule counts against the SHOWN threshold, so the number on the page
    // is the one the count was made with.
    const rule = (v: number) => v > shown;
    out.push(indicatorFrom(ctx, key, spec.key, 'days', shown, spec.unit, counter(rule), 0));
  };

  switch (spec.key) {
    case 'tMax': {
      const rule = (v: number) => v >= HOT_DAY_C;
      keepIfFires(indicatorFrom(ctx, 'hotDays', 'tMax', 'days', HOT_DAY_C, '°C', counter(rule), 0), rule);
      relative('veryHotDays');
      break;
    }
    case 'tMin':
      relative('warmNights');
      break;
    case 'precip': {
      const heavy = (v: number) => v >= HEAVY_RAIN_MM;
      keepIfFires(
        indicatorFrom(ctx, 'heavyRainDays', 'precip', 'days', HEAVY_RAIN_MM, 'mm', counter(heavy), 0),
        heavy,
      );
      out.push(
        indicatorFrom(ctx, 'longestDrySpell', 'precip', 'days', RAINY_DAY_MM, 'mm', (year) => drySpell(ctx, values, year), 0),
      );
      out.push(
        indicatorFrom(ctx, 'wettestDay', 'precip', 'mm', null, null, (year) => {
          const r = ranges(year);
          let max: number | null = null;
          let present = 0;
          for (const [a, b] of r) {
            for (let i = a; i < b; i++) {
              const v = values[i];
              if (v === null || v === undefined) continue;
              present += 1;
              max = max === null ? v : Math.max(max, v);
            }
          }
          return { value: present === expected(year) && max !== null ? round(max, 1) : null };
        }, 1),
      );
      break;
    }
    case 'humidity': {
      const rule = (v: number) => v >= HUMID_DAY_PCT;
      keepIfFires(indicatorFrom(ctx, 'humidDays', 'humidity', 'days', HUMID_DAY_PCT, '%', counter(rule), 0), rule);
      break;
    }
    case 'windMax':
    case 'gusts':
      relative('windyDays');
      break;
    default:
      break;
  }
  return out;
}

/**
 * The longest run of days without a rainy day (IMD: under 2.5 mm) inside the
 * year's chosen months. A missing day ends a run and makes the year's answer
 * unknown, because a gap could hide the rain that would have broken it.
 */
function drySpell(
  ctx: Context,
  values: (number | null)[],
  year: number,
): { value: number | null; span?: { start: string; end: string } } {
  const ranges = rangesFor(ctx.calendar, year, ctx.months);
  let present = 0;
  let run = 0;
  let runStart = -1;
  let best = 0;
  let bestSpan: [number, number] | null = null;
  for (const [a, b] of ranges) {
    for (let i = a; i < b; i++) {
      const v = values[i];
      if (v === null || v === undefined) {
        run = 0;
        continue;
      }
      present += 1;
      if (v < RAINY_DAY_MM) {
        if (run === 0) runStart = i;
        run += 1;
        if (run > best) {
          best = run;
          bestSpan = [runStart, i];
        }
      } else {
        run = 0;
      }
    }
  }
  if (present !== expectedDays(year, ctx.months)) return { value: null };
  return {
    value: best,
    span: bestSpan
      ? { start: ctx.archive.dates[bestSpan[0]], end: ctx.archive.dates[bestSpan[1]] }
      : undefined,
  };
}

function seasonShares(ctx: Context, values: (number | null)[]): SeasonShare[] {
  const total = (years: number[], months: readonly number[]) =>
    meanOf(
      years.map((y) => aggregateDays(values, rangesFor(ctx.calendar, y, months), expectedDays(y, months), 'sum')),
      BASELINE_COVERAGE,
    );
  const yearBase = total(ctx.baselineYears, SEASONS.annual);
  const yearPeriod = total(ctx.periodYears, SEASONS.annual);
  return (['winter', 'preMonsoon', 'monsoon', 'postMonsoon'] as const).map((season) => {
    const baseline = total(ctx.baselineYears, SEASONS[season]);
    const period = total(ctx.periodYears, SEASONS[season]);
    return {
      season,
      baseline: roundOrNull(baseline, 0),
      period: roundOrNull(period, 0),
      baselinePct: baseline !== null && yearBase ? round((baseline / yearBase) * 100, 0) : null,
      periodPct: period !== null && yearPeriod ? round((period / yearPeriod) * 100, 0) : null,
    };
  });
}

/** A step of 1, 2 or 5 × 10ⁿ that gives at most `maxBins` bins. */
function niceStep(span: number, maxBins: number): number {
  const raw = span / maxBins;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * power >= raw) return m * power;
  }
  return 10 * power;
}

function distributionOf(ctx: Context, values: (number | null)[], decimals: number): DistributionBin[] | null {
  const base = daysOf(ctx, values, ctx.baselineYears);
  const period = daysOf(ctx, values, ctx.periodYears);
  if (base.length === 0 || period.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const v of [...base, ...period]) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max <= min) return null;
  const step = niceStep(max - min, 18);
  const lo = Math.floor(min / step) * step;
  const count = Math.max(1, Math.ceil((max - lo) / step + 1e-9));
  const binOf = (v: number) => Math.min(count - 1, Math.floor((v - lo) / step));
  const b = new Array(count).fill(0);
  const p = new Array(count).fill(0);
  for (const v of base) b[binOf(v)] += 1;
  for (const v of period) p[binOf(v)] += 1;
  return b.map((_, i) => ({
    from: round(lo + i * step, decimals + 1),
    to: round(lo + (i + 1) * step, decimals + 1),
    baseline: round((b[i] / base.length) * 100, 1),
    period: round((p[i] / period.length) * 100, 1),
  }));
}

function unavailable(spec: ParamSpec, ctx: Context): ParamAnalysis {
  const last = ctx.periodYears[ctx.periodYears.length - 1];
  return {
    param: spec.key,
    aggregate: spec.aggregate,
    unit: spec.unit,
    decimals: spec.decimals,
    available: false,
    annual: [],
    monthly: [],
    baseline: null,
    baselineMonthly: new Array(12).fill(null),
    periodMonthly: new Array(12).fill(null),
    periodMean: null,
    trend: null,
    latest: { year: last, value: null, anomaly: null, anomalyPct: null },
    recent: { from: ctx.recentYears[0], to: last, mean: null, anomaly: null, anomalyPct: null },
    highestYear: null,
    lowestYear: null,
    highestMonth: null,
    lowestMonth: null,
    highestDay: null,
    lowestDay: null,
    indicators: [],
    seasons: null,
    distribution: null,
    missingDays: 0,
  };
}

export function analyseParam(ctx: Context, param: ClimateParam): ParamAnalysis {
  const spec = PARAMS[param];
  const values = dailyValues(spec, ctx.archive);
  if (!values || values.every((v) => v === null)) return unavailable(spec, ctx);

  const d = spec.decimals;
  const allYears = [...new Set([...ctx.baselineYears, ...ctx.periodYears])].sort((a, b) => a - b);

  // Unrounded yearly (seasonal) values for every year either window needs.
  const yearly = new Map<number, number | null>();
  for (const y of allYears) {
    yearly.set(
      y,
      aggregateDays(values, rangesFor(ctx.calendar, y, ctx.months), expectedDays(y, ctx.months), spec.aggregate),
    );
  }
  const monthlyRaw = (y: number, m: number) =>
    aggregateDays(values, rangesFor(ctx.calendar, y, [m]), daysIn(y, m), spec.aggregate);

  const baseline = meanOf(ctx.baselineYears.map((y) => yearly.get(y) ?? null), BASELINE_COVERAGE);
  const baselineMonthlyRaw = Array.from({ length: 12 }, (_, i) =>
    meanOf(ctx.baselineYears.map((y) => monthlyRaw(y, i + 1)), BASELINE_COVERAGE),
  );
  const periodMonthlyRaw = Array.from({ length: 12 }, (_, i) =>
    meanOf(ctx.periodYears.map((y) => monthlyRaw(y, i + 1)), BASELINE_COVERAGE),
  );

  const annual: YearValue[] = ctx.periodYears.map((year) => {
    const v = yearly.get(year) ?? null;
    return {
      year,
      value: roundOrNull(v, d),
      anomaly: v !== null && baseline !== null ? round(v - baseline, d) : null,
    };
  });

  const monthly: MonthValue[] = [];
  for (const year of ctx.periodYears) {
    for (const month of ctx.months) {
      const v = monthlyRaw(year, month);
      const base = baselineMonthlyRaw[month - 1];
      monthly.push({
        year,
        month,
        value: roundOrNull(v, d),
        anomaly: v !== null && base !== null ? round(v - base, d) : null,
      });
    }
  }

  const periodMeanRaw = meanOf(ctx.periodYears.map((y) => yearly.get(y) ?? null), BASELINE_COVERAGE);

  const lastYear = ctx.periodYears[ctx.periodYears.length - 1];
  const lastRaw = yearly.get(lastYear) ?? null;
  const lastAnomaly = lastRaw !== null && baseline !== null ? lastRaw - baseline : null;

  const recentRaw = meanOf(ctx.recentYears.map((y) => yearly.get(y) ?? null), BASELINE_COVERAGE);
  const recentAnomaly = recentRaw !== null && baseline !== null ? recentRaw - baseline : null;

  const dayDecimals = spec.aggregate === 'sum' ? Math.max(d, 1) : d;
  const periodDays: { when: string; value: number | null }[] = [];
  if (spec.aggregate !== 'count') {
    for (let i = 0; i < ctx.archive.dates.length; i++) {
      const date = ctx.archive.dates[i];
      if (inYears(date, ctx.periodYears) && inMonths(date, ctx.months)) {
        periodDays.push({ when: date, value: values[i] });
      }
    }
  }
  let missingDays = 0;
  for (let i = 0; i < ctx.archive.dates.length; i++) {
    if (inYears(ctx.archive.dates[i], ctx.periodYears) && values[i] === null) missingDays += 1;
  }

  return {
    param,
    aggregate: spec.aggregate,
    unit: spec.unit,
    decimals: d,
    available: true,
    annual,
    monthly,
    baseline: roundOrNull(baseline, d),
    baselineMonthly: baselineMonthlyRaw.map((v) => roundOrNull(v, d)),
    periodMonthly: periodMonthlyRaw.map((v) => roundOrNull(v, d)),
    periodMean: roundOrNull(periodMeanRaw, d),
    trend: trendOf(
      ctx.periodYears.map((year) => ({ year, value: yearly.get(year) ?? null })),
      d,
    ),
    latest: {
      year: lastYear,
      value: roundOrNull(lastRaw, d),
      anomaly: roundOrNull(lastAnomaly, d),
      anomalyPct: spec.aggregate === 'mean' ? null : pctOf(lastAnomaly, baseline),
    },
    recent: {
      from: ctx.recentYears[0],
      to: lastYear,
      mean: roundOrNull(recentRaw, d),
      anomaly: roundOrNull(recentAnomaly, d),
      anomalyPct: spec.aggregate === 'mean' ? null : pctOf(recentAnomaly, baseline),
    },
    highestYear: extremeOf(annual.map((a) => ({ when: String(a.year), value: a.value })), 'max', d),
    lowestYear: extremeOf(annual.map((a) => ({ when: String(a.year), value: a.value })), 'min', d),
    highestMonth: extremeOf(
      monthly.map((m) => ({ when: `${m.year}-${String(m.month).padStart(2, '0')}`, value: m.value })),
      'max',
      d,
    ),
    lowestMonth: extremeOf(
      monthly.map((m) => ({ when: `${m.year}-${String(m.month).padStart(2, '0')}`, value: m.value })),
      'min',
      d,
    ),
    highestDay: spec.aggregate === 'count' ? null : extremeOf(periodDays, 'max', dayDecimals),
    // The driest day of a rainfall record is zero, many times over. It is
    // not a finding.
    lowestDay: spec.aggregate === 'mean' ? extremeOf(periodDays, 'min', dayDecimals) : null,
    indicators: indicatorsFor(ctx, spec, values),
    seasons: param === 'precip' ? seasonShares(ctx, values) : null,
    distribution: spec.aggregate === 'mean' ? distributionOf(ctx, values, d) : null,
    missingDays,
  };
}

/** The span the archive must cover for a query: both windows, whole years. */
export function spanFor(query: ClimateQuery): { start: string; end: string } {
  const first = Math.min(query.from, query.baselineFrom);
  const last = Math.max(query.to, query.baselineTo);
  return { start: `${first}-01-01`, end: `${last}-12-31` };
}

export function analyse(archive: DailyArchive, query: ClimateQuery) {
  const periodYears = yearsBetween(query.from, query.to);
  const ctx: Context = {
    archive,
    calendar: calendarOf(archive.dates),
    query,
    months: SEASONS[query.season],
    periodYears,
    baselineYears: yearsBetween(query.baselineFrom, query.baselineTo),
    recentYears: periodYears.slice(-RECENT_YEARS),
  };
  return {
    lead: PRESETS[query.preset].lead,
    years: { from: query.from, to: query.to },
    baseline: { from: query.baselineFrom, to: query.baselineTo },
    months: [...ctx.months],
    params: query.params.map((p) => analyseParam(ctx, p)),
  };
}
