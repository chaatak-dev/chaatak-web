/**
 * "Explain this analysis": a plain-language reading of statistics that were
 * already computed, checked before it is shown.
 *
 * The model is handed the verified statistics and nothing else, and asked to
 * explain them. It may say what they mean for a farmer or a planner; it may
 * not produce a number of its own. That is enforced here, programmatically,
 * with the same gate the chat uses:
 *
 *   - every numeral in the explanation must be in the statistics it was given
 *     (Devanagari digits normalised first, so २५ is checked as 25);
 *   - no value written out in words beside a unit;
 *   - no place named that the analysis was not about.
 *
 * And two checks that belong to this page:
 *
 *   - NO CAUSES. A difference from a baseline is a difference. Saying it was
 *     caused by climate change, emissions, El Niño or a growing city is a
 *     claim this data cannot support, so any mention of a cause is rejected
 *     outright — even a hedged one. Over-rejection costs an explanation the
 *     findings already cover; under-rejection puts an attribution under our
 *     name.
 *   - NO STATIONS. The values are reanalysis. Calling them station readings
 *     or gauge measurements is a lie of category.
 *
 * A rejected explanation is discarded whole, logged with its text and the
 * rule that caught it, and replaced by a statement that there is none. It is
 * never repaired, and never partially shown.
 */

import { cached } from '../cache';
import { completeWithFallback } from '../llm/chain';
import { providers } from '../llm/index';
import type { LanguageModel } from '../llm/types';
import { logGateRejection } from '../log';
import { GAZETTEER, HINDI_NAME } from '../parse/gazetteer';
import { buildFacts, verifyRender } from '../render/gate';
import { detectScript } from '../i18n/languages';
import type { InterfaceLang } from '../i18n/languages';
import { devanagariName } from '../weather/gazetteer/match';
import { writeQuery } from './params';
import { EXTREME_PERCENTILE } from './params';
import type { ClimateAnalysis, ExplainResponse, Indicator, ParamAnalysis } from './types';

/** English names the model reads. The page's own labels live in strings.ts. */
const PARAM_NAMES: Record<string, string> = {
  tMean: 'average temperature',
  tMax: 'daily maximum temperature (averaged)',
  tMin: 'daily minimum temperature (averaged)',
  precip: 'rainfall total',
  rainyDays: 'rainy days (IMD: 2.5 mm or more)',
  humidity: 'relative humidity',
  dewPoint: 'dew point',
  windMean: 'average wind speed',
  windMax: 'daily maximum wind speed (averaged)',
  gusts: 'daily maximum gust (averaged)',
  pressure: 'sea-level pressure',
  cloud: 'cloud cover',
  sunshine: 'sunshine hours per day',
  et0: 'reference evapotranspiration (ET0) total',
  vpd: 'daily maximum vapour pressure deficit (averaged)',
  soilTemp: 'soil temperature, top 7 cm',
  soilMoisture: 'soil moisture, top 7 cm',
};

const INDICATOR_NAMES: Record<string, string> = {
  hotDays: 'days reaching the threshold temperature',
  veryHotDays: `very hot days (above the baseline's ${EXTREME_PERCENTILE}th percentile of daily maximum)`,
  warmNights: `warm nights (daily minimum above the baseline's ${EXTREME_PERCENTILE}th percentile)`,
  heavyRainDays: 'heavy-rain days (IMD: 64.5 mm or more in a day)',
  longestDrySpell: 'longest run of consecutive days each with less than 2.5 mm of rain (not dry days: light rain can fall)',
  wettestDay: 'wettest single day of the year',
  humidDays: 'humid days (daily mean humidity at or above the threshold)',
  windyDays: `windy days (above the baseline's ${EXTREME_PERCENTILE}th percentile)`,
};

const SEASON_NAMES: Record<string, string> = {
  annual: 'the whole year',
  winter: 'winter (January–February)',
  preMonsoon: 'pre-monsoon (March–May)',
  monsoon: 'monsoon (June–September)',
  postMonsoon: 'post-monsoon (October–December)',
};

