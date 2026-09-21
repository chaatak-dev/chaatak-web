/**
 * Three language preferences, and how each one resolves.
 *
 * THE POINT OF THIS FILE: they are three, not one. Chaatak had a single
 * "language" setting that was really the voice locale, and everything else
 * quietly followed it — which meant choosing a voice could change the script
 * of written text, and there was no way to read the interface in English
 * while asking questions in Hindi. These are independent by construction:
 *
 *   ui         what the interface is written in
 *   assistant  what an answer is written in
 *   voice      what the recogniser listens in and the voice reads back
 *
 * Each is `auto` by default, and `auto` means something different and
 * specific for each — detection for the UI, mirror-the-user for the
 * assistant, follow-the-choice for voice. None of them ever changes because
 * another one did.
 *
 * Resolution is pure and lives here rather than in a component, so the rules
 * can be asserted rather than inferred from render order.
 */

import {
  interfaceLanguage,
  isLanguageCode,
  LANGUAGES,
  language,
  type InterfaceLang,
  type LanguageCode,
} from './languages';

/** `auto` or one of the seven. There is no third kind of answer. */
export type LanguagePreference = 'auto' | LanguageCode;

export type LanguagePreferences = {
  ui: LanguagePreference;
  assistant: LanguagePreference;
  voice: LanguagePreference;
};

export const DEFAULT_PREFERENCES: LanguagePreferences = {
  ui: 'auto',
  assistant: 'auto',
  voice: 'auto',
};

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'auto' || isLanguageCode(value);
}

/** Reads a stored or transmitted value, falling back rather than throwing. */
export function readPreference(value: unknown): LanguagePreference {
  return isLanguagePreference(value) ? value : 'auto';
}

export function readPreferences(value: unknown): LanguagePreferences {
  if (!value || typeof value !== 'object') return DEFAULT_PREFERENCES;
  const raw = value as Record<string, unknown>;
  return {
    ui: readPreference(raw.ui),
    assistant: readPreference(raw.assistant),
    voice: readPreference(raw.voice),
  };
}

/* ------------------------------------------------------------------ */
/* Automatic detection                                                 */
/* ------------------------------------------------------------------ */

/**
 * Which languages automatic detection may land on.
 *
 * Derived from `support.interface` rather than listed separately, and that is
 * the whole extensibility story: a language becomes auto-detectable at the
 * moment its interface strings exist, in the same commit, with nothing here
 * to remember to change. Today that is Hindi and English. When Gujarati
 * chrome is written and `interface` flips to true, ગુજરાતી devices get a
 * Gujarati interface and this file is untouched.
 *
 * Detecting a language whose strings do not exist would be worse than not
 * detecting it: the person would be told the app is in their language and
 * then shown English.
 */
export function autoDetectable(): LanguageCode[] {
  return LANGUAGES.filter((l) => l.support.interface).map((l) => l.code);
}

/** The last resort. English, because it is the one the taxonomy is issued in. */
export const UI_FALLBACK: InterfaceLang = 'en';

/**
 * The interface language a device is asking for.
 *
 * Walks `navigator.languages` IN ORDER, because that list is a ranking the
 * person set and the first entry is not always the informative one — a phone
 * set to ["en-GB", "hi-IN"] wants English, and one set to ["hi-IN", "en-US"]
 * wants Hindi. Reading only `navigator.language` would answer the first
 * correctly and the second wrongly.
 *
 * Region and script subtags are ignored: hi, hi-IN and hi-Latn-IN are all a
 * request for Hindi.
 */
export function detectUiLanguage(
  preferred: readonly string[] | undefined,
): InterfaceLang {
  const available = new Set(autoDetectable());

  for (const tag of preferred ?? []) {
    const primary = String(tag).toLowerCase().split('-')[0];
    if (available.has(primary as LanguageCode)) {
      // Only a language with interface strings reaches here, so this is
      // already an InterfaceLang — `interfaceLanguage` keeps that true in the
      // type system rather than by assertion.
      return interfaceLanguage(primary as LanguageCode);
    }
  }

  return UI_FALLBACK;
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

export type ResolvedLanguages = {
  /** What the interface actually renders in. Always a language we have. */
  ui: InterfaceLang;
  /**
   * The language the person CHOSE for the interface, which may be one whose
   * chrome does not exist yet. Kept so the interface can say so, and so that
   * voice has something sensible to follow.
   */
  uiChoice: LanguageCode;
  /** True when `uiChoice` is borrowing another language's chrome. */
  uiIsBorrowed: boolean;
  /**
   * What the assistant writes in. `auto` is not resolved to a language here
   * on purpose — it means "mirror whatever the user just wrote", which is a
   * per-turn decision made from the question itself.
   */
  assistant: LanguagePreference;
  /** What the recogniser listens in. Always concrete; speech needs a locale. */
  voice: LanguageCode;
};

/**
 * Turn three preferences and a device into the three answers the app needs.
 *
 * The chain for each is deliberately short and stated:
 *
 *   ui        explicit choice → device → English
 *   assistant explicit choice → auto (mirror the user, decided per turn)
 *   voice     explicit choice → the assistant's explicit choice → the UI
 *
 * Voice follows the others only when it has been left on auto. Someone who
 * sets a voice never has it moved by a UI change, and someone who sets a UI
 * language and says nothing about voice gets a voice that matches — which is
 * what "auto" should mean and what a separate silent default would not give.
 */
export function resolveLanguages(
  preferences: LanguagePreferences,
  preferred: readonly string[] | undefined,
): ResolvedLanguages {
  const detected = detectUiLanguage(preferred);

  const uiChoice: LanguageCode = preferences.ui === 'auto' ? detected : preferences.ui;
  const ui = interfaceLanguage(uiChoice);

  const voice: LanguageCode =
    preferences.voice !== 'auto'
      ? preferences.voice
      : preferences.assistant !== 'auto'
        ? preferences.assistant
        : uiChoice;

  return {
    ui,
    uiChoice,
    uiIsBorrowed: uiChoice !== ui,
    assistant: preferences.assistant,
    voice,
  };
}

/**
 * The language an alert is written in.
 *
 * An alert arrives while the phone is in a pocket, so there is no question to
 * mirror and no browser to ask — it follows the INTERFACE language, because
 * that is the language this person reads Chaatak in. The taxonomy is
 * human-translated into two, and `interfaceLanguage` has already narrowed to
 * those, so this can never ask the daemon for a template that does not exist.
 */
export function alertLanguage(resolved: ResolvedLanguages): InterfaceLang {
  return resolved.ui;
}

/** The label a preference shows in a settings list, in its own script. */
export function preferenceLabel(
  preference: LanguagePreference,
  autoLabel: string,
): string {
  if (preference === 'auto') return autoLabel;
  const entry = language(preference);
  return entry.native === entry.english
    ? entry.native
    : `${entry.native} · ${entry.english}`;
}
