/**
 * Turning what someone typed, and what the gazetteer stores, into the same
 * comparable string.
 *
 * Every lookup runs through here on both sides. If the two sides ever
 * normalise differently the index silently stops matching, so there is one
 * function and no variants.
 */

/**
 * Administrative suffixes, in every script Chaatak accepts.
 *
 * Wikidata stores "Nainital district", people type "Nainital", and Gujarati
 * stores "નૈનિતાલ જિલ્લો". Stripping the suffix on both sides means the index
 * does not care which form it was given.
 */
const SUFFIXES = [
  'district',
  'dist',
  'jila',
  'zila',
  // Administrative unit words that trail a real name. Someone typing
  // "Kasaragod" means the place recorded as "Kasaragod Municipality".
  'municipality',
  'municipalcorporation',
  'mandal',
  'taluk',
  'taluka',
  'tehsil',
  'जिला',
  'ज़िला',
  'जिल्हा',
  'জেলা',
  'மாவட்டம்',
  'જિલ્લો',
  'ਜ਼ਿਲ੍ਹਾ',
];

/**
 * Fold accents off Latin letters and nothing else.
 *
 * Scoped to an ASCII base on purpose. Indic combining marks are letters' worth
 * of meaning — a blanket strip of \p{M} turns बाराबंकी into बरबक and नैनीताल
 * into नननतल, which would make every Devanagari entry collide with every
 * other. This project has been bitten by that twice; it is a standing rule.
 */
function foldLatinDiacritics(text: string): string {
  return text.normalize('NFD').replace(/([A-Za-z])\p{M}+/gu, '$1');
}

/** Scripts are compared only against themselves, so each one gets a tag. */
export type ScriptTag = 'latn' | 'deva' | 'beng' | 'guru' | 'gujr' | 'taml' | 'other';

const SCRIPT_RANGES: [ScriptTag, RegExp][] = [
  ['deva', /[ऀ-ॿ]/],
  ['beng', /[ঀ-৿]/],
  ['guru', /[਀-੿]/],
  ['gujr', /[઀-૿]/],
  ['taml', /[஀-௿]/],
  ['latn', /[A-Za-z]/],
];

/** Which script a name is written in. Indic wins over Latin in mixed text. */
export function scriptOf(text: string): ScriptTag {
  for (const [tag, pattern] of SCRIPT_RANGES) {
    if (pattern.test(text)) return tag;
  }
  return 'other';
}

/**
 * The comparable form: accents folded, case dropped, administrative suffix
 * removed, punctuation and spacing gone.
 *
 * Spacing is removed rather than collapsed because "Bara Banki" and
 * "Barabanki" are the same place and only one of them is what someone will
 * type. Indic characters pass through untouched.
 */
export function normalise(text: string): string {
  let out = foldLatinDiacritics(text).toLowerCase().trim();

  // Repeat: "X district jila" exists in the wild as a doubled translation.
  for (let pass = 0; pass < 2; pass++) {
    for (const suffix of SUFFIXES) {
      if (out.length > suffix.length && out.endsWith(suffix)) {
        out = out.slice(0, -suffix.length).trim();
      }
    }
  }

  // Keep letters, marks and digits from any script; drop everything else.
  return out.replace(/[^\p{L}\p{M}\p{N}]/gu, '');
}
