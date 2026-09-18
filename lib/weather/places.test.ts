import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isDevanagari, needsIndicGeocoder } from './places';

/**
 * Every script Chaatak accepts must reach a geocoder that can read it.
 *
 * Open-Meteo returns nothing — not an error, nothing — for all five Indic
 * scripts. Verified live: અમદાવાદ, কলকাতা, சென்னை, ਅੰਮ੍ਰਿਤਸਰ and पुणे all come
 * back empty there and all resolve through Nominatim. A language added to the
 * toggle without its block added here would send that language's place names
 * to a geocoder that cannot read them, and the user would get a no-data state
 * for a city of eight million.
 */

test('every script behind a supported language routes to the Indic geocoder', () => {
  const byScript: [string, string][] = [
    ['Devanagari (hi, mr)', 'गाज़ियाबाद'],
    ['Devanagari (mr)', 'पुणे'],
    ['Bengali (bn)', 'কলকাতা'],
    ['Gurmukhi (pa)', 'ਅੰਮ੍ਰਿਤਸਰ'],
    ['Gujarati (gu)', 'અમદાવાદ'],
    ['Tamil (ta)', 'சென்னை'],
  ];

  for (const [label, place] of byScript) {
    assert.equal(needsIndicGeocoder(place), true, `${label}: ${place}`);
  }
});

test('Latin keeps using Open-Meteo', () => {
  // Nominatim has a strict usage policy; sending it everything would be both
  // rude and slower than the purpose-built geocoder for names it handles.
  for (const place of ['Ahmedabad', 'Kolkata', 'Chennai', 'Ghaziabad']) {
    assert.equal(needsIndicGeocoder(place), false, place);
  }
});

test('a mixed-script query routes to the geocoder that can read the Indic part', () => {
  // "weather in চেন্নাই" — the Latin words are irrelevant; the place name is
  // the part that has to resolve.
  assert.equal(needsIndicGeocoder('weather in চেন্নাই'), true);
});

test('the Devanagari-specific check stays narrow', () => {
  // Some callers mean Devanagari specifically, not "any Indic script".
  assert.equal(isDevanagari('पुणे'), true);
  assert.equal(isDevanagari('சென்னை'), false);
  assert.equal(isDevanagari('Ahmedabad'), false);
});
