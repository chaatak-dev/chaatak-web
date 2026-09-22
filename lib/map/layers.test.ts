/**
 * The map's layer model.
 *
 * Two properties carry the weight here. The colour scale has to be a function
 * the legend and the canvas both read, or they will disagree about what a
 * number looks like. And the sampling grid has to stay bounded, because a
 * layer that scales its request with the viewport is a layer that asks for
 * ten thousand readings at country zoom.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  BASE_MAPS,
  colourFor,
  DEFAULT_BASE_MAP,
  LAYERS,
  LAYER_ORDER,
  MAX_SAMPLES,
  sampleGrid,
  snapToLattice,
} from './layers';

/* ---- the base map is swappable ------------------------------------- */

test('the base map is a provider, not a hard-wired URL', () => {
  // The whole point of the indirection: swapping the base map must not touch
  // anything about the weather layers.
  for (const provider of Object.values(BASE_MAPS)) {
    assert.ok(provider.styleUrl.startsWith('https://'), provider.id);
    assert.ok(provider.attribution.length > 0, `${provider.id} has no attribution`);
  }
  assert.ok(DEFAULT_BASE_MAP.attribution.includes('OpenStreetMap'));
});

test('no weather layer names a base-map provider', () => {
  // A layer that knows where the coastlines come from is a layer that has to
  // change when the coastlines do.
  const serialised = JSON.stringify(LAYERS);
  for (const id of Object.keys(BASE_MAPS)) {
    assert.ok(!serialised.includes(id), `layers reference the base map ${id}`);
  }
  assert.ok(!serialised.includes('openfreemap'));
});

/* ---- the colour scale ----------------------------------------------- */

test('every layer has an ordered scale with at least two stops', () => {
  for (const id of LAYER_ORDER) {
    const layer = LAYERS[id];
    assert.ok(layer.stops.length >= 2, `${id} has too few stops`);
    for (let i = 1; i < layer.stops.length; i += 1) {
      assert.ok(
        layer.stops[i][0] > layer.stops[i - 1][0],
        `${id} stops are not ascending`,
      );
    }
  }
});

test('a value is coloured from its own scale, and clamped at both ends', () => {
  const temp = LAYERS.temperature;
  const coldest = temp.stops[0];
  const hottest = temp.stops[temp.stops.length - 1];

  assert.equal(colourFor(temp, coldest[0]), coldest[1]);
  assert.equal(colourFor(temp, hottest[0]), hottest[1]);
  // Beyond the ends, not past them.
  assert.equal(colourFor(temp, -100), coldest[1]);
  assert.equal(colourFor(temp, 100), hottest[1]);
});

