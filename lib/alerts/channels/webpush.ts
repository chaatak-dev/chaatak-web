/**
 * Web Push (VAPID).
 *
 * The status codes matter more than usual here. 404 and 410 mean the browser
 * has thrown the subscription away — the endpoint is dead for good, and
 * retrying it on every poll for the rest of the warning's life is pure waste.
 * Everything else that fails is worth another go, because the alternative to
 * retrying is dropping a warning.
 */

import webpush from 'web-push';
import type { Channel } from '../types';
import type { RenderedAlert } from '../templates';
import type { ChannelSender, DeliveryOutcome } from './index';

let configured: boolean | null = null;

function ensureVapid(): boolean {
  if (configured !== null) return configured;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:alerts@chaatak.com';

  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export const webPushSender: ChannelSender = {
  kind: 'webpush',

  configured() {
    return ensureVapid();
  },

  async send(channel: Channel, alert: RenderedAlert): Promise<DeliveryOutcome> {
    if (channel.kind !== 'webpush') {
      return { kind: 'failed', reason: 'wrong channel kind' };
    }
    if (!ensureVapid()) {
      return { kind: 'failed', reason: 'VAPID keys not configured' };
    }

    try {
      await webpush.sendNotification(
        {
          endpoint: channel.endpoint,
          keys: { p256dh: channel.p256dh, auth: channel.auth },
        },
        JSON.stringify({ title: alert.title, body: alert.body }),
        // A warning outlives a few minutes of the phone being offline.
        { TTL: 3600, urgency: 'high' },
      );
      return { kind: 'sent' };
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;

      // The browser dropped this subscription. It will never work again.
      if (status === 404 || status === 410) {
        return { kind: 'gone', reason: `HTTP ${status}` };
      }
      if (status === 429 || (status !== undefined && status >= 500)) {
        return { kind: 'retry', reason: `HTTP ${status}` };
      }
      if (status !== undefined) {
        return { kind: 'failed', reason: `HTTP ${status}` };
      }
      // No status at all: a network problem, which is transient by nature.
      return {
        kind: 'retry',
        reason: error instanceof Error ? error.message.slice(0, 120) : 'network',
      };
    }
  },
};
