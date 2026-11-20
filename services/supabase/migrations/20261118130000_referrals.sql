-- Refer a friend · a private link, up to 3 friends, a free month of Pro each.
--
-- THE RULE (Valentina, 2026-11-18). A person shares their own link with up to
-- 3 friends. A friend who opens an account through it and subscribes to Pro
-- within 7 days of opening that account earns one free month of Pro for
-- themself and one for the person who invited them.
--
-- NOT APPLIED YET. Payments are not connected, so nobody can subscribe and the
-- dashboard keeps the feature switched off (REFERRALS_OPEN in
-- app/src/lib/referral.ts). Apply this when the switch is turned on, after a
-- rolled-back trial on the live project. Steps: docs/pro-features/README.md.
--
-- WHAT IS KEPT. app.referral_codes: one code per person, made the first time
-- they open the Refer a friend window. app.referrals: one row per friend who
-- joined through a link (who invited them, when, the last day to subscribe,
-- and when the free months were given). No email address, no name: the window
-- reads the friend's address from the account and shows it masked.
--
-- WHO CAN TOUCH IT. Nobody directly: both tables sit in the unexposed `app`
-- schema with every privilege revoked. The two public functions key on
-- auth.uid() and accept no user id, so a caller reads their own link and
-- friends, and can only place themself under a friend's code.
--
-- THE 3 PLACES. A place is taken by a friend who earned the free month, or who
-- still has time to subscribe. A friend whose 7 days ran out frees the place.
-- So one person can earn 3 free months at most. referral_claim() locks the
-- code's row before counting, so two friends racing for the last place cannot
-- both get it.
--
-- THE 7 DAYS start when the friend's account was opened (auth.users.created_at),
-- not when the code was entered, and are stored on the row as `deadline`. A
-- code cannot be entered on an account older than 7 days, on an account that
-- is already Pro, or twice.
--
-- THE REWARD needs no call from billing. A trigger on auth.users watches the
-- plan: when an account's app_metadata turns Pro, or its pro_until moves, and
-- that account is a friend still inside their 7 days, both people get one
-- month added to pro_until (starting from today, or from the day their paid
-- time ends when that is later). It is given once per friend. The month the
-- trigger writes does not count as subscribing: it runs under a
-- transaction-local flag that the trigger skips, so a reward never sets off
-- another reward. Pro granted by hand counts as subscribing, as billing will.
--
-- WHEN BILLING ARRIVES it must add to pro_until, never write an earlier date
-- over a later one, or it would take the free month back.
--
-- NEVER IN THE WAY. The trigger sits on the table every sign-in writes to. It
-- fires only when app_metadata changed and the new plan is 'pro', and anything
-- that goes wrong inside it is logged and swallowed: a referral problem must
-- never stop a sign-in or a payment.
--
-- Account deletion needs nothing new: every column that points at a person is
-- ON DELETE CASCADE, so delete_account() takes the rows with the account. A
-- free month already given to the other person stays.
--
-- Additive: no existing table, policy or function is touched.
-- Undo: services/supabase/rollbacks/20261118130000_referrals.undo.sql

create table if not exists app.referral_codes (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  code       text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_at timestamptz not null default now()
);

create table if not exists app.referrals (
  friend_id   uuid primary key references auth.users(id) on delete cascade,
  referrer_id uuid not null references auth.users(id) on delete cascade,
  joined_at   timestamptz not null default now(),
  deadline    timestamptz not null,
  rewarded_at timestamptz,
  check (friend_id <> referrer_id)
);

create index if not exists referrals_referrer_idx on app.referrals (referrer_id);

alter table app.referral_codes enable row level security;
alter table app.referrals enable row level security;
revoke all on app.referral_codes from public, anon, authenticated;
revoke all on app.referrals from public, anon, authenticated;

-- ── A new code ─────────────────────────────────────────────────────────────
-- 8 characters from 32 that cannot be misread (no 0, O, 1 or I), so a code
-- read out over the phone still works. The caller retries on a duplicate.
create or replace function app.referral_new_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes    bytea := uuid_send(gen_random_uuid());
  v_code     text := '';
