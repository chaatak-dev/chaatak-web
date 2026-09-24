import { test } from 'node:test';
import assert from 'node:assert/strict';

import { candidatesFor, chooseTranscript, indicEvidence, readsAsNative } from './detect';

test('Hindi speech: the Hindi recogniser writes Hindi, and Hindi wins — whatever Whisper says', () => {
  // Whisper often answers Hindi audio with a fluent English translation. The
  // Hindi transcript full of है and में is the evidence that settles it.
  const d = chooseTranscript([
    { lang: 'hi', transcript: 'कल गाज़ियाबाद में बारिश होगी क्या' },
    { lang: 'en', transcript: 'Will it rain in Ghaziabad tomorrow?' },
  ]);
  assert.ok(d);
  assert.equal(d.lang, 'hi');
  assert.equal(d.confidence, 'high');
});

test('English speech: the Hindi recogniser spells English out, and English wins', () => {
  const d = chooseTranscript([
    { lang: 'hi', transcript: 'व्हाट इज द वेदर इन लखनऊ टुमॉरो' },
    { lang: 'en', transcript: 'What is the weather in Lucknow tomorrow?' },
  ]);
  assert.ok(d);
  assert.equal(d.lang, 'en');
  assert.equal(d.transcript, 'What is the weather in Lucknow tomorrow?');
  assert.equal(d.confidence, 'high');
});

test('Hinglish speech is Hindi: grammar decides, not the English words in it', () => {
  const d = chooseTranscript([
    { lang: 'hi', transcript: 'गाज़ियाबाद में आज वेदर कैसा है' },
    { lang: 'en', transcript: 'Ghaziabad mein aaj weather kaisa hai' },
  ]);
  assert.equal(d?.lang, 'hi');
});

test('a bare place name has no evidence, so the conversation decides — and says it was unsure', () => {
  const heard = [
    { lang: 'hi' as const, transcript: 'लखनऊ' },
    { lang: 'en' as const, transcript: 'Lucknow.' },
  ];
  const withPrior = chooseTranscript(heard, 'en');
  assert.equal(withPrior?.lang, 'en');
  assert.equal(withPrior?.confidence, 'low');
  assert.equal(chooseTranscript(heard, 'hi')?.lang, 'hi');
});

test('a recogniser that heard nothing is not a vote', () => {
  assert.equal(chooseTranscript([{ lang: 'hi', transcript: '' }, { lang: 'en', transcript: 'hello' }])?.lang, 'en');
  assert.equal(chooseTranscript([{ lang: 'hi', transcript: ' ' }, { lang: 'en', transcript: '' }]), null);
});

test('Tamil speech is judged by the Tamil lexicon', () => {
  const d = chooseTranscript([
    { lang: 'ta', transcript: 'சென்னையில் நாளை மழை பெய்யுமா' },
    { lang: 'hi', transcript: 'चेन्नई नालई मलई पेय्युमा' },
    { lang: 'en', transcript: 'Chennai nalai mazhai' },
  ]);
  assert.equal(d?.lang, 'ta');
});

test('the confident-conversation fast path reads a native transcript as native', () => {
  assert.equal(readsAsNative({ lang: 'hi', transcript: 'आज मौसम कैसा है' }), true);
  assert.equal(readsAsNative({ lang: 'hi', transcript: 'व्हाट इज द वेदर' }), false);
  assert.deepEqual(indicEvidence({ lang: 'hi', transcript: 'व्हाट इज द वेदर' }).transliteratedEnglish, 4);
});

test('candidates: one Indic language, Hindi, English — never more than three', () => {
  assert.deepEqual(candidatesFor(null, null), ['hi', 'en']);
  assert.deepEqual(candidatesFor('ta', null), ['ta', 'hi', 'en']);
  assert.deepEqual(candidatesFor('en', 'mr'), ['mr', 'hi', 'en']);
  assert.deepEqual(candidatesFor('hi', 'ta'), ['hi', 'en']);
});
