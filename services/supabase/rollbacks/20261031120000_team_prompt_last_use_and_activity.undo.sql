-- UNDO for 20261031120000_team_prompt_last_use_and_activity.sql
--
-- Drops the prompt last-use function and puts team_usage_by_member() back to
-- counting shared snippets only. Pages fall back on their own: the prompt
-- "Last used by" line hides and the Team table loses its prompts column.

begin;

drop function if exists public.shared_prompt_last_use();
drop index if exists public.prompt_events_prompt_created_idx;

drop function if exists public.team_usage_by_member(timestamptz, timestamptz);

create function public.team_usage_by_member(p_from timestamptz, p_to timestamptz)
returns table(user_id uuid, member_name text, uses bigint, snippets bigint)
language sql
stable security definer
set search_path to 'public', 'auth'
as $$
  with ev as (
    select e.snippet_id, e.user_id
      from snippet_events e
     where p_from is not null
       and p_to is not null
       and p_to > p_from
       and p_to - p_from <= interval '400 days'
       and auth.uid() is not null
       and e.created_at >= p_from
       and e.created_at < p_to
       and e.snippet_id is not null
       and e.user_id is not null
  ),
  cand as (
    select s.id, s.folder_id
      from snippets s
     where s.id in (select distinct ev.snippet_id from ev)
       and s.organization_id is not null
       and s.folder_id is not null
  ),
  readable as (
    select f.folder_id
      from (select distinct c.folder_id from cand c) f
     where app.can_read_folder(f.folder_id)
  ),
  shared as (
    select c.id from cand c where c.folder_id in (select r.folder_id from readable r)
  )
  select ev.user_id,
         coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), u.email)::text,
         count(*)::bigint,
         count(distinct ev.snippet_id)::bigint
    from ev
    join shared on shared.id = ev.snippet_id
    left join auth.users u on u.id = ev.user_id
   group by ev.user_id, u.raw_user_meta_data, u.email;
$$;

revoke all on function public.team_usage_by_member(timestamptz, timestamptz) from public, anon;
grant execute on function public.team_usage_by_member(timestamptz, timestamptz) to authenticated;

commit;
