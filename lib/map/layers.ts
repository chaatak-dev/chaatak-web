/**
 * The weather map's layers, and the base map they sit on.
 *
 * TWO INDEPENDENT THINGS, deliberately not coupled:
 *
 *   the BASE MAP  — coastlines, roads, district names. A vector style from a
 *                   provider. Swappable without touching anything below.
 *   the LAYERS    — what the weather is doing, drawn on top. Each has its own
 *                   data source, its own scale and its own legend.
 *
 * Wiring the weather to the base-map provider is the mistake that makes a map
 * impossible to move later: the day OpenFreeMap is the wrong choice, only
 * `BASE_MAPS` should change.
 *
 * WHAT IS AND IS NOT AVAILABLE. A layer declares its own `availability`, and
 * an unavailable one says so rather than drawing something plausible. IMD
 * publishes district warnings as CODES PER DISTRICT, not as polygons — there
 * is no authoritative geometry for them — so that layer renders from the
 * district set Chaatak already holds and nothing is invented. A layer with no
 * data source at all renders an explicit empty state, because a map that
 * shows made-up weather is worse than a map that shows none.
 */

export type BaseMapProvider = {
  id: string;
  /** A MapLibre style URL. The only thing that has to change to swap maps. */
  styleUrl: string;
  /** Required by every provider worth using, and by law for OSM data. */
  attribution: string;
};

/**
 * The base maps this build knows about.
 *
 * OpenFreeMap serves OpenStreetMap-derived vector tiles with no key and no
 * usage ceiling, which is the right default for a product that must not
 * acquire a paid dependency to show a coastline. Attribution is not optional.
 */
export const BASE_MAPS: Record<string, BaseMapProvider> = {
  openfreemap: {
    id: 'openfreemap',
    styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
    attribution: '© OpenFreeMap © OpenStreetMap contributors',
  },
  openfreemapBright: {
    id: 'openfreemapBright',
    styleUrl: 'https://tiles.openfreemap.org/styles/bright',
    attribution: '© OpenFreeMap © OpenStreetMap contributors',
  },
};

export const DEFAULT_BASE_MAP = BASE_MAPS.openfreemap;

/* ------------------------------------------------------------------ */
/* Weather layers                                                      */
/* ------------------------------------------------------------------ */

export type LayerId =
  | 'temperature'
  | 'precipitation'
  | 'wind'
  | 'cloud'
  | 'aqi'
  | 'uv'
  | 'pressure'
  | 'alerts';

/**
 * How a layer gets its numbers.
 *
 *   points   sampled on a grid across the viewport, from a forecast API
 *   regions  one value per administrative area we already hold geometry for
 *   none     no source is configured; the layer says so
 */
export type LayerKind = 'points' | 'regions' | 'none';

export type LayerAvailability =
  | { status: 'available' }
  /** Deliberately not drawn, with the reason a reader can act on. */
  | { status: 'unavailable'; reason: 'noSource' | 'noGeometry' };

export type WeatherLayer = {
  id: LayerId;
  kind: LayerKind;
  /** The Open-Meteo hourly field this layer samples, where it samples one. */
  field?: string;
  unit: string;
  /**
   * The colour scale, low to high, as [value, colour] stops.
   *
   * Stops are values in the layer's own unit, not normalised positions —
   * 35°C has to mean 35°C on the legend and in the shader alike.
   */
  stops: [number, string][];
  availability: LayerAvailability;
};

/**
 * The scales.
 *
 * Each is a perceptual ramp rather than a rainbow: a rainbow makes small
 * differences look like large ones and hides large ones inside a band, which
 * on a temperature map means misreading a heatwave.
 */
