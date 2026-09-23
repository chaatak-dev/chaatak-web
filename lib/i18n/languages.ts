/**
 * The languages Chaatak speaks, and — separately — the languages it can say a
 * severity in.
 *
 * Those are not the same list, and conflating them would be the most dangerous
 * thing in this file. Bhashini gives us ASR and TTS for all seven, verified
 * against the live pipeline. But IMD's warning taxonomy is human-translated,
 * never machine-translated, and human translations exist for two of them. A
 * Tamil speaker can ask and be answered in Tamil; the words "Red warning" stay
 * in a language a human actually translated them into, because a softened
 * severity is the one failure the verification gate cannot catch.
 *
 * So each language declares what it actually supports, and the UI says so
 * rather than implying a completeness that is not there.
 */

export type LanguageCode = 'hi' | 'en' | 'gu' | 'mr' | 'bn' | 'ta' | 'pa';

/** Unicode script, as Bhashini reports it in its pipeline config. */
export type ScriptCode = 'Deva' | 'Latn' | 'Gujr' | 'Beng' | 'Taml' | 'Guru';

export type LanguageSupport = {
  /** ASR and TTS through Bhashini. Verified against the live pipeline. */
  speech: boolean;
  /** Interface chrome — labels, buttons, statements — human-translated. */
  interface: boolean;
  /**
   * The severity taxonomy, WMO conditions and spoken units, human-translated.
   * False means a warning renders its severity in the fallback language, and
   * is NEVER machine-translated into this one.
   */
  taxonomy: boolean;
};

export type Language = {
  code: LanguageCode;
  /** BCP-47, for speech engines and the `lang` attribute. */
  bcp47: string;
  /** The language's own name in its own script. The only label a user needs. */
  native: string;
  /** For accessible names and operator-facing text. */
  english: string;
  script: ScriptCode;
  /** The Bhashini `sourceLanguage` value. Same as `code` for all seven. */
  bhashini: string;
  support: LanguageSupport;
};

/**
 * When a language has no human-translated taxonomy, severity falls back to
 * this one rather than being invented. English rather than Hindi: it is the
 * language IMD itself publishes warning codes in.
 */
export const TAXONOMY_FALLBACK: TaxonomyLang = 'en';

const FULL: LanguageSupport = { speech: true, interface: true, taxonomy: true };
const SPEECH_ONLY: LanguageSupport = {
  speech: true,
  interface: false,
  taxonomy: false,
};

export const LANGUAGES: readonly Language[] = [
  {
    code: 'hi',
    bcp47: 'hi-IN',
    native: 'हिंदी',
    english: 'Hindi',
    script: 'Deva',
    bhashini: 'hi',
    support: FULL,
  },
  {
    code: 'en',
    bcp47: 'en-IN',
    native: 'English',
    english: 'English',
    script: 'Latn',
    bhashini: 'en',
    support: FULL,
  },
  {
    code: 'bn',
    bcp47: 'bn-IN',
    native: 'বাংলা',
    english: 'Bengali',
    script: 'Beng',
    bhashini: 'bn',
    support: SPEECH_ONLY,
  },
  {
    code: 'mr',
    bcp47: 'mr-IN',
    native: 'मराठी',
    english: 'Marathi',
    // Marathi shares Devanagari with Hindi, so it needs no additional font —
    // the only one of the five that does not.
    script: 'Deva',
    bhashini: 'mr',
    support: SPEECH_ONLY,
  },
  {
    code: 'ta',
    bcp47: 'ta-IN',
    native: 'தமிழ்',
    english: 'Tamil',
    script: 'Taml',
    bhashini: 'ta',
    support: SPEECH_ONLY,
  },
  {
    code: 'gu',
    bcp47: 'gu-IN',
    native: 'ગુજરાતી',
    english: 'Gujarati',
    script: 'Gujr',
    bhashini: 'gu',
    support: SPEECH_ONLY,
  },
  {
    code: 'pa',
    bcp47: 'pa-IN',
    native: 'ਪੰਜਾਬੀ',
    english: 'Punjabi',
    script: 'Guru',
    bhashini: 'pa',
    support: SPEECH_ONLY,
  },
] as const;

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && BY_CODE.has(value as LanguageCode);
}

export function language(code: LanguageCode): Language {
  const found = BY_CODE.get(code);
  // Unreachable through the type, but a missing entry would otherwise surface
  // as a blank label rather than a loud failure.
  if (!found) throw new Error(`No language registered for "${code}"`);
  return found;
}

export function bcp47(code: LanguageCode): string {
  return language(code).bcp47;
}

export function scriptOf(code: LanguageCode): ScriptCode {
  return language(code).script;
}

/**
 * The language a severity string is rendered in.
 *
 * Returns the requested language only when a human has translated the taxonomy
 * into it. There is no third option: machine-translating a warning level is
 * the failure that reads as fluent and correct while being neither.
 */
export function taxonomyLanguage(code: LanguageCode): TaxonomyLang {
  return language(code).support.taxonomy
    ? (code as TaxonomyLang)
    : TAXONOMY_FALLBACK;
}

/** True when the user should be told the taxonomy is not in their language. */
export function taxonomyIsBorrowed(code: LanguageCode): boolean {
  return taxonomyLanguage(code) !== code;
}

/** Languages whose interface strings exist. Everything else borrows these. */
export type InterfaceLang = 'hi' | 'en';

/**
 * Languages the warning taxonomy is human-translated into.
 *
 * Identical to InterfaceLang today and typed separately on purpose: interface
 * copy and severity vocabulary are translated by different people to different
 * standards, and this list is the one that must never grow by machine.
 */
export type TaxonomyLang = 'hi' | 'en';

export function interfaceLanguage(code: LanguageCode): InterfaceLang {
  if (language(code).support.interface) return code as InterfaceLang;
  // Devanagari and Indo-Aryan speakers read Hindi chrome more comfortably than
  // English; Dravidian and Latin-script speakers get English.
  return scriptOf(code) === 'Deva' ? 'hi' : 'en';
}

/* ------------------------------------------------------------------ */
/* What language to answer in                                          */
/* ------------------------------------------------------------------ */

/** The Unicode block each script Chaatak accepts is written in. */
const SCRIPT_RANGES: [ScriptCode, RegExp][] = [
  ['Deva', /[ऀ-ॿ]/g],
  ['Beng', /[ঀ-৿]/g],
  ['Guru', /[਀-੿]/g],
  ['Gujr', /[઀-૿]/g],
  ['Taml', /[஀-௿]/g],
  ['Latn', /[A-Za-z]/g],
];

/**
 * The script a piece of text is predominantly written in, or null when it
 * carries no letters at all — a bare "26?" or an emoji.
 */
export function detectScript(text: string): ScriptCode | null {
  let best: ScriptCode | null = null;
  let bestCount = 0;
  for (const [script, pattern] of SCRIPT_RANGES) {
    const count = (text.match(pattern) ?? []).length;
    if (count > bestCount) {
      best = script;
      bestCount = count;
    }
  }
  return best;
}

/*
 * Which language a TURN is answered in — and the instruction the model is
 * given, and the template set a rejection falls back to — is decided in
 * ./detect.ts, with the conversation's context. This file is the registry:
 * what each language is and what it supports.
 */