function indicatorFacts(indicator: Indicator) {
  return {
    name: INDICATOR_NAMES[indicator.key],
    unit: indicator.unit,
    threshold: indicator.threshold === null ? undefined : `${indicator.threshold} ${indicator.thresholdUnit ?? ''}`.trim(),
    baselineAverage: indicator.baseline,
    recentAverage: indicator.recent,
    highest: indicator.record ? { year: indicator.record.when, value: indicator.record.value } : undefined,
    highestSpan: indicator.recordSpan ?? undefined,
    trendPerDecade: indicator.trend?.perDecade,
    trendIsClear: indicator.trend?.clear,
  };
}

function paramFacts(p: ParamAnalysis) {
  if (!p.available) return { name: PARAM_NAMES[p.param], available: false };
  return {
    name: PARAM_NAMES[p.param],
    unit: p.unit,
    howSummarised: p.aggregate === 'sum' ? 'total over the season/year' : p.aggregate === 'count' ? 'count of days' : 'average',
    baselineAverage: p.baseline,
    periodAverage: p.periodMean,
    latestYear: {
      year: p.latest.year,
      value: p.latest.value,
      differenceFromBaseline: p.latest.anomaly,
      percentDifference: p.latest.anomalyPct ?? undefined,
    },
    recentYears: {
      from: p.recent.from,
      to: p.recent.to,
      average: p.recent.mean,
      differenceFromBaseline: p.recent.anomaly,
      percentDifference: p.recent.anomalyPct ?? undefined,
    },
    trend: p.trend
      ? {
          perDecade: p.trend.perDecade,
          isClear: p.trend.clear,
          yearsFitted: p.trend.years,
        }
      : 'too few years for a trend',
    highestYear: p.highestYear ?? undefined,
    lowestYear: p.lowestYear ?? undefined,
    highestMonth: p.highestMonth ?? undefined,
    highestDay: p.highestDay ?? undefined,
    lowestDay: p.lowestDay ?? undefined,
    indicators: p.indicators.map(indicatorFacts),
    seasonShares: p.seasons ?? undefined,
  };
}

/** Exactly what the model is shown. The gate's facts are derived from this. */
export function explainPayload(analysis: ClimateAnalysis, lang: InterfaceLang) {
  const place = analysis.place;
  return {
    place: {
      name: place.name,
      nameInHindi: lang === 'hi' ? hindiName(place.name) : undefined,
      district: place.district ?? undefined,
      state: place.state ?? undefined,
    },
    data: 'ERA5 reanalysis via Open-Meteo: modelled values for a grid cell about 31 km across, reconstructed from observations. Not station readings.',
    period: `${analysis.years.from}–${analysis.years.to}`,
    periodLengthYears: analysis.years.to - analysis.years.from + 1,
    baseline: `${analysis.baseline.from}–${analysis.baseline.to}`,
    season: SEASON_NAMES[analysis.query.season],
    parameters: analysis.params.map(paramFacts),
  };
}

function hindiName(name: string): string {
  return HINDI_NAME.get(name.toLowerCase()) ?? devanagariName(name) ?? name;
}

/* ------------------------------------------------------------------ */
/* The checks this page adds                                           */
/* ------------------------------------------------------------------ */

/**
 * Whole-word matching in any script. `\b` does not understand Devanagari,
 * and a substring match finds words inside other words — see CLAUDE.md.
 */
