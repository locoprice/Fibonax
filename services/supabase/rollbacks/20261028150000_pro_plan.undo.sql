-- UNDO for 20261028150000_pro_plan.sql
--
-- Opens the AI features to every signed-in account again. Run it only after
-- the AI edge functions are back on a version that does not call is_pro(): the
-- current ones answer 503 while it is missing, so every AI feature stops.
--
-- Puts ai_call_allow() back as 20261026150000_ai_call_limit.sql left it, then
-- drops is_pro(). The plan stays in each account's app_metadata, untouched.

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

drop function if exists public.is_pro();
