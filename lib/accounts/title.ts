/**
 * Naming a conversation from its first question.
 *
 * NO MODEL CALL. The question has already been parsed into a place, a
 * variable and a time window by the time this runs — that structure is what a
 * title is made of, so asking a model to read the sentence a second time
 * would spend a request on something already known. Free tiers are the reason
 * the pattern layer exists at all; a title is not where that budget goes.
 *
 * Written once, from the opening question, and never rewritten by a later
 * turn. A conversation named after what it started as is a label someone can
 * recognise a week later; one renamed on every message is a moving target.
 *
 * Titles come out in the LANGUAGE THE PERSON WROTE IN. A Hindi question gets
 * a Hindi title, because the recent list is theirs to scan and switching
 * script on someone is the one thing the language rules never allow.
 */

import type { TimeWindow, Variable } from '../parse/types';
import type { InterfaceLang } from '../i18n/languages';

/** Longer than this and a sidebar row truncates mid-word anyway. */
const MAX_LENGTH = 48;

const VARIABLE_WORD: Record<Variable, { hi: string; en: string } | null> = {
  all: null,
  temperature: { hi: 'तापमान', en: 'temperature' },
  rain: { hi: 'बारिश', en: 'rain' },
  wind: { hi: 'हवा', en: 'wind' },
  humidity: { hi: 'नमी', en: 'humidity' },
};

const DAY_WORD: Record<number, { hi: string; en: string }> = {
  0: { hi: 'आज', en: 'today' },
  1: { hi: 'कल', en: 'tomorrow' },
  2: { hi: 'परसों', en: 'day after' },
};

const WARNING_WORD = { hi: 'चेतावनी', en: 'warning' };

export type TitleInput = {
  /** The question, verbatim. The fallback, and the only source of truth. */
  question: string;
  /** The resolved place name, when the turn resolved one. */
  place?: string | null;
  intent?: 'current' | 'forecast' | 'warning';
  timeWindow?: TimeWindow;
  variable?: Variable;
  lang: InterfaceLang;
};

/**
 * A short, human-readable label.
 *
 *   "What's the temperature in Delhi?"      → "Delhi temperature"
 *   "Will it rain in Ghaziabad tomorrow?"   → "Ghaziabad rain tomorrow"
 *   "बाराबंकी में कल बारिश होगी?"              → "बाराबंकी बारिश कल"
 *
 * When there is no place — small talk, a question about what orange alert
 * means — the question's own opening words are the title. They are what the
 * person wrote, which beats anything composed on their behalf.
 */
export function conversationTitle(input: TitleInput): string {
  const { lang } = input;
  const parts: string[] = [];

  const place = input.place?.trim();
  if (place) parts.push(place);

  if (input.intent === 'warning') {
    parts.push(WARNING_WORD[lang]);
  } else {
    const variable = input.variable ? VARIABLE_WORD[input.variable] : null;
    if (variable) parts.push(variable[lang]);
  }

  const day = dayWord(input.timeWindow, lang);
  if (day) parts.push(day);

  // A place alone is a thin label — "Delhi" says nothing about what was
  // asked. With nothing else to add, the question says more.
  if (parts.length >= 2) return clamp(parts.join(' '));

  return clamp(fromQuestion(input.question)) || clamp(parts.join(' ')) || '';
}

function dayWord(
  window: TimeWindow | undefined,
  lang: InterfaceLang,
): string | null {
  if (!window) return null;
  // "now" adds nothing: every unqualified question is about now.
  if (window.kind === 'day' && window.offset > 0) {
    return DAY_WORD[window.offset]?.[lang] ?? null;
  }
  if (window.kind === 'range') {
    return lang === 'hi' ? `${window.days} दिन` : `${window.days} days`;
  }
  return null;
}

/**
 * The question, tidied into a label.
 *
 * Trailing punctuation goes, runs of whitespace collapse, and that is all.
 * Nothing is translated, nothing is rephrased, and the script is whatever the
 * person typed in.
 */
function fromQuestion(question: string): string {
  return question
    .replace(/\s+/g, ' ')
    .replace(/[?!.।,]+\s*$/u, '')
    .trim();
}

/**
 * Cut to length at a word boundary.
 *
 * Devanagari is counted in code points like everything else here; the ellipsis
 * is a single character so a clamped title never gains width from being
 * clamped.
 */
function clamp(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_LENGTH) return trimmed;

  const cut = trimmed.slice(0, MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  // Only break at a space if one is reasonably near the end — otherwise a
  // long unbroken string would lose most of itself to the search.
  const body = lastSpace > MAX_LENGTH * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

/**
 * What a conversation is called before its first question lands, and what a
 * rename may not reduce it to.
 */
export const UNTITLED: Record<InterfaceLang, string> = {
  hi: 'नई बातचीत',
  en: 'New chat',
};
