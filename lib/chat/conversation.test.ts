/**
 * Whole conversations, through the real pipeline, with the outside world
 * replaced: a place resolver that knows five cities, a weather source with a
 * scripted history, and a renderer that records what it was shown.
 *
 * These are the dialogues the product was getting wrong. Each turn feeds the
 * next exactly as the web client does — the standing query and the growing
 * history — so what is tested is the conversation, not a single parse.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { answerQuestion, type AnswerDeps, type ChatReply } from './answer';
import type { ReplyRequest, ReplyResult } from '../render/reply';
import type { Message, StandingQuery } from './types';
import type { WeatherSnapshot } from '../weather/api';
import type { History, HistoryHour, HistoryRequest, Location, NoData, Warning } from '../weather/types';
import { shiftIso } from '../weather/history';

/** Tuesday 22 Sep 2026, 18:00 IST. */
const NOW = new Date('2026-09-22T12:30:00Z');

function location(name: string, hindi: string, lat: number): Location & { hindi: string } {
  return {
    name,
    hindi,
    admin1: 'Uttar Pradesh',
    admin2: name,
    country: 'India',
    countryCode: 'IN',
    latitude: lat,
    longitude: 80,
    timezone: 'Asia/Kolkata',
    resolvedBy: 'test gazetteer',
    endpoint: 'test',
  };
}

const PLACES = [
  location('Lucknow', 'लखनऊ', 26.85),
  location('Ghaziabad', 'गाज़ियाबाद', 28.67),
  location('Delhi', 'दिल्ली', 28.61),
  location('Mumbai', 'मुंबई', 19.07),
  location('Kanpur', 'कानपुर', 26.45),
];

/** 22 Sep 18:00 IST, hour-labelled, oldest first; rain on 20 Sep and 17 Sep. */
function hours(): HistoryHour[] {
  const end = '2026-09-22T18:00:00+05:30';
  const series: HistoryHour[] = [];
  for (let i = 14 * 24; i >= 0; i--) {
    const time = shiftIso(end, -i);
    let mm = 0;
    if (time.startsWith('2026-09-20T15') || time.startsWith('2026-09-20T16')) mm = 3.2;
    if (time.startsWith('2026-09-17T02') || time.startsWith('2026-09-17T03')) mm = 1.5;
    series.push({ time, precipitation: mm, rain: mm, temperature: 28 });
  }
  return series;
}

function makeDeps(options: { warnings?: Warning[] } = {}) {
  const calls = { resolve: [] as string[], snapshot: 0, history: [] as HistoryRequest[], render: [] as ReplyRequest[] };

  const deps: Partial<AnswerDeps> = {
    now: () => NOW,
    classify: async () => null, // every provider "out": the pattern layer must carry these
    resolvePlace: async (query: string): Promise<Location | NoData> => {
      calls.resolve.push(query);
      const hit = PLACES.find(
        (p) => p.name.toLowerCase() === query.trim().toLowerCase() || p.hindi === query.trim(),
      );
      if (hit) return hit;
      return {
        kind: 'noData',
        reason: 'unknownPlace',
        source: 'test',
        endpoint: 'test',
        checkedAt: NOW.toISOString(),
        statement: { hi: `"${query}" से कोई जगह नहीं मिली।`, en: `No place matched "${query}".` },
      };
    },
    snapshot: async (place: Location): Promise<WeatherSnapshot> => {
      calls.snapshot += 1;
      const provenance = {
        source: 'Open-Meteo',
        endpoint: '/v1/forecast',
        issuedAt: '2026-09-22T17:45:00+05:30',
        timeBasis: 'updated' as const,
        nature: 'model' as const,
      };
      return {
        place,
        current: {
          kind: 'reading',
          conditionCode: 2,
          measurements: [
            { key: 'temperature', value: 31.2, unit: '°C' },
            { key: 'apparentTemperature', value: 35.1, unit: '°C' },
            { key: 'humidity', value: 70, unit: '%' },
            { key: 'precipitation', value: 0, unit: 'mm' },
            { key: 'windSpeed', value: 9.4, unit: 'km/h' },
          ],
          provenance,
        },
        outlook: {
          kind: 'forecast',
          days: [
            { date: '2026-09-22', conditionCode: 2, maxTemp: 33.4, minTemp: 26.1, precipitationSum: 0, maxWind: 12.5, precipitationProbability: 10 },
            { date: '2026-09-23', conditionCode: 61, maxTemp: 31.8, minTemp: 25.6, precipitationSum: 4.2, maxWind: 18.4, precipitationProbability: 70 },
            { date: '2026-09-24', conditionCode: 3, maxTemp: 32.9, minTemp: 25.9, precipitationSum: 0.3, maxWind: 11.1, precipitationProbability: 20 },
          ],
          units: { temperature: '°C', precipitation: 'mm', wind: 'km/h', probability: '%' },
          provenance,
        },
        warnings: options.warnings ?? {
          kind: 'noWarning',
          source: 'IMD',
          endpoint: 'imd',
          issuedAt: '2026-09-22T13:00:00+05:30',
          checkedAt: NOW.toISOString(),
          timeBasis: 'issued',
        },
        fetchedAt: NOW.toISOString(),
      };
    },
    forecast: async () => ({ kind: 'noData', reason: 'lookupFailed', source: 't', endpoint: 't', checkedAt: '', statement: { hi: '', en: '' } }),
    history: async (_place: Location, request: HistoryRequest): Promise<History | NoData> => {
      calls.history.push(request);
      const all = hours();
      return {
        kind: 'history',
        hours: request.kind === 'recent' ? all : [],
        days: [
          { date: '2026-09-20', conditionCode: 63, maxTemp: 30.1, minTemp: 24.8, precipitationSum: 6.4, rainSum: 6.4, precipitationHours: 2, maxWind: 14 },
          { date: '2026-09-21', conditionCode: 1, maxTemp: 32.6, minTemp: 25.2, precipitationSum: 0, rainSum: 0, precipitationHours: 0, maxWind: 9 },
        ],
        units: { precipitation: 'mm', temperature: '°C', wind: 'km/h' },
        from: '2026-09-08',
        to: '2026-09-22',
        provenance: {
          source: 'Open-Meteo',
          endpoint: '/v1/forecast',
          issuedAt: '2026-09-22T18:00:00+05:30',
          timeBasis: 'through',
          nature: 'archivedForecast',
        },
      };
    },
    // The renderer records what it was shown and ships the template — the
    // same floor a real outage lands on.
    render: async (req: ReplyRequest): Promise<ReplyResult> => {
      calls.render.push(req);
      return { text: req.fallback, fromModel: false, gate: 'skipped', latencyMs: 0 };
    },
  };

  return { deps, calls };
}

