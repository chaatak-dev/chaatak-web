/**
 * The language preference rules.
 *
 * The property worth the most here is the one that is invisible when it
 * works: the three preferences are independent. Every test that changes one
 * and asserts another is unmoved is guarding against the state this replaced,
 * where choosing a voice quietly decided everything else.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  alertLanguage,
  autoDetectable,
  DEFAULT_PREFERENCES,
  detectUiLanguage,
  readPreference,
  readPreferences,
  resolveLanguages,
  type LanguagePreferences,
} from './preferences';

const prefs = (over: Partial<LanguagePreferences> = {}): LanguagePreferences => ({
  ...DEFAULT_PREFERENCES,
  ...over,
});

/* ---- detection --------------------------------------------------- */

test('a Hindi device gets a Hindi interface', () => {
  assert.equal(detectUiLanguage(['hi-IN', 'en-US']), 'hi');
  assert.equal(detectUiLanguage(['hi']), 'hi');
  assert.equal(detectUiLanguage(['hi-Latn-IN']), 'hi');
});

test('every other device gets English', () => {
  assert.equal(detectUiLanguage(['en-GB']), 'en');
  assert.equal(detectUiLanguage(['fr-FR', 'de-DE']), 'en');
  assert.equal(detectUiLanguage([]), 'en');
  assert.equal(detectUiLanguage(undefined), 'en');
});

/*
 * The ORDER is the person's ranking, and reading only the first entry would
 * answer one of these correctly and the other wrongly.
 */
test('the ordered list is honoured, not just its first entry', () => {
  assert.equal(detectUiLanguage(['en-GB', 'hi-IN']), 'en');
  assert.equal(detectUiLanguage(['hi-IN', 'en-GB']), 'hi');
  // A language with no interface yet is skipped rather than landed on.
  assert.equal(detectUiLanguage(['ta-IN', 'hi-IN']), 'hi');
  assert.equal(detectUiLanguage(['ta-IN']), 'en');
});

test('detection lands only on languages whose interface exists', () => {
  const detectable = autoDetectable();
  assert.deepEqual([...detectable].sort(), ['en', 'hi']);

  // The five speech-only languages must not be auto-detected yet: telling
  // someone the app is in their language and then showing English is worse
  // than not detecting at all.
  for (const code of ['gu', 'mr', 'bn', 'ta', 'pa']) {
    assert.equal(detectUiLanguage([`${code}-IN`]), 'en', code);
  }
});

/* ---- explicit beats automatic ------------------------------------ */

test('an explicit choice is never overridden by the device', () => {
  const chosen = resolveLanguages(prefs({ ui: 'en' }), ['hi-IN']);
  assert.equal(chosen.ui, 'en');

  const other = resolveLanguages(prefs({ ui: 'hi' }), ['fr-FR', 'en-US']);
  assert.equal(other.ui, 'hi');
});

test('auto follows the device again once it is chosen back', () => {
  assert.equal(resolveLanguages(prefs({ ui: 'auto' }), ['hi-IN']).ui, 'hi');
  assert.equal(resolveLanguages(prefs({ ui: 'auto' }), ['en-US']).ui, 'en');
});

/* ---- independence ------------------------------------------------- */

test('the interface and the assistant can differ', () => {
  const resolved = resolveLanguages(
    prefs({ ui: 'en', assistant: 'hi' }),
    ['en-US'],
  );
  assert.equal(resolved.ui, 'en');
  assert.equal(resolved.assistant, 'hi');
});

test('the interface and the voice can differ', () => {
  const resolved = resolveLanguages(prefs({ ui: 'en', voice: 'ta' }), ['en-US']);
  assert.equal(resolved.ui, 'en');
  assert.equal(resolved.voice, 'ta');
});

test('the configuration from the brief is expressible', () => {
  // UI = English, Assistant = Hindi, Voice = Hindi.
  const resolved = resolveLanguages(
    prefs({ ui: 'en', assistant: 'hi', voice: 'hi' }),
    ['en-US'],
  );
  assert.equal(resolved.ui, 'en');
  assert.equal(resolved.assistant, 'hi');
  assert.equal(resolved.voice, 'hi');
});

/*
 * Changing one must not move another. This is the whole reason the three
 * exist, so it is asserted directly rather than implied by the cases above.
 */
test('choosing a voice moves neither the interface nor the assistant', () => {
  const before = resolveLanguages(prefs({ ui: 'en' }), ['en-US']);
  const after = resolveLanguages(prefs({ ui: 'en', voice: 'ta' }), ['en-US']);

  assert.equal(after.ui, before.ui);
  assert.equal(after.assistant, before.assistant);
  assert.equal(after.voice, 'ta');
});

