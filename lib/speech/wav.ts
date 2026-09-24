/**
 * WAV encoding and format normalisation.
 *
 * Three problems this solves, all device or network compatibility rather than
 * cleverness:
 *
 * 1. Bhashini TTS returns IEEE-float WAV (format tag 3) at 22050Hz. Desktop
 *    Chrome decodes it; cheap Android handsets are exactly where that kind of
 *    thing stops working, and a warning the user cannot hear is a failed
 *    warning. So it is converted to 16-bit PCM server-side, which every
 *    browser decodes, rather than gambling on the client.
 *
 * 2. MediaRecorder produces webm/opus, which Dhruva ASR does not accept. The
 *    browser therefore captures raw PCM and encodes WAV itself.
 *
 * 3. A spoken question goes UP a rural uplink, which is the slow direction of
 *    a slow connection. It is sent as G.711 μ-law — still a standard WAV
 *    (format tag 7), half the bytes of 16-bit PCM, and the companding
 *    telephone speech recognition has always been fed — and the server widens
 *    it back to PCM16 before Dhruva sees it. Recognition was compared on both
 *    before this was switched on.
 */

/** Little-endian WAV header for 16-bit mono PCM. */
function pcm16Header(sampleCount: number, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const dataBytes = sampleCount * 2;

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format 1 = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return buffer;
}

function clampToPcm16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

/** Float samples in [-1, 1] to a complete 16-bit PCM WAV file. */
export function encodePcm16Wav(
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const header = pcm16Header(samples.length, sampleRate);
  const out = new Uint8Array(44 + samples.length * 2);
  out.set(new Uint8Array(header), 0);

  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, clampToPcm16(samples[i]), true);
  }
  return out.buffer;
}

/* ---- G.711 μ-law ------------------------------------------------------ */

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

/** One 16-bit sample to one μ-law byte (ITU-T G.711). */
export function linearToMulaw(sample: number): number {
  let s = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  if (s > MULAW_CLIP) s = MULAW_CLIP;
  s += MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** One μ-law byte back to a 16-bit sample. */
export function mulawToLinear(byte: number): number {
  const u = ~byte & 0xff;
  const exponent = (u >> 4) & 0x07;
  const magnitude = ((((u & 0x0f) << 3) + MULAW_BIAS) << exponent) - MULAW_BIAS;
  return u & 0x80 ? -magnitude : magnitude;
}

/**
 * Float samples in [-1, 1] to a complete μ-law WAV file: 8 bits a sample,
 * format tag 7, with the `fact` chunk a non-PCM WAV is supposed to carry.
 */
export function encodeMulawWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const header = 12 + 26 + 12 + 8;
  const out = new Uint8Array(header + samples.length + (samples.length % 2));
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, out.length - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 18, true);
  view.setUint16(20, 7, true); // format 7 = μ-law
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate: one byte a sample
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  view.setUint16(36, 0, true); // no extension
  ascii(38, 'fact');
  view.setUint32(42, 4, true);
  view.setUint32(46, samples.length, true);
  ascii(50, 'data');
  view.setUint32(54, samples.length, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    out[header + i] = linearToMulaw(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
  }
  return out.buffer;
}

type WavInfo = {
  formatTag: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
};

/** Walks the RIFF chunk list rather than assuming data starts at byte 44. */
function readWav(bytes: Uint8Array): WavInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12) return null;

  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  if (tag !== 'RIFF') return null;

  let offset = 12;
  let fmt: Omit<WavInfo, 'dataOffset' | 'dataLength'> | null = null;

  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === 'fmt ' && size >= 16) {
      fmt = {
        formatTag: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === 'data' && fmt) {
      return {
        ...fmt,
        dataOffset: body,
        dataLength: Math.min(size, bytes.byteLength - body),
      };
    }

    // Chunks are word-aligned.
    offset = body + size + (size % 2);
  }
  return null;
}

/**
 * Normalises any WAV we receive into 16-bit PCM.
 *
 * Returns the input untouched when it is already PCM16, so a source that
 * already behaves costs nothing. Returns null when the bytes are not a WAV we
 * can read — the caller then reports a failure rather than playing noise.
 */
export function toPcm16Wav(input: ArrayBuffer): ArrayBuffer | null {
  return normaliseWav(input)?.wav ?? null;
}

/** As `toPcm16Wav`, and says the sample rate the audio is actually at. */
export function normaliseWav(input: ArrayBuffer): { wav: ArrayBuffer; sampleRate: number } | null {
  const bytes = new Uint8Array(input);
  const info = readWav(bytes);
  if (!info || info.channels < 1 || info.sampleRate <= 0) return null;
  const sampleRate = info.sampleRate;

  // Format 1 = PCM, 3 = IEEE float, 7 = μ-law.
  if (info.formatTag === 1 && info.bitsPerSample === 16 && info.channels === 1) {
    return { wav: input, sampleRate };
  }

  if (info.formatTag === 7 && info.bitsPerSample === 8) {
    const frames = Math.floor(info.dataLength / info.channels);
    const out = new Uint8Array(44 + frames * 2);
    out.set(new Uint8Array(pcm16Header(frames, sampleRate)), 0);
    const view = new DataView(out.buffer);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < info.channels; c++) sum += mulawToLinear(bytes[info.dataOffset + i * info.channels + c]);
      view.setInt16(44 + i * 2, Math.round(sum / info.channels), true);
    }
    return { wav: out.buffer, sampleRate };
  }

  if (info.formatTag !== 3 || info.bitsPerSample !== 32) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames = Math.floor(info.dataLength / 4 / info.channels);
  const mono = new Float32Array(frames);

  for (let i = 0; i < frames; i++) {
    // Downmix to mono: ASR and a phone speaker both want one channel.
    let sum = 0;
    for (let c = 0; c < info.channels; c++) {
      sum += view.getFloat32(info.dataOffset + (i * info.channels + c) * 4, true);
    }
    mono[i] = sum / info.channels;
  }

  return { wav: encodePcm16Wav(mono, sampleRate), sampleRate };
}
