'use client';

/**
 * The microphone. The largest element on screen, because voice is the input
 * and text is the fallback.
 *
 * Six states, not five. `denied` is separate from `failed` on purpose:
 * refusing microphone permission is a normal choice, and showing it in a
 * "something went wrong" treatment would tell the user they had made a
 * mistake when they had not.
 *
 * ASR is a round trip to a server — measured at about 1.6s — and there is no
 * streaming endpoint to hide that behind. So `processing` is entered the
 * instant the user stops speaking, never when the response lands, and it says
 * what it is doing. A wait that is announced reads as deliberate; the same
 * wait unannounced reads as broken.
 */

import type { MicState, SpeechLang } from '@/lib/speech/types';

const LABELS: Record<
  Exclude<MicState, 'unsupported'>,
  { hi: string; en: string }
> = {
  idle: { hi: 'बोलकर पूछें', en: 'Ask by voice' },
  listening: { hi: 'सुन रहे हैं…', en: 'Listening' },
  processing: { hi: 'जाँच रहे हैं…', en: 'Checking' },
  failed: { hi: 'सुनाई नहीं दिया', en: 'Not heard' },
  denied: { hi: 'माइक बंद है', en: 'Microphone off' },
};

function MicGlyph() {
  return (
    <svg className="mic__glyph" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

type Props = {
  state: MicState;
  lang: SpeechLang;
  /** Live words from the engine while listening, when it offers them. */
  partial?: string;
  onStart: () => void;
  onStop: () => void;
  /**
   * Chat places the mic beside a text input rather than alone on the page, so
   * it takes the 52px paired size instead of the 74px standalone one. The
   * brand rule sizes it by what it sits next to, not by where it appears.
   */
  compact?: boolean;
};

export function Mic({ state, lang, partial, onStart, onStop, compact }: Props) {
  // Nothing at all: no control, no explanation, no apology.
  if (state === 'unsupported') return null;

  const label = LABELS[state];
  const isListening = state === 'listening';
  const inert = state === 'processing' || state === 'denied';

  return (
    <div className={`mic mic--${state}${compact ? ' mic--compact' : ''}`}>
      <button
        type="button"
        className="mic__button"
        onClick={isListening ? onStop : onStart}
        disabled={inert}
        aria-label={isListening ? 'Stop listening' : 'Ask by voice'}
        aria-pressed={isListening}
      >
        <MicGlyph />
      </button>

      {/*
        The state is carried visually by a pulsing ring and a colour, neither
        of which reaches a screen reader. Listening and processing especially
        need announcing: without them there is no signal that anything is
        happening at all.
      */}
      <p className="mic__label" role="status" aria-live="polite">
        <span lang="hi" className="mic__label-hi">
          {label.hi}
        </span>
        <span className="mic__label-en">{label.en}</span>
      </p>

      {isListening && partial ? (
        <p className="mic__partial" lang={lang}>
          {partial}
        </p>
      ) : null}

      {state === 'failed' ? (
        <p className="mic__statement">
          <span lang="hi">कुछ सुनाई नहीं दिया। फिर से बोलें, या लिखकर पूछें।</span>
          <span className="mic__statement-en">
            Nothing was heard. Try again, or type your question.
          </span>
        </p>
      ) : null}

      {state === 'denied' ? (
        <p className="mic__statement">
          <span lang="hi">माइक की अनुमति नहीं है। नीचे लिखकर पूछें।</span>
          <span className="mic__statement-en">
            Microphone permission is off. Type your question below.
          </span>
        </p>
      ) : null}
    </div>
  );
}
