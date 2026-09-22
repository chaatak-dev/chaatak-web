/**
 * The bot follows Chaatak's language preferences. Telegram's own language is a
 * fallback, and never beats a choice the person made.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { chatLanguage, chromeLanguage, fromTelegramCode } from './language';

const none = { assistant: null, ui: null, lastTurn: null, telegram: undefined } as const;

test('an explicit assistant language wins over everything', () => {
  assert.equal(
    chatLanguage({ assistant: 'hi', ui: 'en', lastTurn: 'en', telegram: 'en-GB' }),
    'hi',
  );
  assert.equal(chatLanguage({ ...none, assistant: 'ta', telegram: 'hi' }), 'ta');
});

test('auto mirrors the conversation before anything else', () => {
  assert.equal(chatLanguage({ ...none, assistant: 'auto', lastTurn: 'hi', ui: 'en', telegram: 'en' }), 'hi');
});

test('an explicit interface language beats Telegram’s', () => {
  assert.equal(chatLanguage({ ...none, assistant: 'auto', ui: 'hi', telegram: 'en-US' }), 'hi');
});

test('Telegram’s language is only the initial fallback', () => {
  assert.equal(chatLanguage({ ...none, telegram: 'hi' }), 'hi');
  assert.equal(chatLanguage({ ...none, assistant: 'auto', ui: 'auto', telegram: 'hi-IN' }), 'hi');
  // …and once the conversation says otherwise, the conversation wins.
  assert.equal(chatLanguage({ ...none, lastTurn: 'en', telegram: 'hi' }), 'en');
});

test('with nothing to go on, English', () => {
  assert.equal(chatLanguage(none), 'en');
  assert.equal(chatLanguage({ ...none, telegram: 'fr' }), 'en');
});

test('a language code is read by its primary subtag only', () => {
  assert.equal(fromTelegramCode('hi'), 'hi');
  assert.equal(fromTelegramCode('en-GB'), 'en');
  assert.equal(fromTelegramCode('BN'), 'bn');
  assert.equal(fromTelegramCode('pt-br'), null);
  assert.equal(fromTelegramCode(''), null);
});

test('chrome narrows to a language the catalogue is written in', () => {
  // Marathi shares Devanagari and reads Hindi chrome; Tamil reads English.
  assert.equal(chromeLanguage({ ...none, assistant: 'mr' }), 'hi');
  assert.equal(chromeLanguage({ ...none, assistant: 'ta' }), 'en');
  assert.equal(chromeLanguage({ ...none, telegram: 'hi' }), 'hi');
});
