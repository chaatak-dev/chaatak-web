import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  chromeLanguage,
  conversationLanguage,
  languageTag,
  readTurn,
  readTurnLanguage,
  resolveTurnLanguage,
  speechLanguage,
  templateLanguage,
  type TurnLanguage,
} from './detect';

/**
 * The language a turn is answered in is decided here, before generation, and
 * handed to the response layer as an instruction. These are the cases the
 * product was getting wrong.
 */

const HINGLISH: TurnLanguage = { code: 'hi', script: 'Latn', confidence: 'high', basis: 'lexicon' };
const HINDI: TurnLanguage = { code: 'hi', script: 'Deva', confidence: 'high', basis: 'lexicon' };
const ENGLISH: TurnLanguage = { code: 'en', script: 'Latn', confidence: 'high', basis: 'lexicon' };

function lang(text: string, previous: TurnLanguage | null = null) {
  const r = resolveTurnLanguage(text, { previous });
  return `${r.code}-${r.script}`;
}

test('the regressions: Hinglish stays Hinglish, Hindi stays Devanagari, English stays English', () => {
  assert.equal(lang('last baarish kab hui thi ghaziabad mein'), 'hi-Latn');
  assert.equal(lang('ghaziabad mein aaj weather kaisa hai?'), 'hi-Latn');
  assert.equal(lang('baarish kab hui thi?'), 'hi-Latn');
  assert.equal(lang('ghaziabad mein aaj baarish hogi kya?'), 'hi-Latn');
  assert.equal(lang('what was the weather yesterday?'), 'en-Latn');
  assert.equal(lang('what is the weather?'), 'en-Latn');
  assert.equal(lang('कल बारिश हुई थी क्या?'), 'hi-Deva');
  assert.equal(lang('गाज़ियाबाद में मौसम कैसा है?'), 'hi-Deva');
});

test('the other scripts are their own languages', () => {
  assert.equal(lang('અમદાવાદમાં કાલે વરસાદ પડશે?'), 'gu-Gujr');
  assert.equal(lang('কলকাতায় আগামীকাল বৃষ্টি হবে?'), 'bn-Beng');
  assert.equal(lang('சென்னையில் நாளை மழை பெய்யுமா?'), 'ta-Taml');
  assert.equal(lang('ਅੰਮ੍ਰਿਤਸਰ ਵਿੱਚ ਕੱਲ੍ਹ ਮੀਂਹ ਪਵੇਗਾ?'), 'pa-Guru');
});

test('Marathi is told from Hindi by its own words, not by its script', () => {
  assert.equal(lang('पुण्यात उद्या पाऊस पडेल का?'), 'mr-Deva');
  assert.equal(lang('मुंबईत आज हवामान कसे आहे?'), 'mr-Deva');
  assert.equal(lang('मुंबई में आज मौसम कैसा है?'), 'hi-Deva');
});

test('a short reaction keeps the conversation language, whatever the UI is', () => {
  // The case that motivated this file: after a Hinglish answer, "ohh really"
  // came back in English because two words say nothing about Hindi.
  for (const reaction of ['ohh really', 'wow', 'ok', 'wait what', 'thanks', 'seriously?', 'got it']) {
    assert.equal(lang(reaction, HINGLISH), 'hi-Latn', reaction);
    assert.equal(lang(reaction, HINDI), 'hi-Deva', reaction);
    assert.equal(lang(reaction, ENGLISH), 'en-Latn', reaction);
  }
});

test('a short English follow-up does not pull a Hindi conversation into English', () => {
  // Hinglish speakers mix English words in constantly.
  assert.equal(lang('and tomorrow?', HINGLISH), 'hi-Latn');
  assert.equal(lang('what about wind?', HINDI), 'hi-Deva');
});

test('a short Hindi follow-up does pull an English conversation into Hindi', () => {
  // English speakers do not use Hindi function words by accident.
  assert.equal(lang('aur kal?', ENGLISH), 'hi-Latn');
  assert.equal(lang('और कल?', ENGLISH), 'hi-Deva');
});

test('a long turn is read on its own evidence', () => {
  assert.equal(lang('What will the weather be like in Lucknow tomorrow?', HINGLISH), 'en-Latn');
  assert.equal(lang('kal lucknow mein baarish hogi kya bhai?', ENGLISH), 'hi-Latn');
});

