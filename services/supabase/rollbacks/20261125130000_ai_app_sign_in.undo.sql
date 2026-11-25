-- Undo for 20261125130000_ai_app_sign_in.sql.
--
-- Removes "Sign in with Fibonax". Every connection made by signing in stops
-- working at once (its key is deleted with the app's registration); links
-- copied from Settings are untouched. Run after the `mcp` server function
-- is put back to a version without the sign-in addresses.

drop function if exists public.mcp_oauth_token(text, uuid, text, text, text, text);
drop function if exists public.mcp_oauth_approve(uuid, text, text, boolean);
drop function if exists public.mcp_oauth_client(uuid, text);
drop function if exists public.mcp_oauth_register(text, text[]);

delete from public.memory_tokens where oauth_client_id is not null;
drop index if exists public.memory_tokens_refresh_uniq;
alter table public.memory_tokens
  drop column if exists oauth_client_id,
  drop column if exists refresh_hash;

revoke select (id, user_id, name, prefix, created_at, last_used_at, expires_at, revoked_at, scopes)
  on public.memory_tokens from authenticated;
grant select on public.memory_tokens to authenticated;

drop table if exists app.mcp_oauth_codes;
drop table if exists app.mcp_oauth_clients;
drop function if exists app.mcp_redirect_ok(text);
drop function if exists app.mcp_secret(text);
