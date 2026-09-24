/**
 * Conversation routing: what a turn IS, before anything decides WHERE.
 *
 * THE BUG CLASS. "क्या मैं अपने दोस्त के साथ क्रिकेट खेल सकता हूँ कल शाम को?"
 * asked the geocoder about दोस्त — a friend — because a particle stood next
 * to it and a time word made the sentence "about the weather". The same door
 * let in office, घर, home, खेत, shaadi, bhai, papa, jogging and "the
 * evening", and read "in Rampur Khas" as the real district of Rampur. These
 * tests hold the whole class shut, in the three registers people actually
 * type, rather than the one sentence that was reported:
 *
 *   - weather advice reuses the conversation's place
 *   - follow-ups refine the time and the topic ("कल शाम", "tomorrow evening")
 *   - an ordinary noun is never a place because parsing was uncertain
 *   - explicit place changes and corrections still change the place
 *   - small talk is small talk
 *   - a real place inside a long sentence is still found
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { answerQuestion, type AnswerDeps, type ChatReply } from './answer';
import { plausiblePlace, toPlan, verbatimPlace } from './classify';
import { fallbackPlan, understandLocally, type Plan, type WeatherPlan } from './understand';
import type { Message, StandingQuery } from './types';
import type { ReplyRequest, ReplyResult } from '../render/reply';
import type { WeatherSnapshot } from '../weather/api';
import type { Location, NoData } from '../weather/types';
import type { TimeWindow } from '../parse/types';
import { queryStats } from '../log';

const TODAY = '2026-09-24';

function standing(over: Partial<StandingQuery> = {}): StandingQuery {
  return {
    place: 'Ghaziabad',
    resolvedPlace: null,
    intent: 'forecast',
    timeWindow: { kind: 'day', offset: 1 },
    variable: 'rain',
    setAt: '2026-09-24T10:00:00Z',
    ...over,
  };
}

const read = (text: string, s: StandingQuery | null = null): Plan | null => understandLocally(text, { standing: s, today: TODAY });

function weather(text: string, s: StandingQuery | null = null): WeatherPlan {
  const plan = read(text, s);
  assert.ok(plan && plan.act === 'weather', `expected a weather plan for: ${text}, got ${JSON.stringify(plan)}`);
  return plan as WeatherPlan;
}

/** The place a local reading would send to the resolver, if any. */
function namedPlace(plan: Plan | null): string | null {
  return plan && plan.act === 'weather' && plan.place.kind === 'named' ? plan.place.text : null;
}

const day = (offset: number, part?: 'morning' | 'afternoon' | 'evening' | 'night'): TimeWindow =>
  part ? { kind: 'day', offset, part } : { kind: 'day', offset };

/* ------------------------------------------------------------------ */
/* 1. Ordinary nouns are never places                                  */
/* ------------------------------------------------------------------ */

/**
 * Sentences whose only candidate "places" are people, activities, events and
 * household spots — in the positions that used to claim them: before के / का
 * / की / में / mein / ke, after "in" / "at". None of these may ever reach the
 * resolver from the local reader, with or without a conversation.
 */
const NO_PLACE_HERE = [
  // Hindi
  'क्या मैं अपने दोस्त के साथ क्रिकेट खेल सकता हूँ कल शाम को?',
  'मेरे घर में कल बारिश होगी?',
  'क्या कल खेत में छिड़काव कर सकता हूँ?',
  'क्या आज घर से निकलूँ?',
  'बच्चों को कल स्कूल भेजूँ?',
  'मेरे भाई की शादी कल है, बारिश होगी क्या?',
  'कल दफ़्तर में बारिश होगी?',
  // Hinglish
  'kya main apne dost ke saath cricket khel sakta hoon kal shaam ko?',
  'kal office mein baarish hogi?',
  'kya kal khet mein spray kar sakta hoon?',
  'kal shaadi mein barish to nahi hogi?',
  'mere bhai ki shaadi kal hai, baarish hogi kya?',
  'papa ke saath kal mandi jaana hai, mausam kaisa rahega?',
  'ghar ke bahar kapde sukha sakte hain aaj?',
  'kal subah jogging ke liye ja sakta hoon?',
  'kal mandir mein barish hogi?',
  // English
  'Can I play cricket with my friend tomorrow evening?',
  'will it rain at home tomorrow?',
  'should I go to the office tomorrow?',
  'should I carry an umbrella to school tomorrow?',
  'is it safe to travel to my village tomorrow?',
  'can we do the function at the park on Sunday?',
  'give me the weather for my farm tomorrow',
];

