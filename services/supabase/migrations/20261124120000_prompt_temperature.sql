-- Prompt temperature (Valentina, 2026-11-24).
--
-- A prompt keeps how precise or creative the AI should be: 0.2 Precise,
-- 0.5 Balanced, 0.9 Creative. Chat apps take no temperature number, so the
-- dashboard turns the choice into one plain sentence in the prompt text
-- (app/src/lib/promptTemperature.ts). The number is kept so the editor can
-- show the choice again. Null means no choice was made: prompts saved before
-- this keep their text exactly as written.
--
-- save_prompt_with_version learns p_temperature, last and with a default, so
-- the dashboard and the phone that are live today keep saving unchanged and
-- keep the value the prompt has. A parameter is part of a function's identity:
-- the old signature is dropped first, or PostgREST would see two matches.
-- The body is the one from 20260926120000_prompt_versions_shared_folders.sql
-- with one line added.
-- Undo: services/supabase/rollbacks/20261124120000_prompt_temperature.undo.sql

alter table public.prompts
  add column if not exists temperature numeric(2,1);

alter table public.prompts
  drop constraint if exists prompts_temperature_range;
alter table public.prompts
  add constraint prompts_temperature_range
    check (temperature is null or (temperature >= 0 and temperature <= 2));

comment on column public.prompts.temperature is
  'How precise (low) or creative (high) the AI should be, 0 to 2. Null: not set. Written into the prompt text as a sentence when it is handed out.';

drop function if exists public.save_prompt_with_version(
  uuid, text, text, jsonb, text, text, text, text, text, text, text, boolean, text, text, text
);

create or replace function public.save_prompt_with_version(
  p_prompt_id          uuid,
  p_name               text,
  p_content            text,
  p_blocks             jsonb,
  p_shortcut           text,
  p_strategy_type      text,
  p_thinking_mode      text,
  p_preferred_model    text,
  p_complexity_level   text,
  p_intent_category    text,
  p_output_type        text,
  p_ask_user_questions boolean,
  p_folder_id          text,
  p_editor_display     text default 'unknown',
  p_edit_note          text default null,
  p_temperature        numeric default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_next int;
begin
  if v_uid is null then
    raise exception 'save_prompt_with_version: authentication required' using errcode = '42501';
  end if;

  -- The owner, or an editor of the org folder the prompt sits in: the same
  -- guard as the prompts UPDATE policy and save_snippet_with_revision. Locked
  -- for the whole transaction, so two saves racing cannot both read the same
  -- highest version number and then collide on the unique constraint.
  perform 1 from public.prompts
   where id = p_prompt_id
     and ( user_id = v_uid
        or ( organization_id is not null
             and folder_id is not null
             and app.can_write_folder(folder_id) ) )
   for update;
  if not found then
    raise exception 'save_prompt_with_version: prompt not found' using errcode = '42501';
  end if;

  update public.prompts
     set name               = p_name,
         content            = p_content,
         blocks             = p_blocks,
         shortcut           = nullif(btrim(coalesce(p_shortcut, '')), ''),
         strategy_type      = p_strategy_type,
         thinking_mode      = p_thinking_mode,
         preferred_model    = p_preferred_model,
         complexity_level   = p_complexity_level,
         intent_category    = p_intent_category,
         output_type        = p_output_type,
         ask_user_questions = coalesce(p_ask_user_questions, false),
         folder_id          = p_folder_id,
         -- A caller that does not send it (an older dashboard, the phone before
         -- it learned the field) keeps the value the prompt has.
         temperature        = coalesce(p_temperature, temperature),
         updated_at         = now()
   where id = p_prompt_id;

  select coalesce(max(version_number), 0) + 1 into v_next
  from public.prompt_versions
  where prompt_id = p_prompt_id;

  -- Only the three fields a reader compares are kept: what it is called, what
  -- it says, and the blocks that produced it.
  insert into public.prompt_versions
    (prompt_id, version_number, editor_id, editor_display, name, content, blocks, edit_note)
  values
    (p_prompt_id, v_next, v_uid, coalesce(nullif(btrim(p_editor_display), ''), 'unknown'),
     p_name, coalesce(p_content, ''), p_blocks, p_edit_note);

  return v_next;
end; $$;

comment on function public.save_prompt_with_version(uuid, text, text, jsonb, text, text, text, text, text, text, text, boolean, text, text, text, numeric) is
  'HISTORY-001 · Updates a prompt and appends its version row in one transaction, under FOR UPDATE. SECURITY DEFINER: allows the owner or an editor of the org folder, the same guard as the prompts UPDATE policy. A null p_temperature keeps the stored value.';

revoke all on function public.save_prompt_with_version(uuid, text, text, jsonb, text, text, text, text, text, text, text, boolean, text, text, text, numeric) from public, anon;
grant execute on function public.save_prompt_with_version(uuid, text, text, jsonb, text, text, text, text, text, text, text, boolean, text, text, text, numeric) to authenticated;
