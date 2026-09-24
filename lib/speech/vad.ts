/**
 * Voice activity detection: when someone starts talking, and when they stop.
 *
 * WHY NOT A TIMER. The microphone used to record until it was tapped again,
 * or for twenty seconds. A person asking the weather does not want to press
 * a button to say they have finished a sentence — they stop talking, and the
 * app should hear that they stopped. (They still can press it: see
 * `finish`, which is the same end reached by hand.)
 *
 * WHY NOT A MODEL. A neural detector (Silero through ONNX) is more robust in
 * a crowd, and costs several megabytes of runtime and weights before the
 * first word — on a cheap Android phone on a weak connection, which is who
 * this is for. The job here is narrower than general speech detection: one
 * person, close to the phone, taking turns with an app.
 *
 * WHAT THE FIRST VERSION GOT WRONG, measured by replaying real speech (Bhashini
 * TTS, 48 kHz, the browser's own framing) through it under room noise. It
 * handled 23% of trials. It:
 *   - threw soft or distant questions away as "steady noise", because it
 *     measured how much the loudness moved only on frames above its offset —
 *     which cuts the dips between syllables off quiet speech and leaves a
 *     flat-looking remainder
 *   - split "कल… लखनऊ में… बारिश होगी क्या" into three turns, the first
 *     discarded, at pauses under a second
 *   - never ended an utterance in the presence of birds, clinks or outdoor
 *     noise, because any single loud frame reset its count of quiet
 *   - let a few frames of dead air at the start poison its noise floor, and
 *     then climbed back from −200 dB at a crawl
 * The rules below each exist because of one of those. The same replay now
 * handles 85% — the rest are whisper-level voices and 8 dB SNR — and sends
 * no noise-only utterance to the recogniser in any of the rooms tried.
 *
 * HOW:
 *   - each frame's loudness in dBFS. Frames of dead air (a stream still
 *     starting) are not the room and are ignored.
 *   - a noise FLOOR that follows the room down quickly and up slowly, never
 *     below an absolute minimum, and frozen while someone speaks
 *   - the background's LOUD END too — the 90th percentile of recent
 *     non-speech frames. The floor alone sits in the dips of a fluctuating
 *     background, so background voices and gusts cleared a floor-relative bar
 *     and started turns, or held them open. Both thresholds sit above the
 *     loud end as well as above the floor.
 *   - speech starts after `minSpeechMs` of onset-level frames — counted
 *     leakily, so one quiet frame inside a syllable does not restart it
 *   - speech ends after `hangoverMs` of quiet. A loud frame does not reset
 *     that count on its own: only a SUSTAINED voiced run (`resumeMs`) says the
 *     person carried on. A lone short word waits longer (`fragmentHangoverMs`)
 *     — "कल…" is somebody thinking, not a finished question.
 *   - a steady noise inside an utterance (a fan switched on, an engine
 *     idling) is recognised by its flatness and re-learnt as the room
 *   - an utterance is kept only with enough voiced time, one syllable-length
 *     run in it, and loudness that moves across its whole body, dips included
 *   - an utterance running past `maxUtteranceMs` is ended regardless
 *
 * There is no barge-in mode any more. The session closes the microphone while
 * Chaatak speaks (see ./session.ts for why), so the detector never has to
 * tell its own voice from the person's.
 *
 * Pure: frames in, events out, no browser API. Every time constant is in
 * milliseconds, so the result does not depend on the frame size — the capture
 * feeds it ~10 ms frames, which also keeps a 75 ms click from smearing into
 * something the length of a syllable.
 */

