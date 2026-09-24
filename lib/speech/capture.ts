'use client';

/**
 * The microphone, for a voice session: open once, listen continuously, and
 * hand over each utterance when the person stops talking.
 *
 * One stream for the whole session rather than one per question, because a
 * session is a conversation: the detector needs to hear the room to know its
 * noise floor, and it needs to keep hearing while Chaatak speaks so that a
 * person talking over it can interrupt.
 *
 * The browser is asked for echo cancellation, noise suppression and automatic
 * gain. Echo cancellation is what lets the mic stay open while Chaatak talks
 * without Chaatak hearing itself; how well it removes audio played through an
 * <audio> element varies by browser and device, which is why the detector
 * also raises its bar while Chaatak is speaking.
 *
 * ScriptProcessorNode is deprecated in favour of AudioWorklet and used
 * anyway, as the existing capture did: it needs no module file, and it works
 * on the old Android WebViews this product is for.
 *
 * The microphone is open only between `openCapture` and `close`. Nothing here
 * opens it on its own.
 */

import { VoiceActivity, type VadConfig } from './vad';
import { encodePcm16Wav } from './wav';

/** Dhruva's recognisers are trained at 16 kHz. */
export const TARGET_RATE = 16_000;

/** Audio kept from just before speech began, so the first syllable is not cut. */
const PRE_ROLL_MS = 320;

export type Utterance = { wav: ArrayBuffer; durationMs: number; voicedMs: number; forced: boolean };

export type CaptureEvents = {
  onSpeechStart: () => void;
  onUtterance: (utterance: Utterance) => void;
  onDiscarded: (reason: 'tooShort' | 'steadyNoise') => void;
  /** Roughly ten times a second: how loud, 0–1, above the room. For a meter. */
  onLevel?: (level: number) => void;
};

export type CaptureHandle = {
  /** While Chaatak is speaking, only clear speech over it counts. */
  setBargeIn(on: boolean): void;
  /** Paused, the detector still hears the room but starts no utterance. */
  setListening(on: boolean): void;
  close(): void;
};

export type OpenResult =
  | { ok: true; handle: CaptureHandle }
  | { ok: false; reason: 'denied' | 'unsupported' | 'noMicrophone' | 'failed' };

export function captureSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const audioContext = 'AudioContext' in window || 'webkitAudioContext' in window;
  return Boolean(navigator.mediaDevices?.getUserMedia) && audioContext;
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    // Average the window rather than pick a sample: picking aliases badly on
    // a noisy field recording.
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

function merge(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export async function openCapture(events: CaptureEvents, vadConfig: Partial<VadConfig> = {}): Promise<OpenResult> {
  if (!captureSupported()) return { ok: false, reason: 'unsupported' };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
  } catch (error) {
    // Refusal is a normal choice and gets its own state.
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return { ok: false, reason: 'denied' };
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') {
      return { ok: false, reason: 'noMicrophone' };
    }
    return { ok: false, reason: 'failed' };
  }

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new Ctor();
  // Started from a tap, so resuming is allowed; some browsers start suspended.
  if (context.state === 'suspended') await context.resume().catch(() => {});

  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(1024, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;

  const rate = context.sampleRate;
  const frameMs = (1024 / rate) * 1000;
  const vad = new VoiceActivity(vadConfig);

  const preRoll: Float32Array[] = [];
  const preRollFrames = Math.ceil(PRE_ROLL_MS / frameMs);
  let utterance: Float32Array[] | null = null;
  let listening = true;
  let clock = 0;
  let lastLevel = 0;
  let closed = false;

  processor.onaudioprocess = (event) => {
    if (closed) return;
    const frame = new Float32Array(event.inputBuffer.getChannelData(0));
    clock += frameMs;

    if (utterance) utterance.push(frame);
    else {
      preRoll.push(frame);
      if (preRoll.length > preRollFrames) preRoll.shift();
    }

    for (const e of vad.push(frame, frameMs, clock)) {
      if (e.type === 'speechStart') {
        if (!listening) {
          // Heard, but not a turn: the last question is still being answered.
          vad.reset();
          continue;
        }
        utterance = [...preRoll];
        preRoll.length = 0;
        events.onSpeechStart();
      } else if (e.type === 'speechEnd') {
        const audio = utterance ? merge(utterance) : new Float32Array(0);
        utterance = null;
        const samples = downsample(audio, rate, TARGET_RATE);
        events.onUtterance({
          wav: encodePcm16Wav(samples, TARGET_RATE),
          durationMs: (samples.length / TARGET_RATE) * 1000,
          voicedMs: e.voicedMs,
          forced: e.forced,
        });
      } else {
        utterance = null;
        events.onDiscarded(e.reason);
      }
    }

    if (events.onLevel && clock - lastLevel >= 100) {
      lastLevel = clock;
      const { db, floorDb } = vad.level();
      events.onLevel(Math.max(0, Math.min(1, (db - floorDb) / 30)));
    }
  };

  source.connect(processor);
  // The processor only runs while connected to the destination; the gain of
  // zero keeps the microphone from being played back through the speaker.
  processor.connect(mute);
  mute.connect(context.destination);

  return {
    ok: true,
    handle: {
      setBargeIn: (on) => vad.setBargeIn(on),
      setListening: (on) => {
        listening = on;
        if (!on) {
          utterance = null;
          vad.reset();
        }
      },
      close: () => {
        if (closed) return;
        closed = true;
        processor.onaudioprocess = null;
        processor.disconnect();
        mute.disconnect();
        source.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        void context.close().catch(() => {});
      },
    },
  };
}

/** Base64 for a JSON body. Chunked: spreading a large array overflows the stack. */
export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
