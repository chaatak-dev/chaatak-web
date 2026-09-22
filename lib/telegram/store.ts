/**
 * What the Telegram bot keeps, and the bridge from it to the alert daemon.
 *
 * The same shape as the alert store: one interface, a Postgres implementation
 * that is the real one, and a memory implementation so the bot's behaviour can
 * be tested without a network in the loop. The SQL itself is exercised against
 * the real database by `npm run verify:accounts`.
 *
 * THE INVARIANTS:
 *
 *   A chat is linked to an account ONLY by consuming a link token, and a link
 *   token is created ONLY by a signed-in session. Nothing a chat says names an
 *   account.
 *
 *   A token is bound to the first chat that presents it and consumed when that
 *   chat confirms. It works once, from one chat, for ten minutes.
 *
 *   Which Telegram chats receive an account's alerts is decided here and
 *   PROJECTED into subscribers.channels by `syncChannels` — the same way
 *   monitored_locations projects into subscribers.districts. The daemon reads
 *   only the projection and is not modified.
 *
 * Transaction-pooler rule, as everywhere: each statement is self-contained.
 */

import { db, isPgError, PG_ERROR } from '../db/pool';
import { syncSubscriber } from '../accounts/store';
import type { Message, StandingQuery } from '../chat/types';
import type { Location } from '../weather/types';

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/**
 * The conversation a chat has no browser tab to keep.
 *
 * Bounded and expiring (see `boundContext` in the bot). Never a store of
 * weather values: `standing` names a place, `places` are resolved locations
 * that buttons refer back to, and neither carries a reading.
 */
export type ChatContext = {
  standing?: StandingQuery | null;
  history?: Message[];
  /** A question that is waiting for a place, and when it was asked. */
  pending?: { question: string; at: string } | null;
  /** Places recent messages offered buttons for, so a tap finds the same one. */
  places?: Location[];
  /** The last activity, so a stale conversation can be let go. */
  at?: string;
};

export type ChatRecord = {
  chatId: number;
  userId: string | null;
  displayName: string | null;
  alerts: boolean;
  context: ChatContext;
};

export type TokenBinding =
  | { ok: true; tokenId: string; userId: string }
  /** Unknown, expired, used, or already bound to a different chat. */
  | { ok: false };

export type LinkOutcome =
  | { ok: true; already: boolean; movedFrom: number[] }
  /** The chat belongs to a different account. */
  | { ok: false; reason: 'otherAccount' }
  /** Lost a race with a concurrent link of the same account. */
  | { ok: false; reason: 'conflict' };

export interface TelegramStore {
  name: string;

  /** True the first time an update id is seen; false for a redelivery. */
  claimUpdate(updateId: number): Promise<boolean>;

  readChat(chatId: number): Promise<ChatRecord | null>;
  writeContext(chatId: number, context: ChatContext): Promise<void>;
  chatForUser(userId: string): Promise<ChatRecord | null>;

  /** A new token for a signed-in account. Earlier ones stop working. */
  createLinkToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  bindLinkToken(tokenHash: string, chatId: number): Promise<TokenBinding>;
  /** Single use: the account the token was for, or null. */
  consumeLinkToken(tokenId: string, chatId: number): Promise<string | null>;
  /** Read-only: the account a bound, unused, unexpired token is for. */
  pendingLinkToken(tokenId: string, chatId: number): Promise<string | null>;
  cancelLinkToken(tokenId: string, chatId: number): Promise<void>;

  linkChat(chatId: number, userId: string, displayName: string | null): Promise<LinkOutcome>;
  /** Returns the account the chat was linked to, if any. */
  unlinkChat(chatId: number): Promise<string | null>;
  /** Returns the chats that were linked to this account. */
  unlinkUser(userId: string): Promise<number[]>;
  /** Returns the linked account, or null when the chat is not linked. */
  setAlerts(chatId: number, on: boolean): Promise<string | null>;

