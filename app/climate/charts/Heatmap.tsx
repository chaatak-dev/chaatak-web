'use client';

/**
 * Every month of every year, one cell each.
 *
 * Adapted from Bklit UI's Heatmap (MIT — see ./BKLIT-LICENSE.txt): a grid of
 * cells on shared band scales, a level legend, and a tooltip that inspects
 * one cell. Bklit lays days out in a calendar; this lays months out against
 * years, which is the shape a climate record has — years run left to right,
 * so a warming record reads as colour creeping in from the right.
 *
 * COLOUR. A departure from normal is diverging: cool below, warm above, and
 * paper at zero, so "normal" is the absence of colour. A quantity whose zero
 * means something (rainfall) is sequential in one hue. The scale is symmetric
 * about zero, so equal departures get equal colour whichever way they go. A
 * month the record cannot summarise is drawn hatched and named in the legend
 * — never as zero, never as normal.
 */

import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { Translate } from '@/lib/i18n/strings';
import { useWidth } from './useWidth';

export type Cell = { year: number; month: number; value: number | null };

type Props = {
  cells: Cell[];
  years: number[];
  months: number[];
  mode: 'diverging' | 'sequential';
  /** For diverging: which colour a positive value takes. */
  positive?: 'warm' | 'cool';
  format: (v: number) => string;
  monthName: (m: number) => string;
  label: string;
  t: Translate;
};

const MARGIN = { top: 4, right: 4, bottom: 22, left: 34 };
const ROW = 17;

