-- Unfinished text · one switch per snippet.
--
-- Right before a snippet is inserted or copied, every surface checks the
-- finished text for pieces that look like they were never filled in
-- ("[xxx]", "{fill this in}", XXX, an empty box) and warns. When a snippet
-- carries one of those on purpose, the person ticks "Don't warn me about this
-- snippet again" and the warning stops for that snippet, on every device. The
-- editor turns it back on.
--
-- Stored on the snippet, not on the device, because the owners asked for it to
-- follow the snippet everywhere and to be visible in the editor (2026-10-26).
-- A team snippet's switch is the team's: whoever may edit the snippet may flip
-- it, which is what the folder ACL already decides. The review guard ignores
-- it (it watches title, body and bodies only), so flipping it never sends an
-- approved snippet back for review.
--
-- Additive: one column with a default, so every existing snippet keeps being
-- checked and every older client that never sends it keeps working. No policy,
-- function or trigger is touched. accessible_snippets() returns SETOF snippets
-- with s.*, so the extension and the phone receive the column with no change.
--
-- Apply BEFORE releasing extension and dashboard v3.85.0: the extension's
-- background sync names the column in its select, and a select naming a column
-- that does not exist fails whole.

alter table public.snippets
  add column if not exists check_unfinished boolean not null default true;

comment on column public.snippets.check_unfinished is
  'Warn before inserting when the text looks unfinished. false = the person chose not to be warned for this snippet. Read by fill-form.js checksUnfinished().';
