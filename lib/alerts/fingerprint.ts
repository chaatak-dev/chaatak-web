/**
 * Telling a reissued warning from a restated one.
 *
 * This is the decision the whole alert phase turns on. Dedup on the warning id
 * alone and a yellow warning upgraded to red never reaches anyone. Dedup on
 * the whole payload and a six-hour warning polled every five minutes
 * dispatches eighty times. So the key is a hash of the MATERIAL fields only.
 *
 * MATERIAL — a change here is genuinely new information:
 *   severity, hazard code, district, validity window
 *
 * DELIBERATELY EXCLUDED:
 *   issuedAt — IMD restamps the bulletin on every issue. Including it would
 *              make every poll look like news. This is the trap, and it is the
 *              single most important line in this file.
 *   narrative — reworded constantly without the hazard changing
 *
 * ⚠ ASSUMPTION REQUIRING VERIFICATION. That IMD restamps issuedAt on
 * unchanged reissues, and that its validity windows are stated to the hour,
 * are assumptions about real bulletin behaviour taken from the API guidelines
 * rather than from observed traffic. When the IMD key lands, watch a real
 * warning across several polls before trusting this. If IMD instead holds
 * issuedAt steady and moves something else, the dedup is wrong in the
 * direction of silence, which is the dangerous direction.
 */

import { createHash } from 'node:crypto';
import type { Warning } from '../weather/types';

/**
 * Validity timestamps are compared to the hour.
 *
 * Full precision means second-level jitter in a restated bulletin reads as an
 * extension and re-fires the alert. Dropping validity entirely means a red
 * warning extended by four hours tells nobody. The hour is the granularity
 * IMD actually works in, so it is where the line goes.
 */
function toHour(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  at.setUTCMinutes(0, 0, 0);
  return at.toISOString();
}

/** Stable across calls, processes and cold starts. */
export function fingerprint(warning: Warning): string {
  const material = [
    warning.severity,
    warning.code,
    warning.district,
    toHour(warning.validFrom),
    toHour(warning.validTo),
  ].join('');

  return createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 16);
}

/** The idempotency key for a warning coming into force. */
export function dispatchKeyFor(warning: Warning): string {
  return `${warning.id}:${fingerprint(warning)}`;
}

/**
 * The idempotency key for a warning lifting.
 *
 * The fingerprint is included so that a warning which lifts, returns at a
 * different severity, and lifts again produces two all-clears rather than one.
 */
export function allClearKey(warningId: string, warningFingerprint: string): string {
  return `${warningId}:allclear:${warningFingerprint}`;
}
