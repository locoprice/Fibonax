-- AI apps · a private link that lets an AI app read Prompts and Brains (MCP).
--
-- Owner decisions, 2026-11-21:
-- - People connect an AI app (Claude, ChatGPT and others) by pasting a link
--   made in Settings > Integrations. Nothing to install.
-- - The link reaches Prompts and Brains. Snippets stay out of reach.
-- - Saving stays a choice made when the link is made, and only ever adds a new
--   Brain item marked AI generated.
--
-- The link carries a key from public.memory_tokens, the table the working-
-- memory MCP server already authenticates with (hashed, scoped, revocable,
-- rate limited). The hosted server function (services/supabase/functions/mcp)
-- holds the publishable key only, and calls exactly one function here,
-- public.mcp_call, with the key it was given.
--
-- THE KEY ACTS AS ITS OWNER, UNDER THE SAME RULES AS THE DASHBOARD.
-- mcp_call checks the key, then becomes the key's owner for the rest of the
-- call: request.jwt.claims carries the owner's id and the role switches to
-- `authenticated`, which is what PostgREST does after checking a sign-in. Every
-- read below therefore goes through the tables' own row level security:
-- personal Brains, own prompts and prompts in a team folder the owner can read,
-- and knowledge_search exactly as the dashboard's search calls it. No rule
-- about who may read what is written a second time here.
--
-- Three details keep that switch contained:
-- - mcp_call is SECURITY INVOKER. Postgres refuses SET ROLE inside a SECURITY
--   DEFINER function, and an invoker function may only switch to a role the
--   session's own login is a member of (PostgREST's `authenticator` is a
--   member of `authenticated`; nothing grants more than that).
-- - A SET LOCAL made inside a function lasts until the end of the transaction,
--   not of the function (a function's own SET clause undoes only the settings
--   it names). So mcp_call notes the role and the claims it was called with,
--   runs every action inside one block that never returns, and puts both back
--   before it returns. Tested: after the call the caller is anon again.
-- - An error inside aborts the whole request's transaction, so nothing runs
--   after it as the key's owner either.
-- The key is checked before anything else, and a wrong, switched-off or
-- expired key returns null before the switch: the surface still does not
-- confirm which keys exist.
--
-- WHAT A KEY MAY DO, by its scopes (deny by default, never widened in place):
--   read     Brains: list, search, read (every key the dashboard makes has it)
--   prompts  Prompts: list, search, read. New here, so the keys made before
--            this migration for the local MCP server keep reaching Brains only
--   write    save a new Brain item (memory_mcp_save, unchanged)
--
-- FIBOTOKENS. Handing a prompt's or a Brain's text to an AI app is a use, like
-- Copy on any other surface, so the full-text reads call fibotoken_spend as the
-- owner (20261118120000_fibotokens.sql): one prompt use per prompt, one Brain
-- use per Brain item, whole Brain, or set of Brains a prompt carries. Lists and
-- search hand out names and summaries only and are free. Until counting starts
-- (2027-01-01) fibotoken_spend answers 'not_started' and writes nothing.
--
-- Also here:
-- - memory_issue_token accepts the new scope and stops at 21 live keys a person.
-- - A signed-in person may change only the name and the switched-off time of
--   their own keys. Until now they could rewrite every column of their own
--   rows, the scopes and the rate limit included.
--
-- Undo: services/supabase/rollbacks/20261121120000_ai_app_link.undo.sql

-- ── 1. The 'prompts' scope ──────────────────────────────────────────────────

alter table public.memory_tokens
  drop constraint if exists memory_tokens_scopes_known;
alter table public.memory_tokens
  add constraint memory_tokens_scopes_known
    check (scopes <@ array['read', 'write', 'prompts']::text[] and array_length(scopes, 1) >= 1);

comment on column public.memory_tokens.scopes is
  'Deny-by-default: read (Brains), prompts (Prompts), write (save a new Brain item). Chosen at issue, never widened in place.';

-- ── 2. Issuing a key ────────────────────────────────────────────────────────
--
-- Same signature, so CREATE OR REPLACE keeps the grants. Two changes: the
-- new scope is accepted, and a person can hold at most 21 live keys.

