/**
 * When a question is about: now, a future day, or the past.
 *
 * THE BUG THIS EXISTS FOR. "last baarish kab hui thi ghaziabad mein" was read
 * as a question about now — there was no word for the past anywhere in the
 * parser — and answered with today's precipitation: true, sourced, and the
 * answer to a question nobody asked. Tense is now read explicitly.
 *
 * कल IS TWO WORDS. It means yesterday in "कल बारिश हुई थी" and tomorrow in
 * "कल बारिश होगी", and only the verb says which. So the reading is: past-tense
 * markers anywhere in the sentence make कल yesterday; otherwise it is
 * tomorrow, which is what people ask a weather service about far more often.
 * परसों works the same way.
 *
 * India keeps one timezone, and every place Chaatak resolves is in India, so
 * calendar dates here are read in IST. Windows are expressed relative to
 * "today" and turned into dates later, in the place's own zone.
 *
 * Whole words only, in every script — the standing rule.
 */

import type { TimeWindow } from './types';

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive, and working for Devanagari. */
export function hasAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) =>
    new RegExp(`(?<![\\p{L}\\p{M}])${escape(phrase)}(?![\\p{L}\\p{M}])`, 'iu').test(text),
  );
}

/* ------------------------------------------------------------------ */
/* Tense                                                               */
/* ------------------------------------------------------------------ */

/*
 * "before" / पहले / pehle are NOT here. They say "earlier than", not "in the
 * past": "will it rain before evening?" is a future question, and reading it
 * as past sent it looking for rain events that had already happened.
 */
const PAST = [
  // Hindi
  'था', 'थी', 'थे', 'थीं', 'हुई', 'हुआ', 'हुए', 'हुयी', 'गया', 'गई', 'गयी', 'गए',
  'पड़ी', 'पड़ा', 'पडी', 'पडा', 'बरसी', 'बरसा', 'चुकी', 'चुका', 'बीते', 'पिछले',
  'पिछली', 'पिछला', 'पिछ्ले', 'गुज़रे', 'गुजरे', 'आखिरी', 'आख़िरी',
  // Hinglish
  'tha', 'thi', 'thin', 'hui', 'hua', 'huyi', 'huye', 'huwa', 'gaya', 'gayi',
  'gaye', 'padi', 'pada', 'barsi', 'barsa', 'chuki', 'chuka', 'pichhle', 'pichle',
  'pichhli', 'pichli', 'pichla', 'pichhla', 'beete', 'aakhri', 'akhri', 'aakhari',
  // English
  'was', 'were', 'did', 'didnt', 'rained', 'yesterday', 'ago', 'past', 'previous',
  'previously', 'earlier',
];

const FUTURE = [
  'होगी', 'होगा', 'होंगे', 'रहेगा', 'रहेगी', 'रहेंगे', 'पड़ेगी', 'पड़ेगा', 'बरसेगा',
  'बरसेगी', 'आएगी', 'आएगा', 'आयेगी', 'आयेगा', 'सकती', 'सकता', 'अगले', 'अगला',
  'hogi', 'hoga', 'honge', 'rahega', 'rahegi', 'padegi', 'padega', 'barsega',
  'barsegi', 'aayegi', 'aaegi', 'aayega', 'aaega', 'sakti', 'sakta', 'agle',
  'agla', 'agli',
  'will', 'going', 'forecast', 'tomorrow', 'next', 'upcoming', 'later', 'tonight',
];

export function isPastTense(text: string): boolean {
  return hasAny(text, PAST);
}

export function isFutureTense(text: string): boolean {
  return hasAny(text, FUTURE);
}

/* ------------------------------------------------------------------ */
/* The words for "when"                                                */
/* ------------------------------------------------------------------ */

const NOW = ['अभी', 'इस वक्त', 'इस वक़्त', 'इस समय', 'abhi', 'right now', 'now', 'currently', 'at the moment'];
const TODAY = ['आज', 'aaj', 'today', 'tonight', 'आज रात'];
const KAL = ['कल', 'kal'];
const PARSON = ['परसों', 'परसो', 'parson', 'parso', 'parsoon'];
const TOMORROW = ['tomorrow', 'tmrw', 'tmr'];
const DAY_AFTER = ['day after tomorrow', 'day after'];
const YESTERDAY = ['yesterday', 'ystrdy'];
const DAY_BEFORE_YESTERDAY = ['day before yesterday'];
const THIS_WEEK = ['इस हफ़्ते', 'इस हफ्ते', 'इस सप्ताह', 'is hafte', 'this week', 'next few days', 'coming days', 'agle kuch din', 'अगले कुछ दिन'];