export const LAYERS: Record<LayerId, WeatherLayer> = {
  temperature: {
    id: 'temperature',
    kind: 'points',
    field: 'temperature_2m',
    unit: '°C',
    stops: [
      [-5, '#3b5bA9'],
      [5, '#4E8FC4'],
      [15, '#7FBFA0'],
      [25, '#E3C463'],
      [35, '#E08A3C'],
      [45, '#A32D2D'],
    ],
    availability: { status: 'available' },
  },
  precipitation: {
    id: 'precipitation',
    kind: 'points',
    field: 'precipitation',
    unit: 'mm',
    stops: [
      [0, '#EDEFF1'],
      [0.5, '#BBD7E8'],
      [2, '#6FA8D6'],
      [8, '#3A6FB0'],
      [20, '#26417D'],
    ],
    availability: { status: 'available' },
  },
  wind: {
    id: 'wind',
    kind: 'points',
    field: 'wind_speed_10m',
    unit: 'km/h',
    stops: [
      [0, '#EDEFF1'],
      [10, '#C9DCC4'],
      [25, '#8FBF86'],
      [45, '#E3C463'],
      [70, '#A32D2D'],
    ],
    availability: { status: 'available' },
  },
  cloud: {
    id: 'cloud',
    kind: 'points',
    field: 'cloud_cover',
    unit: '%',
    stops: [
      [0, '#F5F3EE'],
      [40, '#D8D9DA'],
      [70, '#AFB3B7'],
      [100, '#7E858B'],
    ],
    availability: { status: 'available' },
  },
  aqi: {
    id: 'aqi',
    kind: 'points',
    field: 'european_aqi',
    unit: 'EAQI',
    stops: [
      [0, '#6BA84F'],
      [20, '#A9C64E'],
      [40, '#E3C463'],
      [60, '#E08A3C'],
      [80, '#A32D2D'],
      [100, '#6B2233'],
    ],
    availability: { status: 'available' },
  },
  uv: {
    id: 'uv',
    kind: 'points',
    field: 'uv_index',
    unit: 'UV',
    stops: [
      [0, '#EDEFF1'],
      [3, '#E3C463'],
      [6, '#E08A3C'],
      [8, '#A32D2D'],
      [11, '#6B2233'],
    ],
    availability: { status: 'available' },
  },
  pressure: {
    id: 'pressure',
    kind: 'points',
    field: 'pressure_msl',
    unit: 'hPa',
    stops: [
      [980, '#6E8FC4'],
      [1000, '#9FC3D6'],
      [1013, '#EDEFF1'],
      [1025, '#E3C463'],
      [1040, '#E08A3C'],
    ],
    availability: { status: 'available' },
  },

  /*
   * IMD's district warnings, drawn on the DISTRICTS Chaatak already holds.
   *
   * IMD publishes a hazard code and a colour per district id — no geometry of
   * any kind. Drawing a polygon would mean inventing the shape of a warning
   * area, which is the one thing a warning map must never do: a boundary that
   * is nearly right tells somebody on the wrong side of it that they are
   * safe. So this layer marks district CENTROIDS, which is exactly the
   * resolution the data actually has.
   */
  alerts: {
    id: 'alerts',
    kind: 'regions',
    unit: '',
    stops: [
      [0, 'var(--sev-none)'],
      [1, 'var(--sev-watch)'],
      [2, 'var(--sev-alert)'],
      [3, 'var(--sev-warning)'],
    ],
    availability: { status: 'available' },
  },
};

export const LAYER_ORDER: LayerId[] = [
  'temperature',
  'precipitation',
  'wind',
  'cloud',
  'aqi',
  'uv',
  'pressure',
  'alerts',
];

/**
 * The colour for a value on a layer's scale.
 *
 * Linear between the two surrounding stops, clamped at both ends. Pure, so
 * the legend and the map cannot disagree about what a number looks like.
 */
export function colourFor(layer: WeatherLayer, value: number): string {
  const stops = layer.stops;
  if (stops.length === 0) return '#888';
  if (value <= stops[0][0]) return stops[0][1];
  if (value >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];

  for (let i = 1; i < stops.length; i += 1) {
    const [hi, hiColour] = stops[i];
    if (value > hi) continue;
    const [lo, loColour] = stops[i - 1];
    const t = hi === lo ? 0 : (value - lo) / (hi - lo);
    return mix(loColour, hiColour, t);
  }
  return stops[stops.length - 1][1];
}

function channel(hex: string, at: number): number {
  return parseInt(hex.slice(at, at + 2), 16);
}

