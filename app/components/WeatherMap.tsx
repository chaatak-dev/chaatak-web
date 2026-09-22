'use client';

/**
 * The weather map workspace.
 *
 * A base map from a provider, and weather drawn on top of it. The two are
 * independent by construction: the base map is a style URL from
 * `lib/map/layers.ts`, and every weather layer feeds the same canvas
 * overlay. Swapping OpenFreeMap for anything else is one entry in
 * `BASE_MAPS` and nothing here changes.
 *
 * RENDERING. One `<canvas>` for the whole layer, redrawn on move — not a
 * marker per sample. A few hundred DOM elements repositioned on every frame
 * of a pan is what makes a weather map stutter, and the browser is very good
 * at painting a few hundred radial gradients into one bitmap.
 *
 * REQUESTS. Sampling is bounded by the viewport and capped, viewport changes
 * are debounced, and a request for a viewport that has already been left is
 * aborted rather than drawn when it lands.
 *
 * TIME. `hour` is here and fixed at "now". It is the seam an animation
 * timeline arrives through: the layer fetch already takes a viewport, and a
 * timeline adds a parameter to it rather than a new architecture.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useApp } from './AppState';
import {
  colourFor,
  DEFAULT_BASE_MAP,
  LAYERS,
  LAYER_ORDER,
  type Bounds,
  type LayerId,
} from '@/lib/map/layers';
import type { Location } from '@/lib/weather/types';

type Sample = { lat: number; lon: number; value: number };

type LayerData = {
  points: Sample[];
  unit: string;
  /** Whether this layer has a source AT ALL. A permanent fact about it. */
  available: boolean;
  /** Whether the source that exists failed to answer THIS time. */
  failed: boolean;
};

/** How long to wait after a pan before asking for new numbers. */
const DEBOUNCE_MS = 350;

