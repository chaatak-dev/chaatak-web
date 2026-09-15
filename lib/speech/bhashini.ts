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
  SpeechSource,
  SpeechSupport,
  Utterance,
} from './types';
import { encodePcm16Wav } from './wav';

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

  speak(utterance: Utterance): Speaking {
    const controller = new AbortController();
    let audio: HTMLAudioElement | null = null;
    let url: string | null = null;

    const done = (async () => {
      for (const segment of utterance) {
        if (controller.signal.aborted) return;
        const text = segment.text.trim();
        if (!text) continue;

        let blob: Blob;
        try {
          const res = await fetch('/api/speech/tts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, lang: segment.lang }),
            signal: controller.signal,
          });
          if (!res.ok) return;
          blob = await res.blob();
        } catch {
          return;
        }

        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        audio = new Audio(url);

        await new Promise<void>((resolve) => {
          if (!audio) return resolve();
          audio.onended = () => resolve();
          // A decode failure must not hang the queue.
          audio.onerror = () => resolve();
          controller.signal.addEventListener('abort', () => resolve(), { once: true });
          void audio.play().catch(() => resolve());
        });

        URL.revokeObjectURL(url);
        url = null;
        audio = null;
      }
    })();

    return {
      done,
      cancel: () => {
        controller.abort();
        audio?.pause();
        if (url) URL.revokeObjectURL(url);
      },
    };
  },
};

export type { SpeechLang };