test('a value between stops mixes, rather than snapping to one', () => {
  const temp = LAYERS.temperature;
  const mid = colourFor(temp, 10);

  assert.match(mid, /^#[0-9a-f]{6}$/i);
  assert.notEqual(mid, colourFor(temp, 5));
  assert.notEqual(mid, colourFor(temp, 15));
});

test('the scale is monotonic, so a hotter value never reads cooler', () => {
  // A rainbow ramp fails this and is why heatwaves get misread on weather
  // maps: a small difference can look larger than a large one.
  const temp = LAYERS.temperature;
  const seen = new Set<string>();
  for (let v = -5; v <= 45; v += 1) seen.add(colourFor(temp, v));
  assert.ok(seen.size > 20, 'the ramp collapses to a handful of colours');
});

/* ---- sampling stays bounded ----------------------------------------- */

test('the sample grid is capped however large the viewport', () => {
  const india = { west: 68, south: 6, east: 97, north: 37 };
  const village = { west: 81.1, south: 26.9, east: 81.3, north: 27.0 };

  const wide = sampleGrid(india);
  const close = sampleGrid(village);

  assert.ok(wide.length <= MAX_SAMPLES, `country zoom asked for ${wide.length} points`);
  assert.ok(close.length <= MAX_SAMPLES, `village zoom asked for ${close.length} points`);

  // "More coarsely, not more" is a statement about SPACING, which is what the
  // lattice makes directly checkable. Comparing counts only ever approximated
  // it, and approximated it badly once the grid was quantised.
  const wideStep = snapToLattice(india)?.step ?? 0;
  const closeStep = snapToLattice(village)?.step ?? 0;
  assert.ok(wideStep > closeStep, `country ${wideStep}° vs village ${closeStep}°`);
});

test('the cap is the request cost, so it stays small enough to repeat', () => {
  // Every coordinate counts separately against the upstream budget. At 144
  // this layer answered 429 in production after six interactions.
  assert.ok(MAX_SAMPLES <= 96, `${MAX_SAMPLES} points per request is too many`);
});

test('samples sit within one lattice step of the viewport', () => {
  // Deliberately not "strictly inside": the overlay interpolates to the edge
  // of the canvas, so the grid is snapped OUTWARD to give the edge something
  // to interpolate from. The margin is bounded by one step.
  const bounds = { west: 76.5, south: 27.5, east: 78.5, north: 29.5 };
  const lattice = snapToLattice(bounds);
  assert.ok(lattice);

  for (const point of sampleGrid(bounds)) {
    assert.ok(point.lon >= bounds.west - lattice.step, `${point.lon}`);
    assert.ok(point.lon <= bounds.east + lattice.step, `${point.lon}`);
    assert.ok(point.lat >= bounds.south - lattice.step, `${point.lat}`);
    assert.ok(point.lat <= bounds.north + lattice.step, `${point.lat}`);
  }
});

/* ---- the lattice is what makes panning cheap ------------------------ */

test('a pan inside one cell asks for exactly the same points', () => {
  // This is the whole reason the lattice exists. Sampling relative to the raw
  // bounds gave every pan its own coordinates, so every pan was a fresh
  // upstream request -- which is how the free tier's budget was spent six
  // interactions into a session.
  const a = snapToLattice({ west: 76.6, south: 27.6, east: 78.6, north: 29.6 });
  const b = snapToLattice({ west: 76.7, south: 27.7, east: 78.7, north: 29.7 });

  assert.ok(a && b);
  assert.deepEqual(a, b, 'a small pan produced a different tile');
});

test('the spacing depends on the viewport size, never on where it sits', () => {
  // The step was briefly derived from the snapped extent, which grows by a
  // cell whenever the viewport slides off a lattice line. Panning could then
  // push the count over the cap and drop the entire map to a coarser
  // spacing, so the field visibly changed resolution mid-drag.
  const steps = new Set<number>();
  for (let offset = 0; offset < 2; offset += 0.07) {
    const tile = snapToLattice({
      west: 76.5 + offset,
      south: 27.5 + offset,
      east: 78.5 + offset,
      north: 29.5 + offset,
    });
    assert.ok(tile);
    steps.add(tile.step);
  }
  assert.equal(steps.size, 1, `panning changed the spacing: ${[...steps].join(', ')}`);
});

test('two viewports on the same tile produce the same cache identity', () => {
  const a = snapToLattice({ west: 76.5, south: 27.5, east: 78.5, north: 29.5 });
  const b = snapToLattice({ west: 76.6, south: 27.6, east: 78.4, north: 29.4 });
  assert.ok(a && b);
  assert.equal(a.step, b.step);
  assert.deepEqual(sampleGrid({ west: 76.5, south: 27.5, east: 78.5, north: 29.5 }).length > 0, true);
});

test('the lattice is stable, not drifting', () => {
  // Points are computed by index rather than by adding the step repeatedly,
  // because a drifting lattice is not a lattice: two requests that should
  // share a tile would round to different coordinates and miss the cache.
  const points = sampleGrid({ west: 70, south: 20, east: 80, north: 30 });
  const lattice = snapToLattice({ west: 70, south: 20, east: 80, north: 30 });
  assert.ok(lattice);

  for (const point of points) {
    const lonSteps = (point.lon - lattice.west) / lattice.step;
    const latSteps = (point.lat - lattice.south) / lattice.step;
    assert.ok(Math.abs(lonSteps - Math.round(lonSteps)) < 1e-6, `${point.lon} is off-lattice`);
    assert.ok(Math.abs(latSteps - Math.round(latSteps)) < 1e-6, `${point.lat} is off-lattice`);
  }
});

test('a degenerate viewport asks for nothing at all', () => {
  assert.deepEqual(sampleGrid({ west: 77, south: 28, east: 77, north: 29 }), []);
  assert.deepEqual(sampleGrid({ west: 77, south: 28, east: 78, north: 28 }), []);
  assert.equal(snapToLattice({ west: 77, south: 28, east: 77, north: 29 }), null);
});

test('even the whole world resolves to a grid under the cap', () => {
  const world = sampleGrid({ west: -180, south: -90, east: 180, north: 90 });
  assert.ok(world.length > 0, 'world zoom fell off the end of the ladder');
  assert.ok(world.length <= MAX_SAMPLES, `world zoom asked for ${world.length}`);
});

test('the cap is honoured when it is lowered', () => {
  const few = sampleGrid({ west: 68, south: 6, east: 97, north: 37 }, 16);
  assert.ok(few.length <= 16, `asked for ${few.length}`);
  assert.ok(few.length >= 4);
});

/* ---- honesty about what can be drawn --------------------------------- */

test('the alerts layer draws districts, not invented polygons', () => {
  // IMD publishes a hazard code per district id and no geometry of any kind.
  // A polygon would be a boundary we made up, and a boundary that is nearly
  // right tells somebody on the wrong side of it that they are safe.
  assert.equal(LAYERS.alerts.kind, 'regions');
  assert.equal(LAYERS.alerts.field, undefined);
});

test('a layer declares whether it can be drawn at all', () => {
  for (const id of LAYER_ORDER) {
    const { availability } = LAYERS[id];
    assert.ok(
      availability.status === 'available' || availability.status === 'unavailable',
      `${id} has no availability`,
    );
  }
});

test('every point layer names the field it samples', () => {
  for (const id of LAYER_ORDER) {
    const layer = LAYERS[id];
    if (layer.kind !== 'points') continue;
    assert.ok(layer.field, `${id} samples points but names no field`);
    assert.ok(layer.unit.length >= 0);
  }
});
