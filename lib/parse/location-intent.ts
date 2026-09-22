/**
 * "Weather near me" is not a question about a place called Near.
 *
 * THE BUG THIS EXISTS FOR. The place extractor claims a word that sits
 * immediately before a locative particle — में, का, mein, **me**. English
 * "near me" puts "near" immediately before "me", the Hinglish particle, so
 * "near" was claimed as a place name, geocoded, and answered about. The same
 * collision hits "around me", and "here" survived masking on its own.
 *
 * It would be easy to special-case the string "near me" and move on. That
 * fixes one phrasing and leaves "around me", "yahan ka mausam", "mere area",
 * "where I am" and every other way of saying the same thing broken — and it
 * puts a weather question's MEANING in a find-and-replace.
 *
 * So the fix is at the intent layer. A question is about one of three things:
 *
 *   named    it names a place
 *   current  it asks about wherever the person is
 *   carried  it names nothing and inherits the conversation's place
 *
 * "current" is a first-class answer, not a failure to find a place. It is
 * what lets the app go straight to the browser's location instead of asking
 * "which place?" about a question that already said which place.
 */

/** Whole words only — the house rule for every lexical check in this codebase. */
function hasPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?<![\\p{L}\\p{M}])${escaped}(?![\\p{L}\\p{M}])`,
    'iu',
  ).test(text);
}

/**
 * Ways of saying "where I am", in the scripts and registers people use.
 *
 * Multi-word phrases are listed as phrases rather than assembled from parts,
 * because the parts are dangerous on their own: "me" is a Hinglish locative,
 * "area" is an ordinary noun, and "pass" means both "near" and the English
 * verb. Only the whole phrase is evidence.
 */
const CURRENT_LOCATION_PHRASES = [
  // English
  'near me',
  'near by',
  'nearby',
  'around me',
  'around here',
  'close to me',
  'close by',
  'here',
  'right here',
  'where i am',
  'where im',
  'my area',
  'my location',
  'my place',
  'my city',
  'my town',
  'my district',
  'current location',
  'this area',
  'this place',

  // Hinglish
  'mere paas',
  'mere pass',
  'mere aas paas',
  'aas paas',
  'aaspaas',
  'aas-paas',
  'mere area',
  'mere ilaake',
  'mere ilake',
  'meri jagah',
  'mera area',
  'yahan',
  'yaha',
  'yahaan',
  'idhar',
  'is jagah',
  'apne area',

  // Devanagari
  'यहाँ',
  'यहां',
  'यहीं',
  'इधर',
  'मेरे पास',
  'मेरे आसपास',
  'मेरे आस पास',
  'आसपास',
  'आस पास',
  'मेरे इलाके',
  'मेरे इलाक़े',
  'मेरी जगह',
  'मेरा इलाका',
  'इस जगह',
  'अपने इलाके',
];

/**
 * Does this question ask about where the person is?
 *
 * Evidence-based, like the place extractor it sits in front of: a phrase from
 * the list has to actually appear. Silence is not evidence either way — a
 * question with no place and no marker is `carried`, not `current`, because
 * "temperature" after asking about Delhi means Delhi.
 */
export function wantsCurrentLocation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return CURRENT_LOCATION_PHRASES.some((phrase) => hasPhrase(trimmed, phrase));
}

/**
 * The filler that a current-location question is made of.
 *
 * Masked before place extraction so none of it can survive as "the longest
 * remaining run" and be mistaken for a name. This is the second half of the
 * fix: the intent check above decides what the sentence MEANS, and this makes
 * sure the words it is made of cannot be read as a place even if it does not
 * fire.
 *
 * Every entry is a word that is never an Indian place name on its own.
 */
export const LOCATION_FILLER = [
  'near',
  'nearby',
  'where',
  'around',
  'here',
  'there',
  'my',
  'mine',
  'area',
  'location',
  'current',
  'close',
  'am',
  'i',
  'paas',
  'pass',
  'ilaake',
  'ilake',
  'idhar',
  'yahan',
  'yaha',
  'yahaan',
  'jagah',
  'apne',
  'mera',
  'meri',
  'यहाँ',
  'यहां',
  'यहीं',
  'इधर',
  'पास',
  'आसपास',
  'आस',
  'इलाके',
  'इलाक़े',
  'इलाका',
  'जगह',
  'मेरा',
  'मेरी',
  'अपने',
];
