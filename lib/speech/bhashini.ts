/**
 * Bhashini in the browser: capture PCM, post it to our own API route, play
 * back audio the route returns. No key is ever present on this side.
 *
 * Audio is captured through the Web Audio API rather than MediaRecorder,
 * because MediaRecorder produces webm/opus and Dhruva accepts wav. Capturing
 * raw samples and encoding WAV here is the difference between working and not.
 *
 * ScriptProcessorNode is deprecated in favour of AudioWorklet. It is used
 * anyway: it needs no separate module file to fetch, and it works on the old
 * Android WebViews this product is aimed at. For 16kHz voice capture its
 * shortcomings do not show.
 */

import type {
  Recognition,
  RecognitionSession,
  Speaking,
  SpeechLang,
  SpeechSegment,
  SpeechSource,
  SpeechSupport,
  Utterance,
} from './types';
import { splitForSpeech } from './split';
import { encodePcm16Wav } from './wav';
import { webSpeech } from './web-speech';

/**
 * One <audio> element for every answer, unlocked inside the tap that started
 * the session (`primePlayback`). iOS lets an element play without a fresh
 * gesture only once a gesture has played it — and an answer arrives seconds
 * after the tap, from a network callback, when a newly made element may simply
 * refuse to make a sound. `owner` says which answer is using it, so cancelling
 * a finished one cannot pause the next.
 */
let player: HTMLAudioElement | null = null;
let owner: symbol | null = null;
let silentWav: string | null = null;

/**
 * Call synchronously from the tap that starts a voice session: plays a
 * moment of silence through the shared element, and an empty utterance
 * through the browser's own voice, so both may speak later without a tap.
 */
export function primePlayback(): void {
  if (typeof window === 'undefined') return;
  try {
    if (!silentWav) {
      const bytes = new Uint8Array(encodePcm16Wav(new Float32Array(800), 16_000));
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      silentWav = `data:audio/wav;base64,${btoa(binary)}`;
    }
    player ??= new Audio();
    if (owner === null) {
      player.src = silentWav;
      void player.play().catch(() => {});
    }
  } catch {
    /* an element that cannot be primed is made fresh when it is needed */
  }
  try {
    if ('speechSynthesis' in window) {
      const nothing = new SpeechSynthesisUtterance('');
      nothing.volume = 0;
      window.speechSynthesis.speak(nothing);
    }
  } catch {
    /* the browser's voice is a fallback; it unlocks on its own elsewhere */
  }
}

/** Play one clip to its end — or until cancelled, or until it fails to decode. */
function playClip(audio: HTMLAudioElement, url: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = () => {
      audio.onended = null;
      audio.onerror = null;
      resolve();
    };
    audio.onended = finish;
    // A decode failure must not hang the queue.
    audio.onerror = finish;
    signal.addEventListener('abort', finish, { once: true });
    audio.src = url;
    void audio.play().catch(finish);
  });
}

