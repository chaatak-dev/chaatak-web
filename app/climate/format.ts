/**
 * How a computed climate value reads on screen.
 *
 * Display only. Every number arrives already rounded by the server to its
 * parameter's precision; this fixes how many decimals are SHOWN (so 25 reads
 * "25.0 °C" beside "24.6 °C") and nothing else. A sign is shown on a
 * difference, because "+0.4" and "0.4" are different claims.
 */

import type { InterfaceLang } from '@/lib/i18n/languages';
import type { Translate } from '@/lib/i18n/strings';

const MINUS = '−';

export function num(value: number, decimals: number): string {
  const text = Math.abs(value).toFixed(decimals);
  return value < 0 && Number(text) !== 0 ? `${MINUS}${text}` : text;
}

export function signed(value: number, decimals: number): string {
  const text = Math.abs(value).toFixed(decimals);
  if (Number(text) === 0) return text;
  return value > 0 ? `+${text}` : `${MINUS}${text}`;
}

/** A unit as a reader sees it. "days" is a word, and so is translated. */
export function unitText(unit: string, t: Translate): string {
  return unit === 'days' ? t('climate.unit.days') : unit;
}

/** "25.0 °C", "511 mm", "46 days". */
export function withUnit(value: string, unit: string, t: Translate): string {
  const u = unitText(unit, t);
  return unit === '%' ? `${value}%` : `${value} ${u}`;
}

function locale(lang: InterfaceLang): string {
  return lang === 'hi' ? 'hi-IN' : 'en-IN';
}

/** YYYY-MM-DD as "19 May 2016". Calendar dates, so read in UTC. */
export function day(iso: string, lang: InterfaceLang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** YYYY-MM as "May 2010". */
export function month(iso: string, lang: InterfaceLang): string {
  return new Intl.DateTimeFormat(locale(lang), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}-01T00:00:00Z`),
  );
}

/** A time we asked, in IST — diagnostic, and labelled as such. */
export function retrieved(iso: string, lang: InterfaceLang): string {
  return new Intl.DateTimeFormat(locale(lang), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

export function coord(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(2)}° ${value >= 0 ? positive : negative}`;
}