test('an ordinary noun is never sent to the resolver as a place — any register, any context', () => {
  for (const text of NO_PLACE_HERE) {
    for (const s of [null, standing()]) {
      const plan = read(text, s);
      assert.equal(namedPlace(plan), null, `"${text}" (context: ${Boolean(s)}) named ${JSON.stringify(namedPlace(plan))}`);
    }
  }
});

test('the reported sentence: advice for tomorrow evening, on the conversation’s place', () => {
  const s = standing();
  const text = 'क्या मैं अपने दोस्त के साथ क्रिकेट खेल सकता हूँ कल शाम को?';
  // Locally it is not certain enough to answer — so it is the classifier's,
  // which sees the conversation. It is never a geocode.
  assert.equal(read(text, s), null);
  // With no model to ask, it is still a weather question about Ghaziabad.
  const plan = fallbackPlan(text, { standing: s, today: TODAY });
  assert.equal(plan.act, 'weather');
  if (plan.act !== 'weather') return;
  assert.deepEqual(plan.place, { kind: 'carried' });
  assert.deepEqual(plan.window, day(1, 'evening'));
  assert.equal(plan.intent, 'forecast');
});

test('the control sentence still works: a forecast for a named place', () => {
  const plan = weather('कल गाजियाबाद में बारिश होगी क्या?');
  assert.deepEqual(plan.place, { kind: 'named', text: 'गाजियाबाद' });
  assert.deepEqual(plan.window, day(1));
  assert.equal(plan.variable, 'rain');
  assert.equal(plan.intent, 'forecast');
});

test('"what about the evening?" is a time, not a place called Evening', () => {
  const plan = weather('what about the evening?', standing());
  assert.deepEqual(plan.place, { kind: 'carried' });
  assert.deepEqual(plan.window, day(1, 'evening'));
});

/* ------------------------------------------------------------------ */
/* 2. Real places inside larger sentences                              */
/* ------------------------------------------------------------------ */

test('a real place inside a long sentence is still found, without a model', () => {
  const cases: [string, string, TimeWindow | null][] = [
    ['क्या मैं कल लखनऊ में अपने दोस्त के साथ क्रिकेट खेल सकता हूँ?', 'लखनऊ', day(1)],
    ['can I play cricket in Lucknow tomorrow evening?', 'Lucknow', day(1, 'evening')],
    ['mere dost ke saath kal Noida mein cricket khelna hai, mausam theek rahega?', 'Noida', day(1)],
    ['mere dost ke ghar Lucknow mein kal barish hogi?', 'Lucknow', day(1)],
    ['Pune ka mausam kal kaisa rahega', 'Pune', day(1)],
    ['kal subah Pune mein kohra hoga?', 'Pune', day(1, 'morning')],
    ['Lucknow ke paas kal barish?', 'Lucknow', day(1)],
    ['Delhi ki hawa kaisi hai', 'Delhi', null],
    ['give me the weather in Delhi', 'Delhi', null],
    ['kal lucknow jaana hai, barish hogi?', 'lucknow', day(1)],
    ['last baarish kab hui thi ghaziabad mein', 'ghaziabad', { kind: 'lastEvent' }],
    // A name that is also a common word is a place where the grammar says so.
    ['Mandi mein kal barish hogi?', 'Mandi', day(1)],
  ];
  for (const [text, place, window] of cases) {
    for (const s of [null, standing()]) {
      const plan = weather(text, s);
      assert.deepEqual(plan.place, { kind: 'named', text: place }, text);
      if (window) assert.deepEqual(plan.window, window, text);
    }
  }
});

test('a place that cannot be confirmed defers — it is never shortened to a place that can', () => {
  // "in Rampur Khas" was read as Rampur, a real district elsewhere.
  for (const text of ['will it rain in Rampur Khas tomorrow?', 'Rampur Khas mein kal barish hogi?']) {
    assert.equal(read(text), null, text);
    assert.equal(read(text, standing()), null, text);
  }
  // Two places at once: the classifier picks, this layer does not.
  assert.equal(read('Delhi mein ya Lucknow mein barish?'), null);
  // "mandir" (a temple) is one edit from Mandi district: never repaired in a sentence.
  assert.equal(namedPlace(read('kal mandir mein barish hogi?')), null);
});

