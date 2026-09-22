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

/** "23 Sep, 23:30" — a date as well as a time, because a window can cross midnight. */
function stampIn(iso: string, lang: 'hi' | 'en'): string {
  try {
    return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-GB', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** The catalogue's words for a severity, for any surface that shows one. */
export function severityWords(severity: Severity, lang: 'hi' | 'en'): string {
  return SEVERITY_WORDS[severity][lang];
}

/** The catalogue's action line for a severity: "Be prepared". */
export function severityAction(severity: Severity, lang: 'hi' | 'en'): string {
  return SEVERITY_ACTION[severity][lang];
}

/**
 * The same alert, kept in its pieces.
 *
 * A notification shade has a title and a line of text; Telegram can lay an
 * alert out with hierarchy and put buttons under it. Both are rendered from
 * these parts, and every word in them comes from this catalogue or from IMD's
 * own code table — a channel only arranges them, it never writes one.
 */
export type AlertParts = {
  kind: AlertPayload['kind'];
  severity: Severity;
  /** "Orange warning". For an all-clear, the severity that lifted. */
  severityWords: string;
  /** "Be prepared". Null on an all-clear. */
  action: string | null;
  /** IMD's hazard words. Empty on an all-clear. */
  hazard: string;
  district: string;
  /** "23 Sep, 23:30 IST". Null on an all-clear. */
  until: string | null;
  source: string;
  /** "14:00 IST" — when the bulletin was issued. */
  issued: string;
  /** The sentence an all-clear is. Null on a warning. */
  lifted: string | null;
};

export type RenderedAlert = {
  title: string;
  body: string;
  /** The language every word above is in. */
  lang: 'hi' | 'en';
  parts: AlertParts;
};

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
    const body =
      lang === 'hi'
        ? `${payload.district} की ${lifted} अब लागू नहीं है। ${source}`
        : `The ${lifted.toLowerCase()} for ${payload.district} is no longer in force. ${source}`;
    return {
      title: lang === 'hi' ? 'चेतावनी हटा ली गई' : 'Warning lifted',
      body,
      lang,
      parts: {
        kind: 'allClear',
        severity: payload.severity,
        severityWords: lifted,
        action: null,
        hazard: '',
        district: payload.district,
        until: null,
        source: payload.provenance.source,
        issued: `${stamp} IST`,
        lifted:
          lang === 'hi'
            ? `${payload.district} की ${lifted} अब लागू नहीं है।`
            : `The ${lifted.toLowerCase()} for ${payload.district} is no longer in force.`,
      },
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
    lang,
    parts: {
      kind: 'warning',
      severity: payload.severity,
      severityWords: words,
      action,
      hazard: what,
      district: payload.district,
      until: `${stampIn(payload.validTo, lang)} IST`,
      source: payload.provenance.source,
      issued: `${stamp} IST`,
      lifted: null,
    },
  };
}
