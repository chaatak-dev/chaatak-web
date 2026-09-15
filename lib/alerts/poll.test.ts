import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fingerprint } from './fingerprint';
import { decidePoll } from './poll';
import type { SeenWarning } from './types';
import type { DistrictId, Severity, Warning } from '../weather/types';

const DISTRICT = 'barabanki' as DistrictId;
const NOW = new Date('2026-09-15T15:00:00+05:30');

function warning(over: Partial<Warning> = {}): Warning {
  return {
    kind: 'warning',
    id: 'W1',
    code: 'HR-3',
    severity: 'alert',
    district: DISTRICT,
    validFrom: '2026-09-15T12:00:00+05:30',
    validTo: '2026-09-15T18:00:00+05:30',
    provenance: {
      source: 'IMD',
      endpoint: '/warnings/district',
      issuedAt: '2026-09-15T11:30:00+05:30',
      timeBasis: 'issued',
    },
    ...over,
  };
}

function seen(w: Warning, over: Partial<SeenWarning> = {}): SeenWarning {
  return {
    district: w.district,
    warningId: w.id,
    fingerprint: fingerprint(w),
    severity: w.severity,
    validTo: w.validTo,
    lastSeenAt: '2026-09-15T14:55:00+05:30',
    ...over,
  };
}

const poll = (current: Warning[], previous: SeenWarning[], now = NOW) =>
  decidePoll({ district: DISTRICT, current, seen: previous, now });

/* ------------------------------------------------------------------ */
/* Warnings coming into force                                          */
/* ------------------------------------------------------------------ */

test('a warning not seen before is dispatched', () => {
  const { decisions } = poll([warning()], []);

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].kind, 'warning');
});

test('an unchanged warning still produces the same key, so dedup can catch it', () => {
  // Decision logic stays pure: it does not know what was sent. Suppression is
  // the claim's job, which is what makes "run it twice" work across runners
  // rather than only within one process.
  const w = warning();
  const first = poll([w], []);
  const second = poll([w], [seen(w)]);

  assert.equal(second.decisions.length, 1);
  assert.equal(second.decisions[0].dispatchKey, first.decisions[0].dispatchKey);
});

test('a severity upgrade produces a new key', () => {
  const yellow = warning({ severity: 'watch' });
  const red = warning({ severity: 'warning' });

  const { decisions } = poll([red], [seen(yellow)]);
  assert.equal(decisions.length, 1);
  assert.notEqual(decisions[0].dispatchKey, `W1:${fingerprint(yellow)}`);
});

test('a warning whose window has already closed is not dispatched', () => {
  // Being told about something that finished an hour ago is noise.
  const over = warning({ validTo: '2026-09-15T14:00:00+05:30' });

  assert.deepEqual(poll([over], []).decisions, []);
});

/* ------------------------------------------------------------------ */
/* Withdrawal versus expiry — the distinction that matters             */
/* ------------------------------------------------------------------ */

test('a warning that vanishes while still valid is an all-clear', () => {
  // Someone who got a red warning at 2pm wants to know at 6pm that it lifted.
  const w = warning({ validTo: '2026-09-15T18:00:00+05:30' });

  const { decisions } = poll([], [seen(w)]);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].kind, 'allClear');
  if (decisions[0].kind !== 'allClear') return;
  assert.equal(decisions[0].wasSeverity, 'alert');
});

test('a warning that simply ran out sends nothing', () => {
  // Expiry is expected. It is not news, and an "all clear" for something that
  // was always going to end at 2pm is noise that trains people to ignore us.
  const w = warning({ validTo: '2026-09-15T14:00:00+05:30' });

  assert.deepEqual(poll([], [seen(w)]).decisions, []);
});

test('an expiring warning is forgotten either way', () => {
  const lifted = warning({ validTo: '2026-09-15T18:00:00+05:30' });
  const elapsed = warning({ id: 'W2', validTo: '2026-09-15T14:00:00+05:30' });

  const { toForget } = poll([], [seen(lifted), seen(elapsed)]);
  assert.deepEqual([...toForget].sort(), ['W1', 'W2']);
});

test('a warning still present is neither withdrawn nor forgotten', () => {
  const w = warning();
  const { decisions, toForget } = poll([w], [seen(w)]);

  assert.equal(decisions.filter((d) => d.kind === 'allClear').length, 0);
  assert.deepEqual(toForget, []);
});

test('the first poll for a district raises no all-clears', () => {
  // Nothing was seen before, so nothing can have vanished.
  assert.deepEqual(poll([], []).decisions, []);
});

/* ------------------------------------------------------------------ */
/* Bookkeeping                                                         */
/* ------------------------------------------------------------------ */

test('current warnings are marked seen with their material state', () => {
  const w = warning();
  const { toMark } = poll([w], []);

  assert.equal(toMark.length, 1);
  assert.equal(toMark[0].warningId, 'W1');
  assert.equal(toMark[0].fingerprint, fingerprint(w));
  assert.equal(toMark[0].severity, 'alert');
});

test('several districts and severities do not interfere', () => {
  const a = warning({ id: 'A', severity: 'watch' as Severity });
  const b = warning({ id: 'B', severity: 'warning' as Severity });
  const gone = warning({ id: 'C', validTo: '2026-09-15T20:00:00+05:30' });

  const { decisions } = poll([a, b], [seen(gone)]);

  assert.equal(decisions.filter((d) => d.kind === 'warning').length, 2);
  assert.equal(decisions.filter((d) => d.kind === 'allClear').length, 1);
  assert.equal(new Set(decisions.map((d) => d.dispatchKey)).size, 3);
});
