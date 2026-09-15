/**
 * Delivery channels, and what each failure means.
 *
 * The retry policy is explicit and lives here rather than being implied by
 * try/catch placement. Two kinds of failure matter and must not be confused:
 * a channel that is permanently dead (retrying it forever is pointless and
 * costs the batch) and one that is momentarily unavailable (giving up on it
 * drops a warning).
 */

import type { Channel } from '../types';
import type { RenderedAlert } from '../templates';

export type DeliveryOutcome =
  | { kind: 'sent' }
  /** Worth another attempt. */
  | { kind: 'retry'; reason: string; afterMs?: number }
  /** This channel will never work again; remove it. */
  | { kind: 'gone'; reason: string }
  /** Reached it, it refused, and retrying will not help. */
  | { kind: 'failed'; reason: string };

export interface ChannelSender {
  kind: Channel['kind'];
  configured(): boolean;
  send(channel: Channel, alert: RenderedAlert): Promise<DeliveryOutcome>;
}

/** Backoff between attempts within one invocation. */
export const BACKOFF_MS = [200, 1_000, 3_000];

/** Attempts inside a single invocation, before the claim is settled. */
export const MAX_ATTEMPTS_PER_RUN = 3;

/**
 * Attempts across all invocations. The claim carries the count, so a warning
 * that keeps failing is retried on later polls while it is still valid, and
 * then given up on rather than retried forever.
 */
export const MAX_ATTEMPTS_TOTAL = 5;

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
