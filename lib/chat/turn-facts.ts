/**
 * What the model is shown for one weather turn — and therefore exactly what
 * the gate verifies it against, and what the template falls back to.
 *
 * SCOPED TO THE QUESTION. A question about the past is shown the past and
 * the warnings in force, and NOT the present reading: shown both, a model
 * asked "when did it last rain" could answer with the current precipitation,
 * fluently and verifiably, because that number really was in its data. The
 * same scoping keeps a forecast question on the forecast.
 *
 * WRITTEN TO BE READ OUT. The model repeats this almost verbatim, so times
 * are "14:00" and "2 PM" rather than ISO strings, dates are "21 Sep", and
 * "3 days ago" is a number in here rather than arithmetic the model would do
 * — a number it computed itself would be a number the gate rejects. Every
 * value is still exactly what the source sent, at the precision it sent it.
 */

import type { InterfaceLang } from '../i18n/languages';
import { addDays, daysBetween } from '../parse/time';
import type { Intent, TimeWindow, Variable } from '../parse/types';
import type { RainSpell } from '../weather/history';
import { RAIN_RULES } from '../weather/history';
import type { Forecast, HistoryDay, Measurement, MeasurementKey, NoData, Reading } from '../weather/types';
import { conditionFor } from '../weather/wmo';
import type { WarningFacts } from './facts';
import type { HistoryResult } from './history-answer';

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export type CurrentFacts = {
  condition: string | null;
  measurements: { key: MeasurementKey; value: number; unit: string }[];
};

export type OutlookDayFacts = {
  date: string;
  label: string;
  condition: string | null;
  maxTemp: number | null;
  minTemp: number | null;
  precipitationSum: number | null;
  precipitationProbability?: number | null;
  maxWind?: number | null;
};

export type OutlookFacts = {
  days: OutlookDayFacts[];
  units: { temperature: string; precipitation: string; wind?: string; probability?: string };
};

export type SpellFacts = {
  day: string;
  daysAgo: number;
  /** Present only for a spell inside the last day, where hours read better. */
  hoursAgo?: number;
  started: string;
  ended: string;
  started12: string;
  ended12: string;
  total: number;
  peakHourly: number;
  wetHours: number;
  ongoing: boolean;
};

export type HistoryFacts =
  | {
      kind: 'lastRain';
      lastRain: SpellFacts | null;
      /** A lighter spell after it, reported as exactly that. */
      onlyTraceSince: SpellFacts | null;
      searchedDays: number;
      rainThresholdMm: number;
      unit: string;
    }
  | {
      kind: 'day';
      date: string;
      label: string;
      condition: string | null;
      rain: number | null;
      maxTemp: number | null;
      minTemp: number | null;
      maxWind: number | null;
      rainHours: number | null;
      spells: SpellFacts[];
      /** Today, in the past tense: what has fallen since midnight. */
      soFar: { total: number; since: string; through: string } | null;
      units: { precipitation: string; temperature: string; wind: string };
    }
  | {
      kind: 'days';
      from: string;
      to: string;
      days: number;
      total: number | null;
      wetDays: number;
      daily: { date: string; rain: number | null; maxTemp: number | null; minTemp: number | null; condition: string | null }[];
      hottest: { date: string; value: number } | null;
      coolest: { date: string; value: number } | null;
      units: { precipitation: string; temperature: string };
    }
  | {
      kind: 'hours';
      hours: number;
      from: string;
      to: string;
      total: number;
      wetHours: number;
      peakHourly: number;
      unit: string;
    };

export type TurnFacts = {
  asked: { topic: Intent; variable: Variable; when: string };
  place: { name: string; district: string | null; state: string | null };
  /** The source of what this turn reports, and what kind of value it is. */
  source: { name: string; nature: string | null; issuedAt: string; basis: string } | null;
  current?: CurrentFacts | { unavailable: string };
  outlook?: OutlookFacts | { unavailable: string };
  /**
   * The outlook dates the question is actually about. Empty when it asked
   * about a day past the forecast's horizon — which the answer then says.
   */
  focusDays?: string[];
  /** How many days ahead the forecast reaches, when the question went past it. */
  horizonDays?: number;
  history?: HistoryFacts | { unavailable: string };
  /** In plain words, what kind of record the history is. Never "measured". */
  historyNature?: string;
  warnings: WarningFacts;
};

