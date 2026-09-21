-- Reverses 002_accounts.sql.
--
-- NOT applied by scripts/migrate.mjs — it skips *.down.sql. Run it by hand:
--
--   psql "$DATABASE_URL" -f migrations/002_accounts.down.sql
--
-- It drops every account table and, with them, every conversation, message
-- and monitored location. That is what "reverse this migration" means here,
-- so it is worth saying plainly rather than discovering afterwards.
--
-- What it does NOT touch:
--   - auth.users. Accounts outlive this schema; Supabase owns them.
--   - subscribers, dispatch_claims, seen_warnings, dispatch_log, or any row
--     in them. Phase 4's alert pipeline predates accounts and survives their
--     removal, minus the ownership column added by the up migration.

drop table if exists messages;
drop table if exists monitored_locations;
drop table if exists conversations;
drop table if exists profiles;

-- The alert tables keep their rows; only the account linkage goes.
alter table subscribers drop constraint if exists subscribers_user_fkey;
drop index if exists subscribers_user_idx;
alter table subscribers drop column if exists user_id;

-- Row-level security on the alert tables is deliberately LEFT ENABLED.
--
-- It was switched on because the browser now holds a Supabase anon key, and
-- that key does not go away when this migration is reversed. Turning RLS back
-- off here would re-open `subscribers` — live Web Push endpoints and their
-- encryption keys — to the public PostgREST surface. Reversing a schema
-- change should not reverse a security fix.
--
-- To undo it anyway, knowing that:
--   alter table subscribers     disable row level security;
--   alter table dispatch_claims disable row level security;
--   alter table seen_warnings   disable row level security;
--   alter table dispatch_log    disable row level security;
--   grant all on subscribers, dispatch_claims, seen_warnings, dispatch_log
--     to anon, authenticated;
