/**
 * Reading a coordinate off a request.
 *
 * The cases that matter are the ones that LOOK valid: `Number('')` is 0 and
 * `Number(null)` is 0, so an empty field would otherwise arrive as a
 * perfectly well-formed point in the Gulf of Guinea and be answered with the
 * nearest place to it.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readCoords } from './coords';

test('a real coordinate reads through', () => {
  assert.deepEqual(readCoords({ latitude: 28.6692, longitude: 77.4538 }), {
    latitude: 28.6692,
    longitude: 77.4538,
  });
});

test('a numeric string is accepted, because JSON is not typed', () => {
  assert.deepEqual(readCoords({ latitude: '26.92', longitude: '81.19' }), {
    latitude: 26.92,
    longitude: 81.19,
  });
});

test('nothing at all is nothing', () => {
  assert.equal(readCoords(null), null);
  assert.equal(readCoords(undefined), null);
  assert.equal(readCoords('28,77'), null);
  assert.equal(readCoords({}), null);
});

test('an empty field is refused rather than read as zero', () => {
  assert.equal(readCoords({ latitude: '', longitude: '' }), null);
  assert.equal(readCoords({ latitude: null, longitude: null }), null);
  assert.equal(readCoords({ latitude: 28.6, longitude: null }), null);
  assert.equal(readCoords({ latitude: '   ', longitude: '77' }), null);
});

test('a value that is not a number is refused', () => {
  assert.equal(readCoords({ latitude: 'north', longitude: 'east' }), null);
  assert.equal(readCoords({ latitude: Number.NaN, longitude: 77 }), null);
  assert.equal(
    readCoords({ latitude: 28, longitude: Number.POSITIVE_INFINITY }),
    null,
  );
});

test('an out-of-range coordinate is refused', () => {
  assert.equal(readCoords({ latitude: 91, longitude: 0 }), null);
  assert.equal(readCoords({ latitude: -91, longitude: 0 }), null);
  assert.equal(readCoords({ latitude: 0, longitude: 181 }), null);
  assert.equal(readCoords({ latitude: 0, longitude: -181 }), null);
});

test('the edges of the range are inside it', () => {
  assert.deepEqual(readCoords({ latitude: 90, longitude: 180 }), {
    latitude: 90,
    longitude: 180,
  });
  assert.deepEqual(readCoords({ latitude: -90, longitude: -180 }), {
    latitude: -90,
    longitude: -180,
  });
});

/*
 * A valid point outside India is NOT refused here. Where it is matters, and
 * saying so is the resolver's job — it answers "outside India" in words
 * rather than leaving this function to pretend the coordinate was malformed.
 */
test('a valid foreign coordinate parses; the resolver decides about it', () => {
  assert.deepEqual(readCoords({ latitude: 51.5072, longitude: -0.1276 }), {
    latitude: 51.5072,
    longitude: -0.1276,
  });
});
