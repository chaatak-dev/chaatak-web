/**
 * Telling the user WHICH thing failed.
 *
 * "Could not reach the server. Check your connection" was shown for every
 * failure, including a server that answered promptly with a 503 because an
 * environment variable was wrong. The message was not just unhelpful, it was
 * actively misdirecting: it named a cause that had been ruled out by the very
 * fact that a response arrived.
 *
 * So the three cases are kept apart, and the one that is NOT a network problem
 * says so in as many words.
 */

import { interfaceLanguage } from '../i18n/languages';
import type { SpeechLang } from '../speech/types';

export type RequestFailure =
  /** The request never left: the browser knows it has no network. */
  | { kind: 'offline' }
  /** The request left and nothing came back. DNS, a dead host, a proxy. */
  | { kind: 'unreachable' }
  /**
   * The server answered, and the answer was an error. Whatever else is wrong,
   * the connection is fine — which is exactly what the old message denied.
   */
  | { kind: 'serverError'; status: number; detail?: string };

export type FailureMessage = { hi: string; en: string };

export function describeFailure(failure: RequestFailure): FailureMessage {
  switch (failure.kind) {
    case 'offline':
      return {
        hi: 'आप ऑफ़लाइन हैं। इंटरनेट आने पर फिर पूछें।',
        en: 'You are offline. Ask again when you have a connection.',
      };

    case 'unreachable':
      return {
        hi: 'सर्वर तक नहीं पहुँच सका। इंटरनेट जाँचें और फिर कोशिश करें।',
        en: 'Could not reach the server. Check your connection and try again.',
      };

    case 'serverError': {
      // Leading with "the server answered" is the point: it rules out the
      // network in the first clause, before anyone starts checking cables.
      const hi = `सर्वर ने जवाब दिया, पर त्रुटि के साथ (HTTP ${failure.status})। यह इंटरनेट की समस्या नहीं है।`;
      const en = `The server answered with an error (HTTP ${failure.status}). This is not a connection problem.`;

      // The detail names an environment variable, never a value. It is what
      // would have pointed straight at the cause instead of at the wifi.
      return failure.detail
        ? { hi: `${hi} ${failure.detail}`, en: `${en} ${failure.detail}` }
        : { hi, en };
    }
  }
}

/**
 * Classifies a failed request.
 *
 * @param threw true when fetch itself rejected, meaning no response arrived
 * @param online navigator.onLine at the moment of failure
 */
export function classifyFailure(opts: {
  threw: boolean;
  online: boolean;
  status?: number;
  detail?: string;
}): RequestFailure {
  if (opts.threw) {
    return opts.online ? { kind: 'unreachable' } : { kind: 'offline' };
  }
  return {
    kind: 'serverError',
    status: opts.status ?? 0,
    detail: opts.detail,
  };
}

export function failureText(failure: RequestFailure, lang: SpeechLang): string {
  // Interface chrome exists in two languages. A Tamil speaker gets it in the
  // one their script is closest to, never a machine translation of it.
  return describeFailure(failure)[interfaceLanguage(lang)];
}
