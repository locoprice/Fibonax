-- FiboTokens · step 1 of the system: counting on the server.
--
-- From January 1, 2027 every use of a snippet, a prompt or a Brain is decided
-- here, once, for every surface: the free daily uses first (15 snippets, 10
-- prompts, 5 Brains), then one FiboToken per use, and a Pro account is never
-- counted. The numbers are the ones the pricing page promises (PRICING in
-- scripts/templates/pricing.html).
--
-- DECISIONS (Valentina, 2026-11-18):
-- - "Today" is the person's own day, in their own time zone. The surface sends
--   its time zone; the account keeps it and lets it change once a day, so
--   moving the clock cannot hand out a second allowance.
-- - Each person has their own free uses and FiboTokens. A team shares nothing.
-- - A use made without a connection is never blocked: the surface sends it
--   later with p_offline, and it is counted on the day it happened. With no
--   free use and no FiboToken left it is kept as 'grace' and costs nothing.
--   A balance never goes below zero.
-- - A Brain use is each time a Brain's text is handed out (Copy whole Brain,
--   Use now, Context insert, a prompt carrying a Brain). Reading one is free.
--
-- THE SWITCH. Nothing is counted before app.fibotoken_settings.counting_from
-- (2027-01-01 00:00, Italian time). Until then fibotoken_spend() answers
-- 'not_started' and writes nothing, so the surfaces can ship calling it
-- before the sale date.
--
-- WHAT IS KEPT.
-- - app.fibotoken_accounts: one row per person: the balance and the time zone.
-- - app.fibotoken_ledger: every FiboToken in or out. Purchases, refunds and
--   grants one row each, keyed by their reference (the payment id), so a
--   payment can never be credited twice. Uses add up into one row per day.
-- - app.fibotoken_uses: one row per counted use (which kind, which day, how it
--   was paid), no item and no text. It answers "how many free uses are left
--   today" and stops a retried call from counting twice. Rows older than 35
--   days are deleted by the person's next use.
--
-- WHO CAN TOUCH IT. Nobody directly: the tables live in the unexposed `app`
-- schema with every privilege revoked. Signed-in people reach them only through
-- fibotoken_spend() and fibotoken_status(), keyed on auth.uid() with no user id
-- to vary. fibotoken_credit() takes a user id, so only the service role (the
-- payment webhook, or the owners by hand) may call it. Same shape as
-- ai_call_allow (20261026150000_ai_call_limit.sql).
--
-- Additive: no existing table, policy or function is touched. Every row
-- cascades with its account, so delete_account() needs no change.
-- Undo: services/supabase/rollbacks/20261118120000_fibotokens.undo.sql

create table if not exists app.fibotoken_settings (
  id                    boolean primary key default true check (id),
  counting_from         timestamptz not null,
  free_snippets_per_day integer not null check (free_snippets_per_day >= 0),
  free_prompts_per_day  integer not null check (free_prompts_per_day >= 0),
  free_brains_per_day   integer not null check (free_brains_per_day >= 0),
  tokens_per_snippet    integer not null check (tokens_per_snippet > 0),
  tokens_per_prompt     integer not null check (tokens_per_prompt > 0),
  tokens_per_brain      integer not null check (tokens_per_brain > 0)
);

insert into app.fibotoken_settings
  (counting_from, free_snippets_per_day, free_prompts_per_day, free_brains_per_day,
   tokens_per_snippet, tokens_per_prompt, tokens_per_brain)
values ('2027-01-01T00:00:00+01:00', 15, 10, 5, 1, 1, 1)
on conflict (id) do nothing;

create table if not exists app.fibotoken_accounts (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  balance          integer not null default 0 check (balance >= 0),
  time_zone        text,
  time_zone_set_at timestamptz,
  created_at       timestamptz not null default now()
);

create table if not exists app.fibotoken_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  delta      integer not null check (delta <> 0),
  reason     text not null check (reason in ('purchase', 'refund', 'grant', 'adjust', 'use')),
  ref        text not null check (length(ref) between 1 and 200),
  note       text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, reason, ref)
);

create table if not exists app.fibotoken_uses (
  user_id     uuid not null references auth.users(id) on delete cascade,
  use_id      uuid not null,
  kind        text not null check (kind in ('snippet', 'prompt', 'brain')),
  day         date not null,
  paid_by     text not null check (paid_by in ('free', 'token', 'grace')),
  used_at     timestamptz not null,
  recorded_at timestamptz not null default now(),
  primary key (user_id, use_id)
);

create index if not exists fibotoken_uses_user_day
  on app.fibotoken_uses (user_id, day, kind);