begin
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_code;
end;
$$;

-- ── Is this account Pro right now ──────────────────────────────────────────
-- The rule of is_pro() (20261028150000_pro_plan.sql), for any account's
-- app_metadata rather than the caller's.
create or replace function app.referral_meta_is_pro(p_meta jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_until timestamptz;
begin
  if p_meta is null or p_meta->>'plan' is distinct from 'pro' then
    return false;
  end if;
  begin
    v_until := (p_meta->>'pro_until')::timestamptz;
  exception when others then
    return false;
  end;
  return v_until is not null and isfinite(v_until) and v_until > now();
end;
$$;

-- ── One more month ─────────────────────────────────────────────────────────
-- The month starts today, or when the time already paid for ends if that is
-- later. pro_until is written as ISO 8601 with its offset, as is_pro() reads it.
create or replace function app.referral_add_month(p_meta jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_from timestamptz := now();
begin
  if app.referral_meta_is_pro(p_meta) then
    v_from := (p_meta->>'pro_until')::timestamptz;
  end if;
  return coalesce(p_meta, '{}'::jsonb)
      || jsonb_build_object('plan', 'pro', 'pro_until', v_from + interval '1 month');
end;
$$;

-- ── Give the free months ───────────────────────────────────────────────────
-- True when this call gave them. Once per friend: the row is locked, and
-- rewarded_at is set in the same transaction as the two accounts' new dates.
create or replace function app.referral_grant(p_friend uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row app.referrals%rowtype;
begin
  select * into v_row
    from app.referrals
   where friend_id = p_friend
     and rewarded_at is null
     for update;

  if not found or v_row.deadline <= now() then
    return false;
  end if;

  if not exists (
    select 1 from auth.users u
     where u.id = p_friend and app.referral_meta_is_pro(u.raw_app_meta_data)
  ) then
    return false;
  end if;

  -- Transaction-local: tells the trigger below that these two writes are the
  -- reward itself, not somebody subscribing.
  perform set_config('app.referral_granting', '1', true);
  update auth.users
     set raw_app_meta_data = app.referral_add_month(raw_app_meta_data)
   where id in (p_friend, v_row.referrer_id);
  perform set_config('app.referral_granting', '', true);

  update app.referrals
     set rewarded_at = now()
   where friend_id = p_friend;

  return true;
end;
$$;

revoke all on function app.referral_grant(uuid) from public, anon, authenticated;

-- ── Watch the plan ─────────────────────────────────────────────────────────
create or replace function app.referral_on_plan_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.referral_granting', true), '') = '1' then
    return null;
  end if;

  -- Only a step up counts: newly Pro, or a paid-until date that moved.
  if old.raw_app_meta_data->>'plan' is not distinct from 'pro'
     and old.raw_app_meta_data->>'pro_until' is not distinct from new.raw_app_meta_data->>'pro_until' then
    return null;
  end if;

  begin
    perform app.referral_grant(new.id);
  exception when others then
    perform set_config('app.referral_granting', '', true);
    raise warning 'referral reward skipped for %: %', new.id, sqlerrm;
  end;

  return null;
end;
$$;

drop trigger if exists referral_on_plan_change on auth.users;
create trigger referral_on_plan_change
  after update of raw_app_meta_data on auth.users
  for each row
  when (new.raw_app_meta_data->>'plan' = 'pro'
        and new.raw_app_meta_data is distinct from old.raw_app_meta_data)
  execute function app.referral_on_plan_change();

-- ── The caller's link and friends ──────────────────────────────────────────
-- Everything the Refer a friend window shows, in one read. The code is made
-- here, the first time the window is opened.
--   friends[].state: 'waiting' (still has time), 'rewarded', 'expired'
--   invited: the caller's own place under a friend's link, or null
--   can_enter_code: the caller may still type a friend's code
create or replace function public.referral_summary()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_max     constant integer := 3;
  v_days    constant integer := 7;
  v_code    text;
  v_created timestamptz;
  v_meta    jsonb;
  v_friends jsonb;
  v_invited jsonb;
  v_used    integer;
begin
  if v_uid is null then
    return null;
  end if;

  select u.created_at, u.raw_app_meta_data into v_created, v_meta
    from auth.users u
   where u.id = v_uid;
  if not found then
    return null;
  end if;

  select c.code into v_code from app.referral_codes c where c.user_id = v_uid;
  while v_code is null loop
    begin
      insert into app.referral_codes (user_id, code)
      values (v_uid, app.referral_new_code())
      on conflict (user_id) do nothing;
    exception when unique_violation then
      null;  -- the code was taken: the loop draws another
    end;
    select c.code into v_code from app.referral_codes c where c.user_id = v_uid;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'label', left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2),
           'joined_at', r.joined_at,
           'deadline', r.deadline,
           'state', case
             when r.rewarded_at is not null then 'rewarded'
             when r.deadline > now() then 'waiting'
             else 'expired'
           end
         ) order by r.joined_at), '[]'::jsonb),
         count(*) filter (where r.rewarded_at is not null or r.deadline > now())
    into v_friends, v_used
    from app.referrals r
    join auth.users u on u.id = r.friend_id
   where r.referrer_id = v_uid;

  select jsonb_build_object(
           'deadline', r.deadline,
           'state', case
             when r.rewarded_at is not null then 'rewarded'
             when r.deadline > now() then 'waiting'
             else 'expired'
           end)
    into v_invited
    from app.referrals r
   where r.friend_id = v_uid;

  return jsonb_build_object(
    'code', v_code,
    'max_friends', v_max,
    'days', v_days,
    'places_used', v_used,
    'friends', v_friends,
    'invited', v_invited,
    'can_enter_code', v_invited is null
                      and v_created + make_interval(days => v_days) > now()
                      and not app.referral_meta_is_pro(v_meta)
  );
