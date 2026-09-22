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

import { LAYERS, sampleGrid, type LayerId } from '@/lib/map/layers';
import { TTL, cached } from '@/lib/cache';

export const dynamic = 'force-dynamic';

const HOST = 'https://api.open-meteo.com/v1/forecast';
const AIR_HOST = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const TIMEOUT_MS = 9000;

function number(url: URL, key: string): number | null {
  const raw = url.searchParams.get(key);
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const id = url.searchParams.get('layer') as LayerId | null;
  const layer = id ? LAYERS[id] : undefined;

  if (!layer) {
    return Response.json({ error: 'Unknown layer.' }, { status: 400 });
  }

  // A layer with no source says so rather than returning an empty grid that
  // would render as "no weather anywhere".
  if (layer.availability.status === 'unavailable' || layer.kind !== 'points') {
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

  const grid = sampleGrid({ west, south, east, north });
  if (grid.length === 0) {
    return Response.json({ layer: layer.id, points: [] });
  }

  const latitudes = grid.map((p) => p.lat.toFixed(3)).join(',');
  const longitudes = grid.map((p) => p.lon.toFixed(3)).join(',');
  const isAir = layer.id === 'aqi';
  const host = isAir ? AIR_HOST : HOST;

  const upstream =
    `${host}?latitude=${latitudes}&longitude=${longitudes}` +
    `&current=${layer.field}&timezone=auto`;

  /*
   * Cached on the rounded bounds and the layer, so panning a few pixels does
   * not re-ask upstream for the same grid. The TTL matches the current-
   * conditions cadence — these are the same model values.
   */
  const key = `map:${layer.id}:${west.toFixed(1)},${south.toFixed(1)},${east.toFixed(1)},${north.toFixed(1)}`;

  const points = await cached(key, TTL.current, async () => {
    try {
      const res = await fetch(upstream, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) return null;

      // Open-Meteo returns an array for a batched request and a bare object
      // for a single coordinate.
      const body = (await res.json()) as unknown;
      const rows = Array.isArray(body) ? body : [body];

      return rows
        .map((row, i) => {
          const current = (row as { current?: Record<string, unknown> }).current;
          const value = current?.[layer.field as string];
          if (typeof value !== 'number' || !Number.isFinite(value)) return null;
          return { lat: grid[i]?.lat, lon: grid[i]?.lon, value };
        })
        .filter(
          (p): p is { lat: number; lon: number; value: number } =>
            p !== null && typeof p.lat === 'number' && typeof p.lon === 'number',
        );
    } catch {
      return null;
    }
  });

  if (points === null) {
    return Response.json(
      { layer: layer.id, points: [], availability: { status: 'unavailable', reason: 'noSource' } },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  return Response.json(
    {
      layer: layer.id,
      unit: layer.unit,
      availability: layer.availability,
      points,
      // A model value, like everything else Open-Meteo returns.
      nature: 'model',
      fetchedAt: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
