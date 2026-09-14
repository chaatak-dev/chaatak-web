/**
 * WMO 4677 weather codes, as used by Open-Meteo.
 *
 * A fixed enumerated set, human-translated once and stored here as templates
 * keyed by code. Same rule as IMD's warning vocabulary: machine translation
 * can soften "heavy" into something milder, and a softened severity word in a
 * warning system is a safety failure, not a wording preference.
 *
 * An unmapped code renders as the bare code. We never guess at its meaning.
 */

export type ConditionTemplate = { hi: string; en: string };

const CONDITIONS: Record<number, ConditionTemplate> = {
  0: { hi: 'साफ़ आसमान', en: 'Clear sky' },
  1: { hi: 'मुख्यतः साफ़', en: 'Mainly clear' },
  2: { hi: 'आंशिक रूप से बादल', en: 'Partly cloudy' },
  3: { hi: 'घने बादल', en: 'Overcast' },
  45: { hi: 'कोहरा', en: 'Fog' },
  48: { hi: 'तुषार कोहरा', en: 'Depositing rime fog' },
  51: { hi: 'हल्की बूंदाबांदी', en: 'Light drizzle' },
  53: { hi: 'मध्यम बूंदाबांदी', en: 'Moderate drizzle' },
  55: { hi: 'घनी बूंदाबांदी', en: 'Dense drizzle' },
  56: { hi: 'हल्की जमा देने वाली बूंदाबांदी', en: 'Light freezing drizzle' },
  57: { hi: 'घनी जमा देने वाली बूंदाबांदी', en: 'Dense freezing drizzle' },
  61: { hi: 'हल्की बारिश', en: 'Slight rain' },
  63: { hi: 'मध्यम बारिश', en: 'Moderate rain' },
  65: { hi: 'भारी बारिश', en: 'Heavy rain' },
  66: { hi: 'हल्की जमा देने वाली बारिश', en: 'Light freezing rain' },
  67: { hi: 'भारी जमा देने वाली बारिश', en: 'Heavy freezing rain' },
  71: { hi: 'हल्की बर्फ़बारी', en: 'Slight snowfall' },
  73: { hi: 'मध्यम बर्फ़बारी', en: 'Moderate snowfall' },
  75: { hi: 'भारी बर्फ़बारी', en: 'Heavy snowfall' },
  77: { hi: 'बर्फ़ के कण', en: 'Snow grains' },
  80: { hi: 'हल्की बौछारें', en: 'Slight rain showers' },
  81: { hi: 'मध्यम बौछारें', en: 'Moderate rain showers' },
  82: { hi: 'तेज़ बौछारें', en: 'Violent rain showers' },
  85: { hi: 'हल्की बर्फ़ीली बौछारें', en: 'Slight snow showers' },
  86: { hi: 'भारी बर्फ़ीली बौछारें', en: 'Heavy snow showers' },
  95: { hi: 'गरज के साथ तूफ़ान', en: 'Thunderstorm' },
  96: { hi: 'हल्की ओलावृष्टि के साथ तूफ़ान', en: 'Thunderstorm with slight hail' },
  99: { hi: 'भारी ओलावृष्टि के साथ तूफ़ान', en: 'Thunderstorm with heavy hail' },
};

/**
 * Returns null for an unknown or absent code. Callers render the raw code
 * rather than inventing a description for it.
 */
export function conditionFor(code: number | null): ConditionTemplate | null {
  if (code === null) return null;
  return CONDITIONS[code] ?? null;
}
