'use client';

/**
 * A finished analysis: key findings, the charts that carry them, an optional
 * plain-language explanation, and the method.
 *
 * Every number on this screen is a number the server computed from ERA5 and
 * sent in the analysis. This file formats them — how many decimals, which
 * sign, which unit word — and never derives a new one. The explanation is
 * the only text a model wrote, it arrives already checked against these same
 * statistics, and it is labelled as what it is.
 *
 * Charts are chosen by what they add. A trend gets a line with its baseline;
 * a departure gets signed bars; a seasonal shape gets twelve months; a long
 * record gets a year × month grid. Nothing is drawn twice for decoration.
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import { PARAMS, writeQuery, type ClimateParam } from '@/lib/climate/params';
import type { ClimateAnalysis, ExplainResponse, Indicator, ParamAnalysis } from '@/lib/climate/types';
import type { InterfaceLang } from '@/lib/i18n/languages';
import type { StringKey, Translate } from '@/lib/i18n/strings';
import { Heatmap } from './charts/Heatmap';
import { SeriesChart, type Series } from './charts/SeriesChart';
import { coord, day, month, num, retrieved, signed, unitText, withUnit } from './format';

type Ctx = { analysis: ClimateAnalysis; t: Translate; lang: InterfaceLang };

const paramName = (t: Translate, p: ClimateParam) => t(`climate.param.${p}` as StringKey);
const monthName = (t: Translate, m: number) => t(`climate.m.${m}` as StringKey);

function groupOf(p: ClimateParam): 'temperature' | 'rain' | 'other' {
  const g = PARAMS[p].group;
  return g === 'temperature' ? 'temperature' : g === 'rain' ? 'rain' : 'other';
}

/** A label that knows temperature from rain: "Warmest year", "Wettest year". */
function labelFor(t: Translate, base: string, p: ClimateParam): string {
  const g = groupOf(p);
  const specific = `${base}.${g}` as StringKey;
  const text = t(specific);
  return text === specific ? t(base as StringKey) : text;
}

function value(p: ParamAnalysis, v: number, t: Translate) {
  return withUnit(num(v, p.decimals), p.unit, t);
}

function diff(p: ParamAnalysis, v: number, t: Translate) {
  return withUnit(signed(v, p.decimals), p.unit, t);
}

/** Wetter is the cool colour; hotter is the warm one. */
function positiveTone(p: ClimateParam): 'warm' | 'cool' {
  return groupOf(p) === 'rain' || p === 'humidity' || p === 'soilMoisture' || p === 'cloud' ? 'cool' : 'warm';
}

