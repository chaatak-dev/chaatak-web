/**
 * What an empty chat says, and what it offers to ask.
 *
 * STABLE, NOT RANDOM. A greeting picked with `Math.random()` at render time
 * changes on every keystroke, every theme toggle and every re-render — the
 * person watches the page talk to itself. It is picked here from a SEED
 * instead: the same chat always shows the same greeting, a new chat shows a
 * different one, and nothing has to be stored or held in state to make that
 * true. Deterministic, so it is also testable.
 *
 * HUMAN-WRITTEN, LIKE EVERY OTHER STRING. The Hindi lines are not
 * translations of the English ones; they are the same thought written in
 * Hindi, which is why "Ready to check the skies?" has no literal counterpart.
 * Nothing here is machine-generated, and nothing here may be.
 *
 * WEATHER-SPECIFIC, because a greeting is the first thing the product says
 * and "How can I help?" would be the first thing it says that is not true.
 * Chaatak does weather.
 */

import type { InterfaceLang } from './languages';

type Line = Record<InterfaceLang, string>;

/**
 * `{name}` is a first name only — never the full name and never an email.
 * A greeting that says "Hey, yash.sharma@gmail.com" is worse than one that
 * says nothing.
 */
const NAMED: readonly Line[] = [
  {
    en: 'Hey, {name}. What’s happening outside?',
    hi: '{name}, बाहर मौसम कैसा है?',
  },
  {
    en: 'Hey, {name}. Ready to check the skies?',
    hi: '{name}, आसमान का हाल देखें?',
  },
  {
    en: 'Good to see you, {name}. What’s the weather doing?',
    hi: '{name}, मौसम के बारे में क्या जानना है?',
  },
  {
    en: 'Hey, {name}. Need a weather check?',
    hi: '{name}, मौसम देख लें?',
  },
  {
    en: '{name}, what would you like to know about the weather?',
    hi: '{name}, मौसम का क्या पूछना है?',
  },
];

const ANONYMOUS: readonly Line[] = [
  { en: 'Hey there. What’s happening outside?', hi: 'बाहर मौसम कैसा है?' },
  { en: 'Ready to check the skies?', hi: 'आसमान का हाल देखें?' },
  { en: 'What’s the weather looking like?', hi: 'मौसम कैसा चल रहा है?' },
  { en: 'Need a weather check?', hi: 'मौसम देख लें?' },
  { en: 'Ask about the weather anywhere in India.', hi: 'भारत में कहीं का भी मौसम पूछें।' },
];

/**
 * The chips under the greeting.
 *
 * Short, and each one is a question this product actually answers well: two
 * of them need no place at all, which is what "use my location" is for.
 */
const SUGGESTIONS: readonly Line[] = [
  { en: 'Temperature', hi: 'तापमान' },
  { en: 'Will it rain?', hi: 'बारिश होगी?' },
  { en: 'Any warnings?', hi: 'कोई चेतावनी?' },
  { en: 'Weather near me', hi: 'मेरे पास का मौसम' },
  { en: 'Weather tomorrow', hi: 'कल का मौसम' },
  { en: 'Is it safe to travel?', hi: 'क्या सफ़र ठीक रहेगा?' },
];

/** How many chips an empty chat offers. More than this is a menu, not a nudge. */
export const SUGGESTION_COUNT = 4;

/**
 * A small, stable hash of the seed.
 *
 * FNV-1a: a few lines, no dependency, and evenly spread enough that
 * consecutive conversation ids do not land on the same greeting. It is not a
 * security primitive and is not used as one.
 */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The first name, or nothing.
 *
 * A display name from Google is usually "Yash Sharma" and sometimes an email
 * local part. The first whitespace-separated word is the name people use, and
 * anything with an @ in it is not a name at all.
 */
export function firstName(displayName: string | null | undefined): string | null {
  if (!displayName) return null;
  const trimmed = displayName.trim();
  if (!trimmed || trimmed.includes('@')) return null;

  const first = trimmed.split(/\s+/)[0];
  // A one-character "name" is an initial, and greeting someone as "Y." reads
  // worse than greeting them as nobody.
  return first.length >= 2 ? first : null;
}

/**
 * The greeting for one chat.
 *
 * @param seed  anything stable for this chat — its id, or the new-chat key
 * @param name  the person's first name, or null for a guest
 */
export function greeting(
  seed: string,
  name: string | null,
  lang: InterfaceLang,
): string {
  const pool = name ? NAMED : ANONYMOUS;
  const line = pool[hash(seed) % pool.length][lang];
  return name ? line.replace(/\{name\}/g, name) : line;
}

/**
 * The chips for one chat: a stable rotation through the pool.
 *
 * Takes a run of consecutive entries starting at the seeded offset rather
 * than sampling, so the four are always distinct and the set moves as a group
 * between chats.
 */
export function suggestions(
  seed: string,
  lang: InterfaceLang,
  count = SUGGESTION_COUNT,
): string[] {
  const start = hash(seed) % SUGGESTIONS.length;
  const wanted = Math.min(count, SUGGESTIONS.length);

  return Array.from(
    { length: wanted },
    (_, i) => SUGGESTIONS[(start + i) % SUGGESTIONS.length][lang],
  );
}
