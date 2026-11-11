-- Org chart on the Team page (2026-11-11).
--
-- A team groups its people by department. Each person has at most one
-- department and a job title, and each department can name one of its people
-- as its lead. All of it is kept per team, because a person in two teams can
-- sit in a different department in each.
--
-- What is added:
--   org_departments              one row per department of a team
--   organization_members         department_id, job_title
--   set_member_placement()       the one way a person's department, job title
--                                and lead mark are written
--   org_member_directory()       also returns the three new facts
--
-- Additive: no existing row changes, and every member starts with no
-- department and no job title.
--
-- Who may write what:
--   departments (add, rename, remove)    team admins, through row security
--   a person's department and job title  a team admin, or the person themself
--   a department's lead                  team admins only
-- organization_members stays admin-only under orgmem_write, so a member cannot
-- reach their own role this way: set_member_placement() writes the two new
-- columns and nothing else.
--
-- Both links are held inside one team by the keys themselves: a member can
-- only point at a department of the same team, and a department's lead can
-- only be a member of the same team. Removing a department, or a lead leaving
-- the team, clears the link and keeps the other row.
--
-- Undo: services/supabase/rollbacks/20261111120000_org_chart.undo.sql

set local lock_timeout = '5s';

-- ── departments ─────────────────────────────────────────────────────────────
create table public.org_departments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  lead_user_id    uuid,
  created_at      timestamptz not null default now(),
  constraint org_departments_name_shape
    check (name = btrim(name) and char_length(name) between 1 and 40),
  constraint org_departments_org_id_key unique (organization_id, id)
);

-- "Sales" and "sales" are one department.
create unique index org_departments_org_name_key
  on public.org_departments (organization_id, lower(name));

-- ── each member's place ─────────────────────────────────────────────────────
alter table public.organization_members
  add column department_id uuid,
  add column job_title text,
  add constraint organization_members_job_title_shape
    check (job_title is null
           or (job_title = btrim(job_title) and char_length(job_title) between 1 and 60)),
  add constraint organization_members_department_fkey
    foreign key (organization_id, department_id)
    references public.org_departments (organization_id, id)
    on delete set null (department_id);

create index idx_org_members_department
  on public.organization_members (organization_id, department_id);

alter table public.org_departments
  add constraint org_departments_lead_fkey
    foreign key (organization_id, lead_user_id)
    references public.organization_members (organization_id, user_id)
    on delete set null (lead_user_id);

create index idx_org_departments_lead
  on public.org_departments (organization_id, lead_user_id);

-- ── row security and grants ─────────────────────────────────────────────────
-- Everyone in the team reads its departments; admins add, rename and remove
-- them. The lead is not writable from the API: it goes through
-- set_member_placement(), which checks the person sits in that department.
alter table public.org_departments enable row level security;

revoke all on public.org_departments from anon, authenticated;
grant select, delete on public.org_departments to authenticated;
grant insert (organization_id, name) on public.org_departments to authenticated;
grant update (name) on public.org_departments to authenticated;
grant all on public.org_departments to service_role;

create policy orgdept_select on public.org_departments
  for select to authenticated
  using (app.is_org_member(organization_id));

create policy orgdept_insert on public.org_departments
  for insert to authenticated
  with check (app.org_role(organization_id) = 'admin');

create policy orgdept_update on public.org_departments
  for update to authenticated
  using (app.org_role(organization_id) = 'admin')
  with check (app.org_role(organization_id) = 'admin');

create policy orgdept_delete on public.org_departments
  for delete to authenticated
  using (app.org_role(organization_id) = 'admin');

comment on table public.org_departments is
  'Departments of a team, for the org chart on the Team page. Read by co-members, written by team admins; lead_user_id only through set_member_placement().';

-- ── writing a person's place ────────────────────────────────────────────────
-- p_lead: null leaves the lead mark as it is, true makes this person the lead
-- of p_department (replacing whoever was), false takes the mark away. A person
-- who moves to another department stops leading the one they left.
create function public.set_member_placement(
  p_org        uuid,
  p_user       uuid,
  p_department uuid,
  p_job_title  text,
  p_lead       boolean default null
)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_role   org_role;
  v_title  text := nullif(btrim(coalesce(p_job_title, '')), '');
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select m.role into v_role
    from organization_members m
   where m.organization_id = p_org and m.user_id = v_caller;

  if v_role is null or (v_role <> 'admin' and p_user is distinct from v_caller) then
    raise exception 'Only a team admin can change someone else''s department'
      using errcode = '42501';
  end if;

  if p_lead is not null and v_role <> 'admin' then
    raise exception 'Only a team admin can choose a department lead'
      using errcode = '42501';
  end if;

  if v_title is not null and char_length(v_title) > 60 then
    raise exception 'Job titles are 60 characters or fewer' using errcode = '22023';
  end if;

  if p_department is not null and not exists (
       select 1 from org_departments d
        where d.id = p_department and d.organization_id = p_org) then
    raise exception 'That department no longer exists' using errcode = '22023';
  end if;

  if p_lead is true and p_department is null then
    raise exception 'Choose a department before making someone its lead'
      using errcode = '22023';
  end if;

  update organization_members m
     set department_id = p_department,
         job_title = v_title
   where m.organization_id = p_org and m.user_id = p_user;
  if not found then
    raise exception 'That person is no longer in the team' using errcode = '22023';
  end if;

  update org_departments d
     set lead_user_id = null
   where d.organization_id = p_org
     and d.lead_user_id = p_user
     and (d.id is distinct from p_department or p_lead is false);

  if p_lead is true then
    update org_departments d
       set lead_user_id = p_user
     where d.id = p_department and d.organization_id = p_org;
  end if;
end; $$;

comment on function public.set_member_placement(uuid, uuid, uuid, text, boolean) is
  'Set a team member''s department and job title (a team admin, or the person themself) and, for admins, whether they lead that department. Writes nothing else on the membership row.';

revoke execute on function public.set_member_placement(uuid, uuid, uuid, text, boolean) from public, anon;
grant execute on function public.set_member_placement(uuid, uuid, uuid, text, boolean) to authenticated, service_role;

-- ── the directory also says where each person sits ──────────────────────────
-- The return type changes, which create or replace refuses, so the function
-- is dropped first. Nothing depends on it, and every client reads its rows by
-- column name, so the five columns it already returned are unchanged.
drop function if exists public.org_member_directory(uuid);

create function public.org_member_directory(p_org uuid)
returns table (
  user_id uuid,
  email text,
  display_name text,
  role org_role,
  avatar_url text,
  department_id uuid,
  job_title text,
  is_department_lead boolean
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select m.user_id,
         u.email::text,
         coalesce(
           nullif(u.raw_user_meta_data->>'full_name', ''),
           nullif(u.raw_user_meta_data->>'name', ''),
           u.email
         )::text,
         m.role,
         case
           when u.raw_user_meta_data->>'avatar_url' like 'https://%'
           then u.raw_user_meta_data->>'avatar_url'
         end::text,
         m.department_id,
         m.job_title,
         coalesce(d.lead_user_id = m.user_id, false)
  from organization_members m
  join auth.users u on u.id = m.user_id
  left join org_departments d on d.id = m.department_id
  where m.organization_id = p_org
    and app.is_org_member(p_org)
  order by m.role, u.email;
$$;

comment on function public.org_member_directory(uuid) is
  'Member directory (id, email, name, role, photo, department, job title, lead mark) of an org the caller belongs to. Co-members only.';

revoke execute on function public.org_member_directory(uuid) from public, anon;
grant execute on function public.org_member_directory(uuid) to authenticated, service_role;
