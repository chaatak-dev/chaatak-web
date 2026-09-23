/**
 * Chat: turns, the context carried between them, and what grounds an answer.
 *
 * The shape that matters most here is `Grounding`. It is present only on a
 * turn that actually reported weather values, which is what keeps a citation
 * from being bolted onto "hello", and it carries the exact fact set the gate
 * verified that turn against.
 */

import type { TurnLanguage } from '../i18n/detect';
import type { ScriptCode } from '../i18n/languages';
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
  /** The language this turn was written in. Mirrored back, never switched. */
  lang: SpeechLang;
  /**
   * The script, where it is not the language's own: Hinglish is `hi` in
   * Latin. Drives the `lang` attribute (hi-Latn) and which voice reads it.
   * Absent means the language's own script.
   */
  script?: ScriptCode;
  at: string;
  /** Only on turns that reported values. Absent on pure conversation. */
  grounding?: Grounding;
  /**
   * Set when the place came from the device rather than from the question.
   *
   * An answer about somewhere nobody named has to say which somewhere, or it
   * is a forecast for an unstated place — which is the shape of every wrong
   * answer this product is arranged to avoid. Shown as "Using Ghaziabad".
   *
   * Not persisted: the conversation it belongs to stores the place in the
   * answer's own provenance, and the question that follows carries it as the
   * standing place.
   */
  via?: { name: string; district: string | null };
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

  /*
   * Everything below is optional, because this shape is stored — in the
   * browser between turns and in Postgres for a Telegram chat — and a record
   * written before these existed must still read.
   */

  /** The conversation's language so far, which a short reaction inherits. */
  lang?: Pick<TurnLanguage, 'code' | 'script'> | null;
  /**
   * A language the person asked for in words ("Hindi mein batao"). Holds like
   * an explicit setting until they ask for another, and only while the
   * assistant preference is on auto.
   */
  requestedLang?: Pick<TurnLanguage, 'code' | 'script'> | null;
  /**
   * A question that could not be answered for want of a place: what it asked,
   * so the place that arrives next completes it instead of starting over.
   */
  pending?: { intent: Intent; timeWindow: TimeWindow; variable: Variable } | null;
  /**
   * The last rain event reported at the standing place — the bound "and
   * before that?" searches behind. Belongs to that place and is dropped when
   * the place changes.
   */
  event?: { start: string } | null;
  /**
   * The loudest severity in force at the standing place when it was last
   * fetched. Only ever makes the gate stricter on a turn that fetched
   * nothing — a client that forged it could only make its own replies more
   * cautious.
   */
  severity?: Severity | 'unknown';
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