const LAST_WEEK = [
  'last week', 'past week', 'previous week', 'pichhle hafte', 'pichle hafte',
  'pichhle hafte mein', 'पिछले हफ़्ते', 'पिछले हफ्ते', 'पिछले सप्ताह', 'बीते हफ़्ते',
  'beete hafte',
];
const LAST_MONTH = [
  'last month', 'past month', 'pichhle mahine', 'pichle mahine', 'पिछले महीने',
];

/** "last 24 hours", "pichhle 24 ghante", "पिछले 24 घंटे". */
const PAST_HOURS = new RegExp(
  '(?:last|past|previous|pichhle|pichle|पिछले|बीते)\\s+(\\d{1,3}|[०-९]{1,3})\\s*' +
    '(?:hours?|hrs?|ghante|ghanton|घंटे|घंटों)',
  'iu',
);

/** "last 7 days", "pichhle 10 din", "पिछले 7 दिन". */
const PAST_DAYS = new RegExp(
  '(?:last|past|previous|pichhle|pichle|पिछले|बीते)\\s+(\\d{1,3}|[०-९]{1,3})\\s*' +
    '(?:days?|din|dino|dinon|दिन|दिनों)',
  'iu',
);

/** "3 days ago", "7 din pehle", "5 दिन पहले": one day, N back. */
const DAYS_AGO = new RegExp(
  '(\\d{1,3}|[०-९]{1,3})\\s*(?:days?|din|दिन)\\s*(?:ago|back|pehle|pahle|पहले)',
  'iu',
);

/**
 * "in the last day", and last night: the night before is most usefully the
 * last 24 hours, which covers it whatever time of day the question is asked,
 * and the answer states the hours it actually looked at.
 */
const LAST_DAY = ['last day', 'past day', 'past 24h', 'last 24h', 'last night'];

/**
 * The night, when the sentence is in the past: "कल रात बारिश हुई थी" is last
 * night and "कल रात बारिश होगी" is tomorrow night — the same कल problem, one
 * word later — so these count only with past tense.
 */
const NIGHT_PAST = ['overnight', 'kal raat', 'कल रात', 'raat ko', 'रात को', 'raat mein', 'रात में'];

/**
 * "When did it last rain" in its many forms. Needs a rain word as well —
 * checked by the caller — so "when was it last this hot" is not read as one.
 */
const LAST_EVENT = [
  'last rain', 'last rained', 'last time it rained', 'last time', 'last baarish',
  'last barish', 'aakhri baar', 'akhri baar', 'aakhri bar', 'आखिरी बार',
  'आख़िरी बार', 'पिछली बार', 'pichhli baar', 'pichli baar', 'most recent',
  'last shower',
];

/** A question word that asks WHEN, in the three registers. */
const WHEN = ['कब', 'kab', 'when'];

/** "and before that?" */
const BEFORE_THAT = [
  'before that', 'before this', 'prior to that', 'the one before', 'previous one',
  'usse pehle', 'usse pahle', 'uske pehle', 'uske pahle', 'isse pehle',
  'उससे पहले', 'उसके पहले', 'इससे पहले', 'उस से पहले',
];

/* ------------------------------------------------------------------ */
/* Calendar dates                                                      */
/* ------------------------------------------------------------------ */

const MONTHS: [RegExp, number][] = [
  [/^(?:jan|january|जनवरी)$/iu, 1],
  [/^(?:feb|february|फ़रवरी|फरवरी)$/iu, 2],
  [/^(?:mar|march|मार्च)$/iu, 3],
  [/^(?:apr|april|अप्रैल|अप्रेल)$/iu, 4],
  [/^(?:may|मई)$/iu, 5],
  [/^(?:jun|june|जून)$/iu, 6],
  [/^(?:jul|july|जुलाई)$/iu, 7],
  [/^(?:aug|august|अगस्त)$/iu, 8],
  [/^(?:sep|sept|september|सितंबर|सितम्बर)$/iu, 9],
  [/^(?:oct|october|अक्टूबर|अक्तूबर)$/iu, 10],
  [/^(?:nov|november|नवंबर|नवम्बर)$/iu, 11],
  [/^(?:dec|december|दिसंबर|दिसम्बर)$/iu, 12],
];

