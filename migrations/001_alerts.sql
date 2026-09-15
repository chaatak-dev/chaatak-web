-- Chaatak alerts: subscribers, idempotent dispatch, and the seen-warning set.
--
-- Idempotent by construction: every statement is IF NOT EXISTS, so the cron
-- endpoint can call migrate() on every invocation without caring whether it
-- has run before. Concurrent invocations racing this are fine.

create table if not exists subscribers (
  id          text primary key,
  districts   text[] not null default '{}',
  lang        text   not null default 'hi',
  channels    jsonb  not null default '[]',
  created_at  timestamptz not null default now()
);

-- Warnings are looked up by district, and a district lookup over an array
-- column needs GIN to avoid a sequential scan per poll.
create index if not exists subscribers_districts_idx
  on subscribers using gin (districts);

-- The idempotency table. This is the whole concurrency story.
--
-- PRIMARY KEY (subscriber_id, dispatch_key) is what makes the claim atomic:
-- two runners inserting the same pair at the same moment, one wins.
--
-- claimed_at is a LEASE, not a record timestamp. A runner that claims and then
-- dies would otherwise block the dispatch forever, and a silently dropped
-- cyclone warning is the worst outcome this system has.
create table if not exists dispatch_claims (
  subscriber_id text not null,
  dispatch_key  text not null,
  state         text not null default 'claimed'
                check (state in ('claimed', 'sent', 'failed')),
  attempt       int  not null default 1,
  claimed_at    timestamptz not null default now(),
  primary key (subscriber_id, dispatch_key)
);

create index if not exists dispatch_claims_stale_idx
  on dispatch_claims (state, claimed_at);

-- What we saw last time, so a warning VANISHING can be told from one that
-- merely ran out. Without this, a withdrawal is indistinguishable from an
-- expiry and the all-clear can never be sent.
create table if not exists seen_warnings (
  district     text not null,
  warning_id   text not null,
  fingerprint  text not null,
  severity     text not null,
  valid_to     timestamptz not null,
  last_seen_at timestamptz not null default now(),
  primary key (district, warning_id)
);

-- One row per dispatch attempt: subscriber, warning, channel, result, latency.
create table if not exists dispatch_log (
  id            bigserial primary key,
  subscriber_id text not null,
  dispatch_key  text not null,
  warning_id    text not null,
  district      text not null,
  severity      text not null,
  kind          text not null,
  channel       text not null,
  result        text not null,
  attempt       int  not null,
  latency_ms    int  not null,
  error         text,
  at            timestamptz not null default now()
);

create index if not exists dispatch_log_at_idx on dispatch_log (at desc);