/** A conversation driver that behaves like the web client between turns. */
function conversation(options: { warnings?: Warning[] } = {}) {
  const { deps, calls } = makeDeps(options);
  let standing: StandingQuery | null = null;
  const history: Message[] = [];
  let n = 0;

  async function say(text: string, extra: { coords?: { latitude: number; longitude: number } } = {}): Promise<ChatReply> {
    n += 1;
    history.push({ id: `u${n}`, role: 'user', text, lang: 'en', at: NOW.toISOString() });
    const { reply } = await answerQuestion(
      { question: text, lang: 'en', assistant: 'auto', history: [...history], standing, coords: extra.coords ?? null },
      deps,
    );
    standing = reply.standing;
    history.push({ id: `a${n}`, role: 'assistant', text: reply.text, lang: reply.lang, script: reply.script, at: NOW.toISOString() });
    // PRINT_REPLIES=1 prints the dialogue, for reading the wording itself.
    if (process.env.PRINT_REPLIES) {
      console.log(`  > ${text}\n  < [${reply.lang}-${reply.script} ${reply.meta.act}] ${reply.text}`);
    }
    return reply;
  }

  return { say, calls, standing: () => standing };
}

function lastRender(calls: ReturnType<typeof makeDeps>['calls']): ReplyRequest {
  const req = calls.render[calls.render.length - 1];
  assert.ok(req, 'expected a render');
  return req;
}

/* ------------------------------------------------------------------ */
/* A–F                                                                  */
/* ------------------------------------------------------------------ */

test('A: weather in Lucknow → ohh really → and tomorrow? → what about wind?', async () => {
  const c = conversation();

  const first = await c.say('weather in Lucknow');
  assert.equal(first.meta.act, 'weather');
  assert.equal(first.grounding?.place.name, 'Lucknow');
  assert.match(first.text, /31\.2°C/);

  const resolvesBefore = c.calls.resolve.length;
  const reaction = await c.say('ohh really');
  assert.equal(reaction.meta.act, 'social');
  assert.equal(reaction.grounding, undefined, 'a reaction reports no values');
  assert.equal(c.calls.resolve.length, resolvesBefore, 'a reaction is never geocoded');
  assert.doesNotMatch(reaction.text, /No place matched/);
  assert.match(reaction.text, /Lucknow/, 'the reaction reply knows what the conversation is about');

  const tomorrow = await c.say('and tomorrow?');
  assert.equal(tomorrow.grounding?.place.name, 'Lucknow');
  const facts = lastRender(c.calls).facts as { asked: { topic: string; when: string }; focusDays: string[] };
  assert.equal(facts.asked.topic, 'forecast');
  assert.deepEqual(facts.focusDays, ['23 Sep']);
  assert.match(tomorrow.text, /31\.8°C/, 'tomorrow’s high, not today’s');

  const wind = await c.say('what about wind?');
  assert.equal(wind.grounding?.place.name, 'Lucknow');
  const windFacts = lastRender(c.calls).facts as { asked: { variable: string }; focusDays: string[] };
  assert.equal(windFacts.asked.variable, 'wind');
  assert.deepEqual(windFacts.focusDays, ['23 Sep'], 'still tomorrow');
  assert.match(wind.text, /18\.4 km\/h/);
});