function monthNumber(word: string): number | null {
  for (const [pattern, month] of MONTHS) if (pattern.test(word)) return month;
  return null;
}

function devanagariDigits(text: string): string {
  return text.replace(/[०-९]/g, (d) => String(d.codePointAt(0)! - 0x0966));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function validDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCMonth() !== month - 1) return null; // 31 September
  return `${year}-${pad(month)}-${pad(day)}`;
}

export type Direction = 'past' | 'future' | 'either';

/**
 * A calendar date named in the text, as YYYY-MM-DD, or null.
 *
 * With no year, the tense decides which occurrence is meant: "15 August"
 * asked in September about rain that fell is last month's, not next year's,
 * and "25 December" asked with no tense at all is whichever is nearer.
 */
export function readDate(text: string, today: string, direction: Direction): string | null {
  const t = devanagariDigits(text);
  const ty = Number(today.slice(0, 4));

  const iso = /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(t);
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // 15/08, 15-08-2026, 15.08.26 — day first, as India writes it.
  const numeric = /(?<![\d:])(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?![\d:])/.exec(t);
  // "15 August", "15th Aug", "August 15", "15 अगस्त".
  const named =
    /(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+([\p{L}\p{M}]+)/iu.exec(t) ??
    null;
  const namedReverse = /([\p{L}\p{M}]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?!\d)/iu.exec(t);

  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;

  if (numeric) {
    day = Number(numeric[1]);
    month = Number(numeric[2]);
    if (numeric[3]) year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
  } else if (named && monthNumber(named[2]) !== null) {
    day = Number(named[1]);
    month = monthNumber(named[2]);
  } else if (namedReverse && monthNumber(namedReverse[1]) !== null) {
    day = Number(namedReverse[2]);
    month = monthNumber(namedReverse[1]);
  }

  if (day === null || month === null) return null;
  if (year !== null) return validDate(year, month, day);

  const candidates = [ty - 1, ty, ty + 1]
    .map((y) => validDate(y, month as number, day as number))
    .filter((d): d is string => d !== null);
  if (candidates.length === 0) return null;

  if (direction === 'past') {
    const gone = candidates.filter((d) => d <= today);
    return gone.length > 0 ? gone[gone.length - 1] : null;
  }
  if (direction === 'future') {
    const coming = candidates.filter((d) => d >= today);
    return coming.length > 0 ? coming[0] : null;
  }
  // Nearest either way; a tie goes to the past, which can be answered.
  return [...candidates].sort(
    (a, b) => Math.abs(daysBetween(today, a)) - Math.abs(daysBetween(today, b)) || (a < b ? -1 : 1),
  )[0];
}

/* ------------------------------------------------------------------ */
/* Weekdays                                                            */
/* ------------------------------------------------------------------ */

/*
 * Full names only. "sun", "sat", "mon" and "wed" are English words first, and
 * "is the sun out?" was about to become a question about Sunday.
 */
const WEEKDAYS: [string[], number][] = [
  [['sunday', 'रविवार', 'itwar', 'ravivar', 'इतवार'], 0],
  [['monday', 'सोमवार', 'somvar', 'somwar'], 1],
  [['tuesday', 'मंगलवार', 'mangalvar', 'mangalwar'], 2],
  [['wednesday', 'बुधवार', 'budhvar', 'budhwar'], 3],
  [['thursday', 'गुरुवार', 'guruvar', 'guruwar', 'वीरवार'], 4],
  [['friday', 'शुक्रवार', 'shukravar', 'shukrawar'], 5],
  [['saturday', 'शनिवार', 'shanivar', 'shaniwar'], 6],
];

function weekdayIn(text: string): number | null {
  for (const [names, day] of WEEKDAYS) if (hasAny(text, names)) return day;
  return null;
}

/** Whole days between two YYYY-MM-DD dates, b minus a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** A YYYY-MM-DD date moved by whole days. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* The reading                                                         */
/* ------------------------------------------------------------------ */

export type TimeReading = {
  /** The window the words name, or null when they name none. */
  window: TimeWindow | null;
  /** Grammatical or lexical past: हुई थी, was, yesterday. */
  past: boolean;
  /** "when did it last rain" — needs a rain word, which the caller checks. */
  lastEvent: boolean;
  /** "and before that?" */
  beforeThat: boolean;
  /** A question word asking WHEN. */
  asksWhen: boolean;
};

/**
 * Everything the text says about time.
 *
 * @param today YYYY-MM-DD in IST — the calendar the question was asked on
 */
export function readTime(text: string, today: string): TimeReading {
  const t = devanagariDigits(text);
  const past = isPastTense(t);
  const future = isFutureTense(t);
  const asksWhen = hasAny(t, WHEN);
  const beforeThat = hasAny(t, BEFORE_THAT);
  const lastEvent = hasAny(t, LAST_EVENT) || (asksWhen && past);

  const reading = (window: TimeWindow | null): TimeReading => ({
    window,
    past: past || (window !== null && isPastWindow(window, today)),
    lastEvent,
    beforeThat,
    asksWhen,
  });

  // Most specific first: a phrase containing a number beats a bare word.
  const hours = PAST_HOURS.exec(t);
  if (hours) return reading({ kind: 'pastHours', hours: clampHours(Number(hours[1])) });

  const days = PAST_DAYS.exec(t);
  if (days) return reading({ kind: 'past', days: clampDays(Number(days[1])) });

  const ago = DAYS_AGO.exec(t);
  if (ago) {
    const back = clampAgo(Number(ago[1]));
    return reading(back <= 2 ? { kind: 'day', offset: -back } : { kind: 'date', date: addDays(today, -back) });
  }

  if (hasAny(t, LAST_DAY)) return reading({ kind: 'pastHours', hours: 24 });
  if (past && !future && hasAny(t, NIGHT_PAST)) return reading({ kind: 'pastHours', hours: 24 });
  if (hasAny(t, LAST_WEEK)) return reading({ kind: 'past', days: 7 });
  if (hasAny(t, LAST_MONTH)) return reading({ kind: 'past', days: 30 });

  const date = readDate(t, today, past && !future ? 'past' : future && !past ? 'future' : 'either');
  if (date) {
    const offset = daysBetween(today, date);
    // A named date within a couple of days reads as the relative word would.
    if (offset >= -2 && offset <= 2) return reading({ kind: 'day', offset });
    return reading({ kind: 'date', date });
  }

  if (hasAny(t, DAY_BEFORE_YESTERDAY)) return reading({ kind: 'day', offset: -2 });
  if (hasAny(t, YESTERDAY)) return reading({ kind: 'day', offset: -1 });
  if (hasAny(t, DAY_AFTER)) return reading({ kind: 'day', offset: 2 });
  if (hasAny(t, TOMORROW)) return reading({ kind: 'day', offset: 1 });

  // The two Hindi words that are both directions at once. Past tense
  // anywhere in the sentence decides; otherwise the future, as people ask.
  if (hasAny(t, PARSON)) return reading({ kind: 'day', offset: past && !future ? -2 : 2 });
  if (hasAny(t, KAL)) return reading({ kind: 'day', offset: past && !future ? -1 : 1 });

  const weekday = weekdayIn(t);
  if (weekday !== null) {
    const todayDay = new Date(`${today}T00:00:00Z`).getUTCDay();
    if (past && !future) {
      // The most recent one before today.
      const back = ((todayDay - weekday + 7) % 7) || 7;
      return reading({ kind: 'day', offset: -back });
    }
    const ahead = (weekday - todayDay + 7) % 7;
    return reading({ kind: 'day', offset: ahead });
  }

  if (hasAny(t, THIS_WEEK)) return reading({ kind: 'range', days: 7 });
  if (hasAny(t, TODAY)) return reading({ kind: 'day', offset: 0 });
  if (hasAny(t, NOW)) return reading({ kind: 'now' });

  return reading(null);
}

/**
 * True for a window that lies wholly in the past.
 *
 * @param today YYYY-MM-DD; needed only to place a calendar date
 */
export function isPastWindow(window: TimeWindow, today: string = todayInIndia()): boolean {
  switch (window.kind) {
    case 'day':
      return window.offset < 0;
    case 'past':
    case 'pastHours':
    case 'lastEvent':
      return true;
    case 'date':
      return window.date < today;
    default:
      return false;
  }
}

/** True for a window that lies wholly in the future. */
export function isFutureWindow(window: TimeWindow, today: string = todayInIndia()): boolean {
  if (window.kind === 'date') return window.date > today;
  return (window.kind === 'day' && window.offset > 0) || window.kind === 'range';
}

function clampAgo(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 3650);
}

/** A past span, bounded so one question cannot ask for a year of hourly data. */
function clampDays(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 31);
}

function clampHours(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 72);
}

/** Today's date in IST, as YYYY-MM-DD. */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}
