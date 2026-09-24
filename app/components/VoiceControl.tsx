'use client';

/**
 * The voice control: one button that starts a spoken conversation and, while
 * it runs, stops it.
 *
 * A SESSION, NOT A RECORDER. Tap once and talk; stop talking and the question
 * goes by itself; the answer is spoken; it listens again; talk over it and it
 * stops to listen. The button that started the session is the one that ends
 * it, in the same place, so Stop is never something to look for.
 *
 * EVERY STATE IN WORDS. The ring and the level bars are decoration. What the
 * session is doing is written beside the button — and announced to a screen
 * reader once, when it changes, never as a stream — so it reads the same with
 * animation off, in sunlight, and with the screen off entirely.
 */

import { useEffect, useRef } from 'react';
import { language, type LanguageCode } from '@/lib/i18n/languages';
import type { StringKey } from '@/lib/i18n/strings';
import { isActive, type VoiceState } from '@/lib/speech/session';
import type { VoiceSession } from './useVoiceSession';
import { useApp } from './AppState';

const STATE_KEY: Record<VoiceState['kind'], StringKey | null> = {
  idle: null,
  requesting_permission: 'voice.requesting',
  listening: 'voice.listening',
  speech_detected: 'voice.hearing',
  processing: 'voice.processing',
  assistant_speaking: 'voice.speaking',
  stopped: 'voice.stopped',
  error: null,
};

const ERROR_KEY: Record<Extract<VoiceState, { kind: 'error' }>['error'], StringKey | null> = {
  denied: 'voice.deniedBody',
  noMicrophone: 'voice.noMicrophoneBody',
  failed: 'voice.failedBody',
  unsupported: null,
};

function MicGlyph() {
  return (
    <svg className="voice__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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

function StopGlyph() {
  return (
    <svg className="voice__glyph voice__glyph--stop" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" />
    </svg>
  );
}

/** Five bars that follow the input level. Decoration: hidden from AT, and still under reduced motion. */
function Level({ level }: { level: number }) {
  return (
    <span className="voice__level" aria-hidden="true">
      {[0.2, 0.45, 0.7, 0.45, 0.2].map((weight, i) => (
        <span
          key={i}
          className="voice__bar"
          style={{ transform: `scaleY(${Math.max(0.18, Math.min(1, level * (0.6 + weight)))})` }}
        />
      ))}
    </span>
  );
}

export function VoiceControl({
  session,
  listeningIn,
}: {
  session: VoiceSession;
  /** The language the browser recogniser listens in, when it cannot detect one. */
  listeningIn: LanguageCode;
}) {
  const { t } = useApp();
  const { state, level, partial, browserOnly, supported } = session;
  const active = isActive(state);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Escape ends the session from anywhere on the page, the way it closes
  // every other thing that is "on" in this product.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) session.stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, session]);

  // No microphone API and no recogniser: no control, no apology. The text
  // input is right there.
  if (!supported || (state.kind === 'error' && state.error === 'unsupported')) return null;

  const stateKey = STATE_KEY[state.kind];
  const hint = state.kind === 'listening' && state.hint === 'notHeard' ? t('voice.notHeard') : null;
  const statement = state.kind === 'error' ? ERROR_KEY[state.error] : null;
  const status = hint ?? (stateKey ? t(stateKey) : null);

  const languageNote = active
    ? browserOnly
      ? t('voice.fallback', { language: language(listeningIn).native })
      : t('voice.auto')
    : null;

  return (
    <div
      className={`voice voice--${state.kind}${state.kind === 'error' ? ` voice--${state.error}` : ''}${
        active ? ' voice--active' : ''
      }`}
    >
      <button
        ref={buttonRef}
        type="button"
        className="voice__button"
        onClick={active ? session.stop : session.start}
        // The name says what pressing it does now. The state is announced
        // separately, in the status line, so the name need not carry it.
        aria-label={active ? t('voice.stop') : t('voice.start')}
      >
        {active ? <StopGlyph /> : <MicGlyph />}
      </button>

      <div className="voice__text">
        {/*
          The visible state line, and the only live region: polite, and it
          changes only when the state does — never with the level.
        */}
        <p className="voice__status" role="status" aria-live="polite">
          {status ??
            (state.kind === 'error'
              ? t(state.error === 'denied' ? 'mic.denied' : 'voice.stopped')
              : t('voice.start'))}
        </p>

        {languageNote && <p className="voice__note">{languageNote}</p>}

        {statement && <p className="voice__statement">{t(statement)}</p>}

        {partial && (
          <p className="voice__partial" lang={listeningIn}>
            {partial}
          </p>
        )}
      </div>

      {(state.kind === 'listening' || state.kind === 'speech_detected') && <Level level={level} />}
    </div>
  );
}
