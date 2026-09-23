/**
 * Reading a past series: rain events, totals, days.
 *
 * Pure. Every number that leaves here is either a value upstream sent or a
 * sum of values upstream sent, rounded to the precision upstream sent them at
 * — no interpolation, no gap-filling, no second source. A missing hour stays
 * missing, and an event that runs into one is reported as ending there.
 *
 * WHY "LAST RAIN" IS NOT "THE LAST HOUR ABOVE ZERO". A model reports 0.1 mm
 * of drizzle-noise in hours when nobody saw a drop, and a shower that stops
 * for forty minutes is still one shower. Answering "when did it last rain"
 * with the last non-zero hour told people it rained this morning when the
 * morning was dry and the rain was the evening before. So the series is read
 * as EVENTS:
 *
 *   wet hour   ≥ 0.1 mm — the smallest amount the model reports at all
 *   one event  wet hours separated by fewer than 3 dry hours (the gap a
 *              passing shower leaves), in the place's own zone
 *   rain       an event totalling ≥ 1.0 mm — the WMO/ETCCDI wet-day
 *              threshold, and well above model drizzle-noise
 *
 * Lighter spells are not thrown away. One that came after the last real rain
 * is reported as exactly what it is — "only a trace since" — because saying
 * "no rain since Sunday" over a morning of drizzle would be its own lie.
 *
 * Every value here is MODELLED: a gridded model's rainfall for a cell several
 * kilometres across, not a rain gauge in the village. The provenance says so,
 * and the answer is told to.
 */

import type { HistoryDay, HistoryHour } from './types';

export const RAIN_RULES = {
  /** The smallest precipitation the model reports, and the least that counts. */
  wetHourMm: 0.1,
  /** Dry hours that END an event. Fewer, and it is one event with a lull. */
  gapHours: 3,
  /** An event smaller than this is a trace, not rain. */
  eventMm: 1.0,
} as const;

export type RainSpell = {
  /** Start of the first wet hour — its label minus one hour. ISO with offset. */
  start: string;
  /** End of the last wet hour — its label. ISO with offset. */
  end: string;
  /** Sum of the spell's hourly values, at the source's 0.1 mm precision. */
  total: number;
  /** The wettest single hour. */
  peak: number;
  wetHours: number;
  /** True when the spell runs up to the latest hour in the series. */
  ongoing: boolean;
};

/** Sums at the precision the source reports, so 0.1 + 0.2 is 0.3 and not 0.30000000000000004. */
export function roundTenth(n: number): number {
  return Math.round(n * 10) / 10;
}

const HOUR = 3_600_000;

/**
 * The series as spells of wet hours, oldest first.
 *
 * A null hour is unknown, not dry: it neither extends a spell nor counts
 * toward the gap that would end one — it simply ends the spell honestly.
 */
export function rainSpells(hours: HistoryHour[], rules = RAIN_RULES): RainSpell[] {
  type Open = { first: number; last: number; total: number; peak: number; wet: number };
  const spells: RainSpell[] = [];

  const spell = (open: Open, ongoing: boolean): RainSpell => ({
    start: shiftIso(hours[open.first].time, -1),
    end: hours[open.last].time,
    total: roundTenth(open.total),
    peak: open.peak,
    wetHours: open.wet,
    ongoing,
  });

  let open: Open | null = null;
  let dryRun = 0;

  for (let i = 0; i < hours.length; i++) {
    const mm = hours[i].precipitation;

    if (mm === null) {
      if (open) spells.push(spell(open, false));
      open = null;
      dryRun = 0;
      continue;
    }

    if (mm >= rules.wetHourMm) {
      open ??= { first: i, last: i, total: 0, peak: 0, wet: 0 };
      open.last = i;
      open.total += mm;
      open.peak = Math.max(open.peak, mm);
      open.wet += 1;
      dryRun = 0;
      continue;
    }

    if (open) {
      dryRun += 1;
      if (dryRun >= rules.gapHours) {
        spells.push(spell(open, false));
        open = null;
        dryRun = 0;
      }
    }
  }

  // A spell still open at the end of the series runs to the latest hour
  // there is: it may still be raining.
  if (open) spells.push(spell(open, open.last === hours.length - 1));

  return spells;
}

export type LastRain = {
  /** The most recent spell of real rain, or null if the series holds none. */
  event: RainSpell | null;
  /**
   * A lighter spell that came AFTER it, if any — reported so that "no rain
   * since Sunday" is not said over a morning of drizzle.
   */
  traceSince: RainSpell | null;
  /** The first and last hours the search could see. */
  searchedFrom: string | null;
  searchedTo: string | null;
};

/**
 * The most recent rain, optionally one that ended before an instant.
 *
 * `before` is how "and before that?" walks back: the previous answer's start
 * becomes the next search's bound, so the same event is never reported twice.
 */
