/**
 * The alert catalogue.
 *
 * Everything a subscriber receives is rendered from here. No machine
 * translation, no model, anywhere in the alert pipeline — MT can soften
 * "extremely heavy rain" into something milder, and a model can do worse, and
 * neither failure is visible in the output. Severity is not negotiable enough
 * for either.
 *
 * Phase 4-real replaces the codes below with IMD's own 17 district warning
 * codes and 19 nowcast categories, keeping the same shape.
 */

import type { AlertPayload } from './types';
import type { Severity } from '../weather/types';

export type Bilingual = { hi: string; en: string };

/** IMD's colour scale, written out. Colour never works alone. */
const SEVERITY_WORDS: Record<Severity, Bilingual> = {
  none: { hi: 'हरी', en: 'Green' },
  watch: { hi: 'पीली चेतावनी', en: 'Yellow warning' },
  alert: { hi: 'नारंगी चेतावनी', en: 'Orange warning' },
  warning: { hi: 'लाल चेतावनी', en: 'Red warning' },
};

const SEVERITY_ACTION: Record<Severity, Bilingual> = {
  none: { hi: 'कोई चेतावनी नहीं', en: 'No warning' },
  watch: { hi: 'सतर्क रहें', en: 'Be aware' },
  alert: { hi: 'तैयार रहें', en: 'Be prepared' },
  warning: { hi: 'तुरंत कार्रवाई करें', en: 'Take action now' },
};

/** Hazard codes. Human-translated once, keyed by code. */
const HAZARDS: Record<string, Bilingual> = {
  'HR-2': { hi: 'भारी बारिश', en: 'Heavy rain' },
  'HR-3': { hi: 'बहुत भारी बारिश', en: 'Very heavy rain' },
  'HR-4': { hi: 'अत्यंत भारी बारिश', en: 'Extremely heavy rain' },
  'TS-1': { hi: 'गरज के साथ तूफ़ान', en: 'Thunderstorm' },
  'TS-2': { hi: 'ओलावृष्टि के साथ तूफ़ान', en: 'Thunderstorm with hail' },
  'HW-1': { hi: 'लू', en: 'Heatwave' },
  'CY-1': { hi: 'चक्रवात', en: 'Cyclone' },
  'FL-1': { hi: 'बाढ़', en: 'Flood' },
};

/** An unmapped code prints as the code. We do not invent a description. */
function hazard(code: string, lang: 'hi' | 'en'): string {
  return HAZARDS[code]?.[lang] ?? code;
}

function timeIn(iso: string, lang: 'hi' | 'en'): string {
  try {
    return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export type RenderedAlert = { title: string; body: string };

/**
 * Provenance travels with the alert. Someone woken by a push at 3am should be
 * able to see which bulletin it came from without opening the app.
 */
export function renderAlert(
  payload: AlertPayload,
  lang: 'hi' | 'en',
): RenderedAlert {
  const stamp = timeIn(payload.provenance.issuedAt, lang);
  const source = `${payload.provenance.source} · ${stamp} IST`;

  if (payload.kind === 'allClear') {
    const lifted = SEVERITY_WORDS[payload.severity][lang];
    return {
      title: lang === 'hi' ? 'चेतावनी हटा ली गई' : 'Warning lifted',
      body:
        lang === 'hi'
          ? `${payload.district} की ${lifted} अब लागू नहीं है। ${source}`
          : `The ${lifted.toLowerCase()} for ${payload.district} is no longer in force. ${source}`,
    };
  }

  const words = SEVERITY_WORDS[payload.severity][lang];
  const action = SEVERITY_ACTION[payload.severity][lang];
  const what = hazard(payload.code, lang);
  const until = timeIn(payload.validTo, lang);

  return {
    // Severity leads the title, so it survives a notification shade that
    // truncates everything after the first few words.
    title: lang === 'hi' ? `${words} — ${what}` : `${words} — ${what}`,
    body:
      lang === 'hi'
        ? `${payload.district}: ${what}, ${until} बजे तक। ${action}। ${source}`
        : `${payload.district}: ${what} until ${until}. ${action}. ${source}`,
  };
}
