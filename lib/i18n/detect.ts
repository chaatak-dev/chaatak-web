/**
 * Which language a turn is in — decided BEFORE anything is generated.
 *
 * WHY THIS IS NOT THE MODEL'S JOB. Asked to "mirror the user", a model drifts:
 * Bengali came back in Hindi, English in Hinglish, and a short "ohh really"
 * after a Hinglish answer came back in English because nothing in two words
 * says Hindi. So the decision is made here, deterministically, and handed to
 * the response layer as an instruction it is then held to by the gate.
 *
 * WHAT IT DECIDES. Three things, kept apart because they fail differently:
 *
 *   code        the language — hi, en, mr, bn, gu, ta, pa
 *   script      the writing system — Hindi can be Deva or Latn (Hinglish)
 *   confidence  how much the turn itself said, which is what decides whether
 *               the conversation's language may overrule it
 *
 * HOW. Script first, because it is the one signal that is never ambiguous:
 * Tamil letters are Tamil. Within Latin, English and romanised Hindi are told
 * apart by FUNCTION words — hai, mein, kya against the, will, what — never by
 * content words, because "weather" and "rain" are used in Hinglish exactly as
 * often as in English and counting them would turn every Hinglish question
 * into an English one. Within Devanagari, Marathi is told from Hindi the same
 * way.
 *
 * A SHORT TURN MAY BE OVERRULED, ASYMMETRICALLY. "ok", "wow", "ohh really"
 * carry no language, and a reaction must not switch the conversation to
 * English because the UI happens to be English. So a turn of three words or
 * fewer inherits the conversation's language unless it carries evidence of a
 * DIFFERENT one — and that evidence is weighed asymmetrically on purpose:
 * people who speak Hinglish use English words constantly ("and tomorrow?"),
 * while people who speak English do not use Hindi function words by accident
 * ("aur kal?"). English words in a short turn therefore do not pull a Hindi
 * conversation into English; Hindi words in a short turn do pull an English
 * one into Hindi.
 *
 * Every lexical check here matches whole words. That is a standing rule in
 * this codebase after two substring bugs: "remain" contains "mai", "chain"
 * contains "hain", and न sits inside लेकिन.
 */

import {
  detectScript,
  isLanguageCode,
  language,
  type InterfaceLang,
  type LanguageCode,
  type ScriptCode,
} from './languages';
import type { LanguagePreference } from './preferences';

export type Confidence = 'high' | 'medium' | 'low';

export type TurnLanguage = {
  code: LanguageCode;
  script: ScriptCode;
  confidence: Confidence;
  /** What decided it. Logged, and asserted in tests. */
  basis: 'explicit' | 'script' | 'lexicon' | 'context' | 'spoken' | 'default';
};

/** Hindi written in the Latin alphabet: Hinglish. */
export function isHinglish(lang: Pick<TurnLanguage, 'code' | 'script'>): boolean {
  return lang.code === 'hi' && lang.script === 'Latn';
}

/* ------------------------------------------------------------------ */
/* Lexicons                                                            */
/* ------------------------------------------------------------------ */

/**
 * Romanised-Hindi words that are not English words.
 *
 * Grammar and the Hindi weather vocabulary. Deliberately excluded because
 * they are ordinary English too: me, to, the, do, par, is, so, us, main, are,
 * mere, bus, hum(?) — any of them would read an English sentence as Hinglish.
 */
