-- Reverses 004_telegram.sql.
--
-- NOT applied by scripts/migrate.mjs — it skips *.down.sql. Run it by hand:
--
--   psql "$DATABASE_URL" -f migrations/004_telegram.down.sql
--
-- It drops every Telegram link, every outstanding link token and the record
-- of handled update ids. It does NOT remove the {kind: 'telegram'} channels
-- already projected into subscribers.channels; do that first if the bot is
-- going away, or linked chats keep receiving alerts:
--
--   update subscribers
--      set channels = coalesce((
--            select jsonb_agg(c) from jsonb_array_elements(channels) c
--             where c->>'kind' <> 'telegram'), '[]'::jsonb);

drop table if exists telegram_updates;
drop table if exists telegram_link_tokens;
drop table if exists telegram_chats;
