-- HEALTH-CHECK-001 · Fibonax
-- Date: 2026-11-25
--
-- A health check an outside monitor can call every few minutes, so the owners
-- hear about a frozen database before the users do. The database froze on
-- 2026-10-27, 2026-11-11 and 2026-11-24, and each time the first sign was
-- people unable to sign in.
--
-- public.health_check() answers true. Called through the API
-- (/rest/v1/rpc/health_check), it takes the same road every sign-in and every
-- library load takes: the gateway, PostgREST and Postgres. When the database is
-- frozen the call times out, and the monitor raises the alarm.
--
-- It reads no table and returns nothing about anyone, so the public (anon) key
-- may call it.
--
-- Additive: nothing else changes.
--
-- Undo: services/supabase/rollbacks/20261125120000_health_check.undo.sql

begin;

create or replace function public.health_check()
returns boolean
language sql
stable
set search_path to ''
as $$
  select true
$$;

comment on function public.health_check() is
  'Answers true. Called by the outside uptime monitor to tell that the database answers.';

revoke all on function public.health_check() from public;
grant execute on function public.health_check() to anon, authenticated;

commit;
