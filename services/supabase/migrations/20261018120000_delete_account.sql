-- Delete account (v3.72.0)
--
-- WHAT
-- A person can delete their own account from Settings → Account. The
-- `delete-account` edge function calls public.delete_account() with the
-- caller's id (taken from the verified JWT, never from the request body), then
-- removes their files from storage.
--
-- WHAT HAPPENS TO WHAT (the owners' decision, 2026-10-18)
--   * Personal snippets, prompts, folders, labels and every Brain: deleted.
--   * Team snippets, prompts and folders the person owns: handed to another
--     admin of that team, so teammates keep them.
--   * A team where the person is the only admin: deleted for everyone, with
--     everything in it. The dashboard names these teams before asking.
--   * History rows, invitations, shares and team records they authored stay,
--     with the author cleared.
--
-- WHY THE SCHEMA CHANGES
-- Six foreign keys to auth.users had no ON DELETE action, so anyone who had
-- ever edited a snippet or a Brain item, created a team, invited someone or
-- shared a folder could not be deleted at all. They become nullable and
-- ON DELETE SET NULL. Every reader already tolerates a missing author: the
-- invitation readers LEFT JOIN auth.users, and history rows carry their own
-- `editor_display`.
--
-- The two tenancy triggers pin user_id on every UPDATE (F1: an edit grantee
-- must never steal ownership). The handover is the one legitimate ownership
-- change, so they now let it through when, and only when, the caller has no
-- JWT (server code) AND the transaction-local `app.account_handover` names the
-- row's current owner. Only delete_account() sets that, and it is granted to
-- service_role alone. Both function bodies are otherwise the live definitions.
-- The audit stamp (updated_by) gets the same narrow exception, see section 2.
--
-- Atomic: delete_account() runs in one transaction, including the auth.users
-- row. A failure anywhere leaves the account exactly as it was.

begin;

-- ── 1. Authors become optional ──────────────────────────────────────────────
alter table public.organizations alter column created_by drop not null;
alter table public.organizations drop constraint organizations_created_by_fkey,
  add constraint organizations_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.teams alter column created_by drop not null;
alter table public.teams drop constraint teams_created_by_fkey,
  add constraint teams_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.organization_invitations alter column invited_by drop not null;
alter table public.organization_invitations drop constraint organization_invitations_invited_by_fkey,
  add constraint organization_invitations_invited_by_fkey
  foreign key (invited_by) references auth.users(id) on delete set null;

alter table public.folder_permissions alter column granted_by drop not null;
alter table public.folder_permissions drop constraint folder_permissions_granted_by_fkey,
  add constraint folder_permissions_granted_by_fkey
  foreign key (granted_by) references auth.users(id) on delete set null;

alter table public.snippet_revisions alter column editor_id drop not null;
alter table public.snippet_revisions drop constraint snippet_revisions_editor_id_fkey,
  add constraint snippet_revisions_editor_id_fkey
  foreign key (editor_id) references auth.users(id) on delete set null;

alter table public.memory_shard_versions alter column editor_id drop not null;
alter table public.memory_shard_versions drop constraint memory_shard_versions_editor_id_fkey,
  add constraint memory_shard_versions_editor_id_fkey
  foreign key (editor_id) references auth.users(id) on delete set null;

-- ── 2. Tenancy triggers admit the handover, and nothing else ────────────────
create or replace function app.is_account_handover(p_owner uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select auth.uid() is null
     and coalesce(current_setting('app.account_handover', true), '') = p_owner::text;
$$;

create or replace function app.enforce_asset_tenancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder_org uuid;
begin
  if tg_op = 'UPDATE' and not app.is_account_handover(old.user_id) then
    new.user_id := old.user_id;
  end if;

  if new.folder_id is null then
    v_folder_org := null;
  else
    select organization_id into v_folder_org from folders where id = new.folder_id;
  end if;
  new.organization_id := v_folder_org;

  if tg_op = 'UPDATE'
     and old.organization_id is not null
     and new.organization_id is distinct from old.organization_id then
    if not ( app.org_role(old.organization_id) = 'admin'
             or app.folder_level(old.folder_id) = 'owner' ) then
      raise exception
        'tenancy: only the folder owner or an org admin may move this asset out of its organization'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create or replace function app.enforce_folder_tenancy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if not app.is_account_handover(old.user_id) then
      new.user_id := old.user_id;
    end if;

    if old.organization_id is null and new.organization_id is not null then
      if not (auth.uid() = old.user_id and app.is_org_member(new.organization_id)) then
        raise exception
          'tenancy: you may only share your own folder into an organization you belong to'
          using errcode = 'check_violation';
      end if;
    elsif old.organization_id is not null
          and new.organization_id is distinct from old.organization_id then
      if not (app.org_role(old.organization_id) = 'admin' or auth.uid() = old.user_id) then
        raise exception
          'tenancy: only the folder owner or an org admin may move this folder out of its organization'
          using errcode = 'check_violation';
      end if;
    end if;

  elsif tg_op = 'INSERT' then
    if new.organization_id is not null and not app.is_org_member(new.organization_id) then
      raise exception
        'tenancy: cannot create a folder in an organization you do not belong to'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- The audit stamp re-fills updated_by on every update, which undid
-- ON DELETE SET NULL and blocked deleting anyone who had ever edited a
-- snippet or a prompt. It now lets the stamp clear while that author's own
-- account is being deleted, and only then. Otherwise the live definition.
create or replace function app.stamp_asset_audit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_by := coalesce(auth.uid(), new.user_id);
  elsif new.updated_by is null and app.is_account_handover(old.updated_by) then
    -- The author's account is being deleted: keep the cleared stamp.
    null;
  elsif new.updated_at is distinct from old.updated_at then
    new.updated_by := coalesce(auth.uid(), old.updated_by);
  else
    -- Usage-only write (updated_at untouched): keep the previous author.
    new.updated_by := old.updated_by;
  end if;
  return new;
end;
$$;

-- ── 3. One plan, read by the preview and by the delete ──────────────────────
-- One row per team the person belongs to. The team is deleted when nobody
-- else is in it, or when the person is its only admin. Otherwise recipient
-- takes over their team items: the longest-standing other admin. A team that
-- has no admin at all (and so loses none) falls back to a manager, then a
-- member, so a regular member leaving never deletes a team.
create or replace function app.account_deletion_plan(p_user uuid)
returns table (organization_id uuid, org_name text, other_members int, recipient uuid)
language sql
stable
security definer
set search_path = public
as $$
  select o.id,
         o.name,
         others.n,
         case
           when me.role = 'admin' and not others.has_admin then null
           else (select m.user_id from organization_members m
                  where m.organization_id = o.id and m.user_id <> p_user
                  order by case m.role when 'admin' then 0 when 'manager' then 1 else 2 end,
                           m.created_at, m.user_id
                  limit 1)
         end
    from organizations o
    join organization_members me on me.organization_id = o.id and me.user_id = p_user
    cross join lateral (
      select count(*)::int as n, coalesce(bool_or(m.role = 'admin'), false) as has_admin
        from organization_members m
       where m.organization_id = o.id and m.user_id <> p_user
    ) others;
$$;

revoke all on function app.account_deletion_plan(uuid) from public;

-- What the confirmation dialog shows: the teams that would be deleted for
-- everyone. Teams handed over are not listed; nothing is lost there.
create or replace function public.account_deletion_preview()
returns table (organization_id uuid, org_name text, other_members int)
language sql
stable
security definer
set search_path = public
as $$
  select p.organization_id, p.org_name, p.other_members
    from app.account_deletion_plan(auth.uid()) p
   where p.recipient is null
   order by p.org_name;
$$;

revoke all on function public.account_deletion_preview() from public, anon;
grant execute on function public.account_deletion_preview() to authenticated;

-- ── 4. The delete ───────────────────────────────────────────────────────────
-- Returns the ids of the teams it deleted, so the edge function can remove
-- their cover images from storage.
create or replace function public.delete_account(p_user uuid)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    record;
  v_deleted uuid[] := '{}';
begin
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then
    raise exception 'delete_account: no such user' using errcode = 'no_data_found';
  end if;

  -- Transaction-local: the tenancy triggers admit ownership changes only for
  -- rows this person owns, only for the rest of this transaction.
  perform set_config('app.account_handover', p_user::text, true);

  for v_plan in select * from app.account_deletion_plan(p_user) loop
    if v_plan.recipient is not null then
      -- Hand team items to the other admin. Folders first, so the items'
      -- folder lookups already see the new owner.
      update folders  set user_id = v_plan.recipient
       where user_id = p_user and organization_id = v_plan.organization_id;
      update snippets set user_id = v_plan.recipient
       where user_id = p_user and organization_id = v_plan.organization_id;
      update prompts  set user_id = v_plan.recipient
       where user_id = p_user and organization_id = v_plan.organization_id;
    else
      -- No other admin: the team goes, with everything in it, for everyone.
      delete from snippets
       where organization_id = v_plan.organization_id
          or folder_id in (select id from folders where organization_id = v_plan.organization_id);
      delete from prompts
       where organization_id = v_plan.organization_id
          or folder_id in (select id from folders where organization_id = v_plan.organization_id);
      delete from folder_permissions
       where (principal_type = 'organization' and principal_id = v_plan.organization_id)
          or (principal_type = 'team' and principal_id in
                (select id from teams where organization_id = v_plan.organization_id));
      delete from folders where organization_id = v_plan.organization_id;
      delete from organizations where id = v_plan.organization_id;
      v_deleted := v_deleted || v_plan.organization_id;
    end if;
  end loop;

  -- Other people's prompts filed in this person's personal folders would block
  -- the folder delete (prompts.folder_id has no ON DELETE action). They become
  -- unfiled, as snippets already do through their own foreign key.
  update prompts set folder_id = null
   where user_id <> p_user
     and folder_id in (select id from folders where user_id = p_user);

  -- Rows that point at this person without a foreign key.
  delete from folder_permissions where principal_type = 'user' and principal_id = p_user;
  delete from snippet_events where user_id = p_user;

  -- Everything else the person owns goes with the account through ON DELETE
  -- CASCADE: personal snippets, prompts and folders, labels, every Brain and
  -- its items, documents, tokens and audit, memberships, sessions, sign-ins.
  delete from auth.users where id = p_user;

  return v_deleted;
end;
$$;

revoke all on function public.delete_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;

commit;
