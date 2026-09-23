/**
 * The turns that are not questions: hello, thanks, wow, ok, bye.
 *
 * WHY THIS IS FIRST. "ohh really" used to reach the place resolver — nothing
 * in it was a weather word, so the parser concluded the whole message must be
 * a place name, and the reply was "No place matched 'ohh really'". The fix is
 * not this list; the fix is that the conversation layer decides what a turn IS
 * before anything decides where it is about, and a turn with no evidence of a
 * place is never geocoded. This list is only the cheap way to recognise the
 * commonest of those turns without spending a model call on "thanks". A
 * phrasing it misses goes to the classifier, which can tell a reaction from a
 * village — it does not fall through to the geocoder.
 *
 * It also has to run before the gazetteer is consulted, and that is measured,
 * not assumed: the gazetteer's fuzzy matcher reads "thank" as Thane, "noted"
 * as Noida and "later" as Latur, each one edit away.
 *
 * The replies are hand-written in Hindi, English and Hinglish, like every
 * other string in this product, and never carry a weather value.
 */

import type { TemplateLang } from '../i18n/detect';

export type SocialKind =
  | 'greeting'
  | 'thanks'
  | 'farewell'
  | 'acknowledgement'
  | 'reaction'
  | 'smallTalk'
  /** "who are you", "what can you do" */
  | 'capabilities'
  /** "where does your data come from" */
  | 'sources';

/** Which of two kinds wins when a message holds both: "ok thanks" is thanks. */
const PRIORITY: SocialKind[] = [
  'sources',
  'capabilities',
  'smallTalk',
  'thanks',
  'farewell',
  'greeting',
  'reaction',
  'acknowledgement',
];

