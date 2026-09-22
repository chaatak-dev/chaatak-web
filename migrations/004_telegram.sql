-- Telegram: another client of the same backend.
--
-- Deliberately small. Telegram adds no weather logic, no place logic, no
-- alert engine and no preference system of its own — those are all reused.
-- What it genuinely needs that nothing else holds is three things:
--
--   telegram_chats        which chat is which account, and the conversation
--                         context a chat has no browser to keep
--   telegram_link_tokens  one-time, short-lived proof that a signed-in person
--                         asked to connect a Telegram
--   telegram_updates      Telegram's update ids, so a redelivered update is
--                         handled once
--
-- Alert delivery is NOT here. A linked chat reaches the daemon the way every
-- channel does: as {kind: 'telegram', chatId} in subscribers.channels, written
-- by the same store functions the web uses. This table is the source of truth
-- for whether that channel should exist; subscribers is the projection the
-- daemon reads, exactly as monitored_locations projects into districts.
--
-- Idempotent and additive, like every migration here. Reverse with
-- 004_telegram.down.sql.

/* ------------------------------------------------------------------ */
/* 1. Chats                                                            */
/*                                                                     */
/* chat_id is the private chat's id, which Telegram makes equal to the  */
/* user's own id. That equality is what a future Mini App would lean   */
/* on: its signed initData carries the user id, which finds this row.   */
/*                                                                     */
/* Only private chats are handled, so there is no row for a group.      */
/* ------------------------------------------------------------------ */

create table if not exists telegram_chats (
  chat_id      bigint primary key,
  -- The linked Chaatak account, or null for a guest. Never taken from
  -- anything the chat says; written only by consuming a link token that a
  -- signed-in session created.
  user_id      uuid,
  -- "@username" or a first name, so the web can say which Telegram is
  -- connected. Refreshed on every link.
  display_name text,
  -- Whether warnings for the linked account are delivered here. Linking
  -- turns it on, because connecting from a control that says so is the
  -- decision; /alerts can pause it without unlinking.
  alerts       boolean not null default true,
  -- A chat has no browser tab to keep a conversation in, so its standing
  -- place, its last few turns and any question waiting on a location live
  -- here. Bounded and expiring; never a store of weather values.
  context      jsonb not null default '{}'::jsonb,
  linked_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One Telegram per account. A unique index over a nullable column permits any
-- number of guest chats (nulls are distinct) and at most one linked one, and
-- a concurrent second link loses on the index rather than on a check that
-- happened to run first.
create unique index if not exists telegram_chats_user_key
  on telegram_chats (user_id);

/* ------------------------------------------------------------------ */
/* 2. Link tokens                                                      */
/*                                                                     */
/* Only a SHA-256 of the token is stored. The token itself exists in    */
/* the deep link and nowhere else, so reading this table does not yield */
/* a usable link.                                                       */
/*                                                                     */
/* A token is BOUND to the first chat that presents it (chat_id) and    */
/* CONSUMED when that chat confirms (used_at). Binding means a link that */
/* leaks after it was opened is useless to anyone else; consuming means  */
/* it works once.                                                       */
/* ------------------------------------------------------------------ */

create table if not exists telegram_link_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  chat_id     bigint,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists telegram_link_tokens_user_idx
  on telegram_link_tokens (user_id);

/* ------------------------------------------------------------------ */
/* 3. Update ids                                                       */
/*                                                                     */
/* Telegram redelivers an update it believes was not received. The      */
/* primary key makes handling one a single atomic insert: two            */
/* deliveries of the same update, one wins. Rows are pruned after a few  */
/* days; Telegram does not retry for anywhere near that long.            */
/* ------------------------------------------------------------------ */

create table if not exists telegram_updates (
  update_id   bigint primary key,
  received_at timestamptz not null default now()
);

create index if not exists telegram_updates_received_idx
  on telegram_updates (received_at);

/* ------------------------------------------------------------------ */
/* 4. Ownership, and the public API                                    */
/* ------------------------------------------------------------------ */

do $do$
begin
  if to_regclass('auth.users') is null then
    raise notice 'no auth.users: skipping telegram foreign keys';
    return;
  end if;

  -- Deleting an account unlinks its chat rather than deleting it: the chat is
  -- a conversation the person can keep having as a guest.
  if not exists (
    select 1 from pg_constraint where conname = 'telegram_chats_user_fkey'
  ) then
    alter table telegram_chats add constraint telegram_chats_user_fkey
      foreign key (user_id) references auth.users (id) on delete set null;
  end if;

  -- An outstanding link token dies with its account.
  if not exists (
    select 1 from pg_constraint where conname = 'telegram_link_tokens_user_fkey'
  ) then
    alter table telegram_link_tokens add constraint telegram_link_tokens_user_fkey
      foreign key (user_id) references auth.users (id) on delete cascade;
  end if;
end
$do$;

-- Server routes and the webhook reach these as `postgres`, which bypasses RLS.
-- Nothing in the browser has any business with them, so RLS is on with no
-- policy at all, and the verbs are revoked as well — the same treatment as the
-- alert tables, and for the same reason: the anon key is in every browser.
alter table telegram_chats       enable row level security;
alter table telegram_link_tokens enable row level security;
alter table telegram_updates     enable row level security;

do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on telegram_chats, telegram_link_tokens, telegram_updates from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on telegram_chats, telegram_link_tokens, telegram_updates
      from authenticated;
  end if;
end
$do$;
