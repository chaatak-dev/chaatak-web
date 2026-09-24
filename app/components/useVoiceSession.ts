'use client';

/**
 * A voice session, wired to the browser.
 *
 * The rules live in lib/speech/session.ts as a pure state machine; this hook
 * carries out its effects — opening and releasing the microphone,
 * transcribing, speaking — and feeds the machine what the browser reports.
 *
 * ONE CONVERSATION ENGINE. A transcript is handed to the same `ask` a typed
 * question goes through, with the language the recogniser detected attached.
 * There is no voice-only pipeline: type, speak, type, speak, and the
 * conversation carries across all of it.
 *
 * TWO RECOGNISERS, ONE SESSION. Bhashini, through our own route, when the
 * server has it: every utterance is detected and transcribed there. The
 * browser's own recogniser otherwise — which cannot detect a language, so it
 * listens in the conversation's, and the interface says so rather than
 * pretending to detect. A session that starts on Bhashini and finds it not
 * answering moves to the browser's recogniser rather than ending.
 *
 * THE PERSON CAN ALWAYS FINISH THEIR OWN TURN. The detector ends a turn when
 * the person stops talking; `send` ends it when they press the button — the
 * old tap-talk-tap, still there for a noisy room or a quick question.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isLanguageCode, type LanguageCode } from '@/lib/i18n/languages';
import {
  captureSupported,
  createCaptureContext,
  openCapture,
  type CaptureEvents,
  type CaptureHandle,
  type Utterance,
} from '@/lib/speech/capture';
import { isActive, transition, type VoiceEvent, type VoiceState } from '@/lib/speech/session';
import { bhashiniSpeech, primePlayback, webSpeech } from '@/lib/speech/source';
import type { Speaking } from '@/lib/speech/types';

export type SpokenAnswer = { text: string; speakAs: LanguageCode } | null;

export type VoiceOptions = {
  /** Voice is on auto: detect the spoken language per utterance. */
  auto: boolean;
  /** The chosen voice language, or where detection starts. */
  lang: LanguageCode;
  /** The device's language — a candidate for the Indic recogniser. */
  device: LanguageCode;
  /** The conversation's language so far, and whether it has been steady. */
  prior: () => { lang: LanguageCode | null; confident: boolean };
  /** Hand a transcript to the conversation; resolves with what to say back. */
  onTranscript: (text: string, heard: LanguageCode | null) => Promise<SpokenAnswer>;
};

/**
 * The input level, 0–1, as a store rather than as state. The meter reads it
 * and nothing else does, so ten readings a second re-render five bars — not
 * the whole conversation, which on a cheap phone was main-thread time taken
 * from the audio.
 */
export type LevelStore = {
  subscribe: (listener: () => void) => () => void;
  get: () => number;
};

export type VoiceSession = {
  state: VoiceState;
  level: LevelStore;
  /** Interim words, when the browser's recogniser offers them. */
  partial: string;
  /** Recognition runs in the browser, which cannot detect a language. */
  browserOnly: boolean;
  supported: boolean;
  start: () => void;
  stop: () => void;
  /** The person says they have finished speaking: send what was heard, now. */
  send: () => void;
};

type Engine = 'unknown' | 'bhashini' | 'browser';

type Pending = { kind: 'audio'; utterance: Utterance } | { kind: 'text'; transcript: string };

type Recognised =
  | { kind: 'heard'; transcript: string; lang: LanguageCode | null }
  | { kind: 'heardNothing' }
  | { kind: 'failed' };

/** Listening with nobody speaking for this long ends the session and lets go of the microphone. */
const IDLE_MS = 30_000;
/** Recognition failures in a row before the session stops trusting its recogniser. */
const MAX_FAILURES = 2;
/** The server's recognisers give up at twelve seconds and may retry once; this is the outer bound. */
const ASR_CLIENT_TIMEOUT_MS = 30_000;

