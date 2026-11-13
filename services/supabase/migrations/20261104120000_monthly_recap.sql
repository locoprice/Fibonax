-- MONTHLY-RECAP · Fibonax
-- Date: 2026-11-04
--
-- The monthly recap email: on the morning of the 1st, every account that
-- inserted a snippet or used a prompt in the month just ended gets one email
-- with its figures (the same arithmetic as the Analytics page, run for that
-- calendar month) from the `monthly-recap` edge function, through Resend.
--
-- 1. public.monthly_recap: one row per account that has been sent a recap or
--    has touched the switch. `enabled` is the Settings switch (on until turned
--    off; no row means on). `stop_token` is the one-click "Stop the monthly
--    recap" link in the email footer, so it works without signing in.
--    `last_sent_month` makes a rerun harmless: a month is never sent twice.
--    No table grants to anon or authenticated: the dashboard reads and writes
--    through the two functions below, keyed on auth.uid().
--
-- 2. public.monthly_recap_runs: one row per scheduled run. The cron job inserts
--    the row, then calls the function with its id; the function claims it (once,
--    within five minutes) before sending anything. The id is the only thing that
--    lets a call send to everyone, it is never shown, and it is spent on first
--    use, so the function needs no shared secret and the schedule needs none in
--    the database. The function writes back what happened.
--
-- 3. monthly_recap_setting() / set_monthly_recap(boolean): the switch, for the
--    signed-in caller only.
--
-- 4. monthly_recap_recipients(p_month, p_user): service_role only. Who gets
--    the email for 'YYYY-MM' (months are Europe/Rome calendar months, the
--    product's home time; the function shifts every event the same way), with
--    the all-time counts the milestone line needs and each person's stop token.
--    Confirmed, active accounts only; a row in monthly_recap is created here so
--    the token exists before the email is written. With p_user it answers for
--    that one person whatever their switch, activity or last send: the
--    "Email me last month's recap" button in Settings.
--
-- 5. monthly_recap_library(p_user): service_role only. The snippets, folders and
--    prompts that person can read, by the same rule as the tables' select
--    policies (own rows, or a team folder app.can_read_folder allows), so "3 of
--    the 112 in your library" matches the dashboard. auth.uid() is set to the
--    person for the call, which is what app.can_read_folder reads.
--
-- 6. monthly_recap_kick(): what the cron job runs. Records the run for the
--    month that just ended and asks the edge function to send it (pg_net, so the
--    database does not wait). Scheduled at 07:00 UTC on the 1st: 08:00 or
--    09:00 in Rome.
--
-- Needs pg_cron and pg_net, enabled here.
--
-- Undo: services/supabase/rollbacks/20261104120000_monthly_recap.undo.sql

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 1 ──────────────────────────────────────────────────────────────────────────
create table if not exists public.monthly_recap (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  stop_token uuid not null default gen_random_uuid() unique,
  last_sent_month text check (last_sent_month is null or last_sent_month ~ '^\d{4}-\d{2}$'),
  updated_at timestamptz not null default now()
);

alter table public.monthly_recap enable row level security;
revoke all on public.monthly_recap from public, anon, authenticated;
grant all on public.monthly_recap to service_role;

-- 2 ──────────────────────────────────────────────────────────────────────────
create table if not exists public.monthly_recap_runs (
  id uuid primary key default gen_random_uuid(),
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz,
  sent integer,
  skipped integer,
  failed integer,
  note text
);

alter table public.monthly_recap_runs enable row level security;
revoke all on public.monthly_recap_runs from public, anon, authenticated;
grant all on public.monthly_recap_runs to service_role;

-- 3 ──────────────────────────────────────────────────────────────────────────
create or replace function public.monthly_recap_setting()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(
    (select r.enabled from monthly_recap r where r.user_id = auth.uid()),
    auth.uid() is not null
  );
$$;

revoke all on function public.monthly_recap_setting() from public, anon;
grant execute on function public.monthly_recap_setting() to authenticated;

create or replace function public.set_monthly_recap(p_enabled boolean)
returns boolean
language plpgsql
volatile security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to change this setting.';
  end if;
  insert into monthly_recap (user_id, enabled)
  values (auth.uid(), coalesce(p_enabled, true))
  on conflict (user_id) do update
    set enabled = excluded.enabled,
        updated_at = now();
  return coalesce(p_enabled, true);
end;
$$;

revoke all on function public.set_monthly_recap(boolean) from public, anon;
grant execute on function public.set_monthly_recap(boolean) to authenticated;

-- 4 ──────────────────────────────────────────────────────────────────────────
create or replace function public.monthly_recap_recipients(p_month text, p_user uuid default null)
returns table(
  user_id uuid,
  email text,
  all_time_before bigint,
  all_time_after bigint,
  best_month_before bigint,
  stop_token uuid
)
language plpgsql
volatile security definer
set search_path to 'public', 'auth'
as $$
#variable_conflict use_column
declare
  v_from timestamptz;
  v_to timestamptz;
begin
  if p_month is null or p_month !~ '^\d{4}-\d{2}$' then
    raise exception 'month must be YYYY-MM';
  end if;
  v_from := ((p_month || '-01')::timestamp) at time zone 'Europe/Rome';
  v_to := (((p_month || '-01')::date + interval '1 month')::timestamp) at time zone 'Europe/Rome';

  -- Everyone who used something this month (or the one person asked for),
  -- with a recap row and so a token.
  insert into monthly_recap (user_id)
  select distinct e.user_id
    from (
      select s.user_id from snippet_events s where s.created_at >= v_from and s.created_at < v_to
      union
      select p.user_id from prompt_events p where p.created_at >= v_from and p.created_at < v_to
      union
      select p_user where p_user is not null
    ) e
    join auth.users u on u.id = e.user_id
  on conflict (user_id) do nothing;

  return query
  select u.id,
         u.email::text,
         (select count(*) from snippet_events s where s.user_id = u.id and s.created_at < v_from),
         (select count(*) from snippet_events s where s.user_id = u.id and s.created_at < v_to),
         coalesce((
           select max(m.n)
             from (
               select count(*) as n
                 from snippet_events s
                where s.user_id = u.id and s.created_at < v_from
                group by date_trunc('month', s.created_at at time zone 'Europe/Rome')
             ) m
         ), 0),
         r.stop_token
    from monthly_recap r
    join auth.users u on u.id = r.user_id
   where u.email is not null
     and u.email_confirmed_at is not null
     and u.deleted_at is null
     and (u.banned_until is null or u.banned_until < now())
     and (
       (p_user is not null and u.id = p_user)
       or (
         p_user is null
         and r.enabled
         and (r.last_sent_month is null or r.last_sent_month <> p_month)
         and exists (
           select 1 from snippet_events s where s.user_id = u.id and s.created_at >= v_from and s.created_at < v_to
           union all
           select 1 from prompt_events p where p.user_id = u.id and p.created_at >= v_from and p.created_at < v_to
         )
       )
     )
   order by u.email;
end;
$$;

revoke all on function public.monthly_recap_recipients(text, uuid) from public, anon, authenticated;
grant execute on function public.monthly_recap_recipients(text, uuid) to service_role;

-- 5 ──────────────────────────────────────────────────────────────────────────
create or replace function public.monthly_recap_library(p_user uuid)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $$
declare
  v_snippets jsonb;
  v_folders jsonb;
  v_prompts jsonb;
begin
  if p_user is null then
    raise exception 'p_user is required';
  end if;
  -- app.can_read_folder() reads auth.uid(); for this call that is the person.
  perform set_config('request.jwt.claims', json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'title', s.title, 'shortcut', s.shortcut, 'folder_id', s.folder_id,
           'lang', s.lang, 'created_at', s.created_at)), '[]'::jsonb)
    into v_snippets
    from snippets s
   where s.user_id = p_user
      or (s.organization_id is not null and s.folder_id is not null and app.can_read_folder(s.folder_id));

  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name)), '[]'::jsonb)
    into v_folders
    from folders f
   where f.user_id = p_user
      or (f.organization_id is not null and app.can_read_folder(f.id));

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'shortcut', p.shortcut)), '[]'::jsonb)
    into v_prompts
    from prompts p
   where p.user_id = p_user
      or (p.organization_id is not null and p.folder_id is not null and app.can_read_folder(p.folder_id));

  return jsonb_build_object('snippets', v_snippets, 'folders', v_folders, 'prompts', v_prompts);
end;
$$;

revoke all on function public.monthly_recap_library(uuid) from public, anon, authenticated;
grant execute on function public.monthly_recap_library(uuid) to service_role;

-- 6 ──────────────────────────────────────────────────────────────────────────
create or replace function public.monthly_recap_kick()
returns uuid
language plpgsql
volatile security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_month text;
  v_run uuid;
begin
  v_month := to_char((now() at time zone 'Europe/Rome') - interval '1 month', 'YYYY-MM');
  insert into monthly_recap_runs (month) values (v_month) returning id into v_run;
  perform net.http_post(
    url := 'https://eyowustlbqujaimaxggt.supabase.co/functions/v1/monthly-recap',
    body := jsonb_build_object('run', v_run),
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 300000
  );
  return v_run;
end;
$$;

revoke all on function public.monthly_recap_kick() from public, anon, authenticated, service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'monthly-recap';
select cron.schedule('monthly-recap', '0 7 1 * *', $$select public.monthly_recap_kick();$$);

commit;