export type VadConfig = {
  /** A frame this far above the floor may be speech. */
  onsetDb: number;
  /** A frame this far above the floor still counts as voiced (hysteresis). */
  offsetDb: number;
  /** A frame must also clear the background's loud end by this much to start a turn. */
  onsetOverBackgroundDb: number;
  /** Onset-level time needed, counted leakily, before an utterance starts. */
  minSpeechMs: number;
  /** A voiced run this long means the person carried on after a pause. */
  resumeMs: number;
  /** Quiet needed before an utterance ends. */
  hangoverMs: number;
  /** …and after a lone short word, which is usually someone mid-thought. */
  fragmentHangoverMs: number;
  /** Less voiced time than this is a lone short word. */
  fragmentMs: number;
  /** Voiced time an utterance needs to be kept rather than discarded. */
  minVoicedMs: number;
  /** One voiced run at least this long — a syllable, not a click. */
  minRunMs: number;
  /** An utterance is ended at this length whatever is happening. */
  maxUtteranceMs: number;
  /** Window over which a steady noise inside an utterance is recognised. */
  flatWindowMs: number;
  /** Loudness spread (p90 − p10) under which that window is steady noise. */
  flatSpreadDb: number;
  /** Loudness spread under which a whole utterance was noise, not speech. */
  minSpreadDb: number;
  /** Nothing quieter than this is ever speech, however quiet the room. */
  absoluteFloorDb: number;
  /** Quieter than this is dead air — a stream starting — not the room. */
  deadAirDb: number;
  /** The floor's first estimate comes from this much audio. */
  calibrationMs: number;
  /** How fast the floor follows the room down, and up. */
  floorFallMs: number;
  floorRiseMs: number;
  /** How much recent non-speech audio the background's loud end is read from. */
  backgroundMs: number;
};

export const DEFAULT_VAD: VadConfig = {
  onsetDb: 10,
  offsetDb: 6,
  onsetOverBackgroundDb: 4,
  minSpeechMs: 100,
  resumeMs: 100,
  hangoverMs: 1100,
  fragmentHangoverMs: 1500,
  fragmentMs: 450,
  minVoicedMs: 200,
  minRunMs: 120,
  maxUtteranceMs: 15_000,
  flatWindowMs: 1000,
  flatSpreadDb: 4,
  minSpreadDb: 3.5,
  absoluteFloorDb: -65,
  deadAirDb: -100,
  calibrationMs: 200,
  floorFallMs: 100,
  floorRiseMs: 1500,
  backgroundMs: 2500,
};

export type VadEvent =
  /** Someone started talking. `atMs` is when the run that started it began. */
  | { type: 'speechStart'; atMs: number }
  /** They stopped: an utterance worth transcribing. */
  | {
      type: 'speechEnd';
      atMs: number;
      startedMs: number;
      voicedMs: number;
      /** When the last voiced frame ended — the rest is trailing quiet. */
      lastVoicedMs: number;
      /** Ended at the maximum length rather than by a pause. */
      forced: boolean;
      /** Ended by the person pressing the button, not by the detector. */
      manual: boolean;
    }
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

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return -120;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

const ascending = (values: number[]) => values.sort((a, b) => a - b);

/** How far an exponential follower moves in `durationMs`, for time constant `tauMs`. */
const ease = (durationMs: number, tauMs: number) => 1 - Math.exp(-durationMs / tauMs);

type Frame = { db: number; ms: number; at: number; voiced: boolean };

export class VoiceActivity {
  private readonly config: VadConfig;

  // The room.
  private floor: number | null = null;
  private calibration: number[] = [];
  private calibratedMs = 0;
  private background: { db: number; ms: number }[] = [];
  private backgroundMs = 0;
  private backgroundLoud: number | null = null;

  // Waiting for speech.
  private run = 0;
  private runStart = 0;

  // In an utterance.
  private speaking = false;
  private started = 0;
  private voiced = 0;
  private voicedRun = 0;
  private longestRun = 0;
  private quiet = 0;
  private lastVoicedAt = 0;
  private frames: Frame[] = [];
  private recent: Frame[] = [];
  private recentMs = 0;

  private lastDb = -120;

  constructor(config: Partial<VadConfig> = {}) {
    this.config = { ...DEFAULT_VAD, ...config };
  }

  /** The latest frame's loudness and the floor it is judged against, for a meter. */
  level(): { db: number; floorDb: number } {
    return { db: this.lastDb, floorDb: this.floor ?? this.config.absoluteFloorDb };
  }

  /** True between speechStart and speechEnd / discarded. */
  inSpeech(): boolean {
    return this.speaking;
  }