function createLevelStore(): LevelStore & { set: (value: number) => void } {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (next === value) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const noopSubscribe = () => () => {};

/** A microphone to capture from, or a recogniser that opens its own. */
function voiceCapable(): boolean {
  return captureSupported() || Boolean(browserRecogniser());
}

/** The browser's own recogniser, where it exists. */
function browserRecogniser() {
  return webSpeech.supports().recognise ? webSpeech : null;
}

/** AbortSignal.timeout is missing on older Safari; without it, no timeout rather than a TypeError. */
function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(ms) : undefined;
}

/** The languages a session is likely to be heard in: the conversation's, the device's, English. */
function likelyLanguages(options: VoiceOptions): LanguageCode[] {
  return [...new Set<LanguageCode>([options.prior().lang ?? options.lang, options.device, 'en'])].slice(0, 3);
}

/**
 * Whether the server has a recogniser — asked once per page, when the page
 * is idle, so the tap that starts a session does not wait on it. Only that:
 * looking up the recognisers themselves costs the server calls to Bhashini,
 * and is done when someone actually starts talking (see `start`), not for
 * every visitor who never touches the microphone.
 */
let serverProbe: Promise<boolean> | null = null;
function askServer(): Promise<boolean> {
  serverProbe ??= fetch('/api/speech/asr', { cache: 'no-store' })
    .then((res) => res.json() as Promise<{ configured?: boolean }>)
    .then((body) => Boolean(body.configured))
    .catch(() => {
      // Unknown, not "no": asked again next time.
      serverProbe = null;
      return false;
    });
  return serverProbe;
}

