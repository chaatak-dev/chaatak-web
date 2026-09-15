/**
 * Chat: turns, the context carried between them, and what grounds an answer.
 *
 * The shape that matters most here is `Grounding`. It is present only on a
 * turn that actually reported weather values, which is what keeps a citation
 * from being bolted onto "hello", and it carries the exact fact set the gate
 * verified that turn against.
 */

import type { Intent, TimeWindow, Variable } from '../parse/types';
import type { SpeechLang } from '../speech/types';
import type { Location, Provenance, Severity } from '../weather/types';

export type Role = 'user' | 'assistant';

/**
 * Everything the model was shown for one turn, as a plain object. The gate
 * walks this to build the set of numbers the reply is allowed to contain, so
 * it is deliberately the same object that goes into the prompt — if they could
 * drift apart, the gate would be verifying against the wrong thing.
 */
export type FactsSnapshot = Record<string, unknown>;

export type Grounding = {
  place: Location;
  provenance: Provenance;
  /** Drives the advice-vs-warning check. `unknown` when no warning product. */
  severity: Severity | 'unknown';
  facts: FactsSnapshot;
};

export type Message = {
  id: string;
  role: Role;
  text: string;
  /** The script this turn was written in. Mirrored back, never switched. */
  lang: SpeechLang;
  at: string;
  /** Only on turns that reported values. Absent on pure conversation. */
  grounding?: Grounding;
};

/**
 * The carry-over that makes a follow-up work: "परसों बाराबंकी में बारिश होगी?"
 * then "और अगले दिन?" inherits place and intent from here.
 *
 * `place` stays verbatim as the user said it, for the same reason it does
 * everywhere else — it is the only form the Devanagari geocoder can read.
 */
export type StandingQuery = {
  place: string | null;
  resolvedPlace: Location | null;
  intent: Intent;
  timeWindow: TimeWindow;
  variable: Variable;
  setAt: string;
};

/** A history entry as sent to the model: role and words, nothing else. */
export type ContextTurn = { role: Role; text: string };

export type ChatContext = {
  history: ContextTurn[];
  standing: StandingQuery | null;
  /**
   * The CURRENT turn's facts only. Facts from earlier turns are deliberately
   * never included: if they were, the model could quote this morning's reading
   * as the present temperature and pass verification, because the number
   * really was in the fact set. A re-fetch is the cost of not lying.
   */
  facts: FactsSnapshot | null;
};

/**
 * What kind of question this is.
 *
 * `inScope` false is the only case that declines, and the boundary is
 * generous — unsure resolves to in scope, because turning away a real
 * question is worse than answering a slightly off-topic one.
 *
 * `needsWeather` false covers questions that are in scope but need no fetch:
 * "what does orange alert mean", "where does your data come from", "नमस्ते".
 */
export type Scope = {
  inScope: boolean;
  needsWeather: boolean;
};