const HINGLISH_STRONG = new Set([
  // copulas, tense and aspect
  'hai', 'hain', 'hoon', 'hun', 'ho', 'tha', 'thi', 'thay', 'hoga', 'hogi',
  // "hue" is left out: it is also an English word.
  'honge', 'hua', 'hui', 'huyi', 'huye', 'huwa', 'raha', 'rahi', 'rahe',
  'rahega', 'rahegi', 'rahenge', 'gaya', 'gayi', 'gaye', 'gai', 'chuka', 'chuki',
  'sakta', 'sakti', 'sakte', 'sakega', 'sakegi', 'chahiye', 'lagta', 'lagti',
  'lagega', 'padi', 'pada', 'padegi', 'padega', 'jayega', 'jaega', 'jayegi',
  'jaegi', 'karna', 'karo', 'kare', 'karein', 'karu', 'karoon', 'jana', 'jaana',
  'jaun', 'jaaun', 'nikal', 'nikalna', 'nikloon', 'niklu', 'khelna', 'dekho',
  'dekhna', 'suno', 'batao', 'bataiye', 'bataao', 'bolo', 'boliye', 'chalo',
  // postpositions and particles
  'mein', 'mai', 'mei', 'bhi', 'aur', 'lekin', 'toh', 'wala', 'wali', 'wale',
  'nahi', 'nahin', 'nhi', 'haan', 'haa', 'hanji', 'bilkul', 'matlab', 'arre',
  'arey', 'yaar', 'accha', 'acha', 'achha', 'achcha', 'thik', 'theek', 'sahi',
  'bahut', 'bohot', 'bahot', 'zyada', 'jyada', 'kuch', 'koi', 'sab', 'sabhi',
  // question words
  'kya', 'kyaa', 'kaisa', 'kaisi', 'kaise', 'kitna', 'kitni', 'kitne', 'kab',
  'kahan', 'kahaan', 'kyun', 'kyon', 'kyu', 'kaun', 'kon', 'kidhar',
  // pronouns and place deixis
  'mujhe', 'mera', 'meri', 'hamara', 'hamari', 'aap', 'aapka', 'aapki', 'tum',
  'tumhara', 'apna', 'apni', 'apne', 'yahan', 'yaha', 'wahan', 'vahan', 'idhar',
  'udhar', 'iska', 'uska',
  // time
  'abhi', 'aaj', 'kal', 'parso', 'parson', 'pichla', 'pichli', 'pichle',
  'pichhle', 'pichhli', 'agla', 'agli', 'agle', 'subah', 'shaam', 'sham', 'raat',
  'dopahar', 'hafta', 'hafte', 'mahina', 'mahine', 'din', 'dino', 'dinon',
  // the weather, in Hindi
  'mausam', 'baarish', 'barish', 'barsaat', 'barsat', 'garmi', 'sardi', 'thand',
  'thandi', 'thanda', 'garam', 'dhoop', 'dhup', 'hawa', 'aandhi', 'andhi',
  'toofan', 'tufan', 'badal', 'baadal', 'bijli', 'kohra', 'ole', 'oley', 'pani',
  'paani', 'chhata', 'chata', 'taapman', 'tapman', 'baarishein', 'boondabaandi',
  // social
  'shukriya', 'dhanyavad', 'dhanyawad', 'namaste', 'namaskar', 'bhai', 'bhaiya',
  'didi', 'ji',
]);

/**
 * English words that are not Hinglish.
 *
 * Function words and question words only. Content words that Hinglish
 * borrows — weather, rain, temperature, wind, forecast, warning, alert, last,
 * week — are left out, because they are evidence of nothing.
 */
const ENGLISH = new Set([
  'the', 'a', 'an', 'of', 'for', 'with', 'about', 'from', 'into', 'on', 'in',
  'at', 'and', 'or', 'but', 'if', 'then', 'than', 'what', 'whats', 'when',
  'where', 'which', 'who', 'why', 'how', 'hows', 'will', 'would', 'should',
  'could', 'can', 'cant', 'does', 'did', 'didnt', 'doesnt', 'dont', 'it', 'its',
  'there', 'theres', 'this', 'that', 'thats', 'these', 'those', 'you', 'your',
  'i', 'im', 'ive', 'my', 'we', 'our', 'they', 'their', 'he', 'she', 'was',
  'were', 'are', 'am', 'been', 'be', 'being', 'have', 'has', 'had', 'not', 'yes',
  'any', 'some', 'much', 'many', 'more', 'most', 'very', 'too', 'also', 'just',
  'really', 'right', 'now', 'today', 'tomorrow', 'yesterday', 'tonight', 'going',
  'get', 'got', 'go', 'please', 'tell', 'show', 'like', 'near', 'safe', 'wait',
  'thanks', 'thank', 'okay', 'hello', 'hey', 'wow', 'nice', 'cool', 'great',
  'good', 'yeah', 'yep', 'nope', 'sure', 'again', 'before', 'after', 'since',
  'ago', 'last', 'next',
]);

