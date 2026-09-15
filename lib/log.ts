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
};

const counters = {
  total: 0,
  servedWithoutModel: 0,
  cacheHits: 0,
  gateRejections: 0,
};

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
