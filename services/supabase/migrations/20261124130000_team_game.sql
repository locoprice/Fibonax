-- TEAM-GAME-001 · Fibonax
-- Date: 2026-11-24
--
-- The Team game on the Team page: over the last 30 days the most active
-- person of a team is its Team Leader, the least active its Black Sheep.
--
-- 1. organizations.team_game: off for every team until an admin switches it
--    on from the Team page. Written through the existing org_update policy
--    (admins only), the way the cover is.
--
-- 2. team_game_scores(p_org): one row per member of a team the caller belongs
--    to, and only while that team's game is on.
--      actions  in the last 30 days: every use of a snippet or prompt in one
--               of the team's folders, every snippet or prompt added to one,
--               and every saved change to one. Each counts as one.
--      is_new   the person joined the team in the last 14 days. The page never
--               makes a newcomer the Black Sheep.
--    One total per person, never which item or when. It counts every folder of
--    the team, not only the ones the caller can open, so everyone in the team
--    sees the same standings; a total names nothing inside a folder.
--
-- Additive: no existing row changes, and every team starts with the game off.
--
-- Undo: services/supabase/rollbacks/20261124130000_team_game.undo.sql

begin;

alter table public.organizations
  add column if not exists team_game boolean not null default false;

comment on column public.organizations.team_game is
  'Team game on the Team page (Team Leader and Black Sheep). Off until a team admin switches it on.';

create or replace function public.team_game_scores(p_org uuid)
returns table(user_id uuid, actions bigint, is_new boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  with game as (
    select now() - interval '30 days' as since
      from organizations o
     where o.id = p_org
       and o.team_game
       and app.is_org_member(p_org)
  ),
  acts as (
    select e.user_id
      from snippet_events e
      join snippets s on s.id = e.snippet_id
     cross join game
     where s.organization_id = p_org
       and e.created_at >= game.since
    union all
    select e.user_id
      from prompt_events e
      join prompts p on p.id = e.prompt_id
     cross join game
     where p.organization_id = p_org
       and e.created_at >= game.since
    union all
    select s.user_id
      from snippets s
     cross join game
     where s.organization_id = p_org
       and s.created_at >= game.since
    union all
    select p.user_id
      from prompts p
     cross join game
     where p.organization_id = p_org
       and p.created_at >= game.since
    union all
    select r.editor_id
      from snippet_revisions r
      join snippets s on s.id = r.snippet_id
     cross join game
     where s.organization_id = p_org
       and r.created_at >= game.since
    union all
    select v.editor_id
      from prompt_versions v
      join prompts p on p.id = v.prompt_id
     cross join game
     where p.organization_id = p_org
       and v.created_at >= game.since
  ),
  counted as (
    select a.user_id, count(*) as n
      from acts a
     group by a.user_id
  )
  select m.user_id,
         coalesce(c.n, 0)::bigint,
         m.created_at > now() - interval '14 days'
    from organization_members m
   cross join game
    left join counted c on c.user_id = m.user_id
   where m.organization_id = p_org
   order by m.user_id;
$$;

comment on function public.team_game_scores(uuid) is
  'Team game standings of a team the caller belongs to, while its game is on: actions in the last 30 days and whether the person joined in the last 14. One total per person.';

revoke all on function public.team_game_scores(uuid) from public, anon;
grant execute on function public.team_game_scores(uuid) to authenticated;

commit;