const PHRASES: Record<SocialKind, string[]> = {
  greeting: [
    'hi', 'hello', 'hey', 'hiya', 'yo', 'sup', 'wassup', 'whassup', 'whatsup',
    'whats up', 'wazzup', 'howdy', 'hola', 'hello there', 'hi there', 'hey there',
    'good morning', 'good afternoon', 'good evening', 'morning', 'gm', 'namaste',
    'namaskar', 'namaskaram', 'pranam', 'ram ram', 'salaam', 'salam', 'sat sri akal',
    'नमस्ते', 'नमस्कार', 'प्रणाम', 'राम राम', 'हेलो', 'हैलो', 'हाय', 'सुप्रभात',
    'शुभ प्रभात', 'வணக்கம்', 'নমস্কার', 'নমস্তে', 'નમસ્તે', 'નમસ્કાર', 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ', 'ਨਮਸਤੇ',
  ],
  thanks: [
    'thanks', 'thank you', 'thankyou', 'thank u', 'thanx', 'thnx', 'thx', 'ty',
    'tysm', 'thanks a lot', 'thank you so much', 'thanks so much', 'many thanks',
    'cheers', 'shukriya', 'shukria', 'dhanyavad', 'dhanyawad', 'bahut dhanyavad',
    'bahut shukriya', 'धन्यवाद', 'शुक्रिया', 'बहुत धन्यवाद', 'बहुत शुक्रिया',
    'थैंक्स', 'थैंक यू', 'நன்றி', 'ধন্যবাদ', 'આભાર', 'ਧੰਨਵਾਦ', 'ਸ਼ੁਕਰੀਆ',
  ],
  farewell: [
    'bye', 'goodbye', 'good bye', 'bye bye', 'see you', 'see ya', 'cya', 'later',
    'talk later', 'ttyl', 'good night', 'gn', 'tata', 'alvida', 'chalo bye',
    'phir milte hain', 'अलविदा', 'बाय', 'शुभ रात्रि', 'फिर मिलते हैं',
  ],
  acknowledgement: [
    'ok', 'okay', 'okey', 'k', 'okie', 'alright', 'all right', 'fine', 'got it',
    'gotcha', 'understood', 'noted', 'sure', 'cool', 'great', 'nice', 'good',
    'perfect', 'right', 'yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'nah',
    'sounds good', 'makes sense', 'i see', 'achha', 'acha', 'accha', 'thik hai',
    'theek hai', 'thik h', 'sahi hai', 'badhiya', 'haan', 'ha', 'haa', 'hmm', 'hm',
    'हाँ', 'हां', 'ठीक है', 'अच्छा', 'सही है', 'बढ़िया', 'ओके', 'समझ गया', 'समझ गई',
    'नहीं', 'ना',
  ],
  reaction: [
    'wow', 'whoa', 'woah', 'oh', 'ooh', 'oh really', 'really', 'seriously',
    'no way', 'wait', 'wait what', 'what', 'omg', 'oh my god', 'damn', 'crazy',
    'thats crazy', 'that is crazy', 'insane', 'amazing', 'interesting', 'lol',
    'haha', 'lmao', 'oh no', 'uh oh', 'yikes', 'oh wow', 'nice one', 'thats nice',
    'thats great', 'thats bad', 'not bad', 'arre', 'are wah', 'arre wah', 'wah',
    'kya baat hai', 'sach mein', 'sach me', 'sachi', 'kya sach', 'baap re',
    'hai bhagwan', 'सच में', 'अरे', 'वाह', 'अरे वाह', 'क्या बात है', 'ओह', 'बाप रे',
    'हे भगवान', 'अरे बाप रे',
  ],
  smallTalk: [
    'how are you', 'how r u', 'how are u', 'hows it going', 'how is it going',
    'how you doing', 'whats going on', 'kaise ho', 'kaisi ho', 'kaise hain',
    'aap kaise ho', 'aap kaise hain', 'kya haal hai', 'kya hal hai', 'kya haal',
    'कैसे हो', 'कैसी हो', 'आप कैसे हैं', 'क्या हाल है',
  ],
  capabilities: [
    'who are you', 'what are you', 'whats your name', 'what is your name',
    'are you a bot', 'are you human', 'what can you do', 'what do you do',
    'how do you work', 'help', 'how to use', 'how does this work', 'tum kaun ho',
    'aap kaun ho', 'kaun ho', 'tum kya kar sakte ho', 'aap kya kar sakte ho',
    'kya kar sakte ho', 'तुम कौन हो', 'आप कौन हैं', 'आप क्या कर सकते हैं', 'मदद',
  ],
  sources: [
    'where does your data come from', 'where is your data from', 'what is your source',
    'whats your source', 'what are your sources', 'data source', 'source',
    'data kahan se aata hai', 'data kaha se aata hai', 'source kya hai',
    'डेटा कहाँ से आता है', 'जानकारी कहाँ से आती है', 'स्रोत क्या है',
  ],
};

/**
 * The comparable form of a message: lower-cased, apostrophes gone, any
 * punctuation or emoji a space, and every run of a repeated letter squeezed
 * to one — "ohhhh", "hiii" and "okkk" are "oh", "hi" and "ok".
 *
 * Squeezing applies to the lexicon too, through the same function, so the
 * two sides can never disagree about a spelling.
 */
