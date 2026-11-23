-- Your details (2026-11-21).
--
-- A snippet can carry the details of the person who uses it: their name, their
-- company and their job title ({my: name}, {my: company}, {my: job title}),
-- and the seasonal line's wishes can too ("Merry Christmas from LeibTour").
-- Nothing is typed when the snippet is used: every value comes from what the
-- account already holds.
--
--   name       the account's name (full_name, else name), as the team page shows it
--   company    the account's own Company branding (company_name); without one,
--              the Company branding of whoever created the person's team, so a
--              member's snippets sign with the company their team belongs to
--   job title  the job title the team holds for the person (organization_members)
--
-- A member cannot read another account's settings, so the team creator's
-- company name is read here, on the server, for the caller only. Nothing else
-- of the creator's account leaves the function.
--
-- Read only: no table, no column and no row changes.
--
-- Undo: services/supabase/rollbacks/20261121120000_my_details.undo.sql

set local lock_timeout = '5s';

create or replace function public.my_details()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select u.id, coalesce(u.raw_user_meta_data, '{}'::jsonb) as meta
      from auth.users u
     where u.id = auth.uid()
  ),
  team as (
    -- The person's first team: the one they joined first.
    select m.organization_id, m.job_title, o.created_by
      from public.organization_members m
      join public.organizations o on o.id = m.organization_id
     where m.user_id = auth.uid()
     order by m.created_at, m.organization_id
     limit 1
  ),
  founder as (
    select nullif(btrim(coalesce(u.raw_user_meta_data, '{}'::jsonb)->>'company_name'), '') as company
      from auth.users u
     where u.id = (select created_by from team)
  )
  select jsonb_build_object(
    'name', coalesce(
              nullif(btrim(me.meta->>'full_name'), ''),
              nullif(btrim(me.meta->>'name'), ''),
              ''),
    'company', coalesce(
              nullif(btrim(me.meta->>'company_name'), ''),
              (select company from founder),
              ''),
    'job_title', coalesce((select nullif(btrim(job_title), '') from team), '')
  )
  from me;
$$;

comment on function public.my_details() is
  'Your details (2026-11-21): the name, company and job title snippets print for the person who uses them. The company falls back to the Company branding of whoever created the person''s team.';

revoke all on function public.my_details() from public, anon;
grant execute on function public.my_details() to authenticated;