/**
 * English words that carry less weight: common in English, but also the
 * spelling of a Hindi word — "is" as in "is hafte", "the" as in थे.
 */
const ENGLISH_WEAK = new Set(['the', 'is', 'last', 'next', 'safe', 'near', 'like', 'okay']);

/** Language names, which are not places even when a state shares the root. */
const LANGUAGE_NAMES = new Set([
  'hindi', 'english', 'angrezi', 'angreji', 'tamil', 'punjabi', 'bengali', 'bangla',
  'gujarati', 'marathi', 'हिंदी', 'हिन्दी', 'अंग्रेज़ी', 'अंग्रेजी', 'तमिल', 'पंजाबी',
  'बंगाली', 'बांग्ला', 'गुजराती', 'मराठी',
]);

/**
 * True for a word that is part of how people talk rather than a name: a
 * function word in English or Hinglish, or a language's name.
 *
 * Exists for the gazetteer's sake. Its fuzzy matcher is one edit from a real
 * district for a surprising number of ordinary words — kitni is Katni, kahan
 * is Kalna, badal is Batala, "than" is an exact alias of Thane — so a message
 * containing any of these is never read as a bare place name.
 */
export function isLexiconWord(token: string): boolean {
  const word = token.toLowerCase().replace(/['’]/g, '');
  return (
    HINGLISH_STRONG.has(word) ||
    ENGLISH.has(word) ||
    LANGUAGE_NAMES.has(word) ||
    HINDI_DEVA.has(word) ||
    MARATHI.has(word)
  );
}

/** Devanagari words that are Marathi and not Hindi. */
const MARATHI = new Set([
  'आहे', 'आहेत', 'नाही', 'काय', 'मध्ये', 'उद्या', 'पाऊस', 'पडेल', 'पडणार',
  'पडला', 'पडली', 'आणि', 'होईल', 'होणार', 'कसे', 'कसा', 'कशी', 'कसं', 'इथे',
  'तिथे', 'येथे', 'किती', 'झाला', 'झाली', 'मला', 'तुम्ही', 'आम्ही', 'हवामान',
  'काल', 'परवा', 'सांगा', 'असेल', 'आहोत', 'होता', 'होती', 'पुण्यात', 'मुंबईत',
]);

/** Devanagari words that are Hindi and not Marathi. */
const HINDI_DEVA = new Set([
  'है', 'हैं', 'में', 'क्या', 'नहीं', 'होगी', 'होगा', 'होंगे', 'कैसा', 'कैसी',
  'कैसे', 'कल', 'परसों', 'था', 'थी', 'थे', 'हुई', 'हुआ', 'रहेगा', 'रहेगी',
  'बारिश', 'मौसम', 'और', 'भी', 'कितना', 'कितनी', 'कब', 'कहाँ', 'यहाँ', 'मुझे',
  'मेरे', 'आप', 'ठीक', 'अच्छा', 'बहुत', 'बताओ', 'बताइए', 'चाहिए', 'सकता', 'सकते',
]);

/* ------------------------------------------------------------------ */
/* Tokenising                                                          */
/* ------------------------------------------------------------------ */

/**
 * Whole words, lower-cased, apostrophes dropped so "what's" is "whats".
 *
 * \p{M} is part of a word: Devanagari vowel signs are combining marks, and a
 * tokenizer that splits on them shatters every Hindi word into consonants.
 */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{M}]+/u)
    .filter(Boolean);
}

type Evidence = { hinglish: number; english: number; tokens: number };

/** Weighs the Latin words of a turn. Strong markers count double. */
export function latinEvidence(text: string): Evidence {
  const tokens = words(text).filter((w) => /^[a-z]+$/.test(w));
  let hinglish = 0;
  let english = 0;
  for (const token of tokens) {
    if (HINGLISH_STRONG.has(token)) hinglish += 2;
    else if (ENGLISH.has(token)) english += ENGLISH_WEAK.has(token) ? 1 : 2;
  }
  return { hinglish, english, tokens: tokens.length };
}

