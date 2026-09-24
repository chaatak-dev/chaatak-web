/**
 * Voice activity detection: when someone starts talking, and when they stop.
 *
 * WHY NOT A TIMER. The microphone used to record until it was tapped again,
 * or for twenty seconds. A person asking the weather does not want to press
 * a button to say they have finished a sentence — they stop talking, and the
 * app should hear that they stopped.
 *
 * WHY NOT A MODEL. A neural detector (Silero through ONNX) is more robust in
 * a crowd, and costs several megabytes of runtime and weights before the
 * first word — on a cheap Android phone on a weak connection, which is who
 * this is for. The job here is narrower than general speech detection: one
 * person, close to the phone, taking turns with an app. Energy against an
 * ADAPTIVE noise floor, with hysteresis and minimum durations, does that job,
 * and the browser's own noise suppression and echo cancellation (requested
 * on the stream) do much of the rest.
 *
 * HOW:
 *   - each frame's loudness in dBFS, against a noise floor that follows the
 *     room down quickly and up slowly, and is frozen while someone speaks
 *   - speech starts when a frame is `onsetDb` over the floor for `minSpeechMs`
 *     in a row (a door slam is not a sentence)
 *   - speech ends after `hangoverMs` under `offsetDb` over the floor (a pause
 *     for breath is not the end of a question)
 *   - an utterance with too little voiced time is discarded, and so is one
 *     whose loudness hardly moved: speech rises and falls with its syllables,
 *     a fan or an engine does not
 *   - an utterance running past `maxUtteranceMs` is ended regardless
 *
 * BARGE-IN MODE, while Chaatak is speaking: a higher bar and a longer run,
 * so the tail of its own voice leaking past echo cancellation does not
 * interrupt it, while a person talking over it still does.
 *
 * Pure: frames in, events out, no browser API. Tested with synthetic audio.
 */

export type VadConfig = {
  /** A frame this far above the floor may be speech. */
  onsetDb: number;
  /** A frame this far above the floor still counts as voiced (hysteresis). */
  offsetDb: number;
  /** Speech-level frames needed, in a row, before an utterance starts. */
  minSpeechMs: number;
  /** Quiet needed, in a row, before an utterance ends. */
  hangoverMs: number;
  /** Voiced time an utterance needs to be kept rather than discarded. */
  minVoicedMs: number;
  /** An utterance is ended at this length whatever is happening. */
  maxUtteranceMs: number;
  /**
   * Standard deviation of frame loudness, in dB, below which an "utterance"
   * is steady noise rather than speech.
   */
  minVariationDb: number;
  /** Nothing quieter than this is ever speech, however quiet the room. */
  absoluteFloorDb: number;
  /** Extra bar and extra run while Chaatak itself is speaking. */
  bargeInExtraDb: number;
  bargeInMinSpeechMs: number;
  /** The floor's first estimate comes from this much audio. */
  calibrationMs: number;
};

export const DEFAULT_VAD: VadConfig = {
  onsetDb: 12,
  offsetDb: 7,
  minSpeechMs: 120,
  hangoverMs: 850,
  minVoicedMs: 260,
  maxUtteranceMs: 15_000,
  minVariationDb: 2.5,
  absoluteFloorDb: -58,
  bargeInExtraDb: 8,
  bargeInMinSpeechMs: 240,
  calibrationMs: 250,
};

export type VadEvent =
  /** Someone started talking. `atMs` is when the run that started it began. */
  | { type: 'speechStart'; atMs: number }
  /** They stopped: an utterance worth transcribing. */
  | { type: 'speechEnd'; atMs: number; startedMs: number; voicedMs: number; forced: boolean }
  /** Sound that was not an utterance: too short, or too steady to be speech. */
  | { type: 'discarded'; atMs: number; reason: 'tooShort' | 'steadyNoise' };

/** Loudness of a frame, in dBFS. Silence is very negative, full scale is 0. */
export function frameDb(frame: Float32Array): number {
  if (frame.length === 0) return -120;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  const rms = Math.sqrt(sum / frame.length);
  return 20 * Math.log10(rms + 1e-10);
}

