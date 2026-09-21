/**
 * Every statement that touches an account's data.
 *
 * THE INVARIANT: no function here takes a user id from anywhere but a
 * validated session, and every statement carries `user_id = $1` in its WHERE
 * clause — including the ones that already look up a row by its own primary
 * key. A conversation id is a UUID and unguessable, but "unguessable" is not
 * an access control, and a route that forgot the scope would read as correct
 * right up until someone pasted an id.
 *
 * Row-level security says the same thing in the database, and is what stands
 * between two accounts on Supabase's public PostgREST endpoint. It does not
 * apply on this path: these queries run as `postgres`, which holds BYPASSRLS.
 * Two defences, neither relying on the other.
 */

import { db, isPgError, PG_ERROR } from '../db/pool';
import { normalise } from '../weather/gazetteer/normalise';
import type { Grounding } from '../chat/types';
import type { SpeechLang } from '../speech/types';
import type { DistrictId, Location } from '../weather/types';
import type { AuthUser } from '../auth/server';
import type {
  AddLocationResult,
  AlertStatus,
  Conversation,
  ConversationId,
  MonitoredLocation,
  Profile,
  StoredMessage,
} from './types';
import { MAX_MONITORED } from './types';

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

/**
 * Mirror the basics Google handed back.
 *
 * Runs on every sign-in rather than only on the first, so a changed display
 * name or a new avatar follows the account instead of freezing at whatever it
 * was the day it was created.
 */
export async function upsertProfile(
  user: AuthUser,
  lang?: string,
): Promise<void> {
  await db().query(
    `insert into profiles (id, email, name, avatar_url, lang)
     values ($1, $2, $3, coalesce($4, 'hi'), coalesce($5, 'hi'))
     on conflict (id) do update
       set email      = excluded.email,
           name       = excluded.name,
           avatar_url = excluded.avatar_url,
           lang       = coalesce($5, profiles.lang),
           updated_at = now()`,
    [user.id, user.email, user.name, user.avatarUrl, lang ?? null],
  );
}

