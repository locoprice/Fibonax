-- Undo for 20261115120000_ai_call_review.sql.
--
-- Puts ai_call_allow back as 20261028150000_pro_plan.sql left it, without the
-- 'review' kind. Run only after review-snippet is removed or switched off:
-- once 'review' is unknown, Improve with AI answers "used up" for everyone.

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
