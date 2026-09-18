import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { LanguageCode } from './languages';
import {
  LANGUAGES,
  TAXONOMY_FALLBACK,
  bcp47,
  interfaceLanguage,
  isLanguageCode,
  language,
  scriptOf,
  taxonomyIsBorrowed,
  taxonomyLanguage,
} from './languages';

/**
 * Seven languages of speech, two of taxonomy.
 *
 * The gap between those numbers is the whole point of this module. Bhashini
 * serves ASR and TTS for all seven — verified against the live pipeline, not
 * assumed — but a severity level may only be shown in a language a human
 * translated it into. Machine-translating "extremely heavy rain" produces a
 * sentence that is fluent, plausible, numerically spotless and softer than the
 * bulletin, which is the one failure the verification gate cannot see.
 */

test('every language declares a BCP-47 tag, a native label and a script', () => {
  for (const l of LANGUAGES) {
    assert.match(l.bcp47, /^[a-z]{2}-[A-Z]{2}$/, `${l.code} needs a BCP-47 tag`);
    assert.ok(l.native.length > 0, `${l.code} needs a native label`);
    assert.ok(l.english.length > 0, `${l.code} needs an English name`);
    assert.ok(l.script.length === 4, `${l.code} needs a script code`);
    // Bhashini keys on the bare language code, not the BCP-47 tag.
    assert.equal(l.bhashini, l.code);
  }
});

test('the native label is written in its own script', () => {
  // A Tamil speaker finds தமிழ், not "Tamil". The label is the only thing in
  // the picker that has to be legible to someone who reads nothing else on
  // the page.
  const expected: Record<string, string> = {
    hi: 'हिंदी',
    en: 'English',
    bn: 'বাংলা',
    mr: 'मराठी',
    ta: 'தமிழ்',
    gu: 'ગુજરાતી',
    pa: 'ਪੰਜਾਬੀ',
  };
  for (const l of LANGUAGES) assert.equal(l.native, expected[l.code]);
});

test('all seven support speech', () => {
  // Verified against the live Bhashini pipeline before this list was written.
  assert.equal(LANGUAGES.length, 7);
  for (const l of LANGUAGES) assert.equal(l.support.speech, true, l.code);
});

test('only Hindi and English carry the warning taxonomy', () => {
  const withTaxonomy = LANGUAGES.filter((l) => l.support.taxonomy).map((l) => l.code);
  assert.deepEqual(withTaxonomy.sort(), ['en', 'hi']);
});

test('a language without taxonomy borrows one, never invents one', () => {
  for (const l of LANGUAGES) {
    const source = taxonomyLanguage(l.code);
    // The borrowed language must itself be one that has a human translation,
    // or the fallback is just laundering the same problem.
    assert.equal(language(source).support.taxonomy, true, `${l.code} borrows ${source}`);
  }
  assert.equal(taxonomyLanguage('ta'), TAXONOMY_FALLBACK);
  assert.equal(taxonomyLanguage('hi'), 'hi');
});

test('borrowing is detectable so the interface can say so', () => {
  // Silently showing an English severity to a Gujarati speaker would be the
  // same class of quiet wrongness as an unlabelled stale value.
  assert.equal(taxonomyIsBorrowed('gu'), true);
  assert.equal(taxonomyIsBorrowed('hi'), false);
  assert.equal(taxonomyIsBorrowed('en'), false);
});

test('Marathi shares Devanagari, so it needs no new font', () => {
  assert.equal(scriptOf('mr'), 'Deva');
  assert.equal(scriptOf('hi'), 'Deva');
  // The other four each bring their own script, and their own font weight.
  const others: LanguageCode[] = ['gu', 'bn', 'ta', 'pa'];
  assert.deepEqual(others.map(scriptOf).sort(), ['Beng', 'Gujr', 'Guru', 'Taml']);
});

test('interface chrome falls back by script, not alphabetically', () => {
  // A Marathi reader is at home in Devanagari chrome; a Tamil reader is not.
  assert.equal(interfaceLanguage('mr'), 'hi');
  assert.equal(interfaceLanguage('ta'), 'en');
  assert.equal(interfaceLanguage('hi'), 'hi');
  assert.equal(interfaceLanguage('en'), 'en');
});

test('unknown codes are rejected rather than coerced', () => {
  assert.equal(isLanguageCode('hi'), true);
  assert.equal(isLanguageCode('ta'), true);
  assert.equal(isLanguageCode('de'), false);
  assert.equal(isLanguageCode(''), false);
  assert.equal(isLanguageCode(null), false);
});

test('BCP-47 tags are the ones the speech engines expect', () => {
  assert.equal(bcp47('hi'), 'hi-IN');
  assert.equal(bcp47('ta'), 'ta-IN');
  assert.equal(bcp47('pa'), 'pa-IN');
});
