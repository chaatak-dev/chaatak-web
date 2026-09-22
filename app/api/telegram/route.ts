/**
 * /api/telegram — connecting this account's Telegram.
 *
 *   GET     whether Telegram is connected, as whom, and whether alerts go there
 *   POST    a one-time link that connects a Telegram to THIS account
 *   DELETE  disconnect it
 *
 * Every verb begins with a verified session. The account a link connects to
 * is the one that asked for the link, taken from `getUser()` — never from a
 * body, a query string or anything Telegram says. The link itself carries
 * nothing but 32 random bytes; see lib/telegram/link.ts.
 */

import { alertStatus, readProfile } from '@/lib/accounts/store';
import { guardRate, HttpError, withUser } from '@/lib/accounts/route';
import { translate } from '@/lib/i18n/strings';
import { botUsername, callTelegram, telegramConfigured } from '@/lib/telegram/api';
import { chromeLanguage } from '@/lib/telegram/language';
import { deepLink, hashLinkToken, LINK_TTL_MS, newLinkToken } from '@/lib/telegram/link';
import { postgresTelegramStore as store } from '@/lib/telegram/store';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return withUser(async (user) => {
    const available = telegramConfigured();
    const [chat, alerts] = await Promise.all([store.chatForUser(user.id), alertStatus(user.id)]);

    return {
      available,
      connected: Boolean(chat),
      displayName: chat?.displayName ?? null,
      alertsHere: chat?.alerts ?? false,
      alerts,
    };
  });
}

export async function POST(): Promise<Response> {
  return withUser(async (user) => {
    guardRate('telegram', user.id);

    if (!telegramConfigured()) {
      throw new HttpError(503, 'Telegram is not configured on this deployment.', {
        kind: 'configuration',
      });
    }

    const username = await botUsername();
    if (!username) {
      // The bot could not be reached to learn its own name. Said as what it
      // is, so a retry is the obvious next step.
      throw new HttpError(502, 'Telegram did not answer. Try again.');
    }

    const token = newLinkToken();
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    await store.createLinkToken(user.id, hashLinkToken(token), expiresAt);

    return {
      url: deepLink(username, token),
      expiresAt: expiresAt.toISOString(),
      minutes: Math.round(LINK_TTL_MS / 60_000),
    };
  });
}

export async function DELETE(): Promise<Response> {
  return withUser(async (user) => {
    guardRate('telegram', user.id);

    const chats = await store.unlinkUser(user.id);

    // The chat is told, so a disconnect nobody there made is not silent. In
    // the language the bot would have used with this account — the same chain
    // the bot resolves — and best effort: it never blocks the disconnect.
    if (chats.length > 0) {
      const profile = await readProfile(user.id).catch(() => null);
      const lang = chromeLanguage({
        assistant: profile?.languages.assistant ?? null,
        ui: profile?.languages.ui ?? null,
        lastTurn: null,
        telegram: null,
      });
      await Promise.all(
        chats.map((chatId) =>
          callTelegram('sendMessage', {
            chat_id: chatId,
            text: translate('tg.unlink.fromWeb', lang),
          }),
        ),
      );
    }

    console.log(JSON.stringify({ event: 'telegram.unlinked', from: 'web', chats: chats.length }));

    return {
      available: telegramConfigured(),
      connected: false,
      displayName: null,
      alertsHere: false,
      alerts: await alertStatus(user.id),
    };
  });
}