function devanagariLanguage(text: string, spoken?: LanguageCode): { code: 'hi' | 'mr'; decisive: boolean } {
  const tokens = words(text);
  let marathi = 0;
  let hindi = 0;
  for (const token of tokens) {
    if (MARATHI.has(token)) marathi += 1;
    else if (HINDI_DEVA.has(token)) hindi += 1;
  }
  if (marathi > hindi) return { code: 'mr', decisive: true };
  if (hindi > marathi) return { code: 'hi', decisive: true };
  // A tie says nothing; the recogniser's language, when there was one, does.
  return { code: spoken === 'mr' ? 'mr' : 'hi', decisive: false };
}

const SCRIPT_LANGUAGE: Partial<Record<ScriptCode, LanguageCode>> = {
  Beng: 'bn',
  Gujr: 'gu',
  Taml: 'ta',
  Guru: 'pa',
};

/* ------------------------------------------------------------------ */
/* Reading one turn on its own                                         */
/* ------------------------------------------------------------------ */

/**
 * What the words of this turn say, with no context at all.
 *
 * Returns null when the turn has no letters — a bare numeral, an emoji —
 * which is different from "has letters but no evidence": the second still
 * has a script.
 */
export function readTurn(text: string, spoken?: LanguageCode): TurnLanguage | null {
  const script = detectScript(text);
  if (script === null) return null;

  if (script === 'Deva') {
    const { code, decisive } = devanagariLanguage(text, spoken);
    return {
      code,
      script,
      // The script alone makes it Hindi-or-Marathi with certainty; only the
      // choice between the two can be unsure.
      confidence: decisive || spoken === code ? 'high' : 'medium',
      basis: decisive ? 'lexicon' : 'script',
    };
  }

  const byScript = SCRIPT_LANGUAGE[script];
  if (byScript) return { code: byScript, script, confidence: 'high', basis: 'script' };

  // Latin: English or Hinglish, by function words.
  const { hinglish, english, tokens } = latinEvidence(text);

  if (hinglish === 0 && english === 0) {
    // "Lucknow", "ohh", "hmm": Latin letters and nothing else to go on.
    return { code: 'en', script: 'Latn', confidence: 'low', basis: 'default' };
  }

  if (hinglish > english) {
    return {
      code: 'hi',
      script: 'Latn',
      // One Hindi word in a long sentence is weaker than two in a short one.
      confidence: hinglish >= 4 ? 'high' : 'medium',
      basis: 'lexicon',
    };
  }

  if (english > hinglish) {
    return {
      code: 'en',
      script: 'Latn',
      confidence: english >= 4 && tokens >= 3 ? 'high' : english >= 2 ? 'medium' : 'low',
      basis: 'lexicon',
    };
  }

  // A genuine tie — "and kal?". Evidence both ways is no evidence.
  return { code: 'en', script: 'Latn', confidence: 'low', basis: 'default' };
}

/* ------------------------------------------------------------------ */
/* Reading a turn in its conversation                                  */
/* ------------------------------------------------------------------ */

export type ResolveOptions = {
  /** The assistant preference. Anything but `auto` decides outright. */
  assistant?: LanguagePreference;
  /** The conversation's language so far, when there is one. */
  previous?: TurnLanguage | null;
  /**
   * The language a recogniser DETECTED for this turn — spoken turns only.
   * Evidence about this turn: it breaks a Hindi / Marathi tie, and it beats a
   * guess on a transcript with no language in its words ("Lucknow").
   */
  heard?: LanguageCode;
  /**
   * The language the client is set to — a voice or interface setting, not
   * evidence about what was typed. Consulted only for a turn with no letters
   * and no conversation, and to break a Hindi / Marathi tie.
   */
  fallback?: LanguageCode;
};

/** A turn this short says little about its language on its own. */
const SHORT_TURN = 3;

/** The language a chosen preference writes in: its own script. */
function explicit(code: LanguageCode): TurnLanguage {
  return { code, script: language(code).script, confidence: 'high', basis: 'explicit' };
}

/** True when `turn` is evidence of a language other than `context`'s. */
function divergesFrom(turn: TurnLanguage, context: TurnLanguage): boolean {
  return turn.code !== context.code || turn.script !== context.script;
}

