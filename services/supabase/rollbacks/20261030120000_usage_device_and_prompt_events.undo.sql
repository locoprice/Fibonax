-- UNDO for 20261030120000_usage_device_and_prompt_events.sql
--
-- Puts prompt uses back where the extension used to file them, restores the
-- one-argument increment_prompt_usage(), and drops the device tag. Run it only
-- after the pages are back on a version that does not read prompt_events or
-- snippet_events.device: the current Analytics pages read both.
--
-- Only untagged rows go back (the ones the migration moved): uses logged since
-- with a device were never in snippet_events. What is lost is the per-use log of
-- prompts; prompts.usage_count keeps every use counted.

begin;

insert into public.snippet_events (user_id, snippet_id, shortcut, lang, fields_filled, created_at)
select e.user_id, e.prompt_id::text, coalesce(p.shortcut, ''), null, 0, e.created_at
  from public.prompt_events e
  left join public.prompts p on p.id = e.prompt_id
 where e.device is null;

drop function if exists public.increment_prompt_usage(uuid, text);

create or replace function public.increment_prompt_usage(p_prompt_id uuid)
returns table(id uuid, usage_count integer, last_used_at timestamptz)
language sql
volatile
set search_path to 'public'
as $$
  update public.prompts p
     set usage_count  = p.usage_count + 1,
         last_used_at = now()
   where p.id = p_prompt_id
  returning p.id, p.usage_count, p.last_used_at;
$$;

revoke all on function public.increment_prompt_usage(uuid) from public, anon;
grant execute on function public.increment_prompt_usage(uuid) to authenticated;

drop table if exists public.prompt_events;

alter table public.snippet_events drop constraint if exists snippet_events_device_check;
alter table public.snippet_events drop column if exists device;

commit;
