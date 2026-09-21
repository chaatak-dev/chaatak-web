import { test } from 'node:test';
import assert from 'node:assert/strict';

import { editDistance, matchPlace } from './match';
import { index } from './index';

/**
 * The matcher's job is deciding when NOT to answer.
 *
 * Every test below is either "this correction is safe" or "this one is not".
 * The second kind matters more: returning the wrong district in a warning
 * system is the failure the whole design is arranged around.
 */

function resolved(query: string): string | null {
  return matchPlace(query)?.entry.name ?? null;
}

/* ---- exact, in every script we accept -------------------------------- */

test('a correctly spelled place resolves in any of the seven scripts', () => {
  const cases: [string, string][] = [
    ['Barabanki', 'Barabanki'],
    ['बाराबंकी', 'Barabanki'],
    ['Kolkata', 'Kolkata'],
    ['কলকাতা', 'Kolkata'],
    ['Chennai', 'Chennai'],
    ['சென்னை', 'Chennai'],
    ['Ahmedabad', 'Ahmedabad'],
    ['અમદાવાદ', 'Ahmedabad'],
    ['Amritsar', 'Amritsar'],
    ['ਅੰਮ੍ਰਿਤਸਰ', 'Amritsar'],
    ['Pune', 'Pune'],
    ['पुणे', 'Pune'],
  ];
  for (const [query, want] of cases) {
    assert.equal(resolved(query), want, query);
  }
});

test('the Latin and the Devanagari spelling land on the same point', () => {
  // The bug that started this: which language you typed in decided which
  // place on earth you got.
  const latin = matchPlace('Barabanki');
  const deva = matchPlace('बाराबंकी');
  assert.ok(latin && deva);
  assert.equal(latin.entry.id, deva.entry.id);
  assert.equal(latin.entry.state, 'Uttar Pradesh');
});

test('a place answers to its own name before any alias', () => {
  // "Mumbai" is both a city and part of the name of Mumbai City district.
  // The person typed the city.
  assert.equal(resolved('Mumbai'), 'Mumbai');
});

test('renamed cities answer to both names', () => {
  // Nobody stops typing the old name the year a city changes it.
  assert.equal(resolved('Bombay'), 'Mumbai');
  assert.equal(resolved('Bangalore'), 'Bengaluru');
  assert.equal(resolved('Allahabad'), 'Prayagraj');
  assert.equal(resolved('Trivandrum'), 'Thiruvananthapuram');
});

/* ---- misspellings ----------------------------------------------------- */

test('a misspelling is repaired to the place that was meant', () => {
  const cases: [string, string][] = [
    ['Nenital', 'Nainital'],
    ['Kolkatta', 'Kolkata'],
    ['Kolkota', 'Kolkata'],
    ['Chenai', 'Chennai'],
    ['Ghazibad', 'Ghaziabad'],
    ['Gaziabad', 'Ghaziabad'],
    ['Lucknoww', 'Lucknow'],
    ['Koimbatore', 'Coimbatore'],
    ['Amretsar', 'Amritsar'],
    ['Nagpurr', 'Nagpur'],
    ['Bhopaal', 'Bhopal'],
  ];
  for (const [query, want] of cases) {
    assert.equal(resolved(query), want, query);
  }
});

test('a transposition costs one edit, because that is how people mistype', () => {
  assert.equal(editDistance('chennia', 'chennai', 2), 1);
});

/* ---- Hinglish --------------------------------------------------------- */

test('a romanised Hindi spelling resolves, though it is neither name', () => {
  // "Dilli" is not the English name and not the Devanagari one, and no edit
  // distance from "Delhi" reaches it without matching half the country.
  assert.equal(resolved('Dilli'), 'Delhi');
  assert.equal(resolved('Lakhnau'), 'Lucknow');
});

/* ---- the refusals, which matter most ---------------------------------- */

test('a place outside India never resolves to one inside it', () => {
  // Each of these sits within edit distance of a real Indian district, and
  // answering for any of them would be the wrong-place failure exactly.
  for (const q of [
    'London', 'Paris', 'Tokyo', 'Berlin', 'Moscow', 'Cairo', 'Dubai', 'Sydney',
    'Karachi', 'Lahore', 'Dhaka', 'Kathmandu', 'Colombo', 'Shanghai',
  ]) {
    assert.equal(matchPlace(q), null, q);
  }
});

