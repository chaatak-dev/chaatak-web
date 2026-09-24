'use client';

/**
 * The microphone, for a voice session: listen for a turn, hand over each
 * utterance when the person stops talking — or when they press the button to
 * say they have — and let go of the microphone while Chaatak answers.
 *
 * ONE CONTEXT, MANY STREAMS. The AudioContext lives for the whole session and
 * is created inside the tap that started it (`createCaptureContext`), because
 * that is the one moment every browser agrees audio may start; created after
 * a permission prompt and a network round trip, Safari may never let it run.
 * The microphone STREAM, though, is released while Chaatak speaks and taken
 * again for the next turn (`pause` / `resume`): a phone with its microphone
 * open routes playback through the call path — quieter, and on some handsets
 * to the earpiece — so an answer spoken over an open microphone is an answer
 * a farmer holding the phone at arm's length does not hear. What the detector
 * learnt about the room survives the pause.
 *
 * OFF THE MAIN THREAD, WHERE THE BROWSER ALLOWS IT. Audio arrives through an
 * AudioWorklet, which runs on the audio thread: a busy page (a re-render, a
 * long transcript on a cheap phone) delays the samples but never drops them.
 * A ScriptProcessorNode runs on the main thread and does drop them — gaps a
 * recogniser then hears as missing syllables — so it is only the fallback,
 * for browsers without worklets. The worklet is loaded from a Blob, so there
 * is still no module file to fetch or cache.
 *
 * The detector is fed ~10 ms frames whatever size the buffers arrive in: its
 * time constants are in milliseconds, and small frames keep a click from
 * smearing into something the length of a syllable.
 *
 * The browser is asked for echo cancellation, noise suppression and automatic
 * gain — what `audio: true` has always given this app.
 *
 * The microphone is open only between `openCapture` / `resume` and `pause` /
 * `close`. Nothing here opens it on its own.
 */

import { VoiceActivity, type VadConfig, type VadEvent } from './vad';
import { encodeMulawWav } from './wav';

/** Dhruva's recognisers are trained at 16 kHz. */
export const TARGET_RATE = 16_000;

/**
 * Audio kept from before speech was detected, so the first syllable is not
 * cut. The detector confirms speech ~100 ms after it begins, later on a soft
 * start ("म…"), and this covers both with room to spare.
 */
const PRE_ROLL_MS = 700;

/** Quiet kept after the last voiced frame; the rest of the hangover is not sent. */
const TRAIL_KEEP_MS = 300;

/** What the detector is fed, whatever buffer size the audio arrives in. */
const VAD_FRAME_MS = 10;

export type Utterance = {
  /** A μ-law WAV, ready to upload. */
  wav: ArrayBuffer;
  durationMs: number;
  voicedMs: number;
  forced: boolean;
  /** Ended by the person pressing the button. */
  manual: boolean;
};

export type CaptureEvents = {
  onSpeechStart: () => void;
  onUtterance: (utterance: Utterance) => void;
  onDiscarded: (reason: 'tooShort' | 'steadyNoise') => void;
  /** Roughly ten times a second: how loud, 0–1, above the room. For a meter. */
  onLevel?: (level: number) => void;
  /** The microphone went away mid-session: unplugged, or permission revoked. */
  onLost?: () => void;
};

export type OpenFailure = 'denied' | 'unsupported' | 'noMicrophone' | 'failed';

export type CaptureHandle = {
  /**
   * Release the microphone — every track stopped — while Chaatak answers.
   * Anything half-heard is dropped; what was learnt about the room is kept.
   */
  pause(): void;
  /** Take the microphone again for the next turn. A no-op when it is open. */
  resume(): Promise<{ ok: true } | { ok: false; reason: OpenFailure }>;
  /**
   * The person pressed the button to say they have finished: the utterance
   * so far, now, instead of after the pause the detector waits for. Null
   * when nothing is being heard.
   */
  finish(): Utterance | null;
  close(): void;
};

export type OpenResult = { ok: true; handle: CaptureHandle } | { ok: false; reason: OpenFailure };

export function captureSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const audioContext = 'AudioContext' in window || 'webkitAudioContext' in window;
  return Boolean(navigator.mediaDevices?.getUserMedia) && audioContext;
}

/**
 * The session's AudioContext, made and started INSIDE the tap. Call it
 * synchronously from the click handler; `openCapture` takes it from there.
 */
export function createCaptureContext(): AudioContext | null {
  if (!captureSupported()) return null;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new Ctor();
    if (context.state === 'suspended') void context.resume().catch(() => {});
    return context;
  } catch {
    return null;
  }
}

const CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
};

async function takeMicrophone(): Promise<{ ok: true; stream: MediaStream } | { ok: false; reason: OpenFailure }> {
  try {
    return { ok: true, stream: await navigator.mediaDevices.getUserMedia(CONSTRAINTS) };
  } catch (error) {
    // Refusal is a normal choice and gets its own state.
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return { ok: false, reason: 'denied' };
    if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError') {
      return { ok: false, reason: 'noMicrophone' };
    }
    return { ok: false, reason: 'failed' };
  }
}

/**
 * The worklet: copies each render quantum into ~21 ms blocks and posts them
 * to the main thread, transferring rather than copying the buffer.
 */
const WORKLET_SOURCE = `
class ChaatakCapture extends AudioWorkletProcessor {
  constructor() { super(); this.block = new Float32Array(1024); this.n = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.block[this.n++] = channel[i];
        if (this.n === this.block.length) {
          this.port.postMessage(this.block, [this.block.buffer]);
          this.block = new Float32Array(1024);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('chaatak-capture', ChaatakCapture);
`;

const workletReady = new WeakMap<AudioContext, Promise<boolean>>();

function loadWorklet(context: AudioContext): Promise<boolean> {
  let ready = workletReady.get(context);
  if (!ready) {
    ready = (async () => {
      if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined') return false;
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      try {
        await context.audioWorklet.addModule(url);
        return true;
      } catch {
        return false;
      } finally {
        URL.revokeObjectURL(url);
      }
    })();
    workletReady.set(context, ready);
  }
  return ready;
}

