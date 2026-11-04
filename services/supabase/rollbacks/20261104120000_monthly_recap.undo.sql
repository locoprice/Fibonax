-- UNDO for 20261104120000_monthly_recap.sql
--
-- Stops the schedule and removes the recap tables and functions. Every
-- "Stop the monthly recap" choice is lost with the table, so take the
-- `monthly-recap` edge function down first (or leave it: with no tables it
-- answers an error and sends nothing). pg_cron and pg_net stay enabled: nothing
-- else uses them yet, and dropping an extension is a bigger step than this.

begin;

select cron.unschedule(jobid) from cron.job where jobname = 'monthly-recap';

drop function if exists public.monthly_recap_kick();
drop function if exists public.monthly_recap_library(uuid);
drop function if exists public.monthly_recap_recipients(text, uuid);
drop function if exists public.set_monthly_recap(boolean);
drop function if exists public.monthly_recap_setting();

drop table if exists public.monthly_recap_runs;
drop table if exists public.monthly_recap;

commit;
