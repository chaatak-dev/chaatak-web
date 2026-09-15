/**
 * Numeral handling for the verification gate.
 *
 * Two things the naive version of this gate gets wrong, both of which fail
 * OPEN — they let a fabricated value through rather than blocking a good one:
 *
 *   1. A Latin-only \d never matches २५, so a fabricated Devanagari number is
 *      not extracted at all and is never checked. Digits are normalised to
 *      Latin before anything looks at them.
 *   2. "पच्चीस डिग्री" contains no numeral whatsoever and passes a numeral
 *      check trivially. Number-words next to a unit are therefore themselves
 *      a rejection.
 */

/** Devanagari digits ० through ९, U+0966–U+096F. */
const DEVANAGARI_ZERO = 0x0966;

export function normaliseDigits(text: string): string {
  return text.replace(/[०-९]/g, (d) =>
    String(d.codePointAt(0)! - DEVANAGARI_ZERO),
  );
}

/**
 * Every number in the text, after digit normalisation.
 *
 * A leading hyphen is a minus sign only when a digit does not precede it, so
 * "2026-09-17" reads as 2026, 9, 17 rather than 2026, -9, -17, while "-2.5" at
 * the start of a clause still reads as negative.
 *
 * Getting this wrong fails in the over-rejecting direction, which is how it
 * was found: an earlier version excluded hyphens from the lookbehind entirely
 * and so extracted ONLY 2026 from a date. The day and month never entered the
 * verified set, and a reply that correctly said "17 सितंबर" was rejected as an
 * invented number. A gate that refuses true statements is one that gets
 * switched off.
 */
export function extractNumbers(text: string): number[] {
  const normalised = normaliseDigits(text);
  const found: number[] = [];
  for (const m of normalised.matchAll(/(?<!\d)(-?\d+(?:\.\d+)?)/g)) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) found.push(n);
  }
  return found;
}

/**
 * Hindi number words, 0–100 plus the multipliers and fractions that actually
 * turn up in speech. Spelling variants are listed separately rather than
 * normalised, because both spellings are written in the wild.
 */
const HINDI_NUMBER_WORDS = [
  'शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'पांच', 'छह', 'छः', 'छे', 'सात',
  'आठ', 'नौ', 'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'पन्द्रह',
  'सोलह', 'सत्रह', 'अठारह', 'उन्नीस', 'बीस', 'इक्कीस', 'बाईस', 'तेईस',
  'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस', 'तीस',
  'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस',
  'अड़तीस', 'उनतालीस', 'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चवालीस',
  'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास', 'पचास', 'इक्यावन',
  'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ',
  'साठ', 'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ',
  'अड़सठ', 'उनहत्तर', 'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर',
  'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उनासी', 'अस्सी', 'इक्यासी',
  'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी',
  'नवासी', 'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पंचानवे',
  'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे', 'सौ', 'हज़ार', 'हजार',
  'लाख', 'दशमलव', 'आधा', 'आधे', 'सवा', 'डेढ़', 'ढाई', 'पौने',
];

const ENGLISH_NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty',
  'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred',
  'thousand', 'point', 'half', 'quarter',
];

export const NUMBER_WORDS = new Set([
  ...HINDI_NUMBER_WORDS,
  ...ENGLISH_NUMBER_WORDS,
]);

/**
 * Words that mark a measurement: units, and the variables they measure.
 *
 * A number-word is only a rejection when it sits near one of these. "एक जगह"
 * (a place) must pass — एक is Hindi's indefinite article and rejecting every
 * reply containing it would make the gate useless. "पच्चीस डिग्री" must not.
 * Targeting the unit is what separates the two.
 */
export const MEASUREMENT_WORDS = new Set([
  // units
  'डिग्री', 'सेल्सियस', 'प्रतिशत', 'मिलीमीटर', 'किलोमीटर', 'घंटा', 'घंटे',
  'degree', 'degrees', 'celsius', 'percent', 'millimetre', 'millimetres',
  'millimeter', 'millimeters', 'kilometre', 'kilometres', 'kilometer',
  'kilometers', 'hour', 'kmph', 'mm', 'km',
  // the variables
  'तापमान', 'आर्द्रता', 'वर्षा', 'बारिश', 'हवा', 'गति', 'नमी',
  'temperature', 'humidity', 'precipitation', 'rainfall', 'rain', 'wind',
  'speed', 'max', 'min', 'maximum', 'minimum',
]);

/** How many tokens either side of a measurement word to scan. */
const WINDOW = 4;

/**
 * \p{M} is load-bearing. Devanagari vowel signs and the virama are combining
 * marks, not letters, so a class of only \p{L}\p{N} treats them as separators
 * and shatters पच्चीस into प, च, च, स — after which no number-word ever
 * matches and the whole spelled-out check silently passes everything.
 */
function tokenise(text: string): string[] {
  return normaliseDigits(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}\p{M}.]+/u)
    .filter(Boolean);
}

/**
 * Finds a value written out in words next to a unit — the hole a pure numeral
 * check leaves wide open. Returns the offending phrase, or null.
 */
export function findSpelledOutValue(text: string): string | null {
  const tokens = tokenise(text);

  for (let i = 0; i < tokens.length; i++) {
    if (!MEASUREMENT_WORDS.has(tokens[i])) continue;

    const from = Math.max(0, i - WINDOW);
    const to = Math.min(tokens.length, i + WINDOW + 1);
    for (let j = from; j < to; j++) {
      if (j !== i && NUMBER_WORDS.has(tokens[j])) {
        return tokens.slice(from, to).join(' ');
      }
    }
  }
  return null;
}
