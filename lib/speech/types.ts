/**
 * Speech in and speech out, behind one interface.
 *
 * Bhashini is primary and Web Speech is the fallback, and the app must not
 * know which one it is talking to. The shapes here are chosen so a
 * record → upload → transcribe engine and an in-browser streaming one both
 * fit without the caller branching.
 */

import type { LanguageCode } from '../i18n/languages';

/**
 * Every language Chaatak can hear and speak. Seven, verified against the live
 * Bhashini pipeline.
 *
 * Distinct from InterfaceLang, which is the two the interface is actually
 * written in. Conflating them is how a Tamil speaker would end up shown a
 * machine-translated severity.
 */
export type SpeechLang = LanguageCode;

/** What the engine heard, or why it heard nothing. Never a guess. */
export type Recognition =
  | { kind: 'heard'; transcript: string; lang: SpeechLang }
  /** Silence, or speech the engine could not resolve to words. */
  | { kind: 'heardNothing' }
  /** Microphone permission refused. A normal state, not an error. */
  | { kind: 'denied' }
  | { kind: 'failed'; reason: string };

export type RecognitionSession = {
  /** Settles exactly once. */
  result: Promise<Recognition>;
  /** Stop capturing and settle with whatever was heard. */
  stop(): void;
  /** Abandon the attempt; settles as heardNothing. */
  cancel(): void;
};

/**
 * Segments carry their own language so a reply mixing Devanagari and a Latin
 * source name gets the right voice for each part instead of one engine
 * mispronouncing half the sentence.
 */
export type SpeechSegment = { text: string; lang: SpeechLang };
export type Utterance = SpeechSegment[];

export type Speaking = {
  done: Promise<void>;
  cancel(): void;
};

export type SpeechSupport = { recognise: boolean; speak: boolean };

export interface SpeechSource {
  name: string;
  /**
   * Checked before any mic UI renders, so an unsupported browser degrades to
   * the text input silently rather than showing a control that cannot work.
   */
  supports(): SpeechSupport;
  recognise(opts: {
    lang: SpeechLang;
    /**
     * Interim text, when the engine offers it. Batch engines never call it,
     * which is why it is optional rather than part of the contract.
     */
    onPartial?: (text: string) => void;
  }): RecognitionSession;
  speak(utterance: Utterance): Speaking;
}

/* The voice session's states live with its state machine, in ./session.ts. */
