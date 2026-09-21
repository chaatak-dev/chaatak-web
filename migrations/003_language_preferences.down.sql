-- Reverses 003_language_preferences.sql.
--
-- NOT applied by scripts/migrate.mjs — it skips *.down.sql. Run it by hand.
--
-- Dropping these columns loses the interface and assistant choices. The voice
-- choice survives, because `profiles.lang` is where it lived before and is
-- where the alert language still lives.

alter table profiles drop constraint if exists profiles_lang_check;

alter table profiles drop column if exists ui_lang;
alter table profiles drop column if exists assistant_lang;
alter table profiles drop column if exists voice_lang;