/**
 * The language this turn is answered in.
 *
 *   explicit assistant language → that, in its own script
 *   a non-Latin script          → that script's language (Hindi / Marathi by words)
 *   a long Latin turn with evidence → English or Hinglish, as the words say
 *   a short or evidence-free turn   → the conversation's language, when it has one
 *   otherwise                       → what the turn's script suggests, flagged low
 */
export function resolveTurnLanguage(text: string, options: ResolveOptions = {}): TurnLanguage {
  const { assistant = 'auto', previous = null, heard, fallback } = options;

  if (assistant !== 'auto' && isLanguageCode(assistant)) return explicit(assistant);

  const turn = readTurn(text, heard ?? fallback);

  // No letters at all: the conversation, then the recogniser, then the client.
  if (turn === null) {
    if (previous) return { ...previous, confidence: 'low', basis: 'context' };
    const code = heard ?? fallback ?? 'en';
    return { code, script: language(code).script, confidence: 'low', basis: heard ? 'spoken' : 'default' };
  }

  // A script other than Latin is decisive whatever the context says: someone
  // who types Devanagari after an English exchange has switched.
  if (turn.script !== 'Latn') return turn;

  if (!previous) {
    // First turn, Latin, no evidence ("Lucknow"): a recogniser that heard
    // Hindi is better evidence than a guess, and is the only thing that is.
    if (turn.confidence === 'low' && heard && heard !== 'en') {
      return { code: heard, script: 'Latn', confidence: 'low', basis: 'spoken' };
    }
    return turn;
  }

  const short = words(text).length <= SHORT_TURN;

  if (!divergesFrom(turn, previous)) {
    // Agreeing with the conversation only makes it surer.
    return turn.confidence === 'low' ? { ...previous, confidence: 'medium', basis: 'context' } : turn;
  }

  if (turn.confidence === 'low') return { ...previous, confidence: 'low', basis: 'context' };

  if (short) {
    /*
     * The asymmetry described at the top of the file. A short Hinglish turn
     * in an English conversation is a deliberate switch; a short English turn
     * in a Hindi conversation is code-mixing, and the conversation holds.
     */
    const intoHindi = turn.code === 'hi' && previous.code !== 'hi';
    if (!intoHindi) return { ...previous, confidence: 'medium', basis: 'context' };
  }

  return turn;
}

/* ------------------------------------------------------------------ */
/* Telling the model                                                   */
/* ------------------------------------------------------------------ */

export type AnswerStyle = {
  /** The language the reply should be written in. */
  code: LanguageCode;
  /** The script it must come back in. Enforced by the gate, not just asked for. */
  script: ScriptCode;
  /** Phrased for the model to follow rather than to infer. */
  instruction: string;
};

const INSTRUCTIONS: Record<string, string> = {
  en: 'Write your reply in English.',
  hinglish:
    'Write your reply in Hinglish — Hindi written in the Latin alphabet, the way ' +
    'the user writes it. Do not use Devanagari.',
  hi: 'Write your reply in Hindi, in Devanagari script.',
  mr: 'Write your reply in Marathi, in Devanagari script.',
  bn: 'Write your reply in Bengali, in the Bengali script.',
  gu: 'Write your reply in Gujarati, in the Gujarati script.',
  ta: 'Write your reply in Tamil, in the Tamil script.',
  pa: 'Write your reply in Punjabi, in the Gurmukhi script.',
};

/**
 * The instruction the model writes to, for a language already decided.
 *
 * Named outright rather than left to "mirror the user", which drifted: the
 * model answered a Bengali question in Hindi and an English one in Hinglish,
 * each time fluently. The gate checks the script afterwards regardless.
 */
export function styleFor(lang: Pick<TurnLanguage, 'code' | 'script'>): AnswerStyle {
  const key = isHinglish(lang) ? 'hinglish' : lang.code;
  return { code: lang.code, script: lang.script, instruction: INSTRUCTIONS[key] ?? INSTRUCTIONS.en };
}

