/**
 * GET /api/map?layer=<id>&west=&south=&east=&north=
 *
 * Values for one weather layer across one viewport.
 *
 * VIEWPORT-BOUNDED AND CAPPED. The grid is computed from the bounds and
 * limited to a fixed number of points, so zooming out samples more coarsely
 * rather than asking for more — a map of India does not request ten thousand
 * readings. Open-Meteo accepts batched coordinates in one call, so a whole
 * viewport is one upstream request.
 *
 * Server-side like every other upstream call: no third-party endpoint is
 * reachable from the browser.
 */

import {
  LAYERS,
  aqiLayer,
  latticePoints,
  snapToLattice,
  type LayerId,
  type WeatherLayer,
} from '@/lib/map/layers';
import { TTL, cached } from '@/lib/cache';
import { airQualitySource } from '@/lib/weather/aqi';
import { CPCB_SOURCE, cpcbFeed, stationsInBounds } from '@/lib/weather/cpcb';

export const dynamic = 'force-dynamic';

const HOST = 'https://api.open-meteo.com/v1/forecast';
const AIR_HOST = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const TIMEOUT_MS = 9000;

type Sample = { lat: number; lon: number; value: number };

/**
 * Success carries points; failure carries what upstream said, so the two are
 * told apart by the caller AND by the cache, which stores only the first.
 */
type MapResult =
  | { ok: true; points: Sample[] }
  | { ok: false; upstreamStatus: number | null };