alter table app.fibotoken_settings enable row level security;
alter table app.fibotoken_accounts enable row level security;
alter table app.fibotoken_ledger   enable row level security;
alter table app.fibotoken_uses     enable row level security;
revoke all on app.fibotoken_settings from public, anon, authenticated;
revoke all on app.fibotoken_accounts from public, anon, authenticated;
revoke all on app.fibotoken_ledger   from public, anon, authenticated;
revoke all on app.fibotoken_uses     from public, anon, authenticated;

-- The account's time zone: kept on first use, changed at most once a day,
-- an unknown name ignored. Returns the zone to count in.
create or replace function app.fibotoken_zone(p_uid uuid, p_time_zone text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone text;
  v_set_at timestamptz;
begin
  select a.time_zone, a.time_zone_set_at into v_zone, v_set_at
    from app.fibotoken_accounts a
   where a.user_id = p_uid;

  if p_time_zone is not null
     and p_time_zone is distinct from v_zone
     and (v_set_at is null or v_set_at < now() - interval '1 day')
     and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_time_zone) then
    update app.fibotoken_accounts
       set time_zone = p_time_zone, time_zone_set_at = now()
     where user_id = p_uid;
    v_zone := p_time_zone;
  end if;

  return coalesce(v_zone, 'Europe/Rome');
end;
$$;

revoke all on function app.fibotoken_zone(uuid, text) from public, anon, authenticated;

-- One use of a snippet, a prompt or a Brain. Call it once per use with a new
-- p_use_id; calling again with the same id counts nothing and answers the same.
-- Answers { allowed, paid_by, free_left, balance }:
--   paid_by 'pro' | 'not_started' | 'free' | 'token' | 'grace' | null (allowed false)
create or replace function public.fibotoken_spend(
  p_kind      text,
  p_use_id    uuid,
  p_time_zone text default null,
  p_used_at   timestamptz default null,
  p_offline   boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_set app.fibotoken_settings%rowtype;
  v_used_at timestamptz;
  v_zone text;
  v_day date;
  v_free integer;
  v_cost integer;
  v_used integer;
  v_balance integer;
  v_paid text;
begin
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'paid_by', null, 'error', 'signed_out');
  end if;
  if p_kind is null or p_kind not in ('snippet', 'prompt', 'brain') or p_use_id is null then
    return jsonb_build_object('allowed', false, 'paid_by', null, 'error', 'bad_request');
  end if;

  if public.is_pro() then
    return jsonb_build_object('allowed', true, 'paid_by', 'pro', 'free_left', null, 'balance', null);
  end if;

  select * into v_set from app.fibotoken_settings where id;

  -- A late use counts on the day it happened, at most a week back; a time in
  -- the future is now.
  v_used_at := least(now(), greatest(coalesce(p_used_at, now()), now() - interval '7 days'));

  if v_used_at < v_set.counting_from then
    return jsonb_build_object('allowed', true, 'paid_by', 'not_started', 'free_left', null, 'balance', null);
  end if;

  insert into app.fibotoken_accounts (user_id) values (v_uid) on conflict (user_id) do nothing;
  -- One use at a time per person, so two at once cannot spend the same token.
  select a.balance into v_balance from app.fibotoken_accounts a where a.user_id = v_uid for update;

  v_zone := app.fibotoken_zone(v_uid, p_time_zone);
  v_day := (v_used_at at time zone v_zone)::date;

  v_free := case p_kind when 'snippet' then v_set.free_snippets_per_day
                        when 'prompt'  then v_set.free_prompts_per_day
                        else v_set.free_brains_per_day end;
  v_cost := case p_kind when 'snippet' then v_set.tokens_per_snippet
                        when 'prompt'  then v_set.tokens_per_prompt
                        else v_set.tokens_per_brain end;

  select u.paid_by into v_paid
    from app.fibotoken_uses u
   where u.user_id = v_uid and u.use_id = p_use_id;

  if v_paid is null then
    delete from app.fibotoken_uses
     where user_id = v_uid and used_at < now() - interval '35 days';

    select count(*) into v_used
      from app.fibotoken_uses u
     where u.user_id = v_uid and u.day = v_day and u.kind = p_kind and u.paid_by = 'free';

    if v_used < v_free then
      v_paid := 'free';
    elsif v_balance >= v_cost then
      v_paid := 'token';
      v_balance := v_balance - v_cost;
      update app.fibotoken_accounts set balance = v_balance where user_id = v_uid;
      insert into app.fibotoken_ledger (user_id, delta, reason, ref)
      values (v_uid, -v_cost, 'use', 'use:' || v_day::text)
      on conflict (user_id, reason, ref)
      do update set delta = app.fibotoken_ledger.delta - v_cost, updated_at = now();
    elsif coalesce(p_offline, false) then
      v_paid := 'grace';
    else
      return jsonb_build_object('allowed', false, 'paid_by', null, 'free_left', 0, 'balance', v_balance);
    end if;

    insert into app.fibotoken_uses (user_id, use_id, kind, day, paid_by, used_at)
    values (v_uid, p_use_id, p_kind, v_day, v_paid, v_used_at);
  end if;

  select count(*) into v_used
    from app.fibotoken_uses u
   where u.user_id = v_uid and u.day = v_day and u.kind = p_kind and u.paid_by = 'free';

  return jsonb_build_object('allowed', true, 'paid_by', v_paid,
                            'free_left', greatest(v_free - v_used, 0), 'balance', v_balance);
