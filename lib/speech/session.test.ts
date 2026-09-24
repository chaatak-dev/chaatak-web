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
  assert.deepEqual(effects[3], ['transcribe'], 'submitted when the person stopped, without a tap');
  assert.deepEqual(effects[4], ['bargeInOn', 'speak']);
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

test('barge-in: talking over Chaatak stops Chaatak, and the speech wins', () => {
  const t = transition({ kind: 'assistant_speaking' }, { type: 'SPEECH_START' });
  assert.deepEqual(t.state, { kind: 'speech_detected', bargedIn: true });
  assert.ok(t.effects.includes('cancelSpeech'));
});

test('Stop from anywhere live releases the microphone', () => {
  for (const kind of ['requesting_permission', 'listening', 'processing', 'assistant_speaking'] as const) {
    const t = transition({ kind } as VoiceState, { type: 'STOP' });
    assert.equal(t.state.kind, 'stopped', kind);
    assert.ok(t.effects.includes('closeMicrophone'), kind);
    assert.ok(t.effects.includes('cancelSpeech'), kind);
  }
  const speaking = transition({ kind: 'speech_detected', bargedIn: false }, { type: 'STOP' });
  assert.ok(speaking.effects.includes('closeMicrophone'));
});

test('a stopped session can start again', () => {
  const { states } = play([{ type: 'START' }, { type: 'PERMISSION_GRANTED' }, { type: 'STOP' }, { type: 'START' }]);
  assert.deepEqual(states, ['requesting_permission', 'listening', 'stopped', 'requesting_permission']);
});

test('permission refused is its own state, and the microphone is not left open', () => {
  const t = play([{ type: 'START' }, { type: 'PERMISSION_DENIED' }]);
  assert.deepEqual(t.state, { kind: 'error', error: 'denied' });
  assert.deepEqual(t.effects[1], ['closeMicrophone']);
  assert.equal(isActive(t.state), false);
});

test('no microphone API at all is "unsupported", not a failure', () => {
  assert.deepEqual(play([{ type: 'START' }, { type: 'UNSUPPORTED' }]).state, { kind: 'error', error: 'unsupported' });
});

test('noise returns to listening without a word; silence says it heard nothing', () => {
  assert.deepEqual(transition({ kind: 'speech_detected', bargedIn: false }, { type: 'DISCARDED' }).state, {
    kind: 'listening',
  });
  assert.deepEqual(transition({ kind: 'processing' }, { type: 'HEARD_NOTHING' }).state, {
    kind: 'listening',
    hint: 'notHeard',
  });
});

test('one turn at a time: speech while answering does not stack a second question', () => {
  const t = transition({ kind: 'processing' }, { type: 'SPEECH_START' });
  assert.deepEqual(t, { state: { kind: 'processing' }, effects: [] });
});

test('a failure stops listening rather than listening broken', () => {
  const t = transition({ kind: 'processing' }, { type: 'FAILED' });
  assert.deepEqual(t.state, { kind: 'error', error: 'failed' });
  assert.ok(t.effects.includes('closeMicrophone'));
});
