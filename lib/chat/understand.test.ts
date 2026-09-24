import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fallbackPlan, readLanguageRequest, understandLocally, type Plan, type WeatherPlan } from './understand';
import { readSocial } from './social';
import type { StandingQuery } from './types';

const TODAY = '2026-09-22';

function standing(over: Partial<StandingQuery> = {}): StandingQuery {
  return {
    place: 'Lucknow',
    resolvedPlace: null,
    intent: 'current',
    timeWindow: { kind: 'now' },
    variable: 'all',
    setAt: '2026-09-22T10:00:00Z',
    ...over,
  };
}

function read(text: string, s: StandingQuery | null = null): Plan | null {
  return understandLocally(text, { standing: s, today: TODAY });
}

function weather(text: string, s: StandingQuery | null = null): WeatherPlan {
  const plan = read(text, s);
  assert.ok(plan, `expected a plan for: ${text}`);
  assert.equal(plan.act, 'weather', `expected weather for: ${text}, got ${JSON.stringify(plan)}`);
  return plan as WeatherPlan;
}

/* ------------------------------------------------------------------ */
/* The fundamental problem: talk is never a place                       */
/* ------------------------------------------------------------------ */

test('conversational turns are social, never places — with or without context', () => {
  const cases: [string, string][] = [
    ['wassup', 'greeting'],
    ['hi', 'greeting'],
    ['hello', 'greeting'],
    ['ohh really', 'reaction'],
    ['wait what', 'reaction'],
    ['wow', 'reaction'],
    ['seriously?', 'reaction'],
    ["that's crazy", 'reaction'],
    ['thanks', 'thanks'],
    ['thank you so much!', 'thanks'],
    ['okay', 'acknowledgement'],
    ['got it', 'acknowledgement'],
    ['nice', 'acknowledgement'],
    ['ok thanks', 'thanks'],
    ['bye', 'farewell'],
    ['how are you?', 'smallTalk'],
    ['what can you do?', 'capabilities'],
    ['अच्छा', 'acknowledgement'],
    ['धन्यवाद', 'thanks'],
    ['वाह', 'reaction'],
    ['sach mein?', 'reaction'],
    ['theek hai', 'acknowledgement'],
    ['heyyy', 'greeting'],
    ['ohhhh', 'reaction'],
  ];
  for (const [text, kind] of cases) {
    for (const s of [null, standing()]) {
      const plan = read(text, s);
      assert.deepEqual(plan, { act: 'social', kind }, `${text} (context: ${Boolean(s)})`);
    }
  }
});

test('words the gazetteer would fuzzy-match are never read as places', () => {
  // Measured: thank→Thane, later→Latur, noted→Noida, kitni→Katni, than→Thane.
  for (const text of ['thank', 'later', 'noted', 'kitni', 'kahan', 'than', 'badal', 'idhar', 'punjabi']) {
    const plan = read(text);
    assert.ok(
      plan === null || plan.act !== 'weather' || plan.place.kind !== 'named',
      `${text} was read as a place: ${JSON.stringify(plan)}`,
    );
  }
});

test('an unreadable turn defers — it does not fall through to a geocode', () => {
  assert.equal(read('blorp'), null);
  assert.equal(read('asdfgh qwerty'), null);
  // And with no model to defer to, it asks rather than guessing.
  assert.deepEqual(fallbackPlan('blorp'), { act: 'unclear', maybePlace: 'blorp' });
  assert.deepEqual(fallbackPlan('ohh really'), { act: 'unclear' });
});

test('a bare place name is still a place, in both scripts', () => {
  for (const [text, place] of [
    ['Lucknow', 'Lucknow'],
    ['lucknow?', 'lucknow'],
    ['लखनऊ', 'लखनऊ'],
    ['Ghaziabad please', 'Ghaziabad'],
  ]) {
    const plan = weather(text);
    assert.deepEqual(plan.place, { kind: 'named', text: place }, text);
    assert.equal(plan.intent, 'current');
  }
});

/* ------------------------------------------------------------------ */
/* The evaluation dialogues, at the classification level               */
/* ------------------------------------------------------------------ */

test('A: Lucknow → ohh really → and tomorrow? → what about wind?', () => {
  const first = weather('weather in Lucknow');
  assert.deepEqual(first.place, { kind: 'named', text: 'Lucknow' });
  assert.equal(first.intent, 'current');

  const s = standing();
  assert.deepEqual(read('ohh really', s), { act: 'social', kind: 'reaction' });

  const tomorrow = weather('and tomorrow?', s);
  assert.deepEqual(tomorrow.place, { kind: 'carried' });
  assert.deepEqual(tomorrow.window, { kind: 'day', offset: 1 });
  assert.equal(tomorrow.intent, 'forecast');

  const wind = weather('what about wind?', standing({ intent: 'forecast', timeWindow: { kind: 'day', offset: 1 } }));
  assert.deepEqual(wind.place, { kind: 'carried' });
  assert.deepEqual(wind.window, { kind: 'day', offset: 1 }, 'the day is inherited');
  assert.equal(wind.variable, 'wind');
  assert.equal(wind.intent, 'forecast');
});

