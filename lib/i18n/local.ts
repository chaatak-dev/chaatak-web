'use client';

/**
 * Where a guest's language choices live, and how the browser's own
 * preference is read.
 *
 * Both are external stores read through `useSyncExternalStore` rather than
 * restored in an effect. That gives the server a defined snapshot — the
 * defaults — so there is no hydration mismatch, and it means a returning
 * visitor's chosen language is applied on the FIRST paint instead of flashing
 * English for a frame and then correcting itself. A language that visibly
 * changes after load reads as a bug even when the final state is right.
 */

import {
  DEFAULT_PREFERENCES,
  readPreferences,
  type LanguagePreferences,
} from './preferences';

const KEY = 'chaatak:languages';
const EVENT = 'chaatak:languages-changed';

/**
 * The key the voice language used to live under, back when there was one
 * setting. Read once so a returning visitor keeps the voice they chose.
 */
const LEGACY_VOICE_KEY = 'chaatak:voice-lang';

/*
 * getSnapshot must return a stable reference or React re-renders forever, so
 * the parsed value is cached and only rebuilt when the raw string changes.
 */
let cachedRaw: string | null = null;
let cached: LanguagePreferences = DEFAULT_PREFERENCES;

export function subscribeLanguages(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  // Another tab changing the setting is the same event as this tab changing
  // it; `storage` only fires in the tabs that did not make the change.
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function languagesSnapshot(): LanguagePreferences {
  try {
    const raw = localStorage.getItem(KEY);

    if (raw === null) {
      /*
       * Nothing stored under the new key. Someone who used Chaatak before
       * the interface and assistant languages existed has a voice choice
       * under the old one, and it means exactly what it still means — so it
       * is carried over rather than reset to auto.
       */
      const legacy = localStorage.getItem(LEGACY_VOICE_KEY);
      if (legacy) {
        const migrated = readPreferences({ ui: 'auto', assistant: 'auto', voice: legacy });
        cachedRaw = null;
        cached = migrated;
        return migrated;
      }
    }

    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cached = raw ? readPreferences(JSON.parse(raw)) : DEFAULT_PREFERENCES;
    }
    return cached;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** The server has no browser, so it renders the defaults and hydrates over. */
export function serverLanguagesSnapshot(): LanguagePreferences {
  return DEFAULT_PREFERENCES;
}

export function writeLanguagesLocal(preferences: LanguagePreferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(preferences));
    // The old single setting is kept in step, so anything still reading it —
    // an open tab on a previous build — does not disagree with this one.
    localStorage.setItem(LEGACY_VOICE_KEY, preferences.voice);
  } catch {
    // Private mode: the choice holds for this page view and does not persist.
    cachedRaw = null;
    cached = preferences;
  }
  window.dispatchEvent(new Event(EVENT));
}

/* ------------------------------------------------------------------ */
/* What the device is asking for                                       */
/* ------------------------------------------------------------------ */

let cachedDeviceLanguages: readonly string[] | undefined;

/**
 * `navigator.languages`, as a stable reference.
 *
 * The array is re-created by some browsers on every access, which would make
 * it a new snapshot every render. It is also effectively constant for the
 * life of a page — a device language change reloads the app — so caching it
 * once is both correct and necessary.
 */
export function deviceLanguages(): readonly string[] | undefined {
  if (cachedDeviceLanguages) return cachedDeviceLanguages;
  if (typeof navigator === 'undefined') return undefined;

  const list =
    navigator.languages && navigator.languages.length > 0
      ? [...navigator.languages]
      : navigator.language
        ? [navigator.language]
        : [];

  cachedDeviceLanguages = list;
  return cachedDeviceLanguages;
}
