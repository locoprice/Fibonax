-- Undo for 20261125120000_health_check.sql.
--
-- Drops the health check. Switch off the outside monitor first, or it reports
-- the database as down.

begin;

drop function if exists public.health_check();

commit;
