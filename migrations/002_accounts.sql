-- Chaatak accounts: profiles, conversations, messages, monitored locations.
--
-- Identity comes from Supabase Auth. Every table here hangs off auth.users,
-- and every row carries the user it belongs to — never a client-supplied id.
--
-- Idempotent by construction, like 001: every statement is IF NOT EXISTS or
-- guarded by a catalogue lookup, so this is safe to run repeatedly, safe to
-- race, and safe to apply to the existing production database. It creates
-- nothing the alert pipeline depends on, so applying it cannot disturb a poll
-- in flight.
--
-- Reverse with 002_accounts.down.sql.

/* ------------------------------------------------------------------ */
/* 0. Close the existing tables to the public API                      */
/*                                                                     */
/* This is a fix, not housekeeping. A Supabase project exposes every    */
/* table in `public` through PostgREST, and the roles `anon` and        */
/* `authenticated` hold INSERT/SELECT/UPDATE/DELETE on everything       */
/* created there by default. Phase 4's tables were written before the   */
/* browser held any Supabase key at all, so nothing could reach that    */
/* surface. Google sign-in puts the anon key in the browser — and with  */
/* it, `subscribers` (which holds live Web Push endpoints and their     */
/* encryption keys) would be readable and writable by anyone who opened */
/* devtools.                                                            */
/*                                                                     */
/* RLS with no policy denies every role subject to it. The app connects */
/* as `postgres`, which has BYPASSRLS, so the alert daemon and every    */
/* server route are unaffected — verified, not assumed:                 */
/* `select rolbypassrls from pg_roles where rolname = current_user`.    */
/* ------------------------------------------------------------------ */

alter table subscribers     enable row level security;
alter table dispatch_claims enable row level security;
alter table seen_warnings   enable row level security;
alter table dispatch_log    enable row level security;

-- Belt as well as braces: RLS denies the rows, this denies the verbs. A
-- policy added in haste later cannot accidentally open a table the browser
-- has no business touching at all.
do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on subscribers, dispatch_claims, seen_warnings, dispatch_log
      from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on subscribers, dispatch_claims, seen_warnings, dispatch_log
      from authenticated;
  end if;
end
$do$;

/* ------------------------------------------------------------------ */
/* 1. Profiles                                                         */
/*                                                                     */
/* Only the basics Google hands back, mirrored so a conversation list   */
/* can show a name and an avatar without a round trip to the auth API.  */
/* No Google access or refresh token is stored: Chaatak calls no Google */
/* API on the user's behalf, so keeping one would mean holding a key to */
/* someone's account for no reason.                                     */
/* ------------------------------------------------------------------ */

create table if not exists profiles (
  id          uuid primary key,
  email       text,
  name        text,
  avatar_url  text,
  -- The reply language, so an alert dispatched while the phone is asleep is
  -- in the language this person actually chose.
  lang        text not null default 'hi',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

/* ------------------------------------------------------------------ */
/* 2. Conversations                                                    */
/* ------------------------------------------------------------------ */

create table if not exists conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  -- Written once, from the first question's own words. Null until the first
  -- message lands.
  title           text,
  -- Set when a guest transcript is adopted at sign-in. Unique per user, so a
  -- retried or double-submitted migration adopts it exactly once.
  guest_key       text,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

-- "Recent", sorted by last activity, scoped to one user. That is the only
-- query the sidebar makes, so it is the index that exists.
create index if not exists conversations_recent_idx
  on conversations (user_id, last_message_at desc);

do $do$
begin
  -- The target of the composite foreign key on messages.
  if not exists (
    select 1 from pg_constraint where conname = 'conversations_id_user_id_key'
  ) then
    alter table conversations add constraint conversations_id_user_id_key
      unique (id, user_id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'conversations_guest_key_key'
  ) then
    alter table conversations add constraint conversations_guest_key_key
      unique (user_id, guest_key);
  end if;
end
$do$;

/* ------------------------------------------------------------------ */
/* 3. Messages                                                         */
/*                                                                     */
/* `grounding` keeps the provenance a turn shipped with — which source, */
/* which endpoint, which issue time. Without it, reopening a            */
/* conversation would show a number with no citation, and a value with  */
/* no provenance is not something this product displays. It is a record */
/* of what was said, never a cache of what is true now: nothing ever    */
/* re-reads it as a current value.                                      */
/* ------------------------------------------------------------------ */

create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id         uuid not null,
  role            text not null check (role in ('user', 'assistant')),
  text            text not null,
  lang            text not null default 'hi',
  grounding       jsonb,
  -- Idempotency. The client mints this per turn, so a retry, a double submit
  -- or a refresh mid-flight writes the message once.
  client_id       text,
  seq             bigint generated always as identity,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation_idx
  on messages (conversation_id, created_at, seq);

do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'messages_client_id_key'
  ) then
    alter table messages add constraint messages_client_id_key
      unique (conversation_id, client_id);
  end if;

  -- A message's owner can never disagree with its conversation's owner. Two
  -- separate foreign keys would allow exactly that; one composite key makes
  -- it unrepresentable, which matters because RLS reads messages.user_id.
  if not exists (
    select 1 from pg_constraint where conname = 'messages_conversation_fkey'
  ) then
    alter table messages add constraint messages_conversation_fkey
      foreign key (conversation_id, user_id)
      references conversations (id, user_id) on delete cascade;
  end if;
end
$do$;

