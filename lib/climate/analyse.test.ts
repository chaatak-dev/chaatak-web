import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateDays,
  analyse,
  calendarOf,
  dailyValues,
  linearFit,
  percentile,
  round,
  spanFor,
  tCritical,
  trendOf,
} from './analyse';
import { PARAMS, type ClimateQuery } from './params';
import { syntheticArchive } from './synthetic';

/**
 * The analysis against series whose answers are known by arithmetic.
 *
 * A steady 0.2 °C a year, rain on the first of every month plus one heavy
 * day in July: every baseline, anomaly, trend, count and dry spell below is
 * what a person with a calculator would get, not what the code happened to
 * produce the first time it ran.
 */

function query(overrides: Partial<ClimateQuery> = {}): ClimateQuery {
  return {
    place: 'Jaipur',
    from: 1991,
    to: 2025,
    baseline: '1991-2020',
    baselineFrom: 1991,
    baselineTo: 2020,
    params: ['tMean'],
    resolution: 'annual',
    season: 'annual',
    preset: 'custom',
    ...overrides,
  };
}

/** 20 °C in 1991, warming by exactly 0.2 °C a year, flat within each year. */
const warming = (_: string, year: number) => 20 + 0.2 * (year - 1991);

/** 10 mm on the 1st of each month, 70 mm on 15 July, dry otherwise. */
const rain = (_: string, __: number, month: number, day: number) =>
  day === 1 ? 10 : month === 7 && day === 15 ? 70 : 0;

test('baseline is the average of the baseline years, anomaly is the difference from it', () => {
  const archive = syntheticArchive(1991, 2025, { temperature_2m_mean: warming });
  const [t] = analyse(archive, query()).params;

  // 20 + 0.2 × 14.5, the middle of 1991–2020.
  assert.equal(t.baseline, 22.9);
  assert.equal(t.latest.year, 2025);
  assert.equal(t.latest.value, 26.8);
  assert.equal(t.latest.anomaly, 3.9);
  // Temperature has no meaningful percentage.
  assert.equal(t.latest.anomalyPct, null);
  // 2016–2025: 20 + 0.2 × 29.5.
  assert.deepEqual([t.recent.from, t.recent.to, t.recent.mean, t.recent.anomaly], [2016, 2025, 25.9, 3]);
  assert.equal(t.highestYear?.when, '2025');
  assert.equal(t.lowestYear?.when, '1991');
  assert.equal(t.annual.length, 35);
  assert.equal(t.annual[0].anomaly, round(20 - 22.9, 1));
});

test('a monthly anomaly is against the same calendar month of the baseline', () => {
  // July is always 10 degrees warmer than the rest; that is climate, not anomaly.
  const archive = syntheticArchive(1991, 2025, {
    temperature_2m_mean: (_, year, month) => 20 + (month === 7 ? 10 : 0) + (year === 2025 ? 1 : 0),
  });
  const [t] = analyse(archive, query()).params;
  const july2025 = t.monthly.find((m) => m.year === 2025 && m.month === 7)!;
  const july2024 = t.monthly.find((m) => m.year === 2024 && m.month === 7)!;
  assert.equal(july2025.value, 31);
  assert.equal(july2025.anomaly, 1);
  assert.equal(july2024.anomaly, 0);
  assert.equal(t.baselineMonthly[6], 30);
  assert.equal(t.baselineMonthly[0], 20);
});

test('a steady rise is a clear trend, reported per decade', () => {
  const archive = syntheticArchive(1991, 2025, { temperature_2m_mean: warming });
  const [t] = analyse(archive, query()).params;
  assert.ok(t.trend);
  assert.equal(t.trend.perDecade, 2);
  assert.equal(t.trend.clear, true);
  assert.equal(t.trend.years, 35);
  assert.deepEqual(t.trend.start, { year: 1991, value: 20 });
  assert.deepEqual(t.trend.end, { year: 2025, value: 26.8 });
});