  /**
   * Forget the current utterance without an event — used when the session
   * pauses. What it learnt about the room is kept: the room has not changed
   * because Chaatak answered a question.
   */
  reset(): void {
    this.speaking = false;
    this.run = 0;
    this.quiet = 0;
    this.voiced = 0;
    this.voicedRun = 0;
    this.longestRun = 0;
    this.frames = [];
    this.recent = [];
    this.recentMs = 0;
  }

  /**
   * The person pressed the button to say they have finished: end the
   * utterance now. Null when there is none. Kept even if short — they asked
   * for it to be sent, and the recogniser is the one to say it was nothing.
   */
  finish(atMs: number): VadEvent | null {
    if (!this.speaking) return null;
    return this.end(atMs, { forced: false, manual: true });
  }

  /**
   * One frame of audio.
   *
   * @param durationMs how long the frame lasts
   * @param atMs       when it ends, on any monotonic clock
   */
  push(frame: Float32Array, durationMs: number, atMs: number): VadEvent[] {
    const c = this.config;
    const db = frameDb(frame);
    this.lastDb = db;
    const dead = db < c.deadAirDb;

    // The first fifth of a second of real audio sets the floor. Dead air is
    // skipped rather than averaged in: it said nothing about the room, and
    // counting it once set the floor to −200 dB.
    if (this.floor === null) {
      if (!dead) {
        this.calibration.push(db);
        this.calibratedMs += durationMs;
      }
      if (this.calibratedMs < c.calibrationMs) return [];
      this.floor = Math.max(percentile(ascending(this.calibration), 0.2), c.absoluteFloorDb);
      this.calibration = [];
    }

    const floor = this.floor;
    const loud = this.backgroundLoud ?? floor;
    const onset = Math.max(floor + c.onsetDb, loud + c.onsetOverBackgroundDb);
    const offset = Math.max(floor + c.offsetDb, loud);

    if (!this.speaking) return this.waiting(db, dead, durationMs, atMs, { floor, onset });
    return this.speech(db, dead, durationMs, atMs, offset);
  }

  private waiting(
    db: number,
    dead: boolean,
    durationMs: number,
    atMs: number,
    { floor, onset }: { floor: number; onset: number },
  ): VadEvent[] {
    const c = this.config;

    if (!dead && db <= onset) {
      this.background.push({ db, ms: durationMs });
      this.backgroundMs += durationMs;
      while (this.background.length > 1 && this.backgroundMs - this.background[0].ms >= c.backgroundMs) {
        this.backgroundMs -= this.background.shift()!.ms;
      }
      if (this.backgroundMs >= 400) {
        this.backgroundLoud = percentile(ascending(this.background.map((b) => b.db)), 0.9);
      }

      // The floor follows the room: down fast (a noise stopped), up slowly (a
      // noise started). Frames loud enough to be speech never raise it — a
      // slow talker must not teach it that their voice is the room.
      const tau = db < floor ? c.floorFallMs : c.floorRiseMs;
      this.floor = Math.max(c.absoluteFloorDb, floor + (db - floor) * ease(durationMs, tau));
    }

    if (db <= onset) {
      // Leaky: one quiet frame inside a syllable does not restart the count.
      this.run = Math.max(0, this.run - durationMs * 2);
      return [];
    }

    if (this.run === 0) this.runStart = atMs - durationMs;
    this.run += durationMs;
    if (this.run < c.minSpeechMs) return [];

    this.speaking = true;
    this.started = this.runStart;
    this.voiced = this.run;
    this.voicedRun = this.run;
    this.longestRun = this.run;
    this.quiet = 0;
    this.lastVoicedAt = atMs;
    const first: Frame = { db, ms: durationMs, at: atMs, voiced: true };
    this.frames = [first];
    this.recent = [first];
    this.recentMs = durationMs;
    return [{ type: 'speechStart', atMs: this.runStart }];
  }