test('B: Ghaziabad → last baarish kab hui? → and before that?', () => {
  const s = standing({ place: 'Ghaziabad' });
  const last = weather('last baarish kab hui?', s);
  assert.equal(last.intent, 'history');
  assert.deepEqual(last.window, { kind: 'lastEvent' });
  assert.deepEqual(last.place, { kind: 'carried' });

  const afterEvent = standing({
    place: 'Ghaziabad',
    intent: 'history',
    timeWindow: { kind: 'lastEvent' },
    variable: 'rain',
    event: { start: '2026-09-17T01:00:00+05:30' },
  });
  const before = weather('and before that?', afterEvent);
  assert.equal(before.intent, 'history');
  assert.deepEqual(before.window, { kind: 'lastEvent', before: '2026-09-17T01:00:00+05:30' });
});

test('the headline regression: a past-tense rain question is history, never now', () => {
  const plan = weather('last baarish kab hui thi ghaziabad mein');
  assert.equal(plan.intent, 'history');
  assert.deepEqual(plan.window, { kind: 'lastEvent' });
  assert.deepEqual(plan.place, { kind: 'named', text: 'ghaziabad' });
  assert.equal(plan.variable, 'rain');
});

test('C: Delhi → actually Mumbai → tomorrow?', () => {
  const change = weather('actually Mumbai', standing({ place: 'Delhi' }));
  assert.equal(change.turn, 'correction');
  assert.deepEqual(change.place, { kind: 'named', text: 'Mumbai' });
  assert.equal(change.intent, 'current', 'the topic carries over');

  const tomorrow = weather('tomorrow?', standing({ place: 'Mumbai' }));
  assert.deepEqual(tomorrow.place, { kind: 'carried' });
  assert.equal(tomorrow.intent, 'forecast');
});

test('D: wassup → weather in Lucknow', () => {
  assert.deepEqual(read('wassup'), { act: 'social', kind: 'greeting' });
  const plan = weather('weather in Lucknow');
  assert.deepEqual(plan.place, { kind: 'named', text: 'Lucknow' });
});

test('E: कल बारिश हुई थी क्या? → और कल?', () => {
  const past = weather('कल बारिश हुई थी क्या?');
  assert.equal(past.intent, 'history');
  assert.deepEqual(past.window, { kind: 'day', offset: -1 });
  assert.deepEqual(past.place, { kind: 'none' }, 'no place named and none carried: ask');

  // The first turn is still waiting for a place.
  const waiting = standing({
    place: null,
    pending: { intent: 'history', timeWindow: { kind: 'day', offset: -1 }, variable: 'rain' },
  });
  const next = weather('और कल?', waiting);
  assert.deepEqual(next.window, { kind: 'day', offset: 1 }, 'the other कल');
  assert.equal(next.intent, 'forecast');
  assert.equal(next.variable, 'rain', 'the question carries over');
  assert.deepEqual(next.place, { kind: 'none' });
});

test('F: ghaziabad mein weather → wait, I meant Lucknow', () => {
  const first = weather('ghaziabad mein weather');
  assert.deepEqual(first.place, { kind: 'named', text: 'ghaziabad' });

  const fix = weather('wait, I meant Lucknow', standing({ place: 'ghaziabad' }));
  assert.equal(fix.turn, 'correction');
  assert.deepEqual(fix.place, { kind: 'named', text: 'Lucknow' });
});

/* ------------------------------------------------------------------ */
/* Corrections and changes                                             */
/* ------------------------------------------------------------------ */

test('a correction naming both places keeps the one that is meant', () => {
  const english = weather('I meant Lucknow, not Kanpur', standing({ place: 'Kanpur' }));
  assert.deepEqual(english.place, { kind: 'named', text: 'Lucknow' });
  assert.equal(english.rejected, 'Kanpur');

  // Hindi puts the negator on the other side.
  const hindi = weather('Lucknow nahi, Kanpur', standing());
  assert.deepEqual(hindi.place, { kind: 'named', text: 'Kanpur' });
  assert.equal(hindi.rejected, 'Lucknow');

  const devanagari = weather('नहीं, लखनऊ', standing({ place: 'कानपुर' }));
  assert.deepEqual(devanagari.place, { kind: 'named', text: 'लखनऊ' });
});