/** sRGB mix. Good enough between adjacent stops on a ramp built for it. */
function mix(a: string, b: string, t: number): string {
  if (!a.startsWith('#') || !b.startsWith('#')) return t < 0.5 ? a : b;
  const r = Math.round(channel(a, 1) + (channel(b, 1) - channel(a, 1)) * t);
  const g = Math.round(channel(a, 3) + (channel(b, 3) - channel(a, 3)) * t);
  const bl = Math.round(channel(a, 5) + (channel(b, 5) - channel(a, 5)) * t);
  return `#${[r, g, bl].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/* ------------------------------------------------------------------ */
/* Sampling                                                            */
/* ------------------------------------------------------------------ */

export type Bounds = { west: number; south: number; east: number; north: number };

/**
 * The sampling cap.
 *
 * Every coordinate in a batched request counts separately against the
 * upstream budget, so this number IS the request's cost. It was 144, which
 * cost about 144 of the 600 calls a minute the free tier allows — six map
 * interactions and the map started answering 429, which is exactly what
 * production did.
 */
export const MAX_SAMPLES = 96;

/**
 * The ladder of lattice steps, in degrees.
 *
 * A fixed ladder rather than a step computed from the viewport, because two
 * requests can only share a cached grid if they land on the SAME lattice. A
 * computed step gives every pan its own spacing and therefore its own
 * upstream call.
 */
const STEPS = [
  0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 10, 15, 20, 30,
  // The coarse end exists for a viewport zoomed out past India. Without it
  // the ladder ran out, the grid came back empty, and a reader who pinched
  // out too far got a map with no weather on it and no reason given.
  45, 60, 90,
];

/** A viewport snapped outward onto one of those steps. */
export type Lattice = Bounds & { step: number };

/**
 * Snap a viewport outward onto the finest lattice whose points fit the cap.
 *
 * WHY SNAP AT ALL. Sampling relative to the raw bounds gave every pan a fresh
 * set of coordinates: a new upstream request, a new cache key, and a field
 * that shimmered because each sample sat somewhere slightly different from
 * the last frame. On a fixed lattice, panning inside one cell returns the
 * identical points, which the cache then serves for nothing, and the field
 * stays still under the reader because the samples are at world positions
 * rather than at screen ones.
 *
 * WHY OUTWARD. The overlay interpolates between samples and paints to the
 * edge of the canvas. Snapping inward would leave the edge with nothing to
 * interpolate from; snapping outward gives it one step of margin. The samples
 * therefore sit within one step of the viewport rather than strictly inside
 * it, which is a bounded and deliberate change from the earlier rule.
 */
export function snapToLattice(bounds: Bounds, maxPoints = MAX_SAMPLES): Lattice | null {
  const width = Math.abs(bounds.east - bounds.west);
  const height = Math.abs(bounds.north - bounds.south);
  if (width === 0 || height === 0) return null;

  for (const step of STEPS) {
    /*
     * The step is chosen from the viewport's SIZE, never from the snapped
     * extent. Snapping outward adds up to one cell on each side, so an extent
     * grows and shrinks as the viewport slides across lattice lines — and
     * choosing on it meant a pan could push the count past the cap and drop
     * the whole map to a coarser spacing mid-drag. Width and height do not
     * change when you pan, so this choice does not either.
     */
    const worstCols = Math.floor(width / step) + 3;
    const worstRows = Math.floor(height / step) + 3;
    if (worstCols * worstRows > maxPoints) continue;

    const west = Math.floor(bounds.west / step) * step;
    const east = Math.ceil(bounds.east / step) * step;
    const south = Math.floor(bounds.south / step) * step;
    const north = Math.ceil(bounds.north / step) * step;

    return { step, west, south, east, north };
  }

  return null;
}

/**
 * The points of a snapped lattice.
 *
 * Computed by index rather than by accumulating the step, because repeated
 * addition drifts and a drifting lattice is not a lattice — two requests that
 * should share a tile would round to different coordinates.
 */
export function latticePoints(lattice: Lattice): { lat: number; lon: number }[] {
  const { step, west, south, east, north } = lattice;
  const cols = Math.round((east - west) / step) + 1;
  const rows = Math.round((north - south) / step) + 1;

  const points: { lat: number; lon: number }[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      points.push({
        lat: Number((south + r * step).toFixed(4)),
        lon: Number((west + c * step).toFixed(4)),
      });
    }
  }
  return points;
}

/**
 * A grid of sample points covering the viewport.
 *
 * VIEWPORT-BOUNDED AND CAPPED, which is the whole performance story. A map of
 * India at country zoom has no business requesting ten thousand points, and a
 * layer that creates a DOM element per sample is a layer that freezes the
 * tab — these coordinates feed ONE canvas, not `n` markers.
 *
 * The cap is on the total, not the spacing, so zooming out samples more
 * coarsely rather than asking for more.
 */
export function sampleGrid(bounds: Bounds, maxPoints = MAX_SAMPLES): { lat: number; lon: number }[] {
  const lattice = snapToLattice(bounds, maxPoints);
  return lattice ? latticePoints(lattice) : [];
}
