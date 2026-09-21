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

/* ------------------------------------------------------------------ */
/* Regressions: a place is claimed on evidence, never by elimination    */
/* ------------------------------------------------------------------ */

test('a verb left standing is never mistaken for a place', async () => {
  // This one shipped. "क्या आज घर से निकलूँ?" left निकलूँ — a verb — as the
  // longest leftover, the geocoder matched it to somewhere in Nepal, and the
  // user got a confident answer about the wrong country. Same failure class
  // as the transliteration trials, through a different door.
  assert.equal(extractPlace('क्या आज घर से निकलूँ'), null);
  assert.equal(await patternParser.parse('क्या आज घर से निकलूँ', HI), null);
});

test('an advisory question is not mined for a place name', async () => {
  // "क्रिकेट खेल सकता हूँ" is not a village.
  assert.equal(extractPlace('क्या मैं आज क्रिकेट खेल सकता हूँ'), null);
});

test('a contextual follow-up defers instead of inventing a place', async () => {
  // "और अगले दिन?" carries no place and a relative time this layer cannot
  // resolve, so it belongs to the layer that can.
  assert.equal(await patternParser.parse('और अगले दिन', HI), null);
});

test('a locative particle is what marks a place', async () => {
  assert.equal(extractPlace('बाराबंकी में कल बारिश होगी'), 'बाराबंकी');
  assert.equal(extractPlace('मुंबई का मौसम'), 'मुंबई');
  assert.equal(extractPlace('weather in Ghaziabad'), 'Ghaziabad');
});

test('a recognised name is claimed even without a locative', async () => {
  // The gazetteer's second job: telling a place from a verb when position
  // gives no hint at all.
  assert.equal(extractPlace('अभी जयपुर'), 'जयपुर');
});

test('a locative alone does not make a sentence about weather', async () => {
  // "Python में list कैसे sort करें?" has a perfectly good में. Claiming
  // Python as a place here meant the scope check never ran and Chaatak
  // answered a coding question — with an Australian timezone attached.
  assert.equal(await patternParser.parse('Python में list कैसे sort करें', HI), null);
});

test('a keyword immediately before a particle is not a place', async () => {
  // "ऑरेंज अलर्ट का मतलब" — अलर्ट sits right before का, so there is no place
  // here at all. Reaching past it to ऑरेंज sent a definition question off to
  // fetch a forecast.
  assert.equal(extractPlace('ऑरेंज अलर्ट का मतलब क्या है'), null);
});

test('an unevidenced leftover always defers — it is never guessed at', async () => {
  /*
   * The general shape, not the specific bug.
   *
   * Place resolution is the soft spot in this system and it has bitten twice
   * now: once transliterating जयपुर into Jayapura, Indonesia, and once letting
   * the verb निकलूँ stand as a place and reporting Nepal's weather. Both times
   * the failure was silent and confident, which is the worst combination.
   *
   * So the invariant is a shape, not a list: a token with no positive
   * evidence behind it — no locative particle, not the whole message, not a
   * recognised name — must defer to a layer that can judge. Never guess.
   */
  const unevidenced = [
    'क्या आज घर से निकलूँ',       // verb
    'क्या मैं आज क्रिकेट खेल सकता हूँ', // activity
    'आज दवा छिड़कनी चाहिए',        // verb phrase
    'और अगले दिन',                 // relative time
    'क्या आज छत पर कपड़े सुखाऊँ',   // verb phrase
    'kal match dekh sakta hoon',   // Hinglish activity
  ];

  for (const text of unevidenced) {
    assert.equal(
      extractPlace(text),
      null,
      `must not claim a place from: ${text}`,
    );
    assert.equal(
      await patternParser.parse(text, HI),
      null,
      `must defer rather than answer: ${text}`,
    );
  }
});

test('evidence, when present, is still honoured', async () => {
  // The counterweight: deferring everything would be its own failure.
  assert.equal(extractPlace('बाराबंकी में बारिश'), 'बाराबंकी');
  assert.equal(extractPlace('बाराबंकी'), 'बाराबंकी');
  assert.equal(extractPlace('अभी मुंबई'), 'मुंबई');
});

/* ------------------------------------------------------------------ */
/* The contract /api/chat relies on to keep placeless questions off a   */
/* model                                                               */
/*                                                                     */
/* `noPlace` means ONE thing: this is a weather question and it names   */
/* no place. The chat route reads it that way — it answers "which       */
/* place?" or uses the device's location, and spends no model call      */
/* doing it. If that meaning ever widens, these fail rather than the    */
/* route quietly asking a coding question where it is.                  */
/* ------------------------------------------------------------------ */

test('the common placeless questions resolve to noPlace, not to the model', async () => {
  for (const text of [
    'temperature',
    'will it rain?',
    'weather tomorrow',
    'aaj ka mausam',
    'आज का मौसम',
    'कल बारिश होगी?',
    'कोई चेतावनी है?',
  ]) {
    const r = await patternParser.parse(text, HI);
    assert.ok(r, `${text}: fell through to the model`);
    assert.equal(r.kind, 'cannotParse', `${text}: expected cannotParse`);
    if (r.kind !== 'cannotParse') return;
    assert.equal(r.reason, 'noPlace', `${text}: expected noPlace`);
    assert.equal(r.servedBy, 'pattern');
  }
});

test('a sentence with no weather word in it is NOT claimed as noPlace', async () => {
  // The route treats noPlace as "a weather question missing its place", so
  // anything the pattern layer is unsure about has to keep coming back as
  // null — that is what routes it to the scope check instead.
  for (const text of [
    'should I spray my crops this evening',
    'मुझे अपनी फसल पर दवा छिड़कनी चाहिए',
  ]) {
    assert.equal(await patternParser.parse(text, HI), null, text);
  }
});

test('a remembered place means a full query, never noPlace', async () => {
  // The same questions, once the conversation has somewhere to be about.
  for (const text of ['temperature', 'weather tomorrow', 'आज का मौसम']) {
    const q = await parsed(text, { lang: 'hi', lastPlace: 'बाराबंकी' });
    assert.equal(q.place, 'बाराबंकी');
    assert.equal(q.placeWasImplied, true);
    assert.equal(q.servedBy, 'pattern');
  }
});

test('the time window survives a placeless question once a place is supplied', async () => {
  // How "weather tomorrow" keeps its tomorrow after the browser answers with
  // a coordinate: the route re-parses with the resolved name as the
  // remembered place, and the day has to come back with it.
  const q = await parsed('weather tomorrow', { lang: 'en', lastPlace: 'Ghaziabad' });
  assert.equal(q.timeWindow.kind, 'day');
  if (q.timeWindow.kind !== 'day') return;
  assert.equal(q.timeWindow.offset, 1);

  const rain = await parsed('कल बारिश होगी?', { lang: 'hi', lastPlace: 'बाराबंकी' });
  assert.equal(rain.variable, 'rain');
  assert.equal(rain.timeWindow.kind, 'day');
});
