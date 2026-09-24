import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isActive, transition, type VoiceEffect, type VoiceEvent, type VoiceState } from './session';

function play(events: VoiceEvent[], from: VoiceState = { kind: 'idle' }) {
  let state = from;
  const effects: VoiceEffect[][] = [];
  const states: string[] = [];
  for (const event of events) {
    const next = transition(state, event);
    state = next.state;
    effects.push(next.effects);
    states.push(state.kind);
  }
  return { state, effects, states };
}

test('a whole spoken turn: start, speak, stop talking, answer, speak back, listen again', () => {
  const { states, effects } = play([
    { type: 'START' },
    { type: 'PERMISSION_GRANTED' },
    { type: 'SPEECH_START' },
    { type: 'SPEECH_END' },
    { type: 'ANSWERED', speak: true },
    { type: 'SPEECH_DONE' },
  ]);
  assert.deepEqual(states, [
    'requesting_permission',
    'listening',
    'speech_detected',
    'processing',
    'assistant_speaking',
    'listening',
  ]);
  assert.deepEqual(effects[0], ['openMicrophone']);
  assert.deepEqual(effects[1], ['listen']);
  assert.deepEqual(effects[3], ['pauseMicrophone', 'transcribe'], 'submitted when the person stopped, without a tap');
  assert.deepEqual(effects[4], ['speak']);
  assert.deepEqual(effects[5], ['listen'], 'the microphone is taken again for the next turn');
});

test('the microphone is let go while the question is answered, and never open while Chaatak speaks', () => {
  const answering = transition({ kind: 'speech_detected' }, { type: 'SPEECH_END' });
  assert.ok(answering.effects.includes('pauseMicrophone'));
  // Nothing while answering or speaking opens it again: only `listen` does,
  // and only on the way back to listening.
  for (const kind of ['processing', 'assistant_speaking'] as const) {
    for (const event of [{ type: 'SPEECH_START' }, { type: 'SPEECH_END' }, { type: 'DISCARDED' }] as VoiceEvent[]) {
      const t = transition({ kind } as VoiceState, event);
      assert.equal(t.state.kind, kind, `${kind} ignores ${event.type}`);
      assert.deepEqual(t.effects, []);
    }
  }
});

test('a second spoken follow-up needs no tap either', () => {
  const { states } = play([
    { type: 'START' },
    { type: 'PERMISSION_GRANTED' },
    { type: 'SPEECH_START' },
    { type: 'SPEECH_END' },
    { type: 'ANSWERED', speak: true },
    { type: 'SPEECH_DONE' },
    { type: 'SPEECH_START' },
    { type: 'SPEECH_END' },
  ]);
  assert.equal(states.at(-1), 'processing');
});

test('a tap while being heard sends the question — and so can a result that skipped "heard"', () => {
  // The same SPEECH_END, whoever decided the turn was over.
  assert.equal(transition({ kind: 'speech_detected' }, { type: 'SPEECH_END' }).state.kind, 'processing');
  // The browser's recogniser can finish a turn it never reported starting.
  assert.equal(transition({ kind: 'listening' }, { type: 'SPEECH_END' }).state.kind, 'processing');
});

test('Stop from anywhere live releases the microphone', () => {
  for (const kind of ['requesting_permission', 'listening', 'speech_detected', 'processing', 'assistant_speaking'] as const) {
    const t = transition({ kind } as VoiceState, { type: 'STOP' });
    assert.equal(t.state.kind, 'stopped', kind);
    assert.ok(t.effects.includes('closeMicrophone'), kind);
    assert.ok(t.effects.includes('cancelSpeech'), kind);
  }
});

test('a stopped session can start again', () => {
  const { states } = play([{ type: 'START' }, { type: 'PERMISSION_GRANTED' }, { type: 'STOP' }, { type: 'START' }]);
  assert.deepEqual(states, ['requesting_permission', 'listening', 'stopped', 'requesting_permission']);
});

test('nobody speaking for a while ends the session and lets go of the microphone', () => {
  const t = transition({ kind: 'listening' }, { type: 'IDLE_TIMEOUT' });
  assert.deepEqual(t.state, { kind: 'stopped', reason: 'idle' });
  assert.deepEqual(t.effects, ['closeMicrophone']);
  assert.equal(isActive(t.state), false);
  // Someone mid-sentence is not idle.
  assert.equal(transition({ kind: 'speech_detected' }, { type: 'IDLE_TIMEOUT' }).state.kind, 'speech_detected');
});

test('permission refused is its own state, and the microphone is not left open', () => {
  const t = play([{ type: 'START' }, { type: 'PERMISSION_DENIED' }]);
  assert.deepEqual(t.state, { kind: 'error', error: 'denied' });
  assert.deepEqual(t.effects[1], ['closeMicrophone']);
  assert.equal(isActive(t.state), false);
  // The browser's recogniser asks only once it listens, so a refusal can
  // arrive while listening.
  assert.deepEqual(transition({ kind: 'listening' }, { type: 'PERMISSION_DENIED' }).state, { kind: 'error', error: 'denied' });
});

test('no microphone API at all is "unsupported", not a failure', () => {
  assert.deepEqual(play([{ type: 'START' }, { type: 'UNSUPPORTED' }]).state, { kind: 'error', error: 'unsupported' });
});

test('noise returns to listening without a word; silence says it heard nothing', () => {
  const noise = transition({ kind: 'speech_detected' }, { type: 'DISCARDED' });
  assert.deepEqual(noise.state, { kind: 'listening' });
  assert.deepEqual(noise.effects, ['listen']);

  const silence = transition({ kind: 'processing' }, { type: 'HEARD_NOTHING' });
  assert.deepEqual(silence.state, { kind: 'listening', hint: 'notHeard' });
  assert.deepEqual(silence.effects, ['listen']);
});

test('a recogniser that did not answer is said as such, and the session listens again', () => {
  const t = transition({ kind: 'processing' }, { type: 'TRANSCRIBE_FAILED' });
  assert.deepEqual(t.state, { kind: 'listening', hint: 'failed' });
  assert.deepEqual(t.effects, ['listen']);
  assert.equal(isActive(t.state), true);
});

test('one turn at a time: speech while answering does not stack a second question', () => {
  const t = transition({ kind: 'processing' }, { type: 'SPEECH_START' });
  assert.deepEqual(t, { state: { kind: 'processing' }, effects: [] });
});

test('an unrecoverable failure stops listening rather than listening broken', () => {
  for (const kind of ['listening', 'processing', 'assistant_speaking'] as const) {
    const t = transition({ kind } as VoiceState, { type: 'FAILED' });
    assert.deepEqual(t.state, { kind: 'error', error: 'failed' }, kind);
    assert.ok(t.effects.includes('closeMicrophone'), kind);
  }
});

test('an answer with nothing to say aloud goes straight back to listening', () => {
  const t = transition({ kind: 'processing' }, { type: 'ANSWERED', speak: false });
  assert.deepEqual(t.state, { kind: 'listening' });
  assert.deepEqual(t.effects, ['listen']);
});