/* ------------------------------------------------------------------ */
/* 3. Follow-ups refine the time and the topic                         */
/* ------------------------------------------------------------------ */

test('follow-ups refine the time: कल शाम, tomorrow evening, aur shaam ko', () => {
  const onTomorrow = standing();
  const cases: [string, TimeWindow][] = [
    ['कल शाम?', day(1, 'evening')],
    ['tomorrow evening?', day(1, 'evening')],
    ['और कल शाम को?', day(1, 'evening')],
    ['aur kal subah?', day(1, 'morning')],
    // A part of the day alone narrows the day being discussed.
    ['aur shaam ko?', day(1, 'evening')],
    ['what about the morning?', day(1, 'morning')],
    ['tonight?', day(0, 'night')],
    ['aur parson?', day(2)],
  ];
  for (const [text, window] of cases) {
    const plan = weather(text, onTomorrow);
    assert.deepEqual(plan.place, { kind: 'carried' }, text);
    assert.deepEqual(plan.window, window, text);
    assert.equal(plan.variable, 'rain', `${text}: the topic carries`);
  }
});

test('a part of the day carries through the next follow-up, until something replaces it', () => {
  const evening = standing({ timeWindow: day(1, 'evening') });
  assert.deepEqual(weather('aur parson?', evening).window, day(2, 'evening'), 'a new day keeps the part');
  const wind = weather('what about wind?', evening);
  assert.deepEqual(wind.window, day(1, 'evening'), 'a new topic keeps the time');
  assert.equal(wind.variable, 'wind');
  assert.deepEqual(weather('aur subah?', evening).window, day(1, 'morning'), 'a new part replaces the old');
});

test('a part of today still to come is a forecast; one already past is history', () => {
  assert.equal(weather('aaj shaam barish hogi?').intent, 'forecast');
  assert.deepEqual(weather('aaj shaam barish hogi?').window, day(0, 'evening'));
  assert.equal(weather('this evening in Lucknow?').intent, 'forecast');
  assert.equal(weather('aaj subah barish hui thi kya?', standing()).intent, 'history');
});

test('with no conversation, a time alone asks where rather than guessing', () => {
  for (const text of ['कल शाम?', 'tomorrow evening?', 'aaj raat barish hogi?']) {
    assert.deepEqual(weather(text).place, { kind: 'none' }, text);
  }
});

/* ------------------------------------------------------------------ */
/* 4. Corrections and explicit changes                                 */
/* ------------------------------------------------------------------ */

test('an explicit change of place is kept, and the question carries over', () => {
  const s = standing();
  for (const [text, place] of [
    ['actually Noida', 'Noida'],
    ['नहीं, नोएडा', 'नोएडा'],
    ['I meant Lucknow', 'Lucknow'],
    ['what about Noida?', 'Noida'],
    ['Noida ka kya?', 'Noida'],
    ['aur Lucknow mein?', 'Lucknow'],
  ]) {
    const plan = weather(text, s);
    assert.deepEqual(plan.place, { kind: 'named', text: place }, text);
    assert.deepEqual(plan.window, day(1), `${text}: the day carries`);
    assert.equal(plan.variable, 'rain', `${text}: the topic carries`);
  }
});

test('a correction naming two places keeps the one meant — when either is a place', () => {
  const hindi = weather('Ghaziabad nahi, Noida', standing());
  assert.deepEqual(hindi.place, { kind: 'named', text: 'Noida' });
  assert.equal(hindi.rejected, 'Ghaziabad');
  const english = weather('not Kanpur, Lucknow', standing({ place: 'Kanpur' }));
  assert.deepEqual(english.place, { kind: 'named', text: 'Lucknow' });
  // The rejected one being the conversation's place is evidence enough.
  const unknownMeant = weather('Ghaziabad nahi, Rampur Khas', standing());
  assert.deepEqual(unknownMeant.place, { kind: 'named', text: 'Rampur Khas' });
  // The same shape about activities is not a place swap.
  assert.equal(namedPlace(read('cricket nahi, football', standing())), null);
});

test('a correction offering a name nobody can confirm is the classifier’s, not a guess', () => {
  assert.equal(read('actually Rampur Khas', standing()), null);
  assert.equal(read('nahi, mera matlab dost', standing()), null);
});