export function WeatherMap({
  place,
  onClose,
}: {
  place: Location | null;
  onClose: () => void;
}) {
  const app = useApp();
  const { t } = app;

  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  const [layerId, setLayerId] = useState<LayerId>('temperature');
  const [data, setData] = useState<LayerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [inspected, setInspected] = useState<{ lat: number; lon: number; value: number } | null>(null);

  const request = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The latest paint function, reachable from a listener without making the
   * listener depend on it.
   *
   * `paint` changes identity whenever the data does. A listener effect that
   * depended on it tore down and re-attached on every response — and
   * re-attaching called `schedule()` again, which fetched again. One map open
   * cost eight requests.
   */
  const paintRef = useRef<() => void>(() => {});

  /* ---- the base map ------------------------------------------------- */

  useEffect(() => {
    if (!holder.current || map.current) return;

    const instance = new maplibregl.Map({
      container: holder.current,
      style: DEFAULT_BASE_MAP.styleUrl,
      center: place ? [place.longitude, place.latitude] : [78.9, 22.6],
      zoom: place ? 7 : 4.2,
      attributionControl: false,
    });

    // Attribution is not optional for OSM-derived tiles, and `compact` keeps
    // it out of the way without hiding it.
    instance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.current = instance;

    /*
     * MapLibre measures its container once, at construction.
     *
     * The workspace is a flex column that has not been laid out when this
     * runs, so the container had no height and the map fell back to its
     * default 300px — inside an 839px stage. Everything still "worked": tiles
     * loaded, the overlay painted, and every blob was projected through a
     * 300px transform onto an 839px canvas, so the weather was drawn in the
     * wrong place with no error anywhere.
     *
     * The observer also covers an actual window resize, which is the same
     * problem arriving later.
     */
    const observer = new ResizeObserver(() => {
      instance.resize();
      paintRef.current();
    });
    observer.observe(holder.current);

    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
    };
  }, [place]);

  /* ---- the overlay -------------------------------------------------- */

  /**
   * Paint the samples into one bitmap.
   *
   * Each point is a soft radial blob whose colour comes from the layer's own
   * scale, composited with `lighter` so overlapping samples build a field
   * rather than stacking as discs. It is a visualisation of a coarse grid and
   * it deliberately looks like one — a crisp boundary would imply a precision
   * the data does not have.
   */
  const paint = useCallback(() => {
    const instance = map.current;
    const el = canvas.current;
    if (!instance || !el || !data) return;

    const layer = LAYERS[layerId];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = el.clientWidth;
    const height = el.clientHeight;

    el.width = Math.round(width * dpr);
    el.height = Math.round(height * dpr);

    const ctx = el.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (data.points.length === 0) return;

    // Blob radius follows the sample spacing, so the field stays continuous
    // at every zoom instead of turning into dots when you zoom in.
    const spacing = spacingInPixels(instance, data.points);
    const radius = Math.max(28, spacing * 0.85);

    ctx.globalCompositeOperation = 'lighter';

    for (const point of data.points) {
      const at = instance.project([point.lon, point.lat]);
      if (at.x < -radius || at.y < -radius || at.x > width + radius || at.y > height + radius) {
        continue;
      }

      const colour = colourFor(layer, point.value);
      const gradient = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius);
      gradient.addColorStop(0, withAlpha(colour, 0.55));
      gradient.addColorStop(1, withAlpha(colour, 0));

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  }, [data, layerId]);

  useEffect(() => {
    paintRef.current = paint;
    paint();
  }, [paint]);

  /* ---- fetching, bounded and debounced ------------------------------ */

  const load = useCallback(
    (bounds: Bounds) => {
      const layer = LAYERS[layerId];
      if (layer.availability.status === 'unavailable') {
        setData({ points: [], unit: layer.unit, available: false, failed: false });
        return;
      }

      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setLoading(true);

      const query =
        `layer=${layerId}&west=${bounds.west.toFixed(3)}&south=${bounds.south.toFixed(3)}` +
        `&east=${bounds.east.toFixed(3)}&north=${bounds.north.toFixed(3)}`;

      void fetch(`/api/map?${query}`, { signal: controller.signal, cache: 'no-store' })
        // The body is read on a failure too: a refused grid answers 503 AND
        // says why, and discarding it here would leave the reader with an
        // empty map and no sentence at all.
        .then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => null) }))
        .then(({ ok, body }) => {
          // A viewport that has already been left. Drawing it now would show
          // the weather somewhere the reader is no longer looking.
          if (request.current !== controller) return;
          request.current = null;
          setLoading(false);
          setData({
            points: (body?.points ?? []) as Sample[],
            unit: body?.unit ?? LAYERS[layerId].unit,
            available: body?.availability?.status !== 'unavailable',
            failed: !ok || Boolean(body?.error),
          });
        })
        .catch(() => {
          if (request.current !== controller) return;
          request.current = null;
          setLoading(false);
        });
    },
    [layerId],
  );

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const b = instance.getBounds();
        load({
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth(),
        });
      }, DEBOUNCE_MS);
    };

    // Through the ref, so this effect does not re-run when the data changes.
    const repaint = () => paintRef.current();

    instance.on('moveend', schedule);
    instance.on('move', repaint);
    instance.on('zoom', repaint);
    instance.on('load', schedule);

    // The map may already be loaded when the layer changes.
    if (instance.loaded()) schedule();

    return () => {
      instance.off('moveend', schedule);
      instance.off('move', repaint);
      instance.off('zoom', repaint);
      instance.off('load', schedule);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  /* ---- inspection ---------------------------------------------------- */

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    const onClick = (event: maplibregl.MapMouseEvent) => {
      if (!data || data.points.length === 0) return;
      const { lng, lat } = event.lngLat;

      // The nearest sample, which is the honest answer for a gridded field —
      // interpolating would invent a precision the grid does not have.
      let best: Sample | null = null;
      let bestSq = Infinity;
      for (const p of data.points) {
        const dy = p.lat - lat;
        const dx = (p.lon - lng) * Math.cos((lat * Math.PI) / 180);
        const sq = dy * dy + dx * dx;
        if (sq < bestSq) {
          bestSq = sq;
          best = p;
        }
      }
      if (best) setInspected(best);
    };

    instance.on('click', onClick);
    return () => {
      instance.off('click', onClick);
    };
  }, [data]);

  const layer = LAYERS[layerId];

  return (
    <div className="wmap" role="dialog" aria-modal="true" aria-label={t('rail.openMap')}>
      <div className="wmap__bar">
        <div className="wmap__layers" role="tablist" aria-label={t('rail.openMap')}>
          {LAYER_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={layerId === id}
              className={`wmap__layer${layerId === id ? ' wmap__layer--on' : ''}`}
              onClick={() => {
                setLayerId(id);
                setInspected(null);
              }}
            >
              {t(LAYER_LABEL[id])}
            </button>
          ))}
        </div>

        <button type="button" className="wmap__close" onClick={onClose} aria-label={t('nav.close')}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="wmap__stage">
        <div ref={holder} className="wmap__canvas" />
        <canvas ref={canvas} className="wmap__overlay" aria-hidden="true" />

        {loading && <p className="wmap__status">{t('rail.loading')}</p>}

        {data && !data.available && (
          <p className="wmap__status wmap__status--absent">{t('map.noSource')}</p>
        )}

        {data && data.available && data.failed && (
          <p className="wmap__status wmap__status--absent" role="status">
            {t('map.unreachable')}
          </p>
        )}

        {inspected && (
          <div className="wmap__readout" role="status">
            <span className="wmap__readout-value">
              {Math.round(inspected.value * 10) / 10}
              <span className="wmap__readout-unit">{data?.unit}</span>
            </span>
            <span className="wmap__readout-where">
              {inspected.lat.toFixed(2)}, {inspected.lon.toFixed(2)}
            </span>
          </div>
        )}

        <Legend layerId={layerId} unit={data?.unit ?? layer.unit} />
      </div>
    </div>
  );
}

const LAYER_LABEL = {
  temperature: 'rail.temperature',
  precipitation: 'rail.precipitation',
  wind: 'rail.wind',
  cloud: 'map.cloud',
  aqi: 'rail.aqi',
  uv: 'map.uv',
  pressure: 'map.pressure',
  alerts: 'map.alerts',
} as const;

/** The scale, drawn from the same stops the canvas paints from. */
function Legend({ layerId, unit }: { layerId: LayerId; unit: string }) {
  const layer = LAYERS[layerId];
  const stops = layer.stops;
  if (stops.length === 0) return null;

  const lo = stops[0][0];
  const hi = stops[stops.length - 1][0];
  const ramp = stops
    .map(([value, colour]) => `${colour} ${((value - lo) / (hi - lo)) * 100}%`)
    .join(', ');

  return (
    <div className="wmap__legend">
      <span className="wmap__legend-end">{lo}</span>
      <span className="wmap__legend-ramp" style={{ background: `linear-gradient(90deg, ${ramp})` }} />
      <span className="wmap__legend-end">
        {hi}
        {unit}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function withAlpha(colour: string, alpha: number): string {
  if (!colour.startsWith('#') || colour.length < 7) return colour;
  const r = parseInt(colour.slice(1, 3), 16);
  const g = parseInt(colour.slice(3, 5), 16);
  const b = parseInt(colour.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Screen distance between two adjacent samples, for sizing the blobs. */
function spacingInPixels(instance: maplibregl.Map, points: Sample[]): number {
  if (points.length < 2) return 60;
  const a = instance.project([points[0].lon, points[0].lat]);
  const b = instance.project([points[1].lon, points[1].lat]);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.max(24, Math.hypot(dx, dy));
}
