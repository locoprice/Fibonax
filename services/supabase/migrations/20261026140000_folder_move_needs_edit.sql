-- Tenancy · putting a snippet or prompt into a team folder needs edit rights there.
--
-- A new snippet or prompt in a team folder already needed them: the INSERT
-- policies ask app.can_write_folder(folder_id). Moving one there did not. The
-- UPDATE policies let the owner through on `auth.uid() = user_id` alone, and
-- app.enforce_asset_tenancy only guarded the way out of a team. So any account
-- could create a personal snippet and then point its folder_id at another
-- team's folder; the trigger stamped that team's organization_id and the
-- snippet appeared to everyone who can read the folder, trigger included.
-- save_snippet_with_revision and save_prompt_with_version (SECURITY DEFINER, so
-- no row security) let a caller do the same on create or save. Found by the
-- 2026-10-26 audit.
--
-- The check lives in the trigger, so every path is covered: a direct update,
-- the two save functions, and any later caller. It applies when a signed-in
-- caller creates an item in a team folder or changes its folder to one: they
-- must be able to edit the destination (app.can_write_folder). Unchanged:
-- edits that keep the folder, moves out of a team (still owner or admin),
-- the folder cascade (cascade_folder_org changes organization_id only), and
-- trusted server work with no signed-in caller (account deletion, the SQL
-- editor), which row security does not see either.
--
-- The function is the one from 20261018120000_delete_account.sql with one
-- block added. Rules only: no row is touched.
-- Undo: services/supabase/rollbacks/20261026140000_folder_move_needs_edit.undo.sql

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

  if auth.uid() is not null
     and new.organization_id is not null
     and (tg_op = 'INSERT' or new.folder_id is distinct from old.folder_id)
     and not coalesce(app.can_write_folder(new.folder_id), false) then
    raise exception
      'tenancy: you can only put items in a team folder you are allowed to edit'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
