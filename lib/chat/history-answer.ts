/**
 * Answering a question about the past: which record to ask, and what to read
 * out of it.
 *
 * Every branch asks the history source and nothing else. A past-tense
 * question never falls back to the present or the forecast — if the record
 * has nothing, the result says `unavailable`, and the answer says so.
 */

import { addDays, daysBetween } from '../parse/time';
import type { TimeWindow } from '../parse/types';
import {
  lastHours,
  lastRain,
  rainSpells,
  soFarOn,
  summariseDays,
  type Accumulation,
  type DaysSummary,
  type RainSpell,
} from '../weather/history';
import type { History, HistoryDay, HistoryRequest, Location, NoData } from '../weather/types';

export type HistorySource = (place: Location, request: HistoryRequest) => Promise<History | NoData>;

/** How far the first "last rain" search looks, and how far it may widen to. */
export const SEARCH_DAYS = { first: 14, widest: 92 } as const;

export type HistoryResult =
  | {
      kind: 'lastRain';
      event: RainSpell | null;
      traceSince: RainSpell | null;
      /** How far back the search looked, in days. */
      searchedDays: number;
      history: History;
    }
  | {
      kind: 'day';
      date: string;
      /** The day's record, or null when the record has no such day. */
      day: HistoryDay | null;
      /** Today so far, when the day asked about is today. */
      soFar: Accumulation | null;
      /** The rain spells within the day, when hours were available. */
      spells: RainSpell[];
      history: History;
    }
  | { kind: 'days'; from: string; to: string; summary: DaysSummary; history: History }
  | { kind: 'hours'; hours: number; sum: Accumulation; history: History }
  | { kind: 'unavailable'; noData: NoData };

function isNoData(value: History | NoData): value is NoData {
  return value.kind === 'noData';
}

/**
 * The past for one place and one window.
 *
 * @param today YYYY-MM-DD in the place's zone
 */
export async function fetchHistory(
  source: HistorySource,
  place: Location,
  window: TimeWindow,
  today: string,
): Promise<HistoryResult> {
  switch (window.kind) {
    case 'lastEvent': {
      // Start close, widen once. Most "when did it last rain" questions are
      // answered by the last fortnight, and a wet season should not pay for
      // three months of hours. A cursor older than the first search starts
      // wide.
      const cursorDays = window.before ? daysBetween(window.before.slice(0, 10), today) : 0;
      const plan = cursorDays >= SEARCH_DAYS.first - 1 ? [SEARCH_DAYS.widest] : [SEARCH_DAYS.first, SEARCH_DAYS.widest];

      let last: HistoryResult | null = null;
      for (const days of plan) {
        const history = await source(place, { kind: 'recent', pastDays: days });
        if (isNoData(history)) return last ?? { kind: 'unavailable', noData: history };
        const found = lastRain(history.hours, window.before);
        last = { kind: 'lastRain', event: found.event, traceSince: found.traceSince, searchedDays: days, history };
        if (found.event) return last;
      }
      return last as HistoryResult;
    }

    case 'pastHours': {
      const days = Math.ceil(window.hours / 24) + 1;
      const history = await source(place, { kind: 'recent', pastDays: days });
      if (isNoData(history)) return { kind: 'unavailable', noData: history };
      return { kind: 'hours', hours: window.hours, sum: lastHours(history.hours, window.hours), history };
    }

    case 'past': {
      const from = addDays(today, -window.days);
      const to = addDays(today, -1);
      const history = await source(place, { kind: 'dates', from, to });
      if (isNoData(history)) return { kind: 'unavailable', noData: history };
      return { kind: 'days', from, to, summary: summariseDays(history.days, from, to), history };
    }

    case 'day':
    case 'date': {
      const date = window.kind === 'day' ? addDays(today, window.offset) : window.date;
      const back = daysBetween(date, today);

      // Today, in the past tense: "how much has it rained today?"
      if (back === 0) {
        const history = await source(place, { kind: 'recent', pastDays: 1 });
        if (isNoData(history)) return { kind: 'unavailable', noData: history };
        const spells = rainSpells(history.hours.filter((h) => h.time.slice(0, 10) === date));
        return { kind: 'day', date, day: null, soFar: soFarOn(history.hours, date), spells, history };
      }

      // The last few days come with their hours, so "when did it rain
      // yesterday" can say when. Older days are whole-day records.
      if (back > 0 && back <= 3) {
        const history = await source(place, { kind: 'recent', pastDays: back });
        if (isNoData(history)) return { kind: 'unavailable', noData: history };
        const day = history.days.find((d) => d.date === date) ?? null;
        const spells = rainSpells(hoursOf(history, date));
        return { kind: 'day', date, day, soFar: null, spells, history };
      }

      const history = await source(place, { kind: 'dates', from: date, to: date });
      if (isNoData(history)) return { kind: 'unavailable', noData: history };
      return {
        kind: 'day',
        date,
        day: history.days.find((d) => d.date === date) ?? null,
        soFar: null,
        spells: [],
        history,
      };
    }

    default: {
      // A window that is not in the past has no history. The planner never
      // sends one here; if it did, this says so rather than reaching for
      // the forecast.
      return {
        kind: 'unavailable',
        noData: {
          kind: 'noData',
          reason: 'notInBulletin',
          source: 'Open-Meteo',
          endpoint: '',
          checkedAt: new Date().toISOString(),
          statement: {
            hi: 'यह सवाल बीते समय के बारे में नहीं है।',
            en: 'That question is not about the past.',
          },
        },
      };
    }
  }
}

/**
 * The hours belonging to one calendar day: labelled 01:00 on that day through
 * 00:00 on the next, because each label is the END of its hour.
 */
function hoursOf(history: History, date: string) {
  const next = addDays(date, 1);
  return history.hours.filter((h) => {
    const day = h.time.slice(0, 10);
    const clock = h.time.slice(11, 16);
    return (day === date && clock !== '00:00') || (day === next && clock === '00:00');
  });
}

/** The unit history precipitation is reported in, for templates and facts. */
export function precipitationUnit(result: HistoryResult): string {
  return result.kind === 'unavailable' ? 'mm' : result.history.units.precipitation;
}

/** The place's own "today", which is what every relative day is counted from. */
export function todayAt(place: Location, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: place.timezone }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
