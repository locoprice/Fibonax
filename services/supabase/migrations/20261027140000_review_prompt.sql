-- Review prompt · asks free accounts for a Chrome Web Store review, at most 5 times.
--
-- WHAT IS KEPT. One row per person in app.review_prompt: how many times they
-- signed in, how many times the prompt was shown, and whether it was stopped
-- (they opened the review page, or chose "Don't ask again"). It lives on the
-- server so it follows the person to a new device and survives cleared storage.
--
-- WHO COUNTS A LOGIN. Nobody calls anything to count one. A trigger on
-- public.auth_audit_log adds 1 each time a 'login' row is written, and that row
-- is written once per real session (log_login_event dedupes on the session id,
-- and a skipped duplicate fires no trigger). The dashboard and the extension
-- both record their sign-ins there, so both feed the same count.
--
-- WHO CAN TOUCH IT. Nobody directly: the table sits in the unexposed `app`
-- schema with every privilege revoked. The three functions below key on
-- auth.uid() and accept no user id, so a caller can read and change only their
-- own row.
--
-- THE HARD CAP. view_count cannot leave 0..5: a CHECK constraint refuses a
-- sixth, and review_prompt_record_view() only counts a view while the row is not
-- stopped and holds fewer than 5. One view per sign-in session: the session id
-- of the last counted view is kept, so a reload or a second tab adds nothing.
-- The update is a single statement, so two tabs racing cannot both win.
--
-- WHEN TO SHOW is decided by the client (extension/shared/review-prompt.js and
-- app/src/lib/reviewPrompt.ts): at least 10 sign-ins, a free plan, not stopped,
-- fewer than 5 views, not yet shown in this session. Only the cap is repeated
-- here, as the one rule the server must hold on its own.
--
-- THE PLAN. A person is free unless their app_metadata (writable only by the
-- service role) carries a plan other than 'free'. Billing sets it when it exists.
--
-- Counting starts at apply: earlier sign-ins are not backfilled, so nobody sees
-- the prompt the day this ships.
--
-- Additive: no existing table, policy or function is touched.
--
-- Undo:
--   drop trigger if exists review_prompt_count_login on public.auth_audit_log;
--   drop function if exists app.review_prompt_count_login();
--   drop function if exists public.review_prompt_status();
--   drop function if exists public.review_prompt_record_view();
--   drop function if exists public.review_prompt_stop(text);
--   drop table if exists app.review_prompt;

create table if not exists app.review_prompt (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  login_count       integer not null default 0 check (login_count >= 0),
  view_count        integer not null default 0 check (view_count between 0 and 5),
  stopped_at        timestamptz,
  stop_reason       text check (stop_reason in ('reviewed', 'dismissed')),
  last_view_session text,
  updated_at        timestamptz not null default now()
);

alter table app.review_prompt enable row level security;
revoke all on app.review_prompt from public, anon, authenticated;

-- ── Count a login ──────────────────────────────────────────────────────────
create or replace function app.review_prompt_count_login()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.review_prompt as r (user_id, login_count)
  values (new.user_id, 1)
  on conflict (user_id) do update
    set login_count = r.login_count + 1,
        updated_at  = now();
  return null;
end;
$$;

drop trigger if exists review_prompt_count_login on public.auth_audit_log;
create trigger review_prompt_count_login
  after insert on public.auth_audit_log
  for each row
  when (new.event = 'login' and new.user_id is not null)
  execute function app.review_prompt_count_login();

-- ── Read the caller's state ────────────────────────────────────────────────
-- One row, or none when nobody is signed in. A person with no row yet reads as
-- all zeros.
create or replace function public.review_prompt_status()
returns table (
  login_count         integer,
  view_count          integer,
  stopped             boolean,
  plan                text,
  viewed_this_session boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(r.login_count, 0),
         coalesce(r.view_count, 0),
         r.stopped_at is not null,
         coalesce(nullif(u.raw_app_meta_data->>'plan', ''), 'free'),
         coalesce(r.last_view_session = (auth.jwt()->>'session_id'), false)
    from auth.users u
    left join app.review_prompt r on r.user_id = u.id
   where u.id = auth.uid();
$$;

-- ── Count one view ─────────────────────────────────────────────────────────
-- True only when this call added the view. The client draws the prompt only on
-- true, so a view is counted before it is shown and never shown uncounted.
create or replace function public.review_prompt_record_view()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_sid  text := auth.jwt()->>'session_id';
  v_rows integer;
begin
  if v_uid is null or v_sid is null then
    return false;
  end if;

  update app.review_prompt
     set view_count        = view_count + 1,
         last_view_session = v_sid,
         updated_at        = now()
   where user_id = v_uid
     and stopped_at is null
     and view_count < 5
     and last_view_session is distinct from v_sid;

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- ── Stop for good ──────────────────────────────────────────────────────────
-- 'reviewed' when they opened the review page, anything else counts as
-- 'dismissed'. The first stop wins, so a later call never rewrites the reason.
create or replace function public.review_prompt_stop(p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  insert into app.review_prompt as r (user_id, stopped_at, stop_reason)
  values (v_uid, now(), case when p_reason = 'reviewed' then 'reviewed' else 'dismissed' end)
  on conflict (user_id) do update
    set stopped_at  = coalesce(r.stopped_at, excluded.stopped_at),
        stop_reason = coalesce(r.stop_reason, excluded.stop_reason),
        updated_at  = now();
end;
$$;

revoke execute on function public.review_prompt_status() from public, anon;
revoke execute on function public.review_prompt_record_view() from public, anon;
revoke execute on function public.review_prompt_stop(text) from public, anon;
grant execute on function public.review_prompt_status() to authenticated;
grant execute on function public.review_prompt_record_view() to authenticated;
grant execute on function public.review_prompt_stop(text) to authenticated;
