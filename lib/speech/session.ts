/**
 * The voice session: a conversation held by talking, from Start to Stop.
 *
 *   idle ─start→ requesting_permission ─granted→ listening
 *   listening ─speech→ speech_detected ─silence→ processing
 *   processing ─answer→ assistant_speaking ─done→ listening
 *   assistant_speaking ─speech→ speech_detected        (barge-in: it stops)
 *   any ─stop→ stopped                                 (the mic is released)
 *
 * Nothing here touches a browser. Each transition returns the next state and
 * the EFFECTS the controller must carry out — open the mic, cancel speech,
 * transcribe — so the rules can be asserted rather than inferred from a UI.
 *
 * The rules that matter:
 *   - the microphone is open only inside a session the person started, and
 *     is released on Stop, on an error, and when the session ends
 *   - a person talking over Chaatak stops Chaatak: their speech wins
 *   - an utterance that was noise returns to listening without a word
 *   - one turn at a time: speech during `processing` is not a second
 *     question stacked behind the first
 */

export type VoiceState =
  | { kind: 'idle' }
  | { kind: 'requesting_permission' }
  | { kind: 'listening'; hint?: 'notHeard' }
  | { kind: 'speech_detected'; bargedIn: boolean }
  | { kind: 'processing' }
  | { kind: 'assistant_speaking' }
  | { kind: 'stopped' }
  | { kind: 'error'; error: VoiceError };

export type VoiceError =
  /** Permission refused — a normal choice, not a fault. */
  | 'denied'
  /** No microphone API at all in this browser. */
  | 'unsupported'
  /** No input device, or it could not be opened. */
  | 'noMicrophone'
  /** The recogniser or the network failed. */
  | 'failed';

export type VoiceEvent =
  | { type: 'START' }
  | { type: 'PERMISSION_GRANTED' }
  | { type: 'PERMISSION_DENIED' }
  | { type: 'UNSUPPORTED' }
  | { type: 'NO_MICROPHONE' }
  | { type: 'SPEECH_START' }
  /** An utterance ended: transcribe it. */
  | { type: 'SPEECH_END' }
  /** It was a cough, a click or a fan. */
  | { type: 'DISCARDED' }
  /** Transcribed to nothing. */
  | { type: 'HEARD_NOTHING' }
  /** Transcribed and answered; `speak` false when there is nothing to say aloud. */
  | { type: 'ANSWERED'; speak: boolean }
  | { type: 'SPEECH_DONE' }
  | { type: 'FAILED' }
  | { type: 'STOP' };

export type VoiceEffect =
  | 'openMicrophone'
  | 'closeMicrophone'
  /** Stop Chaatak's voice now: someone is talking over it. */
  | 'cancelSpeech'
  /** Raise the bar for speech while Chaatak's own voice may leak in. */
  | 'bargeInOn'
  | 'bargeInOff'
  | 'transcribe'
  | 'speak';

export type Transition = { state: VoiceState; effects: VoiceEffect[] };

const same = (state: VoiceState): Transition => ({ state, effects: [] });

/** The session is live: the microphone is open or about to be. */
export function isActive(state: VoiceState): boolean {
  return !['idle', 'stopped', 'error'].includes(state.kind);
}

export function transition(state: VoiceState, event: VoiceEvent): Transition {
  // Stop always wins, from anywhere live: the person said stop.
  if (event.type === 'STOP') {
    if (!isActive(state)) return same(state.kind === 'error' ? { kind: 'idle' } : state);
    return { state: { kind: 'stopped' }, effects: ['cancelSpeech', 'closeMicrophone'] };
  }

  switch (state.kind) {
    case 'idle':
    case 'stopped':
    case 'error':
      if (event.type === 'START') return { state: { kind: 'requesting_permission' }, effects: ['openMicrophone'] };
      return same(state);

    case 'requesting_permission':
      switch (event.type) {
        case 'PERMISSION_GRANTED':
          return same({ kind: 'listening' });
        case 'PERMISSION_DENIED':
          return { state: { kind: 'error', error: 'denied' }, effects: ['closeMicrophone'] };
        case 'UNSUPPORTED':
          return { state: { kind: 'error', error: 'unsupported' }, effects: ['closeMicrophone'] };
        case 'NO_MICROPHONE':
          return { state: { kind: 'error', error: 'noMicrophone' }, effects: ['closeMicrophone'] };
        default:
          return same(state);
      }

    case 'listening':
      if (event.type === 'SPEECH_START') return same({ kind: 'speech_detected', bargedIn: false });
      if (event.type === 'FAILED') return { state: { kind: 'error', error: 'failed' }, effects: ['closeMicrophone'] };
      return same(state);

    case 'speech_detected':
      switch (event.type) {
        case 'SPEECH_END':
          return { state: { kind: 'processing' }, effects: ['transcribe'] };
        case 'DISCARDED':
          // Noise. Back to listening without a word; nothing was asked.
          return same({ kind: 'listening' });
        case 'FAILED':
          return { state: { kind: 'error', error: 'failed' }, effects: ['closeMicrophone'] };
        default:
          return same(state);
      }

    case 'processing':
      switch (event.type) {
        case 'ANSWERED':
          return event.speak
            ? { state: { kind: 'assistant_speaking' }, effects: ['bargeInOn', 'speak'] }
            : same({ kind: 'listening' });
        case 'HEARD_NOTHING':
          return same({ kind: 'listening', hint: 'notHeard' });
        case 'FAILED':
          return { state: { kind: 'error', error: 'failed' }, effects: ['closeMicrophone'] };
        default:
          // One turn at a time: talking while the last question is being
          // answered does not start a second one.
          return same(state);
      }

    case 'assistant_speaking':
      switch (event.type) {
        case 'SPEECH_START':
          // Barge-in: the person talked over Chaatak. Their speech wins.
          return {
            state: { kind: 'speech_detected', bargedIn: true },
            effects: ['cancelSpeech', 'bargeInOff'],
          };
        case 'SPEECH_DONE':
          return { state: { kind: 'listening' }, effects: ['bargeInOff'] };
        case 'FAILED':
          return { state: { kind: 'error', error: 'failed' }, effects: ['cancelSpeech', 'closeMicrophone'] };
        default:
          return same(state);
      }
  }
}
