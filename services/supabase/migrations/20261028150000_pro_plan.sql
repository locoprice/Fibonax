-- AI features · Pro accounts only.
--
-- Every AI call is paid for, so the AI features belong to the Pro plan, a
-- monthly subscription. Until now any signed-in account could call the AI
-- edge functions directly: the dashboard and the phone keep the controls
-- locked, but draft-with-ai and ask-sprintbrain are deployed and answered
-- anyone with a session. This refuses an AI call from anyone who is not Pro.
--
-- WHO IS PRO. The plan lives where 20261027140000_review_prompt.sql already
-- reads it: the account's app_metadata, which only the service role can write.
-- An account is Pro while app_metadata.plan is 'pro' and app_metadata.pro_until
-- (the end of the month already paid for) has not passed, so a subscription
-- that is not renewed lapses on its own. Write pro_until as an ISO 8601
-- timestamp with its offset, as the statement below does: words such as
-- 'tomorrow' or 'infinity' are refused or never lapse. Nobody can make
-- themselves Pro from the dashboard, the phone or the API. Billing sets both
-- keys when it exists; until then the owners grant Pro by hand:
--
--     update auth.users
--        set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
--            || jsonb_build_object('plan', 'pro',
--                                  'pro_until', now() + interval '1 month')
--      where id = '<user id>';
--
-- A changed app_metadata reaches is_pro() at once; the person's own session
-- token catches up at its next refresh, which nothing here relies on.
--
-- TWO LOCKS. is_pro() is what the AI edge functions ask first, answering 403
-- pro_required so the person reads why. ai_call_allow() asks it again, so an
-- edge function still on a version without the first check cannot reach the
-- model for a free account either.
--
-- No table. ai_call_allow keeps its signature and its limits (30 calls an
-- hour, 200 a day) and gains the Pro check.
-- Apply BEFORE deploying the AI edge functions that call is_pro(): while it is
-- missing they answer 503 rather than call the model unchecked.
-- Undo: services/supabase/rollbacks/20261028150000_pro_plan.undo.sql

create or replace function public.is_pro()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_meta jsonb;
  v_until timestamptz;
begin
  select u.raw_app_meta_data into v_meta
    from auth.users u
   where u.id = auth.uid();

  if v_meta is null or v_meta->>'plan' is distinct from 'pro' then
    return false;
  end if;

  -- A missing, unreadable or endless date is not Pro: the paid-until date is
  -- what makes the plan monthly, so it is never assumed. An unreadable one is
  -- logged, since it means a paying account is being treated as free.
  begin
    v_until := (v_meta->>'pro_until')::timestamptz;
  exception when others then
    raise warning 'is_pro: unreadable pro_until for user %', auth.uid();
    return false;
  end;

  return v_until is not null and isfinite(v_until) and v_until > now();
end;
$$;

revoke all on function public.is_pro() from public, anon;
grant execute on function public.is_pro() to authenticated;

create or replace function public.ai_call_allow(p_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hour integer;
  v_day integer;
begin
  if v_uid is null then
    return false;
  end if;
  if p_kind is null
     or p_kind not in ('draft', 'ask', 'translate', 'labels', 'picture') then
    return false;
  end if;
  if not public.is_pro() then
    return false;
  end if;

  delete from app.ai_calls
   where user_id = v_uid
     and called_at < now() - interval '1 day';

  select count(*) filter (where called_at > now() - interval '1 hour'),
         count(*)
    into v_hour, v_day
    from app.ai_calls
   where user_id = v_uid;

  if v_hour >= 30 or v_day >= 200 then
    return false;
  end if;

  insert into app.ai_calls (user_id, kind) values (v_uid, p_kind);
  return true;
end;
$$;

revoke all on function public.ai_call_allow(text) from public, anon;
grant execute on function public.ai_call_allow(text) to authenticated;