function wordPattern(words: string[]): RegExp {
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![\\p{L}\\p{M}])(?:${escaped.join('|')})(?![\\p{L}\\p{M}])`, 'iu');
}

const CAUSES = wordPattern([
  'climate change', 'climatic change', 'global warming', 'greenhouse', 'greenhouse gas',
  'greenhouse gases', 'emissions', 'emission', 'carbon', 'co2', 'el nino', 'el niño',
  'la nina', 'la niña', 'enso', 'urbanisation', 'urbanization', 'urban heat', 'deforestation',
  'human activity', 'human activities', 'anthropogenic', 'pollution',
  'जलवायु परिवर्तन', 'ग्लोबल वार्मिंग', 'वैश्विक तापमान वृद्धि', 'ग्रीनहाउस', 'उत्सर्जन',
  'कार्बन', 'अल नीनो', 'ला नीना', 'शहरीकरण', 'वनों की कटाई', 'प्रदूषण', 'मानवीय गतिविधि',
  'मानवीय गतिविधियों',
]);

const STATIONS = wordPattern([
  'station', 'stations', 'rain gauge', 'rain gauges', 'gauge', 'thermometer',
  'स्टेशन', 'वर्षामापी', 'थर्मामीटर',
]);

export type ExplainVerdict = { ok: true } | { ok: false; rule: string; detail: string };

export function verifyExplanation(
  text: string,
  payload: unknown,
  places: string[],
  lang: InterfaceLang,
): ExplainVerdict {
  const facts = buildFacts({ payload, places });
  // A magnitude restated with a direction — "0.4 °C cooler" for -0.4 — is
  // the same fact, so each number's absolute value is allowed too.
  for (const n of [...facts.numbers]) facts.numbers.add(Math.abs(n));

  const gate = verifyRender(text, facts, { gazetteer: GAZETTEER });
  if (!gate.ok) return { ok: false, rule: gate.reason, detail: gate.detail };

  const cause = text.match(CAUSES);
  if (cause) return { ok: false, rule: 'causalClaim', detail: `mentions a cause: "${cause[0]}"` };

  const station = text.match(STATIONS);
  if (station) return { ok: false, rule: 'stationClaim', detail: `calls reanalysis a reading: "${station[0]}"` };

  const expected = lang === 'hi' ? 'Deva' : 'Latn';
  const script = detectScript(text);
  if (script !== expected) {
    return { ok: false, rule: 'scriptSwitched', detail: `expected ${expected}, got ${script ?? 'none'}` };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* The call                                                            */
/* ------------------------------------------------------------------ */

const SYSTEM = `You explain a historical climate analysis to an ordinary person in India — a farmer, a student, an official.

You are given verified statistics as JSON. Explain what they show, in plain words, in 4 to 6 short sentences. You may say what the numbers could mean in practice (for crops, water, heat, planning).

HARD RULES — an answer that breaks any of them is thrown away:
- Use ONLY numbers that appear in the JSON, written as digits exactly as given. Do not compute new numbers: no sums, no differences, no conversions, no rounding, no percentages of your own.
- Never write a number as a word.
- Do not give or suggest any cause for a change. Do not mention climate change, global warming, emissions, El Niño, cities, pollution or any other cause. Describe; do not explain why.
- The data is reanalysis — modelled, not measured at a station. Never call it a station reading or a measurement.
- A trend with isClear=false must be described as not clear, not as a rise or fall.
- Do not forecast or project the future.
- Name no place other than the one given.
- Plain paragraphs. No headings, no lists, no markdown.`;

function instruction(lang: InterfaceLang): string {
  return lang === 'hi'
    ? 'Write in simple Hindi, in Devanagari script. Use the place\'s nameInHindi. Keep units as given (°C, mm, %).'
    : 'Write in simple English.';
}

export type ExplainDeps = {
  models: LanguageModel[];
};

export async function explainAnalysis(
  analysis: ClimateAnalysis,
  lang: InterfaceLang,
  deps: ExplainDeps = { models: providers() },
): Promise<ExplainResponse> {
  const key = `climate:explain:${lang}:${analysis.place.latitude},${analysis.place.longitude}:${writeQuery(analysis.query).toString()}`;
  return cached<ExplainResponse>(
    key,
    60 * 60 * 1000,
    async () => {
      const payload = explainPayload(analysis, lang);
      const { result } = await completeWithFallback(deps.models, {
        system: SYSTEM,
        user: `${instruction(lang)}\n\nSTATISTICS:\n${JSON.stringify(payload)}`,
        temperature: 0.2,
        maxTokens: 1200,
        timeoutMs: 12_000,
        deadlineMs: 18_000,
      });
      if (result.kind !== 'ok') return { kind: 'unavailable', reason: 'noModel' };

      // Reasoning models sometimes wrap their thinking; only the answer ships.
      const text = result.text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const places = [
        analysis.place.name,
        analysis.place.district ?? '',
        analysis.place.state ?? '',
        payload.place.nameInHindi ?? '',
        'India',
        'भारत',
      ];
      const verdict = verifyExplanation(text, payload, places, lang);
      if (!verdict.ok) {
        logGateRejection({
          reason: verdict.rule,
          detail: verdict.detail,
          rejectedText: text,
          grounded: true,
          severity: 'climate',
          lang,
        });
        return { kind: 'unavailable', reason: 'rejected' };
      }
      return { kind: 'explanation', text, provider: result.provider };
    },
    // Only a shipped explanation is worth keeping; a model outage is not.
    (value) => value.kind === 'explanation',
  );
}