test('noise without a rise is not called a trend', () => {
  const archive = syntheticArchive(1991, 2025, {
    temperature_2m_mean: (_, year) => 25 + (year % 2 === 0 ? 1.5 : -1.5),
  });
  const [t] = analyse(archive, query()).params;
  assert.ok(t.trend);
  assert.equal(t.trend.clear, false);
  assert.ok(Math.abs(t.trend.perDecade) < 0.5);
});

test('fewer than ten years gets no trend at all', () => {
  const archive = syntheticArchive(1991, 2025, { temperature_2m_mean: warming });
  const [t] = analyse(archive, query({ from: 2018, to: 2025 })).params;
  assert.equal(t.trend, null);
});

test('rainfall: totals, rainy days, heavy-rain days and the longest dry spell', () => {
  const archive = syntheticArchive(1991, 2025, { precipitation_sum: rain });
  const [p, days] = analyse(archive, query({ params: ['precip', 'rainyDays'] })).params;

  // Twelve 10 mm days and one 70 mm day.
  assert.equal(p.baseline, 190);
  assert.equal(p.latest.value, 190);
  assert.equal(p.latest.anomaly, 0);
  assert.equal(p.latest.anomalyPct, 0);
  assert.equal(p.highestDay?.value, 70);
  assert.equal(p.highestDay?.when, '1991-07-15');
  // The driest day of a rainfall record is not a finding.
  assert.equal(p.lowestDay, null);

  assert.equal(days.baseline, 13);

  const heavy = p.indicators.find((i) => i.key === 'heavyRainDays');
  assert.ok(heavy, 'a 70 mm day is IMD heavy rain');
  assert.equal(heavy.threshold, 64.5);
  assert.equal(heavy.baseline, 1);

  // Rain on the 1st of each month: the longest dry run is the 2nd to the
  // 31st of a 31-day month — 30 days — first reached in January 1991.
  const dry = p.indicators.find((i) => i.key === 'longestDrySpell');
  assert.ok(dry);
  assert.equal(dry.baseline, 30);
  assert.equal(dry.record?.value, 30);
  assert.deepEqual(dry.recordSpan, { start: '1991-01-02', end: '1991-01-31' });

  const wettest = p.indicators.find((i) => i.key === 'wettestDay');
  assert.equal(wettest?.baseline, 70);
});

test('the season filter restricts every yearly number to its months', () => {
  const archive = syntheticArchive(1991, 2025, { precipitation_sum: rain });
  const result = analyse(archive, query({ params: ['precip'], season: 'monsoon' }));
  assert.deepEqual(result.months, [6, 7, 8, 9]);
  const [p] = result.params;
  // Four 10 mm days and the 70 mm day.
  assert.equal(p.baseline, 110);
  assert.equal(p.monthly.length, 35 * 4);
  // Seasonal shares always describe the whole year.
  const monsoon = p.seasons?.find((s) => s.season === 'monsoon');
  assert.equal(monsoon?.baseline, 110);
  assert.equal(monsoon?.baselinePct, round((110 / 190) * 100, 0));
});

test('a total with a missing day is unknown, an average tolerates a few', () => {
  const archive = syntheticArchive(1991, 2025, {
    precipitation_sum: (date, ...rest) => (date === '2000-03-10' ? null : rain(date, ...rest)),
    temperature_2m_mean: (date, year) => (date >= '2001-04-01' && date <= '2001-04-05' ? null : warming(date, year)),
  });
  const [p, t] = analyse(archive, query({ params: ['precip', 'tMean'] })).params;

  assert.equal(p.annual.find((a) => a.year === 2000)?.value, null, 'no rainfall total over a gap');
  assert.equal(p.monthly.find((m) => m.year === 2000 && m.month === 3)?.value, null);
  assert.equal(p.missingDays, 1);
  // The dry spell cannot be known across a gap.
  assert.equal(p.indicators.find((i) => i.key === 'longestDrySpell')?.annual.find((a) => a.year === 2000)?.value, null);

  // Five days of 365 is within the 90% an average needs; five of April's 30 is not.
  assert.notEqual(t.annual.find((a) => a.year === 2001)?.value, null);
  assert.equal(t.monthly.find((m) => m.year === 2001 && m.month === 4)?.value, null);
});

