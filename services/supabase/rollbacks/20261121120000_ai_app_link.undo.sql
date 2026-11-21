-- Undo for 20261121120000_ai_app_link.sql.
--
-- Removes the AI app link's entry point and the 'prompts' scope, and puts
-- memory_issue_token and the key grants back as 20260923000000_memory_mcp_write.sql
-- and 20260823130000_memory_grants_least_privilege.sql left them.
--
-- Run after the `mcp` server function is removed, or every link answers
-- "not valid". Keys keep working for the local MCP server: a key that reached
-- Prompts loses only that scope.

drop function if exists public.mcp_call(text, text, jsonb);
drop function if exists public.mcp_key_check(text);

update public.memory_tokens
   set scopes = array_remove(scopes, 'prompts')
 where 'prompts' = any(scopes);
-- A key whose only scope was prompts would be left with none: switch it off
-- and give it the read scope the constraint needs.
update public.memory_tokens
   set scopes = array['read'], revoked_at = coalesce(revoked_at, now())
 where array_length(scopes, 1) is null;

alter table public.memory_tokens
  drop constraint if exists memory_tokens_scopes_known;
alter table public.memory_tokens
  add constraint memory_tokens_scopes_known
    check (scopes <@ array['read', 'write']::text[] and array_length(scopes, 1) >= 1);

comment on column public.memory_tokens.scopes is
  'Deny-by-default: a token is read-only unless write was requested at issue. Never widened in place.';

grant update on public.memory_tokens to authenticated;

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
  if not (p_scopes <@ array['read', 'write']::text[]) then
    raise exception 'memory_issue_token: scopes must be read, write, or both' using errcode = '22023';
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
  'MEMORY-001 · Mints an MCP access token. Plaintext is returned once and never stored. Read-only unless write is asked for.';
