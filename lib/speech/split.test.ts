import { test } from 'node:test';
import assert from 'node:assert/strict';

import { splitForSpeech } from './split';

test('a one-sentence answer is one piece', () => {
  assert.deepEqual(splitForSpeech('लखनऊ में आज 32°C है।'), ['लखनऊ में आज 32°C है।']);
  assert.deepEqual(splitForSpeech(''), []);
});

test('nothing is dropped or reworded: the pieces are the text', () => {
  const text =
    'लखनऊ में आज दोपहर तक आंधी की चेतावनी है। तापमान 32.5°C रहेगा और हवा 18 km/h से चलेगी। शाम को बारिश की 70% संभावना है। खेत में छिड़काव कल सुबह करें। पानी जमा न होने दें!';
  const pieces = splitForSpeech(text);
  assert.ok(pieces.length > 1);
  assert.equal(pieces.join(' '), text);
});

test('a number with a decimal point is never split', () => {
  const pieces = splitForSpeech('Temperature is 25.5°C. Rain is likely after 4 pm. Take an umbrella if you go out.');
  assert.ok(pieces.every((p) => !p.endsWith('25.')));
  assert.ok(pieces.some((p) => p.includes('25.5°C')));
});

test('the first piece is short, so the voice starts sooner; later pieces are fuller', () => {
  const text = [
    'There is a thunderstorm warning for Lucknow until 8 pm.',
    'Winds may reach 40 km/h.',
    'Avoid open fields and stay away from tall trees.',
    'Secure loose items on your roof.',
    'Rain should ease by tomorrow morning.',
  ].join(' ');
  const [first, ...rest] = splitForSpeech(text);
  assert.equal(first, 'There is a thunderstorm warning for Lucknow until 8 pm.');
  assert.ok(rest.length >= 1 && rest.length <= 2, JSON.stringify(rest));
});

test('a very short first sentence is merged — "हाँ।" is not worth a request', () => {
  const [first] = splitForSpeech('हाँ। कल लखनऊ में बारिश होगी। सुबह से बादल रहेंगे।');
  assert.ok(first.startsWith('हाँ। कल लखनऊ'), first);
});
