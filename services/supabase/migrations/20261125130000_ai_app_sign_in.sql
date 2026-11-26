-- AI apps · "Sign in with Fibonax": connecting an AI app without copying a link.
--
-- The directories of Claude and ChatGPT list an app only when a person connects
-- it by signing in (OAuth 2.1), never by pasting a key. This migration is the
-- database half of that sign-in. The other halves are the hosted MCP server
-- (services/supabase/functions/mcp: the /authorize, /token and /register
-- addresses) and the dashboard's /connect page, where the person says yes.
--
-- WHY NOT SUPABASE'S OWN OAUTH SERVER. Its access tokens are ordinary user
-- sessions with one extra claim: "full access to user data (same as regular
-- session tokens)". An AI app holding one could read snippets, delete an
-- account or mint a browser session, and custom scopes do not exist. So the
-- sign-in is built here instead, and what an app receives is one of our own
-- keys from public.memory_tokens: hashed, scoped (read, prompts, write),
-- rate limited, listed and switched off in Settings > Integrations > AI apps,
-- and good for nothing but public.mcp_call (20261121120000_ai_app_link.sql).
--
-- THE FLOW, and what each step stores:
-- 1. The AI app registers itself (mcp_oauth_register): a name and the exact
--    addresses it may send people back to. No secret: these are public
--    clients, protected by PKCE.
-- 2. The person approves on the dashboard, signed in (mcp_oauth_approve). A
--    one-time code is stored hashed, with the app, the return address, the
--    PKCE challenge and whether saving was allowed. It lasts 5 minutes.
-- 3. The app trades the code for a key (mcp_oauth_token): the code is deleted
--    whatever the outcome, the PKCE proof must match, and a memory_tokens row
--    is made. The key lasts 1 hour and comes with a refresh secret, also
--    stored hashed, that trades for a new pair; both change at every refresh,
--    so a stolen old one is worthless.
--
-- Nothing an anonymous caller sends chooses a person: the person comes from
-- the dashboard session in step 2, and from the code or refresh secret after.
--
-- Additive. The existing keys, mcp_call and the Settings card are untouched;
-- a connection made by signing in is one more row there.
-- Undo: services/supabase/rollbacks/20261125130000_ai_app_sign_in.undo.sql

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists app.mcp_oauth_clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  redirect_uris text[] not null check (array_length(redirect_uris, 1) between 1 and 10),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

comment on table app.mcp_oauth_clients is
  'AI apps · An AI app that registered itself to offer "Sign in with Fibonax". Public clients: no secret, exact return addresses only.';

