/**
 * The browser's own Web Speech API: the fallback when Bhashini is unreachable
 * or the user is offline.
 *
 * Needs no key and runs in-process, so it works when the network does not.
 * Unlike Bhashini it streams interim results, which is why `onPartial` is part
 * of the interface at all.
 *
 * Firefox implements no SpeechRecognition, so `supports()` can report speech
 * out without speech in, and the mic simply does not render.
 */

import type {
  Recognition,
  RecognitionSession,
  Speaking,
  SpeechSource,
  SpeechSupport,
  Utterance,
} from './types';

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Locale tags come from the language registry, so adding a language cannot
 * leave this map behind. Browser coverage beyond Hindi and English is patchy —
 * an unsupported locale simply fails to start, which the session reports as a
 * failure rather than silently listening in the wrong language.
 */
import { bcp47 } from '../i18n/languages';

export const webSpeech: SpeechSource = {
  name: 'Web Speech',

  supports(): SpeechSupport {
    if (typeof window === 'undefined') return { recognise: false, speak: false };
    return {
      recognise: recognitionCtor() !== null,
      speak: 'speechSynthesis' in window,
    };
  },

  recognise({ lang, onPartial }): RecognitionSession {
    let settle: (r: Recognition) => void = () => {};
    const result = new Promise<Recognition>((resolve) => {
      settle = resolve;
    });

    const Ctor = recognitionCtor();
    if (!Ctor) {
      settle({ kind: 'failed', reason: 'not supported' });
      return { result, stop: () => {}, cancel: () => {} };
    }

    const recogniser = new Ctor();
    recogniser.lang = bcp47(lang);
    recogniser.continuous = false;
    recogniser.interimResults = true;
    recogniser.maxAlternatives = 1;

    let finalText = '';
    let settled = false;
    const done = (r: Recognition) => {
      if (settled) return;
      settled = true;
      settle(r);
    };

    recogniser.onresult = (event) => {
      const e = event as {
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      };
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const alternative = e.results[i][0];
        if (!alternative) continue;
        if (e.results[i].isFinal) finalText += alternative.transcript;
        else interim += alternative.transcript;
      }
      if (interim && onPartial) onPartial(interim);
    };

    recogniser.onerror = (event) => {
      const name = (event as { error?: string }).error ?? 'unknown';
      if (name === 'not-allowed' || name === 'service-not-allowed') {
        return done({ kind: 'denied' });
      }
      if (name === 'no-speech' || name === 'aborted') {
        return done({ kind: 'heardNothing' });
      }
      done({ kind: 'failed', reason: name });
    };

    recogniser.onend = () => {
      const transcript = finalText.trim();
      // Empty stays empty. Nothing is invented to fill the gap.
      done(
        transcript
          ? { kind: 'heard', transcript, lang }
          : { kind: 'heardNothing' },
      );
    };

    try {
      recogniser.start();
    } catch {
      done({ kind: 'failed', reason: 'could not start' });
    }

    return {
      result,
      stop: () => {
        try {
          recogniser.stop();
        } catch {
          done({ kind: 'heardNothing' });
        }
      },
      cancel: () => {
        try {
          recogniser.abort();
        } catch {
          /* onend settles it */
        }
        done({ kind: 'heardNothing' });
      },
    };
  },

  speak(utterance: Utterance): Speaking {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return { done: Promise.resolve(), cancel: () => {} };
    }

    let cancelled = false;
    const done = (async () => {
      for (const segment of utterance) {
        if (cancelled) return;
        const text = segment.text.trim();
        if (!text) continue;

        await new Promise<void>((resolve) => {
          const speech = new SpeechSynthesisUtterance(text);
          speech.lang = bcp47(segment.lang);
          speech.onend = () => resolve();
          speech.onerror = () => resolve();
          window.speechSynthesis.speak(speech);
        });
      }
    })();

    return {
      done,
      cancel: () => {
        cancelled = true;
        window.speechSynthesis.cancel();
      },
    };
  },
};