create or replace function public.memory_issue_token(
  p_name    text,
  p_expires timestamptz default null,
  p_scopes  text[]      default array['read']
)
returns table (token_id uuid, token text, token_prefix text, token_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_token  text;
  v_hash   text;
  v_prefix text;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'memory_issue_token: authentication required' using errcode = '42501';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'memory_issue_token: name is required' using errcode = '22023';
  end if;
  -- The table constraint would catch this too, as a constraint-violation error
  -- naming a column the caller never passed. Say what is actually wrong.
  if p_scopes is null or array_length(p_scopes, 1) is null then
    raise exception 'memory_issue_token: at least one scope is required' using errcode = '22023';
  end if;
  if not (p_scopes <@ array['read', 'write', 'prompts']::text[]) then
    raise exception 'memory_issue_token: scopes must be read, write or prompts' using errcode = '22023';
  end if;
  -- Each live key is a way into the account. 21 is room for every app a
  -- person uses, with spares, and a stop for a script making keys in a loop.
  if (select count(*) from public.memory_tokens t
       where t.user_id = v_uid
         and t.revoked_at is null
         and (t.expires_at is null or t.expires_at > now())) >= 21 then
    raise exception 'You already have 21 AI app links. Switch one off, then try again.' using errcode = 'P0001';
  end if;

  v_token  := 'sbmw_'
              || replace(gen_random_uuid()::text, '-', '')
              || replace(gen_random_uuid()::text, '-', '');
  v_hash   := encode(sha256(v_token::bytea), 'hex');
  v_prefix := left(v_token, 13);

  insert into public.memory_tokens (user_id, name, token_hash, prefix, expires_at, scopes)
  values (v_uid, btrim(p_name), v_hash, v_prefix, p_expires, p_scopes)
  returning memory_tokens.id into v_id;

  return query select v_id, v_token, v_prefix, p_expires;
end; $$;

comment on function public.memory_issue_token(text, timestamptz, text[]) is
  'MEMORY-001 · Mints an MCP access key. Plaintext is returned once and never stored. Read-only unless write is asked for; prompts only when asked for. At most 21 live keys a person.';

-- ── 3. What a person may change on their own keys ───────────────────────────

revoke update on public.memory_tokens from authenticated;
grant update (name, revoked_at) on public.memory_tokens to authenticated;

-- ── 4. The key check ────────────────────────────────────────────────────────
--
-- The key's owner and scopes, or no row. Resolving counts one request against
-- the key's rate limit (app.memory_resolve_token), so one mcp_call is one
-- request. In public because mcp_call runs as the caller and the caller (anon)
-- has no access to the `app` schema; it reveals nothing to someone without the
-- key, and only the key's own owner and scopes to someone with it.
--
-- Output names are prefixed: a plpgsql OUT variable sharing a column's name
-- makes every reference to that column ambiguous.

create or replace function public.mcp_key_check(p_token text)
returns table (key_user uuid, key_scopes text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := app.memory_resolve_token(p_token, 'read');
begin
  if v_uid is null then
    return;
  end if;
  return query
    select t.user_id, t.scopes
      from public.memory_tokens t
     where t.token_hash = encode(sha256(p_token::bytea), 'hex')
       and t.user_id = v_uid;
end; $$;

comment on function public.mcp_key_check(text) is
  'AI apps · A key''s owner and scopes, or no row when the key is unknown, switched off, expired or cannot read. Counts one request against the key''s rate limit.';

revoke all on function public.mcp_key_check(text) from public;
grant execute on function public.mcp_key_check(text) to anon, authenticated;

-- ── 5. The one entry point ──────────────────────────────────────────────────
--
-- p_action, with p_args:
--   whoami                        { prompts, save }: what this key may do
--   search       { query, limit } names and summaries of matching prompts and
--                                 Brain items, best first (knowledge_search)
--   prompts      {}               every prompt the owner can read, first 200
--   brains       {}               the owner's Brains, with their item counts
--   brain_items  { brain }        one Brain's items: names and summaries
--   prompt       { id }           one prompt's full text (a prompt use)
--   item         { id }           one Brain item's full text (a Brain use)
--   brains_text  { ids }          up to 10 whole Brains, items in the order the
--                                 other surfaces hand them out (one Brain use
--                                 when any item is handed out)
--   save         { name, text, summary, brain }  a new Brain item, AI generated
--
-- Answers jsonb, or null when the key is not valid. A refusal the server
-- function words for the person is { error: <code> }:
--   no_prompts   the key was made before Prompts could be reached
--   no_save      the key was made without saving
--   not_found    nothing with that id the owner can read
--   limit        today's free uses and the FiboTokens are used up
--   bad_request  an argument is missing or not in the expected form

create or replace function public.mcp_call(
  p_token  text,
  p_action text,
  p_args   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  c_uuid    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  -- What the call came in with, put back before it returns.
  v_role    text := current_setting('role');
  v_claims  text := current_setting('request.jwt.claims', true);
  v_sub     text := current_setting('request.jwt.claim.sub', true);
  v_uid     uuid;
  v_scopes  text[];
  v_prompts boolean;
  v_args    jsonb := coalesce(p_args, '{}'::jsonb);
  v_id      uuid;
  v_ids     uuid[];
  v_limit   int;
  v_spend   jsonb;
  v_result  jsonb;
  v_row     record;
begin
  select k.key_user, k.key_scopes into v_uid, v_scopes
    from public.mcp_key_check(p_token) k;
  if v_uid is null then
    return null;
  end if;
  v_prompts := 'prompts' = any(v_scopes);

  -- One id from p_args (id, or brain), or null when it is missing or not a uuid.
  v_id := case when coalesce(v_args ->> 'id', v_args ->> 'brain') ~ c_uuid
               then coalesce(v_args ->> 'id', v_args ->> 'brain')::uuid end;

  -- From here on, the key's owner, under the tables' own row level security.
  perform set_config('request.jwt.claims',
                     jsonb_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('role', 'authenticated', true);

  -- Every action sets v_result and leaves this block; nothing returns from
  -- inside it, so the role and the claims are always put back below.
  <<work>>
  begin
    if p_action = 'whoami' then
      v_result := jsonb_build_object('prompts', v_prompts, 'save', 'write' = any(v_scopes));
      exit work;
    end if;

    if p_action = 'search' then
      if btrim(coalesce(v_args ->> 'query', '')) = '' then
        v_result := jsonb_build_object('error', 'bad_request');
        exit work;
      end if;
      v_limit := case when coalesce(v_args ->> 'limit', '') ~ '^[0-9]{1,3}$'
                      then least(greatest((v_args ->> 'limit')::int, 1), 25) else 10 end;
      select coalesce(jsonb_agg(jsonb_build_object(
               'kind',      ks.kind,
               'id',        ks.source_id,
               'title',     ks.title,
               -- A prompt's first line is a heading (## Role); its first line
               -- of text says more, as list_prompts shows it.
               'summary',   case when ks.kind = 'prompt' then coalesce((
                              select left(btrim(l.line), 200)
                                from public.prompts p,
                                     regexp_split_to_table(p.content, E'\n') with ordinality as l(line, n)
                               where p.id::text = ks.source_id
                                 and btrim(l.line) <> '' and l.line !~ '^\s*##'
                               order by l.n limit 1), ks.summary)
                            else ks.summary end,
               'status',    ks.review_status,
               -- knowledge_search returns no container, so it is read here,
               -- under the same row level security: a Brain's or a folder's name.
               'brain_id',  case when ks.kind = 'memory' then
                              (select m.space_id from public.memory_shards m where m.id::text = ks.source_id) end,
               'container_name', case ks.kind
                   when 'memory' then (select s.name from public.memory_shards m
                                         join public.memory_spaces s on s.id = m.space_id
                                        where m.id::text = ks.source_id)
                   when 'prompt' then (select f.name from public.prompts p
                                         join public.folders f on f.id = p.folder_id
                                        where p.id::text = ks.source_id)
                 end
             ) order by ks.ord), '[]'::jsonb)
        into v_result
        from public.knowledge_search(
               v_args ->> 'query',
               case when v_prompts then array['memory', 'prompt'] else array['memory'] end,
               null, null, v_limit
             ) with ordinality as ks(kind, source_id, title, summary, tokens, rank, matched_arms, review_status, ord);
      v_result := jsonb_build_object('results', v_result);
      exit work;
    end if;

    if p_action = 'prompts' then
      if not v_prompts then
        v_result := jsonb_build_object('error', 'no_prompts');
        exit work;
      end if;
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', x.id, 'name', x.name, 'folder', x.folder, 'status', x.review_status,
               'first_line', x.first_line, 'updated_at', x.updated_at
             ) order by x.pinned desc, lower(x.name), x.id), '[]'::jsonb)
        into v_result
        from (
          select p.id, p.name, f.name as folder, p.review_status, p.updated_at, p.pinned,
                 (select left(btrim(l.line), 200)
                    from regexp_split_to_table(p.content, E'\n') with ordinality as l(line, n)
                   where btrim(l.line) <> '' and l.line !~ '^\s*##'
                   order by l.n limit 1) as first_line
            from public.prompts p
            left join public.folders f on f.id = p.folder_id
           where p.review_status <> 'archived'
           order by p.pinned desc, lower(p.name), p.id
           limit 200
        ) x;
      v_result := jsonb_build_object(
        'prompts', v_result,
        'total', (select count(*) from public.prompts p where p.review_status <> 'archived'));
      exit work;
    end if;

    if p_action = 'brains' then
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'description', s.description, 'default', s.is_default,
               'items', (select count(*) from public.memory_shards m
                          where m.space_id = s.id and m.deleted_at is null and m.review_status <> 'archived')
             ) order by s.is_default desc, lower(s.name), s.id), '[]'::jsonb)
        into v_result
        from public.memory_spaces s
       where s.deleted_at is null;
      v_result := jsonb_build_object('brains', v_result);
      exit work;
    end if;

    if p_action = 'brain_items' then
      if v_id is null then
        v_result := jsonb_build_object('error', 'bad_request');
        exit work;
      end if;
      select s.id, s.name into v_row
        from public.memory_spaces s
       where s.id = v_id and s.deleted_at is null;
      if not found then
        v_result := jsonb_build_object('error', 'not_found');
        exit work;
      end if;
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'name', m.name, 'summary', m.summary, 'tokens', m.token_estimate, 'status', m.review_status
             ) order by m.pinned desc, m.updated_at desc, m.id), '[]'::jsonb)
        into v_result
        from public.memory_shards m
       where m.space_id = v_id and m.deleted_at is null and m.review_status <> 'archived';
      v_result := jsonb_build_object('brain', jsonb_build_object('id', v_row.id, 'name', v_row.name), 'items', v_result);
      exit work;
    end if;

    if p_action = 'prompt' then
      if not v_prompts then
        v_result := jsonb_build_object('error', 'no_prompts');
        exit work;
      end if;
      if v_id is null then
        v_result := jsonb_build_object('error', 'bad_request');
        exit work;
      end if;
      select p.id, p.name, p.content, p.review_status, f.name as folder into v_row
        from public.prompts p
        left join public.folders f on f.id = p.folder_id
       where p.id = v_id and p.review_status <> 'archived';
      if not found then
        v_result := jsonb_build_object('error', 'not_found');
        exit work;
      end if;
      v_spend := public.fibotoken_spend('prompt', gen_random_uuid());
      if not coalesce((v_spend ->> 'allowed')::boolean, false) then
        v_result := jsonb_build_object('error', 'limit', 'kind', 'prompt');
        exit work;
      end if;
      v_result := jsonb_build_object('prompt', jsonb_build_object(
        'id', v_row.id, 'name', v_row.name, 'text', v_row.content,
        'status', v_row.review_status, 'folder', v_row.folder));
      exit work;
    end if;

    if p_action = 'item' then
      if v_id is null then
        v_result := jsonb_build_object('error', 'bad_request');
        exit work;
      end if;
      select m.id, m.name, m.summary, m.body, m.review_status, m.space_id, s.name as brain into v_row
        from public.memory_shards m
        join public.memory_spaces s on s.id = m.space_id and s.deleted_at is null
       where m.id = v_id and m.deleted_at is null and m.review_status <> 'archived';
      if not found then
        v_result := jsonb_build_object('error', 'not_found');
        exit work;
      end if;
      v_spend := public.fibotoken_spend('brain', gen_random_uuid());
      if not coalesce((v_spend ->> 'allowed')::boolean, false) then
        v_result := jsonb_build_object('error', 'limit', 'kind', 'brain');
        exit work;
      end if;
      v_result := jsonb_build_object('item', jsonb_build_object(
        'id', v_row.id, 'name', v_row.name, 'summary', v_row.summary, 'text', v_row.body,
        'status', v_row.review_status, 'brain_id', v_row.space_id, 'brain', v_row.brain));
      exit work;
    end if;

    if p_action = 'brains_text' then
      -- One test at a time: SQL does not promise to evaluate an OR left to
      -- right, and the length of something that is not an array is an error.
      if jsonb_typeof(v_args -> 'ids') is distinct from 'array' then
        v_result := jsonb_build_object('error', 'bad_request');
        exit work;
      end if;
      if jsonb_array_length(v_args -> 'ids') not between 1 and 10
         or exists (select 1 from jsonb_array_elements(v_args -> 'ids') e(v)
                     where jsonb_typeof(e.v) <> 'string' or (e.v #>> '{}') !~ c_uuid) then
        v_result := jsonb_build_object('error', 'bad_request');
        exit work;
      end if;
      select array_agg(distinct (e.v #>> '{}')::uuid) into v_ids
        from jsonb_array_elements(v_args -> 'ids') e(v);
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name,
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object('name', m.name, 'body', m.body)
                                  order by m.pinned desc, m.updated_at desc, m.id)
                   from public.memory_shards m
                  where m.space_id = s.id and m.deleted_at is null and m.review_status <> 'archived'
               ), '[]'::jsonb)
             ) order by s.id), '[]'::jsonb)
        into v_result
        from public.memory_spaces s
       where s.id = any(v_ids) and s.deleted_at is null;
      if exists (select 1 from jsonb_array_elements(v_result) b where jsonb_array_length(b -> 'items') > 0) then
        v_spend := public.fibotoken_spend('brain', gen_random_uuid());
        if not coalesce((v_spend ->> 'allowed')::boolean, false) then
          v_result := jsonb_build_object('error', 'limit', 'kind', 'brain');
          exit work;
        end if;
      end if;
      v_result := jsonb_build_object('brains', v_result);
      exit work;
    end if;

    if p_action = 'save' then
      if not ('write' = any(v_scopes)) then
        v_result := jsonb_build_object('error', 'no_save');
        exit work;
      end if;
      if btrim(coalesce(v_args ->> 'name', '')) = ''
         or btrim(coalesce(v_args ->> 'text', '')) = ''
         or (v_args ? 'brain' and v_id is null) then
        v_result := jsonb_build_object('error', 'bad_request');
        exit work;
      end if;
      if v_id is not null and not exists (
           select 1 from public.memory_spaces s where s.id = v_id and s.deleted_at is null) then
        v_result := jsonb_build_object('error', 'not_found');
        exit work;
      end if;
      -- The existing token write path: one row, one version, one audit entry,
      -- surface 'mcp', marked ai_generated. It checks the write scope itself.
      v_id := public.memory_mcp_save(p_token, v_args ->> 'name', v_args ->> 'text',
                                     nullif(btrim(coalesce(v_args ->> 'summary', '')), ''), v_id);
      if v_id is null then
        v_result := jsonb_build_object('error', 'no_save');
        exit work;
      end if;
      select m.id, m.name, s.id as brain_id, s.name as brain into v_row
        from public.memory_shards m
        join public.memory_spaces s on s.id = m.space_id
       where m.id = v_id;
      v_result := jsonb_build_object('saved', jsonb_build_object(
        'id', v_row.id, 'name', v_row.name, 'brain_id', v_row.brain_id, 'brain', v_row.brain));
      exit work;
    end if;

    v_result := jsonb_build_object('error', 'bad_request');
  end work;

  perform set_config('role', v_role, true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_result;
end; $$;

comment on function public.mcp_call(text, text, jsonb) is
  'AI apps · The one entry point of the hosted MCP server. Checks the key, then reads as the key''s owner under row level security (role authenticated, put back before it returns). Prompts need the prompts scope, saving the write scope. Full-text reads count a FiboToken use.';

revoke all on function public.mcp_call(text, text, jsonb) from public;
grant execute on function public.mcp_call(text, text, jsonb) to anon, authenticated;