test('a new place keeps the question; a new question does not inherit the day', () => {
  const s = standing({ place: 'Delhi', intent: 'forecast', timeWindow: { kind: 'day', offset: 1 }, variable: 'rain' });
  const mumbai = weather('what about Mumbai?', s);
  assert.deepEqual(mumbai.place, { kind: 'named', text: 'Mumbai' });
  assert.deepEqual(mumbai.window, { kind: 'day', offset: 1 });
  assert.equal(mumbai.variable, 'rain');

  const fresh = weather('Delhi ka mausam', s);
  assert.deepEqual(fresh.window, { kind: 'now' }, 'a whole question starts fresh');
});

test('an offered name the gazetteer does not hold is left to the classifier, not guessed', () => {
  // "what about X?" offers X — but X may be a village or may be cricket, and
  // nothing here can tell which. It used to be named, and geocoded, either
  // way. The classifier reads the conversation and decides; with no model,
  // the reply asks.
  assert.equal(read('what about Rampur Khas?', standing()), null);
  assert.equal(read('what about cricket?', standing()), null);
  // A known name offered the same way is still a place, locally.
  assert.deepEqual(weather('what about Noida?', standing()).place, { kind: 'named', text: 'Noida' });
});

test('"what about that?" names nothing and is not a place', () => {
  const plan = read('what about that?', standing());
  assert.ok(plan === null || plan.act !== 'weather' || plan.place.kind !== 'named');
});

test('the answer to "which place?" is a place even when the gazetteer does not know it', () => {
  const waiting = standing({
    place: null,
    pending: { intent: 'forecast', timeWindow: { kind: 'day', offset: 1 }, variable: 'rain' },
  });
  const plan = weather('Rampur Khas', waiting);
  assert.deepEqual(plan.place, { kind: 'named', text: 'Rampur Khas' });
  assert.equal(plan.intent, 'forecast', 'the waiting question is answered, not replaced');
  assert.equal(plan.variable, 'rain');
});

/* ------------------------------------------------------------------ */
/* Questions, history, here                                            */
/* ------------------------------------------------------------------ */

test('historical questions in all three registers', () => {
  assert.deepEqual(weather('what was the weather yesterday?').window, { kind: 'day', offset: -1 });
  assert.equal(weather('what was the weather yesterday?').intent, 'history');
  assert.deepEqual(weather('rainfall in the last 24 hours in Pune').window, { kind: 'pastHours', hours: 24 });
  assert.deepEqual(weather('pichhle 7 din mein kitni baarish hui patna mein').window, { kind: 'past', days: 7 });
  assert.deepEqual(weather('how much did it rain last week?', standing()).window, { kind: 'past', days: 7 });
  assert.deepEqual(weather('temperature yesterday', standing()).window, { kind: 'day', offset: -1 });
  assert.deepEqual(weather('did it rain?', standing()).window, { kind: 'lastEvent' });
  assert.deepEqual(weather('rain on 15 August in Delhi').window, { kind: 'date', date: '2026-08-15' });
});

test('the common placeless questions still ask for a place', () => {
  for (const text of ['temperature', 'will it rain?', 'weather tomorrow', 'आज का मौसम', 'कोई चेतावनी है?']) {
    const plan = weather(text);
    assert.deepEqual(plan.place, { kind: 'none' }, text);
  }
});

test('"near me" is here, even mid-conversation', () => {
  assert.deepEqual(weather('weather near me', standing()).place, { kind: 'here' });
  assert.deepEqual(weather('what about here?', standing()).place, { kind: 'here' });
});

test('a greeting in front of a question does not swallow it', () => {
  const plan = weather('hi, will it rain in Lucknow tomorrow?');
  assert.deepEqual(plan.place, { kind: 'named', text: 'Lucknow' });
  assert.equal(plan.intent, 'forecast');
  assert.equal(readSocial('what about wind?').rest, 'what about wind?', '"what" is not a lead-in');
});

test('a language request changes language and is not a place', () => {
  assert.deepEqual(readLanguageRequest('Hindi mein batao'), { code: 'hi', script: 'Deva' });
  assert.deepEqual(readLanguageRequest('reply in English please'), { code: 'en', script: 'Latn' });
  assert.deepEqual(readLanguageRequest('हिंदी में बोलो'), { code: 'hi', script: 'Deva' });
  assert.equal(readLanguageRequest('weather in Lucknow'), null);
  assert.deepEqual(read('English please'), { act: 'language', lang: { code: 'en', script: 'Latn' } });
});
