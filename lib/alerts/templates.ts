/**
 * The alert catalogue.
 *
 * Everything a subscriber receives is rendered from here. No machine
 * translation, no model, anywhere in the alert pipeline — MT can soften
 * "extremely heavy rain" into something milder, and a model can do worse, and
 * neither failure is visible in the output. Severity is not negotiable enough
 * for either.
 *
 * Hazard words come from lib/weather/imd-codes.ts, which carries IMD's own
 * published code table verbatim. Severity words stay here because they are
 * this system's own phrasing of IMD's colour scale.
 */

import { hazardText } from '../weather/imd-codes';
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


/**
 * The hazard words for a code list.
 *
 * Comes from IMD's own published code table, not from anything written here.
 * An unrecognised code prints as the code: better an unfamiliar number than a
 * description nobody issued.
 */
function hazard(code: string, lang: 'hi' | 'en'): string {
  return hazardText(code, lang) || code;
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
