-- AI features · a per-person limit on calls to the AI service.
--
-- Sign-up is open, and draft-with-ai and ask-sprintbrain are live: until now
-- any account could call them as often as it liked, and every call is paid
-- for. Each AI edge function now asks ai_call_allow() right before it calls
-- the model; the answer is false once the caller has made 30 AI calls in the
-- last hour or 200 in the last day, all features together, and the function
-- answers 429 rate_limited with Retry-After. Found by the 2026-10-26 audit.
--
-- The callers: draft-with-ai, ask-sprintbrain, translate-body, suggest-labels,
-- read-picture. p_kind names which one, so a log can tell them apart; the
-- limit itself counts them together.
--
-- WHAT IS KEPT. One row per call: who, which feature, when. Not the text, not
-- the answer. Rows older than a day are deleted by the next call from the same
-- person, so the table holds at most a day of timestamps per account.
--
-- WHO CAN TOUCH IT. Nobody directly: the table lives in the unexposed `app`
-- schema with every privilege revoked, and the only way in is the function,
-- which keys on auth.uid() and accepts no user id. The edge functions call it
-- with the caller's own JWT, keeping their "no service-role client" promise.
-- Same shape as link_read_allow (20261008120000_link_reads.sql).
--
-- Additive: no existing table, policy or function is touched.
-- Apply BEFORE deploying the AI edge functions that call it: while it is
-- missing they answer 503 rather than call the model unchecked.
-- Undo: services/supabase/rollbacks/20261026150000_ai_call_limit.undo.sql

create table if not exists app.ai_calls (
  id        bigint generated always as identity primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  kind      text not null,
  called_at timestamptz not null default now()
);

create index if not exists ai_calls_user_time on app.ai_calls (user_id, called_at desc);

alter table app.ai_calls enable row level security;
revoke all on app.ai_calls from public, anon, authenticated;

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