export async function readProfile(userId: string): Promise<Profile | null> {
  const { rows } = await db().query(
    `select id, email, name, avatar_url, lang from profiles where id = $1`,
    [userId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    lang: row.lang,
  };
}

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

export async function listConversations(
  userId: string,
): Promise<Conversation[]> {
  const { rows } = await db().query(
    `select id, title, created_at, last_message_at
       from conversations
      where user_id = $1
      order by last_message_at desc
      limit 200`,
    [userId],
  );
  return rows.map(toConversation);
}

/**
 * Start a conversation.
 *
 * `guestKey` is how a transcript that began before sign-in is adopted exactly
 * once: it is unique per user, so a retried request finds the conversation it
 * already created rather than making a second copy of the same chat.
 */
export async function createConversation(
  userId: string,
  options: { title?: string | null; guestKey?: string | null } = {},
): Promise<Conversation> {
  const { rows } = await db().query(
    `insert into conversations (user_id, title, guest_key)
     values ($1, $2, $3)
     on conflict (user_id, guest_key) do update
       set title = coalesce(conversations.title, excluded.title)
     returning id, title, created_at, last_message_at`,
    [userId, options.title ?? null, options.guestKey ?? null],
  );
  return toConversation(rows[0]);
}

/**
 * One conversation's messages, oldest first.
 *
 * Ordered by `created_at` then `seq`, not by `seq` alone: an adopted guest
 * transcript keeps the times its turns actually happened, and those predate
 * the ids they were given on arrival.
 */
export async function conversationMessages(
  userId: string,
  conversationId: ConversationId,
): Promise<StoredMessage[] | null> {
  const { rows: owned } = await db().query(
    `select 1 from conversations where id = $1 and user_id = $2`,
    [conversationId, userId],
  );
  // Absent and not-yours are the same answer. Telling them apart would
  // confirm the existence of another account's conversation.
  if (owned.length === 0) return null;

  const { rows } = await db().query(
    `select id, role, text, lang, grounding, created_at
       from messages
      where conversation_id = $1 and user_id = $2
      order by created_at asc, seq asc`,
    [conversationId, userId],
  );

  return rows.map(toMessage);
}

export async function renameConversation(
  userId: string,
  conversationId: ConversationId,
  title: string,
): Promise<Conversation | null> {
  const { rows } = await db().query(
    `update conversations set title = $3
      where id = $1 and user_id = $2
      returning id, title, created_at, last_message_at`,
    [conversationId, userId, title],
  );
  return rows.length > 0 ? toConversation(rows[0]) : null;
}

export async function deleteConversation(
  userId: string,
  conversationId: ConversationId,
): Promise<boolean> {
  // Messages go with it: the composite foreign key cascades.
  const { rowCount } = await db().query(
    `delete from conversations where id = $1 and user_id = $2`,
    [conversationId, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteAllConversations(userId: string): Promise<number> {
  const { rowCount } = await db().query(
    `delete from conversations where user_id = $1`,
    [userId],
  );
  return rowCount ?? 0;
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export type TurnToStore = {
  /** The client's own id for this turn. Idempotency, not identity. */
  clientId: string;
  role: 'user' | 'assistant';
  text: string;
  lang: SpeechLang;
  at: string;
  grounding?: Grounding | null;
};

/**
 * Write one exchange, and touch the conversation it belongs to.
 *
 * `on conflict do nothing` on (conversation_id, client_id) is what makes a
 * retry safe. The client keeps the same client id when it resends, so a
 * request that timed out after the write still ends with one copy of the turn
 * rather than two — which is the difference between a flaky connection being
 * invisible and a conversation quietly doubling itself.
 */
export async function appendTurns(
  userId: string,
  conversationId: ConversationId,
  turns: TurnToStore[],
  title?: string | null,
): Promise<StoredMessage[]> {
  if (turns.length === 0) return [];

  const { rows } = await db().query(
    `insert into messages
       (conversation_id, user_id, role, text, lang, grounding, client_id, created_at)
     select $1, $2, t.role, t.text, t.lang, t.grounding, t.client_id, t.created_at
       from unnest($3::text[], $4::text[], $5::text[], $6::jsonb[], $7::text[], $8::timestamptz[])
         as t(role, text, lang, grounding, client_id, created_at)
     on conflict (conversation_id, client_id) do nothing
     returning id, role, text, lang, grounding, created_at`,
    [
      conversationId,
      userId,
      turns.map((t) => t.role),
      turns.map((t) => t.text),
      turns.map((t) => t.lang),
      turns.map((t) => (t.grounding ? JSON.stringify(t.grounding) : null)),
      turns.map((t) => t.clientId),
      turns.map((t) => t.at),
    ],
  );

  const latest = turns.reduce(
    (max, t) => (t.at > max ? t.at : max),
    turns[0].at,
  );

  /*
   * The title is written with coalesce, so it is set once and never
   * overwritten by a later turn. A conversation named after its opening
   * question is a label someone can recognise a week later; one renamed on
   * every message is a moving target.
   */
  await db().query(
    `update conversations
        set last_message_at = greatest(last_message_at, $3::timestamptz),
            title = coalesce(title, $4)
      where id = $1 and user_id = $2`,
    [conversationId, userId, latest, title ?? null],
  );

  return rows.map(toMessage);
}

/* ------------------------------------------------------------------ */
/* Monitored locations                                                 */
/* ------------------------------------------------------------------ */

/**
 * The duplicate key.
 *
 * A district, normalised — the same normaliser the gazetteer uses on both
 * sides of every lookup, so "Barabanki", "barabanki" and "Barabanki District"
 * are one place here exactly as they are one place there.
 */
export function districtKey(district: string): string {
  return normalise(district) || district.trim().toLowerCase();
}

export async function listLocations(
  userId: string,
): Promise<MonitoredLocation[]> {
  const { rows } = await db().query(
    `select id, slot, place_name, district, state, latitude, longitude,
            timezone, resolved_by, endpoint, created_at
       from monitored_locations
      where user_id = $1
      order by slot asc`,
    [userId],
  );
  return rows.map(toLocation);
}

/**
 * Take a slot, or say why not.
 *
 * The limit is not checked here. It is a unique constraint on (user_id, slot)
 * with slot restricted to 1..3, and the insert picks the lowest slot not
 * already taken — so two requests arriving together cannot both become the
 * third location. One of them loses the unique index and is told the account
 * is full, which is true by the time it reads it.
 *
 * Reading a count and comparing it to three would have looked identical and
 * been wrong in exactly the case worth getting right.
 */
export async function addLocation(
  userId: string,
  place: Location,
): Promise<AddLocationResult> {
  const district = (place.admin2 ?? place.name) as DistrictId;
  const key = districtKey(district);

  /*
   * Is this district already watched? Asked BEFORE the insert, and only so
   * that the refusal says the true thing.
   *
   * The insert takes the lowest free slot, so with three places saved it
   * inserts nothing and there is no unique violation to catch — which meant a
   * village inside a district already being watched was refused as "full",
   * advising someone to remove a place to make room for something that would
   * be refused again with room to spare.
   *
   * This read does not enforce anything and does not need to be atomic. The
   * constraint below is still what refuses a concurrent duplicate; this only
   * decides which sentence the person reads.
   */
  const existing = (await listLocations(userId)).find(
    (l) => districtKey(l.district) === key,
  );
  if (existing) return { ok: false, reason: 'duplicate', existing };

  try {
    const { rows } = await db().query(
      `insert into monitored_locations
         (user_id, slot, place_name, district, state, district_key,
          latitude, longitude, timezone, resolved_by, endpoint)
       select $1, free.slot, $2, $3, $4, $5, $6, $7, $8, $9, $10
         from (
           select generate_series(1, $11)::smallint as slot
           except
           select slot from monitored_locations where user_id = $1
         ) as free
        order by free.slot
        limit 1
       returning id, slot, place_name, district, state, latitude, longitude,
                 timezone, resolved_by, endpoint, created_at`,
      [
        userId,
        place.name,
        district,
        place.admin1 ?? null,
        key,
        place.latitude,
        place.longitude,
        place.timezone,
        place.resolvedBy,
        place.endpoint,
        MAX_MONITORED,
      ],
    );

    // No free slot: the sub-select returned nothing, so no row was inserted.
    if (rows.length === 0) return { ok: false, reason: 'full' };

    await syncSubscriber(userId);
    return { ok: true, location: toLocation(rows[0]) };
  } catch (error) {
    if (!isPgError(error, PG_ERROR.uniqueViolation)) throw error;

    const constraint = (error as { constraint?: string }).constraint;

    if (constraint === 'monitored_locations_district_key') {
      const existing = (await listLocations(userId)).find(
        (l) => districtKey(l.district) === key,
      );
      // The row is there by definition — the constraint just said so — but a
      // concurrent delete could remove it between the two statements.
      return existing
        ? { ok: false, reason: 'duplicate', existing }
        : { ok: false, reason: 'full' };
    }

    // Lost the race for the last slot. Full is the honest answer now.
    return { ok: false, reason: 'full' };
  }
}

export async function removeLocation(
  userId: string,
  id: string,
): Promise<boolean> {
  const { rowCount } = await db().query(
    `delete from monitored_locations where id = $1 and user_id = $2`,
    [id, userId],
  );
  if ((rowCount ?? 0) === 0) return false;

  await syncSubscriber(userId);
  return true;
}

/* ------------------------------------------------------------------ */
/* The bridge to the alert daemon                                      */
/* ------------------------------------------------------------------ */

/**
 * Project monitored locations into the `subscribers` row the daemon reads.
 *
 * The alert pipeline is not modified by any of this. It still polls the
 * districts in `subscribers.districts` and still dispatches to the channels in
 * `subscribers.channels`; an account simply uses its own user id as the
 * subscriber id, so one person is one subscriber however many devices they
 * have signed in on, and deduplication on (subscriberId, dispatchKey) keeps
 * meaning one alert per person per warning.
 *
 * TWO THINGS WORTH KNOWING:
 *
 * Districts are written only while a channel exists. A saved place with
 * notifications switched off is a place to look at, not a place to be woken
 * by — and writing its district anyway would have the daemon poll it, decide
 * a warning, claim a dispatch, find nothing to send, and burn an attempt out
 * of the retry budget of a warning nobody could receive.
 *
 * It is one statement, not a read followed by a write, so two requests
 * changing locations at once cannot interleave into a stale district list.
 */
export async function syncSubscriber(userId: string): Promise<void> {
  /*
   * The id is bound TWICE, as $1 and $2, for one reason: `subscribers.id` is
   * text and every account column is uuid, and a single parameter compared
   * against both makes Postgres deduce two types for it and refuse the
   * statement outright — "inconsistent types deduced for parameter $1".
   * Casting one use does not help; the parameter still has to be one type.
   */
  await db().query(
    `update subscribers s
        set user_id   = $2::uuid,
            districts = case
              when jsonb_array_length(s.channels) > 0 then coalesce((
                select array_agg(distinct m.district)
                  from monitored_locations m
                 where m.user_id = $2::uuid
              ), '{}'::text[])
              else '{}'::text[]
            end,
            lang      = coalesce(
              (select p.lang from profiles p where p.id = $2::uuid), s.lang
            )
      where s.id = $1`,
    [userId, userId],
  );
}

/**
 * Add a delivery channel, and start polling this account's districts.
 *
 * The subscriber row is created here rather than when a location is saved,
 * because this is the moment the account becomes reachable. `channels @>` is
 * what keeps a second registration of the same endpoint — a reload, a second
 * tab — from storing it twice and sending every warning twice.
 */
export async function addChannel(
  userId: string,
  channel: Record<string, unknown>,
  lang: string,
): Promise<void> {
  // $1 and $4 are the same id, bound twice: `subscribers.id` is text and
  // `subscribers.user_id` is uuid, and one parameter cannot be both.
  await db().query(
    `insert into subscribers (id, user_id, districts, lang, channels, created_at)
     values ($1, $4::uuid, '{}'::text[], $2, jsonb_build_array($3::jsonb), now())
     on conflict (id) do update
       set user_id  = excluded.user_id,
           lang     = excluded.lang,
           channels = case
             when subscribers.channels @> jsonb_build_array($3::jsonb)
               then subscribers.channels
               else subscribers.channels || jsonb_build_array($3::jsonb)
           end`,
    [userId, lang, JSON.stringify(channel), userId],
  );

  await syncSubscriber(userId);
}

/**
 * Drop one delivery channel — one device signing out of alerts, not the
 * account switching them off everywhere.
 *
 * Matches on the endpoint rather than on the whole object, because the keys
 * beside it are regenerated by the browser on every resubscribe while the
 * endpoint stays the device's identity.
 */
export async function removeWebPushChannel(
  userId: string,
  endpoint: string,
): Promise<void> {
  await db().query(
    `update subscribers
        set channels = coalesce((
              select jsonb_agg(c)
                from jsonb_array_elements(channels) c
               where c->>'endpoint' is distinct from $2
            ), '[]'::jsonb)
      where id = $1`,
    [userId, endpoint],
  );

  // Districts follow: with the last channel gone, there is nobody to tell.
  await syncSubscriber(userId);
}

export async function alertStatus(userId: string): Promise<AlertStatus> {
  const { rows } = await db().query(
    `select
       coalesce(count(*) filter (where c->>'kind' = 'webpush'), 0)::int as webpush,
       coalesce(count(*) filter (where c->>'kind' = 'telegram'), 0)::int as telegram
     from subscribers s
     left join lateral jsonb_array_elements(s.channels) c on true
     where s.id = $1`,
    [userId],
  );

  const webpush = rows[0]?.webpush ?? 0;
  const telegram = rows[0]?.telegram ?? 0;

  return {
    enabled: webpush + telegram > 0,
    channels: { webpush, telegram },
  };
}

/* ------------------------------------------------------------------ */
/* Deleting an account                                                 */
/* ------------------------------------------------------------------ */

/**
 * Remove the account and everything it owns.
 *
 * The auth user goes FIRST, and the cascades take profiles, conversations,
 * messages, monitored locations and the subscriber row with it. Doing it in
 * that order means a failure leaves the account intact rather than emptied —
 * a half-deleted account that can still sign in and finds nothing there is
 * worse than one that reports an error and is still whole.
 *
 * The explicit deletes that follow are not belt and braces for the cascade.
 * They cover the two tables that have no foreign key into accounts at all:
 * the dispatch claims and the dispatch log, both keyed by a subscriber id as
 * plain text. And they run on a database where the auth schema is absent, so
 * this function has an honest meaning off Supabase too.
 */
export async function deleteAccount(userId: string): Promise<void> {
  const pool = db();

  // auth.users may not exist (a plain Postgres). Then the explicit deletes
  // below are the whole story, and that is fine.
  try {
    await pool.query(`delete from auth.users where id = $1::uuid`, [userId]);
  } catch (error) {
    if (!isPgError(error, PG_ERROR.undefinedTable)) throw error;
  }

  await pool.query(`delete from messages where user_id = $1`, [userId]);
  await pool.query(`delete from conversations where user_id = $1`, [userId]);
  await pool.query(`delete from monitored_locations where user_id = $1`, [userId]);
  await pool.query(`delete from profiles where id = $1`, [userId]);
  await pool.query(`delete from subscribers where id = $1`, [userId]);
  // Keyed on the subscriber id as text, with no foreign key to follow.
  await pool.query(`delete from dispatch_claims where subscriber_id = $1`, [userId]);
  await pool.query(`delete from dispatch_log where subscriber_id = $1`, [userId]);
}

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

type ConversationRow = {
  id: string;
  title: string | null;
  created_at: Date;
  last_message_at: Date;
};

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id as ConversationId,
    title: row.title,
    createdAt: new Date(row.created_at).toISOString(),
    lastMessageAt: new Date(row.last_message_at).toISOString(),
  };
}

type MessageRow = {
  id: string;
  role: string;
  text: string;
  lang: string;
  grounding: unknown;
  created_at: Date;
};

function toMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    role: row.role === 'user' ? 'user' : 'assistant',
    text: row.text,
    lang: row.lang as SpeechLang,
    at: new Date(row.created_at).toISOString(),
    grounding: (row.grounding as Grounding | null) ?? undefined,
  };
}

type LocationRow = {
  id: string;
  slot: number;
  place_name: string;
  district: string;
  state: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
  resolved_by: string | null;
  endpoint: string | null;
  created_at: Date;
};

function toLocation(row: LocationRow): MonitoredLocation {
  return {
    id: row.id,
    slot: row.slot,
    placeName: row.place_name,
    district: row.district as DistrictId,
    state: row.state,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    timezone: row.timezone,
    resolvedBy: row.resolved_by,
    endpoint: row.endpoint,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
