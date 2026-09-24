'use client';

/**
 * A voice session, wired to the browser.
 *
 * The rules live in lib/speech/session.ts as a pure state machine; this hook
 * carries out its effects — opening the microphone, transcribing, speaking,
 * stopping — and feeds the machine what the browser reports.
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
 * pretending to detect.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LanguageCode } from '@/lib/i18n/languages';
import { captureSupported, openCapture, TARGET_RATE, toBase64, type CaptureHandle, type Utterance } from '@/lib/speech/capture';
import { transition, type VoiceEvent, type VoiceState } from '@/lib/speech/session';
import { bhashiniSpeech, webSpeech } from '@/lib/speech/source';
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

export type VoiceSession = {
  state: VoiceState;
  /** 0–1, how loud above the room, about ten times a second. */
  level: number;
  /** Interim words, when the browser's recogniser offers them. */
  partial: string;
  /** Recognition runs in the browser, which cannot detect a language. */
  browserOnly: boolean;
  supported: boolean;
  start: () => void;
  stop: () => void;
};

type Engine = 'unknown' | 'bhashini' | 'browser';

/** The browser's own recogniser, where it exists. */
function browserRecogniser() {
  return webSpeech.supports().recognise ? webSpeech : null;
}

export function useVoiceSession(options: VoiceOptions): VoiceSession {
  const [state, setState] = useState<VoiceState>({ kind: 'idle' });
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState('');
  const [engine, setEngine] = useState<Engine>('unknown');
  const [supported, setSupported] = useState(false);

  // The machine is driven from audio callbacks, which fire outside React's
  // render cycle; the live state is a ref and the rendered one follows it.
  const stateRef = useRef<VoiceState>({ kind: 'idle' });
  const captureRef = useRef<CaptureHandle | null>(null);
  const speakingRef = useRef<Speaking | null>(null);
  const pendingRef = useRef<Utterance | null>(null);
  const answerRef = useRef<SpokenAnswer>(null);
  const engineRef = useRef<Engine>('unknown');
  const optionsRef = useRef(options);
  const browserSessionRef = useRef<{ cancel(): void } | null>(null);
  /** Increments on every stop, so late callbacks from an old session are ignored. */
  const generation = useRef(0);

  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    // Read after mount: `navigator` does not exist on the server.
    const timer = window.setTimeout(() => setSupported(captureSupported() || Boolean(browserRecogniser())), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Which recogniser the server offers, asked once — not discovered one
  // failed utterance at a time.
  const resolveEngine = useCallback(async (): Promise<Engine> => {
    if (engineRef.current !== 'unknown') return engineRef.current;
    let next: Engine = 'browser';
    if (captureSupported()) {
      try {
        const res = await fetch('/api/speech/asr', { cache: 'no-store' });
        const body = (await res.json()) as { configured?: boolean };
        if (body.configured) next = 'bhashini';
      } catch {
        /* the browser's recogniser, if any */
      }
    }
    if (next === 'browser' && !browserRecogniser()) next = 'unknown';
    engineRef.current = next;
    setEngine(next);
    return next;
  }, []);

  /* ---- the machine ------------------------------------------------- */

  const dispatch = useCallback((event: VoiceEvent) => {
    const { state: next, effects } = transition(stateRef.current, event);
    stateRef.current = next;
    setState(next);

    for (const effect of effects) {
      switch (effect) {
        case 'openMicrophone':
          void open();
          break;
        case 'closeMicrophone':
          close();
          break;
        case 'cancelSpeech':
          speakingRef.current?.cancel();
          speakingRef.current = null;
          break;
        case 'bargeInOn':
          captureRef.current?.setBargeIn(true);
          break;
        case 'bargeInOff':
          captureRef.current?.setBargeIn(false);
          break;
        case 'transcribe':
          void transcribe();
          break;
        case 'speak':
          speak();
          break;
      }
    }

    // Listening is the only state in which speech starts a turn. While a
    // question is being answered the detector keeps hearing the room but
    // starts nothing.
    captureRef.current?.setListening(next.kind !== 'processing');

    // The browser's recogniser is started per turn, when there is a turn to
    // listen for.
    if (engineRef.current === 'browser' && next.kind === 'listening') listenInBrowser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- effects ------------------------------------------------------ */

  async function open() {
    const mine = generation.current;
    const chosen = await resolveEngine();
    if (mine !== generation.current) return;
    if (chosen === 'unknown') return dispatch({ type: 'UNSUPPORTED' });

    const result = await openCapture({
      onSpeechStart: () => {
        if (mine !== generation.current) return;
        // With the browser recogniser, our detector's job is barge-in only;
        // its own endpointing decides when a question ended.
        if (engineRef.current === 'browser' && stateRef.current.kind !== 'assistant_speaking') return;
        dispatch({ type: 'SPEECH_START' });
        if (engineRef.current === 'browser') listenInBrowser();
      },
      onUtterance: (utterance) => {
        if (mine !== generation.current || engineRef.current !== 'bhashini') return;
        pendingRef.current = utterance;
        dispatch({ type: 'SPEECH_END' });
      },
      onDiscarded: () => {
        if (mine !== generation.current || engineRef.current !== 'bhashini') return;
        dispatch({ type: 'DISCARDED' });
      },
      onLevel: (value) => {
        if (mine === generation.current) setLevel(value);
      },
    });

    if (mine !== generation.current) {
      if (result.ok) result.handle.close();
      return;
    }
    if (!result.ok) {
      if (result.reason === 'denied') return dispatch({ type: 'PERMISSION_DENIED' });
      if (result.reason === 'noMicrophone') return dispatch({ type: 'NO_MICROPHONE' });
      if (result.reason === 'unsupported') {
        // No capture, but perhaps a browser recogniser: it opens its own mic.
        if (engineRef.current === 'browser') return dispatch({ type: 'PERMISSION_GRANTED' });
        return dispatch({ type: 'UNSUPPORTED' });
      }
      return dispatch({ type: 'FAILED' });
    }
    captureRef.current = result.handle;
    dispatch({ type: 'PERMISSION_GRANTED' });
  }

  function close() {
    captureRef.current?.close();
    captureRef.current = null;
    browserSessionRef.current?.cancel();
    browserSessionRef.current = null;
    setLevel(0);
    setPartial('');
  }

  async function transcribe() {
    const mine = generation.current;
    const utterance = pendingRef.current;
    pendingRef.current = null;
    if (!utterance) return dispatch({ type: 'HEARD_NOTHING' });

    const opts = optionsRef.current;
    const prior = opts.prior();
    let body: { kind: string; transcript?: string; lang?: LanguageCode };
    try {
      const res = await fetch('/api/speech/asr', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          audio: toBase64(utterance.wav),
          sampleRate: TARGET_RATE,
          lang: opts.auto ? 'auto' : opts.lang,
          prior: prior.lang ?? opts.lang,
          device: opts.device,
          priorConfident: prior.confident,
        }),
      });
      body = (await res.json()) as typeof body;
      if (!res.ok && body.kind !== 'heardNothing') throw new Error(`HTTP ${res.status}`);
    } catch {
      if (mine === generation.current) dispatch({ type: 'FAILED' });
      return;
    }
    if (mine !== generation.current) return;

    if (body.kind !== 'heard' || !body.transcript?.trim()) return dispatch({ type: 'HEARD_NOTHING' });
    await answer(body.transcript, body.lang ?? null, mine);
  }

  async function answer(transcript: string, heard: LanguageCode | null, mine: number) {
    const reply = await optionsRef.current.onTranscript(transcript, heard).catch(() => null);
    if (mine !== generation.current) return;
    answerRef.current = reply;
    const canSpeak = bhashiniSpeech.supports().speak || webSpeech.supports().speak;
    dispatch({ type: 'ANSWERED', speak: Boolean(reply?.text) && canSpeak });
  }

  function speak() {
    const mine = generation.current;
    const reply = answerRef.current;
    if (!reply) return dispatch({ type: 'SPEECH_DONE' });
    // The answer's own language, never the setting's: a voice cannot read a
    // script it was not built for.
    const speaker = engineRef.current === 'bhashini' ? bhashiniSpeech : webSpeech;
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
    const session = recogniser.recognise({ lang, onPartial: setPartial });
    browserSessionRef.current = session;

    void session.result.then(async (recognition) => {
      if (browserSessionRef.current === session) browserSessionRef.current = null;
      if (mine !== generation.current) return;
      setPartial('');
      if (recognition.kind === 'denied') return dispatch({ type: 'PERMISSION_DENIED' });
      if (recognition.kind === 'heard' && recognition.transcript.trim()) {
        if (stateRef.current.kind === 'listening') dispatch({ type: 'SPEECH_START' });
        dispatch({ type: 'SPEECH_END' });
        await answer(recognition.transcript, null, mine);
        return;
      }
      // Nothing heard this time: listen again, still inside the session.
      if (stateRef.current.kind === 'listening') {
        window.setTimeout(() => {
          if (mine === generation.current && stateRef.current.kind === 'listening') listenInBrowser();
        }, 250);
      }
    });
  }

  /* ---- controls ----------------------------------------------------- */

  const start = useCallback(() => {
    generation.current += 1;
    // Starting a session is the moment someone chose to talk: anything still
    // being said from before stops.
    speakingRef.current?.cancel();
    speakingRef.current = null;
    dispatch({ type: 'START' });
  }, [dispatch]);

  const stop = useCallback(() => {
    generation.current += 1;
    dispatch({ type: 'STOP' });
    // Whatever the machine thought, nothing stays open after Stop.
    close();
    speakingRef.current?.cancel();
    speakingRef.current = null;
  }, [dispatch]);

  // Leaving the page, or the conversation, ends the session: the microphone
  // is never left open behind a screen the person is no longer on.
  useEffect(
    () => () => {
      generation.current += 1;
      captureRef.current?.close();
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
  };
}

