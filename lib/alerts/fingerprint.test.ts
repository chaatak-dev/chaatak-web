import { test } from 'node:test';
import assert from 'node:assert/strict';

import { allClearKey, dispatchKeyFor, fingerprint } from './fingerprint';
import type { DistrictId, Severity, Warning } from '../weather/types';

/**
 * The most important logic in this phase, and the part most likely to be
 * subtly wrong, so it is tested before anything touches a network.
 *
 * Two failure modes, in opposite directions:
 *   too sensitive — a six-hour warning polled every five minutes dispatches
 *                   eighty times
 *   too blunt     — a yellow warning upgraded to red never dispatches again,
 *                   and nobody is told it got worse
 */

function warning(over: Partial<Warning> = {}): Warning {
  return {
    kind: 'warning',
    id: 'IMD-UP-BBK-2026-0914',
    code: 'HR-3',
    severity: 'alert',
    district: 'barabanki' as DistrictId,
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

/* ------------------------------------------------------------------ */
/* What must NOT change the fingerprint                                */
/* ------------------------------------------------------------------ */

test('a restamped bulletin is the same warning', () => {
  /*
   * THE decision this phase turns on. IMD restamps issuedAt every time it
   * reissues, so a fingerprint that included it would make every poll look
   * like new information: eighty dispatches for one six-hour warning.
   *
   * ASSUMPTION, recorded here and in CLAUDE.md: that IMD restamps issuedAt on
   * unchanged reissues. Verify against real bulletins when the key lands.
   */
  const first = warning({ provenance: { ...warning().provenance, issuedAt: '2026-09-15T11:30:00+05:30' } });
  const restamped = warning({ provenance: { ...warning().provenance, issuedAt: '2026-09-15T14:45:00+05:30' } });

  assert.equal(fingerprint(restamped), fingerprint(first));
});

test('validity jitter inside the hour is not a reissue', () => {
  // Hour truncation absorbs a bulletin that restates 18:00 as 18:04.
  const a = warning({ validTo: '2026-09-15T18:00:00+05:30' });
  const b = warning({ validTo: '2026-09-15T18:04:37+05:30' });

  assert.equal(fingerprint(b), fingerprint(a));
});

test('field order does not matter', () => {
  const a = warning();
  const b: Warning = {
    validTo: a.validTo,
    severity: a.severity,
    district: a.district,
    code: a.code,
    validFrom: a.validFrom,
    id: a.id,
    kind: 'warning',
    provenance: a.provenance,
  };

  assert.equal(fingerprint(b), fingerprint(a));
});

/* ------------------------------------------------------------------ */
/* What MUST change it                                                 */
/* ------------------------------------------------------------------ */

test('an upgrade in severity is new information', () => {
  // The case that matters most. Yellow to red must reach the subscriber.
  const yellow = warning({ severity: 'watch' });
  const red = warning({ severity: 'warning' });

  assert.notEqual(fingerprint(red), fingerprint(yellow));
});

test('a downgrade is also new information', () => {
  // Knowing a red warning has become yellow is worth a message.
  assert.notEqual(
    fingerprint(warning({ severity: 'watch' })),
    fingerprint(warning({ severity: 'warning' })),
  );
});

test('a different hazard is a different warning', () => {
  assert.notEqual(fingerprint(warning({ code: 'TS-2' })), fingerprint(warning()));
});

test('an extended validity window is a reissue', () => {
  // A red warning pushed from 18:00 to 22:00 must be dispatched again.
  const extended = warning({ validTo: '2026-09-15T22:00:00+05:30' });

  assert.notEqual(fingerprint(extended), fingerprint(warning()));
});

test('the same warning in another district is a different warning', () => {
  assert.notEqual(
    fingerprint(warning({ district: 'sitapur' as DistrictId })),
    fingerprint(warning()),
  );
});

/* ------------------------------------------------------------------ */
/* Dispatch keys                                                       */
/* ------------------------------------------------------------------ */

test('the dispatch key carries both identity and content', () => {
  const key = dispatchKeyFor(warning());
  assert.ok(key.startsWith('IMD-UP-BBK-2026-0914:'));
  assert.equal(key, `${warning().id}:${fingerprint(warning())}`);
});

test('an all-clear has its own key and cannot collide with the warning', () => {
  const w = warning();
  const clear = allClearKey(w.id, fingerprint(w));

  assert.notEqual(clear, dispatchKeyFor(w));
  assert.ok(clear.includes('allclear'));
});

test('a severity change produces a different all-clear key', () => {
  // A warning that lifts, returns worse, and lifts again is two all-clears.
  const yellow = warning({ severity: 'watch' });
  const red = warning({ severity: 'warning' });

  assert.notEqual(
    allClearKey(red.id, fingerprint(red)),
    allClearKey(yellow.id, fingerprint(yellow)),
  );
});

/* ------------------------------------------------------------------ */
/* Stability                                                           */
/* ------------------------------------------------------------------ */

test('fingerprints are stable across calls and processes', () => {
  // Dedup spans invocations, so a hash that varied per process would dispatch
  // once per cold start.
  const once = fingerprint(warning());
  const twice = fingerprint(warning());

  assert.equal(once, twice);
  assert.match(once, /^[0-9a-f]{16}$/);
});

test('every severity produces a distinct fingerprint', () => {
  const severities: Severity[] = ['none', 'watch', 'alert', 'warning'];
  const seen = new Set(severities.map((s) => fingerprint(warning({ severity: s }))));

  assert.equal(seen.size, severities.length);
});
