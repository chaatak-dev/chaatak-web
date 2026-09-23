/**
 * How old a value is, and whether it may still be called current.
 *
 * WHY THIS EXISTS. Chaatak showed an IMD station observation from 12:00 under
 * a sentence beginning "अभी" — right now — at six in the evening. Every part
 * of that was individually true: IMD really did observe it, the timestamp
 * really was on the provenance line, and nothing was invented. It was still a
 * lie, because a value's age is part of its meaning and six hours is not now.
 *
 * So age is computed from the value's OWN meaningful time, never from when we
 * fetched it, and the answer is a state rather than a number: something is
 * live, or it is ageing, or it is stale and must not be called current.
 *
 * The thresholds differ by what kind of thing the value is, because their
 * cadences differ. A model evaluated hourly is not stale at 40 minutes; a
 * station observation taken every three hours is not stale at 40 minutes
 * either, but it stops being "now" much sooner than a daily bulletin does.
 */

import type { Provenance, ValueNature } from './types';

export type FreshnessState =
  /** Current enough to present as the conditions right now. */
  | 'live'
  /** Still useful, and its age is worth saying out loud. */
  | 'ageing'
  /** Too old to call current. Shown with its age, never as "now". */
  | 'stale';

export type Freshness = {
  state: FreshnessState;
  ageMinutes: number;
  /** The time the age was measured from — the value's, not the fetch's. */
  at: string;
};

/**
 * Minutes past which a value stops being "now", by kind.
 *
 * Open-Meteo's `current` block is re-evaluated about every fifteen minutes,
 * so an hour is generous and two hours means something is wrong upstream.
 * IMD's synoptic observations arrive every three hours, so one may legitimately
 * be ninety minutes old and still be the latest there is — but it is not
 * "now", and after four hours it is history.
 *
 * A bulletin is not a measurement: a warning issued this morning is in force
 * this evening, and its age says nothing about its validity. It is given a
 * long horizon so that it is never dressed up as stale, and its real
 * expiry — the validity window — is handled where warnings are.
 */
const THRESHOLDS: Record<ValueNature, { ageing: number; stale: number }> = {
  model: { ageing: 60, stale: 180 },
  observation: { ageing: 90, stale: 240 },
  bulletin: { ageing: 12 * 60, stale: 36 * 60 },
  /*
   * The past is never "now", whatever its age, so the two historical natures
   * are held to the strictest thresholds there are. Nothing should ask
   * whether a history is current — these exist so that if something does,
   * the answer is the safe one.
   */
  archivedForecast: { ageing: 60, stale: 180 },
  reanalysis: { ageing: 60, stale: 180 },
};

/** What a value with no declared nature is held to. The strictest of them. */
const DEFAULT_THRESHOLD = THRESHOLDS.model;

/**
 * The value's own meaningful time.
 *
 * `observedAt` when an instrument reported one, otherwise `issuedAt`.
 * `fetchedAt` is deliberately not a candidate: it is when we asked, and using
 * it here would make every value permanently one second old.
 */
export function meaningfulTime(provenance: Provenance): string {
  return provenance.observedAt ?? provenance.issuedAt;
}

export function freshness(provenance: Provenance, now = new Date()): Freshness {
  const at = meaningfulTime(provenance);
  const stamped = Date.parse(at);

  // An unparseable timestamp is not evidence of freshness. Treating it as
  // live would be the same failure this module exists to prevent.
  if (Number.isNaN(stamped)) return { state: 'stale', ageMinutes: Infinity, at };

  const ageMinutes = Math.max(0, Math.round((now.getTime() - stamped) / 60_000));
  const limits = provenance.nature ? THRESHOLDS[provenance.nature] : DEFAULT_THRESHOLD;

  const state: FreshnessState =
    ageMinutes >= limits.stale
      ? 'stale'
      : ageMinutes >= limits.ageing
        ? 'ageing'
        : 'live';

  return { state, ageMinutes, at };
}

/**
 * May this value be presented as the conditions right now?
 *
 * The one question the rest of the app asks. A false answer does not mean
 * hide the value — it means show it with its age and stop using the word
 * "now" about it.
 */
export function isCurrent(provenance: Provenance, now = new Date()): boolean {
  return freshness(provenance, now).state !== 'stale';
}
