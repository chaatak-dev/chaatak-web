import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isCorroborated, isDevanagari, needsIndicGeocoder } from './places';
import type { Location } from './types';

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

/* ------------------------------------------------------------------ */
/* Corroborating a Latin geocode                                       */
/* ------------------------------------------------------------------ */

function at(name: string, admin1?: string, admin2?: string): Location {
  return {
    name,
    admin1,
    admin2,
    country: 'India',
    countryCode: 'IN',
    latitude: 0,
    longitude: 0,
    timezone: 'Asia/Kolkata',
    resolvedBy: 'test',
    endpoint: '/test',
  };
}

test('a place that names its own district is corroborated', () => {
  // The ordinary case: the geocoder's own hierarchy backs up its answer, and
  // no second lookup is spent.
  assert.equal(isCorroborated(at('Ghaziabad', 'Uttar Pradesh', 'Ghaziabad')), true);
  assert.equal(isCorroborated(at('Pune', 'Maharashtra', 'Pune')), true);
  assert.equal(isCorroborated(at('Jaipur', 'Rajasthan', 'Jaipur district')), true);
  assert.equal(isCorroborated(at('Delhi', 'National Capital Territory of Delhi')), true);
});

test('accents, spacing and the district suffix do not break corroboration', () => {
  // Live spellings: Open-Meteo answers "Bara Banki" with "Bāra Bankī" in
  // district "Barabanki". Same place, three differences, all cosmetic.
  assert.equal(isCorroborated(at('Bāra Bankī', 'Uttar Pradesh', 'Barabanki')), true);
  assert.equal(isCorroborated(at('Karnāl', 'Haryana', 'Karnāl District')), true);
  assert.equal(isCorroborated(at('Cuttack', 'Odisha', 'Cuttack District')), true);
});

test('a same-named place in an unrelated district is NOT corroborated', () => {
  // The bug this exists for. Open-Meteo's only result for "Barabanki" is a
  // hamlet in Balangir, Odisha — roughly 900km from the Uttar Pradesh district
  // of that name, which its index does not hold under that spelling.
  assert.equal(isCorroborated(at('Barabānki', 'Odisha', 'Balangir')), false);
});

test('a result with nothing to corroborate against is treated as doubtful', () => {
  // Biased toward doubt on purpose: a second cached lookup is cheap, and the
  // alternative is shipping the wrong district under a confident provenance
  // line naming the source and issue time.
  assert.equal(isCorroborated(at('Mumbai', 'Maharashtra')), false);
  assert.equal(isCorroborated(at('Somewhere')), false);
  assert.equal(isCorroborated(at('')), false);
});
