import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeMulawWav, encodePcm16Wav, linearToMulaw, mulawToLinear, normaliseWav, toPcm16Wav } from './wav';

function readHeader(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const tag = (o: number) => String.fromCharCode(...new Uint8Array(buffer, o, 4));
  return { riff: tag(0), wave: tag(8), riffSize: view.getUint32(4, true), bytes: buffer.byteLength };
}

function pcmSamples(wav: ArrayBuffer): Int16Array {
  // Our PCM16 files put data at byte 44.
  return new Int16Array(wav.slice(44));
}

test('μ-law companding round-trips within its step size', () => {
  for (const sample of [0, 1, -1, 100, -100, 1000, -1000, 8000, -8000, 20000, -20000, 32767, -32768]) {
    const back = mulawToLinear(linearToMulaw(sample));
    // μ-law steps grow with the magnitude: about 3% of it, never worse.
    const tolerance = Math.max(8, Math.abs(sample) * 0.035);
    assert.ok(Math.abs(back - Math.max(-32635, Math.min(32635, sample))) <= tolerance, `${sample} → ${back}`);
  }
});

test('a μ-law WAV is a well-formed WAV, half the size of PCM16', () => {
  const samples = new Float32Array(16_000).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / 16_000));
  const mu = encodeMulawWav(samples, 16_000);
  const pcm = encodePcm16Wav(samples, 16_000);
  const header = readHeader(mu);
  assert.equal(header.riff, 'RIFF');
  assert.equal(header.wave, 'WAVE');
  assert.equal(header.riffSize, header.bytes - 8);
  assert.ok(mu.byteLength < pcm.byteLength * 0.52, `${mu.byteLength} vs ${pcm.byteLength}`);
});

test('a μ-law upload is widened to PCM16 at the rate its header states', () => {
  const samples = new Float32Array(8_000).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 300 * i) / 16_000));
  const out = normaliseWav(encodeMulawWav(samples, 16_000));
  assert.ok(out);
  assert.equal(out.sampleRate, 16_000);
  const widened = pcmSamples(out.wav);
  assert.equal(widened.length, samples.length);
  // The waveform survives: within μ-law's quantisation of the original.
  let worst = 0;
  for (let i = 0; i < samples.length; i++) worst = Math.max(worst, Math.abs(widened[i] / 32768 - samples[i]));
  assert.ok(worst < 0.02, `worst error ${worst}`);
});

test('PCM16 passes through untouched, and says its rate', () => {
  const pcm = encodePcm16Wav(new Float32Array(100), 8_000);
  const out = normaliseWav(pcm);
  assert.ok(out);
  assert.equal(out.wav, pcm);
  assert.equal(out.sampleRate, 8_000);
  assert.equal(toPcm16Wav(pcm), pcm);
});

test('bytes that are not a WAV are refused, not played as noise', () => {
  assert.equal(normaliseWav(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]).buffer), null);
  assert.equal(normaliseWav(new ArrayBuffer(4)), null);
});
