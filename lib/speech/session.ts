/**
 * The voice session: a conversation held by talking, from Start to Stop.
 *
 *   idle ─start→ requesting_permission ─granted→ listening
 *   listening ─speech→ speech_detected ─silence, or a tap→ processing
 *   processing ─answer→ assistant_speaking ─done→ listening
 *   listening ─nothing said for a while→ stopped
 *   any ─stop→ stopped                                 (the mic is released)
 *
 * Nothing here touches a browser. Each transition returns the next state and
 * the EFFECTS the controller must carry out — open the mic, transcribe, speak
 * — so the rules can be asserted rather than inferred from a UI.
 *
 * TURN-TAKING, NOT BARGE-IN. The first version kept the microphone open while
 * Chaatak spoke, so a person could talk over it. Two things made that the
 * wrong trade for this product. On a phone, an open microphone moves playback
 * to the call path — quieter, and on some handsets out of the earpiece — so
 * the answer itself became hard to hear. And nothing had ever tested it
 * against a real speaker and a real room: its own voice, leaking past echo
 * cancellation, could interrupt it and be transcribed as the next question.
 * So the microphone is released while the question is answered and taken
 * again for the next turn. To cut an answer short, the button stops it.
 *
 * The rules that matter:
 *   - the microphone is open only while listening inside a session the person
 *     started, and is released on Stop, on an error, while answering, and
 *     when nobody has spoken for a while
 *   - the person can always end their own turn: a tap while they are being
 *     heard sends it now, whatever the detector thinks of the room
 *   - an utterance that was noise returns to listening without a word
 *   - a recogniser that failed once is not the end of the conversation
 *   - one turn at a time: nothing is heard while a question is answered
 */

export type VoiceState =
  | { kind: 'idle' }
  | { kind: 'requesting_permission' }
  /** `hint` says why it is listening again: heard nothing, or the recogniser failed. */
  | { kind: 'listening'; hint?: 'notHeard' | 'failed' }
  | { kind: 'speech_detected' }
  | { kind: 'processing' }
  | { kind: 'assistant_speaking' }
  /** `reason` is set when the session ended itself: nobody spoke for a while. */
  | { kind: 'stopped'; reason?: 'idle' }
  | { kind: 'error'; error: VoiceError };

export type VoiceError =
  /** Permission refused — a normal choice, not a fault. */
  | 'denied'
  /** No microphone API at all in this browser. */
  | 'unsupported'
  /** No input device, or it could not be opened. */
  | 'noMicrophone'
  /** The recogniser or the network failed, and kept failing. */
  | 'failed';

export type VoiceEvent =
  | { type: 'START' }
  | { type: 'PERMISSION_GRANTED' }
  | { type: 'PERMISSION_DENIED' }
  | { type: 'UNSUPPORTED' }
  | { type: 'NO_MICROPHONE' }
  | { type: 'SPEECH_START' }
  /** An utterance ended — by a pause, or by the person's tap: transcribe it. */
  | { type: 'SPEECH_END' }
  /** It was a cough, a click or a fan. */
  | { type: 'DISCARDED' }
  /** Transcribed to nothing. */
  | { type: 'HEARD_NOTHING' }
  /** The recogniser did not answer this time. Recoverable: listen again. */
  | { type: 'TRANSCRIBE_FAILED' }
  /** Transcribed and answered; `speak` false when there is nothing to say aloud. */
  | { type: 'ANSWERED'; speak: boolean }
  | { type: 'SPEECH_DONE' }
  /** Nobody has spoken for a while: end the session and let go of the mic. */
  | { type: 'IDLE_TIMEOUT' }
  /** Unrecoverable: the microphone went away, or recognition kept failing. */
  | { type: 'FAILED' }
  | { type: 'STOP' };

export type VoiceEffect =
  /** Ask for the microphone and open it: the start of a session. */
  | 'openMicrophone'
  /** Listen for the next turn — take the microphone again if it was let go. */
  | 'listen'
  /** Let go of the microphone while the question is answered. */
  | 'pauseMicrophone'
  /** The session is over: release everything. */
  | 'closeMicrophone'
  | 'cancelSpeech'
  | 'transcribe'
  | 'speak';

export type Transition = { state: VoiceState; effects: VoiceEffect[] };

const same = (state: VoiceState): Transition => ({ state, effects: [] });
const fail = (error: VoiceError, extra: VoiceEffect[] = []): Transition => ({
  state: { kind: 'error', error },
  effects: [...extra, 'closeMicrophone'],
});

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
          return { state: { kind: 'listening' }, effects: ['listen'] };
        case 'PERMISSION_DENIED':
          return fail('denied');
        case 'UNSUPPORTED':
          return fail('unsupported');
        case 'NO_MICROPHONE':
          return fail('noMicrophone');
        case 'FAILED':
          return fail('failed');
        default:
          return same(state);
      }

    case 'listening':
    case 'speech_detected':
      switch (event.type) {
        case 'SPEECH_START':
          return same({ kind: 'speech_detected' });
        case 'SPEECH_END':
          // Heard to the end — or the person said so with a tap. Either way
          // the microphone is let go until the answer has been given.
          return { state: { kind: 'processing' }, effects: ['pauseMicrophone', 'transcribe'] };
        case 'DISCARDED':
          // Noise. Back to listening without a word; nothing was asked.
          return { state: { kind: 'listening' }, effects: ['listen'] };
        case 'TRANSCRIBE_FAILED':
          return { state: { kind: 'listening', hint: 'failed' }, effects: ['listen'] };
        case 'IDLE_TIMEOUT':
          // Only while nobody is talking: a person mid-sentence is not idle.
          return state.kind === 'listening'
            ? { state: { kind: 'stopped', reason: 'idle' }, effects: ['closeMicrophone'] }
            : same(state);
        // The browser's own recogniser asks for the microphone only once it
        // starts listening, so a refusal can arrive here.
        case 'PERMISSION_DENIED':
          return fail('denied');
        case 'NO_MICROPHONE':
          return fail('noMicrophone');
        case 'FAILED':
          return fail('failed');
        default:
          return same(state);
      }

    case 'processing':
      switch (event.type) {
        case 'ANSWERED':
          return event.speak
            ? { state: { kind: 'assistant_speaking' }, effects: ['speak'] }
            : { state: { kind: 'listening' }, effects: ['listen'] };
        case 'HEARD_NOTHING':
          return { state: { kind: 'listening', hint: 'notHeard' }, effects: ['listen'] };
        case 'TRANSCRIBE_FAILED':
          return { state: { kind: 'listening', hint: 'failed' }, effects: ['listen'] };
        case 'FAILED':
          return fail('failed');
        default:
          // One turn at a time: nothing said now starts a second question.
          return same(state);
      }

    case 'assistant_speaking':
      switch (event.type) {
        case 'SPEECH_DONE':
          return { state: { kind: 'listening' }, effects: ['listen'] };
        case 'FAILED':
          return fail('failed', ['cancelSpeech']);
        default:
          return same(state);
      }
  }
}