test('an ambiguous correction is refused rather than guessed', () => {
  // "Jaypur" is one edit from Jaipur in Rajasthan and one from Jajpur in
  // Odisha, 1,500km apart. There is no right answer to pick, so there is no
  // answer. An honest no-data state beats a coin flip between two districts.
  assert.equal(matchPlace('Jaypur'), null);
});

test('words that are not places do not become places', () => {
  for (const q of [
    'weather', 'mausam', 'barish', 'forecast', 'temperature', 'tomorrow',
    'hello', 'cricket', 'कल', 'मौसम', 'बारिश', 'तापमान',
  ]) {
    assert.equal(matchPlace(q), null, q);
  }
});

test('noise resolves to nothing', () => {
  for (const q of ['asdfghjkl', 'qwerty', 'zzzz', '1234', 'xyz', '', '   ', '!!!']) {
    assert.equal(matchPlace(q), null, q);
  }
});

test('a short name gets no spelling latitude at all', () => {
  // At four characters one edit reaches several real districts, so a typo and
  // a different place are indistinguishable. Only exact matches are accepted.
  const short = matchPlace('Bid');
  assert.ok(short === null || short.how === 'exact');
});

test('scripts are never matched across', () => {
  // Devanagari and Latin share no characters, so every cross-script pair
  // scores the same maximum and the "nearest" match would be whichever name
  // happened to be shortest.
  assert.equal(matchPlace('कखगघङच'), null);
});

/* ---- every answer is warnable ----------------------------------------- */

test('every resolved place carries the district it would be warned on', () => {
  for (const q of ['Mumbai', 'Nenital', 'Dilli', 'Barabanki', 'Kolkatta', 'Bengaluru']) {
    const m = matchPlace(q);
    assert.ok(m, q);
    assert.ok(m.entry.district, `${q} has no district`);
    assert.ok(m.entry.state, `${q} has no state`);
  }
});

/* ---- bounded distance ------------------------------------------------- */

test('editDistance gives up rather than scoring a hopeless pair', () => {
  assert.equal(editDistance('abc', 'abc', 2), 0);
  assert.equal(editDistance('abc', 'abd', 2), 1);
  assert.ok(editDistance('abc', 'zzzzzzzz', 2) > 2);
});

/* ---- the data itself -------------------------------------------------- */

test('the gazetteer holds only usable, warnable places', () => {
  const { entries } = index();
  assert.ok(entries.length > 2000, `only ${entries.length} entries`);

  for (const e of entries) {
    assert.ok(Number.isFinite(e.latitude) && Number.isFinite(e.longitude), e.name);
    // India's bounding box. A place outside it cannot be warned on by IMD and
    // has no business in an Indian gazetteer.
    assert.ok(e.latitude > 6 && e.latitude < 38, `${e.name} latitude ${e.latitude}`);
    assert.ok(e.longitude > 68 && e.longitude < 98, `${e.name} longitude ${e.longitude}`);
    assert.ok(e.name.trim().length > 0);
    assert.ok(e.id.startsWith('Q'), e.id);
  }
});

test('no entry points at a district that is not in the set', () => {
  // A settlement inheriting a dissolved district leaves a reference to a unit
  // nobody can be warned about. Bhopal State (1949-1956) was exactly that.
  const { entries } = index();
  const districts = new Set(entries.filter((e) => e.kind === 'district').map((e) => e.name));
  for (const e of entries) {
    if (e.district) assert.ok(districts.has(e.district), `${e.name} -> ${e.district}`);
  }
});

test('the set covers India at roughly the right scale', () => {
  const { entries } = index();
  const districts = entries.filter((e) => e.kind === 'district').length;
  // India has a little over 700 districts; a set far from that has either
  // lost data or picked up something that is not a district.
  assert.ok(districts > 600 && districts < 900, `${districts} districts`);
  const states = new Set(entries.map((e) => e.state).filter(Boolean));
  assert.ok(states.size >= 28, `only ${states.size} states`);
});