export function lastRain(hours: HistoryHour[], before?: string, rules = RAIN_RULES): LastRain {
  const bound = before ? Date.parse(before) : Infinity;
  const usable = hours.filter((h) => Date.parse(h.time) <= bound);
  const spells = rainSpells(usable, rules);

  let event: RainSpell | null = null;
  let traceSince: RainSpell | null = null;

  for (let i = spells.length - 1; i >= 0; i--) {
    const spell = spells[i];
    if (spell.total >= rules.eventMm) {
      event = spell;
      break;
    }
    // Lighter spells between now and the last real rain: keep the latest.
    traceSince ??= spell;
  }

  return {
    event,
    traceSince,
    searchedFrom: usable[0] ? shiftIso(usable[0].time, -1) : null,
    searchedTo: usable[usable.length - 1]?.time ?? null,
  };
}

export type Accumulation = {
  total: number;
  wetHours: number;
  peak: number;
  /** Hours actually summed; fewer than asked means the series was short. */
  hours: number;
  from: string | null;
  to: string | null;
  /** Hours that were null and therefore not summed. Never treated as zero. */
  missing: number;
};

/** Precipitation over the last `count` hours of the series. */
export function lastHours(hours: HistoryHour[], count: number, rules = RAIN_RULES): Accumulation {
  const slice = hours.slice(-count);
  let total = 0;
  let wetHours = 0;
  let peak = 0;
  let missing = 0;
  for (const hour of slice) {
    if (hour.precipitation === null) {
      missing += 1;
      continue;
    }
    total += hour.precipitation;
    peak = Math.max(peak, hour.precipitation);
    if (hour.precipitation >= rules.wetHourMm) wetHours += 1;
  }
  return {
    total: roundTenth(total),
    wetHours,
    peak,
    hours: slice.length - missing,
    from: slice[0] ? shiftIso(slice[0].time, -1) : null,
    to: slice[slice.length - 1]?.time ?? null,
    missing,
  };
}

/** Precipitation so far on one calendar date: the hours whose label falls on it. */
export function soFarOn(hours: HistoryHour[], date: string): Accumulation {
  const on = hours.filter((h) => localDateOf(h.time) === date && !h.time.slice(11).startsWith('00:00'));
  return lastHours(on, on.length);
}

export type DaysSummary = {
  days: HistoryDay[];
  /** Sum of the days' upstream totals; null when any day was missing its total. */
  total: number | null;
  /** Days with at least the wet-day threshold of precipitation. */
  wetDays: number;
  /** Highest daily maximum and lowest daily minimum across the days. */
  hottest: { date: string; value: number } | null;
  coolest: { date: string; value: number } | null;
};

/**
 * Whole days between two dates, inclusive, with their totals.
 *
 * The total is null — not a smaller number — when a day in the range has no
 * value: a sum with a hole in it is a smaller claim than the truth.
 */
export function summariseDays(days: HistoryDay[], from: string, to: string, rules = RAIN_RULES): DaysSummary {
  const within = days.filter((d) => d.date >= from && d.date <= to);
  // A day ABSENT from the record is a hole too, not only a day with a null
  // total: a "7-day total" summed over the two days that came back would be
  // a two-day total wearing the wrong label.
  const expected = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  let total = 0;
  let complete = within.length > 0 && within.length >= expected;
  let wetDays = 0;
  let hottest: DaysSummary['hottest'] = null;
  let coolest: DaysSummary['coolest'] = null;

  for (const day of within) {
    if (day.precipitationSum === null) complete = false;
    else {
      total += day.precipitationSum;
      if (day.precipitationSum >= rules.eventMm) wetDays += 1;
    }
    if (day.maxTemp !== null && (hottest === null || day.maxTemp > hottest.value)) {
      hottest = { date: day.date, value: day.maxTemp };
    }
    if (day.minTemp !== null && (coolest === null || day.minTemp < coolest.value)) {
      coolest = { date: day.date, value: day.minTemp };
    }
  }

  return { days: within, total: complete ? roundTenth(total) : null, wetDays, hottest, coolest };
}

/* ------------------------------------------------------------------ */
/* Time, in the place's own zone                                       */
/* ------------------------------------------------------------------ */

/** An ISO-with-offset instant moved by whole hours, keeping its offset. */
export function shiftIso(iso: string, hours: number): string {
  const offset = /([+-]\d{2}:\d{2}|Z)$/.exec(iso)?.[1] ?? 'Z';
  const at = Date.parse(iso) + hours * HOUR;
  if (Number.isNaN(at)) return iso;
  if (offset === 'Z') return new Date(at).toISOString().replace('.000', '');
  const sign = offset[0] === '-' ? -1 : 1;
  const minutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const local = new Date(at + minutes * 60_000).toISOString().slice(0, 19);
  return `${local}${offset}`;
}

/** The calendar date an ISO-with-offset instant falls on, in its own offset. */
export function localDateOf(iso: string): string {
  return iso.slice(0, 10);
}

/** Whole calendar days from `date` to `today`: 1 for yesterday. */
export function daysAgo(date: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
}
