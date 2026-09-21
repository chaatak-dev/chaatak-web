/**
 * The string catalogue.
 *
 * Mostly structural: that every key exists in every language, that nothing is
 * empty, and that no placeholder escapes to the screen. A half-translated
 * interface is the failure this file exists to make impossible, and the way
 * it happens is a key added in one language and forgotten in the other — so
 * that is what is checked, rather than the prose, which is human-written and
 * not the compiler's business.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { STRINGS, translate, translator, type StringKey } from './strings';
import { LANGUAGES } from './languages';

const KEYS = Object.keys(STRINGS) as StringKey[];
const INTERFACE_LANGS = LANGUAGES.filter((l) => l.support.interface).map(
  (l) => l.code,
) as ('hi' | 'en')[];

test('every key exists in every interface language, and none is empty', () => {
  for (const key of KEYS) {
    for (const lang of INTERFACE_LANGS) {
      const value = translate(key, lang);
      assert.equal(typeof value, 'string', `${key}.${lang}`);
      assert.ok(value.trim().length > 0, `${key}.${lang} is empty`);
    }
  }
});

test('the catalogue covers exactly the languages that declare an interface', () => {
  // If a language flips `support.interface` on without its strings, this is
  // what says so — before automatic detection starts sending people to it.
  assert.deepEqual([...INTERFACE_LANGS].sort(), ['en', 'hi']);
});

test('the two languages are genuinely different strings, not copies', () => {
  // A key whose Hindi is identical to its English is usually a forgotten
  // translation. A handful are legitimately the same — a brand name, a
  // number format — so this asserts the shape rather than demanding none.
  const identical = KEYS.filter(
    (key) => translate(key, 'hi') === translate(key, 'en'),
  );

  assert.ok(
    identical.length <= 2,
    `too many untranslated keys: ${identical.join(', ')}`,
  );
});

test('Hindi strings are written in Devanagari', () => {
  // Excluding the ones that are deliberately Latin in every language: the
  // romanised wordmark, a count, and the Google button whose branding is
  // fixed by Google rather than by us.
  const exempt = new Set<StringKey>([
    'brand.wordmark',
    'places.count',
    'account.signIn',
  ]);

  for (const key of KEYS) {
    if (exempt.has(key)) continue;
    const value = translate(key, 'hi');
    // A string of pure punctuation or placeholders has no letters to check.
    if (!/\p{L}/u.test(value.replace(/\{\w+\}/g, ''))) continue;
    assert.match(value, /[ऀ-ॿ]/u, `${key} has no Devanagari: ${value}`);
  }
});

/* ---- substitution -------------------------------------------------- */

test('a placeholder is filled in both languages', () => {
  assert.equal(
    translate('chat.using', 'en', { place: 'Ghaziabad' }),
    'Using Ghaziabad',
  );
  assert.ok(translate('chat.using', 'hi', { place: 'गाज़ियाबाद' }).includes('गाज़ियाबाद'));
});

test('no placeholder survives when its value is supplied', () => {
  for (const key of KEYS) {
    for (const lang of INTERFACE_LANGS) {
      const raw = translate(key, lang);
      const names = [...raw.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      if (names.length === 0) continue;

      const vars = Object.fromEntries(names.map((n) => [n, 'X']));
      assert.doesNotMatch(
        translate(key, lang, vars),
        /\{\w+\}/,
        `${key}.${lang} left a placeholder`,
      );
    }
  }
});

test('an unsupplied placeholder is left visible rather than blanked', () => {
  // Showing {name} is bad; showing "Hey, ." is worse, because it reads as a
  // finished sentence that happens to be wrong.
  assert.match(translate('chat.using', 'en', {}), /\{place\}/);
});

/* ---- the bound translator ------------------------------------------ */

test('a bound translator answers in its own language', () => {
  const hi = translator('hi');
  const en = translator('en');

  assert.equal(en('nav.newChat'), 'New chat');
  assert.match(hi('nav.newChat'), /[ऀ-ॿ]/);
  assert.notEqual(hi('nav.newChat'), en('nav.newChat'));
});

test('an unknown key shows itself rather than vanishing', () => {
  // A blank label is invisible in review; a key is not.
  assert.equal(translate('not.a.real.key' as StringKey, 'en'), 'not.a.real.key');
});