/* ------------------------------------------------------------------ */
/* Dates and times, for reading out                                    */
/* ------------------------------------------------------------------ */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "24 Sep", from YYYY-MM-DD. English month names, stable across ICU versions. */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1] ?? ''}`.trim();
}

/** "24 सितंबर" — the same date as a Hindi reader writes it. */
export function hindiDate(date: string): string {
  try {
    return new Intl.DateTimeFormat('hi-IN', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
      new Date(`${date}T00:00:00Z`),
    );
  } catch {
    return date;
  }
}

/** "14:00" in the place's zone. */
export function clock(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(
      new Date(iso),
    );
  } catch {
    return iso.slice(11, 16);
  }
}

/** "2 PM" in the place's zone. */
export function clock12(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: true, timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

/** The calendar date an instant falls on in a zone. */
export function dateIn(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** "today", "tomorrow", "yesterday", or the weekday — in English, for the model. */
export function relativeLabel(date: string, today: string): string {
  const offset = daysBetween(today, date);
  if (offset === 0) return 'today';
  if (offset === 1) return 'tomorrow';
  if (offset === -1) return 'yesterday';
  if (offset === 2) return 'day after tomorrow';
  if (offset === -2) return 'day before yesterday';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

/** What the turn asked about, in words the model can repeat. */
export function describeAsked(window: TimeWindow, today: string): string {
  switch (window.kind) {
    case 'now':
      return 'right now';
    case 'day': {
      const date = addDays(today, window.offset);
      const day = `${relativeLabel(date, today)} (${shortDate(date)})`;
      return window.part ? `${day}, ${window.part}` : day;
    }
    case 'range':
      return `the next ${window.days} days`;
    case 'past':
      return `the last ${window.days} days (${shortDate(addDays(today, -window.days))} to ${shortDate(addDays(today, -1))})`;
    case 'pastHours':
      return `the last ${window.hours} hours`;
    case 'date':
      return `${relativeLabel(window.date, today)} (${shortDate(window.date)})`;
    case 'lastEvent':
      return window.before ? 'the rain before the one already mentioned' : 'the most recent rain';
  }
}

/* ------------------------------------------------------------------ */
/* Current and outlook                                                 */
/* ------------------------------------------------------------------ */

export function currentFacts(current: Reading | NoData, lang: InterfaceLang): CurrentFacts | { unavailable: string } {
  if (current.kind !== 'reading') return { unavailable: current.statement[lang] };
  return {
    condition: conditionFor(current.conditionCode)?.[lang] ?? null,
    measurements: current.measurements.map((m: Measurement) => ({ key: m.key, value: m.value, unit: m.unit })),
  };
}

export function outlookFacts(
  outlook: Forecast | NoData,
  today: string,
  lang: InterfaceLang,
): OutlookFacts | { unavailable: string } {
  if (outlook.kind !== 'forecast') return { unavailable: outlook.statement[lang] };
  return {
    days: outlook.days.map((d) => ({
      date: shortDate(d.date),
      label: relativeLabel(d.date, today),
      condition: conditionFor(d.conditionCode)?.[lang] ?? null,
      maxTemp: d.maxTemp,
      minTemp: d.minTemp,
      precipitationSum: d.precipitationSum,
      ...(d.precipitationProbability !== undefined ? { precipitationProbability: d.precipitationProbability } : {}),
      ...(d.maxWind !== undefined ? { maxWind: d.maxWind } : {}),
    })),
    units: outlook.units,
  };
}

/**
 * Which outlook dates a window is about, as they appear in the facts. An
 * empty list means the window lies beyond the forecast.
 */
export function focusDates(outlook: Forecast | NoData, window: TimeWindow, today: string): string[] {
  if (outlook.kind !== 'forecast') return [];
  const dates = outlook.days.map((d) => d.date);
  let wanted: string[];
  switch (window.kind) {
    case 'now':
      wanted = [today];
      break;
    case 'day':
      wanted = [addDays(today, window.offset)];
      break;
    case 'date':
      wanted = [window.date];
      break;
    case 'range':
      wanted = Array.from({ length: window.days }, (_, i) => addDays(today, i));
      break;
    default:
      wanted = [];
  }
  return wanted.filter((d) => dates.includes(d)).map(shortDate);
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

function spellFacts(spell: RainSpell, timeZone: string, today: string, now: Date): SpellFacts {
  const day = dateIn(spell.end, timeZone);
  const hoursAgo = Math.round((now.getTime() - Date.parse(spell.end)) / 3_600_000);
  return {
    day: shortDate(day),
    daysAgo: daysBetween(day, today),
    ...(hoursAgo >= 0 && hoursAgo < 24 ? { hoursAgo } : {}),
    started: clock(spell.start, timeZone),
    ended: clock(spell.end, timeZone),
    started12: clock12(spell.start, timeZone),
    ended12: clock12(spell.end, timeZone),
    total: spell.total,
    peakHourly: spell.peak,
    wetHours: spell.wetHours,
    ongoing: spell.ongoing,
  };
}

function dayCondition(day: HistoryDay | null, lang: InterfaceLang): string | null {
  return day ? (conditionFor(day.conditionCode)?.[lang] ?? null) : null;
}

export function historyFacts(
  result: HistoryResult,
  opts: { timeZone: string; today: string; now: Date; lang: InterfaceLang },
): HistoryFacts | { unavailable: string } {
  const { timeZone, today, now, lang } = opts;
  switch (result.kind) {
    case 'unavailable':
      return { unavailable: result.noData.statement[lang] };

    case 'lastRain':
      return {
        kind: 'lastRain',
        lastRain: result.event ? spellFacts(result.event, timeZone, today, now) : null,
        onlyTraceSince: result.traceSince ? spellFacts(result.traceSince, timeZone, today, now) : null,
        searchedDays: result.searchedDays,
        rainThresholdMm: RAIN_RULES.eventMm,
        unit: result.history.units.precipitation,
      };

    case 'day': {
      const units = result.history.units;
      return {
        kind: 'day',
        date: shortDate(result.date),
        label: relativeLabel(result.date, today),
        condition: dayCondition(result.day, lang),
        rain: result.day?.precipitationSum ?? null,
        maxTemp: result.day?.maxTemp ?? null,
        minTemp: result.day?.minTemp ?? null,
        maxWind: result.day?.maxWind ?? null,
        rainHours: result.day?.precipitationHours ?? null,
        spells: result.spells.map((s) => spellFacts(s, timeZone, today, now)),
        soFar:
          result.soFar && result.soFar.to
            ? { total: result.soFar.total, since: '00:00', through: clock(result.soFar.to, timeZone) }
            : null,
        units: { precipitation: units.precipitation, temperature: units.temperature, wind: units.wind },
      };
    }

    case 'days':
      return {
        kind: 'days',
        from: shortDate(result.from),
        to: shortDate(result.to),
        days: daysBetween(result.from, result.to) + 1,
        total: result.summary.total,
        wetDays: result.summary.wetDays,
        daily: result.summary.days.map((d) => ({
          date: shortDate(d.date),
          rain: d.precipitationSum,
          maxTemp: d.maxTemp,
          minTemp: d.minTemp,
          condition: dayCondition(d, lang),
        })),
        hottest: result.summary.hottest
          ? { date: shortDate(result.summary.hottest.date), value: result.summary.hottest.value }
          : null,
        coolest: result.summary.coolest
          ? { date: shortDate(result.summary.coolest.date), value: result.summary.coolest.value }
          : null,
        units: { precipitation: result.history.units.precipitation, temperature: result.history.units.temperature },
      };

    case 'hours':
      return {
        kind: 'hours',
        hours: result.hours,
        from: result.sum.from ? `${shortDate(dateIn(result.sum.from, timeZone))} ${clock(result.sum.from, timeZone)}` : '',
        to: result.sum.to ? `${shortDate(dateIn(result.sum.to, timeZone))} ${clock(result.sum.to, timeZone)}` : '',
        total: result.sum.total,
        wetHours: result.sum.wetHours,
        peakHourly: result.sum.peak,
        unit: result.history.units.precipitation,
      };
  }
}

/**
 * What kind of record a history is, in a sentence the model can repeat.
 *
 * No dataset names with digits in them: every numeral in the facts becomes a
 * number the gate lets through, and "ERA5" would quietly license a "5 mm"
 * nobody measured. The dataset is named in the provenance, not in here.
 */
export function historyNature(result: HistoryResult): string | undefined {
  if (result.kind === 'unavailable') return undefined;
  return result.history.provenance.nature === 'reanalysis'
    ? 'reanalysis via Open-Meteo: modelled and reconstructed afterwards, not a rain-gauge reading'
    : 'Open-Meteo model archive: modelled, not a rain-gauge reading';
}