end;
$$;

-- ── Join under a friend's code ─────────────────────────────────────────────
-- Answers one word, which the dashboard turns into a sentence:
--   ok          the caller now sits under that friend's link
--   unknown     no such code
--   own         the caller's own code
--   already     the caller already joined through a link
--   too_late    the account is older than 7 days
--   already_pro the account is already Pro
--   full        that friend's 3 places are taken
--   signed_out  nobody is signed in
create or replace function public.referral_claim(p_code text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_max      constant integer := 3;
  v_days     constant integer := 7;
  v_code     text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_referrer uuid;
  v_created  timestamptz;
  v_meta     jsonb;
  v_used     integer;
begin
  if v_uid is null then
    return 'signed_out';
  end if;

  if v_code !~ '^[A-HJ-NP-Z2-9]{8}$' then
    return 'unknown';
  end if;

  -- The lock makes friends of the same person take their places one at a time.
  select c.user_id into v_referrer
    from app.referral_codes c
   where c.code = v_code
     for update;
  if not found then
    return 'unknown';
  end if;

  if v_referrer = v_uid then
    return 'own';
  end if;

  if exists (select 1 from app.referrals r where r.friend_id = v_uid) then
    return 'already';
  end if;

  select u.created_at, u.raw_app_meta_data into v_created, v_meta
    from auth.users u
   where u.id = v_uid;
  if not found or v_created + make_interval(days => v_days) <= now() then
    return 'too_late';
  end if;

  if app.referral_meta_is_pro(v_meta) then
    return 'already_pro';
  end if;

  select count(*) into v_used
    from app.referrals r
   where r.referrer_id = v_referrer
     and (r.rewarded_at is not null or r.deadline > now());
  if v_used >= v_max then
    return 'full';
  end if;

  begin
    insert into app.referrals (friend_id, referrer_id, deadline)
    values (v_uid, v_referrer, v_created + make_interval(days => v_days));
  exception when unique_violation then
    return 'already';
  end;

  return 'ok';
end;
$$;

revoke execute on function public.referral_summary() from public, anon;
revoke execute on function public.referral_claim(text) from public, anon;
grant execute on function public.referral_summary() to authenticated;
grant execute on function public.referral_claim(text) to authenticated;
