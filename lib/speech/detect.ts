/**
 * Which language someone spoke in — read from what the recognisers heard.
 *
 * WHY THIS WAY. Bhashini's public pipeline has no audio language
 * identification (asked for it, `audio-lang-detection` is "not a valid task"),
 * and each language has its own recogniser: Whisper for English, a Hindi
 * conformer, a multilingual Indo-Aryan conformer for the rest. So "auto" is
 * answered by listening with more than one of them and judging what each
 * heard. That is real detection, from evidence in the audio's transcripts,
 * and it says how sure it is.
 *
 * THE EVIDENCE IS ASYMMETRIC, and that is what makes it work. An Indic
 * recogniser given English speech does not produce Hindi — it spells the
 * English out in its own script: "व्हाट इज द वेदर इन लखनऊ". Given Hindi, it
 * produces Hindi, full of है, में, क्या. So the Indic transcript alone tells
 * the two apart: native function words mean the language was spoken;
 * English words in Devanagari mean it was not. The English recogniser is far
 * less informative — Whisper given Hindi often answers with a fluent English
 * TRANSLATION — so its transcript is used for what it says, not as a judge.
 *
 * A bare place name ("लखनऊ" / "Lucknow") carries no evidence either way, and
 * is answered from the conversation's language, flagged as low confidence.
 */

import type { LanguageCode } from '../i18n/languages';
import { latinEvidence, words } from '../i18n/detect';

/** Function words and common weather words, as each recogniser writes them. */
const NATIVE: Partial<Record<LanguageCode, ReadonlySet<string>>> = {
  hi: new Set([
    'है', 'हैं', 'में', 'का', 'की', 'के', 'को', 'क्या', 'कैसा', 'कैसी', 'कैसे', 'नहीं', 'हाँ',
    'हां', 'होगी', 'होगा', 'होंगे', 'था', 'थी', 'थे', 'हुई', 'हुआ', 'कल', 'आज', 'अभी', 'बारिश',
    'मौसम', 'तापमान', 'गर्मी', 'ठंड', 'हवा', 'और', 'भी', 'तो', 'कब', 'कहाँ', 'कितना', 'कितनी',
    'मुझे', 'मेरे', 'यहाँ', 'बताओ', 'बताइए', 'चेतावनी', 'रहेगा', 'रहेगी', 'पड़ेगी', 'से', 'पर',
  ]),
  mr: new Set([
    'आहे', 'आहेत', 'नाही', 'काय', 'मध्ये', 'उद्या', 'पाऊस', 'पडेल', 'आणि', 'होईल', 'कसे',
    'कसा', 'आज', 'हवामान', 'तापमान', 'किती', 'काल', 'इथे', 'सांगा', 'का',
  ]),
  bn: new Set([
    'কি', 'কী', 'আজ', 'কাল', 'বৃষ্টি', 'হবে', 'হয়েছে', 'আবহাওয়া', 'কেমন', 'আছে', 'না', 'এখন',
    'তাপমাত্রা', 'হচ্ছে', 'কোথায়', 'এবং', 'আর', 'এ', 'তে',
  ]),
  gu: new Set([
    'શું', 'આજે', 'કાલે', 'વરસાદ', 'પડશે', 'હવામાન', 'કેવું', 'છે', 'નથી', 'હવે', 'તાપમાન', 'અને',
    'માં', 'થશે',
  ]),
  ta: new Set([
    'இன்று', 'நாளை', 'மழை', 'வானிலை', 'எப்படி', 'உள்ளது', 'இல்லை', 'இப்போது', 'வெப்பநிலை',
    'பெய்யுமா', 'என்ன', 'மற்றும்', 'இருக்கும்', 'நேற்று',
  ]),
  pa: new Set([
    'ਕੀ', 'ਅੱਜ', 'ਕੱਲ੍ਹ', 'ਮੀਂਹ', 'ਮੌਸਮ', 'ਕਿਵੇਂ', 'ਹੈ', 'ਨਹੀਂ', 'ਹੁਣ', 'ਤਾਪਮਾਨ', 'ਪਵੇਗਾ', 'ਅਤੇ',
    'ਵਿੱਚ', 'ਦਾ', 'ਦੀ',
  ]),
};

/**
 * English, as a Devanagari recogniser spells it. Only words that are not
 * also Hindi: इन ("these") and दो ("two") are left out on purpose.
 */
const ENGLISH_IN_DEVANAGARI = new Set([
  'व्हाट', 'वॉट', 'इज़', 'इज', 'द', 'दि', 'वेदर', 'वेदर्स', 'टुमॉरो', 'टुमारो', 'विल', 'इट', 'इट्स',
  'रेन', 'रेनिंग', 'हाउ', 'हाऊ', 'टेम्परेचर', 'टेंपरेचर', 'व्हेयर', 'वेयर', 'वेन', 'व्हेन', 'गोइंग',
  'टू', 'बी', 'यू', 'कैन', 'प्लीज़', 'प्लीज', 'टेल', 'मी', 'अबाउट', 'टुडे', 'येस्टरडे', 'ऑफ', 'फॉर',
  'एंड', 'ओके', 'थैंक', 'थैंक्स', 'हेलो', 'हाय', 'विंड', 'ह्यूमिडिटी', 'फोरकास्ट', 'अलर्ट', 'वार्निंग',
  'लास्ट', 'नेक्स्ट', 'वीक', 'डिड', 'वॉज़', 'वाज़', 'देयर', 'दिस', 'दैट', 'लाइक', 'आउटसाइड', 'नाउ',
  'राइट', 'शुड', 'आई', 'माय',
]);

