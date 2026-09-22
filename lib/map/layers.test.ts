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
  sampleGrid,
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

  assert.ok(wide.length <= 144, `country zoom asked for ${wide.length} points`);
  assert.ok(close.length <= 144, `village zoom asked for ${close.length} points`);
  // Zooming out samples more coarsely, not more.
  assert.ok(Math.abs(wide.length - close.length) < 40);
});

test('every sample sits inside the viewport it was asked for', () => {
  const bounds = { west: 76.5, south: 27.5, east: 78.5, north: 29.5 };
  for (const point of sampleGrid(bounds)) {
    assert.ok(point.lon >= bounds.west && point.lon <= bounds.east, `${point.lon}`);
    assert.ok(point.lat >= bounds.south && point.lat <= bounds.north, `${point.lat}`);
  }
});

test('a degenerate viewport asks for nothing at all', () => {
  assert.deepEqual(sampleGrid({ west: 77, south: 28, east: 77, north: 29 }), []);
  assert.deepEqual(sampleGrid({ west: 77, south: 28, east: 78, north: 28 }), []);
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
