-- Drop the one-off backup tables (v3.72.1)
--
-- WHAT
-- Eleven tables in the app schema are safety copies taken before one-off data
-- repairs: language variants, duplicates, timestamps and unsharing
-- (2026-08-19 and 2026-08-20), the Reasoning block move (2026-09-13, see
-- 20260913000000) and the snippet name format (2026-09-17). They copy snippet,
-- history, folder and prompt text and have no foreign key, so deleting an
-- account (20261018120000) left that person's words in them.
--
-- WHY DROP, NOT CLEAR
-- Nothing reads them: no code in this repository, no function, view, policy
-- or trigger, and only the postgres role holds a grant on them. Every repair
-- they back up has been live for a month or more, and restoring one now would
-- overwrite the edits made since. Clearing one person's rows inside
-- delete_account() would keep everyone else's copies and need a new line for
-- every future backup table. The project is on the free plan, so there is no
-- platform restore point either: once dropped, these copies are gone.
--
-- KEPT
-- public.phase_b_share_migration holds snippet ids only, no text, and its rows
-- already go with their snippet (ON DELETE CASCADE). docs/PHASE_B_SOAK.md
-- still reads it for the pending is_shared re-drop.
--
-- IF EXISTS: ten of these were made in the SQL editor and are in no
-- migration, so a database built from this folder never had them.
-- No CASCADE: if anything had come to depend on one, the drop stops.

begin;

drop table if exists
  app.snippets_dedup_backup_20260819,
  app.snippets_dupfix_backup_20260819,
  app.snippets_langfix_backup_20260819,
  app.snippets_share_state_20260819,
  app.snippets_timefix_backup_20260819,
  app.snippets_unshare_backup_20260820,
  app.folder_unshare_backup_20260820,
  app.snippet_revisions_timefix_backup_20260819,
  app.snippet_revisions_timefix2_backup_20260819,
  app.prompt_reasoning_backup_20260913,
  app.snippet_name_format_backup_20260917;

commit;
