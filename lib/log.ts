/**
 * One structured line per query.
 *
 * The point is to be able to state, with evidence, what percentage of traffic
 * never touched a model — which is the claim the pattern layer exists to make
 * true. Also carries the gate verdict, so a rejected render is visible rather
 * than silently swallowed by the template fallback.
 *
 * Server-side only. No user text is logged: the query itself can contain a
 * place someone lives, and there is no reason to keep it.
 */

import type { ParseLayer } from './parse/types';

export type QueryLog = {
  /** Which layer parsed it. */
  parseLayer: ParseLayer;
  /** Whether the parse cache served it. */
  cacheHit: boolean;
  /** Which model provider ran, if any. */
  provider?: string;
  /** Gate outcome for a rendered reply, if one was rendered. */
  gate?: 'passed' | 'rejected';
  gateReason?: string;
  /** Whether the reply that shipped was the template fallback. */
  fellBackToTemplate?: boolean;
  latencyMs: number;
  lang: string;
  outcome: 'answered' | 'noData' | 'cannotParse' | 'error';
  /** What the turn was: weather, social, language, about, outOfScope, unclear. */
  act?: string;
  /** What decided the answer's language: script, lexicon, context, explicit… */
  langBasis?: string;
};

const counters = {
  total: 0,
  servedWithoutModel: 0,
  cacheHits: 0,
  gateRejections: 0,
};

/**
 * Rejected renders, kept with the text that was rejected.
 *
 * This is the only way to tell an over-strict gate from a model actually
 * misbehaving. Without the text you can see that something was rejected but
 * never whether rejecting it was right — and that distinction is worth having
 * before a demo rather than after.
 *
 * In-process and bounded; it is a diagnostic, not an audit log.
 */
export type GateRejectionRecord = {
  at: string;
  reason: string;
  detail: string;
  /** What the model actually said. Never shipped to a user. */
  rejectedText: string;
  grounded: boolean;
  severity: string;
  lang: string;
};

const MAX_REJECTIONS = 100;
const rejections: GateRejectionRecord[] = [];

export function logGateRejection(record: Omit<GateRejectionRecord, 'at'>): void {
  const entry = { at: new Date().toISOString(), ...record };
  rejections.push(entry);
  if (rejections.length > MAX_REJECTIONS) rejections.shift();
  counters.gateRejections += 1;

  console.warn(JSON.stringify({ event: 'gate.rejected', ...entry }));
}

/** Newest first. */
export function gateRejections(): GateRejectionRecord[] {
  return [...rejections].reverse();
}

export function logQuery(record: QueryLog): void {
  counters.total += 1;
  if (record.parseLayer !== 'llm' && !record.provider) counters.servedWithoutModel += 1;
  if (record.cacheHit) counters.cacheHits += 1;
  if (record.gate === 'rejected') counters.gateRejections += 1;

  console.log(JSON.stringify({ at: new Date().toISOString(), ...record }));
}

/** Snapshot for the claim we need to be able to make. */
export function queryStats() {
  const { total, servedWithoutModel, cacheHits, gateRejections } = counters;
  return {
    total,
    servedWithoutModel,
    cacheHits,
    gateRejections,
    percentWithoutModel: total === 0 ? 0 : Math.round((servedWithoutModel / total) * 100),
  };
}