/* ------------------------------------------------------------------ */
/* 4. Monitored locations                                              */
/*                                                                     */
/* Three per account, enforced by a unique constraint rather than by a  */
/* count. A count read before an insert is a race: two requests both    */
/* see two rows and both insert a third. `slot` makes the limit a       */
/* property of the schema — there are three slots, one row may hold     */
/* each, and a concurrent insert loses on the unique index rather than  */
/* on a check that happened to run first.                               */
/*                                                                     */
/* Identity is the DISTRICT, because a district is the unit IMD issues  */
/* a warning for. Two villages in Barabanki produce identical alerts,   */
/* so monitoring both would spend a slot on nothing.                    */
/*                                                                     */
/* The coordinates stored are the CANONICAL place's, from Chaatak's own */
/* gazetteer — never the device's GPS fix. "Use my location" resolves a */
/* point to a place and then forgets the point.                         */
/* ------------------------------------------------------------------ */

create table if not exists monitored_locations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  slot         smallint not null check (slot between 1 and 3),
  -- What the user sees: the place they asked for.
  place_name   text not null,
  -- What the daemon polls: exactly the DistrictId the adapters use.
  district     text not null,
  state        text,
  -- Normalised district, for duplicate detection only. Never displayed.
  district_key text not null,
  latitude     double precision not null,
  longitude    double precision not null,
  timezone     text not null default 'Asia/Kolkata',
  -- Provenance of the resolution itself, like every other value here.
  resolved_by  text,
  endpoint     text,
  created_at   timestamptz not null default now()
);

do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'monitored_locations_slot_key'
  ) then
    alter table monitored_locations add constraint monitored_locations_slot_key
      unique (user_id, slot);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'monitored_locations_district_key'
  ) then
    alter table monitored_locations add constraint monitored_locations_district_key
      unique (user_id, district_key);
  end if;
end
$do$;

/* ------------------------------------------------------------------ */
/* 5. Subscribers gain an owner                                        */
/*                                                                     */
/* The alert pipeline is untouched. `subscribers` remains exactly what  */
/* the daemon reads, with the same primary key and the same columns; an */
/* authenticated user's row simply uses their user id as the subscriber */
/* id, and monitored_locations projects into `districts`.               */
/*                                                                     */
/* The new column is nullable so the anonymous rows Phase 4 created     */
/* stay valid and keep receiving alerts. It exists so that deleting an  */
/* account also stops the alerts for it — which a cascade does and a    */
/* hopeful DELETE in application code does not.                         */
/* ------------------------------------------------------------------ */

alter table subscribers add column if not exists user_id uuid;

create index if not exists subscribers_user_idx on subscribers (user_id);

/* ------------------------------------------------------------------ */
/* 6. Supabase-specific wiring                                         */
/*                                                                     */
/* Foreign keys into auth.users and the RLS policies live here, behind  */
/* a catalogue check, so this file also applies to a plain Postgres     */
/* with no auth schema. On Supabase every branch below runs.            */
/* ------------------------------------------------------------------ */

do $do$
declare
  spec record;
begin
  if to_regclass('auth.users') is null then
    raise notice 'no auth.users: skipping account foreign keys';
    return;
  end if;

  -- Deleting the auth user deletes everything they own. Enforced by the
  -- database, so it cannot be forgotten by a route, or half-completed by a
  -- request that died between two DELETEs.
  for spec in
    select * from (values
      ('profiles',            'id'),
      ('conversations',       'user_id'),
      ('monitored_locations', 'user_id'),
      ('subscribers',         'user_id')
    ) as v(tbl, col)
  loop
    if not exists (
      select 1 from pg_constraint where conname = spec.tbl || '_user_fkey'
    ) then
      execute format(
        'alter table %I add constraint %I foreign key (%I)
           references auth.users (id) on delete cascade',
        spec.tbl, spec.tbl || '_user_fkey', spec.col
      );
    end if;
  end loop;

  -- messages reaches auth.users through conversations, so it needs no key of
  -- its own; the composite key above already ties it to an owned conversation.
end
$do$;

-- RLS on every account table.
alter table profiles            enable row level security;
alter table conversations       enable row level security;
alter table messages            enable row level security;
alter table monitored_locations enable row level security;

/*
 * The policies.
 *
 * `to authenticated`, and nothing at all for `anon`: an unauthenticated
 * PostgREST request matches no policy and therefore sees no row. Ownership is
 * compared against auth.uid(), which comes from the verified JWT — there is
 * no path by which a client asserts who it is.
 *
 * Chaatak's own routes do not depend on these. They connect as `postgres` and
 * scope every statement by the user id taken from a validated session. The
 * policies exist because the same tables are reachable through Supabase's
 * public API, where they are the only thing standing between one account and
 * another.
 */
do $do$
declare
  spec record;
begin
  if to_regprocedure('auth.uid()') is null then
    raise notice 'no auth.uid(): skipping RLS policies';
    return;
  end if;

  for spec in
    select * from (values
      ('profiles',            'id'),
      ('conversations',       'user_id'),
      ('messages',            'user_id'),
      ('monitored_locations', 'user_id')
    ) as v(tbl, col)
  loop
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public'
         and tablename = spec.tbl
         and policyname = spec.tbl || '_owner'
    ) then
      execute format(
        'create policy %I on %I to authenticated
           using (%I = (select auth.uid()))
           with check (%I = (select auth.uid()))',
        spec.tbl || '_owner', spec.tbl, spec.col, spec.col
      );
    end if;
  end loop;

  -- anon matches no policy and so sees no rows, but it also has no business
  -- holding the verbs.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on profiles, conversations, messages, monitored_locations
      from anon;
  end if;
end
$do$;