test('a correction of the TIME changes the time, not the place', () => {
  const plan = weather('nahi, kal shaam', standing({ timeWindow: { kind: 'now' }, intent: 'current' }));
  assert.deepEqual(plan.place, { kind: 'carried' });
  assert.deepEqual(plan.window, day(1, 'evening'));
});

test('the answer to "which place?" is a place, even one the gazetteer does not hold', () => {
  const waiting = standing({ place: null, pending: { intent: 'forecast', timeWindow: day(1, 'evening'), variable: 'all' } });
  const plan = weather('Rampur Khas', waiting);
  assert.deepEqual(plan.place, { kind: 'named', text: 'Rampur Khas' });
  assert.deepEqual(plan.window, day(1, 'evening'), 'the waiting question is answered, not replaced');
  // …but a time given instead is a time.
  assert.deepEqual(weather('कल शाम', waiting).place, { kind: 'none' });
});

/* ------------------------------------------------------------------ */
/* 5. Small talk                                                       */
/* ------------------------------------------------------------------ */

test('small talk is never a weather question with a place in it', () => {
  for (const text of ['mera dost aaya hai', 'mujhe cricket pasand hai', 'cricket kaise khelte hain?', 'my friend is here', 'मेरा दोस्त आया है']) {
    for (const s of [null, standing()]) {
      assert.equal(namedPlace(read(text, s)), null, text);
      // And with no model to ask, it is asked about — not answered with weather.
      const fallback = fallbackPlan(text, { standing: s, today: TODAY });
      assert.equal(fallback.act, 'unclear', `${text}: ${JSON.stringify(fallback)}`);
    }
  }
  for (const [text, kind] of [['thanks', 'thanks'], ['ok', 'acknowledgement'], ['वाह', 'reaction']] as const) {
    assert.deepEqual(read(text, standing()), { act: 'social', kind });
  }
});

/* ------------------------------------------------------------------ */
/* 6. No model available                                               */
/* ------------------------------------------------------------------ */

test('with no model, weather advice keeps the conversation’s place and its time', () => {
  const s = standing();
  for (const [text, window] of [
    ['Can I play cricket with my friend tomorrow evening?', day(1, 'evening')],
    ['kya main apne dost ke saath cricket khel sakta hoon kal shaam ko?', day(1, 'evening')],
    ['should I go to the office tomorrow?', day(1)],
    ['बच्चों को कल स्कूल भेजूँ?', day(1)],
  ] as const) {
    const plan = fallbackPlan(text, { standing: s, today: TODAY });
    assert.equal(plan.act, 'weather', text);
    if (plan.act !== 'weather') continue;
    assert.deepEqual(plan.place, { kind: 'carried' }, text);
    assert.deepEqual(plan.window, window, text);
    // With no conversation, it asks where — it does not guess a place.
    const fresh = fallbackPlan(text, { standing: null, today: TODAY });
    assert.ok(fresh.act === 'weather' && fresh.place.kind === 'none', `${text} (fresh)`);
  }
});

test('with no model, an unknown name in a real place slot is asked about, never geocoded or swapped', () => {
  const plan = fallbackPlan('will it rain in Rampur Khas tomorrow?', { standing: standing(), today: TODAY });
  assert.deepEqual(plan, { act: 'unclear', maybePlace: 'Rampur Khas' });
});

/* ------------------------------------------------------------------ */
/* 7. The classifier's reading, checked                                */
/* ------------------------------------------------------------------ */

const raw = (over: Partial<Parameters<typeof toPlan>[0]> = {}): Parameters<typeof toPlan>[0] => ({
  act: 'weather',
  social: '',
  place: '',
  placeIsHere: false,
  usesContext: false,
  topic: '',
  dayOffset: 0,
  pastDays: 0,
  pastHours: 0,
  date: '',
  lastRain: false,
  beforePrevious: false,
  variable: '',
  ...over,
});

test('the classifier reading no place carries the conversation’s, with the part of the day read from the words', () => {
  const ctx = { standing: standing(), today: TODAY };
  const text = 'क्या मैं अपने दोस्त के साथ क्रिकेट खेल सकता हूँ कल शाम को?';
  const plan = toPlan(raw({ topic: 'forecast', dayOffset: 1 }), text, ctx);
  assert.ok(plan.act === 'weather');
  if (plan.act !== 'weather') return;
  assert.deepEqual(plan.place, { kind: 'carried' });
  assert.deepEqual(plan.window, day(1, 'evening'));
});

