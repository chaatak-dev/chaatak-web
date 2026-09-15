/**
 * WAV encoding and format normalisation.
 *
 * Two problems this solves, both device-compatibility rather than cleverness:
 *
 * 1. Bhashini TTS returns IEEE-float WAV (format tag 3) at 22050Hz. Desktop
 *    Chrome decodes it; cheap Android handsets are exactly where that kind of
 *    thing stops working, and a warning the user cannot hear is a failed
 *    warning. So it is converted to 16-bit PCM server-side, which every
 *    browser decodes, rather than gambling on the client.
 *
 * 2. MediaRecorder produces webm/opus, which Dhruva ASR does not accept. The
 *    browser therefore captures raw PCM and encodes WAV itself.
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
  const bytes = new Uint8Array(input);
  const info = readWav(bytes);
  if (!info) return null;

  // Format 1 = PCM, 3 = IEEE float.
  if (info.formatTag === 1 && info.bitsPerSample === 16 && info.channels === 1) {
    return input;
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

  return encodePcm16Wav(mono, info.sampleRate);
}
