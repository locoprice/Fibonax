-- Undo for 20261111120000_org_chart.sql.
--
-- Puts org_member_directory() back as 20261028120000 left it and removes the
-- departments, each member's department and job title, and the function that
-- writes them. Every department, job title and lead mark saved since the
-- apply is deleted with it. Run only together with a dashboard that no longer
-- reads them (before the org chart release).

drop function if exists public.set_member_placement(uuid, uuid, uuid, text, boolean);

drop function if exists public.org_member_directory(uuid);

create function public.org_member_directory(p_org uuid)
returns table (user_id uuid, email text, display_name text, role org_role, avatar_url text)
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
         end::text
  from organization_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id = p_org
    and app.is_org_member(p_org)
  order by m.role, u.email;
$$;

comment on function public.org_member_directory(uuid) is
  'Member directory (id, email, name, role, photo) of an org the caller belongs to. Co-members only.';

revoke execute on function public.org_member_directory(uuid) from public, anon;
grant execute on function public.org_member_directory(uuid) to authenticated, service_role;

alter table public.org_departments
  drop constraint if exists org_departments_lead_fkey;

alter table public.organization_members
  drop constraint if exists organization_members_department_fkey,
  drop constraint if exists organization_members_job_title_shape,
  drop column if exists department_id,
  drop column if exists job_title;

drop table if exists public.org_departments;