export class VoiceActivity {
  private readonly config: VadConfig;
  private floor: number | null = null;
  private calibration: number[] = [];
  private calibratedMs = 0;

  private speaking = false;
  private run = 0; // ms of consecutive onset-level frames while silent
  private runStart = 0;
  private quiet = 0; // ms of consecutive sub-offset frames while speaking
  private started = 0;
  private voiced = 0;
  private levels: number[] = [];
  private bargeIn = false;
  private lastDb = -120;

  constructor(config: Partial<VadConfig> = {}) {
    this.config = { ...DEFAULT_VAD, ...config };
  }

  /** While Chaatak speaks, a person has to talk over it clearly to interrupt. */
  setBargeIn(on: boolean): void {
    this.bargeIn = on;
  }

  /** The latest frame's loudness and the floor it is judged against, for a meter. */
  level(): { db: number; floorDb: number } {
    return { db: this.lastDb, floorDb: this.floor ?? this.config.absoluteFloorDb };
  }

  /** True between speechStart and speechEnd / discarded. */
  inSpeech(): boolean {
    return this.speaking;
  }

  /** Forget the current utterance without an event — used when a session pauses. */
  reset(): void {
    this.speaking = false;
    this.run = 0;
    this.quiet = 0;
    this.voiced = 0;
    this.levels = [];
  }

  /**
   * One frame of audio.
   *
   * @param durationMs how long the frame lasts
   * @param atMs       when it ends, on any monotonic clock
   */
  push(frame: Float32Array, durationMs: number, atMs: number): VadEvent[] {
    const db = frameDb(frame);
    this.lastDb = db;
    const c = this.config;

    // The first quarter second sets the floor: the room before anyone talks.
    if (this.floor === null) {
      this.calibration.push(db);
      this.calibratedMs += durationMs;
      if (this.calibratedMs < c.calibrationMs) return [];
      const sorted = [...this.calibration].sort((a, b) => a - b);
      this.floor = sorted[Math.floor(sorted.length * 0.3)];
      this.calibration = [];
    }

    const floor = Math.max(this.floor, c.absoluteFloorDb);
    const onset = floor + c.onsetDb + (this.bargeIn ? c.bargeInExtraDb : 0);
    const offset = floor + c.offsetDb;
    const needRun = this.bargeIn ? c.bargeInMinSpeechMs : c.minSpeechMs;
    const events: VadEvent[] = [];

    if (!this.speaking) {
      // The floor follows the room: down fast (a noise stopped), up slowly (a
      // noise started, or someone is warming up to speak).
      const rate = db < this.floor ? 0.25 : 0.01;
      this.floor += (db - this.floor) * rate;

      if (db > onset) {
        if (this.run === 0) this.runStart = atMs - durationMs;
        this.run += durationMs;
        if (this.run >= needRun) {
          this.speaking = true;
          this.started = this.runStart;
          this.voiced = this.run;
          this.quiet = 0;
          this.levels = [db];
          events.push({ type: 'speechStart', atMs: this.runStart });
        }
      } else {
        this.run = 0;
      }
      return events;
    }

    // Speaking. The floor is frozen: a sentence must not teach the detector
    // that speech is the new silence.
    if (db > offset) {
      this.voiced += durationMs;
      this.quiet = 0;
      // Only VOICED frames count toward how much the loudness moves. The
      // silence that ends an utterance is a big drop, and counting it made a
      // flat fan noise look like speech rising and falling.
      this.levels.push(db);
    } else {
      this.quiet += durationMs;
    }

    const length = atMs - this.started;
    const forced = length >= c.maxUtteranceMs;
    if (this.quiet >= c.hangoverMs || forced) {
      events.push(this.finish(atMs, forced));
    }
    return events;
  }

  private finish(atMs: number, forced: boolean): VadEvent {
    const c = this.config;
    const voiced = this.voiced;
    const started = this.started;
    const variation = standardDeviation(this.levels);
    this.reset();

    if (voiced < c.minVoicedMs) return { type: 'discarded', atMs, reason: 'tooShort' };
    if (variation < c.minVariationDb) return { type: 'discarded', atMs, reason: 'steadyNoise' };
    return { type: 'speechEnd', atMs, startedMs: started, voicedMs: voiced, forced };
  }
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
