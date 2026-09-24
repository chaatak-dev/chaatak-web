'use client';

/**
 * The voice control: one button that starts a spoken conversation, sends a
 * question as soon as the person says they are done, and stops.
 *
 * A SESSION, NOT A RECORDER. Tap once and talk; stop talking and the question
 * goes by itself; the answer is spoken; it listens again. The button that
 * started the session is the one that ends it, in the same place, so Stop is
 * never something to look for.
 *
 * AND STILL TAP-TALK-TAP. While the person is being heard, the same button
 * sends what they said now, instead of after the pause the detector waits
 * for. It is what the microphone always did, it is what a hand does without
 * thinking, and in a room loud enough to confuse any detector it is the way
 * a question always gets through.
 *
 * EVERY STATE IN WORDS. The ring and the level bars are decoration. What the
 * session is doing is written beside the button — and announced to a screen
 * reader once, when it changes, never as a stream — so it reads the same with
 * animation off, in sunlight, and with the screen off entirely.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { language, type LanguageCode } from '@/lib/i18n/languages';
import type { StringKey } from '@/lib/i18n/strings';
import { isActive, type VoiceState } from '@/lib/speech/session';
import type { LevelStore, VoiceSession } from './useVoiceSession';
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

/** The composer's own send arrow: the same act, the same mark. */
function SendGlyph() {
  return (
    <svg className="voice__glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M4 12h15M13 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Five bars that follow the input level. Decoration: hidden from AT, and
 * still under reduced motion. It subscribes to the level itself, so ten
 * readings a second re-render these five spans and nothing else.
 */
function Level({ store }: { store: LevelStore }) {
  const level = useSyncExternalStore(store.subscribe, store.get, () => 0);
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
  const { state, partial, browserOnly, supported } = session;
  const active = isActive(state);
  const hearing = state.kind === 'speech_detected';

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
  const hint =
    state.kind === 'listening' && state.hint
      ? t(state.hint === 'failed' ? 'voice.retry' : 'voice.notHeard')
      : state.kind === 'stopped' && state.reason === 'idle'
        ? t('voice.idleStopped')
        : null;
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
        type="button"
        className="voice__button"
        onClick={hearing ? session.send : active ? session.stop : session.start}
        // The name says what pressing it does now. The state is announced
        // separately, in the status line, so the name need not carry it.
        aria-label={hearing ? t('voice.send') : active ? t('voice.stop') : t('voice.start')}
      >
        {hearing ? <SendGlyph /> : active ? <StopGlyph /> : <MicGlyph />}
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

      {/* The browser's recogniser reports no level, and a meter frozen at
          its floor would say the microphone hears nothing. */}
      {(state.kind === 'listening' || hearing) && !browserOnly && <Level store={session.level} />}
    </div>
  );
}