test('choosing an interface moves neither the assistant nor an explicit voice', () => {
  const after = resolveLanguages(
    prefs({ ui: 'hi', assistant: 'en', voice: 'ta' }),
    ['en-US'],
  );

  assert.equal(after.ui, 'hi');
  assert.equal(after.assistant, 'en');
  assert.equal(after.voice, 'ta');
});

/* ---- what auto means for each ------------------------------------- */

test('an assistant left on auto stays auto — it is decided per turn', () => {
  // Resolving it to a language here would be the bug: "mirror the user" can
  // only be answered by looking at the question.
  assert.equal(resolveLanguages(prefs(), ['hi-IN']).assistant, 'auto');
});

test('a voice on auto follows the assistant, then the interface', () => {
  // Nothing else chosen: the interface, which is the device here.
  assert.equal(resolveLanguages(prefs(), ['hi-IN']).voice, 'hi');
  assert.equal(resolveLanguages(prefs(), ['en-US']).voice, 'en');

  // An explicit assistant is the better guide when there is one.
  assert.equal(
    resolveLanguages(prefs({ ui: 'en', assistant: 'ta' }), ['en-US']).voice,
    'ta',
  );

  // An explicit interface, with the assistant left alone.
  assert.equal(resolveLanguages(prefs({ ui: 'gu' }), ['en-US']).voice, 'gu');
});

/* ---- borrowing ----------------------------------------------------- */

test('a language with no chrome borrows one, and says so', () => {
  const resolved = resolveLanguages(prefs({ ui: 'gu' }), ['en-US']);

  assert.equal(resolved.uiChoice, 'gu');
  assert.equal(resolved.ui, 'en', 'Gujarati chrome does not exist yet');
  assert.equal(resolved.uiIsBorrowed, true);
  // The choice still drives speech, which does exist in Gujarati.
  assert.equal(resolved.voice, 'gu');
});

test('Marathi borrows Hindi rather than English, because it reads Devanagari', () => {
  const resolved = resolveLanguages(prefs({ ui: 'mr' }), ['en-US']);
  assert.equal(resolved.ui, 'hi');
  assert.equal(resolved.uiIsBorrowed, true);
});

test('a language with its own chrome is not borrowing', () => {
  assert.equal(resolveLanguages(prefs({ ui: 'hi' }), ['en-US']).uiIsBorrowed, false);
  assert.equal(resolveLanguages(prefs({ ui: 'en' }), ['hi-IN']).uiIsBorrowed, false);
});

/* ---- alerts -------------------------------------------------------- */

test('an alert is written in the interface language', () => {
  assert.equal(alertLanguage(resolveLanguages(prefs({ ui: 'hi' }), [])), 'hi');
  assert.equal(alertLanguage(resolveLanguages(prefs({ ui: 'en' }), [])), 'en');
});

test('an alert never asks for a template that does not exist', () => {
  // Every one of the seven, including the five with no taxonomy, must land on
  // a language the catalogue actually holds.
  for (const code of ['hi', 'en', 'gu', 'mr', 'bn', 'ta', 'pa'] as const) {
    const lang = alertLanguage(resolveLanguages(prefs({ ui: code }), []));
    assert.ok(lang === 'hi' || lang === 'en', `${code} resolved to ${lang}`);
  }
});

/* ---- reading stored values ----------------------------------------- */

test('a stored value is read, and a broken one falls back rather than throwing', () => {
  assert.equal(readPreference('hi'), 'hi');
  assert.equal(readPreference('auto'), 'auto');
  assert.equal(readPreference('klingon'), 'auto');
  assert.equal(readPreference(undefined), 'auto');
  assert.equal(readPreference(42), 'auto');
});

test('a partial or malformed preference object still yields three answers', () => {
  assert.deepEqual(readPreferences({ ui: 'hi' }), {
    ui: 'hi',
    assistant: 'auto',
    voice: 'auto',
  });
  assert.deepEqual(readPreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(readPreferences('nonsense'), DEFAULT_PREFERENCES);
  assert.deepEqual(readPreferences({ ui: 'xx', assistant: 'ta', voice: 9 }), {
    ui: 'auto',
    assistant: 'ta',
    voice: 'auto',
  });
});

test('everything starts on auto', () => {
  assert.deepEqual(DEFAULT_PREFERENCES, {
    ui: 'auto',
    assistant: 'auto',
    voice: 'auto',
  });
});
