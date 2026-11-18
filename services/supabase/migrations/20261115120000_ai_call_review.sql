-- AI features · Improve with AI joins the per-person limit.
--
-- The snippet editor's Improve with AI (edge function review-snippet) reads a
-- snippet and writes suggestions. Like every AI feature it asks
-- ai_call_allow() right before it calls the model, under its own kind,
-- 'review', so a log can tell it apart. The limit itself is unchanged: 30
-- calls an hour, 200 a day, all features together, Pro accounts only.
--
-- Replaces ai_call_allow as 20261028150000_pro_plan.sql left it, with one
-- word added to the list of kinds. No table, policy or other function is
-- touched.
-- Apply BEFORE deploying review-snippet: while 'review' is unknown the
-- function answers 429 rather than call the model.
-- Undo: services/supabase/rollbacks/20261115120000_ai_call_review.undo.sql

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
     or p_kind not in ('draft', 'ask', 'translate', 'labels', 'picture', 'review') then
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
