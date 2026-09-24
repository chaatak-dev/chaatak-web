/**
 * "Weather near me" must never become a place called Near.
 *
 * The regression is specific and worth naming: the place extractor claims the
 * word immediately before a locative particle, and the Hinglish particle
 * "me" is also the English pronoun. So "near me" handed "near" to a geocoder.
 * These assertions cover the phrasings people actually use, in both scripts,
 * and the negative cases that must keep resolving to a real place.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { LOCATION_FILLER, wantsCurrentLocation } from './location-intent';
import { extractPlace, patternParser, placeEvidence } from './patterns';

const EN = { lang: 'en' as const };

async function mode(text: string, lastPlace?: string) {
  const result = await patternParser.parse(text, { lang: 'en', lastPlace });
  if (result === null) return 'defers';
  if (result.kind === 'currentLocation') return 'current';
  if (result.kind === 'cannotParse') return `cannotParse:${result.reason}`;
  return `named:${result.place}`;
}

/* ---- the phrasings from the brief ---------------------------------- */

test('every way of asking about here resolves to current-location intent', async () => {
  for (const text of [
    'weather near me',
    'weather around me',
    'weather here',
    "what's the weather here",
    'weather where I am',
    'mere area ka mausam',
    'yahan ka mausam',
    'मेरे पास का मौसम',
    'यहाँ का मौसम',
    'nearby weather',
    'is it raining near me',
    'any warnings near me',
    'my area temperature',
  ]) {
    assert.equal(await mode(text), 'current', text);
  }
});

/*
 * The exact failure. "near" sat before the Hinglish locative "me" and was
 * claimed, geocoded and answered about.
 */
test('no filler word is ever extracted as a place name', async () => {
  for (const text of [
    'weather near me',
    'weather around me',
    'weather here',
    'yahan ka mausam',
    'mere area ka mausam',
    'यहाँ का मौसम',
  ]) {
    assert.equal(extractPlace(text), null, `${text} produced a place`);
  }
});

test('"near" specifically is never a place', () => {
  assert.equal(extractPlace('weather near me'), null);
  assert.notEqual(extractPlace('weather near me'), 'near');
});

/* ---- current beats the conversation -------------------------------- */

test('asking about here overrides the place carried from earlier turns', async () => {
  // Someone who asked about Delhi and then asks what it is like near them is
  // asking about near them. Inheriting Delhi would answer confidently and
  // wrongly.
  assert.equal(await mode('weather near me', 'Delhi'), 'current');
  assert.equal(await mode('yahan ka mausam', 'बाराबंकी'), 'current');

  // Whereas a question with no place and no marker still inherits.
  assert.equal(await mode('temperature', 'Delhi'), 'named:Delhi');
});

/* ---- a named place still wins -------------------------------------- */

test('a sentence that names a place is a named-place question', async () => {
  assert.equal(await mode('weather in Delhi'), 'named:Delhi');
  assert.equal(await mode('Barabanki mein mausam'), 'named:Barabanki');
  assert.equal(await mode('बाराबंकी में कल बारिश होगी?'), 'named:बाराबंकी');
});

test('a place named alongside "here" is still the named place', async () => {
  // "weather here in Barabanki" is about Barabanki. The marker is present but
  // the sentence went on to say where.
  assert.equal(await mode('weather here in Barabanki'), 'named:Barabanki');
});

/* ---- the negatives -------------------------------------------------- */

test('a question with no place and no marker is not a current-location question', async () => {
  // It inherits, or it asks. It does not silently become "here".
  assert.equal(await mode('temperature'), 'cannotParse:noPlace');
  assert.equal(await mode('weather tomorrow'), 'cannotParse:noPlace');
});

test('a non-weather sentence is not claimed, marker or not', async () => {
  // "where am I" has the marker and no weather word. The weather parser has
  // no business answering it.
  assert.equal(await mode('where am I'), 'defers');
  // The standing regression: a verb must never be read as a place.
  assert.equal(await mode('क्या आज घर से निकलूँ?'), 'defers');
});

test('the detector needs a whole phrase, not a word inside another', () => {
  assert.equal(wantsCurrentLocation('weather near me'), true);
  assert.equal(wantsCurrentLocation('weather in Nearabad'), false);
  assert.equal(wantsCurrentLocation('mausam'), false);
  assert.equal(wantsCurrentLocation(''), false);
  // "here" inside another word is not the word "here".
  assert.equal(wantsCurrentLocation('weather in Cherrapunji'), false);
});

/* ---- the fixes that came before this one must still hold ------------ */

test('typo repair and the admin-hierarchy fix are untouched', async () => {
  // Barabanki is the regression this codebase was rebuilt around: a general
  // geocoder returned a hamlet in Odisha for it. The gazetteer answers now,
  // and the filler mask must not have disturbed that.
  assert.equal(await mode('Barabanki'), 'named:Barabanki');
  assert.equal(await mode('बाराबंकी'), 'named:बाराबंकी');
  assert.equal(await mode('Ghaziabad mein mausam'), 'named:Ghaziabad');

  // A misspelling inside a sentence is not repaired HERE: fuzzy repair in a
  // sentence is how "mandir" (a temple) would become Mandi district. It is
  // passed on verbatim, to the classifier and then the resolver, which does
  // repair it.
  assert.deepEqual(placeEvidence('Kolkatta mein mausam'), { kind: 'unsure', candidate: 'Kolkatta' });
  assert.deepEqual(placeEvidence('Jaypur ka mausam'), { kind: 'unsure', candidate: 'Jaypur' });
  assert.deepEqual(placeEvidence('mandir mein barish hogi'), { kind: 'unsure', candidate: 'mandir' });
});

test('no filler entry collides with a real place name', () => {
  // Every masked word must be one that is never an Indian place on its own.
  // "Pune" would be a catastrophe here; "near" is not.
  for (const word of LOCATION_FILLER) {
    assert.ok(word.length > 0);
    assert.equal(
      extractPlace(word),
      null,
      `${word} is masked but resolves as a place on its own`,
    );
  }
});

void EN;
