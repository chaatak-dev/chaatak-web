/**
 * The last known answer, kept for when the network is not there.
 *
 * This is the one place this app can most easily start lying. An old warning
 * shown without its age is worse than no warning at all, so the rules here are
 * structural rather than conventions:
 *
 *   1. `issuedAt` and `cachedAt` are NON-OPTIONAL. An entry without provenance
 *      is unrepresentable, not merely discouraged.
 *   2. Age is COMPUTED ON READ, never stored. A stored "40 minutes ago" still
 *      says 40 minutes tomorrow, which is exactly the lie this exists to stop.
 *   3. A cached warning whose validity window has fully elapsed stops being a
 *      warning and becomes noData. An expired red warning shown offline reads
 *      as live danger.
 */

import type { Grounding } from '../chat/types';
import type { SpeechLang } from '../speech/types';

export const CACHE_KEY = 'chaatak:last-answer';
export const CACHE_EVENT = 'chaatak:last-answer-changed';

/**
 * Both timestamps are required. `issuedAt` is the source's, `cachedAt` is
 * ours; neither can be inferred from the other and neither is optional.
 */
export type CachedAnswer = {
  text: string;
  lang: SpeechLang;
  /** When the SOURCE issued it. Never our clock. */
  issuedAt: string;
  /** When WE stored it. Never the source's clock. */
  cachedAt: string;
  grounding: Grounding;
  /** End of the warning's validity window, when it had one. */
  validTo: string | null;
};

export type Staleness = {
  /** Whole minutes since the source issued it. Computed now, never stored. */
  ageMinutes: number;
  /** True once the cached warning's own validity window has elapsed. */
  expired: boolean;
};

export function staleness(entry: CachedAnswer, now = new Date()): Staleness {
  const issued = new Date(entry.issuedAt).getTime();
  const ageMinutes = Number.isFinite(issued)
    ? Math.max(0, Math.floor((now.getTime() - issued) / 60_000))
    : 0;

  const validTo = entry.validTo ? new Date(entry.validTo).getTime() : null;
  const expired = validTo !== null && Number.isFinite(validTo) && validTo <= now.getTime();

  return { ageMinutes, expired };
}

/** "40 मिनट पहले" / "40 minutes ago", in whichever unit reads honestly. */
export function ageLabel(minutes: number, lang: SpeechLang): string {
  if (minutes < 1) return lang === 'hi' ? 'अभी-अभी' : 'just now';

  if (minutes < 60) {
    return lang === 'hi' ? `${minutes} मिनट पहले` : `${minutes} minutes ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return lang === 'hi' ? `${hours} घंटे पहले` : `${hours} hours ago`;
  }

  const days = Math.floor(hours / 24);
  return lang === 'hi' ? `${days} दिन पहले` : `${days} days ago`;
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

let cachedRaw: string | null = null;
let cachedEntry: CachedAnswer | null = null;

/**
 * Synchronous, and deliberately so. The stale banner has to be on the first
 * paint — a cached answer that looks current for three seconds before the
 * offline notice arrives is the same lie with a shorter life.
 */
export function readCache(): CachedAnswer | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedEntry = raw ? (JSON.parse(raw) as CachedAnswer) : null;

      // An entry missing either timestamp predates this format, or was
      // tampered with. Either way it cannot state its own age, so it is not
      // shown at all.
      if (cachedEntry && (!cachedEntry.issuedAt || !cachedEntry.cachedAt)) {
        cachedEntry = null;
      }
    }
    return cachedEntry;
  } catch {
    return null;
  }
}

export function writeCache(entry: CachedAnswer): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Private mode or a full quota: the answer still shows, it just will not
    // survive a reload. Nothing here fails loudly over that.
  }
  cachedRaw = null;
  window.dispatchEvent(new Event(CACHE_EVENT));
}

export function subscribeCache(onChange: () => void): () => void {
  window.addEventListener(CACHE_EVENT, onChange);
  return () => window.removeEventListener(CACHE_EVENT, onChange);
}

/* ------------------------------------------------------------------ */
/* Connectivity                                                        */
/* ------------------------------------------------------------------ */

/**
 * Read synchronously from navigator.onLine, never inferred from a failed
 * fetch. Waiting for a request to time out before admitting we are offline is
 * precisely the three-second lie.
 */
export function isOffline(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    return false;
  }
}

export function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}
