import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyse } from './analyse';
import { explainAnalysis, explainPayload, verifyExplanation } from './explain';
import { defaultQuery } from './params';
import { syntheticArchive } from './synthetic';
import type { ClimateAnalysis } from './types';
import type { CompletionResult, LanguageModel } from '../llm/types';

/**
 * "Explain this analysis" may explain; it may not originate a statistic.
 *
 * Each rejection below is a way a fluent paragraph could put a number, a
 * cause or a category error under Chaatak's name that the data does not
 * support. Each acceptance is a normal paragraph the gate must not refuse,
 * because a gate that refuses true statements gets switched off.
 */

function analysis(): ClimateAnalysis {
  const query = { ...defaultQuery(new Date('2026-09-25T00:00:00Z')), place: 'Jaipur', params: ['tMean' as const, 'precip' as const] };
  const archive = syntheticArchive(1991, 2025, {
    temperature_2m_mean: (_, year) => 20 + 0.2 * (year - 1991),
    precipitation_sum: (_, __, month, day) => (day === 1 ? 10 : month === 7 && day === 15 ? 70 : 0),
  });
  return {
    kind: 'analysis',
    query,
    place: { name: 'Jaipur', district: 'Jaipur', state: 'Rajasthan', latitude: 26.926, longitude: 75.8235, resolvedBy: 'test' },
    ...analyse(archive, query),
    provenance: {
      source: 'Open-Meteo',
      dataset: 'ERA5',
      nature: 'reanalysis',
      endpoint: '/v1/archive',
      issuedAt: '2025-12-31',
      timeBasis: 'through',
      fetchedAt: '2026-09-25T00:00:00Z',
      grid: { latitude: 27, longitude: 75.75, elevation: 442 },
    },
  };
}

const PLACES = ['Jaipur', 'Rajasthan', 'जयपुर', 'India', 'भारत'];

function check(text: string, lang: 'en' | 'hi' = 'en') {
  const a = analysis();
  return verifyExplanation(text, explainPayload(a, lang), PLACES, lang);
}

test('a grounded paragraph passes, including a magnitude restated with a direction', () => {
  // 2025 is 26.8 °C against a 22.9 °C baseline: 3.9 warmer. Every figure is one the model was given.
  const verdict = check(
    'In Jaipur, the average temperature in 2025 was 26.8 °C, which is 3.9 °C above the 1991–2020 baseline of 22.9 °C. ' +
      'Over 2016–2025 it averaged 25.9 °C, 3 °C above that. The coolest year was 1991, at 20 °C. The rise is clear, at 2 °C per decade. Rainfall stayed near 190 mm a year.',
  );
  assert.deepEqual(verdict, { ok: true });
});

test('an invented number is rejected — in Latin or Devanagari digits', () => {
  const latin = check('In Jaipur, 2025 was 27.4 °C on average.');
  assert.equal(latin.ok, false);
  assert.equal(!latin.ok && latin.rule, 'unknownNumber');

  const deva = check('जयपुर में 2025 का औसत तापमान २७.४ °C रहा।', 'hi');
  assert.equal(deva.ok, false);
  assert.equal(!deva.ok && deva.rule, 'unknownNumber');
});

test('a number the model worked out for itself is rejected, even if the arithmetic is right', () => {
  // 26.8 − 20 = 6.8, true but never computed by the analysis.
  const verdict = check('Jaipur warmed by 6.8 °C between 1991 and 2025.');
  assert.equal(!verdict.ok && verdict.rule, 'unknownNumber');
});

test('a value spelled out in words is rejected', () => {
  const verdict = check('Jaipur was about twenty degrees on average.');
  assert.equal(!verdict.ok && verdict.rule, 'numberWord');
});

test('any cause is rejected, in either language, as a whole word only', () => {
  const en = check('This rise in Jaipur is because of climate change.');
  assert.equal(!en.ok && en.rule, 'causalClaim');

  const hi = check('जयपुर में यह बढ़ोतरी जलवायु परिवर्तन के कारण है।', 'hi');
  assert.equal(!hi.ok && hi.rule, 'causalClaim');

  // "carbonated" contains "carbon" and is not a cause.
  const substring = check('Jaipur stayed near 190 mm of rain, drinks carbonated or not.');
  assert.deepEqual(substring, { ok: true });
});

test('calling reanalysis a station reading is rejected', () => {
  const verdict = check('The Jaipur station recorded 26.8 °C in 2025.');
  assert.equal(!verdict.ok && verdict.rule, 'stationClaim');
});

test('another place is rejected', () => {
  const verdict = check('Jaipur was warmer than Delhi in 2025.');
  assert.equal(!verdict.ok && verdict.rule, 'unknownPlace');
});

test('an English explanation for a Hindi reader is rejected', () => {
  const verdict = check('In Jaipur, 2025 was 26.8 °C on average.', 'hi');
  assert.equal(!verdict.ok && verdict.rule, 'scriptSwitched');
});

test('the model is shown statistics only — no daily series', () => {
  const payload = explainPayload(analysis(), 'en');
  const json = JSON.stringify(payload);
  assert.ok(json.length < 6000, `payload is ${json.length} bytes`);
  assert.ok(json.includes('reanalysis'));
  assert.ok(!json.includes('"monthly"'));
});

function model(text: string | null, calls: string[] = []): LanguageModel {
  return {
    name: 'fake',
    model: 'fake-1',
    configured: () => text !== null,
    async complete(request): Promise<CompletionResult> {
      calls.push(request.user);
      return { kind: 'ok', text: text ?? '', provider: 'fake', model: 'fake-1', latencyMs: 1 };
    },
  };
}

test('an explanation that passes is shipped; one that fails is withheld whole', async () => {
  const a = analysis();
  const good = await explainAnalysis(a, 'en', {
    models: [model('Jaipur averaged 22.9 °C over 1991–2020 and 26.8 °C in 2025.')],
  });
  assert.equal(good.kind, 'explanation');

  // A fresh query key, so the cached good answer is not reused.
  const other = { ...a, query: { ...a.query, season: 'monsoon' as const } };
  const bad = await explainAnalysis(other, 'en', { models: [model('Jaipur will reach 30.5 °C by 2040.')] });
  assert.deepEqual(bad, { kind: 'unavailable', reason: 'rejected' });
});

test('with no model configured there is no explanation, and nothing else is invented', async () => {
  const a = analysis();
  const none = await explainAnalysis({ ...a, query: { ...a.query, season: 'winter' } }, 'en', { models: [model(null)] });
  assert.deepEqual(none, { kind: 'unavailable', reason: 'noModel' });
});
