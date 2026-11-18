-- Undo 20261118120000_fibotokens.sql.
-- Deletes every balance, purchase record and counted use. Once FiboTokens have
-- been sold, export app.fibotoken_ledger and app.fibotoken_accounts first:
-- they are what people paid for.

drop function if exists public.fibotoken_credit(uuid, integer, text, text, text);
drop function if exists public.fibotoken_status(text);
drop function if exists public.fibotoken_spend(text, uuid, text, timestamptz, boolean);
drop function if exists app.fibotoken_zone(uuid, text);
drop table if exists app.fibotoken_uses;
drop table if exists app.fibotoken_ledger;
drop table if exists app.fibotoken_accounts;
drop table if exists app.fibotoken_settings;