function number(url: URL, key: string): number | null {
  const raw = url.searchParams.get(key);
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const id = url.searchParams.get('layer') as LayerId | null;
  let layer: WeatherLayer | undefined = id ? LAYERS[id] : undefined;

  if (!layer) {
    return Response.json({ error: 'Unknown layer.' }, { status: 400 });
  }

  // A layer with no source says so rather than returning an empty grid that
  // would render as "no weather anywhere". Air quality is decided below: its
  // kind depends on which source can answer.
  if (
    layer.availability.status === 'unavailable' ||
    layer.kind === 'regions' ||
    layer.kind === 'none'
  ) {
    return Response.json(
      { layer: layer.id, kind: layer.kind, availability: layer.availability, points: [] },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  const west = number(url, 'west');
  const south = number(url, 'south');
  const east = number(url, 'east');
  const north = number(url, 'north');

  if (west === null || south === null || east === null || north === null) {
    return Response.json({ error: 'Send west, south, east and north.' }, { status: 400 });
  }

  /*
   * Air quality follows the rail's source, so the map and the rail cannot put
   * one place on two scales.
   *
   * CPCB: the stations themselves, from the same cached feed the rail reads —
   * no request of its own, and no field painted between stations, because the
   * air between two monitors was not measured. Where the feed cannot be read
   * and the source has a modelled fallback, the whole layer becomes the
   * European grid and says so; the two scales never share one map.
   */
  let scale: 'cpcb' | 'european' | undefined;
  if (layer.id === 'aqi') {
    const air = airQualitySource();
    if (air.standard === 'cpcb') {
      const feed = await cpcbFeed();
      if (feed.ok) {
        const cpcb = aqiLayer('cpcb');
        return Response.json(
          {
            layer: cpcb.id,
            scale: 'cpcb',
            kind: cpcb.kind,
            unit: cpcb.unit,
            availability: cpcb.availability,
            points: stationsInBounds(feed.stations, { west, south, east, north }),
            source: CPCB_SOURCE,
            nature: 'observation',
            fetchedAt: new Date().toISOString(),
          },
          { headers: { 'cache-control': 'no-store' } },
        );
      }
      if (!air.fallback) {
        return Response.json(
          {
            layer: layer.id,
            scale: 'cpcb',
            kind: 'stations',
            unit: layer.unit,
            availability: layer.availability,
            points: [],
            error: { kind: 'unreachable', upstreamStatus: null },
          },
          { status: 503, headers: { 'cache-control': 'no-store' } },
        );
      }
    }
    layer = aqiLayer('european');
    scale = 'european';
  }

  /*
   * The viewport is snapped onto a fixed world lattice BEFORE anything else,
   * and both the grid and the cache key come from the snapped tile. That is
   * what makes panning cheap: a viewport that moves inside one cell produces
   * the identical key and is served from cache without an upstream call.
   */
  const lattice = snapToLattice({ west, south, east, north });
  if (!lattice) {
    return Response.json({ layer: layer.id, points: [] });
  }

  const grid = latticePoints(lattice);

  const latitudes = grid.map((p) => p.lat.toFixed(3)).join(',');
  const longitudes = grid.map((p) => p.lon.toFixed(3)).join(',');
  const drawn = layer;
  const isAir = drawn.id === 'aqi';
  const host = isAir ? AIR_HOST : HOST;

  const upstream =
    `${host}?latitude=${latitudes}&longitude=${longitudes}` +
    `&current=${drawn.field}&timezone=auto`;

  /*
   * Keyed on the snapped tile and the layer, so panning a few pixels does not
   * re-ask upstream for the same grid. The TTL matches the current-conditions
   * cadence — these are the same model values.
   */
  const key =
    `map:${drawn.id}:${scale ?? ''}:${lattice.step}:` +
    `${lattice.west},${lattice.south},${lattice.east},${lattice.north}`;

  const result = await cached<MapResult>(
    key,
    TTL.current,
    async () => {
      try {
        const res = await fetch(upstream, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { accept: 'application/json' },
          cache: 'no-store',
        });

        if (!res.ok) {
          /*
           * Logged with the status and the size of the ask, because the
           * failure that matters here is invisible from the outside: a
           * batched grid can be refused for its weight while the very same
           * host answers a single coordinate on the next route.
           */
          console.warn(
            `[map] ${drawn.id}: upstream ${res.status} for ${grid.length} points ` +
              `(${upstream.length} char url)`,
          );
          return { ok: false, upstreamStatus: res.status };
        }

        // Open-Meteo returns an array for a batched request and a bare object
        // for a single coordinate.
        const body = (await res.json()) as unknown;
        const rows = Array.isArray(body) ? body : [body];

        const points = rows
          .map((row, i) => {
            const current = (row as { current?: Record<string, unknown> }).current;
            const value = current?.[drawn.field as string];
            if (typeof value !== 'number' || !Number.isFinite(value)) return null;
            return { lat: grid[i]?.lat, lon: grid[i]?.lon, value };
          })
          .filter(
            (p): p is Sample =>
              p !== null && typeof p.lat === 'number' && typeof p.lon === 'number',
          );

        return { ok: true, points };
      } catch (error) {
        console.warn(
          `[map] ${drawn.id}: upstream unreachable for ${grid.length} points —`,
          error instanceof Error ? error.name : error,
        );
        return { ok: false, upstreamStatus: null };
      }
    },
    /*
     * A failure is not data and must not be remembered as if it were. Caching
     * the null meant one refused request left the layer blank for the whole
     * TTL, and the next reader was told there was no source when there was
     * one that had simply been busy a minute ago.
     */
    (value) => value.ok,
  );

  if (!result.ok) {
    /*
     * The layer HAS a source; the source did not answer. Saying "no
     * authoritative source for this layer" here — which is what a shared
     * `noSource` did — states something permanent about a transient failure,
     * and the two call for different words and different recovery.
     */
    return Response.json(
      {
        layer: drawn.id,
        scale,
        kind: drawn.kind,
        unit: drawn.unit,
        availability: drawn.availability,
        points: [],
        error: { kind: 'unreachable', upstreamStatus: result.upstreamStatus },
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  const { points } = result;

  return Response.json(
    {
      layer: drawn.id,
      scale,
      kind: drawn.kind,
      unit: drawn.unit,
      availability: drawn.availability,
      points,
      // A model value, like everything else Open-Meteo returns.
      nature: 'model',
      fetchedAt: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