test('a bare place name inherits the conversation, and is flagged when it cannot', () => {
  assert.equal(lang('Lucknow', HINGLISH), 'hi-Latn');
  assert.equal(lang('Lucknow', HINDI), 'hi-Deva');

  const alone = resolveTurnLanguage('Lucknow');
  assert.equal(`${alone.code}-${alone.script}`, 'en-Latn');
  assert.equal(alone.confidence, 'low', 'a guess must say it is a guess');
});

test('a recogniser that heard Hindi beats a guess on a bare Latin name', () => {
  const r = resolveTurnLanguage('Lucknow', { heard: 'hi' });
  assert.equal(`${r.code}-${r.script}`, 'hi-Latn');
  assert.equal(r.basis, 'spoken');
});

test('a voice SETTING is not evidence about what was typed', () => {
  // The client's language is a fallback for text with no letters, never a
  // reason to answer a typed "Lucknow" in Hinglish.
  const r = resolveTurnLanguage('Lucknow', { fallback: 'hi' });
  assert.equal(`${r.code}-${r.script}`, 'en-Latn');
});

test('no letters at all falls back to the conversation, then to the client', () => {
  assert.equal(lang('26?', HINDI), 'hi-Deva');
  const bare = resolveTurnLanguage('👍', { fallback: 'ta' });
  assert.equal(bare.code, 'ta');
  assert.equal(bare.confidence, 'low');
});

test('an explicit assistant language decides outright, in its own script', () => {
  const r = resolveTurnLanguage('will it rain in Delhi', { assistant: 'hi', previous: ENGLISH });
  assert.deepEqual([r.code, r.script, r.basis], ['hi', 'Deva', 'explicit']);
  const back = resolveTurnLanguage('दिल्ली में बारिश होगी?', { assistant: 'en' });
  assert.deepEqual([back.code, back.script], ['en', 'Latn']);
});

test('English words inside Hinglish do not make it English', () => {
  // Content words are borrowed; only function words are evidence.
  assert.equal(lang('lucknow ka weather forecast batao'), 'hi-Latn');
  assert.equal(lang('temperature kitna hai'), 'hi-Latn');
});

test('an English sentence is not mistaken for Hinglish', () => {
  for (const q of [
    'Will it rain in Barabanki tomorrow?',
    'Is it safe to travel to Jaipur today?',
    'Tell me the weather, par for the course, mere minutes away',
    'Will it remain cloudy in Delhi?',
    'Is the mountain chain getting snow?',
  ]) {
    assert.equal(lang(q), 'en-Latn', q);
  }
});

test('the conversation language is the last DECISIVE user turn', () => {
  const history = [
    { role: 'user', text: 'lucknow mein aaj mausam kaisa hai' },
    { role: 'assistant', text: 'Lucknow mein abhi 31 °C hai.' },
    { role: 'user', text: 'ok' },
  ];
  const found = conversationLanguage(history);
  assert.ok(found);
  assert.equal(`${found.code}-${found.script}`, 'hi-Latn');
  assert.equal(conversationLanguage([{ role: 'user', text: 'hmm' }]), null);
});

test('templates, chrome, tags and voices follow from the one decision', () => {
  assert.equal(templateLanguage(HINGLISH), 'hinglish');
  assert.equal(templateLanguage(HINDI), 'hi');
  assert.equal(templateLanguage({ code: 'mr', script: 'Deva' }), 'hi');
  assert.equal(templateLanguage({ code: 'ta', script: 'Taml' }), 'en');

  assert.equal(chromeLanguage(HINGLISH), 'en');
  assert.equal(chromeLanguage(HINDI), 'hi');

  assert.equal(languageTag(HINGLISH), 'hi-Latn');
  assert.equal(languageTag(HINDI), 'hi-IN');

  // A voice reads the script it was built for.
  assert.equal(speechLanguage(HINGLISH), 'en');
  assert.equal(speechLanguage({ code: 'ta', script: 'Taml' }), 'ta');
});

test('a stored language is validated before it is trusted', () => {
  assert.deepEqual(readTurnLanguage({ code: 'hi', script: 'Latn' })?.script, 'Latn');
  assert.equal(readTurnLanguage({ code: 'ta', script: 'Latn' }), null, 'Tamil is not Latin');
  assert.equal(readTurnLanguage({ code: 'xx', script: 'Latn' }), null);
  assert.equal(readTurnLanguage('hi'), null);
});

test('readTurn reports confidence honestly', () => {
  assert.equal(readTurn('hmm')?.confidence, 'low');
  assert.equal(readTurn('kal barish hogi kya')?.confidence, 'high');
  assert.equal(readTurn(''), null);
});
