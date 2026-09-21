-- Three language preferences per account, instead of one.
--
-- `profiles.lang` was a single setting doing three jobs: it came from the
-- voice picker, and it also decided what language an alert was written in.
-- Splitting it means someone can read the interface in English, ask in Hindi
-- and hear Hindi read back — none of which the old column could express.
--
-- Idempotent and additive, like every migration here. Reverse with
-- 003_language_preferences.down.sql.

/* ------------------------------------------------------------------ */
/* The three preferences                                               */
/*                                                                     */
/* Each holds 'auto' or a language code, and 'auto' is the default —    */
/* the same value a guest starts with, so signing in never silently     */
/* changes what someone was already seeing.                             */
/* ------------------------------------------------------------------ */

alter table profiles add column if not exists ui_lang        text not null default 'auto';
alter table profiles add column if not exists assistant_lang text not null default 'auto';
alter table profiles add column if not exists voice_lang     text not null default 'auto';

/*
 * `profiles.lang` STAYS, with a narrowed job.
 *
 * It is the language an ALERT is written in — which is not a preference the
 * person sets directly, but the resolved interface language, kept here
 * because the alert daemon runs while the phone is in a pocket and has no
 * browser to ask. It is constrained to the two languages the warning
 * taxonomy is human-translated into, because a template that does not exist
 * cannot be rendered and must never be machine-made.
 *
 * Not dropped and not renamed: subscribers.lang is copied from it, the
 * daemon reads that, and Phase 4's dispatch path is not being touched.
 */
do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_lang_check'
  ) then
    alter table profiles add constraint profiles_lang_check
      check (lang in ('hi', 'en'));
  end if;
end
$do$;

/*
 * Existing rows carry the voice language that was the only setting there was.
 *
 * It moves to `voice_lang`, where it now means only what it always did, and
 * the other two start on 'auto'. Nobody's voice changes under them; everyone
 * gains an interface language that follows their device until they say
 * otherwise.
 *
 * Guarded so a re-run cannot overwrite a choice made after the first run.
 */
update profiles
   set voice_lang = lang
 where voice_lang = 'auto'
   and lang is not null
   and lang <> 'auto';