end;
$$;

revoke all on function public.fibotoken_spend(text, uuid, text, timestamptz, boolean) from public, anon;
grant execute on function public.fibotoken_spend(text, uuid, text, timestamptz, boolean) to authenticated;

-- What the Balance card shows: the balance, today's free uses left per kind,
-- and whether counting has started. Reads only.
create or replace function public.fibotoken_status(p_time_zone text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_set app.fibotoken_settings%rowtype;
  v_zone text;
  v_day date;
  v_balance integer;
  v_snippets integer;
  v_prompts integer;
  v_brains integer;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'signed_out');
  end if;

  select * into v_set from app.fibotoken_settings where id;

  select a.balance, a.time_zone into v_balance, v_zone
    from app.fibotoken_accounts a
   where a.user_id = v_uid;

  if v_zone is null
     and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_time_zone) then
    v_zone := p_time_zone;
  end if;
  v_zone := coalesce(v_zone, 'Europe/Rome');
  v_day := (now() at time zone v_zone)::date;

  select count(*) filter (where u.kind = 'snippet'),
         count(*) filter (where u.kind = 'prompt'),
         count(*) filter (where u.kind = 'brain')
    into v_snippets, v_prompts, v_brains
    from app.fibotoken_uses u
   where u.user_id = v_uid and u.day = v_day and u.paid_by = 'free';

  return jsonb_build_object(
    'counting', now() >= v_set.counting_from,
    'counting_from', v_set.counting_from,
    'pro', public.is_pro(),
    'balance', coalesce(v_balance, 0),
    'day', v_day,
    'snippets', jsonb_build_object('free', v_set.free_snippets_per_day,
                                   'left', greatest(v_set.free_snippets_per_day - v_snippets, 0)),
    'prompts',  jsonb_build_object('free', v_set.free_prompts_per_day,
                                   'left', greatest(v_set.free_prompts_per_day - v_prompts, 0)),
    'brains',   jsonb_build_object('free', v_set.free_brains_per_day,
                                   'left', greatest(v_set.free_brains_per_day - v_brains, 0))
  );
end;
$$;

revoke all on function public.fibotoken_status(text) from public, anon;
grant execute on function public.fibotoken_status(text) to authenticated;

-- FiboTokens in or out by the payment webhook or the owners: 'purchase' and
-- 'grant' add p_tokens, 'refund' takes them back, 'adjust' adds or takes
-- (negative p_tokens). p_ref identifies the event (the payment id), so the same
-- event twice changes nothing. A take never goes below zero: it takes what is
-- left. Answers { applied, delta, balance }.
create or replace function public.fibotoken_credit(
  p_user   uuid,
  p_tokens integer,
  p_reason text,
  p_ref    text,
  p_note   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
  v_delta integer;
  v_id bigint;
begin
  if p_user is null or p_tokens is null or p_tokens = 0
     or p_reason is null or p_reason not in ('purchase', 'refund', 'grant', 'adjust')
     or p_ref is null or length(p_ref) not between 1 and 200
     or (p_reason in ('purchase', 'refund', 'grant') and p_tokens < 0) then
    raise exception 'fibotoken_credit: bad request' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'fibotoken_credit: no such account' using errcode = '22023';
  end if;

  insert into app.fibotoken_accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  select a.balance into v_balance from app.fibotoken_accounts a where a.user_id = p_user for update;

  v_delta := case when p_reason = 'refund' then -p_tokens else p_tokens end;
  if v_delta < 0 then
    v_delta := -least(-v_delta, v_balance);
  end if;
  if v_delta = 0 then
    return jsonb_build_object('applied', false, 'delta', 0, 'balance', v_balance);
  end if;

  insert into app.fibotoken_ledger (user_id, delta, reason, ref, note)
  values (p_user, v_delta, p_reason, p_ref, p_note)
  on conflict (user_id, reason, ref) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('applied', false, 'delta', 0, 'balance', v_balance);
  end if;

  v_balance := v_balance + v_delta;
  update app.fibotoken_accounts set balance = v_balance where user_id = p_user;
  return jsonb_build_object('applied', true, 'delta', v_delta, 'balance', v_balance);
end;
$$;

revoke all on function public.fibotoken_credit(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.fibotoken_credit(uuid, integer, text, text, text) to service_role;
