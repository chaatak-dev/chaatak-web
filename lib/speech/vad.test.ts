import { test } from 'node:test';
import assert from 'node:assert/strict';

import { frameDb, VoiceActivity, type VadEvent } from './vad';

/**
 * Synthetic audio, 20 ms frames at 16 kHz. Speech is modelled as what matters
 * to an energy detector: loud, and rising and falling with its syllables at
 * about four a second. Noise is steady.
 */

const RATE = 16_000;
const FRAME_MS = 20;
const FRAME = (RATE * FRAME_MS) / 1000;

let seed = 7;
function random(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

/** A frame of noise at a given dBFS. */
function noise(db: number): Float32Array {
  const amp = Math.pow(10, db / 20) * Math.sqrt(3);
  const frame = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) frame[i] = (random() * 2 - 1) * amp;
  return frame;
}

type Segment = { ms: number; db: number | ((tMs: number) => number) };

/** Speech-like loudness: a base level with syllabic modulation. */
const speech = (base: number) => (t: number) => base + 9 * Math.sin((2 * Math.PI * t) / 250);

function run(segments: Segment[], vad = new VoiceActivity()) {
  const events: VadEvent[] = [];
  let at = 0;
  for (const segment of segments) {
    for (let t = 0; t < segment.ms; t += FRAME_MS) {
      at += FRAME_MS;
      const db = typeof segment.db === 'number' ? segment.db : segment.db(t);
      events.push(...vad.push(noise(db), FRAME_MS, at));
    }
  }
  return events;
}

test('loudness is measured in dBFS', () => {
  assert.ok(Math.abs(frameDb(noise(-30)) - -30) < 1.5);
  assert.equal(frameDb(new Float32Array(0)), -120);
});

test('a quiet room produces nothing', () => {
  assert.deepEqual(run([{ ms: 3000, db: -65 }]), []);
});

test('a spoken question starts, ends on its own, and is kept', () => {
  const events = run([
    { ms: 500, db: -60 },
    { ms: 1600, db: speech(-28) },
    { ms: 1200, db: -60 },
  ]);
  assert.deepEqual(events.map((e) => e.type), ['speechStart', 'speechEnd']);
  const end = events[1] as Extract<VadEvent, { type: 'speechEnd' }>;
  assert.equal(end.forced, false);
  // It ends after the pause, not at a fixed timer.
  assert.ok(end.atMs > 2100 && end.atMs < 3100, `ended at ${end.atMs}`);
});

test('a pause for breath is not the end of the question', () => {
  const events = run([
    { ms: 400, db: -60 },
    { ms: 800, db: speech(-28) },
    { ms: 400, db: -60 }, // shorter than the hangover
    { ms: 800, db: speech(-28) },
    { ms: 1200, db: -60 },
  ]);
  assert.deepEqual(events.map((e) => e.type), ['speechStart', 'speechEnd']);
});

test('a click or a cough is not an utterance', () => {
  const events = run([
    { ms: 500, db: -60 },
    { ms: 60, db: -20 },
    { ms: 1500, db: -60 },
  ]);
  assert.equal(events.filter((e) => e.type === 'speechEnd').length, 0);
});

test('a steady noise that switches on is discarded, not transcribed', () => {
  // A fan, an engine: loud, and flat. It may trip the detector, but it never
  // becomes an utterance.
  const events = run([
    { ms: 500, db: -60 },
    { ms: 2000, db: -30 },
    { ms: 1200, db: -60 },
  ]);
  assert.equal(events.filter((e) => e.type === 'speechEnd').length, 0);
  assert.ok(events.some((e) => e.type === 'discarded' && e.reason === 'steadyNoise'));
});

test('a noisy room raises the floor, and speech above it still counts', () => {
  const events = run([
    { ms: 3000, db: -42 }, // the room settles at a noisier level
    { ms: 1500, db: speech(-22) },
    { ms: 1200, db: -42 },
  ]);
  assert.ok(events.some((e) => e.type === 'speechEnd'));
});

test('an utterance that never stops is ended at the maximum length', () => {
  const events = run([
    { ms: 400, db: -60 },
    { ms: 17_000, db: speech(-26) },
  ]);
  const end = events.find((e) => e.type === 'speechEnd') as Extract<VadEvent, { type: 'speechEnd' }> | undefined;
  assert.ok(end);
  assert.equal(end.forced, true);
});

test('while Chaatak speaks, a quiet leak does not interrupt it, a person talking over it does', () => {
  const leak = new VoiceActivity();
  leak.setBargeIn(true);
  // Its own voice leaking past echo cancellation: speech-shaped but quiet.
  const leaked = run([{ ms: 500, db: -60 }, { ms: 2000, db: speech(-50) }], leak);
  assert.equal(leaked.filter((e) => e.type === 'speechStart').length, 0);

  const person = new VoiceActivity();
  person.setBargeIn(true);
  const interrupted = run([{ ms: 500, db: -60 }, { ms: 1200, db: speech(-24) }], person);
  assert.equal(interrupted[0]?.type, 'speechStart');
});