export function useVoiceSession(options: VoiceOptions): VoiceSession {
  const [state, setState] = useState<VoiceState>({ kind: 'idle' });
  const [partial, setPartial] = useState('');
  const [engine, setEngine] = useState<Engine>('unknown');
  // Assumed on the server and read on the client: the control is part of the
  // first paint, rather than appearing a moment later and pushing the
  // composer up. Only the rare browser with neither API loses it.
  const supported = useSyncExternalStore(noopSubscribe, voiceCapable, () => true);
  const [level] = useState(createLevelStore);

  // The machine is driven from audio callbacks, which fire outside React's
  // render cycle; the live state is a ref and the rendered one follows it.
  const stateRef = useRef<VoiceState>({ kind: 'idle' });
  const captureRef = useRef<CaptureHandle | null>(null);
  /** Made inside the tap that starts a session, and handed to the capture. */
  const contextRef = useRef<AudioContext | null>(null);
  const speakingRef = useRef<Speaking | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const answerRef = useRef<SpokenAnswer>(null);
  const engineRef = useRef<Engine>('unknown');
  /** The server can synthesise speech — independent of which recogniser is in use. */
  const serverVoiceRef = useRef(false);
  const optionsRef = useRef(options);
  const browserSessionRef = useRef<{ stop(): void; cancel(): void } | null>(null);
  const failuresRef = useRef(0);
  const idleRef = useRef<number | null>(null);
  /** Increments on every start and stop, so late callbacks from an old session are ignored. */
  const generation = useRef(0);

  useEffect(() => {
    optionsRef.current = options;
  });

  // Which recogniser the server offers, asked once — not discovered one
  // failed utterance at a time.
  const resolveEngine = useCallback(async (): Promise<Engine> => {
    if (engineRef.current !== 'unknown') return engineRef.current;
    const server = await askServer();
    serverVoiceRef.current = server;
    if (engineRef.current === 'unknown') {
      const next: Engine = server && captureSupported() ? 'bhashini' : browserRecogniser() ? 'browser' : 'unknown';
      engineRef.current = next;
      setEngine(next);
    }
    return engineRef.current;
  }, []);

  useEffect(() => {
    // The engine question waits until the page has nothing better to do.
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(() => void resolveEngine(), { timeout: 3000 })
      : window.setTimeout(() => void resolveEngine(), 1200);
    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [resolveEngine]);

  /* ---- the machine ------------------------------------------------- */

  const dispatch = useCallback((event: VoiceEvent) => {
    const before = stateRef.current;
    const { state: next, effects } = transition(before, event);
    stateRef.current = next;
    setState(next);

    // The idle clock runs only while listening, and starts over each time
    // listening begins.
    if (next.kind !== 'listening') clearIdle();
    else if (before.kind !== 'listening') armIdle();

    for (const effect of effects) {
      switch (effect) {
        case 'openMicrophone':
          void open();
          break;
        case 'listen':
          listen();
          break;
        case 'pauseMicrophone':
          pause();
          break;
        case 'closeMicrophone':
          close();
          break;
        case 'cancelSpeech':
          speakingRef.current?.cancel();
          speakingRef.current = null;
          break;
        case 'transcribe':
          void transcribe();
          break;
        case 'speak':
          speak();
          break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- effects ------------------------------------------------------ */

  function armIdle() {
    clearIdle();
    const mine = generation.current;
    idleRef.current = window.setTimeout(() => {
      idleRef.current = null;
      if (mine === generation.current) dispatch({ type: 'IDLE_TIMEOUT' });
    }, IDLE_MS);
  }

  function clearIdle() {
    if (idleRef.current === null) return;
    window.clearTimeout(idleRef.current);
    idleRef.current = null;
  }

  function captureEvents(mine: number): CaptureEvents {
    const current = () => mine === generation.current;
    return {
      onSpeechStart: () => {
        if (current()) dispatch({ type: 'SPEECH_START' });
      },
      onUtterance: (utterance) => {
        if (!current()) return;
        pendingRef.current = { kind: 'audio', utterance };
        dispatch({ type: 'SPEECH_END' });
      },
      onDiscarded: () => {
        if (current()) dispatch({ type: 'DISCARDED' });
      },
      onLevel: (value) => {
        if (current()) level.set(value);
      },
      onLost: () => {
        if (current()) dispatch({ type: 'FAILED' });
      },
    };
  }

  async function open() {
    const mine = generation.current;
    const context = contextRef.current;
    contextRef.current = null;
    const discard = () => void context?.close().catch(() => {});

    const chosen = await resolveEngine();
    if (mine !== generation.current) return discard();
    if (chosen === 'unknown') {
      discard();
      return dispatch({ type: 'UNSUPPORTED' });
    }
    if (chosen === 'browser') {
      // The browser's recogniser opens its own microphone, and asks for it
      // itself. A second capture beside it is what Android refuses: the
      // recogniser is handed silence.
      discard();
      return dispatch({ type: 'PERMISSION_GRANTED' });
    }

    const result = await openCapture(captureEvents(mine), { context });
    if (mine !== generation.current) {
      if (result.ok) result.handle.close();
      return;
    }
    if (!result.ok) {
      if (result.reason === 'denied') return dispatch({ type: 'PERMISSION_DENIED' });
      if (result.reason === 'noMicrophone') return dispatch({ type: 'NO_MICROPHONE' });
      if (result.reason === 'unsupported' && browserRecogniser()) {
        switchToBrowserRecogniser();
        return dispatch({ type: 'PERMISSION_GRANTED' });
      }
      return dispatch({ type: result.reason === 'unsupported' ? 'UNSUPPORTED' : 'FAILED' });
    }
    captureRef.current = result.handle;
    dispatch({ type: 'PERMISSION_GRANTED' });
  }

  /** Listen for the next turn: take the microphone again, or start the browser's recogniser. */
  function listen() {
    // A page nobody is looking at does not listen. Let whatever is being
    // said finish, and end the session instead of opening the microphone.
    if (document.visibilityState === 'hidden') {
      queueMicrotask(() => stopRef.current());
      return;
    }
    if (engineRef.current === 'browser') return listenInBrowser();
    const capture = captureRef.current;
    if (!capture) return;
    const mine = generation.current;
    void capture.resume().then((result) => {
      if (mine !== generation.current || result.ok) return;
      if (result.reason === 'denied') dispatch({ type: 'PERMISSION_DENIED' });
      else if (result.reason === 'noMicrophone') dispatch({ type: 'NO_MICROPHONE' });
      else dispatch({ type: 'FAILED' });
    });
  }

  /** Let go of the microphone while the question is answered. */
  function pause() {
    captureRef.current?.pause();
    browserSessionRef.current?.cancel();
    browserSessionRef.current = null;
    level.set(0);
    setPartial('');
  }

  function close() {
    clearIdle();
    captureRef.current?.close();
    captureRef.current = null;
    void contextRef.current?.close().catch(() => {});
    contextRef.current = null;
    browserSessionRef.current?.cancel();
    browserSessionRef.current = null;
    level.set(0);
    setPartial('');
  }

  /** The server's recogniser is gone or not answering; the browser's own can still hear. */
  function switchToBrowserRecogniser() {
    captureRef.current?.close();
    captureRef.current = null;
    engineRef.current = 'browser';
    setEngine('browser');
  }

  function recognitionFailed() {
    failuresRef.current += 1;
    if (failuresRef.current < MAX_FAILURES) return dispatch({ type: 'TRANSCRIBE_FAILED' });
    failuresRef.current = 0;
    if (engineRef.current === 'bhashini' && browserRecogniser()) {
      switchToBrowserRecogniser();
      return dispatch({ type: 'TRANSCRIBE_FAILED' });
    }
    dispatch({ type: 'FAILED' });
  }

  async function recognise(utterance: Utterance): Promise<Recognised> {
    const opts = optionsRef.current;
    const prior = opts.prior();
    const query = new URLSearchParams({
      lang: opts.auto ? 'auto' : opts.lang,
      prior: prior.lang ?? opts.lang,
      device: opts.device,
    });
    if (prior.confident) query.set('confident', '1');
    try {
      // The WAV itself is the body: no base64, no JSON around it.
      const res = await fetch(`/api/speech/asr?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'audio/wav' },
        body: utterance.wav,
        signal: timeoutSignal(ASR_CLIENT_TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as { kind?: string; transcript?: string; lang?: string };
      if (res.ok && body.kind === 'heard' && body.transcript?.trim()) {
        return { kind: 'heard', transcript: body.transcript, lang: isLanguageCode(body.lang) ? body.lang : null };
      }
      if (res.ok && (body.kind === 'heardNothing' || body.kind === 'heard')) return { kind: 'heardNothing' };
      return { kind: 'failed' };
    } catch {
      return { kind: 'failed' };
    }
  }

  async function transcribe() {
    const mine = generation.current;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return dispatch({ type: 'HEARD_NOTHING' });
    if (pending.kind === 'text') return answer(pending.transcript, null, mine);

    const heard = await recognise(pending.utterance);
    if (mine !== generation.current) return;
    // "The recogniser did not answer" and "you said nothing" are different,
    // and are said differently: asking someone to repeat themselves into a
    // service that is down helps nobody.
    if (heard.kind === 'failed') return recognitionFailed();
    failuresRef.current = 0;
    if (heard.kind === 'heardNothing') return dispatch({ type: 'HEARD_NOTHING' });
    await answer(heard.transcript, heard.lang, mine);
  }

  async function answer(transcript: string, heard: LanguageCode | null, mine: number) {
    const reply = await optionsRef.current.onTranscript(transcript, heard).catch(() => null);
    if (mine !== generation.current) return;
    answerRef.current = reply;
    dispatch({ type: 'ANSWERED', speak: Boolean(reply?.text) });
  }

  function speak() {
    const mine = generation.current;
    const reply = answerRef.current;
    if (!reply) return dispatch({ type: 'SPEECH_DONE' });
    // The answer's own language, never the setting's: a voice cannot read a
    // script it was not built for.
    const speaker = serverVoiceRef.current ? bhashiniSpeech : webSpeech;
    const handle = speaker.speak([{ text: reply.text, lang: reply.speakAs }]);
    speakingRef.current = handle;
    void handle.done.finally(() => {
      if (mine !== generation.current || speakingRef.current !== handle) return;
      speakingRef.current = null;
      dispatch({ type: 'SPEECH_DONE' });
    });
  }

  /**
   * One turn with the browser's recogniser. It opens its own microphone and
   * ends the turn itself when the person stops; it cannot detect a language,
   * so it listens in the conversation's.
   */
  function listenInBrowser() {
    const recogniser = browserRecogniser();
    if (!recogniser || browserSessionRef.current) return;
    const mine = generation.current;
    const opts = optionsRef.current;
    const lang = opts.prior().lang ?? opts.lang;
    setPartial('');
    const session = recogniser.recognise({
      lang,
      onPartial: setPartial,
      onSpeechStart: () => {
        if (mine === generation.current && stateRef.current.kind === 'listening') dispatch({ type: 'SPEECH_START' });
      },
    });
    browserSessionRef.current = session;

    void session.result.then((recognition) => {
      if (browserSessionRef.current === session) browserSessionRef.current = null;
      if (mine !== generation.current) return;
      setPartial('');
      const now = stateRef.current.kind;
      if (now !== 'listening' && now !== 'speech_detected') return;

      switch (recognition.kind) {
        case 'heard':
          failuresRef.current = 0;
          pendingRef.current = { kind: 'text', transcript: recognition.transcript };
          return dispatch({ type: 'SPEECH_END' });
        case 'denied':
          return dispatch({ type: 'PERMISSION_DENIED' });
        case 'failed':
          if (recognition.reason === 'audio-capture') return dispatch({ type: 'NO_MICROPHONE' });
          return recognitionFailed();
        case 'heardNothing':
          // It heard a sound and made nothing of it: back to listening,
          // which starts it again.
          if (now === 'speech_detected') return dispatch({ type: 'DISCARDED' });
          // Silence timed it out. Listen again, still inside the session —
          // the idle clock, not the recogniser, decides when to give up.
          window.setTimeout(() => {
            if (mine === generation.current && stateRef.current.kind === 'listening') listenInBrowser();
          }, 150);
      }
    });
  }

  /* ---- controls ----------------------------------------------------- */

  const start = useCallback(() => {
    generation.current += 1;
    failuresRef.current = 0;
    // Starting a session is the moment someone chose to talk: anything still
    // being said from before stops.
    speakingRef.current?.cancel();
    speakingRef.current = null;
    // Still inside the tap — the one moment every browser agrees sound may
    // start. The answer will be played seconds from now, from a network
    // callback, and the microphone opened after a permission prompt.
    primePlayback();
    void contextRef.current?.close().catch(() => {});
    contextRef.current = engineRef.current === 'browser' ? null : createCaptureContext();
    if (engineRef.current !== 'browser' && captureSupported()) {
      // Someone is about to talk: have this session's recognisers looked up
      // on the server before the first question reaches it.
      const warm = likelyLanguages(optionsRef.current).join(',');
      void fetch(`/api/speech/asr?warm=${warm}`, { cache: 'no-store' }).catch(() => {});
    }
    dispatch({ type: 'START' });
  }, [dispatch]);

  const stop = useCallback(() => {
    generation.current += 1;
    dispatch({ type: 'STOP' });
    // Whatever the machine thought, nothing stays open after Stop.
    close();
    speakingRef.current?.cancel();
    speakingRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const send = useCallback(() => {
    const kind = stateRef.current.kind;
    if (kind !== 'speech_detected' && kind !== 'listening') return;
    if (engineRef.current === 'browser') {
      // The recogniser finalises what it heard; its result arrives as usual.
      browserSessionRef.current?.stop();
      return;
    }
    const utterance = captureRef.current?.finish() ?? null;
    if (!utterance) return;
    pendingRef.current = { kind: 'audio', utterance };
    dispatch({ type: 'SPEECH_END' });
  }, [dispatch]);

  // Leaving the page ends a session that is listening: the microphone is
  // never left open behind a screen the person is no longer on. An answer
  // already being spoken is let finish (`listen` then ends the session).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      const kind = stateRef.current.kind;
      if (isActive(stateRef.current) && kind !== 'processing' && kind !== 'assistant_speaking') stopRef.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Leaving the conversation ends the session too.
  useEffect(
    () => () => {
      generation.current += 1;
      if (idleRef.current !== null) window.clearTimeout(idleRef.current);
      captureRef.current?.close();
      void contextRef.current?.close().catch(() => {});
      browserSessionRef.current?.cancel();
      speakingRef.current?.cancel();
    },
    [],
  );

  return {
    state,
    level,
    partial,
    browserOnly: engine === 'browser',
    supported,
    start,
    stop,
    send,
  };
}