test('B: weather in Ghaziabad → last baarish kab hui? → and before that?', async () => {
  const c = conversation();
  await c.say('weather in Ghaziabad');

  const last = await c.say('last baarish kab hui?');
  assert.equal(last.grounding?.place.name, 'Ghaziabad');
  const facts = lastRender(c.calls).facts as Record<string, unknown>;
  assert.equal((facts.asked as { topic: string }).topic, 'history');
  assert.equal('current' in facts, false, 'a past question is never shown the present');
  const lastRain = (facts.history as { lastRain: { day: string; total: number } }).lastRain;
  assert.equal(lastRain.day, '20 Sep');
  assert.equal(lastRain.total, 6.4);
  assert.equal(last.grounding?.provenance.nature, 'archivedForecast');
  assert.equal(last.grounding?.provenance.timeBasis, 'through');
  // Hinglish in, Hinglish out — including on the template floor.
  assert.equal(last.lang, 'hi');
  assert.equal(last.script, 'Latn');
  assert.match(last.text, /aakhri baarish 20 Sep ko hui thi/);

  const before = await c.say('and before that?');
  const earlier = (lastRender(c.calls).facts as { history: { lastRain: { day: string } } }).history.lastRain;
  assert.equal(earlier.day, '17 Sep', 'walked back past the event already reported');
  assert.equal(before.script, 'Latn', 'a short English follow-up keeps the Hinglish conversation');
});

test('C: weather in Delhi → actually Mumbai → tomorrow?', async () => {
  const c = conversation();
  await c.say('weather in Delhi');

  const mumbai = await c.say('actually Mumbai');
  assert.equal(mumbai.grounding?.place.name, 'Mumbai');
  assert.match(mumbai.text, /^Got it\. Mumbai:/, 'acknowledged once, named once');

  const tomorrow = await c.say('tomorrow?');
  assert.equal(tomorrow.grounding?.place.name, 'Mumbai');
  assert.equal((lastRender(c.calls).facts as { asked: { topic: string } }).asked.topic, 'forecast');
});

test('D: wassup → weather in Lucknow', async () => {
  const c = conversation();
  const hi = await c.say('wassup');
  assert.equal(hi.meta.act, 'social');
  assert.equal(c.calls.resolve.length, 0, 'a greeting resolves nothing');
  assert.equal(c.calls.snapshot, 0, 'and fetches nothing');
  assert.doesNotMatch(hi.text, /No place matched/);

  const lucknow = await c.say('weather in Lucknow');
  assert.equal(lucknow.grounding?.place.name, 'Lucknow');
});

test('E: कल बारिश हुई थी क्या? → और कल?', async () => {
  const c = conversation();
  const past = await c.say('कल बारिश हुई थी क्या?');
  assert.equal(past.needsLocation, true, 'no place named: ask, do not guess');
  assert.equal(past.script, 'Deva');
  assert.equal(c.standing()?.pending?.intent, 'history');

  const next = await c.say('और कल?');
  assert.equal(next.needsLocation, true);
  assert.equal(next.script, 'Deva', 'Devanagari stays Devanagari');
  assert.equal(c.standing()?.pending?.intent, 'forecast', 'the other कल');
  assert.equal(c.standing()?.pending?.variable, 'rain');

  // A place arrives, and answers the waiting question rather than starting over.
  const place = await c.say('लखनऊ');
  assert.equal(place.grounding?.place.name, 'Lucknow');
  assert.equal((lastRender(c.calls).facts as { asked: { topic: string } }).asked.topic, 'forecast');
  assert.match(place.text, /लखनऊ/);
});

test('F: ghaziabad mein weather → wait, I meant Lucknow', async () => {
  const c = conversation();
  const first = await c.say('ghaziabad mein weather');
  assert.equal(first.grounding?.place.name, 'Ghaziabad');
  assert.equal(first.script, 'Latn');

  const fix = await c.say('wait, I meant Lucknow');
  assert.equal(fix.grounding?.place.name, 'Lucknow');
});