export type Heard = { lang: LanguageCode; transcript: string };

export type Detection = {
  lang: LanguageCode;
  transcript: string;
  confidence: 'high' | 'medium' | 'low';
  /** Why, in a phrase — logged, and asserted in tests. */
  reason: string;
};

export type Evidence = { native: number; transliteratedEnglish: number; tokens: number };

/** What an Indic transcript says about whether its language was spoken. */
export function indicEvidence(heard: Heard): Evidence {
  const tokens = words(heard.transcript);
  const native = NATIVE[heard.lang];
  let n = 0;
  let t = 0;
  for (const token of tokens) {
    if (native?.has(token)) n += 1;
    else if (ENGLISH_IN_DEVANAGARI.has(token)) t += 1;
  }
  return { native: n, transliteratedEnglish: t, tokens: tokens.length };
}

/**
 * True when an Indic transcript reads as its own language — the check that
 * lets a confident conversation skip the second recogniser.
 */
export function readsAsNative(heard: Heard): boolean {
  const e = indicEvidence(heard);
  return e.native >= 1 && e.native >= e.transliteratedEnglish;
}

/**
 * The language that was spoken, from what each recogniser heard.
 *
 * @param prior the conversation's language, used only when the transcripts
 *   carry no evidence either way
 */
export function chooseTranscript(heard: Heard[], prior?: LanguageCode | null): Detection | null {
  const usable = heard.filter((h) => h.transcript.trim().length > 0);
  if (usable.length === 0) return null;
  if (usable.length === 1) {
    return { ...usable[0], confidence: 'medium', reason: 'only one recogniser heard anything' };
  }

  const english = usable.find((h) => h.lang === 'en') ?? null;
  const indic = usable.filter((h) => h.lang !== 'en');

  // Among the Indic recognisers, the one whose transcript is most its own
  // language. Each is judged against its own lexicon.
  let best: { heard: Heard; evidence: Evidence } | null = null;
  for (const h of indic) {
    const evidence = indicEvidence(h);
    if (
      !best ||
      evidence.native - evidence.transliteratedEnglish >
        best.evidence.native - best.evidence.transliteratedEnglish
    ) {
      best = { heard: h, evidence };
    }
  }

  if (best) {
    const { native, transliteratedEnglish } = best.evidence;

    if (native >= 1 && native >= transliteratedEnglish) {
      return {
        ...best.heard,
        confidence: native >= 2 ? 'high' : 'medium',
        reason: `${native} ${best.heard.lang} word(s) in the ${best.heard.lang} transcript`,
      };
    }

    if (english && transliteratedEnglish > native) {
      return {
        ...english,
        confidence: transliteratedEnglish >= 2 ? 'high' : 'medium',
        reason: `the ${best.heard.lang} recogniser spelled out English (${transliteratedEnglish} word(s))`,
      };
    }
  }

  // No evidence in the Indic transcripts. English with English grammar in
  // it is still evidence of English; romanised Hindi from Whisper is evidence
  // of Hindi, which the Hindi recogniser then writes properly.
  if (english) {
    const e = latinEvidence(english.transcript);
    if (e.english >= 2 && e.english > e.hinglish) {
      return { ...english, confidence: 'medium', reason: 'English function words, no native words' };
    }
    if (e.hinglish >= 2 && e.hinglish > e.english) {
      const hindi = indic.find((h) => h.lang === 'hi');
      if (hindi) return { ...hindi, confidence: 'medium', reason: 'Whisper heard romanised Hindi' };
    }
  }

  // A place name, a single word: nothing to judge. The conversation decides.
  const byPrior = prior ? usable.find((h) => h.lang === prior) : undefined;
  if (byPrior) return { ...byPrior, confidence: 'low', reason: 'no evidence; kept the conversation language' };
  const fallback = indic[0] ?? usable[0];
  return { ...fallback, confidence: 'low', reason: 'no evidence either way' };
}

/**
 * Which recognisers to ask, for an automatic language.
 *
 * One Indic candidate — the conversation's language, else the device's, else
 * Hindi — plus Hindi if that was not it, plus English. Never more than three:
 * each is a round trip, run in parallel, and three is enough to tell apart the
 * languages someone on one device plausibly switches between.
 */
export function candidatesFor(prior: LanguageCode | null | undefined, device: LanguageCode | null | undefined): LanguageCode[] {
  const indic = [prior, device].find((l): l is LanguageCode => Boolean(l) && l !== 'en') ?? 'hi';
  const list: LanguageCode[] = [indic];
  if (indic !== 'hi') list.push('hi');
  list.push('en');
  return list;
}