/** Dhruva's conformer models are trained at 16kHz. */
const TARGET_RATE = 16_000;
/** Stop on our own terms rather than recording forever. */
const MAX_SECONDS = 20;

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    // Average the source window rather than picking one sample, which would
    // alias badly on a noisy field recording.
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export const bhashiniSpeech: SpeechSource = {
  name: 'Bhashini',

  supports(): SpeechSupport {
    if (typeof window === 'undefined') return { recognise: false, speak: false };
    const audioContext =
      'AudioContext' in window || 'webkitAudioContext' in window;
    const capture = Boolean(navigator.mediaDevices?.getUserMedia) && audioContext;
    // Playback only needs an <audio> element, which is universal.
    return { recognise: capture, speak: true };
  },

  recognise({ lang }): RecognitionSession {
    let settle: (r: Recognition) => void = () => {};
    const result = new Promise<Recognition>((resolve) => {
      settle = resolve;
    });

    let stopped = false;
    let cleanup = () => {};
    const chunks: Float32Array[] = [];
    let captureRate = TARGET_RATE;

    const finish = async (abandoned: boolean) => {
      if (stopped) return;
      stopped = true;
      cleanup();

      if (abandoned) return settle({ kind: 'heardNothing' });

      const total = chunks.reduce((n, c) => n + c.length, 0);
      if (total === 0) return settle({ kind: 'heardNothing' });

      const merged = new Float32Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }

      const samples = downsample(merged, captureRate, TARGET_RATE);
      const wav = encodePcm16Wav(samples, TARGET_RATE);

      try {
        const res = await fetch('/api/speech/asr', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            audio: toBase64(wav),
            lang,
            sampleRate: TARGET_RATE,
          }),
        });
        if (!res.ok) {
          return settle({ kind: 'failed', reason: `HTTP ${res.status}` });
        }
        const body = (await res.json()) as
          | { kind: 'heard'; transcript: string }
          | { kind: 'heardNothing' }
          | { kind: 'failed'; reason: string };

        if (body.kind === 'heard') {
          // Verbatim. Nothing between the engine and the query layer.
          return settle({ kind: 'heard', transcript: body.transcript, lang });
        }
        return settle(body);
      } catch {
        return settle({ kind: 'failed', reason: 'network' });
      }
    };

    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        stopped = true;
        // Permission refusal is a normal state, distinct from a failure.
        const name = error instanceof DOMException ? error.name : '';
        return settle(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? { kind: 'denied' }
            : { kind: 'failed', reason: name || 'microphone unavailable' },
        );
      }

      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const context = new Ctor();
      captureRate = context.sampleRate;

      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };

      source.connect(processor);
      // Required for the processor to run; gain of zero so nothing is echoed
      // back through the speaker while recording.
      const mute = context.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(context.destination);

      const timer = setTimeout(() => void finish(false), MAX_SECONDS * 1000);

      cleanup = () => {
        clearTimeout(timer);
        processor.onaudioprocess = null;
        processor.disconnect();
        mute.disconnect();
        source.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        void context.close().catch(() => {});
      };
    })();

    return {
      result,
      stop: () => void finish(false),
      cancel: () => void finish(true),
    };
  },

  /**
   * Spoken a sentence at a time (see ./split.ts): the next piece is
   * synthesised while the current one plays, so the wait before the voice is
   * the wait for its first sentence rather than for the whole answer.
   */
  speak(utterance: Utterance): Speaking {
    const controller = new AbortController();
    const me = Symbol('answer');
    const audio = player ?? new Audio();
    owner = me;
    let url: string | null = null;
    let fallback: Speaking | null = null;

    /**
     * The browser's own voice, when Bhashini could not synthesise. Silence
     * after a spoken question reads as broken; a plainer voice does not. It
     * finishes the answer, rather than trading voices sentence by sentence.
     */
    const speakLocally = async (segments: SpeechSegment[]) => {
      if (controller.signal.aborted || !webSpeech.supports().speak) return;
      fallback = webSpeech.speak(segments);
      await fallback.done;
      fallback = null;
    };

    const synthesise = (piece: SpeechSegment): Promise<Blob | null> =>
      fetch('/api/speech/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: piece.text, lang: piece.lang }),
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.blob() : null))
        .catch(() => null);

    const done = (async () => {
      const pieces: SpeechSegment[] = utterance.flatMap((segment) =>
        splitForSpeech(segment.text).map((text) => ({ text, lang: segment.lang })),
      );
      let next = pieces.length ? synthesise(pieces[0]) : null;

      for (let i = 0; i < pieces.length; i++) {
        const blob = await next;
        next = i + 1 < pieces.length ? synthesise(pieces[i + 1]) : null;
        if (controller.signal.aborted) return;

        if (!blob) {
          await speakLocally(pieces.slice(i));
          return;
        }
        url = URL.createObjectURL(blob);
        await playClip(audio, url, controller.signal);
        URL.revokeObjectURL(url);
        url = null;
      }
    })().finally(() => {
      if (owner === me) owner = null;
    });

    return {
      done,
      cancel: () => {
        controller.abort();
        if (owner === me) audio.pause();
        (fallback as Speaking | null)?.cancel();
        if (url) URL.revokeObjectURL(url);
      },
    };
  },
};

export type { SpeechLang };
