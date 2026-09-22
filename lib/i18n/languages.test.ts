import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LANGUAGES,
  TAXONOMY_FALLBACK,
  answerStyle,
  bcp47,
  detectScript,
  interfaceLanguage,
  isLanguageCode,
  language,
  replyLanguage,
  scriptOf,
  taxonomyIsBorrowed,
  taxonomyLanguage,
} from './languages';
import type { LanguageCode, ScriptCode } from './languages';

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

/* ------------------------------------------------------------------ */
/* Answering in the script the user wrote in                           */
/* ------------------------------------------------------------------ */

test('the reply language follows the typed script, not the toggle', () => {
  // The toggle is a VOICE choice. Letting it pick the script of written text
  // switched script on anyone whose typing disagreed with it.
  assert.equal(replyLanguage('Barabanki mein kal barish hogi?', 'hi'), 'en');
  assert.equal(replyLanguage('Will it rain in Barabanki tomorrow?', 'hi'), 'en');
  assert.equal(replyLanguage('बाराबंकी में कल बारिश होगी?', 'en'), 'hi');
});

test('an Indic script with no templates lands on English, never on Hindi', () => {
  // Gujarati has speech but no hand-translated taxonomy. English is the honest
  // floor; Devanagari would be switching one foreign script for another.
  for (const [q, code] of [
    ['અમદાવાદમાં કાલે વરસાદ પડશે?', 'gu'],
    ['কলকাতায় আগামীকাল বৃষ্টি হবে?', 'bn'],
    ['சென்னையில் நாளை மழை பெய்யுமா?', 'ta'],
    ['ਅੰਮ੍ਰਿਤਸਰ ਵਿੱਚ ਕੱਲ੍ਹ ਮੀਂਹ ਪਵੇਗਾ?', 'pa'],
  ] as const) {
    assert.equal(replyLanguage(q, code), 'en', q);
  }
});

test('Marathi is Devanagari, so it borrows the Hindi templates', () => {
  assert.equal(replyLanguage('पुण्यात उद्या पाऊस पडेल का?', 'mr'), 'hi');
});

test('text with no letters falls back to the spoken choice', () => {
  // "26?" carries no script to mirror, so the explicit choice breaks the tie.
  assert.equal(replyLanguage('26?', 'hi'), 'hi');
  assert.equal(replyLanguage('', 'ta'), 'en');
});

test('detectScript names the dominant script, not the first one seen', () => {
  assert.equal(detectScript('weather in বাংলা আবহাওয়া কেমন'), 'Beng');
  assert.equal(detectScript('Barabanki'), 'Latn');
  assert.equal(detectScript('123'), null);
});

test('the model is told a script for every language, matching the input', () => {
  const cases: [string, LanguageCode, ScriptCode][] = [
    ['बाराबंकी में कल बारिश होगी?', 'hi', 'Deva'],
    ['पुण्यात उद्या पाऊस पडेल का?', 'mr', 'Deva'],
    ['কলকাতায় আগামীকাল বৃষ্টি হবে?', 'bn', 'Beng'],
    ['અમદાવાદમાં કાલે વરસાદ પડશે?', 'gu', 'Gujr'],
    ['சென்னையில் நாளை மழை பெய்யுமா?', 'ta', 'Taml'],
    ['ਅੰਮ੍ਰਿਤਸਰ ਵਿੱਚ ਕੱਲ੍ਹ ਮੀਂਹ ਪਵੇਗਾ?', 'pa', 'Guru'],
  ];
  for (const [q, code, script] of cases) {
    assert.equal(answerStyle(q, code).script, script, q);
  }
});

test('Hinglish is told to stay in Latin, Hindi to stay in Devanagari', () => {
  const hinglish = answerStyle('Barabanki mein kal barish hogi?', 'hi');
  assert.equal(hinglish.script, 'Latn');
  assert.match(hinglish.instruction, /Hinglish/);

  const hindi = answerStyle('बाराबंकी में कल बारिश होगी?', 'hi');
  assert.equal(hindi.script, 'Deva');
});

test('an English question is not mistaken for Hinglish', () => {
  // The ambiguous overlap is what makes this fail: "me", "ka", "par" and
  // "mere" are all English words too, so none of them may be a marker.
  for (const q of [
    'Will it rain in Barabanki tomorrow?',
    'Is it safe to travel to Jaipur today?',
    'Tell me the weather, par for the course, mere minutes away',
    'What is the temperature at Pune right now?',
  ]) {
    const style = answerStyle(q, 'hi');
    assert.equal(style.code, 'en', q);
    assert.match(style.instruction, /English/);
  }
});

test('a Hinglish marker inside an English word is not a marker', () => {
  // Regression: the word boundary lost its escaping and matched substrings,
  // so "remain" (mai), "chain" (hain) and "aura" (aur) read as Hinglish.
  for (const q of [
    'Will it remain cloudy in Delhi?',
    'Is the mountain chain getting snow?',
    'Is there an aura of haze over Kanpur?',
  ]) {
    const style = answerStyle(q, 'hi');
    assert.equal(style.code, 'en', q);
    assert.match(style.instruction, /English/, q);
  }
  // …while the whole words still count.
  assert.match(answerStyle('kal barish hogi kya', 'en').instruction, /Hinglish/);
});

test('a Marathi speaker typing Devanagari is answered in Marathi, not Hindi', () => {
  assert.equal(answerStyle('पुण्यात उद्या पाऊस पडेल का?', 'mr').code, 'mr');
  assert.equal(answerStyle('बाराबंकी में कल बारिश होगी?', 'hi').code, 'hi');
});

/* ------------------------------------------------------------------ */
/* An explicitly chosen assistant language                             */
/*                                                                     */
/* `auto` is the default and mirrors whatever the person wrote, which  */
/* is what every case above asserts. These cover the other branch: a   */
/* language they went to a setting and named.                          */
/* ------------------------------------------------------------------ */

test('an explicit assistant language is honoured over the script typed in', () => {
  // Asked in English, answered in Hindi, because that is what was chosen.
  const style = answerStyle('will it rain in Delhi', 'en', 'hi');
  assert.equal(style.code, 'hi');
  assert.equal(style.script, 'Deva');

  // And the other way round.
  const back = answerStyle('दिल्ली में बारिश होगी?', 'hi', 'en');
  assert.equal(back.code, 'en');
  assert.equal(back.script, 'Latn');
});

test('the template language follows an explicit assistant language too', () => {
  // Otherwise a gate rejection would ship a Hindi template under an English
  // answer, which is the seam this pairing exists to prevent.
  assert.equal(replyLanguage('will it rain in Delhi', 'en', 'hi'), 'hi');
  assert.equal(replyLanguage('दिल्ली में बारिश होगी?', 'hi', 'en'), 'en');
});

test('a chosen language with no templates still lands on one that exists', () => {
  // Tamil speech exists; Tamil templates do not. The answer is written in
  // Tamil by the model, and the fallback template is English rather than
  // machine-translated.
  assert.equal(answerStyle('will it rain', 'en', 'ta').code, 'ta');
  assert.equal(replyLanguage('will it rain', 'en', 'ta'), 'en');
});

test('auto is the default and changes nothing', () => {
  // The same two calls with and without the argument must agree, which is
  // what makes this addition safe for every existing caller.
  for (const q of ['will it rain', 'दिल्ली में बारिश होगी?', 'kal barish hogi']) {
    assert.deepEqual(answerStyle(q, 'hi'), answerStyle(q, 'hi', 'auto'), q);
    assert.equal(replyLanguage(q, 'hi'), replyLanguage(q, 'hi', 'auto'), q);
  }
});