test('an empty record is unavailable, not zero', () => {
  const archive = syntheticArchive(1991, 2025, { temperature_2m_mean: () => null });
  const [t] = analyse(archive, query()).params;
  assert.equal(t.available, false);
  assert.equal(t.baseline, null);
  assert.equal(t.annual.length, 0);
});

test('a field in an unexpected unit is refused rather than mislabelled', () => {
  const archive = syntheticArchive(1991, 1995, { temperature_2m_mean: warming });
  archive.units.temperature_2m_mean = '°F';
  assert.equal(dailyValues(PARAMS.tMean, archive), null);
  const [t] = analyse(archive, query({ from: 1991, to: 1995, baselineFrom: 1991, baselineTo: 1995 })).params;
  assert.equal(t.available, false);
});

test('sunshine arrives in seconds and is read in hours', () => {
  const archive = syntheticArchive(1991, 1995, { sunshine_duration: () => 36_000 });
  const values = dailyValues(PARAMS.sunshine, archive)!;
  assert.equal(values[0], 10);
});

test('a heat threshold never reached is left out, not drawn as zeros', () => {
  const archive = syntheticArchive(1991, 2025, { temperature_2m_max: () => 30 });
  const [t] = analyse(archive, query({ params: ['tMax'] })).params;
  assert.equal(t.indicators.some((i) => i.key === 'hotDays'), false);
  // The relative rule is shown with the threshold it counted against.
  const veryHot = t.indicators.find((i) => i.key === 'veryHotDays');
  assert.equal(veryHot?.threshold, 30);
  assert.equal(veryHot?.baseline, 0);
});

test('multi-parameter analysis keeps each parameter separate and in order', () => {
  const archive = syntheticArchive(1991, 2025, {
    temperature_2m_mean: warming,
    precipitation_sum: rain,
    relative_humidity_2m_mean: () => 60,
  });
  const result = analyse(archive, query({ params: ['humidity', 'tMean', 'precip'] }));
  assert.deepEqual(result.params.map((p) => p.param), ['humidity', 'tMean', 'precip']);
  assert.deepEqual(result.params.map((p) => p.unit), ['%', '°C', 'mm']);
  assert.equal(result.params[0].baseline, 60);
  assert.equal(result.params[0].indicators.length, 0, 'never humid enough to count');
});

test('the span covers both windows in whole years', () => {
  assert.deepEqual(spanFor(query({ from: 2000, to: 2025, baselineFrom: 1961, baselineTo: 1990 })), {
    start: '1961-01-01',
    end: '2025-12-31',
  });
});

test('arithmetic helpers', () => {
  assert.equal(round(-0.04, 1), 0);
  assert.ok(!Object.is(round(-0.04, 1), -0));
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9.1);
  assert.equal(tCritical(33), 2.042);
  assert.equal(tCritical(500), 1.96);
  const fit = linearFit([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }]);
  assert.equal(fit?.slope, 2);
  assert.equal(trendOf([{ year: 2000, value: 1 }], 1), null);

  const calendar = calendarOf(['2000-01-30', '2000-01-31', '2000-02-01']);
  assert.deepEqual(calendar.get(2000)?.get(1), [0, 2]);
  assert.equal(aggregateDays([1, 2, 3], [[0, 3]], 3, 'sum'), 6);
  assert.equal(aggregateDays([1, null, 3], [[0, 3]], 3, 'sum'), null);
  // Days the series never reached are missing days, not absent ones.
  assert.equal(aggregateDays([1, 2], [[0, 2]], 31, 'mean'), null);
});
