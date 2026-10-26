-- UNDO for 20261026130000_invitation_role_guard.sql
--
-- Puts orginv_write back as 20260606020000_phase_a_org_access_and_rls.sql wrote
-- it: any admin or manager may write any invitation row, role included. That
-- reopens the hole the migration closed (a manager making an admin), so run it
-- only if the new rule blocks something a team really needs.
--
-- Rules only: no row is touched.

alter policy orginv_write on public.organization_invitations
  using (app.org_role(organization_id) in ('admin', 'manager'))
  with check (app.org_role(organization_id) in ('admin', 'manager'));
