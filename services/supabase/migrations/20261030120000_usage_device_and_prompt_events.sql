-- ANALYTICS-003 · Fibonax
-- Date: 2026-10-30
--
-- Backs the 80/20 view on the Analytics page (dashboard and phone): which few
-- snippets and prompts do most of the work, and how much of it happens on a
-- phone or on a computer.
--
-- 1. snippet_events.device: 'computer' (the Chrome extension) or 'phone' (the
--    phone app at /mobile). Rows written before this stay NULL, which the
--    pages read as "Before tracking". Nullable on purpose: an extension still
--    on an older version keeps writing rows without it, and they still count.
--
-- 2. public.prompt_events: one row per use of a saved prompt, the prompt
--    counterpart of snippet_events. Until now a prompt kept only an all-time
--    counter (prompts.usage_count), so it could not follow the period picker or
--    say where it was used. Select-own and insert-own, as snippet_events is.
--    prompt_id has no foreign key, as snippet_id has none: a deleted prompt's
--    history stays, and the pages leave it out of the ranking. user_id cascades
--    with the account, so delete_account() needs no change.
--
-- 3. increment_prompt_usage(p_prompt_id, p_device): the one call every surface
--    already makes when a prompt is used now also logs the use. The event is
--    logged for anyone who can READ the prompt, so a teammate with View access
--    to a shared folder sees their own use in their figures even though the
--    shared counter (an UPDATE, Edit access) does not move for them, exactly
--    as before. p_device defaults to NULL, so a page still on the old call
--    keeps working. SECURITY INVOKER as before: RLS gates both writes.
--
-- 4. Data correction: the extension's """ menu logged a picked prompt into
--    snippet_events, so those uses showed as "Deleted snippet". Rows whose id
--    is a prompt (and never a snippet) move to prompt_events, keeping their
--    time.
--
-- Undo: services/supabase/rollbacks/20261030120000_usage_device_and_prompt_events.undo.sql

begin;

-- 1 ──────────────────────────────────────────────────────────────────────────
alter table public.snippet_events
  add column if not exists device text;

alter table public.snippet_events
  drop constraint if exists snippet_events_device_check;
alter table public.snippet_events
  add constraint snippet_events_device_check
  check (device is null or device in ('computer', 'phone'));

-- 2 ──────────────────────────────────────────────────────────────────────────
create table if not exists public.prompt_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt_id uuid not null,
  device text check (device is null or device in ('computer', 'phone')),
  created_at timestamptz not null default now()
);

create index if not exists prompt_events_user_created_idx
  on public.prompt_events using btree (user_id, created_at);

alter table public.prompt_events enable row level security;

drop policy if exists "prompt_events: select own" on public.prompt_events;
create policy "prompt_events: select own" on public.prompt_events
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "prompt_events: insert own" on public.prompt_events;
create policy "prompt_events: insert own" on public.prompt_events
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

revoke all on public.prompt_events from public, anon, authenticated;
grant select, insert on public.prompt_events to authenticated;
grant all on public.prompt_events to service_role;

-- 3 ──────────────────────────────────────────────────────────────────────────
-- The old one-argument signature is dropped rather than overloaded: two
-- functions answering to { p_prompt_id } would make the call ambiguous.
drop function if exists public.increment_prompt_usage(uuid);

create or replace function public.increment_prompt_usage(p_prompt_id uuid, p_device text default null)
returns table(id uuid, usage_count integer, last_used_at timestamptz)
language plpgsql
volatile
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if auth.uid() is not null and exists (select 1 from prompts p where p.id = p_prompt_id) then
    insert into prompt_events (user_id, prompt_id, device)
    values (auth.uid(), p_prompt_id,
            case when p_device in ('computer', 'phone') then p_device end);
  end if;

  return query
    update prompts p
       set usage_count  = p.usage_count + 1,
           last_used_at = now()
     where p.id = p_prompt_id
    returning p.id, p.usage_count, p.last_used_at;
end;
$$;

revoke all on function public.increment_prompt_usage(uuid, text) from public, anon;
grant execute on function public.increment_prompt_usage(uuid, text) to authenticated;

-- 4 ──────────────────────────────────────────────────────────────────────────
with misfiled as (
  delete from public.snippet_events e
   where e.user_id is not null
     and e.snippet_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and exists (select 1 from public.prompts p where p.id = e.snippet_id::uuid)
     and not exists (select 1 from public.snippets s where s.id::text = e.snippet_id)
     and exists (select 1 from auth.users u where u.id = e.user_id)
  returning e.user_id, e.snippet_id, e.created_at
)
insert into public.prompt_events (user_id, prompt_id, device, created_at)
select m.user_id, m.snippet_id::uuid, null, m.created_at
  from misfiled m;

commit;
