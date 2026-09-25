'use client';

/**
 * A time series, drawn the way Bklit UI composes its charts, in Chaatak's
 * own CSS.
 *
 * Adapted from Bklit UI (MIT — see ./BKLIT-LICENSE.txt): the chart-context
 * model of one set of scales shared by every layer; Grid, axes, Line/Area and
 * Bar layers; ReferenceArea for a shaded span; a ChartTooltip with a
 * crosshair and date inspection; and ChartBrush for choosing a window of a
 * long record. Bklit's Tailwind classes, motion springs and theme variables
 * are replaced by Chaatak's tokens; its interaction model is kept, and
 * extended with the keyboard, which Bklit's line chart does not take.
 *
 * ONE AXIS. Every series on one chart is in one unit. Two units are two
 * charts, never a second scale on the right-hand side.
 *
 * The chart draws only what it is handed. It interpolates nothing across a
 * missing year — a null is a gap in the line, not a guess.
 */

import { curveLinear } from '@visx/curve';
import { Group } from '@visx/group';
import { scaleLinear } from '@visx/scale';
import { AreaClosed, LinePath } from '@visx/shape';
import { useCallback, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { Translate } from '@/lib/i18n/strings';
import { useWidth } from './useWidth';

export type SeriesPoint = { x: number; y: number | null };

export type Tone = 'ink' | 'soft' | 'muted' | 'cool' | 'warm';

export type Series = {
  id: string;
  label: string;
  points: SeriesPoint[];
  mark: 'line' | 'area' | 'bars' | 'signedBars';
  tone: Tone;
  dashed?: boolean;
  /** For signed bars: which colour a positive value takes. */
  positive?: 'warm' | 'cool';
};

export type Reference = { y: number; label: string; value: string };
export type Band = { from: number; to: number; label: string };
export type TrendLine = { x1: number; y1: number; x2: number; y2: number; label: string };

type Props = {
  series: Series[];
  height: number;
  /** Tooltip title for a position. */
  formatX: (x: number) => string;
  /** Axis tick label; defaults to formatX. */
  tickX?: (x: number) => string;
  /** Whole numbers only on the x axis (years, months). */
  integerX?: boolean;
  formatY: (y: number) => string;
  reference?: Reference;
  band?: Band;
  trend?: TrendLine;
  /** Keep zero in view — for bars, and for anything counted. */
  zero?: boolean;
  /** Offer a brush below a long record. */
  brush?: boolean;
  /** What the chart shows, for a screen reader. */
  label: string;
  t: Translate;
};

const TONE: Record<Tone, string> = {
  ink: 'var(--text)',
  soft: 'var(--text-faint)',
  /** Counts: neutral, because a count is not a departure from anything. */
  muted: 'color-mix(in srgb, var(--text) 50%, var(--paper))',
  cool: 'var(--clim-cool)',
  warm: 'var(--clim-warm)',
};

const MARGIN = { top: 14, right: 12, bottom: 26, left: 44 };

function step(xs: number[]): number {
  let best = Infinity;
  for (let i = 1; i < xs.length; i++) best = Math.min(best, xs[i] - xs[i - 1]);
  return Number.isFinite(best) && best > 0 ? best : 1;
}

export function SeriesChart(props: Props) {
  const { series, brush } = props;

  // Every x any series has, sorted: the positions the crosshair can stop at.
  const xs = useMemo(
    () => [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b),
    [series],
  );
  const dx = useMemo(() => step(xs), [xs]);

  // The brush's window, in data units. Null shows everything.
  const [range, setRange] = useState<[number, number] | null>(null);
  const visible = range ?? (xs.length ? [xs[0], xs[xs.length - 1]] : [0, 1]);

  const showBrush = Boolean(brush) && xs.length > 24;

  return (
    <div className="chart">
      <Legend {...props} />
      <Plot {...props} xs={xs} dx={dx} domain={visible as [number, number]} />
      {showBrush && (
        <Brush
          series={series[0]}
          xs={xs}
          dx={dx}
          range={range}
          onRange={setRange}
          formatX={props.tickX ?? props.formatX}
          t={props.t}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Legend — identity is never colour alone                             */
/* ------------------------------------------------------------------ */

function Legend({ series, reference, band, trend, t }: Props) {
  const items: { key: string; label: string; swatch: 'line' | 'dash' | 'band' | 'bar' | 'signed'; tone: string; positive?: 'warm' | 'cool' }[] = [];
  const many = series.length > 1;
  for (const s of series) {
    if (s.mark === 'signedBars') {
      items.push({ key: `${s.id}-up`, label: t('climate.legend.above'), swatch: 'bar', tone: TONE[s.positive ?? 'warm'] });
      items.push({ key: `${s.id}-down`, label: t('climate.legend.below'), swatch: 'bar', tone: TONE[s.positive === 'cool' ? 'warm' : 'cool'] });
    } else if (many) {
      items.push({
        key: s.id,
        label: s.label,
        swatch: s.mark === 'bars' ? 'bar' : s.dashed ? 'dash' : 'line',
        tone: TONE[s.tone],
      });
    }
  }
  if (reference) items.push({ key: 'ref', label: reference.label, swatch: 'dash', tone: 'var(--text-soft)' });
  if (trend) items.push({ key: 'trend', label: trend.label, swatch: 'line', tone: 'var(--accent)' });
  if (band) items.push({ key: 'band', label: band.label, swatch: 'band', tone: 'var(--surface)' });
  if (items.length === 0) return null;

  return (
    <ul className="chart__legend">
      {items.map((item) => (
        <li key={item.key}>
          <span className={`chart__swatch chart__swatch--${item.swatch}`} style={{ '--tone': item.tone } as CSSProperties} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* The plot                                                            */
/* ------------------------------------------------------------------ */

function Plot({
  series,
  height,
  formatX,
  tickX,
  integerX,
  formatY,
  reference,
  band,
  trend,
  zero,
  label,
  t,
  xs,
  dx,
  domain,
}: Props & { xs: number[]; dx: number; domain: [number, number] }) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const hintId = useId();
  const clipId = useId();

  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const shown = useMemo(() => xs.filter((x) => x >= domain[0] && x <= domain[1]), [xs, domain]);

  const xScale = useMemo(
    () => scaleLinear<number>({ domain: [domain[0] - dx / 2, domain[1] + dx / 2], range: [0, innerW] }),
    [domain, dx, innerW],
  );

  const yScale = useMemo(() => {
    const values: number[] = [];
    for (const s of series) {
      for (const p of s.points) if (p.y !== null && p.x >= domain[0] && p.x <= domain[1]) values.push(p.y);
    }
    if (reference) values.push(reference.y);
    if (trend) values.push(trend.y1, trend.y2);
    const bars = series.some((s) => s.mark === 'bars' || s.mark === 'signedBars');
    if (zero || bars) values.push(0);
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
    if (lo === hi) [lo, hi] = [lo - 1, hi + 1];
    const pad = (hi - lo) * 0.08;
    return scaleLinear<number>({
      domain: [lo < 0 || !(zero || bars) ? lo - pad : 0, hi + pad],
      range: [innerH, 0],
      nice: true,
    });
  }, [series, reference, trend, zero, domain, innerH]);

  const yTicks = yScale.ticks(4);
  const xTickCount = Math.max(2, Math.floor(innerW / 64));
  // A short run of whole numbers (the twelve months) is labelled in full
  // whenever there is room for every label.
  const span = domain[1] - domain[0];
  const everyInteger = integerX && span <= 24 && (span + 1) * 30 <= innerW;
  const xTicks = (everyInteger ? Array.from({ length: Math.floor(span) + 1 }, (_, i) => Math.ceil(domain[0]) + i) : xScale.ticks(xTickCount))
    .filter((x) => x >= domain[0] - 1e-9 && x <= domain[1] + 1e-9 && (!integerX || Number.isInteger(x)));

  const barCount = series.filter((s) => s.mark === 'bars' || s.mark === 'signedBars').length || 1;
  const slot = Math.max(1, xScale(dx) - xScale(0));
  const barW = Math.max(1, (slot * 0.72) / barCount);

  const nearest = useCallback(
    (px: number) => {
      if (shown.length === 0) return null;
      const x = xScale.invert(px);
      let best = 0;
      for (let i = 1; i < shown.length; i++) {
        if (Math.abs(shown[i] - x) < Math.abs(shown[best] - x)) best = i;
      }
      return best;
    },
    [shown, xScale],
  );

  const svgRef = useRef<SVGSVGElement>(null);
  const onPointer = (event: PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setActive(nearest(event.clientX - rect.left - MARGIN.left));
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (shown.length === 0) return;
    const last = shown.length - 1;
    const current = active ?? last;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = Math.min(last, current + 1);
    else if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'Escape') {
      setActive(null);
      return;
    }
    if (next !== null) {
      event.preventDefault();
      setActive(next);
    }
  };

  const activeX = active !== null && active < shown.length ? shown[active] : null;
  const rows =
    activeX === null
      ? []
      : series.map((s) => {
          const y = s.points.find((p) => p.x === activeX)?.y ?? null;
          return { id: s.id, label: s.label, y, tone: s.mark === 'signedBars' ? (y !== null && y < 0 ? (s.positive === 'cool' ? 'warm' : 'cool') : (s.positive ?? 'warm')) : s.tone };
        });
  const summary =
    activeX === null
      ? ''
      : `${formatX(activeX)}: ${rows.map((r) => `${r.label} ${r.y === null ? t('climate.legend.noRecord') : formatY(r.y)}`).join(', ')}`;

  const tipLeft = activeX === null ? 0 : MARGIN.left + xScale(activeX);
  const flip = tipLeft > width * 0.6;

  return (
    <div
      ref={box}
      className="chart__plot"
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-label={label}
      aria-describedby={hintId}
      onKeyDown={onKey}
      onFocus={() => setActive((a) => a ?? (shown.length ? shown.length - 1 : null))}
      onBlur={() => setActive(null)}
    >
      <span id={hintId} className="sr-only">
        {t('climate.chart.keys')}
      </span>
      <span className="sr-only" aria-live="polite">
        {summary}
      </span>

      {width > 0 && (
        <svg
          ref={svgRef}
          width={width}
          height={height}
          className="chart__svg"
          aria-hidden="true"
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') setActive(null);
          }}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={-2} width={innerW} height={innerH + 4} />
            </clipPath>
          </defs>
          <Group left={MARGIN.left} top={MARGIN.top}>
            {/* ReferenceArea: the baseline years, shaded behind everything. */}
            {band && band.to >= domain[0] && band.from <= domain[1] && (
              <rect
                className="chart__band"
                x={xScale(Math.max(band.from, domain[0]) - dx / 2)}
                y={0}
                width={Math.max(0, xScale(Math.min(band.to, domain[1]) + dx / 2) - xScale(Math.max(band.from, domain[0]) - dx / 2))}
                height={innerH}
              />
            )}

            {/* Grid and y axis. Recessive: they are for reading, not looking. */}
            {yTicks.map((y) => (
              <g key={y}>
                <line className="chart__grid" x1={0} x2={innerW} y1={yScale(y)} y2={yScale(y)} />
                <text className="chart__tick" x={-8} y={yScale(y)} dy="0.32em" textAnchor="end">
                  {formatTick(y)}
                </text>
              </g>
            ))}
            {yScale.domain()[0] < 0 && yScale.domain()[1] > 0 && (
              <line className="chart__zero" x1={0} x2={innerW} y1={yScale(0)} y2={yScale(0)} />
            )}
            {xTicks.map((x) => (
              <text key={x} className="chart__tick" x={xScale(x)} y={innerH + 18} textAnchor="middle">
                {(tickX ?? formatX)(x)}
              </text>
            ))}

            <g clipPath={`url(#${clipId})`}>
              {series.map((s, si) => {
                const pts = s.points.filter((p) => p.x >= domain[0] && p.x <= domain[1]);
                if (s.mark === 'bars' || s.mark === 'signedBars') {
                  const barIndex = series.filter((o, oi) => oi < si && (o.mark === 'bars' || o.mark === 'signedBars')).length;
                  return (
                    <g key={s.id}>
                      {pts.map((p) => {
                        if (p.y === null) return null;
                        const x = xScale(p.x) - (barW * barCount) / 2 + barIndex * barW;
                        const y0 = yScale(Math.max(0, yScale.domain()[0]));
                        const y1 = yScale(p.y);
                        const tone =
                          s.mark === 'signedBars'
                            ? TONE[p.y >= 0 ? (s.positive ?? 'warm') : s.positive === 'cool' ? 'warm' : 'cool']
                            : TONE[s.tone];
                        return (
                          <rect
                            key={p.x}
                            x={x}
                            y={Math.min(y0, y1)}
                            width={Math.max(1, barW - (barW > 4 ? 1 : 0))}
                            height={Math.max(p.y === 0 ? 0 : 1, Math.abs(y1 - y0))}
                            rx={barW > 6 ? 2 : 0}
                            fill={tone}
                            opacity={activeX === null || activeX === p.x ? 1 : 0.55}
                          />
                        );
                      })}
                    </g>
                  );
                }
                return (
                  <g key={s.id}>
                    {s.mark === 'area' && (
                      <AreaClosed
                        data={pts}
                        x={(p) => xScale(p.x)}
                        y={(p) => yScale(p.y ?? 0)}
                        yScale={yScale}
                        defined={(p) => p.y !== null}
                        curve={curveLinear}
                        fill={`color-mix(in srgb, ${TONE[s.tone]} 12%, transparent)`}
                      />
                    )}
                    <LinePath
                      data={pts}
                      x={(p) => xScale(p.x)}
                      y={(p) => yScale(p.y ?? 0)}
                      defined={(p) => p.y !== null}
                      curve={curveLinear}
                      stroke={TONE[s.tone]}
                      strokeWidth={2}
                      strokeDasharray={s.dashed ? '5 4' : undefined}
                      fill="none"
                    />
                  </g>
                );
              })}

              {reference && (
                <line className="chart__reference" x1={0} x2={innerW} y1={yScale(reference.y)} y2={yScale(reference.y)} />
              )}
              {trend && (
                <line
                  className="chart__trend"
                  x1={xScale(trend.x1)}
                  x2={xScale(trend.x2)}
                  y1={yScale(trend.y1)}
                  y2={yScale(trend.y2)}
                />
              )}
            </g>

            {/* The crosshair, and a dot on each line at the active x. */}
            {activeX !== null && (
              <g>
                <line className="chart__crosshair" x1={xScale(activeX)} x2={xScale(activeX)} y1={0} y2={innerH} />
                {series.map((s) => {
                  if (s.mark !== 'line' && s.mark !== 'area') return null;
                  const y = s.points.find((p) => p.x === activeX)?.y;
                  if (y === null || y === undefined) return null;
                  return <circle key={s.id} className="chart__dot" cx={xScale(activeX)} cy={yScale(y)} r={4.5} stroke={TONE[s.tone]} />;
                })}
              </g>
            )}
          </Group>
        </svg>
      )}

      {activeX !== null && width > 0 && (
        <div
          className={`chart__tooltip${flip ? ' chart__tooltip--flip' : ''}`}
          style={{ left: tipLeft }}
          aria-hidden="true"
        >
          <p className="chart__tooltip-title">{formatX(activeX)}</p>
          {rows.map((r) => (
            <p key={r.id} className="chart__tooltip-row">
              <span className="chart__swatch chart__swatch--dot" style={{ '--tone': TONE[r.tone] } as CSSProperties} />
              <span className="chart__tooltip-label">{r.label}</span>
              <span className="chart__tooltip-value">{r.y === null ? '—' : formatY(r.y)}</span>
            </p>
          ))}
          {reference && (
            <p className="chart__tooltip-row chart__tooltip-row--muted">
              <span className="chart__tooltip-label">{reference.label}</span>
              <span className="chart__tooltip-value">{reference.value}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Axis labels only: fewest digits that tell ticks apart. */
function formatTick(y: number): string {
  const abs = Math.abs(y);
  const text = abs >= 100 || Number.isInteger(y) ? String(Math.round(abs)) : abs < 1 ? abs.toFixed(2).replace(/0$/, '') : abs.toFixed(1);
  return y < 0 ? `−${text}` : text;
}

/* ------------------------------------------------------------------ */
/* The brush                                                           */
/* ------------------------------------------------------------------ */

/**
 * Bklit's ChartBrush, rebuilt on pointer events so a thumb can drive it and
 * with two keyboard sliders so a keyboard can. Drag the window to pan it,
 * drag an edge to resize it.
 */
function Brush({
  series,
  xs,
  dx,
  range,
  onRange,
  formatX,
  t,
}: {
  series: Series;
  xs: number[];
  dx: number;
  range: [number, number] | null;
  onRange: (w: [number, number] | null) => void;
  formatX: (x: number) => string;
  t: Translate;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const height = 44;
  const first = xs[0];
  const last = xs[xs.length - 1];
  const [lo, hi] = range ?? [first, last];
  const minSpan = dx * Math.min(8, xs.length - 1);

  const xScale = useMemo(() => scaleLinear<number>({ domain: [first, last], range: [8, Math.max(8, width - 8)] }), [first, last, width]);
  const yScale = useMemo(() => {
    const ys = series.points.map((p) => p.y).filter((y): y is number => y !== null);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    return scaleLinear<number>({ domain: ys.length && hi > lo ? [lo, hi] : [0, 1], range: [height - 6, 6] });
  }, [series, height]);

  const snap = (x: number) => {
    let best = xs[0];
    for (const v of xs) if (Math.abs(v - x) < Math.abs(best - x)) best = v;
    return best;
  };

  const drag = useRef<{ mode: 'move' | 'lo' | 'hi'; start: number; lo: number; hi: number } | null>(null);

  const set = (a: number, b: number) => {
    const next: [number, number] = [snap(Math.max(first, Math.min(a, b))), snap(Math.min(last, Math.max(a, b)))];
    onRange(next[0] === first && next[1] === last ? null : next);
  };

  /** Where the pointer is along the track, in data units. */
  const along = (e: PointerEvent<SVGElement>) => {
    const svg = (e.currentTarget as SVGElement).ownerSVGElement ?? (e.currentTarget as SVGSVGElement);
    return xScale.invert(e.clientX - svg.getBoundingClientRect().left);
  };

  const onDown = (e: PointerEvent<SVGElement>, mode: 'move' | 'lo' | 'hi') => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, start: along(e), lo, hi };
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const x = along(e);
    const delta = x - d.start;
    if (d.mode === 'move') {
      const span = d.hi - d.lo;
      const a = Math.max(first, Math.min(last - span, d.lo + delta));
      set(a, a + span);
    } else if (d.mode === 'lo') {
      set(Math.min(d.lo + delta, d.hi - minSpan), d.hi);
    } else {
      set(d.lo, Math.max(d.hi + delta, d.lo + minSpan));
    }
  };

  const key = (e: KeyboardEvent<SVGElement>, edge: 'lo' | 'hi') => {
    const by = e.shiftKey ? dx * 10 : dx;
    let delta = 0;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -by;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = by;
    else return;
    e.preventDefault();
    if (edge === 'lo') set(Math.min(lo + delta, hi - minSpan), hi);
    else set(lo, Math.max(hi + delta, lo + minSpan));
  };

  const x0 = xScale(lo);
  const x1 = xScale(hi);

  return (
    <div className="chart__brush">
      <div className="chart__brush-head">
        <span>
          {t('climate.brush')}: {formatX(lo)}–{formatX(hi)}
        </span>
        {range && (
          <button type="button" className="chart__reset" onClick={() => onRange(null)}>
            {t('climate.brush.reset')}
          </button>
        )}
      </div>
      <div ref={box} className="chart__brush-track" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            onPointerMove={onMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            <LinePath
              data={series.points}
              x={(p) => xScale(p.x)}
              y={(p) => yScale(p.y ?? 0)}
              defined={(p) => p.y !== null}
              stroke="var(--text-faint)"
              strokeWidth={1.2}
              fill="none"
            />
            <rect className="chart__brush-shade" x={0} y={0} width={Math.max(0, x0)} height={height} />
            <rect className="chart__brush-shade" x={x1} y={0} width={Math.max(0, width - x1)} height={height} />
            <rect
              className="chart__brush-window"
              x={x0}
              y={1}
              width={Math.max(2, x1 - x0)}
              height={height - 2}
              onPointerDown={(e) => onDown(e, 'move')}
            />
            {(['lo', 'hi'] as const).map((edge) => {
              const x = edge === 'lo' ? x0 : x1;
              const value = edge === 'lo' ? lo : hi;
              return (
                <g
                  key={edge}
                  className="chart__handle"
                  role="slider"
                  tabIndex={0}
                  aria-label={t(edge === 'lo' ? 'climate.brush.start' : 'climate.brush.end')}
                  aria-valuemin={first}
                  aria-valuemax={last}
                  aria-valuenow={value}
                  aria-valuetext={formatX(value)}
                  onPointerDown={(e) => onDown(e, edge)}
                  onKeyDown={(e) => key(e, edge)}
                >
                  {/* The hit area is wider than the mark, for a thumb. */}
                  <rect x={x - 14} y={0} width={28} height={height} fill="transparent" />
                  <rect className="chart__handle-grip" x={x - 3} y={height / 2 - 11} width={6} height={22} rx={3} />
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