/**
 * The style for a question read on its own — no conversation.
 *
 * `spoken` is the client's language, which only breaks a tie the text cannot
 * (no letters; Hindi or Marathi). Kept for callers that have a single
 * question and nothing else; the chat pipeline resolves with its context.
 */
export function answerStyle(
  question: string,
  spoken: LanguageCode,
  assistant: LanguagePreference = 'auto',
): AnswerStyle {
  return styleFor(resolveTurnLanguage(question, { assistant, fallback: spoken }));
}

/**
 * The template and taxonomy language for a question read on its own:
 * Devanagari reads Hindi, everything else English — see `chromeLanguage`.
 */
export function replyLanguage(
  question: string,
  spoken: LanguageCode,
  assistant: LanguagePreference = 'auto',
): InterfaceLang {
  return chromeLanguage(resolveTurnLanguage(question, { assistant, fallback: spoken }));
}

/* ------------------------------------------------------------------ */
/* What the rest of the pipeline needs from the answer                 */
/* ------------------------------------------------------------------ */

/**
 * Which hand-written template set a turn falls back to.
 *
 * Three, not two: Hinglish has its own, because a gate rejection that shipped
 * an English template in the middle of a Hinglish conversation was exactly the
 * "randomly became English" failure. Marathi borrows Hindi (same script, the
 * nearest language with templates); every other language lands on English,
 * because no template exists in it and machine-translating one is forbidden.
 */
export type TemplateLang = 'hi' | 'en' | 'hinglish';

export function templateLanguage(lang: Pick<TurnLanguage, 'code' | 'script'>): TemplateLang {
  if (lang.script === 'Deva') return 'hi';
  if (isHinglish(lang)) return 'hinglish';
  return 'en';
}

/**
 * The interface catalogue and warning taxonomy a turn is written in.
 *
 * Devanagari reads Hindi; everything else reads English — including Hinglish,
 * whose severity words stay in the English of the taxonomy rather than being
 * re-written, because the taxonomy is human-translated into two languages and
 * a softened severity is the one failure the gate cannot catch.
 */
export function chromeLanguage(lang: Pick<TurnLanguage, 'code' | 'script'>): InterfaceLang {
  return lang.script === 'Deva' ? 'hi' : 'en';
}

/** A BCP-47 tag for the `lang` attribute: Hinglish is hi-Latn. */
export function languageTag(lang: Pick<TurnLanguage, 'code' | 'script'>): string {
  if (isHinglish(lang)) return 'hi-Latn';
  return language(lang.code).bcp47;
}

/**
 * The voice that can read this answer aloud.
 *
 * The answer's language, not the voice preference: a voice cannot read a
 * script it was not built for, and choosing a Hindi voice for an English
 * answer read English words with Hindi phonetics. Hinglish is read by the
 * English voice for the same reason — its letters are Latin.
 */
export function speechLanguage(lang: Pick<TurnLanguage, 'code' | 'script'>): LanguageCode {
  return isHinglish(lang) ? 'en' : lang.code;
}

/**
 * The conversation's language so far, read from its history.
 *
 * The most recent user turn that said something decisive — a reaction does
 * not count, so "ok" after a Hinglish question still leaves the conversation
 * Hinglish. Used when a caller carries no stored language (a reopened
 * conversation, a Telegram chat from before this existed).
 */
export function conversationLanguage(
  history: { role: string; text: string }[],
): TurnLanguage | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message.role !== 'user') continue;
    const read = readTurn(message.text);
    if (read && read.confidence !== 'low') return { ...read, basis: 'context' };
  }
  return null;
}

/** Reads a stored language back, refusing anything malformed. */
export function readTurnLanguage(value: unknown): TurnLanguage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!isLanguageCode(raw.code)) return null;
  const script = raw.script;
  if (typeof script !== 'string' || !['Deva', 'Latn', 'Gujr', 'Beng', 'Taml', 'Guru'].includes(script)) {
    return null;
  }
  // Hindi may be either script; every other language only its own.
  const own = language(raw.code).script;
  if (script !== own && !(raw.code === 'hi' && script === 'Latn')) return null;
  return {
    code: raw.code,
    script: script as ScriptCode,
    confidence: raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low',
    basis: 'context',
  };
}
