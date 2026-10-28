-- Invitations · only an admin can invite an admin.
--
-- The invite-member edge function already refuses an admin invitation from a
-- manager ("a manager must not be able to mint an admin"). The table's own
-- policy did not: orginv_write let any admin or manager insert or update an
-- invitation row directly, role included. A manager could therefore write an
-- invitation with role 'admin' to a second address of their own, accept it,
-- and become an admin of the team (accept_org_invitation copies the role from
-- the row). Found by the 2026-10-26 audit.
--
-- After this change a manager reads, adds, changes and withdraws member and
-- manager invitations only. An admin invitation is an admin's to write. Admins
-- are unchanged, and so is orginv_select: a manager still sees every
-- invitation in the list.
--
-- Rules only: the policy keeps its name, command and roles, and no row is
-- touched. Undo: services/supabase/rollbacks/20261026130000_invitation_role_guard.undo.sql

alter policy orginv_write on public.organization_invitations
  using (
    app.org_role(organization_id) = 'admin'
    or (app.org_role(organization_id) = 'manager' and role <> 'admin')
  )
  with check (
    app.org_role(organization_id) = 'admin'
    or (app.org_role(organization_id) = 'manager' and role <> 'admin')
  );
