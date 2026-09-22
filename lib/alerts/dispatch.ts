/**
 * Turning poll decisions into messages on phones.
 *
 * Two properties this file exists to guarantee:
 *
 *   ONE DISPATCH PER (subscriber, dispatchKey). The claim is taken before any
 *   send and is atomic, so two runners firing together produce one message.
 *
 *   ONE SUBSCRIBER'S FAILURE NEVER STOPS THE BATCH. Every dispatch is isolated
 *   and settled independently. A dead push endpoint in the middle of a
 *   thousand must not cost the other nine hundred and ninety-nine their
 *   warning.
 */

import {
  BACKOFF_MS,
  MAX_ATTEMPTS_PER_RUN,
  MAX_ATTEMPTS_TOTAL,
  type ChannelSender,
  type DeliveryOutcome,
  sleep,
} from './channels/index';
import { telegramSender } from './channels/telegram';
import { webPushSender } from './channels/webpush';
import { renderAlert, type RenderedAlert } from './templates';
import type {
  AlertPayload,
  AlertStore,
  Channel,
  DispatchRecord,
  PollDecision,
  Subscriber,
} from './types';
import type { Severity } from '../weather/types';

/** How long a claim is held before another runner may assume its owner died. */
export const LEASE_MS = 120_000;

/** Concurrent sends. Enough to be quick, few enough not to exhaust the pooler. */
const CONCURRENCY = 10;

const SENDERS: ChannelSender[] = [webPushSender, telegramSender];

function senderFor(channel: Channel): ChannelSender | null {
  return SENDERS.find((s) => s.kind === channel.kind) ?? null;
}

function payloadFor(decision: PollDecision): AlertPayload {
  if (decision.kind === 'warning') {
    const w = decision.warning;
    return {
      kind: 'warning',
      district: w.district,
      warningId: w.id,
      code: w.code,
      severity: w.severity,
      validFrom: w.validFrom,
      validTo: w.validTo,
      provenance: w.provenance,
    };
  }
  return {
    kind: 'allClear',
    district: decision.district,
    warningId: decision.warningId,
    code: '',
    severity: decision.wasSeverity,
    validFrom: '',
    validTo: '',
    provenance: {
      source: 'Chaatak',
      endpoint: '/alerts',
      issuedAt: new Date().toISOString(),
      timeBasis: 'updated',
    },
  };
}

async function deliver(
  sender: ChannelSender,
  channel: Channel,
  alert: RenderedAlert,
): Promise<{ outcome: DeliveryOutcome; attempts: number }> {
  let last: DeliveryOutcome = { kind: 'failed', reason: 'not attempted' };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_RUN; attempt++) {
    last = await sender.send(channel, alert);
    if (last.kind !== 'retry') return { outcome: last, attempts: attempt };

    if (attempt < MAX_ATTEMPTS_PER_RUN) {
      // Honour an explicit retry_after over our own backoff: the service
      // telling us how long to wait knows better than we do.
      await sleep(last.afterMs ?? BACKOFF_MS[attempt - 1] ?? 3_000);
    }
  }
  return { outcome: last, attempts: MAX_ATTEMPTS_PER_RUN };
}

export type DispatchSummary = {
  considered: number;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  channelsRemoved: number;
};

/**
 * @param decisions what this poll decided, before dedup
 * @param subscribers everyone subscribed to the districts involved
 */
export async function dispatchAll(
  store: AlertStore,
  decisions: PollDecision[],
  subscribers: Subscriber[],
  now = () => new Date(),
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    considered: 0,
    claimed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    channelsRemoved: 0,
  };

  type Job = { subscriber: Subscriber; decision: PollDecision };
  const jobs: Job[] = [];

  for (const decision of decisions) {
    const district =
      decision.kind === 'warning' ? decision.warning.district : decision.district;
    for (const subscriber of subscribers) {
      if (subscriber.districts.includes(district)) jobs.push({ subscriber, decision });
    }
  }

  summary.considered = jobs.length;

  async function run({ subscriber, decision }: Job): Promise<void> {
    const { dispatchKey } = decision;

    // Atomic. Two runners reach here together; exactly one continues.
    const won = await store.claim(
      subscriber.id,
      dispatchKey,
      LEASE_MS,
      MAX_ATTEMPTS_TOTAL,
    );
    if (!won) {
      summary.skipped += 1;
      return;
    }
    summary.claimed += 1;

    const payload = payloadFor(decision);
    const alert = renderAlert(payload, subscriber.lang);

    let anySent = false;
    let lastError: string | undefined;

    for (const channel of subscriber.channels) {
      const sender = senderFor(channel);
      if (!sender || !sender.configured()) continue;

      const started = Date.now();
      const { outcome, attempts } = await deliver(sender, channel, alert);
      const latencyMs = Date.now() - started;

      const result: DispatchRecord['result'] =
        outcome.kind === 'sent'
          ? 'sent'
          : outcome.kind === 'gone'
            ? 'expired'
            : 'failed';

      if (outcome.kind === 'sent') anySent = true;
      if (outcome.kind !== 'sent') lastError = outcome.reason;

      // Dead for good: stop carrying it. Retrying a discarded subscription on
      // every poll for six hours is pure waste.
      if (outcome.kind === 'gone') {
        await store.removeChannel(subscriber.id, channel).catch(() => {});
        summary.channelsRemoved += 1;
      }

      await store
        .recordDispatch({
          subscriberId: subscriber.id,
          dispatchKey,
          warningId: payload.warningId,
          district: payload.district,
          severity: payload.severity as Severity,
          kind: payload.kind,
          channel: channel.kind,
          result,
          attempt: attempts,
          latencyMs,
          at: now().toISOString(),
          error: outcome.kind === 'sent' ? undefined : outcome.reason,
        })
        .catch(() => {});
    }

    if (anySent) {
      summary.sent += 1;
      await store.settleClaim(subscriber.id, dispatchKey, 'sent');
    } else {
      summary.failed += 1;
      // Left as 'failed' rather than deleted, so a later poll can re-claim it
      // while the warning is still valid — up to MAX_ATTEMPTS_TOTAL.
      await store.settleClaim(subscriber.id, dispatchKey, 'failed');
      if (lastError) {
        console.warn(
          JSON.stringify({
            event: 'dispatch.failed',
            subscriberId: subscriber.id,
            dispatchKey,
            error: lastError,
          }),
        );
      }
    }
  }

  // Isolated and bounded. allSettled because one thrown error must not take
  // the batch with it, and the cap keeps a large fanout from exhausting the
  // connection pooler.
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const slice = jobs.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(slice.map(run));
    for (const outcome of settled) {
      if (outcome.status === 'rejected') {
        summary.failed += 1;
        console.warn(
          JSON.stringify({ event: 'dispatch.threw', error: String(outcome.reason) }),
        );
      }
    }
  }

  return summary;
}
