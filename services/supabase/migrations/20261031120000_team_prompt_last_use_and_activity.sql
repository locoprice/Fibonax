-- TEAM-USAGE-001 · Fibonax
-- Date: 2026-10-31
--
-- Needs 20261030120000_usage_device_and_prompt_events.sql (public.prompt_events).
--
-- 1. shared_prompt_last_use(): the prompt counterpart of shared_snippet_last_use().
--    It backs the "Last used by NAME on DD/MM/YYYY at HH:MM" line on prompts in
--    team folders. prompt_events RLS is select-own, so a teammate cannot read who
--    else used a shared prompt directly; this SECURITY DEFINER function exposes
--    ONLY the latest event per ORG-SHARED prompt the caller can read (the
--    app.can_read_folder branch the prompts select policy uses), and the name the
--    way org_member_directory() resolves it (display name, then email).
--
-- 2. team_usage_by_member() now counts shared prompts as well as shared
--    snippets, so the Team table on the Analytics page ranks who is most active
--    across both. Same rules as before: only items in team folders the CALLER can
--    read, one total per person, never single uses or times. "uses" is the sum of
--    both; "snippets" and the new "prompts" say how many different ones. The
--    return type changes, so the function is dropped and created again; a page
--    that reads only the old columns keeps working.
--
-- Events are trustworthy: both insert policies check auth.uid() = user_id.
--
-- Undo: services/supabase/rollbacks/20261031120000_team_prompt_last_use_and_activity.undo.sql

begin;

-- 1 ──────────────────────────────────────────────────────────────────────────
create index if not exists prompt_events_prompt_created_idx
  on public.prompt_events using btree (prompt_id, created_at desc);

create or replace function public.shared_prompt_last_use()
returns table(prompt_id uuid, used_at timestamptz, used_by uuid, used_by_name text)
language sql
stable security definer
set search_path to 'public', 'auth'
as $$
  select distinct on (e.prompt_id)
         e.prompt_id,
         e.created_at,
         e.user_id,
         coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), u.email)::text
    from prompt_events e
    join prompts p on p.id = e.prompt_id
    left join auth.users u on u.id = e.user_id
   where p.organization_id is not null
     and p.folder_id is not null
     and app.can_read_folder(p.folder_id)
   order by e.prompt_id, e.created_at desc;
$$;

revoke all on function public.shared_prompt_last_use() from public, anon;
grant execute on function public.shared_prompt_last_use() to authenticated;

-- 2 ──────────────────────────────────────────────────────────────────────────
drop function if exists public.team_usage_by_member(timestamptz, timestamptz);

create function public.team_usage_by_member(p_from timestamptz, p_to timestamptz)
returns table(user_id uuid, member_name text, uses bigint, snippets bigint, prompts bigint)
language sql
stable security definer
set search_path to 'public', 'auth'
as $$
  with win as (
    select p_from as f, p_to as t
     where p_from is not null
       and p_to is not null
       and p_to > p_from
       and p_to - p_from <= interval '400 days'
       and auth.uid() is not null
  ),
  sev as (
    select e.snippet_id, e.user_id
      from snippet_events e, win
     where e.created_at >= win.f
       and e.created_at < win.t
       and e.snippet_id is not null
       and e.user_id is not null
  ),
  pev as (
    select e.prompt_id, e.user_id
      from prompt_events e, win
     where e.created_at >= win.f
       and e.created_at < win.t
       and e.user_id is not null
  ),
  scand as (
    select s.id, s.folder_id
      from snippets s
     where s.id in (select distinct sev.snippet_id from sev)
       and s.organization_id is not null
       and s.folder_id is not null
  ),
  pcand as (
    select p.id, p.folder_id
      from prompts p
     where p.id in (select distinct pev.prompt_id from pev)
       and p.organization_id is not null
       and p.folder_id is not null
  ),
  readable as (
    select f.folder_id
      from (select scand.folder_id from scand
            union
            select pcand.folder_id from pcand) f
     where app.can_read_folder(f.folder_id)
  ),
  uses as (
    select sev.user_id, sev.snippet_id as snippet_id, null::uuid as prompt_id
      from sev
      join scand on scand.id = sev.snippet_id
     where scand.folder_id in (select r.folder_id from readable r)
    union all
    select pev.user_id, null::text, pev.prompt_id
      from pev
      join pcand on pcand.id = pev.prompt_id
     where pcand.folder_id in (select r.folder_id from readable r)
  )
  select x.user_id,
         coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), u.email)::text,
         count(*)::bigint,
         count(distinct x.snippet_id)::bigint,
         count(distinct x.prompt_id)::bigint
    from uses x
    left join auth.users u on u.id = x.user_id
   group by x.user_id, u.raw_user_meta_data, u.email;
$$;

revoke all on function public.team_usage_by_member(timestamptz, timestamptz) from public, anon;
grant execute on function public.team_usage_by_member(timestamptz, timestamptz) to authenticated;

commit;