export function ClimateResults({ analysis, t, lang }: Ctx) {
  const ctx = { analysis, t, lang };
  const available = analysis.params.filter((p) => p.available);
  const primary = available[0];
  const others = available.slice(1);
  const missing = analysis.params.filter((p) => !p.available);

  const place = [analysis.place.name, analysis.place.district !== analysis.place.name ? analysis.place.district : null, analysis.place.state]
    .filter(Boolean)
    .join(', ');

  return (
    <article className="climate__article" aria-labelledby="climate-result-title">
      <header className="climate__result-head">
        <h2 id="climate-result-title" className="climate__place">
          {place}
        </h2>
        <p className="climate__scope">
          {t('climate.results.vs', {
            from: analysis.years.from,
            to: analysis.years.to,
            bfrom: analysis.baseline.from,
            bto: analysis.baseline.to,
          })}
          {' · '}
          {t(`climate.season.${analysis.query.season}` as StringKey)}
        </p>
      </header>

      <Findings ctx={ctx} primary={primary} others={others} />

      {missing.map((p) => (
        <p key={p.param} className="climate__note climate__note--block">
          {paramName(t, p.param)}: {t('climate.unavailable')}
        </p>
      ))}

      <Charts ctx={ctx} primary={primary} others={others} />

      <Explain ctx={ctx} />
      <Method ctx={ctx} />
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Key findings                                                        */
/* ------------------------------------------------------------------ */

type Tile = { key: string; label: string; value: string; note?: string; tone?: 'warm' | 'cool' };

function tilesFor({ analysis, t, lang }: Ctx, p: ParamAnalysis, full: boolean): Tile[] {
  const tiles: Tile[] = [];
  const b = analysis.baseline;
  const pos = positiveTone(p.param);
  const toneOf = (v: number | null) => (v === null || v === 0 ? undefined : v > 0 ? pos : pos === 'warm' ? 'cool' : 'warm');

  if (full && p.latest.anomaly !== null && p.latest.value !== null) {
    tiles.push({
      key: 'latest',
      label: t('climate.f.latest', { year: p.latest.year }),
      value: diff(p, p.latest.anomaly, t) + (p.latest.anomalyPct !== null ? ` (${signed(p.latest.anomalyPct, 0)}%)` : ''),
      note: value(p, p.latest.value, t),
      tone: toneOf(p.latest.anomaly),
    });
  }
  if (p.recent.anomaly !== null && p.recent.mean !== null && p.recent.from !== p.recent.to) {
    tiles.push({
      key: 'recent',
      label: t('climate.f.recent', { from: p.recent.from, to: p.recent.to }),
      value: diff(p, p.recent.anomaly, t) + (p.recent.anomalyPct !== null ? ` (${signed(p.recent.anomalyPct, 0)}%)` : ''),
      note: value(p, p.recent.mean, t),
      tone: toneOf(p.recent.anomaly),
    });
  }
  if (full && p.baseline !== null) {
    tiles.push({
      key: 'baseline',
      label: t('climate.f.baselineAvg', { from: b.from, to: b.to }),
      value: value(p, p.baseline, t),
    });
  }
  tiles.push(
    p.trend
      ? {
          key: 'trend',
          label: t('climate.f.trend', { from: analysis.years.from, to: analysis.years.to }),
          value: `${withUnit(signed(p.trend.perDecade, p.decimals + 1), p.unit, t)} ${t('climate.f.perDecade')}`,
          note: t(p.trend.clear ? 'climate.f.trendClear' : 'climate.f.trendUnclear'),
        }
      : { key: 'trend', label: t('climate.f.trend', { from: analysis.years.from, to: analysis.years.to }), value: '—', note: t('climate.f.noTrend') },
  );
  if (!full) return tiles;

  if (p.highestYear) {
    tiles.push({ key: 'hy', label: labelFor(t, 'climate.f.highYear', p.param), value: p.highestYear.when, note: value(p, p.highestYear.value, t) });
  }
  if (p.lowestYear) {
    tiles.push({ key: 'ly', label: labelFor(t, 'climate.f.lowYear', p.param), value: p.lowestYear.when, note: value(p, p.lowestYear.value, t) });
  }
  if (p.highestMonth) {
    tiles.push({ key: 'hm', label: labelFor(t, 'climate.f.highMonth', p.param), value: month(p.highestMonth.when, lang), note: value(p, p.highestMonth.value, t) });
  }
  if (p.highestDay) {
    const dayDecimals = p.aggregate === 'sum' ? Math.max(1, p.decimals) : p.decimals;
    tiles.push({
      key: 'hd',
      label: labelFor(t, 'climate.f.highDay', p.param),
      value: withUnit(num(p.highestDay.value, dayDecimals), p.unit, t),
      note: day(p.highestDay.when, lang),
    });
  }
  if (p.lowestDay && groupOf(p.param) === 'temperature') {
    tiles.push({
      key: 'ld',
      label: labelFor(t, 'climate.f.lowDay', p.param),
      value: withUnit(num(p.lowestDay.value, p.decimals), p.unit, t),
      note: day(p.lowestDay.when, lang),
    });
  }
  return tiles;
}

function indicatorTitle(t: Translate, i: Indicator): string {
  const threshold = i.threshold !== null ? withUnit(String(i.threshold), i.thresholdUnit ?? '', t) : '';
  return t(`climate.ind.${i.key}` as StringKey, { t: threshold });
}

function indicatorNote(t: Translate, i: Indicator): string {
  const threshold = i.threshold !== null ? withUnit(String(i.threshold), i.thresholdUnit ?? '', t) : '';
  return t(`climate.ind.${i.key}Note` as StringKey, { t: threshold });
}

function indicatorTile({ analysis, t, lang }: Ctx, i: Indicator): Tile | null {
  if (i.recent === null) return null;
  const decimals = 1;
  const recentYears = analysis.params[0]?.recent;
  const unit = unitText(i.unit, t);
  const parts: string[] = [];
  if (i.baseline !== null) parts.push(`${num(i.baseline, decimals)} ${unit} ${t('climate.ind.baseline')}`);
  if (i.record) {
    let record = `${t('climate.ind.record', { year: i.record.when })} (${num(i.record.value, i.unit === 'mm' ? 1 : 0)} ${unit})`;
    if (i.recordSpan) record += ` — ${t('climate.ind.span', { start: day(i.recordSpan.start, lang), end: day(i.recordSpan.end, lang) })}`;
    parts.push(record);
  }
  return {
    key: `${i.param}-${i.key}`,
    label: indicatorTitle(t, i),
    value: `${num(i.recent, decimals)} ${unit}`,
    note: `${t('climate.ind.recent', { from: recentYears?.from ?? analysis.years.from, to: recentYears?.to ?? analysis.years.to })}. ${parts.join('. ')}`,
  };
}

function Findings({ ctx, primary, others }: { ctx: Ctx; primary: ParamAnalysis; others: ParamAnalysis[] }) {
  const { t } = ctx;
  const indicators = [primary, ...others].flatMap((p) => p.indicators);
  return (
    <section className="climate__section" aria-labelledby="climate-findings">
      <h3 id="climate-findings" className="climate__h3">
        {t('climate.findings')}
      </h3>
      {[primary, ...others].map((p, i) => (
        <div key={p.param} className="climate__finding-group">
          <p className="climate__finding-param">{paramName(t, p.param)}</p>
          <TileGrid tiles={tilesFor(ctx, p, i === 0)} />
        </div>
      ))}
      {indicators.length > 0 && (
        <TileGrid tiles={indicators.map((i) => indicatorTile(ctx, i)).filter((x): x is Tile => x !== null)} wide />
      )}
      {primary.missingDays > 0 && <p className="climate__note">{t('climate.missingDays', { n: primary.missingDays })}</p>}
    </section>
  );
}

function TileGrid({ tiles, wide }: { tiles: Tile[]; wide?: boolean }) {
  return (
    <dl className={`climate__tiles${wide ? ' climate__tiles--wide' : ''}`}>
      {tiles.map((tile) => (
        <div key={tile.key} className="climate__tile" data-tone={tile.tone}>
          <dt className="climate__tile-label">{tile.label}</dt>
          <dd className="climate__tile-value">{tile.value}</dd>
          {tile.note && <dd className="climate__tile-note">{tile.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* Charts                                                              */
/* ------------------------------------------------------------------ */

function Figure({
  ctx,
  title,
  note,
  children,
  table,
}: {
  ctx: Ctx;
  title: string;
  note?: string;
  children: ReactNode;
  table?: { head: string[]; rows: (string | number)[][] };
}) {
  const { t } = ctx;
  return (
    <figure className="climate__figure">
      <figcaption>
        <span className="climate__figure-title">{title}</span>
        {note && <span className="climate__figure-note">{note}</span>}
      </figcaption>
      {children}
      {table && (
        <details className="climate__table">
          <summary>{t('climate.table.show')}</summary>
          <div className="climate__table-scroll">
            <table>
              <thead>
                <tr>
                  {table.head.map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <Prov ctx={ctx} />
    </figure>
  );
}

function Prov({ ctx }: { ctx: Ctx }) {
  const { analysis, t, lang } = ctx;
  return (
    <p className="provenance" style={{ '--sev': 'var(--text-soft)' } as CSSProperties}>
      <svg className="provenance__mark" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <circle cx="6" cy="6" r="1.6" fill="currentColor" />
        <path d="M2.9 3.3a4.4 4.4 0 0 0 0 5.4M9.1 3.3a4.4 4.4 0 0 1 0 5.4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <span>{analysis.provenance.source}</span>
      <span className="provenance__sep" aria-hidden="true">·</span>
      <span className="sr-only">, </span>
      <span>{t('climate.prov.nature')}</span>
      <span className="provenance__sep" aria-hidden="true">·</span>
      <span className="sr-only">, </span>
      <span className="provenance__when">{t('climate.prov.through', { date: day(analysis.provenance.issuedAt, lang) })}</span>
    </p>
  );
}

function yearly(ctx: Ctx, p: ParamAnalysis, compact = false) {
  const { analysis, t } = ctx;
  const bars = p.aggregate !== 'mean';
  const series: Series[] = [
    {
      id: p.param,
      label: paramName(t, p.param),
      points: p.annual.map((a) => ({ x: a.year, y: a.value })),
      mark: bars ? 'bars' : 'line',
      tone: groupOf(p.param) === 'rain' ? 'cool' : bars ? 'muted' : 'ink',
    },
  ];
  const fmt = (v: number) => value(p, v, t);
  return (
    <Figure
      key={`yearly-${p.param}`}
      ctx={ctx}
      title={`${paramName(t, p.param)} — ${t('climate.chart.yearly')}`}
      table={{
        head: [t('climate.table.when'), t('climate.table.value'), t('climate.table.difference')],
        rows: p.annual.map((a) => [a.year, a.value === null ? '—' : fmt(a.value), a.anomaly === null ? '—' : diff(p, a.anomaly, t)]),
      }}
    >
      <SeriesChart
        series={series}
        height={compact ? 180 : 260}
        integerX
        formatX={(x) => String(x)}
        formatY={fmt}
        zero={bars}
        reference={p.baseline !== null ? { y: p.baseline, label: t('climate.legend.baselineAvg'), value: fmt(p.baseline) } : undefined}
        band={
          analysis.baseline.from <= analysis.years.to && analysis.baseline.to >= analysis.years.from
            ? { from: analysis.baseline.from, to: analysis.baseline.to, label: t('climate.legend.baselineYears') }
            : undefined
        }
        trend={p.trend ? { x1: p.trend.start.year, y1: p.trend.start.value, x2: p.trend.end.year, y2: p.trend.end.value, label: t('climate.legend.trend') } : undefined}
        brush={!compact}
        label={`${paramName(t, p.param)}, ${t('climate.chart.yearly')}`}
        t={t}
      />
    </Figure>
  );
}

function monthlySeries(ctx: Ctx, p: ParamAnalysis) {
  const { t, lang } = ctx;
  const fmt = (v: number) => value(p, v, t);
  const toX = (y: number, m: number) => y + (m - 0.5) / 12;
  const fromX = (x: number) => {
    const y = Math.floor(x);
    return { y, m: Math.round((x - y) * 12 + 0.5) };
  };
  return (
    <Figure
      key={`monthly-${p.param}`}
      ctx={ctx}
      title={`${paramName(t, p.param)} — ${t('climate.chart.monthly')}`}
      table={{
        head: [t('climate.table.when'), t('climate.table.value'), t('climate.table.difference')],
        rows: p.monthly.map((m) => [
          month(`${m.year}-${String(m.month).padStart(2, '0')}`, lang),
          m.value === null ? '—' : fmt(m.value),
          m.anomaly === null ? '—' : diff(p, m.anomaly, t),
        ]),
      }}
    >
      <SeriesChart
        series={[
          {
            id: p.param,
            label: paramName(t, p.param),
            points: p.monthly.map((m) => ({ x: toX(m.year, m.month), y: m.value })),
            mark: 'line',
            tone: groupOf(p.param) === 'rain' ? 'cool' : 'ink',
          },
        ]}
        height={260}
        formatX={(x) => {
          const { y, m } = fromX(x);
          return month(`${y}-${String(m).padStart(2, '0')}`, lang);
        }}
        tickX={(x) => String(Math.floor(x))}
        integerX
        formatY={fmt}
        zero={p.aggregate !== 'mean'}
        brush
        label={`${paramName(t, p.param)}, ${t('climate.chart.monthly')}`}
        t={t}
      />
    </Figure>
  );
}

function anomalies(ctx: Ctx, p: ParamAnalysis, compact = false) {
  const { t } = ctx;
  if (p.baseline === null) return null;
  return (
    <Figure key={`anomaly-${p.param}`} ctx={ctx} title={`${paramName(t, p.param)} — ${t('climate.chart.anomaly')}`}>
      <SeriesChart
        series={[
          {
            id: `${p.param}-anomaly`,
            label: t('climate.table.difference'),
            points: p.annual.map((a) => ({ x: a.year, y: a.anomaly })),
            mark: 'signedBars',
            tone: 'ink',
            positive: positiveTone(p.param),
          },
        ]}
        height={compact ? 170 : 200}
        integerX
        formatX={(x) => String(x)}
        formatY={(v) => diff(p, v, t)}
        zero
        label={`${paramName(t, p.param)}, ${t('climate.chart.anomaly')}`}
        t={t}
      />
    </Figure>
  );
}

function heatmap(ctx: Ctx, p: ParamAnalysis) {
  const { analysis, t } = ctx;
  const anomaly = PARAMS[p.param].heatmap === 'anomaly';
  const years: number[] = [];
  for (let y = analysis.years.from; y <= analysis.years.to; y++) years.push(y);
  return (
    <Figure
      key={`heatmap-${p.param}`}
      ctx={ctx}
      title={`${paramName(t, p.param)} — ${t('climate.chart.heatmap')}`}
      note={t(anomaly ? 'climate.chart.heatmapAnomaly' : 'climate.chart.heatmapValue')}
    >
      <Heatmap
        cells={p.monthly.map((m) => ({ year: m.year, month: m.month, value: anomaly ? m.anomaly : m.value }))}
        years={years}
        months={analysis.months}
        mode={anomaly ? 'diverging' : 'sequential'}
        positive={positiveTone(p.param)}
        format={(v) => (anomaly ? diff(p, v, t) : value(p, v, t))}
        monthName={(m) => monthName(t, m)}
        label={`${paramName(t, p.param)}, ${t('climate.chart.heatmap')}`}
        t={t}
      />
    </Figure>
  );
}

function climatology(ctx: Ctx, p: ParamAnalysis, compact = false) {
  const { analysis, t } = ctx;
  const months = analysis.months;
  const bars = p.aggregate !== 'mean';
  const fmt = (v: number) => value(p, v, t);
  const baseLabel = t('climate.legend.baseline', { from: analysis.baseline.from, to: analysis.baseline.to });
  const periodLabel = t('climate.legend.period', { from: analysis.years.from, to: analysis.years.to });
  return (
    <Figure
      key={`clim-${p.param}`}
      ctx={ctx}
      title={`${paramName(t, p.param)} — ${t('climate.chart.climatology')}`}
      note={compact ? undefined : t('climate.chart.climatologyNote')}
      table={{
        head: [t('climate.table.when'), baseLabel, periodLabel],
        rows: months.map((m) => [
          monthName(t, m),
          p.baselineMonthly[m - 1] === null ? '—' : fmt(p.baselineMonthly[m - 1]!),
          p.periodMonthly[m - 1] === null ? '—' : fmt(p.periodMonthly[m - 1]!),
        ]),
      }}
    >
      <SeriesChart
        series={[
          { id: 'base', label: baseLabel, points: months.map((m) => ({ x: m, y: p.baselineMonthly[m - 1] })), mark: bars ? 'bars' : 'line', tone: 'soft', dashed: !bars },
          { id: 'period', label: periodLabel, points: months.map((m) => ({ x: m, y: p.periodMonthly[m - 1] })), mark: bars ? 'bars' : 'line', tone: bars ? 'cool' : 'ink' },
        ]}
        height={compact ? 190 : 240}
        integerX
        formatX={(x) => monthName(t, x)}
        formatY={fmt}
        zero={bars}
        label={`${paramName(t, p.param)}, ${t('climate.chart.climatology')}`}
        t={t}
      />
    </Figure>
  );
}

function distribution(ctx: Ctx, p: ParamAnalysis) {
  const { analysis, t } = ctx;
  if (!p.distribution) return null;
  const bins = p.distribution;
  const mid = (i: number) => (bins[i].from + bins[i].to) / 2;
  const range = (x: number) => {
    const b = bins.find((bin) => Math.abs((bin.from + bin.to) / 2 - x) < 1e-6);
    return b ? withUnit(`${num(b.from, p.decimals)}–${num(b.to, p.decimals)}`, p.unit, t) : '';
  };
  return (
    <Figure key={`dist-${p.param}`} ctx={ctx} title={`${paramName(t, p.param)} — ${t('climate.chart.distribution')}`} note={t('climate.chart.distributionNote')}>
      <SeriesChart
        series={[
          {
            id: 'base',
            label: t('climate.legend.baseline', { from: analysis.baseline.from, to: analysis.baseline.to }),
            points: bins.map((b, i) => ({ x: mid(i), y: b.baseline })),
            mark: 'area',
            tone: 'soft',
          },
          {
            id: 'period',
            label: t('climate.legend.period', { from: analysis.years.from, to: analysis.years.to }),
            points: bins.map((b, i) => ({ x: mid(i), y: b.period })),
            mark: 'line',
            tone: 'warm',
          },
        ]}
        height={200}
        formatX={range}
        tickX={(x) => num(x, 0)}
        formatY={(v) => `${num(v, 1)}%`}
        zero
        label={`${paramName(t, p.param)}, ${t('climate.chart.distribution')}`}
        t={t}
      />
    </Figure>
  );
}

function indicatorChart(ctx: Ctx, i: Indicator) {
  const { t } = ctx;
  const unit = unitText(i.unit, t);
  const decimals = i.unit === 'mm' ? 1 : 0;
  return (
    <Figure key={`ind-${i.param}-${i.key}`} ctx={ctx} title={indicatorTitle(t, i)} note={indicatorNote(t, i)}>
      <SeriesChart
        series={[
          {
            id: i.key,
            label: indicatorTitle(t, i),
            points: i.annual.map((a) => ({ x: a.year, y: a.value })),
            mark: 'bars',
            tone: groupOf(i.param) === 'rain' && i.key !== 'longestDrySpell' ? 'cool' : 'muted',
          },
        ]}
        height={190}
        integerX
        formatX={(x) => String(x)}
        formatY={(v) => `${num(v, decimals)} ${unit}`}
        zero
        reference={i.baseline !== null ? { y: i.baseline, label: t('climate.legend.baselineAvg'), value: `${num(i.baseline, 1)} ${unit}` } : undefined}
        trend={i.trend ? { x1: i.trend.start.year, y1: i.trend.start.value, x2: i.trend.end.year, y2: i.trend.end.value, label: t('climate.legend.trend') } : undefined}
        label={indicatorTitle(t, i)}
        t={t}
      />
    </Figure>
  );
}

function seasons(ctx: Ctx, p: ParamAnalysis) {
  const { analysis, t } = ctx;
  if (!p.seasons) return null;
  const rows = p.seasons;
  return (
    <Figure key={`seasons-${p.param}`} ctx={ctx} title={t('climate.chart.seasons')}>
      <div className="climate__shares">
        {(['baseline', 'period'] as const).map((which) => (
          <div key={which} className="climate__share-row">
            <p className="climate__share-label">
              {which === 'baseline'
                ? t('climate.legend.baseline', { from: analysis.baseline.from, to: analysis.baseline.to })
                : t('climate.legend.period', { from: analysis.years.from, to: analysis.years.to })}
            </p>
            <div className="climate__share-bar">
              {rows.map((s, i) => {
                const pct = which === 'baseline' ? s.baselinePct : s.periodPct;
                if (!pct) return null;
                return (
                  <span key={s.season} className={`climate__share climate__share--${i}`} style={{ flexBasis: `${pct}%` }} title={`${t(`climate.season.${s.season}` as StringKey)} ${pct}%`}>
                    {pct >= 8 ? `${pct}%` : ''}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
        <ul className="climate__share-key">
          {rows.map((s, i) => (
            <li key={s.season}>
              <span className={`climate__share-swatch climate__share--${i}`} aria-hidden="true" />
              {t(`climate.season.${s.season}` as StringKey)}: {s.baseline === null ? '—' : value(p, s.baseline, t)} → {s.period === null ? '—' : value(p, s.period, t)}
              {' '}
              ({s.baselinePct ?? '—'}% → {s.periodPct ?? '—'}%)
            </li>
          ))}
        </ul>
      </div>
    </Figure>
  );
}

function Charts({ ctx, primary, others }: { ctx: Ctx; primary: ParamAnalysis; others: ParamAnalysis[] }) {
  const { analysis, t } = ctx;
  const monthly = analysis.query.resolution === 'monthly';
  const all = [primary, ...others];
  const indicators = all.flatMap((p) => p.indicators).map((i) => indicatorChart(ctx, i));
  const main = monthly ? monthlySeries(ctx, primary) : yearly(ctx, primary);
  const precip = all.find((p) => p.param === 'precip');

  let lead: ReactNode[];
  let rest: ReactNode[];
  switch (analysis.lead) {
    case 'indicators':
      lead = indicators.length ? indicators.slice(0, 1) : [main];
      rest = [...indicators.slice(1), indicators.length ? main : null, distribution(ctx, primary), heatmap(ctx, primary)];
      break;
    case 'climatology':
      lead = [climatology(ctx, primary)];
      rest = [...others.map((p) => climatology(ctx, p, true)), heatmap(ctx, primary), precip ? seasons(ctx, precip) : null, main];
      break;
    case 'heatmap':
      lead = [heatmap(ctx, primary)];
      rest = [precip ? seasons(ctx, precip) : null, climatology(ctx, primary), yearly(ctx, primary), ...indicators];
      break;
    case 'multiples':
      lead = [anomalies(ctx, primary)];
      rest = [...others.map((p) => anomalies(ctx, p, true)), main];
      break;
    default:
      lead = [main];
      rest = [
        monthly ? null : anomalies(ctx, primary),
        ...indicators,
        heatmap(ctx, primary),
        climatology(ctx, primary),
        precip === primary ? seasons(ctx, precip) : null,
      ];
  }

  const secondaryParams = analysis.lead === 'multiples' || analysis.lead === 'climatology' ? [] : others;

  return (
    <>
      <section className="climate__section climate__lead">{lead}</section>
      <section className="climate__section climate__grid">{rest}</section>
      {secondaryParams.length > 0 && (
        <section className="climate__section" aria-labelledby="climate-others">
          <h3 id="climate-others" className="climate__h3">
            {t('climate.chart.others')}
          </h3>
          <div className="climate__grid">{secondaryParams.map((p) => (monthly ? monthlySeries(ctx, p) : yearly(ctx, p, true)))}</div>
        </section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Explanation                                                         */
/* ------------------------------------------------------------------ */

function Explain({ ctx }: { ctx: Ctx }) {
  const { analysis, t, lang } = ctx;
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; body: ExplainResponse } | { kind: 'failed' }>({
    kind: 'idle',
  });

  const ask = async () => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/climate/explain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: writeQuery(analysis.query).toString(), lang }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState({ kind: 'done', body: (await res.json()) as ExplainResponse });
    } catch {
      setState({ kind: 'failed' });
    }
  };

  return (
    <section className="climate__section climate__explain" aria-live="polite">
      {state.kind === 'idle' || state.kind === 'loading' ? (
        <button type="button" className="climate__explain-button" onClick={ask} disabled={state.kind === 'loading'}>
          {state.kind === 'loading' ? t('climate.explain.loading') : t('climate.explain')}
        </button>
      ) : state.kind === 'failed' ? (
        <p className="climate__note">{t('climate.explain.failed')}</p>
      ) : state.body.kind === 'explanation' ? (
        <div className="climate__explanation">
          <h3 className="climate__h3">{t('climate.explain.heading')}</h3>
          {state.body.text.split(/\n{2,}/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
          <p className="climate__note">{t('climate.explain.note')}</p>
        </div>
      ) : (
        <p className="climate__note">
          {t(state.body.reason === 'rejected' ? 'climate.explain.rejected' : state.body.reason === 'noModel' ? 'climate.explain.noModel' : 'climate.explain.failed')}
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Method                                                              */
/* ------------------------------------------------------------------ */

function Method({ ctx }: { ctx: Ctx }) {
  const { analysis, t, lang } = ctx;
  const g = analysis.provenance.grid;
  const north = lang === 'hi' ? 'उ.' : 'N';
  const south = lang === 'hi' ? 'द.' : 'S';
  const east = lang === 'hi' ? 'पू.' : 'E';
  const west = lang === 'hi' ? 'प.' : 'W';
  const rows: [StringKey, string][] = [
    ['climate.method.source', t('climate.method.sourceValue')],
    ['climate.method.dataset', t('climate.method.datasetValue')],
    ['climate.method.nature', t('climate.method.natureValue')],
    [
      'climate.method.location',
      `${analysis.place.name}. ${
        Number.isFinite(g.latitude)
          ? t('climate.method.grid', { lat: coord(g.latitude, north, south), lon: coord(g.longitude, east, west) })
          : ''
      }`,
    ],
    [
      'climate.method.period',
      t('climate.method.periodValue', {
        from: analysis.years.from,
        to: analysis.years.to,
        months: `${t(`climate.season.${analysis.query.season}` as StringKey)}; ${t(analysis.query.resolution === 'monthly' ? 'climate.res.monthly' : 'climate.res.annual')}`,
      }),
    ],
    ['climate.method.baseline', t('climate.method.baselineValue', { from: analysis.baseline.from, to: analysis.baseline.to })],
    ['climate.method.aggregation', t('climate.method.aggregationValue')],
    ['climate.method.trend', t('climate.method.trendValue')],
    ['climate.method.definitions', t('climate.method.definitionsValue')],
    ['climate.method.through', day(analysis.provenance.issuedAt, lang)],
    ['climate.method.retrieved', `${retrieved(analysis.provenance.fetchedAt, lang)} IST`],
    ['climate.method.limits', t('climate.method.limitsValue')],
  ];
  return (
    <section className="climate__section climate__method" aria-labelledby="climate-method">
      <h3 id="climate-method" className="climate__h3">
        {t('climate.method')}
      </h3>
      <dl>
        {rows.map(([key, text]) => (
          <div key={key} className="climate__method-row">
            <dt>{t(key)}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
