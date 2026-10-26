-- UNDO for 20261026140000_folder_move_needs_edit.sql
--
-- Puts app.enforce_asset_tenancy back exactly as 20261018120000_delete_account.sql
-- wrote it: no edit-rights check when an item is put into a team folder. That
-- reopens the hole the migration closed (any account planting items in another
-- team's folder), so run it only if the check blocks something a team needs.
--
-- Rules only: no row is touched.

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
