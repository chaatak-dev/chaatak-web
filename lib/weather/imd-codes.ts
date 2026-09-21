/**
 * IMD's warning vocabulary: the numbers it sends, and what they mean.
 *
 * SOURCE. The English below is copied verbatim from IMD's own API reference
 * at https://api.imd.gov.in/public/api_reference.html, which documents the
 * `districtwarning` response. Nothing here was inferred from the data,
 * guessed from context, or machine-translated. There is no legend endpoint on
 * the API itself -- every candidate path returns "API not found" -- so the
 * published reference is the authority.
 *
 * That reference also documents the colour scale, and it confirms what the
 * adapter had previously established from the distribution of 3,590 day-slots:
 *
 *     1  #FF0000  Red       2  #ffa500  Orange
 *     3  #ffff00  Yellow    4  #7cfc00  Green
 *
 * It runs downwards, 1 being the most severe. The severity mapping lives in
 * imd.ts and is unchanged; it is restated here only so the two can be read
 * against each other.
 *
 * HINDI. The English is IMD's. The Hindi is the standard Indian
 * meteorological vocabulary -- लू, शीत लहर, अति भारी वर्षा are the terms IMD
 * uses in its own Hindi bulletins -- but it has not been checked by a native
 * speaker against a published Hindi bulletin, and it should be before the
 * demo. A softened severity word is the one failure the verification gate
 * cannot catch, which is why this file exists rather than a translation call.
 */

export type Bilingual = { hi: string; en: string };

/** Code 1 is IMD stating that nothing is in force. It is not a hazard. */
export const NO_WARNING_CODE = '1';

/**
 * The seventeen district warning codes.
 *
 * A fixed, enumerated set. If IMD ever adds an eighteenth it will arrive here
 * as an unrecognised code and be reported as one, never rendered as a guess.
 */
export const IMD_WARNING_CODES: Record<string, Bilingual> = {
  '1': { en: 'No Warning', hi: 'कोई चेतावनी नहीं' },
  '2': { en: 'Heavy Rain', hi: 'भारी वर्षा' },
  '3': { en: 'Heavy Snow', hi: 'भारी हिमपात' },
  '4': { en: 'Thunderstorm & Lightning, Squall etc', hi: 'गरज-चमक, बिजली और अंधड़' },
  '5': { en: 'Hailstorm', hi: 'ओलावृष्टि' },
  '6': { en: 'Dust Storm', hi: 'धूल भरी आँधी' },
  '7': { en: 'Dust Raising Winds', hi: 'धूल उड़ाने वाली हवाएँ' },
  '8': { en: 'Strong Surface Winds', hi: 'तेज़ सतही हवाएँ' },
  '9': { en: 'Heat Wave', hi: 'लू' },
  '10': { en: 'Hot Day', hi: 'गर्म दिन' },
  '11': { en: 'Warm Night', hi: 'गर्म रात' },
  '12': { en: 'Cold Wave', hi: 'शीत लहर' },
  '13': { en: 'Cold Day', hi: 'ठंडा दिन' },
  '14': { en: 'Ground Frost', hi: 'पाला' },
  '15': { en: 'Fog', hi: 'कोहरा' },
  '16': { en: 'Very Heavy Rain', hi: 'अति भारी वर्षा' },
  '17': { en: 'Extremely Heavy Rain', hi: 'अत्यधिक भारी वर्षा' },
};

/**
 * IMD's documented colour numbering, for reference and for tests.
 *
 * The adapter's severity mapping is derived from the same table; this is here
 * so a reader can check one against the other without leaving the file.
 */
export const IMD_COLOUR_NAMES: Record<string, string> = {
  '1': 'Red',
  '2': 'Orange',
  '3': 'Yellow',
  '4': 'Green',
};

export type HazardReading = {
  /** Labels for the codes we recognise, in order. */
  hazards: string[];
  /**
   * Codes not in IMD's published set.
   *
   * Reported rather than dropped and rather than guessed: an unrecognised
   * code means IMD is saying something this build does not understand, and
   * silently losing it would hide a hazard.
   */
  unrecognised: string[];
};

/**
 * Split IMD's comma-separated code list into readable hazards.
 *
 * `Day_N` arrives as "2,4,8". Code 1 is dropped because it means "no
 * warning", and a day that is only code 1 carries no hazard at all.
 */
export function readHazards(code: unknown, lang: 'hi' | 'en'): HazardReading {
  if (typeof code !== 'string' && typeof code !== 'number') {
    return { hazards: [], unrecognised: [] };
  }

  const hazards: string[] = [];
  const unrecognised: string[] = [];

  for (const raw of String(code).split(',')) {
    const key = raw.trim();
    if (!key || key === NO_WARNING_CODE) continue;
    const label = IMD_WARNING_CODES[key];
    if (label) hazards.push(label[lang]);
    else unrecognised.push(key);
  }

  return { hazards, unrecognised };
}

/**
 * One readable phrase for a code list.
 *
 * Joined with a middle dot rather than a comma, because two of IMD's own
 * labels contain commas — "Thunderstorm & Lightning, Squall etc" — and a
 * comma-joined list of them cannot be read back apart.
 */
export function hazardText(code: unknown, lang: 'hi' | 'en'): string {
  const { hazards, unrecognised } = readHazards(code, lang);
  const parts = [...hazards];
  // An unknown code is shown as the code. Better an unfamiliar number than a
  // description nobody issued.
  for (const u of unrecognised) parts.push(lang === 'hi' ? `कोड ${u}` : `code ${u}`);
  return parts.join(' · ');
}