create table if not exists app.mcp_oauth_codes (
  code_hash      text primary key,
  client_id      uuid not null references app.mcp_oauth_clients(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,
  can_save       boolean not null default false,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);

create index if not exists mcp_oauth_codes_user_idx on app.mcp_oauth_codes (user_id);

comment on table app.mcp_oauth_codes is
  'AI apps · One-time approval codes, hashed, 5 minutes. Deleted when traded, right or wrong.';

alter table app.mcp_oauth_clients enable row level security;
alter table app.mcp_oauth_codes   enable row level security;
revoke all on app.mcp_oauth_clients from public, anon, authenticated;
revoke all on app.mcp_oauth_codes   from public, anon, authenticated;

alter table public.memory_tokens
  add column if not exists oauth_client_id uuid references app.mcp_oauth_clients(id) on delete cascade,
  add column if not exists refresh_hash    text;

create unique index if not exists memory_tokens_refresh_uniq
  on public.memory_tokens (refresh_hash) where refresh_hash is not null;

comment on column public.memory_tokens.oauth_client_id is
  'Set when the key was made by signing in from an AI app, not by copying a link. Its expires_at is then the 1 hour life of the current key; the connection lives on through refresh_hash.';

-- The owner reads their keys' names and dates in Settings, never a hash. Until
-- now the whole row was readable; the hashes are no use to their owner and
-- should not travel to a browser.
revoke select on public.memory_tokens from authenticated;
grant select (id, user_id, name, prefix, created_at, last_used_at, expires_at, revoked_at, scopes, oauth_client_id)
  on public.memory_tokens to authenticated;

-- ── Shared pieces ───────────────────────────────────────────────────────────

-- A fresh secret: a short prefix saying what it is, then 244 random bits.
create or replace function app.mcp_secret(p_prefix text)
returns text
language sql
volatile
set search_path = ''
as $$
  select p_prefix
         || replace(gen_random_uuid()::text, '-', '')
         || replace(gen_random_uuid()::text, '-', '');
$$;

revoke all on function app.mcp_secret(text) from public, anon, authenticated;

-- An address an AI app may send people back to. https anywhere; plain http
-- only to the person's own computer (desktop apps listen there); an app's own
-- scheme (cursor://…) for installed apps. Never a script or a file.
create or replace function app.mcp_redirect_ok(p_uri text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_uri is not null
     and char_length(p_uri) between 8 and 400
     and p_uri !~ '[\s#<>"''\\]'
     and (
           p_uri ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/|$)'
        or p_uri ~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?(/|$)'
        or (p_uri ~ '^[a-z][a-z0-9+.-]{1,30}://' and p_uri !~* '^(https?|javascript|data|file|vbscript|about|blob|ftp|ws|wss):')
     );
$$;

revoke all on function app.mcp_redirect_ok(text) from public, anon, authenticated;

-- ── 1. An AI app registers itself ───────────────────────────────────────────
--
-- Open to anyone, as dynamic client registration is meant to be, so it is
-- bounded: 300 registrations an hour across everyone, and a registration
-- nobody ever approved is forgotten after 2 days.

create or replace function public.mcp_oauth_register(p_name text, p_redirect_uris text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);
  v_id   uuid;
begin
  if v_name = '' then
    v_name := 'AI app';
  end if;
  if p_redirect_uris is null
     or coalesce(array_length(p_redirect_uris, 1), 0) not between 1 and 10
     or exists (select 1 from unnest(p_redirect_uris) u where not app.mcp_redirect_ok(u)) then
    return jsonb_build_object('error', 'invalid_redirect_uri');
  end if;

  delete from app.mcp_oauth_clients c
   where c.created_at < now() - interval '2 days'
     and not exists (select 1 from public.memory_tokens t where t.oauth_client_id = c.id)
     and not exists (select 1 from app.mcp_oauth_codes k where k.client_id = c.id);

  if (select count(*) from app.mcp_oauth_clients c where c.created_at > now() - interval '1 hour') >= 300 then
    return jsonb_build_object('error', 'slow_down');
  end if;

  insert into app.mcp_oauth_clients (name, redirect_uris)
  values (v_name, p_redirect_uris)
  returning id into v_id;

  return jsonb_build_object('client_id', v_id, 'client_name', v_name, 'redirect_uris', to_jsonb(p_redirect_uris));
end; $$;

comment on function public.mcp_oauth_register(text, text[]) is
  'AI apps · Dynamic client registration for "Sign in with Fibonax". Public clients only; return addresses checked and matched exactly later.';

revoke all on function public.mcp_oauth_register(text, text[]) from public;
grant execute on function public.mcp_oauth_register(text, text[]) to anon, authenticated;

-- ── The app's name, for the approval page ───────────────────────────────────
--
-- Null for an unknown app. `redirect_ok` says whether the return address is
-- one the app registered, letter for letter: the page refuses to send anyone
-- anywhere else.

create or replace function public.mcp_oauth_client(p_client_id uuid, p_redirect_uri text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('name', c.name, 'redirect_ok', coalesce(p_redirect_uri = any (c.redirect_uris), false))
    from app.mcp_oauth_clients c
   where c.id = p_client_id;
$$;

comment on function public.mcp_oauth_client(uuid, text) is
  'AI apps · A registered AI app''s name, and whether a return address is one of its own.';

revoke all on function public.mcp_oauth_client(uuid, text) from public;
grant execute on function public.mcp_oauth_client(uuid, text) to anon, authenticated;

-- ── 2. The person approves ──────────────────────────────────────────────────
--
-- Signed-in callers only; the person is auth.uid(). Returns the one-time code,
-- or raises with a sentence the page shows.

create or replace function public.mcp_oauth_approve(
  p_client_id      uuid,
  p_redirect_uri   text,
  p_code_challenge text,
  p_can_save       boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then
    raise exception 'Sign in to Fibonax first.' using errcode = '42501';
  end if;
  if not exists (select 1 from app.mcp_oauth_clients c
                  where c.id = p_client_id and p_redirect_uri = any (c.redirect_uris)) then
    raise exception 'This request is not valid any more. Go back to your AI app and connect again.' using errcode = 'P0001';
  end if;
  -- An S256 challenge is 32 bytes in base64url: 43 characters, always.
  if p_code_challenge is null or p_code_challenge !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'This request is not valid any more. Go back to your AI app and connect again.' using errcode = 'P0001';
  end if;

  delete from app.mcp_oauth_codes k where k.expires_at < now();
  if (select count(*) from app.mcp_oauth_codes k where k.user_id = v_uid) >= 10 then
    raise exception 'Too many tries in a few minutes. Wait a little, then connect again.' using errcode = 'P0001';
  end if;

  v_code := app.mcp_secret('sbmc_');
  insert into app.mcp_oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, can_save, expires_at)
  values (encode(sha256(v_code::bytea), 'hex'), p_client_id, v_uid, p_redirect_uri, p_code_challenge,
          coalesce(p_can_save, false), now() + interval '5 minutes');
  return v_code;
end; $$;

comment on function public.mcp_oauth_approve(uuid, text, text, boolean) is
  'AI apps · The signed-in person approves an AI app. Returns a one-time code (5 minutes, stored hashed) for the app to trade for a key.';

revoke all on function public.mcp_oauth_approve(uuid, text, text, boolean) from public, anon;
grant execute on function public.mcp_oauth_approve(uuid, text, text, boolean) to authenticated;

-- ── 3. The app trades a code, or a refresh secret, for a key ────────────────
--
-- Answers { access_token, refresh_token, expires_in, scope } or { error },
-- in OAuth's own words: invalid_grant for anything wrong with what was
-- presented (never saying which part), unsupported_grant_type, access_denied.

create or replace function public.mcp_oauth_token(
  p_grant_type   text,
  p_client_id    uuid,
  p_code         text default null,
  p_verifier     text default null,
  p_redirect_uri text default null,
  p_refresh      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_life    constant interval := interval '1 hour';
  -- A connection nobody refreshed for this long is over.
  c_idle    constant interval := interval '90 days';
  v_code    app.mcp_oauth_codes%rowtype;
  v_row     public.memory_tokens%rowtype;
  v_name    text;
  v_scopes  text[];
  v_access  text;
  v_refresh text;
begin
  if p_client_id is null then
    return jsonb_build_object('error', 'invalid_client');
  end if;

  if p_grant_type = 'authorization_code' then
    if p_code is null or p_code !~ '^sbmc_[0-9a-f]{64}$' then
      return jsonb_build_object('error', 'invalid_grant');
    end if;
    -- Deleted on sight: a code works once, and a wrong guess at its proof
    -- costs the code.
    delete from app.mcp_oauth_codes k
     where k.code_hash = encode(sha256(p_code::bytea), 'hex')
    returning * into v_code;
    if not found
       or v_code.expires_at < now()
       or v_code.client_id <> p_client_id
       or v_code.redirect_uri is distinct from p_redirect_uri
       or p_verifier is null
       or p_verifier !~ '^[A-Za-z0-9._~-]{43,128}$'
       or translate(rtrim(encode(sha256(p_verifier::bytea), 'base64'), '='), '+/', '-_') <> v_code.code_challenge then
      return jsonb_build_object('error', 'invalid_grant');
    end if;

    delete from public.memory_tokens t
     where t.oauth_client_id is not null and t.expires_at < now() - c_idle;

    if (select count(*) from public.memory_tokens t
         where t.user_id = v_code.user_id
           and t.revoked_at is null
           and (t.expires_at is null or t.expires_at > now()
                or (t.oauth_client_id is not null and t.expires_at > now() - c_idle))) >= 21 then
      return jsonb_build_object('error', 'access_denied',
        'error_description', 'This Fibonax account already has 21 AI apps connected. Switch one off in Fibonax: Settings, Integrations, AI apps.');
    end if;

    select left(c.name, 48) into v_name from app.mcp_oauth_clients c where c.id = p_client_id;
    v_scopes  := case when v_code.can_save then array['read', 'prompts', 'write'] else array['read', 'prompts'] end;
    v_access  := app.mcp_secret('sbmw_');
    v_refresh := app.mcp_secret('sbmr_');

    insert into public.memory_tokens (user_id, name, token_hash, prefix, expires_at, scopes, oauth_client_id, refresh_hash)
    values (v_code.user_id, v_name, encode(sha256(v_access::bytea), 'hex'), left(v_access, 13), now() + c_life,
            v_scopes, p_client_id, encode(sha256(v_refresh::bytea), 'hex'));

    update app.mcp_oauth_clients set last_used_at = now() where id = p_client_id;

  elsif p_grant_type = 'refresh_token' then
    if p_refresh is null or p_refresh !~ '^sbmr_[0-9a-f]{64}$' then
      return jsonb_build_object('error', 'invalid_grant');
    end if;
    select * into v_row
      from public.memory_tokens t
     where t.refresh_hash = encode(sha256(p_refresh::bytea), 'hex')
       for update;
    if not found
       or v_row.oauth_client_id is distinct from p_client_id
       or v_row.revoked_at is not null
       or v_row.expires_at < now() - c_idle then
      return jsonb_build_object('error', 'invalid_grant');
    end if;

    v_scopes  := v_row.scopes;
    v_access  := app.mcp_secret('sbmw_');
    v_refresh := app.mcp_secret('sbmr_');
    update public.memory_tokens
       set token_hash   = encode(sha256(v_access::bytea), 'hex'),
           prefix       = left(v_access, 13),
           refresh_hash = encode(sha256(v_refresh::bytea), 'hex'),
           expires_at   = now() + c_life
     where id = v_row.id;

  else
    return jsonb_build_object('error', 'unsupported_grant_type');
  end if;

  return jsonb_build_object(
    'access_token', v_access,
    'token_type', 'Bearer',
    'expires_in', extract(epoch from c_life)::int,
    'refresh_token', v_refresh,
    'scope', 'fibonax'
  );
end; $$;

comment on function public.mcp_oauth_token(text, uuid, text, text, text, text) is
  'AI apps · The token step of "Sign in with Fibonax": a one-time code plus its PKCE proof, or a refresh secret, for a 1 hour key in memory_tokens. Both secrets change at every refresh.';

revoke all on function public.mcp_oauth_token(text, uuid, text, text, text, text) from public;
grant execute on function public.mcp_oauth_token(text, uuid, text, text, text, text) to anon, authenticated;
