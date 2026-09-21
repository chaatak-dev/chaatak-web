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

/**
 * The language to write this turn's template and taxonomy in.
 *
 * Driven by the script the user actually wrote in, NOT by the language
 * toggle. The toggle is a speech choice — which locale the recogniser
 * listens in and which voice reads back — and using it here switched script
 * on anyone whose typing disagreed with it: someone typing Hinglish with the
 * toggle on Hindi got a Devanagari template back, and someone typing Gujarati
 * got an English one. "Never switch script on the user" is a locked rule, and
 * it was being broken on every template fallback.
 *
 * Templates and the warning taxonomy are hand-written in Hindi and English
 * only, so Devanagari answers in Hindi and every other script answers in
 * English. English is the right landing place for Latin input because it
 * preserves the script, which is the rule that matters; it is the right one
 * for the other Indic scripts because no template exists in them and machine
 * translating a severity level is the one failure the gate cannot catch.
 *
 * Only when the text has no letters to judge — a bare numeral, an emoji —
 * does the spoken choice break the tie.
 */
export function replyLanguage(
  question: string,
  spoken: LanguageCode,
  assistant: 'auto' | LanguageCode = 'auto',
): InterfaceLang {
  /*
   * An explicit assistant language wins, and that is not a contradiction of
   * the rule above. "Never switch script on the user" forbids switching it
   * SILENTLY — because they picked a voice, or because a detector guessed.
   * Someone who has gone to a setting and named the language they want
   * answers in has said exactly what they want, and ignoring that in favour
   * of the script they happened to type in would be its own kind of
   * override.
   */
  if (assistant !== 'auto') return interfaceLanguage(assistant);

  const script = detectScript(question);
  if (script === null) return interfaceLanguage(spoken);
  return script === 'Deva' ? 'hi' : 'en';
}

/* ------------------------------------------------------------------ */
/* Telling the model what to write in                                  */
/* ------------------------------------------------------------------ */

/**
 * Romanised-Hindi markers that an English weather question would not contain.
 *
 * Deliberately narrower than the parser's stopword list, which mixes English
 * and Hinglish because it is solving a different problem (stripping filler off
 * a place name). Here a single English word misread as Hinglish would answer an
 * English speaker in romanised Hindi, so the ambiguous overlap — "me", "ka",
 * "ke", "par", "se", "mere" — is left out and only the unmistakable stay.
 */
const ROMANISED_HINDI = [
  'mein', 'mai', 'hai', 'hain', 'hoga', 'hogi', 'rahega', 'rahegi',
  'kaisa', 'kaisi', 'kaise', 'kya', 'kitna', 'kitni', 'batao', 'bataiye',
  'zara', 'aur', 'liye', 'wala', 'wali', 'koi', 'vahan', 'nahi', 'nahin',
  'haan', 'abhi', 'aaj', 'kal', 'barish', 'baarish', 'barsaat', 'mausam',
  'garmi', 'thand', 'dhoop', 'andhi', 'toofan', 'chhata', 'sardi',
];

/** Whole words only — the house rule for every lexical check in this codebase. */
function hasWord(haystack: string, word: string): boolean {
  return new RegExp(`(?<![\p{L}\p{M}])${word}(?![\p{L}\p{M}])`, 'u').test(haystack);
}

function looksRomanisedHindi(text: string): boolean {
  const lower = text.toLowerCase();
  return ROMANISED_HINDI.some((word) => hasWord(lower, word));
}

export type AnswerStyle = {
  /** The language the reply should be written in. */
  code: LanguageCode;
  /** The script it must come back in. Enforced by the gate, not just asked for. */
  script: ScriptCode;
  /** Phrased for the model to follow rather than to infer. */
  instruction: string;
};

const STYLES: Record<string, Omit<AnswerStyle, 'code'>> = {
  en: { script: 'Latn', instruction: 'Write your reply in English.' },
  hinglish: {
    script: 'Latn',
    instruction:
      'Write your reply in Hinglish — Hindi written in the Latin alphabet, ' +
      'exactly as the user just wrote it. Do not use Devanagari.',
  },
  hi: { script: 'Deva', instruction: 'Write your reply in Hindi, in Devanagari script.' },
  mr: { script: 'Deva', instruction: 'Write your reply in Marathi, in Devanagari script.' },
  bn: { script: 'Beng', instruction: 'Write your reply in Bengali, in the Bengali script.' },
  gu: { script: 'Gujr', instruction: 'Write your reply in Gujarati, in the Gujarati script.' },
  ta: { script: 'Taml', instruction: 'Write your reply in Tamil, in the Tamil script.' },
  pa: { script: 'Guru', instruction: 'Write your reply in Punjabi, in the Gurmukhi script.' },
};

/**
 * Which language and script the model must answer this turn in.
 *
 * Derived here rather than left to the prompt's "mirror the user". Mirroring
 * was an instruction, and instructions drift: measured across the seven, the
 * model answered a Bengali question in Hindi, a Punjabi one in Hindi and an
 * English one in Hinglish — each time fluently, each time in a script the user
 * had not used. Naming the target explicitly is deterministic, and the gate
 * enforces the script afterwards so a drift lands on the template instead of
 * on the user.
 */
export function answerStyle(
  question: string,
  spoken: LanguageCode,
  assistant: 'auto' | LanguageCode = 'auto',
): AnswerStyle {
  /*
   * Named outright, when the person has named it. `auto` — the default, and
   * what every existing caller passes — keeps mirroring whatever they wrote,
   * which is the behaviour this function was built for and the one the gate
   * enforces the script of.
   */
  if (assistant !== 'auto') {
    const chosen = STYLES[assistant] ?? STYLES.en;
    return { code: assistant, ...chosen };
  }

  const script = detectScript(question);

  let key: string;
  if (script === null) key = spoken;
  else if (script === 'Deva') key = spoken === 'mr' ? 'mr' : 'hi';
  else if (script === 'Beng') key = 'bn';
  else if (script === 'Gujr') key = 'gu';
  else if (script === 'Taml') key = 'ta';
  else if (script === 'Guru') key = 'pa';
  else key = looksRomanisedHindi(question) ? 'hinglish' : 'en';

  const style = STYLES[key] ?? STYLES.en;
  return { code: key === 'hinglish' ? 'hi' : (key as LanguageCode), ...style };
}
