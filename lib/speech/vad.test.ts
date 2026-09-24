import { test } from 'node:test';
import assert from 'node:assert/strict';

import { frameDb, VoiceActivity, type VadEvent } from './vad';

/**
 * Synthetic audio at 16 kHz. Speech is modelled as what matters to an energy
 * detector: syllables — loud for a fifth of a second, then a dip — rising and
 * falling about four times a second. Noise is steady, or fluctuating, or
 * clicks.
 *
 * The detector was tuned on something better than this: real speech
 * (Bhashini TTS, Hindi and English) replayed at 48 kHz under fans, outdoor
 * noise, clicks and background voices. These tests hold the behaviours that
 * replay found broken, in a form that runs anywhere.
 */

const RATE = 16_000;

let seed = 7;
function random(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

/** A frame of noise at a given dBFS; -Infinity is dead air. */
function noise(db: number, samples: number): Float32Array {
  const frame = new Float32Array(samples);
  if (db === -Infinity) return frame;
  const amp = Math.pow(10, db / 20) * Math.sqrt(3);
  for (let i = 0; i < samples; i++) frame[i] = (random() * 2 - 1) * amp;
  return frame;
}

type Level = number | ((tMs: number) => number);
type Segment = { ms: number; db: Level };

/** Syllables: ~190 ms voiced at `base` ±3 dB, then a ~60 ms dip `dip` dB down. */
const speech =
  (base: number, dip = 20) =>
  (t: number) => {
    const phase = t % 250;
    return phase < 190 ? base + 3 * Math.sin((2 * Math.PI * phase) / 190) : base - dip;
  };

/** A noise that wanders ±6 dB around `base`, changing every ~700 ms. */
const fluctuating = (base: number) => (t: number) => base + 6 * Math.sin((2 * Math.PI * t) / 1400);

function run(segments: Segment[], vad = new VoiceActivity(), frameMs = 10) {
  const events: VadEvent[] = [];
  const samples = (RATE * frameMs) / 1000;
  let at = 0;
  for (const segment of segments) {
    for (let t = 0; t < segment.ms; t += frameMs) {
      at += frameMs;
      const db = typeof segment.db === 'number' ? segment.db : segment.db(t);
      events.push(...vad.push(noise(db, samples), frameMs, at));
    }
  }
  return { events, vad, at };
}

const types = (events: VadEvent[]) => events.map((e) => e.type);
const ends = (events: VadEvent[]) =>
  events.filter((e): e is Extract<VadEvent, { type: 'speechEnd' }> => e.type === 'speechEnd');

test('loudness is measured in dBFS', () => {
  assert.ok(Math.abs(frameDb(noise(-30, 320)) - -30) < 1.5);
  assert.equal(frameDb(new Float32Array(0)), -120);
});

test('a quiet room produces nothing', () => {
  assert.deepEqual(run([{ ms: 3000, db: -65 }]).events, []);
});

test('a spoken question starts, ends on its own, and is kept', () => {
  const { events } = run([
    { ms: 500, db: -62 },
    { ms: 1600, db: speech(-30) },
    { ms: 2000, db: -62 },
  ]);
  assert.deepEqual(types(events), ['speechStart', 'speechEnd']);
  const [end] = ends(events);
  assert.equal(end.forced, false);
  assert.equal(end.manual, false);
  // It ends after the pause, not at a fixed timer — about a second after the
  // last syllable, which is where it says the voice stopped.
  assert.ok(end.atMs > 2900 && end.atMs < 3500, `ended at ${end.atMs}`);
  assert.ok(Math.abs(end.lastVoicedMs - 2100) < 120, `last voiced at ${end.lastVoicedMs}`);
});

test('a pause for breath is not the end of the question', () => {
  const { events } = run([
    { ms: 400, db: -62 },
    { ms: 800, db: speech(-30) },
    { ms: 700, db: -62 },
    { ms: 800, db: speech(-30) },
    { ms: 2000, db: -62 },
  ]);
  assert.deepEqual(types(events), ['speechStart', 'speechEnd']);
});

test('"कल… लखनऊ में…" — a lone short word and a second of thought is still one question', () => {
  // The first version split this into three turns and threw the first away.
  const { events } = run([
    { ms: 500, db: -62 },
    { ms: 300, db: speech(-30) }, // कल
    { ms: 1100, db: -62 },
    { ms: 900, db: speech(-30) }, // लखनऊ में
    { ms: 900, db: -62 },
    { ms: 1200, db: speech(-30) }, // बारिश होगी क्या
    { ms: 2000, db: -62 },
  ]);
  assert.deepEqual(types(events), ['speechStart', 'speechEnd']);
  assert.ok(ends(events)[0].lastVoicedMs > 4800);
});

test('a soft, distant voice is kept — not discarded as steady noise', () => {
  // Only ~13 dB over the room. The first version measured how much the level
  // moved on loud frames alone, which cut the dips off quiet speech and
  // called what was left a fan.
  const { events } = run([
    { ms: 600, db: -64 },
    { ms: 1800, db: speech(-51, 12) },
    { ms: 2000, db: -64 },
  ]);
  assert.deepEqual(types(events), ['speechStart', 'speechEnd']);
});

test('a click or a cough is not an utterance', () => {
  const { events } = run([
    { ms: 500, db: -62 },
    { ms: 60, db: -20 },
    { ms: 2000, db: -62 },
  ]);
  assert.equal(ends(events).length, 0);
});

test('clicks after a question do not hold it open', () => {
  // Birds, a clink, a tap on the table. Any loud frame used to reset the
  // count of quiet, so the question did not end until the clicks did.
  const clicks: Segment[] = [];
  for (let i = 0; i < 12; i++) clicks.push({ ms: 50, db: -35 }, { ms: 250, db: -62 });
  const { events } = run([{ ms: 500, db: -62 }, { ms: 1500, db: speech(-30) }, ...clicks]);
  const [end] = ends(events);
  assert.ok(end, 'the question ended');
  assert.ok(end.atMs < 2000 + 1800, `ended at ${end.atMs}`);
});

test('a steady noise that switches on is discarded, and learnt as the room', () => {
  // A fan, an engine: loud, and flat. It may trip the detector, but it never
  // becomes an utterance — and it stops tripping it.
  const { events } = run([
    { ms: 500, db: -62 },
    { ms: 6000, db: -34 },
  ]);
  assert.equal(ends(events).length, 0);
  const last = events.at(-1);
  assert.ok(last && last.type === 'discarded', 'it was let go');
  assert.ok(last.atMs < 500 + 3500, `let go at ${last.atMs}`);
  // …and then someone speaks over the fan.
  const vad = new VoiceActivity();
  const again = run([{ ms: 500, db: -62 }, { ms: 5000, db: -34 }, { ms: 1500, db: speech(-18) }, { ms: 2000, db: -34 }], vad);
  assert.equal(ends(again.events).length, 1);
});

test('speech that runs into a fan switching on still ends', () => {
  const { events } = run([
    { ms: 500, db: -62 },
    { ms: 1500, db: speech(-28) },
    { ms: 4000, db: -40 },
  ]);
  const [end] = ends(events);
  assert.ok(end, 'the question ended');
  assert.ok(end.atMs < 2000 + 2500, `ended at ${end.atMs}`);
});

test('dead air while the stream starts does not poison the floor', () => {
  // A few frames of exact zeros, then a fan. Counting the zeros set the floor
  // at −200 dB; the fan then looked like speech that never stopped.
  const { events } = run([
    { ms: 150, db: -Infinity },
    { ms: 600, db: -46 },
    { ms: 1500, db: speech(-24) },
    { ms: 2000, db: -46 },
  ]);
  assert.deepEqual(types(events), ['speechStart', 'speechEnd']);
});

test('a fluctuating background does not start turns, and speech over it counts', () => {
  const quietOnly = run([{ ms: 8000, db: fluctuating(-46) }]);
  assert.equal(ends(quietOnly.events).length, 0);

  const { events } = run([
    { ms: 3000, db: fluctuating(-46) },
    { ms: 1500, db: speech(-26) },
    { ms: 2500, db: fluctuating(-46) },
  ]);
  assert.equal(ends(events).length, 1);
});

test('a noisy room raises the floor, and speech above it still counts', () => {
  const { events } = run([
    { ms: 3000, db: -42 },
    { ms: 1500, db: speech(-22) },
    { ms: 2000, db: -42 },
  ]);
  assert.ok(events.some((e) => e.type === 'speechEnd'));
});

test('an utterance that never stops is ended at the maximum length', () => {
  const { events } = run([
    { ms: 400, db: -62 },
    { ms: 17_000, db: speech(-26) },
  ]);
  const [end] = ends(events);
  assert.ok(end);
  assert.equal(end.forced, true);
});

test('a tap ends the utterance now, and keeps it', () => {
  const vad = new VoiceActivity();
  const { at } = run([{ ms: 500, db: -62 }, { ms: 700, db: speech(-30) }], vad);
  const end = vad.finish(at);
  assert.ok(end && end.type === 'speechEnd');
  assert.equal(end.manual, true);
  assert.equal(vad.inSpeech(), false);
  // Nothing to finish when nobody is speaking.
  assert.equal(vad.finish(at + 10), null);
});

test('the frame size does not change the decision', () => {
  const segments: Segment[] = [
    { ms: 500, db: -62 },
    { ms: 300, db: speech(-30) },
    { ms: 1000, db: -62 },
    { ms: 1200, db: speech(-30) },
    { ms: 2000, db: -62 },
  ];
  for (const frameMs of [10, 20]) {
    const { events } = run(segments, new VoiceActivity(), frameMs);
    assert.deepEqual(types(events), ['speechStart', 'speechEnd'], `${frameMs} ms frames`);
  }
});

test('reset forgets the utterance but keeps the room', () => {
  const vad = new VoiceActivity();
  run([{ ms: 3000, db: -42 }, { ms: 400, db: speech(-22) }], vad);
  assert.equal(vad.inSpeech(), true);
  vad.reset();
  assert.equal(vad.inSpeech(), false);
  // The floor it learnt is still the noisy room's, not the absolute minimum.
  assert.ok(vad.level().floorDb > -50, `floor ${vad.level().floorDb}`);
});