test('a follow-up read by the classifier keeps the part of the day it inherits or names', () => {
  const ctx = { standing: standing({ timeWindow: day(1, 'evening') }), today: TODAY };
  const inherited = toPlan(raw({ usesContext: true, variable: 'wind' }), 'and the wind then?', ctx);
  assert.ok(inherited.act === 'weather' && inherited.window.kind === 'day' && inherited.window.part === 'evening');
  const narrowed = toPlan(raw({ usesContext: true }), 'and in the morning, can we go?', ctx);
  assert.ok(narrowed.act === 'weather');
  if (narrowed.act === 'weather') assert.deepEqual(narrowed.window, day(1, 'morning'));
});

test('a place from the classifier must be the person’s own words, and a name', () => {
  assert.equal(verbatimPlace('कल गाज़ियाबाद में बारिश', 'Ghaziabad'), null, 'no transliteration');
  assert.equal(plausiblePlace('kal'), null);
  assert.equal(plausiblePlace('shaam'), null);
  assert.equal(plausiblePlace('barish mein'), null);
  assert.equal(plausiblePlace('Rampur Khas'), 'Rampur Khas');
  const ctx = { standing: standing(), today: TODAY };
  const timeAsPlace = toPlan(raw({ place: 'shaam', dayOffset: 1 }), 'kal shaam barish hogi?', ctx);
  assert.ok(timeAsPlace.act === 'weather' && timeAsPlace.place.kind === 'carried', 'a time the model called a place is not one');
});

/* ------------------------------------------------------------------ */
/* 8. Whole conversations, through the real pipeline                   */
/* ------------------------------------------------------------------ */

const NOW = new Date('2026-09-24T12:30:00Z');

function location(name: string, hindi: string): Location & { hindi: string } {
  return {
    name,
    hindi,
    admin1: 'Uttar Pradesh',
    admin2: name,
    country: 'India',
    countryCode: 'IN',
    latitude: 28.6,
    longitude: 77.4,
    timezone: 'Asia/Kolkata',
    resolvedBy: 'test gazetteer',
    endpoint: 'test',
  };
}

const PLACES = [location('Ghaziabad', 'गाजियाबाद'), location('Noida', 'नोएडा'), location('Lucknow', 'लखनऊ')];

type Classify = AnswerDeps['classify'];

function pipeline(classify: Classify = async () => null, options: { renderMs?: number } = {}) {
  const calls = { resolve: [] as string[], render: [] as ReplyRequest[] };
  const deps: Partial<AnswerDeps> = {
    now: () => NOW,
    classify,
    resolvePlace: async (query: string): Promise<Location | NoData> => {
      calls.resolve.push(query);
      const hit = PLACES.find((p) => p.name.toLowerCase() === query.trim().toLowerCase() || p.hindi === query.trim());
      return (
        hit ?? {
          kind: 'noData',
          reason: 'unknownPlace',
          source: 'test',
          endpoint: 'test',
          checkedAt: NOW.toISOString(),
          statement: { hi: `"${query}" नहीं मिला।`, en: `No place matched "${query}".` },
        }
      );
    },
    snapshot: async (place: Location): Promise<WeatherSnapshot> => {
      const provenance = { source: 'Open-Meteo', endpoint: '/v1/forecast', issuedAt: '2026-09-24T17:45:00+05:30', timeBasis: 'updated' as const, nature: 'model' as const };
      return {
        place,
        current: { kind: 'reading', conditionCode: 2, measurements: [{ key: 'temperature', value: 30.4, unit: '°C' }], provenance },
        outlook: {
          kind: 'forecast',
          days: [
            { date: '2026-09-24', conditionCode: 2, maxTemp: 33.1, minTemp: 26.2, precipitationSum: 0, maxWind: 12, precipitationProbability: 10 },
            { date: '2026-09-25', conditionCode: 61, maxTemp: 31.2, minTemp: 25.4, precipitationSum: 5.1, maxWind: 19, precipitationProbability: 75 },
            { date: '2026-09-26', conditionCode: 3, maxTemp: 32.7, minTemp: 25.8, precipitationSum: 0.2, maxWind: 11, precipitationProbability: 20 },
          ],
          units: { temperature: '°C', precipitation: 'mm', wind: 'km/h', probability: '%' },
          provenance,
        },
        warnings: { kind: 'noWarning', source: 'IMD', endpoint: 'imd', issuedAt: '2026-09-24T13:00:00+05:30', checkedAt: NOW.toISOString(), timeBasis: 'issued' },
        fetchedAt: NOW.toISOString(),
      };
    },
    forecast: async () => ({ kind: 'noData', reason: 'lookupFailed', source: 't', endpoint: 't', checkedAt: '', statement: { hi: '', en: '' } }),
    history: async () => ({ kind: 'noData', reason: 'lookupFailed', source: 't', endpoint: 't', checkedAt: '', statement: { hi: '', en: '' } }),
    render: async (req: ReplyRequest): Promise<ReplyResult> => {
      calls.render.push(req);
      if (options.renderMs) await new Promise((resolve) => setTimeout(resolve, options.renderMs));
      return { text: req.fallback, fromModel: false, gate: 'skipped', latencyMs: 0 };
    },
  };

  let current: StandingQuery | null = null;
  const history: Message[] = [];
  let n = 0;
  async function say(text: string): Promise<ChatReply> {
    n += 1;
    history.push({ id: `u${n}`, role: 'user', text, lang: 'hi', at: NOW.toISOString() });
    const { reply } = await answerQuestion({ question: text, lang: 'hi', assistant: 'auto', history: [...history], standing: current, coords: null }, deps);
    current = reply.standing;
    history.push({ id: `a${n}`, role: 'assistant', text: reply.text, lang: reply.lang, at: NOW.toISOString() });
    return reply;
  }
  return { say, calls };
}