export function normaliseSocial(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{M}\s]+/gu, ' ')
    .replace(/(\p{L})\1+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const INDEX: Map<string, SocialKind> = (() => {
  const index = new Map<string, SocialKind>();
  // Lower priority first, so a phrase listed under two kinds keeps the
  // higher-priority one.
  for (const kind of [...PRIORITY].reverse()) {
    for (const phrase of PHRASES[kind]) index.set(normaliseSocial(phrase), kind);
  }
  return index;
})();

const LONGEST = Math.max(...[...INDEX.keys()].map((k) => k.split(' ').length));

/**
 * Social only when they are the whole message. "what?" is a reaction; "what
 * about wind?" is a question, and eating its first word as a lead-in would
 * leave "about wind?" behind.
 */
const STANDALONE_ONLY = new Set(['what', 'really', 'source', 'help'].map(normaliseSocial));

/**
 * Words that, leading a message, mean "I am correcting what I said" — not a
 * reaction to what Chaatak said. "no, Mumbai" and "actually Mumbai" are place
 * changes; "no" alone is an answer.
 */
export const CORRECTION_LEADS = new Set(
  [
    'no', 'nope', 'nah', 'actually', 'sorry', 'wait', 'oops', 'i meant', 'i mean',
    'meant', 'rather', 'instead', 'nahi', 'nahin', 'matlab', 'mera matlab',
    'mera matlab hai', 'मतलब', 'मेरा मतलब', 'नहीं', 'असल में', 'dar asal', 'darasal',
  ].map(normaliseSocial),
);

export type SocialReading = {
  /** The whole message was social: this is what kind. */
  kind: SocialKind | null;
  /**
   * The part of the message left after a social lead-in — "thanks, and
   * tomorrow?" leaves "and tomorrow?". Verbatim from the original, so a
   * place in it survives exactly as typed.
   */
  rest: string;
  /** The lead-in was a correction marker: "no, Mumbai", "actually Mumbai". */
  correcting: boolean;
};

/**
 * Reads a message as social talk, a social lead-in plus a question, or
 * neither.
 *
 * Greedy, longest phrase first, from the start of the message. Only whole
 * phrases count, and only at the start: "what" leading a message is a
 * reaction when it is the whole message and just a word otherwise.
 */
export function readSocial(text: string): SocialReading {
  const original = text.trim();
  const tokens = normaliseSocial(original).split(' ').filter(Boolean);
  if (tokens.length === 0) return { kind: null, rest: original, correcting: false };

  const kinds: SocialKind[] = [];
  let correcting = false;
  let i = 0;

  while (i < tokens.length) {
    let matched = 0;
    for (let length = Math.min(LONGEST, tokens.length - i); length >= 1; length--) {
      const phrase = tokens.slice(i, i + length).join(' ');
      const trailing = i + length < tokens.length;
      if (trailing && STANDALONE_ONLY.has(phrase)) continue;
      const kind = INDEX.get(phrase);
      const correction = CORRECTION_LEADS.has(phrase);
      if (kind || correction) {
        if (kind) kinds.push(kind);
        if (correction) correcting = true;
        matched = length;
        break;
      }
    }
    if (matched === 0) break;
    i += matched;
  }

  if (i === tokens.length) {
    // Entirely social. "no" alone answers a question; it corrects nothing.
    const kind = PRIORITY.find((k) => kinds.includes(k)) ?? 'acknowledgement';
    return { kind, rest: '', correcting: false };
  }

  if (i === 0) return { kind: null, rest: original, correcting: false };

  return { kind: null, rest: sliceAfterWords(original, i), correcting };
}

/**
 * The original text after its first `count` words, verbatim.
 *
 * Counted over the same word definition the tokenizer uses, so the slice
 * lands exactly where the social lead-in ended — with its punctuation gone
 * and nothing of the question lost.
 */
function sliceAfterWords(original: string, count: number): string {
  const word = /[\p{L}\p{M}'’]+/gu;
  let seen = 0;
  let match: RegExpExecArray | null;
  while ((match = word.exec(original)) !== null) {
    // An apostrophe alone is not a word; the tokenizer drops it too.
    if (!/[\p{L}\p{M}]/u.test(match[0])) continue;
    seen += 1;
    if (seen === count) {
      return original.slice(match.index + match[0].length).replace(/^[\s,.!?;:—–-]+/u, '').trim();
    }
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* Replies                                                             */
/* ------------------------------------------------------------------ */

type Lines = Record<TemplateLang, string[]>;

/**
 * What Chaatak says back. `{place}` is the conversation's place, and appears
 * only in the lines chosen when there is one.
 */
const REPLIES: Record<SocialKind, { fresh: Lines; inContext?: Lines }> = {
  greeting: {
    fresh: {
      en: [
        'Hey! Tell me a place and I will check its weather — or ask about warnings.',
        'Hello! Which place should I check the weather for?',
        'Hi there. Ask me about the weather anywhere in India.',
      ],
      hi: [
        'नमस्ते! किसी जगह का नाम बताइए, मैं वहाँ का मौसम बता दूँगा।',
        'नमस्ते! किस जगह का मौसम देखूँ?',
        'नमस्ते। भारत में कहीं का भी मौसम पूछिए।',
      ],
      hinglish: [
        'Namaste! Kisi jagah ka naam bataiye, main wahan ka mausam bata dunga.',
        'Hello! Kis jagah ka mausam dekhun?',
        'Namaste. India mein kahin ka bhi mausam poochiye.',
      ],
    },
    inContext: {
      en: ['Hey again! Want another look at {place}, or somewhere else?'],
      hi: ['फिर से नमस्ते! {place} का मौसम दोबारा देखूँ, या कोई और जगह?'],
      hinglish: ['Phir se namaste! {place} ka mausam dobara dekhun, ya koi aur jagah?'],
    },
  },
  thanks: {
    fresh: {
      en: ['You are welcome! Ask me anytime.', 'Happy to help. Stay safe out there.'],
      hi: ['आपका स्वागत है! कभी भी पूछिए।', 'खुशी हुई। अपना ध्यान रखिए।'],
      hinglish: ['Koi baat nahi! Kabhi bhi poochiye.', 'Khushi hui. Apna dhyan rakhiye.'],
    },
  },
  farewell: {
    fresh: {
      en: ['Take care! I am here whenever you need the weather.'],
      hi: ['अपना ध्यान रखिए! मौसम जानना हो तो फिर पूछिए।'],
      hinglish: ['Apna dhyan rakhiye! Mausam jaanna ho to phir poochiye.'],
    },
  },
  acknowledgement: {
    fresh: {
      en: ['Okay. Ask me whenever you need the weather.'],
      hi: ['ठीक है। जब भी मौसम जानना हो, पूछिए।'],
      hinglish: ['Theek hai. Jab bhi mausam jaanna ho, poochiye.'],
    },
    inContext: {
      en: [
        'Okay. Want tomorrow for {place}, or somewhere else?',
        'Got it. I can also check the wind or rain for {place}.',
      ],
      hi: [
        'ठीक है। {place} का कल का मौसम बताऊँ, या कोई और जगह?',
        'समझ गया। {place} की हवा या बारिश भी बता सकता हूँ।',
      ],
      hinglish: [
        'Theek hai. {place} ka kal ka mausam bataun, ya koi aur jagah?',
        'Samajh gaya. {place} ki hawa ya baarish bhi bata sakta hoon.',
      ],
    },
  },
  reaction: {
    fresh: {
      en: ['Ask me about the weather anywhere in India — I will tell you what the data says.'],
      hi: ['भारत में कहीं का भी मौसम पूछिए — आँकड़े जो कहते हैं, वही बताऊँगा।'],
      hinglish: ['India mein kahin ka bhi mausam poochiye — data jo kehta hai, wahi bataunga.'],
    },
    inContext: {
      en: [
        'Yes — that is what the latest data shows for {place}. Want tomorrow as well?',
        'That is straight from the latest data for {place}. Shall I check the wind or rain too?',
      ],
      hi: [
        'हाँ — {place} का ताज़ा आँकड़ा यही बता रहा है। कल का भी बताऊँ?',
        'यह {place} के ताज़ा आँकड़ों से ही है। हवा या बारिश भी देखूँ?',
      ],
      hinglish: [
        'Haan — {place} ka latest data yahi dikha raha hai. Kal ka bhi bataun?',
        'Yeh {place} ke latest data se hi hai. Hawa ya baarish bhi dekhun?',
      ],
    },
  },
  smallTalk: {
    fresh: {
      en: ['Doing well, thanks for asking! Which place should I check the weather for?'],
      hi: ['मैं ठीक हूँ, पूछने के लिए शुक्रिया! किस जगह का मौसम देखूँ?'],
      hinglish: ['Main theek hoon, poochne ke liye shukriya! Kis jagah ka mausam dekhun?'],
    },
  },
  capabilities: {
    fresh: {
      en: [
        'I am Chaatak. I tell you the weather anywhere in India — right now, the next few days, what already happened, and IMD warnings — in your language. Just ask, by voice or by typing.',
      ],
      hi: [
        'मैं चातक हूँ। भारत में कहीं का भी मौसम बताता हूँ — अभी का, आने वाले दिनों का, बीते दिनों का, और IMD की चेतावनियाँ — आपकी भाषा में। बोलकर या लिखकर पूछिए।',
      ],
      hinglish: [
        'Main Chaatak hoon. India mein kahin ka bhi mausam batata hoon — abhi ka, aane wale dinon ka, beete dinon ka, aur IMD ki chetavaniyan — aapki bhasha mein. Bolkar ya likhkar poochiye.',
      ],
    },
  },
  sources: {
    fresh: {
      en: [
        'Current conditions, forecasts and the recent past come from Open-Meteo, a weather model — not a rain gauge. Warnings come only from the India Meteorological Department. Every number shows its source and time.',
      ],
      hi: [
        'अभी का मौसम, पूर्वानुमान और बीते दिनों का हाल Open-Meteo नाम के मौसम मॉडल से आता है — यह वर्षामापी नहीं है। चेतावनियाँ सिर्फ़ भारत मौसम विज्ञान विभाग (IMD) से आती हैं। हर आँकड़े के साथ उसका स्रोत और समय रहता है।',
      ],
      hinglish: [
        'Abhi ka mausam, forecast aur beete dinon ka haal Open-Meteo naam ke weather model se aata hai — yeh rain gauge nahi hai. Chetavaniyan sirf India Meteorological Department (IMD) se aati hain. Har number ke saath uska source aur time rehta hai.',
      ],
    },
  },
};

/**
 * The reply to a social turn: stable for a given seed, different between
 * turns, and in the conversation's language.
 *
 * @param seed  anything that changes turn to turn — the history length
 * @param place the conversation's place, when it has one
 */
export function socialReply(kind: SocialKind, lang: TemplateLang, seed: number, place: string | null): string {
  const entry = REPLIES[kind];
  const pool = place && entry.inContext ? entry.inContext[lang] : entry.fresh[lang];
  const line = pool[Math.abs(seed) % pool.length];
  return place ? line.replace(/\{place\}/g, place) : line;
}

/* ------------------------------------------------------------------ */
/* The other templated turns                                           */
/* ------------------------------------------------------------------ */

/** A turn nothing could read, with no model available to try. Never a geocode. */
export const UNCLEAR: Record<TemplateLang, string> = {
  en: 'I did not quite catch that. Ask me about the weather — for example, "weather in Lucknow" or "will it rain tomorrow?"',
  hi: 'यह ठीक से समझ नहीं आया। मौसम के बारे में पूछिए — जैसे "लखनऊ का मौसम" या "कल बारिश होगी?"',
  hinglish: 'Yeh theek se samajh nahi aaya. Mausam ke baare mein poochiye — jaise "Lucknow ka mausam" ya "kal baarish hogi?"',
};

/**
 * The same, when the message might have been a place we could not confirm.
 * It tells the person how to say it so that it will work, rather than
 * guessing a district on their behalf.
 */
export function unclearPlace(lang: TemplateLang, text: string): string {
  const quoted = text.trim().slice(0, 60);
  switch (lang) {
    case 'hi':
      return `"${quoted}" समझ नहीं आया। अगर यह कोई जगह है, तो "${quoted} का मौसम" लिखकर पूछिए।`;
    case 'hinglish':
      return `"${quoted}" samajh nahi aaya. Agar yeh koi jagah hai, to "${quoted} ka mausam" likhkar poochiye.`;
    default:
      return `I could not tell what "${quoted}" means. If it is a place, ask "weather in ${quoted}".`;
  }
}
