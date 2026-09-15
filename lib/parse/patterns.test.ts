import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractPlace, patternParser } from './patterns';
import type { ParseContext, ParsedQuery } from './types';

const HI: ParseContext = { lang: 'hi' };

async function parsed(text: string, ctx: ParseContext = HI): Promise<ParsedQuery> {
  const r = await patternParser.parse(text, ctx);
  assert.ok(r, `expected a result for: ${text}`);
  assert.equal(r.kind, 'query', `expected a query for: ${text}`);
  return r as ParsedQuery;
}

/**
 * The pattern layer is what keeps a provider off the hot path, so these cases
 * are the shapes that must NEVER reach a model — a bare place name, the
 * common Hindi and Hinglish phrasings, and the relative time words.
 */

test('a bare place name parses without a model, in either script', async () => {
  for (const [text, place] of [
    ['Ghaziabad', 'Ghaziabad'],
    ['गाज़ियाबाद', 'गाज़ियाबाद'],
    ['बाराबंकी', 'बाराबंकी'],
  ]) {
    const q = await parsed(text);
    assert.equal(q.place, place);
    assert.equal(q.servedBy, 'pattern');
    assert.equal(q.intent, 'current');
  }
});

test('"<place> mein mausam" parses in both scripts', async () => {
  const hindi = await parsed('गाज़ियाबाद में मौसम कैसा है');
  assert.equal(hindi.place, 'गाज़ियाबाद');
  assert.equal(hindi.variable, 'all');

  const hinglish = await parsed('Ghaziabad mein mausam kaisa hai');
  assert.equal(hinglish.place, 'Ghaziabad');
  assert.equal(hinglish.variable, 'all');
});

test('relative time words map to day offsets', async () => {
  assert.deepEqual((await parsed('कल गाज़ियाबाद में बारिश होगी')).timeWindow, {
    kind: 'day',
    offset: 1,
  });
  assert.deepEqual((await parsed('परसों मुंबई का मौसम')).timeWindow, {
    kind: 'day',
    offset: 2,
  });
  assert.deepEqual((await parsed('अभी जयपुर')).timeWindow, { kind: 'now' });
  assert.deepEqual((await parsed('इस हफ़्ते लखनऊ में बारिश')).timeWindow, {
    kind: 'range',
    days: 7,
  });
});

test('variable and intent are read from the question', async () => {
  assert.equal((await parsed('कल गाज़ियाबाद में बारिश होगी')).variable, 'rain');
  assert.equal((await parsed('Ghaziabad ka taapman')).variable, 'temperature');
  assert.equal((await parsed('मुंबई में चेतावनी')).intent, 'warning');
});

/* ------------------------------------------------------------------ */
/* The rule that matters most                                          */
/* ------------------------------------------------------------------ */

test('the place is a verbatim slice — never normalised or transliterated', async () => {
  // If the parser ever "helpfully" rewrote गाज़ियाबाद to Ghaziabad, it would
  // destroy the only form the Devanagari-capable geocoder can read, and the
  // query would silently resolve somewhere else or not at all.
  const q = await parsed('गाज़ियाबाद में कल बारिश होगी क्या');
  assert.equal(q.place, 'गाज़ियाबाद');

  // Casing is preserved exactly as typed, too.
  assert.equal((await parsed('ghaziabad mein mausam')).place, 'ghaziabad');
  assert.equal((await parsed('GHAZIABAD mein mausam')).place, 'GHAZIABAD');
});

test('a keyword inside a place name is not stripped', async () => {
  // "Kalyan" begins with "kal" (tomorrow) and "Kota" is not "ko" + "ta".
  // Without a proper boundary these become "yan" and "ta".
  assert.equal(extractPlace('Kalyan mein mausam'), 'Kalyan');
  assert.equal(extractPlace('Kota ka mausam'), 'Kota');
});

/* ------------------------------------------------------------------ */
/* Implied place, and refusing to guess                                */
/* ------------------------------------------------------------------ */

test('a question with no place uses the last resolved place', async () => {
  const q = await parsed('आज का मौसम', { lang: 'hi', lastPlace: 'गाज़ियाबाद' });
  assert.equal(q.place, 'गाज़ियाबाद');
  assert.equal(q.placeWasImplied, true);
});

test('no place and nothing remembered asks for one rather than guessing', async () => {
  const r = await patternParser.parse('आज का मौसम', HI);
  assert.ok(r);
  assert.equal(r.kind, 'cannotParse');
  if (r.kind !== 'cannotParse') return;
  assert.equal(r.reason, 'noPlace');
});

test('an unrecognised sentence defers to the next layer instead of guessing', async () => {
  // Returning null is how the pattern layer says "not mine". A long leftover
  // is a sentence, not a bare place name, and handing it to the geocoder as
  // one would be the pattern layer over-claiming.
  assert.equal(
    await patternParser.parse('should I spray my crops this evening', HI),
    null,
  );
  assert.equal(await patternParser.parse('मुझे अपनी फसल पर दवा छिड़कनी चाहिए', HI), null);
});

test('empty or punctuation-only input asks for a place', async () => {
  for (const text of ['', '   ', '???']) {
    const r = await patternParser.parse(text, HI);
    assert.ok(r);
    assert.equal(r.kind, 'cannotParse');
    if (r.kind !== 'cannotParse') return;
    assert.equal(r.reason, 'noPlace');
  }
});