  private speech(db: number, dead: boolean, durationMs: number, atMs: number, offset: number): VadEvent[] {
    const c = this.config;
    const voiced = !dead && db > offset;
    const frame: Frame = { db, ms: durationMs, at: atMs, voiced };
    this.frames.push(frame);
    this.recent.push(frame);
    this.recentMs += durationMs;
    while (this.recent.length > 1 && this.recentMs - this.recent[0].ms >= c.flatWindowMs) {
      this.recentMs -= this.recent.shift()!.ms;
    }

    if (voiced) {
      this.voiced += durationMs;
      this.voicedRun += durationMs;
      this.longestRun = Math.max(this.longestRun, this.voicedRun);
      this.lastVoicedAt = atMs;
      // Only a sustained run says they carried on. A click is loud for one
      // frame or two, and letting it reset the count held utterances open
      // for as long as the birds kept singing.
      if (this.voicedRun >= c.resumeMs) this.quiet = 0;
    } else {
      this.voicedRun = 0;
      this.quiet += durationMs;
    }

    if (this.recentMs >= c.flatWindowMs) this.relearnSteadyNoise(atMs, offset);

    const hangover = this.voiced < c.fragmentMs ? c.fragmentHangoverMs : c.hangoverMs;
    const forced = atMs - this.started >= c.maxUtteranceMs;
    if (this.quiet >= hangover || forced) return [this.end(atMs, { forced, manual: false })];
    return [];
  }

  /**
   * A steady noise inside an utterance — a fan switched on, an engine idling.
   * Speech is never flat for a second: it rises and falls with its syllables
   * and stops between words. When the last second has been flat and loud, it
   * was the room that changed; the floor moves up to it, and the time that
   * noise was counted as voice stops counting.
   */
  private relearnSteadyNoise(atMs: number, offset: number): void {
    const c = this.config;
    const levels = ascending(this.recent.map((f) => f.db));
    const median = percentile(levels, 0.5);
    if (percentile(levels, 0.9) - percentile(levels, 0.1) >= c.flatSpreadDb || median <= offset) return;

    const windowStart = this.recent[0].at - this.recent[0].ms;
    let falseVoiced = 0;
    for (const f of this.recent) {
      if (f.voiced) falseVoiced += f.ms;
      f.voiced = false;
    }
    this.voiced = Math.max(0, this.voiced - falseVoiced);
    this.learnRoom(median);

    let lastReal: Frame | undefined;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].voiced) {
        lastReal = this.frames[i];
        break;
      }
    }
    this.lastVoicedAt = lastReal ? lastReal.at : windowStart;
    this.quiet = atMs - Math.max(this.lastVoicedAt, windowStart);
    this.voicedRun = 0;
    this.recent = [];
    this.recentMs = 0;
  }

  /** A noise has been recognised: it is the room now. */
  private learnRoom(levelDb: number): void {
    this.floor = Math.max(this.config.absoluteFloorDb, levelDb);
    this.backgroundLoud = levelDb + 1;
    this.background = [];
    this.backgroundMs = 0;
  }

  private end(atMs: number, how: { forced: boolean; manual: boolean }): VadEvent {
    const c = this.config;
    const { voiced, started, lastVoicedAt, longestRun } = this;

    // How much the loudness moved, over the utterance's body — from its start
    // to its last voiced frame, dips between syllables INCLUDED. Measuring
    // voiced frames only discarded soft speech as a fan; measuring the
    // trailing silence too would make a fan look like speech.
    let lastVoicedIndex = -1;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].voiced) {
        lastVoicedIndex = i;
        break;
      }
    }
    const body = ascending(this.frames.slice(0, lastVoicedIndex + 1).map((f) => f.db));
    const spread = percentile(body, 0.9) - percentile(body, 0.1);
    const median = percentile(body, 0.5);
    this.reset();

    if (how.manual && voiced > 0) {
      return { type: 'speechEnd', atMs, startedMs: started, voicedMs: voiced, lastVoicedMs: lastVoicedAt, forced: false, manual: true };
    }
    if (voiced < c.minVoicedMs || longestRun < c.minRunMs) return { type: 'discarded', atMs, reason: 'tooShort' };
    if (spread < c.minSpreadDb) {
      // It was the room. Learn it, so the same noise does not start again.
      this.learnRoom(median);
      return { type: 'discarded', atMs, reason: 'steadyNoise' };
    }
    return { type: 'speechEnd', atMs, startedMs: started, voicedMs: voiced, lastVoicedMs: lastVoicedAt, forced: how.forced, manual: false };
  }
}