  /** Project this account's Telegram chats into the subscriber row. */
  syncChannels(userId: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Postgres                                                            */
/* ------------------------------------------------------------------ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ChatRow = {
  chat_id: string;
  user_id: string | null;
  display_name: string | null;
  alerts: boolean;
  context: unknown;
};

function toChat(row: ChatRow): ChatRecord {
  return {
    chatId: Number(row.chat_id),
    userId: row.user_id,
    displayName: row.display_name,
    alerts: row.alerts,
    context: (row.context && typeof row.context === 'object' ? row.context : {}) as ChatContext,
  };
}

export const postgresTelegramStore: TelegramStore = {
  name: 'postgres',

  async claimUpdate(updateId) {
    const { rows } = await db().query(
      `insert into telegram_updates (update_id) values ($1)
       on conflict (update_id) do nothing
       returning 1`,
      [updateId],
    );

    // Pruned now and then rather than on a schedule of its own. Telegram does
    // not redeliver for anywhere near three days, so nothing older can be a
    // duplicate of anything.
    if (updateId % 200 === 0) {
      void db()
        .query(`delete from telegram_updates where received_at < now() - interval '3 days'`)
        .catch(() => {});
    }

    return rows.length > 0;
  },

  async readChat(chatId) {
    const { rows } = await db().query(
      `select chat_id, user_id, display_name, alerts, context
         from telegram_chats where chat_id = $1`,
      [chatId],
    );
    return rows.length > 0 ? toChat(rows[0]) : null;
  },

  async writeContext(chatId, context) {
    await db().query(
      `insert into telegram_chats (chat_id, context) values ($1, $2::jsonb)
       on conflict (chat_id) do update
         set context = excluded.context, updated_at = now()`,
      [chatId, JSON.stringify(context)],
    );
  },

  async chatForUser(userId) {
    const { rows } = await db().query(
      `select chat_id, user_id, display_name, alerts, context
         from telegram_chats where user_id = $1`,
      [userId],
    );
    return rows.length > 0 ? toChat(rows[0]) : null;
  },

  async createLinkToken(userId, tokenHash, expiresAt) {
    // Only the newest link works. Pressing "Connect" twice leaves one live
    // token, not two, and nothing stale accumulates.
    await db().query(`delete from telegram_link_tokens where user_id = $1`, [userId]);
    await db().query(
      `insert into telegram_link_tokens (user_id, token_hash, expires_at)
       values ($1, $2, $3)`,
      [userId, tokenHash, expiresAt.toISOString()],
    );
  },

  async bindLinkToken(tokenHash, chatId) {
    // One statement: whichever chat presents the token first owns it. A
    // second chat presenting the same link finds nothing to bind.
    const { rows } = await db().query(
      `update telegram_link_tokens
          set chat_id = $2
        where token_hash = $1
          and used_at is null
          and expires_at > now()
          and (chat_id is null or chat_id = $2)
       returning id, user_id`,
      [tokenHash, chatId],
    );
    if (rows.length === 0) return { ok: false };
    return { ok: true, tokenId: rows[0].id, userId: rows[0].user_id };
  },

  async consumeLinkToken(tokenId, chatId) {
    if (!UUID.test(tokenId)) return null;
    const { rows } = await db().query(
      `update telegram_link_tokens
          set used_at = now()
        where id = $1
          and chat_id = $2
          and used_at is null
          and expires_at > now()
       returning user_id`,
      [tokenId, chatId],
    );
    return rows.length > 0 ? rows[0].user_id : null;
  },

  async pendingLinkToken(tokenId, chatId) {
    if (!UUID.test(tokenId)) return null;
    const { rows } = await db().query(
      `select user_id from telegram_link_tokens
        where id = $1 and chat_id = $2 and used_at is null and expires_at > now()`,
      [tokenId, chatId],
    );
    return rows.length > 0 ? rows[0].user_id : null;
  },

  async cancelLinkToken(tokenId, chatId) {
    if (!UUID.test(tokenId)) return;
    await db().query(
      `delete from telegram_link_tokens where id = $1 and chat_id = $2 and used_at is null`,
      [tokenId, chatId],
    );
  },

  async linkChat(chatId, userId, displayName) {
    try {
      // Any other chat this account was linked to lets go first, so the
      // unique index on user_id holds. The projection below then drops that
      // chat's alert channel without being told about it.
      const moved = await db().query(
        `update telegram_chats
            set user_id = null, linked_at = null, updated_at = now()
          where user_id = $1 and chat_id <> $2
         returning chat_id`,
        [userId, chatId],
      );

      // A chat already linked to a DIFFERENT account is left alone: the WHERE
      // on the conflict branch refuses to overwrite it, and no row comes
      // back. Nothing a chat can send switches it between accounts.
      const { rows } = await db().query(
        `insert into telegram_chats (chat_id, user_id, display_name, alerts, linked_at)
         values ($1, $2, $3, true, now())
         on conflict (chat_id) do update
           set user_id      = excluded.user_id,
               display_name = excluded.display_name,
               alerts       = case when telegram_chats.user_id = excluded.user_id
                                then telegram_chats.alerts else true end,
               linked_at    = coalesce(
                                case when telegram_chats.user_id = excluded.user_id
                                  then telegram_chats.linked_at end,
                                now()),
               updated_at   = now()
          where telegram_chats.user_id is null
             or telegram_chats.user_id = excluded.user_id
         returning (select t.user_id from telegram_chats t where t.chat_id = $1) as before`,
        [chatId, userId, displayName],
      );

      if (rows.length === 0) return { ok: false, reason: 'otherAccount' };

      await postgresTelegramStore.syncChannels(userId);

      return {
        ok: true,
        already: rows[0].before === userId,
        movedFrom: moved.rows.map((r) => Number(r.chat_id)),
      };
    } catch (error) {
      if (isPgError(error, PG_ERROR.uniqueViolation)) return { ok: false, reason: 'conflict' };
      throw error;
    }
  },

  async unlinkChat(chatId) {
    // The self-join reads the row as it was before the update, which is how
    // the previous owner comes back in the same statement.
    const { rows } = await db().query(
      `update telegram_chats t
          set user_id = null, linked_at = null, updated_at = now()
         from (select chat_id, user_id from telegram_chats where chat_id = $1) old
        where t.chat_id = old.chat_id and old.user_id is not null
       returning old.user_id`,
      [chatId],
    );
    const userId: string | null = rows[0]?.user_id ?? null;
    if (userId) await postgresTelegramStore.syncChannels(userId);
    return userId;
  },

  async unlinkUser(userId) {
    const { rows } = await db().query(
      `update telegram_chats
          set user_id = null, linked_at = null, updated_at = now()
        where user_id = $1
       returning chat_id`,
      [userId],
    );
    await postgresTelegramStore.syncChannels(userId);
    return rows.map((r) => Number(r.chat_id));
  },

  async setAlerts(chatId, on) {
    const { rows } = await db().query(
      `update telegram_chats set alerts = $2, updated_at = now()
        where chat_id = $1 and user_id is not null
       returning user_id`,
      [chatId, on],
    );
    const userId: string | null = rows[0]?.user_id ?? null;
    if (userId) await postgresTelegramStore.syncChannels(userId);
    return userId;
  },

  /**
   * The projection, in one statement.
   *
   * Every Telegram channel on the subscriber row is replaced by exactly the
   * set telegram_chats says should exist; web-push channels are untouched. A
   * subscriber row is created only when there is a channel to put in it —
   * an account that never switched anything on stays without one, as the
   * web path already guarantees.
   *
   * The id is bound twice ($1 text, $2 uuid) for the reason given at
   * syncSubscriber: one parameter cannot be deduced as both types.
   */
  async syncChannels(userId) {
    await db().query(
      `insert into subscribers (id, user_id, districts, lang, channels, created_at)
       select $1, $2::uuid, '{}'::text[],
              coalesce((select p.lang from profiles p where p.id = $2::uuid), 'hi'),
              wanted.channels, now()
         from (
           select coalesce(
                    jsonb_agg(jsonb_build_object('kind', 'telegram', 'chatId', c.chat_id::text)
                              order by c.chat_id),
                    '[]'::jsonb) as channels
             from telegram_chats c
            where c.user_id = $2::uuid and c.alerts
         ) wanted
        where jsonb_array_length(wanted.channels) > 0
           or exists (select 1 from subscribers s where s.id = $1)
       on conflict (id) do update
         set user_id  = excluded.user_id,
             channels = coalesce((
                          select jsonb_agg(c)
                            from jsonb_array_elements(subscribers.channels) c
                           where c->>'kind' is distinct from 'telegram'
                        ), '[]'::jsonb) || excluded.channels`,
      [userId, userId],
    );

    // Districts follow the channels: polled while someone can be told, not
    // polled once nobody can.
    await syncSubscriber(userId);
  },
};

/* ------------------------------------------------------------------ */
/* Memory, for tests                                                   */
/* ------------------------------------------------------------------ */

/**
 * The same semantics, in a Map. Single-process by construction, like the
 * alert memory store, and never selectable in production.
 *
 * `channels` stands in for the subscriber projection so a test can assert
 * which chats an account's alerts would reach.
 */
export function createMemoryTelegramStore(now: () => Date = () => new Date()) {
  const chats = new Map<number, ChatRecord>();
  const updates = new Set<number>();
  const tokens = new Map<
    string,
    {
      id: string;
      userId: string;
      hash: string;
      expiresAt: number;
      chatId: number | null;
      usedAt: number | null;
    }
  >();
  const channels = new Map<string, number[]>();
  let nextId = 1;

  const live = (t: { expiresAt: number; usedAt: number | null }) =>
    t.usedAt === null && t.expiresAt > now().getTime();

  const store: TelegramStore & {
    chats: typeof chats;
    tokens: typeof tokens;
    channels: typeof channels;
  } = {
    name: 'memory',
    chats,
    tokens,
    channels,

    async claimUpdate(updateId) {
      if (updates.has(updateId)) return false;
      updates.add(updateId);
      return true;
    },

    async readChat(chatId) {
      const chat = chats.get(chatId);
      return chat ? structuredClone(chat) : null;
    },

    async writeContext(chatId, context) {
      const chat = chats.get(chatId) ?? {
        chatId,
        userId: null,
        displayName: null,
        alerts: true,
        context: {},
      };
      chat.context = structuredClone(context);
      chats.set(chatId, chat);
    },

    async chatForUser(userId) {
      for (const chat of chats.values()) if (chat.userId === userId) return structuredClone(chat);
      return null;
    },

    async createLinkToken(userId, tokenHash, expiresAt) {
      for (const [id, token] of tokens) if (token.userId === userId) tokens.delete(id);
      const id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
      tokens.set(id, {
        id,
        userId,
        hash: tokenHash,
        expiresAt: expiresAt.getTime(),
        chatId: null,
        usedAt: null,
      });
    },

    async bindLinkToken(tokenHash, chatId) {
      for (const token of tokens.values()) {
        if (token.hash !== tokenHash) continue;
        if (!live(token)) return { ok: false };
        if (token.chatId !== null && token.chatId !== chatId) return { ok: false };
        token.chatId = chatId;
        return { ok: true, tokenId: token.id, userId: token.userId };
      }
      return { ok: false };
    },

    async consumeLinkToken(tokenId, chatId) {
      const token = tokens.get(tokenId);
      if (!token || token.chatId !== chatId || !live(token)) return null;
      token.usedAt = now().getTime();
      return token.userId;
    },

    async pendingLinkToken(tokenId, chatId) {
      const token = tokens.get(tokenId);
      if (!token || token.chatId !== chatId || !live(token)) return null;
      return token.userId;
    },

    async cancelLinkToken(tokenId, chatId) {
      const token = tokens.get(tokenId);
      if (token && token.chatId === chatId && token.usedAt === null) tokens.delete(tokenId);
    },

    async linkChat(chatId, userId, displayName) {
      const existing = chats.get(chatId);
      if (existing?.userId && existing.userId !== userId) {
        return { ok: false, reason: 'otherAccount' };
      }

      const movedFrom: number[] = [];
      for (const chat of chats.values()) {
        if (chat.userId === userId && chat.chatId !== chatId) {
          chat.userId = null;
          movedFrom.push(chat.chatId);
        }
      }

      const already = existing?.userId === userId;
      chats.set(chatId, {
        chatId,
        userId,
        displayName,
        alerts: already ? existing!.alerts : true,
        context: existing?.context ?? {},
      });
      await store.syncChannels(userId);
      return { ok: true, already, movedFrom };
    },

    async unlinkChat(chatId) {
      const chat = chats.get(chatId);
      if (!chat?.userId) return null;
      const userId = chat.userId;
      chat.userId = null;
      await store.syncChannels(userId);
      return userId;
    },

    async unlinkUser(userId) {
      const unlinked: number[] = [];
      for (const chat of chats.values()) {
        if (chat.userId === userId) {
          chat.userId = null;
          unlinked.push(chat.chatId);
        }
      }
      await store.syncChannels(userId);
      return unlinked;
    },

    async setAlerts(chatId, on) {
      const chat = chats.get(chatId);
      if (!chat?.userId) return null;
      chat.alerts = on;
      await store.syncChannels(chat.userId);
      return chat.userId;
    },

    async syncChannels(userId) {
      channels.set(
        userId,
        [...chats.values()]
          .filter((c) => c.userId === userId && c.alerts)
          .map((c) => c.chatId),
      );
    },
  };

  return store;
}
