/**
 * Telegram Bot API.
 *
 * 403 means the user blocked the bot, which is a decision rather than a fault
 * — the chat is removed and never retried. 429 carries `retry_after` and is
 * honoured rather than guessed at, because guessing is how a bot gets its
 * rate limit tightened.
 */

import type { Channel } from '../types';
import type { RenderedAlert } from '../templates';
import type { ChannelSender, DeliveryOutcome } from './index';

const TIMEOUT_MS = 10_000;

export const telegramSender: ChannelSender = {
  kind: 'telegram',

  configured() {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN);
  },

  async send(channel: Channel, alert: RenderedAlert): Promise<DeliveryOutcome> {
    if (channel.kind !== 'telegram') {
      return { kind: 'failed', reason: 'wrong channel kind' };
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return { kind: 'failed', reason: 'TELEGRAM_BOT_TOKEN not set' };

    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: channel.chatId,
          text: `*${alert.title}*\n${alert.body}`,
          parse_mode: 'Markdown',
          disable_notification: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
    } catch (error) {
      return {
        kind: 'retry',
        reason: error instanceof Error ? error.name : 'network',
      };
    }

    if (res.ok) return { kind: 'sent' };

    let body: { description?: string; parameters?: { retry_after?: number } } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* the status alone is enough to decide */
    }

    // Blocked by the user, or the chat is gone. Not a fault to retry.
    if (res.status === 403 || res.status === 400) {
      return { kind: 'gone', reason: body.description ?? `HTTP ${res.status}` };
    }
    if (res.status === 429) {
      return {
        kind: 'retry',
        reason: 'rate limited',
        // Telegram says exactly how long to wait; ignoring it makes things worse.
        afterMs: (body.parameters?.retry_after ?? 1) * 1000,
      };
    }
    if (res.status >= 500) {
      return { kind: 'retry', reason: `HTTP ${res.status}` };
    }
    return { kind: 'failed', reason: body.description ?? `HTTP ${res.status}` };
  },
};
