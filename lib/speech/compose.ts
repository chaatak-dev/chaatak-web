/**
 * Turning a fetched answer into something to say.
 *
 * Pure: it reads the same response the screen renders and reorders it into
 * speech. It never computes a value, and every number it speaks came out of
 * the payload.
 *
 * The provenance sentence is not optional. Someone who cannot read the screen
 * must still hear where the number came from — that is the whole point of
 * provenance being a design element rather than fine print.
 *
 * The resolved place comes FIRST, deliberately. A listener cannot see the
 * header, and the transliteration trials showed how quietly a place lookup can
 * land somewhere else entirely; hearing which place answered is the only way
 * to catch it.
 */

import type { WeatherResponse } from '../weather/api';
import { conditionFor } from '../weather/wmo';
import { formatStamp } from '../format';
import type { SpeechLang, Utterance } from './types';

/**
 * Units read aloud. Enumerated and human-translated, exactly like the WMO
 * codes: "°C" spoken literally is not a word, and machine-translating a unit
 * is the same class of risk as machine-translating a severity.
 */
const SPOKEN_UNITS: Record<string, { hi: string; en: string }> = {
  '°C': { hi: 'डिग्री सेल्सियस', en: 'degrees Celsius' },
  '%': { hi: 'प्रतिशत', en: 'percent' },
  mm: { hi: 'मिलीमीटर', en: 'millimetres' },
  'km/h': { hi: 'किलोमीटर प्रति घंटा', en: 'kilometres per hour' },
};

/** An unmapped unit is spoken as its symbol rather than given a made-up word. */
function unitWord(unit: string, lang: SpeechLang): string {
  return SPOKEN_UNITS[unit]?.[lang] ?? unit;
}

const BASIS_SPOKEN: Record<string, { hi: string; en: string }> = {
  issued: { hi: 'जारी हुई', en: 'issued' },
  updated: { hi: 'अपडेट हुई', en: 'updated' },
  valid: { hi: 'मान्य', en: 'valid' },
};

export function composeAnswer(
  response: WeatherResponse,
  lang: SpeechLang,
): Utterance {
  const say = (text: string): { text: string; lang: SpeechLang } => ({ text, lang });

  if (response.kind === 'unresolved') {
    return [say(response.noData.statement[lang])];
  }

  const { place, current, outlook, warnings } = response;
  const timeZone = place.timezone;
  const parts: string[] = [];

  // 1. Which place actually answered.
  const where = [place.name, place.admin1].filter(Boolean).join(', ');
  parts.push(lang === 'hi' ? `${where} का मौसम।` : `Weather for ${where}.`);

  // 2. Warnings, verbatim from the adapter's own statement.
  if (Array.isArray(warnings)) {
    // Phase 4. Severity text comes from the template catalogue untouched.
    parts.push(lang === 'hi' ? 'चेतावनी जारी है।' : 'A warning is in force.');
  } else if (warnings.kind === 'noWarning') {
    parts.push(
      lang === 'hi' ? 'कोई चेतावनी जारी नहीं है।' : 'No warning is in force.',
    );
  } else {
    parts.push(warnings.statement[lang]);
  }

  // 3. Current conditions.
  if (current.kind === 'reading') {
    const condition = conditionFor(current.conditionCode);
    if (condition) parts.push(`${condition[lang]}।`);

    const temperature = current.measurements.find((m) => m.key === 'temperature');
    if (temperature) {
      const unit = unitWord(temperature.unit, lang);
      parts.push(
        lang === 'hi'
          ? `अभी तापमान ${temperature.value} ${unit} है।`
          : `The temperature is ${temperature.value} ${unit}.`,
      );
    }
  } else {
    parts.push(current.statement[lang]);
  }

  // 4. Today's range, when the source gave one.
  if (outlook.kind === 'forecast') {
    const today = outlook.days[0];
    if (today && today.maxTemp !== null && today.minTemp !== null) {
      const unit = unitWord(outlook.units.temperature, lang);
      parts.push(
        lang === 'hi'
          ? `आज ज़्यादा से ज़्यादा ${today.maxTemp} और कम से कम ${today.minTemp} ${unit}।`
          : `Today's high is ${today.maxTemp} and low ${today.minTemp} ${unit}.`,
      );
    }
  }

  // 5. Provenance, always.
  const provenance =
    current.kind === 'reading'
      ? current.provenance
      : outlook.kind === 'forecast'
        ? outlook.provenance
        : null;

  if (provenance) {
    const when = formatStamp(provenance.issuedAt, timeZone);
    const basis = BASIS_SPOKEN[provenance.timeBasis] ?? BASIS_SPOKEN.updated;
    parts.push(
      lang === 'hi'
        ? `यह जानकारी ${provenance.source} से है, ${when} पर ${basis.hi}।`
        : `This came from ${provenance.source}, ${basis.en} at ${when}.`,
    );
  }

  return [say(parts.join(' '))];
}