test('the reported dialogue, end to end: the second question is about Ghaziabad tomorrow evening, and दोस्त is never resolved', async () => {
  const c = pipeline();
  const first = await c.say('कल गाजियाबाद में बारिश होगी क्या?');
  assert.equal(first.grounding?.place.name, 'Ghaziabad');

  const second = await c.say('क्या मैं अपने दोस्त के साथ क्रिकेट खेल सकता हूँ कल शाम को?');
  assert.equal(second.meta.act, 'weather');
  assert.equal(second.grounding?.place.name, 'Ghaziabad', 'the conversation’s place, reused');
  assert.deepEqual(c.calls.resolve, ['गाजियाबाद', 'गाजियाबाद'], 'only the real place ever reached the resolver');

  const shown = c.calls.render[c.calls.render.length - 1];
  const facts = shown.facts as { asked: { when: string } };
  assert.match(facts.asked.when, /tomorrow.*evening/, 'the renderer is told it was tomorrow evening');
  assert.ok(shown.turn?.some((note) => /whole day/.test(note)), 'and that the figures are for the whole day');
  assert.equal(second.standing?.timeWindow.kind, 'day');
  assert.deepEqual(second.standing?.timeWindow, day(1, 'evening'), 'the conversation remembers the evening');
});

test('end to end, the classifier reads the advice and the place is carried — never extracted from the sentence', async () => {
  const classifyCalls: string[] = [];
  const c = pipeline(async (message, ctx) => {
    classifyCalls.push(message);
    return { plan: toPlan(raw({ topic: 'forecast', dayOffset: 1 }), message, ctx), cacheHit: false };
  });
  await c.say('kal ghaziabad mein barish hogi?');
  for (const text of ['kal office mein baarish hogi?', 'will it rain at home tomorrow?', 'kal shaadi mein barish to nahi hogi?']) {
    const reply = await c.say(text);
    assert.equal(reply.grounding?.place.name, 'Ghaziabad', text);
  }
  assert.equal(classifyCalls.length, 3, 'each uncertain turn went to the classifier');
  assert.ok(c.calls.resolve.every((q) => q.toLowerCase() === 'ghaziabad'), `resolved: ${c.calls.resolve.join(', ')}`);
});

test('end to end, a follow-up refines the time and keeps the place; an explicit change moves it', async () => {
  const c = pipeline();
  await c.say('kal ghaziabad mein barish hogi?');
  const evening = await c.say('aur shaam ko?');
  assert.equal(evening.grounding?.place.name, 'Ghaziabad');
  assert.deepEqual(evening.standing?.timeWindow, day(1, 'evening'));

  const moved = await c.say('what about Noida?');
  assert.equal(moved.grounding?.place.name, 'Noida');
  assert.deepEqual(moved.standing?.timeWindow, day(1, 'evening'), 'the question carries to the new place');

  const corrected = await c.say('nahi, Lucknow');
  assert.equal(corrected.grounding?.place.name, 'Lucknow');
});

