/**
 * What one poll of one district decides, before anything is dispatched.
 *
 * Pure: no database, no network, no clock of its own. That is deliberate —
 * this is the logic most worth testing hard, and it is fully testable without
 * either.
 *
 * It does NOT know what has already been sent. Suppression is the claim's job,
 * because that is the only place it can be atomic across concurrent runners;
 * doing it here would make "run the job twice" work within one process and
 * quietly fail across two.
 */

import { allClearKey, dispatchKeyFor, fingerprint } from './fingerprint';
import type { PollDecision, SeenWarning } from './types';
import type { DistrictId, Warning } from '../weather/types';

export type PollOutcome = {
  decisions: PollDecision[];
  /** Current warnings, to be written back as the new seen-set. */
  toMark: SeenWarning[];
  /** Warning ids no longer in force, to drop from the seen-set. */
  toForget: string[];
  /** Ids that ended on their own, kept apart for the poll log. */
  expired: string[];
  /** Ids that vanished before their window closed. */
  withdrawn: string[];
};

function isOver(validTo: string, now: Date): boolean {
  const end = new Date(validTo).getTime();
  return Number.isFinite(end) && end <= now.getTime();
}

export function decidePoll(opts: {
  district: DistrictId;
  current: Warning[];
  seen: SeenWarning[];
  now: Date;
}): PollOutcome {
  const { district, current, seen, now } = opts;

  const decisions: PollDecision[] = [];
  const toMark: SeenWarning[] = [];
  const toForget: string[] = [];
  const expired: string[] = [];
  const withdrawn: string[] = [];

  const live = new Set<string>();

  for (const warning of current) {
    live.add(warning.id);

    const print = fingerprint(warning);
    toMark.push({
      district,
      warningId: warning.id,
      fingerprint: print,
      severity: warning.severity,
      validTo: warning.validTo,
      lastSeenAt: now.toISOString(),
    });

    // Telling someone about a window that already closed is noise.
    if (isOver(warning.validTo, now)) continue;

    decisions.push({
      kind: 'warning',
      warning,
      fingerprint: print,
      dispatchKey: dispatchKeyFor(warning),
    });
  }

  for (const previous of seen) {
    if (live.has(previous.warningId)) continue;

    // Gone from the feed. The distinction that matters: a window that simply
    // ran out was always going to, and an "all clear" for it is the kind of
    // noise that trains people to ignore us. A warning pulled BEFORE its
    // window closed is real information — it lifted early.
    toForget.push(previous.warningId);

    if (isOver(previous.validTo, now)) {
      expired.push(previous.warningId);
      continue;
    }

    withdrawn.push(previous.warningId);
    decisions.push({
      kind: 'allClear',
      district,
      warningId: previous.warningId,
      wasSeverity: previous.severity,
      dispatchKey: allClearKey(previous.warningId, previous.fingerprint),
    });
  }

  return { decisions, toMark, toForget, expired, withdrawn };
}
