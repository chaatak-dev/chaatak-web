/**
 * The floor is held to the same gate as the model.
 *
 * A template is what ships when the model is out or rejected, so it is the
 * text a person gets at exactly the moments something else went wrong. If a
 * template could state a number the facts do not hold, or fail to open with
 * a severity, the fallback would be the least safe path in the product. So
 * every template, in every register, for every kind of question, is run
 * through `verifyReply` against the very facts it was built from.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verifyReply } from './chat-gate';
import { weatherTemplate } from './templates';
import { GAZETTEER } from '../parse/gazetteer';
import { severityWords } from '../alerts/templates';
import type { TemplateLang } from '../i18n/detect';
import type { WeatherPlan } from '../chat/understand';
import {
  currentFacts,
  describeAsked,
  focusDates,
  historyFacts,
  historyNature,
  outlookFacts,
  type TurnFacts,
} from '../chat/turn-facts';
import type { HistoryResult } from '../chat/history-answer';
import { rainSpells, lastHours, summariseDays, shiftIso } from '../weather/history';
import type { Forecast, History, Reading, Severity } from '../weather/types';
import type { WarningFacts } from '../chat/facts';

const TODAY = '2026-09-22';
const NOW = new Date('2026-09-22T12:30:00Z');
const TZ = 'Asia/Kolkata';

const reading: Reading = {
  kind: 'reading',
  conditionCode: 63,
  measurements: [
    { key: 'temperature', value: 29.4, unit: '°C' },
    { key: 'apparentTemperature', value: 33.8, unit: '°C' },
    { key: 'humidity', value: 88, unit: '%' },
    { key: 'precipitation', value: 1.7, unit: 'mm' },
    { key: 'windSpeed', value: 16.2, unit: 'km/h' },
  ],
  provenance: { source: 'Open-Meteo', endpoint: 'x', issuedAt: '2026-09-22T17:45:00+05:30', timeBasis: 'updated', nature: 'model' },
};

const forecast: Forecast = {
  kind: 'forecast',
  days: [
    { date: '2026-09-22', conditionCode: 63, maxTemp: 31.1, minTemp: 25.3, precipitationSum: 11.6, maxWind: 21.7, precipitationProbability: 90 },
    { date: '2026-09-23', conditionCode: 61, maxTemp: 30.4, minTemp: 24.9, precipitationSum: 5.8, maxWind: 18.4, precipitationProbability: 75 },
    { date: '2026-09-24', conditionCode: 3, maxTemp: 32.2, minTemp: 25.7, precipitationSum: null, maxWind: 11.3, precipitationProbability: 15 },
  ],
  units: { temperature: '°C', precipitation: 'mm', wind: 'km/h', probability: '%' },
  provenance: reading.provenance,
};

function hours() {
  const end = '2026-09-22T18:00:00+05:30';
  return Array.from({ length: 72 }, (_, i) => {
    const time = shiftIso(end, i - 71);
    const mm = time.startsWith('2026-09-21T09') ? 4.3 : time.startsWith('2026-09-21T10') ? 2.2 : time.startsWith('2026-09-22T06') ? 0.2 : 0;
    return { time, precipitation: mm, rain: mm, temperature: 27 };
  });
}

const history: History = {
  kind: 'history',
  hours: hours(),
  days: [
    { date: '2026-09-20', conditionCode: 3, maxTemp: 33.3, minTemp: 26.1, precipitationSum: 0, rainSum: 0, precipitationHours: 0, maxWind: 8.8 },
    { date: '2026-09-21', conditionCode: 63, maxTemp: 30.9, minTemp: 24.4, precipitationSum: 6.5, rainSum: 6.5, precipitationHours: 2, maxWind: 19.1 },
  ],
  units: { precipitation: 'mm', temperature: '°C', wind: 'km/h' },
  from: '2026-09-20',
  to: '2026-09-22',
  provenance: { source: 'Open-Meteo', endpoint: 'x', issuedAt: '2026-09-22T18:00:00+05:30', timeBasis: 'through', nature: 'archivedForecast' },
};

function warnings(severity: Severity | null): WarningFacts {
  if (!severity) return { inForce: [], source: 'IMD', issuedAt: '22 Sep 2026, 13:00 IST' };
  return {
    inForce: [{ severity, hazards: ['Heavy Rain', 'Thunderstorm & Lightning'], when: '22 Sep 2026' }],
    source: 'IMD',
    issuedAt: '22 Sep 2026, 13:00 IST',
  };
}

function plan(over: Partial<WeatherPlan>): WeatherPlan {
  return {
    act: 'weather',
    turn: 'query',
    place: { kind: 'named', text: 'Lucknow' },
    intent: 'current',
    window: { kind: 'now' },
    variable: 'all',
    ...over,
  };
}

function factsFor(p: WeatherPlan, lang: 'hi' | 'en', severity: Severity | null): TurnFacts {
  const base: TurnFacts = {
    asked: { topic: p.intent, variable: p.variable, when: describeAsked(p.window, TODAY) },
    place: { name: 'Lucknow', district: 'Lucknow', state: 'Uttar Pradesh' },
    source: { name: 'Open-Meteo', nature: 'model', issuedAt: reading.provenance.issuedAt, basis: 'updated' },
    warnings: warnings(severity),
  };
  if (p.intent === 'history') {
    let result: HistoryResult;
    switch (p.window.kind) {
      case 'lastEvent': {
        const spells = rainSpells(history.hours);
        result = { kind: 'lastRain', event: spells[0], traceSince: spells[1] ?? null, searchedDays: 14, history };
        break;
      }
      case 'pastHours':
        result = { kind: 'hours', hours: 24, sum: lastHours(history.hours, 24), history };
        break;
      case 'past':
        result = { kind: 'days', from: '2026-09-20', to: '2026-09-21', summary: summariseDays(history.days, '2026-09-20', '2026-09-21'), history };
        break;
      default:
        result = {
          kind: 'day',
          date: '2026-09-21',
          day: history.days[1],
          soFar: null,
          spells: rainSpells(history.hours.filter((h) => h.time.startsWith('2026-09-21'))),
          history,
        };
    }
    base.history = historyFacts(result, { timeZone: TZ, today: TODAY, now: NOW, lang });
    base.historyNature = historyNature(result);
  } else {
    base.current = currentFacts(reading, lang);
    base.outlook = outlookFacts(forecast, TODAY, lang);
    base.focusDays = focusDates(forecast, p.window, TODAY);
  }
  return base;
}

const PLANS: WeatherPlan[] = [
  plan({}),
  plan({ variable: 'temperature' }),
  plan({ variable: 'rain' }),
  plan({ variable: 'wind' }),
  plan({ variable: 'humidity' }),
  plan({ intent: 'forecast', window: { kind: 'day', offset: 1 } }),
  plan({ intent: 'forecast', window: { kind: 'day', offset: 1 }, variable: 'wind' }),
  plan({ intent: 'forecast', window: { kind: 'range', days: 3 }, variable: 'rain' }),
  plan({ intent: 'forecast', window: { kind: 'day', offset: 9 } }),
  plan({ intent: 'warning' }),
  plan({ intent: 'history', window: { kind: 'lastEvent' }, variable: 'rain' }),
  plan({ intent: 'history', window: { kind: 'lastEvent', before: '2026-09-22T05:00:00+05:30' }, variable: 'rain' }),
  plan({ intent: 'history', window: { kind: 'pastHours', hours: 24 }, variable: 'rain' }),
  plan({ intent: 'history', window: { kind: 'past', days: 2 }, variable: 'rain' }),
  plan({ intent: 'history', window: { kind: 'day', offset: -1 } }),
  plan({ intent: 'history', window: { kind: 'day', offset: -1 }, variable: 'temperature' }),
  plan({ turn: 'correction', rejected: 'Kanpur' }),
];

const LANGS: { lang: TemplateLang; chrome: 'hi' | 'en'; script: 'Deva' | 'Latn'; place: string }[] = [
  { lang: 'en', chrome: 'en', script: 'Latn', place: 'Lucknow' },
  { lang: 'hinglish', chrome: 'en', script: 'Latn', place: 'Lucknow' },
  { lang: 'hi', chrome: 'hi', script: 'Deva', place: 'लखनऊ' },
];

test('every template passes the gate against its own facts — every register, every question', () => {
  for (const severity of [null, 'watch', 'alert', 'warning'] as const) {
    for (const { lang, chrome, script, place } of LANGS) {
      for (const p of PLANS) {
        const facts = factsFor(p, chrome, severity);
        const text = weatherTemplate({ plan: p, facts, lang, place, severity: severity ?? 'none' });
        const severityStrings = severity ? [severityWords(severity, chrome)] : [];
        const verdict = verifyReply(text, {
          facts: facts as Record<string, unknown>,
          places: ['Lucknow', 'लखनऊ', 'Uttar Pradesh', 'Kanpur'],
          severity: severity ?? 'none',
          severityStrings,
          gazetteer: GAZETTEER,
          expectScript: script,
        });
        assert.ok(
          verdict.ok,
          `${lang} / ${p.intent} ${JSON.stringify(p.window)} ${p.variable} / ${severity}: ` +
            `${verdict.ok ? '' : `${verdict.reason} — ${verdict.detail}`}\n${text}`,
        );
      }
    }
  }
});

test('a past question is answered from the past, in words that say it was modelled', () => {
  const p = plan({ intent: 'history', window: { kind: 'lastEvent' }, variable: 'rain' });
  const en = weatherTemplate({ plan: p, facts: factsFor(p, 'en', null), lang: 'en', place: 'Lucknow', severity: 'none' });
  assert.match(en, /last rain in Lucknow was on 21 Sep/);
  assert.match(en, /not a rain gauge/);
  assert.doesNotMatch(en, /29\.4/, 'the present temperature is not in a history answer');

  const hl = weatherTemplate({ plan: p, facts: factsFor(p, 'en', null), lang: 'hinglish', place: 'Lucknow', severity: 'none' });
  assert.match(hl, /aakhri baarish 21 Sep ko hui thi/);
  // The trace after it is reported as a trace, not as the last rain.
  assert.match(hl, /halki boondabaandi/);
});

test('severity leads, in the catalogue words, and is never re-worded', () => {
  const p = plan({ intent: 'forecast', window: { kind: 'day', offset: 1 } });
  for (const { lang, chrome, place } of LANGS) {
    const text = weatherTemplate({ plan: p, facts: factsFor(p, chrome, 'warning'), lang, place, severity: 'warning' });
    assert.ok(text.startsWith(severityWords('warning', chrome)), `${lang}: ${text}`);
  }
});

test('a day past the forecast says so rather than inventing one', () => {
  const p = plan({ intent: 'forecast', window: { kind: 'day', offset: 9 } });
  const facts = factsFor(p, 'en', null);
  facts.horizonDays = 3;
  assert.match(
    weatherTemplate({ plan: p, facts, lang: 'en', place: 'Lucknow', severity: 'none' }),
    /only reaches 3 days ahead/,
  );
});