test('end to end, with no conversation the advice asks where — and resolves nothing', async () => {
  const c = pipeline();
  const reply = await c.say('क्या मैं अपने दोस्त के साथ क्रिकेट खेल सकता हूँ कल शाम को?');
  assert.equal(reply.needsLocation, true);
  assert.deepEqual(c.calls.resolve, []);
});

test('end to end, with no model an unknown name in a place slot is asked about, not resolved', async () => {
  const c = pipeline();
  await c.say('kal ghaziabad mein barish hogi?');
  const reply = await c.say('kal office mein baarish hogi?');
  assert.equal(reply.meta.act, 'unclear');
  assert.deepEqual(c.calls.resolve, ['ghaziabad'], '"office" never reached the resolver');
});

/* ------------------------------------------------------------------ */
/* 9. Answering while the classifier reads                              */
/* ------------------------------------------------------------------ */

const ADVICE = 'Can I play cricket with my friend tomorrow evening?';
const later = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

test('advice is written while the classifier reads, and ships when it agrees — the wait is the longer of the two, not both', async () => {
  const c = pipeline(
    (message, ctx) => later(300, { plan: toPlan(raw({ topic: 'forecast', dayOffset: 1 }), message, ctx), cacheHit: false }),
    { renderMs: 250 },
  );
  await c.say('kal ghaziabad mein barish hogi?');
  const renders = c.calls.render.length;
  const logged = queryStats().total;

  const began = Date.now();
  const reply = await c.say(ADVICE);
  const took = Date.now() - began;

  assert.equal(reply.grounding?.place.name, 'Ghaziabad');
  assert.deepEqual(reply.standing?.timeWindow, day(1, 'evening'));
  assert.equal(reply.meta.parseLayer, 'llm', 'credited to the classifier that confirmed it');
  assert.equal(c.calls.render.length - renders, 1, 'written once');
  assert.equal(queryStats().total - logged, 1, 'logged once');
  assert.ok(took < 500, `took ${took} ms: the classifier (300) and the answer (250) ran together`);
});

test('when the classifier disagrees, the early answer is dropped and its plan is answered', async () => {
  const c = pipeline(
    (message, ctx) => later(200, { plan: toPlan(raw({ place: 'Noida', topic: 'forecast', dayOffset: 1 }), message, ctx), cacheHit: false }),
    { renderMs: 50 },
  );
  await c.say('kal ghaziabad mein barish hogi?');
  const logged = queryStats().total;
  const reply = await c.say('can I play cricket at Noida tomorrow with my friend?');
  assert.equal(reply.grounding?.place.name, 'Noida', 'the classifier decides the place');
  assert.equal(queryStats().total - logged, 1, 'the dropped answer is never logged as served');
});

test('a reading from the cache comes back at once, and nothing is written early', async () => {
  const c = pipeline(async (message, ctx) => ({ plan: toPlan(raw({ topic: 'forecast', dayOffset: 1 }), message, ctx), cacheHit: true }));
  await c.say('kal ghaziabad mein barish hogi?');
  const renders = c.calls.render.length;
  const reply = await c.say(ADVICE);
  assert.equal(reply.meta.parseLayer, 'cache');
  assert.equal(c.calls.render.length - renders, 1);
});

test('with no conversation there is no place to guess, so nothing is written early', async () => {
  const c = pipeline((message, ctx) => later(100, { plan: toPlan(raw({ topic: 'forecast', dayOffset: 1 }), message, ctx), cacheHit: false }));
  const reply = await c.say(ADVICE);
  assert.equal(reply.needsLocation, true);
  assert.equal(c.calls.render.length, 0);
  assert.deepEqual(c.calls.resolve, []);
});

test('the classifier narrowing the topic ("umbrella" → rain) still confirms an answer written about all the weather', async () => {
  const c = pipeline(
    (message, ctx) => later(150, { plan: toPlan(raw({ topic: 'forecast', dayOffset: 1, variable: 'rain' }), message, ctx), cacheHit: false }),
    { renderMs: 50 },
  );
  await c.say('kal ghaziabad mein barish hogi?');
  const renders = c.calls.render.length;
  const reply = await c.say('should I carry an umbrella to college tomorrow evening?');
  assert.equal(reply.grounding?.place.name, 'Ghaziabad');
  assert.equal(c.calls.render.length - renders, 1, 'the early answer shipped');
});
