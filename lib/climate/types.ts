/**
 * What a climate analysis returns across the network.
 *
 * Every number in here was computed on the server from ERA5's daily values
 * by lib/climate/analyse.ts — an average, a total, a count, a difference or a
 * regression slope of values the archive sent. None is interpolated, none is
 * estimated where the record is missing, and none came from a model of
 * language. A statistic that cannot be supported by the data is absent
 * (null), never filled.
 */

import type { NoData } from '../weather/types';
import type { Aggregate, ClimateParam, ClimateQuery, LeadView } from './params';

export type YearValue = {
  year: number;
  /** Null when the year's record is too incomplete to summarise. */
  value: number | null;
  /** value − baseline, or null where either is missing. */
  anomaly: number | null;
};

export type MonthValue = {
  year: number;
  /** 1–12. */
  month: number;
  value: number | null;
  /** Against the same calendar month's baseline average. */
  anomaly: number | null;
};

export type Trend = {
  /** Ordinary least squares slope, in the parameter's unit per decade. */
  perDecade: number;
  /**
   * Whether the slope is distinguishable from no change at the 95% level
   * (two-sided t-test on the regression slope). "Unclear" is a real answer:
   * year-to-year variation is larger than the change.
   */
  clear: boolean;
  /** Years that entered the fit. */
  years: number;
  /** The fitted line's ends, so a chart draws exactly what was computed. */
  start: { year: number; value: number };
  end: { year: number; value: number };
};

export type Extreme = {
  /** A year, a YYYY-MM month or a YYYY-MM-DD day. */
  when: string;
  value: number;
};

export type IndicatorKey =
  | 'hotDays'
  | 'veryHotDays'
  | 'warmNights'
  | 'heavyRainDays'
  | 'longestDrySpell'
  | 'wettestDay'
  | 'humidDays'
  | 'windyDays';

/** A derived yearly series: days meeting a rule, or a yearly extreme. */
export type Indicator = {
  key: IndicatorKey;
  param: ClimateParam;
  unit: 'days' | 'mm';
  /**
   * The rule's threshold, where it has one. For a relative rule it is the
   * baseline's 90th percentile, computed here and shown so it can be checked.
   */
  threshold: number | null;
  thresholdUnit: string | null;
  annual: { year: number; value: number | null }[];
  /** The average over the baseline years. */
  baseline: number | null;
  /** The average over the recent window. */
  recent: number | null;
  trend: Trend | null;
  record: Extreme | null;
  /** For the longest dry spell: when the record spell began and ended. */
  recordSpan: { start: string; end: string } | null;
};

export type SeasonShare = {
  season: 'winter' | 'preMonsoon' | 'monsoon' | 'postMonsoon';
  /** Average seasonal total, baseline and period. */
  baseline: number | null;
  period: number | null;
  /** Percentage of the year's total, baseline and period. */
  baselinePct: number | null;
  periodPct: number | null;
};

export type DistributionBin = {
  from: number;
  to: number;
  /** Share of days, in percent, in the baseline and the period. */
  baseline: number;
  period: number;
};

export type ParamAnalysis = {
  param: ClimateParam;
  aggregate: Aggregate;
  unit: string;
  decimals: number;
  /** False when the archive gave nothing usable for this parameter. */
  available: boolean;
  /** One per year of the period, restricted to the chosen season's months. */
  annual: YearValue[];
  /** One per month of the period (all months, or the season's). */
  monthly: MonthValue[];
  /** Baseline average of the yearly (seasonal) value. */
  baseline: number | null;
  /** Baseline average for each calendar month, January first. */
  baselineMonthly: (number | null)[];
  /** Period average for each calendar month. */
  periodMonthly: (number | null)[];
  /** Average of the yearly values across the whole period. */
  periodMean: number | null;
  trend: Trend | null;
  latest: YearValue & { anomalyPct: number | null };
  /** The last ten years of the period (or all of it, if shorter). */
  recent: { from: number; to: number; mean: number | null; anomaly: number | null; anomalyPct: number | null };
  highestYear: Extreme | null;
  lowestYear: Extreme | null;
  highestMonth: Extreme | null;
  lowestMonth: Extreme | null;
  highestDay: Extreme | null;
  lowestDay: Extreme | null;
  indicators: Indicator[];
  seasons: SeasonShare[] | null;
  distribution: DistributionBin[] | null;
  /** Days in the period the archive left empty for this parameter. */
  missingDays: number;
};

export type ClimateProvenance = {
  source: string;
  dataset: string;
  nature: 'reanalysis';
  /** Kept for traceability; never rendered. */
  endpoint: string;
  /** The last day the values run through. `timeBasis` is always `through`. */
  issuedAt: string;
  timeBasis: 'through';
  /** When we asked. Diagnostic; never the values' time. */
  fetchedAt: string;
  /** The grid cell the archive answered for, which is not the town's point. */
  grid: { latitude: number; longitude: number; elevation: number | null };
};

export type ClimatePlace = {
  name: string;
  district: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
  resolvedBy: string;
};

export type ClimateAnalysis = {
  kind: 'analysis';
  query: ClimateQuery;
  place: ClimatePlace;
  lead: LeadView;
  years: { from: number; to: number };
  baseline: { from: number; to: number };
  /** Months included by the season filter, 1–12. */
  months: number[];
  params: ParamAnalysis[];
  provenance: ClimateProvenance;
};

export type ClimateFailure =
  | { kind: 'unresolved'; noData: NoData }
  | { kind: 'failed'; reason: 'rateLimited' | 'unreachable' | 'noValues'; checkedAt: string }
  | { kind: 'invalid'; problem: string };

export type ClimateResponse = ClimateAnalysis | ClimateFailure;

/** The grounded explanation, or why there is none. */
export type ExplainResponse =
  | { kind: 'explanation'; text: string; provider: string }
  | { kind: 'unavailable'; reason: 'noModel' | 'rejected' | 'analysisFailed' };
