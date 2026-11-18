-- Undo for 20261118130000_referrals.sql.
--
-- Switch Refer a friend off in the dashboard first (REFERRALS_OPEN in
-- app/src/lib/referral.ts), or the window and every new sign-up through a
-- link will fail to read.
--
-- Removes every link and every record of who invited whom. Free months
-- already given stay on the accounts: they live in app_metadata.pro_until,
-- which this does not touch.

drop trigger if exists referral_on_plan_change on auth.users;
drop function if exists app.referral_on_plan_change();
drop function if exists public.referral_claim(text);
drop function if exists public.referral_summary();
drop function if exists app.referral_grant(uuid);
drop function if exists app.referral_add_month(jsonb);
drop function if exists app.referral_meta_is_pro(jsonb);
drop function if exists app.referral_new_code();
drop table if exists app.referrals;
drop table if exists app.referral_codes;
