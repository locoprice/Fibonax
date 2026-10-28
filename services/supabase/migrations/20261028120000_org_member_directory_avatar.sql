-- Teammate photos on the Team page (v3.100.0): org_member_directory() also
-- returns avatar_url, the profile photo a person uploaded in Settings → Account
-- (or the one Google sign-in supplied), so the People list, the faces on a
-- shared folder and the share window can show photos instead of initials.
--
-- The display name read a key nothing writes: raw_user_meta_data->>'display_name'
-- is set on 0 of 87 accounts, so every member showed as their email. Settings
-- writes full_name and Google sign-in writes name, so it now reads those in
-- that order, with the email as the last resort, the way my_pending_invitations()
-- already does (20260814000000_invite_inviter_name.sql noted the defect).
--
-- Adding a column changes the return type, which CREATE OR REPLACE refuses, so
-- the function is dropped first. Nothing depends on it (no policy, view or
-- function names it), and every client reads the rows by column name.
--
-- avatar_url passes through only when it is an https URL. user_metadata is
-- written by the account itself and this function runs as its owner, so it
-- hands co-members nothing that is not already a public image address.

DROP FUNCTION IF EXISTS public.org_member_directory(uuid);

CREATE FUNCTION public.org_member_directory(p_org uuid)
RETURNS TABLE (user_id uuid, email text, display_name text, role org_role, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT m.user_id,
         u.email::text,
         COALESCE(
           NULLIF(u.raw_user_meta_data->>'full_name', ''),
           NULLIF(u.raw_user_meta_data->>'name', ''),
           u.email
         )::text,
         m.role,
         CASE
           WHEN u.raw_user_meta_data->>'avatar_url' LIKE 'https://%'
           THEN u.raw_user_meta_data->>'avatar_url'
         END::text
  FROM organization_members m
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.organization_id = p_org
    AND app.is_org_member(p_org)
  ORDER BY m.role, u.email;
$$;

COMMENT ON FUNCTION public.org_member_directory(uuid) IS
  'Member directory (id, email, name, role, photo) of an org the caller belongs to. Co-members only.';

REVOKE EXECUTE ON FUNCTION public.org_member_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_member_directory(uuid) TO authenticated, service_role;