/** A node that receives the microphone and hands its samples to `onSamples`. */
async function frameSource(
  context: AudioContext,
  onSamples: (samples: Float32Array) => void,
): Promise<{ input: AudioNode; dispose(): void }> {
  const mute = context.createGain();
  mute.gain.value = 0;
  mute.connect(context.destination);

  if (await loadWorklet(context)) {
    try {
      const node = new AudioWorkletNode(context, 'chaatak-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      node.port.onmessage = (event: MessageEvent<Float32Array>) => onSamples(event.data);
      // Connected onward through a muted gain: a node the graph does not pull
      // is a node some browsers never run.
      node.connect(mute);
      return {
        input: node,
        dispose: () => {
          node.port.onmessage = null;
          node.disconnect();
          mute.disconnect();
        },
      };
    } catch {
      /* fall through to the processor */
    }
  }

  const processor = context.createScriptProcessor(1024, 1, 1);
  processor.onaudioprocess = (event) => onSamples(new Float32Array(event.inputBuffer.getChannelData(0)));
  // The processor only runs while connected to the destination; the gain of
  // zero keeps the microphone from being played back through the speaker.
  processor.connect(mute);
  return {
    input: processor,
    dispose: () => {
      processor.onaudioprocess = null;
      processor.disconnect();
      mute.disconnect();
    },
  };
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

export async function openCapture(
  events: CaptureEvents,
  options: { context?: AudioContext | null; vad?: Partial<VadConfig> } = {},
): Promise<OpenResult> {
  if (!captureSupported()) return { ok: false, reason: 'unsupported' };

  const first = await takeMicrophone();
  if (!first.ok) {
    void options.context?.close().catch(() => {});
    return first;
  }

  const context = options.context ?? createCaptureContext();
  if (!context) {
    first.stream.getTracks().forEach((track) => track.stop());
    return { ok: false, reason: 'unsupported' };
  }
  // A context made outside the tap may still be suspended. Asked once more,
  // but never waited on for long: a promise that stays pending until a
  // gesture that is not coming would hang the session in "requesting".
  if (context.state === 'suspended') {
    await Promise.race([context.resume().catch(() => {}), new Promise((r) => setTimeout(r, 600))]);
  }

  const rate = context.sampleRate;
  const frameSamples = Math.max(1, Math.round((rate * VAD_FRAME_MS) / 1000));
  const frameMs = (frameSamples / rate) * 1000;
  const preRollFrames = Math.ceil(PRE_ROLL_MS / frameMs);
  const vad = new VoiceActivity(options.vad);

  let stream: MediaStream | null = first.stream;
  let source: MediaStreamAudioSourceNode | null = null;
  let closed = false;
  let paused = false;
  /** Whether the session wants the microphone open — checked when a reopen lands. */
  let wanted = true;
  let resuming: Promise<{ ok: true } | { ok: false; reason: OpenFailure }> | null = null;

  const preRoll: Float32Array[] = [];
  let utterance: Float32Array[] | null = null;
  let carry = new Float32Array(0);
  let clock = 0;
  let lastLevel = 0;

  /** The utterance so far, trimmed to its last voiced frame plus a little quiet. */
  const build = (e: Extract<VadEvent, { type: 'speechEnd' }>): Utterance => {
    const frames = utterance ?? [];
    utterance = null;
    // Frame i of n ends at clock − (n − 1 − i) · frameMs.
    const keepUntil = e.lastVoicedMs + TRAIL_KEEP_MS;
    let keep = frames.length;
    while (keep > 0 && clock - (frames.length - keep) * frameMs > keepUntil + frameMs) keep -= 1;
    const audio = merge(frames.slice(0, Math.max(keep, 1)));
    // Never label audio with a rate it is not at: a Bluetooth headset can
    // run the context below 16 kHz, and then it is sent at its own rate.
    const outRate = Math.min(rate, TARGET_RATE);
    const samples = downsample(audio, rate, outRate);
    return {
      wav: encodeMulawWav(samples, outRate),
      durationMs: (samples.length / outRate) * 1000,
      voicedMs: e.voicedMs,
      forced: e.forced,
      manual: e.manual,
    };
  };

  const onFrame = (frame: Float32Array) => {
    clock += frameMs;
    if (utterance) utterance.push(frame);
    else {
      preRoll.push(frame);
      if (preRoll.length > preRollFrames) preRoll.shift();
    }

    for (const e of vad.push(frame, frameMs, clock)) {
      // An event can pause or close the capture (the utterance ended and the
      // session let go of the mic); nothing after that belongs to this turn.
      if (closed || paused) return;
      if (e.type === 'speechStart') {
        utterance = [...preRoll];
        preRoll.length = 0;
        events.onSpeechStart();
      } else if (e.type === 'speechEnd') {
        events.onUtterance(build(e));
      } else {
        utterance = null;
        events.onDiscarded(e.reason);
      }
    }

    if (closed || paused) return;
    if (events.onLevel && clock - lastLevel >= 100) {
      lastLevel = clock;
      const { db, floorDb } = vad.level();
      events.onLevel(Math.max(0, Math.min(1, (db - floorDb) / 30)));
    }
  };

  const onSamples = (samples: Float32Array) => {
    if (closed || paused) return;
    let data = samples;
    if (carry.length) {
      data = new Float32Array(carry.length + samples.length);
      data.set(carry);
      data.set(samples, carry.length);
    }
    let offset = 0;
    for (; offset + frameSamples <= data.length; offset += frameSamples) {
      onFrame(data.slice(offset, offset + frameSamples));
      if (closed || paused) return;
    }
    carry = data.slice(offset);
  };

  const nodes = await frameSource(context, onSamples);

  const attach = (next: MediaStream) => {
    stream = next;
    source = context.createMediaStreamSource(next);
    source.connect(nodes.input);
    // Stopping a track ourselves does not fire `ended`; this is only ever
    // the device going away, or the permission being taken back.
    next.getAudioTracks().forEach((track) =>
      track.addEventListener('ended', () => {
        if (!closed && !paused && stream === next) events.onLost?.();
      }),
    );
  };

  const release = () => {
    source?.disconnect();
    source = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };

  const forget = () => {
    utterance = null;
    preRoll.length = 0;
    carry = new Float32Array(0);
    vad.reset();
  };

  attach(first.stream);

  return {
    ok: true,
    handle: {
      pause: () => {
        wanted = false;
        if (closed || paused) return;
        paused = true;
        release();
        forget();
        events.onLevel?.(0);
      },
      resume: () => {
        if (closed) return Promise.resolve({ ok: false, reason: 'failed' as const });
        wanted = true;
        if (!paused) return Promise.resolve({ ok: true as const });
        resuming ??= (async () => {
          const next = await takeMicrophone();
          resuming = null;
          if (!next.ok) return next;
          // Stopped, or paused again, while the browser was opening it: a
          // stream nobody wants any more is closed, not kept.
          if (closed || !wanted || !paused) {
            next.stream.getTracks().forEach((track) => track.stop());
            return { ok: true as const };
          }
          forget();
          paused = false;
          attach(next.stream);
          return { ok: true as const };
        })();
        return resuming;
      },
      finish: () => {
        if (closed || paused) return null;
        const e = vad.finish(clock);
        if (!e || e.type !== 'speechEnd') {
          utterance = null;
          return null;
        }
        return build(e);
      },
      close: () => {
        if (closed) return;
        closed = true;
        release();
        nodes.dispose();
        void context.close().catch(() => {});
      },
    },
  };
}