export function Heatmap({ cells, years, months, mode, positive = 'warm', format, monthName, label, t }: Props) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<{ yi: number; mi: number } | null>(null);
  const hatch = useId();
  const hintId = useId();

  const height = MARGIN.top + months.length * ROW + MARGIN.bottom;
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const colW = years.length ? innerW / years.length : 0;

  const lookup = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const c of cells) map.set(`${c.year}-${c.month}`, c.value);
    return map;
  }, [cells]);

  const extent = useMemo(() => {
    let max = 0;
    let min = Infinity;
    for (const c of cells) {
      if (c.value === null) continue;
      max = Math.max(max, mode === 'diverging' ? Math.abs(c.value) : c.value);
      min = Math.min(min, c.value);
    }
    return { max: max || 1, min: Number.isFinite(min) ? min : 0 };
  }, [cells, mode]);

  const fill = (v: number | null): string => {
    if (v === null) return `url(#${hatch})`;
    if (mode === 'sequential') {
      const share = Math.round(Math.sqrt(Math.max(0, v) / extent.max) * 88);
      return `color-mix(in oklab, var(--clim-cool) ${share}%, var(--paper))`;
    }
    const share = Math.round(Math.min(1, Math.abs(v) / extent.max) * 90);
    const hue = (v >= 0) === (positive === 'warm') ? 'var(--clim-warm)' : 'var(--clim-cool)';
    return `color-mix(in oklab, ${hue} ${share}%, var(--paper))`;
  };

  const tickEvery = Math.max(1, Math.ceil(56 / Math.max(colW, 1)));
  const xTicks = years.filter((y, i) => i === 0 || y % Math.max(5, Math.ceil(tickEvery / 5) * 5) === 0);

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - MARGIN.left;
    const y = e.clientY - rect.top - MARGIN.top;
    const yi = Math.floor(x / colW);
    const mi = Math.floor(y / ROW);
    if (yi >= 0 && yi < years.length && mi >= 0 && mi < months.length) setActive({ yi, mi });
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = active ?? { yi: years.length - 1, mi: 0 };
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const move = moves[e.key];
    if (e.key === 'Escape') return setActive(null);
    if (!move) return;
    e.preventDefault();
    setActive({
      yi: Math.min(years.length - 1, Math.max(0, cur.yi + move[0])),
      mi: Math.min(months.length - 1, Math.max(0, cur.mi + move[1])),
    });
  };

  const activeYear = active ? years[active.yi] : null;
  const activeMonth = active ? months[active.mi] : null;
  const activeValue = active ? lookup.get(`${activeYear}-${activeMonth}`) ?? null : null;
  const summary = active
    ? `${monthName(activeMonth!)} ${activeYear}: ${activeValue === null ? t('climate.legend.noRecord') : format(activeValue)}`
    : '';
  const tipLeft = active ? MARGIN.left + (active.yi + 0.5) * colW : 0;

  return (
    <div className="chart">
      <div
        ref={box}
        className="chart__plot"
        style={{ height }}
        tabIndex={0}
        role="group"
        aria-label={label}
        aria-describedby={hintId}
        onKeyDown={onKey}
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
            width={width}
            height={height}
            className="chart__svg"
            aria-hidden="true"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
          >
            <defs>
              <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="5" height="5" fill="var(--surface)" />
                <line x1="0" y1="0" x2="0" y2="5" stroke="var(--hairline)" strokeWidth="2" />
              </pattern>
            </defs>
            <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
              {months.map((m, mi) => (
                <text key={m} className="chart__tick" x={-6} y={mi * ROW + ROW / 2} dy="0.32em" textAnchor="end">
                  {monthName(m)}
                </text>
              ))}
              {years.map((y, yi) =>
                months.map((m, mi) => (
                  <rect
                    key={`${y}-${m}`}
                    x={yi * colW}
                    y={mi * ROW}
                    width={Math.max(0.5, colW - (colW > 5 ? 1 : 0))}
                    height={ROW - 1}
                    fill={fill(lookup.get(`${y}-${m}`) ?? null)}
                  />
                )),
              )}
              {active && (
                <rect
                  className="chart__cell-focus"
                  x={active.yi * colW}
                  y={active.mi * ROW}
                  width={Math.max(2, colW - (colW > 5 ? 1 : 0))}
                  height={ROW - 1}
                />
              )}
              {xTicks.map((y) => (
                <text
                  key={y}
                  className="chart__tick"
                  x={(years.indexOf(y) + 0.5) * colW}
                  y={months.length * ROW + 15}
                  textAnchor="middle"
                >
                  {y}
                </text>
              ))}
            </g>
          </svg>
        )}
        {active && width > 0 && (
          <div
            className={`chart__tooltip${tipLeft > width * 0.6 ? ' chart__tooltip--flip' : ''}`}
            style={{ left: tipLeft }}
            aria-hidden="true"
          >
            <p className="chart__tooltip-title">
              {monthName(activeMonth!)} {activeYear}
            </p>
            <p className="chart__tooltip-row">
              <span className="chart__swatch chart__swatch--dot" style={{ '--tone': fill(activeValue) } as CSSProperties} />
              <span className="chart__tooltip-value">{activeValue === null ? t('climate.legend.noRecord') : format(activeValue)}</span>
            </p>
          </div>
        )}
      </div>

      <div className="heatmap__legend" aria-hidden="true">
        {mode === 'diverging' ? (
          <>
            <span>{t(positive === 'warm' ? 'climate.legend.below' : 'climate.legend.above')}</span>
            <span className="heatmap__ramp heatmap__ramp--diverging" style={{ '--from': positive === 'warm' ? 'var(--clim-cool)' : 'var(--clim-warm)', '--to': positive === 'warm' ? 'var(--clim-warm)' : 'var(--clim-cool)' } as CSSProperties} />
            <span>{t(positive === 'warm' ? 'climate.legend.above' : 'climate.legend.below')}</span>
            <span className="heatmap__range">±{format(extent.max).replace(/^[+−]/, '')}</span>
          </>
        ) : (
          <>
            <span>{t('climate.legend.less')}</span>
            <span className="heatmap__ramp heatmap__ramp--sequential" />
            <span>{t('climate.legend.more')}</span>
            <span className="heatmap__range">
              {format(extent.min)}–{format(extent.max)}
            </span>
          </>
        )}
        <span className="heatmap__missing">
          <span className="heatmap__hatch" />
          {t('climate.legend.noRecord')}
        </span>
      </div>
    </div>
  );
}
