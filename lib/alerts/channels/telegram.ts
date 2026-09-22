/**
 * Telegram Bot API, as an alert channel.
 *
 * The message is laid out by lib/telegram/render.ts from the alert
 * catalogue's parts — the same words the push notification carries, with the
 * severity first and "Official IMD warning" beside it, and two buttons: the
 * district's weather, and Chaatak itself.
 *
 * What each failure means is decided in lib/telegram/api.ts, shared with the
 * bot so there is one reading of Telegram's errors:
 *
 *   403, or 400 "chat not found"   the person blocked the bot or left — gone
 *   429                            flood control; its retry_after is honoured
 *   5xx, or nothing came back      worth another attempt
 *   any other 400                  our message is wrong — failed, NOT gone
 *
 * That last line is a fix. This sender used to treat every 400 as a dead
 * chat, so a message Telegram merely refused to parse would have removed the
 * channel and silenced every warning after it.
 */

import { callTelegram, chatIsGone, telegramConfigured, transient } from '../../telegram/api';
import { alertMessage } from '../../telegram/render';
import type { Channel } from '../types';
import type { RenderedAlert } from '../templates';
import type { ChannelSender, DeliveryOutcome } from './index';

export const telegramSender: ChannelSender = {
  kind: 'telegram',

  configured() {
    return telegramConfigured();
  },

  async send(channel: Channel, alert: RenderedAlert): Promise<DeliveryOutcome> {
    if (channel.kind !== 'telegram') {
      return { kind: 'failed', reason: 'wrong channel kind' };
    }

    const message = alertMessage(alert);

    // No retries here: the dispatcher owns the retry policy, and two stacked
    // policies multiply rather than add.
    const result = await callTelegram('sendMessage', {
      chat_id: channel.chatId,
      text: message.html,
      parse_mode: 'HTML',
      reply_markup: message.markup,
      link_preview_options: { is_disabled: true },
      disable_notification: message.silent === true,
    });

    if (result.ok) return { kind: 'sent' };

    if (chatIsGone(result)) return { kind: 'gone', reason: result.description };

    if (transient(result)) {
      return {
        kind: 'retry',
        reason: result.status === 429 ? 'rate limited' : result.description,
        // Telegram says exactly how long to wait; ignoring it makes things worse.
        ...(result.retryAfter !== undefined ? { afterMs: result.retryAfter * 1000 } : {}),
      };
    }

    return { kind: 'failed', reason: result.description };
  },
};