/* ------------------------------------------------------------------ */
/* Language continuity                                                 */
/* ------------------------------------------------------------------ */

test('the spec’s language regressions', async () => {
  const cases: [string, string, string][] = [
    ['last baarish kab hui thi ghaziabad mein', 'hi', 'Latn'],
    ['ghaziabad mein aaj weather kaisa hai?', 'hi', 'Latn'],
    ['what was the weather yesterday in Lucknow?', 'en', 'Latn'],
    ['कल बारिश हुई थी क्या?', 'hi', 'Deva'],
  ];
  for (const [question, code, script] of cases) {
    const c = conversation();
    const reply = await c.say(question);
    assert.equal(reply.lang, code, question);
    assert.equal(reply.script, script, question);
  }
});

test('after a Hinglish answer, "ohh really" stays Hinglish whatever the UI is', async () => {
  const c = conversation();
  await c.say('ghaziabad mein aaj weather kaisa hai?');
  const reaction = await c.say('ohh really');
  assert.equal(reaction.lang, 'hi');
  assert.equal(reaction.script, 'Latn');
  assert.match(reaction.text, /Haan|Yeh/);
  assert.equal(reaction.speakAs, 'en', 'Latin letters are read by a Latin voice');
});

test('"Hindi mein batao" switches the conversation and holds', async () => {
  const c = conversation();
  await c.say('weather in Lucknow');
  const ack = await c.say('Hindi mein batao');
  assert.equal(ack.meta.act, 'language');
  assert.equal(ack.script, 'Deva');
  const next = await c.say('and tomorrow?');
  assert.equal(next.script, 'Deva', 'the request holds for the next turn');
  assert.match(next.text, /लखनऊ|Lucknow/);
});

/* ------------------------------------------------------------------ */
/* History never falls back                                            */
/* ------------------------------------------------------------------ */

test('a history question with no record says so — it never reaches for now or the forecast', async () => {
  const { deps, calls } = makeDeps();
  deps.history = async () => ({
    kind: 'noData',
    reason: 'lookupFailed',
    source: 'Open-Meteo',
    endpoint: '/v1/forecast',
    checkedAt: NOW.toISOString(),
    statement: { hi: 'स्रोत से संपर्क नहीं हो सका।', en: 'The source could not be reached.' },
  });
  const { reply } = await answerQuestion(
    { question: 'when did it last rain in Lucknow?', lang: 'en', assistant: 'auto', history: [], standing: null, coords: null },
    deps,
  );
  const facts = calls.render[0].facts as Record<string, unknown>;
  assert.deepEqual(facts.history, { unavailable: 'The source could not be reached.' });
  assert.equal('current' in facts, false);
  assert.equal('outlook' in facts, false);
  assert.match(reply.text, /could not be reached/);
  assert.doesNotMatch(reply.text, /31\.2/, 'the present temperature is not an answer to the past');
});

test('rainfall over the last 24 hours, the last 7 days, and yesterday', async () => {
  for (const [question, kind] of [
    ['rainfall in the last 24 hours in Lucknow', 'hours'],
    ['how much did it rain in the last 7 days in Lucknow', 'days'],
    ['what was the temperature yesterday in Lucknow', 'day'],
  ] as const) {
    const c = conversation();
    await c.say(question);
    const facts = lastRender(c.calls).facts as { history: { kind: string } };
    assert.equal(facts.history.kind, kind, question);
  }
});

/* ------------------------------------------------------------------ */
/* Safety: severity is carried into every answer                        */
/* ------------------------------------------------------------------ */

test('under an orange warning the answer is told to open with it, and the template does', async () => {
  const warning: Warning = {
    kind: 'warning',
    id: 'W1',
    code: '2',
    severity: 'alert',
    district: 'Lucknow' as Warning['district'],
    validFrom: '2026-09-22T00:00:00+05:30',
    validTo: '2026-09-22T23:59:00+05:30',
    provenance: { source: 'IMD', endpoint: 'imd', issuedAt: '2026-09-22T13:00:00+05:30', timeBasis: 'issued', nature: 'bulletin' },
  };
  const c = conversation({ warnings: [warning] });
  const reply = await c.say('can I play cricket in Lucknow today?');
  const req = lastRender(c.calls);
  assert.deepEqual(req.severityStrings, ['Orange warning'], 'the structural defence is wired in');
  assert.equal(req.severity, 'alert');
  assert.ok(reply.text.startsWith('Orange warning'), reply.text);
  assert.equal(c.standing()?.severity, 'alert', 'carried, so a later "ohh really" is checked too');
});
