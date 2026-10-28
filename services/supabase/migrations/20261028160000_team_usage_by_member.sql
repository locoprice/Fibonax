-- ANALYTICS-002 · Fibonax
-- Date: 2026-10-28
--
-- Backs the "Team" table on the Analytics page (dashboard and phone): who on
-- the team uses the shared snippets, how often, and how many different ones,
-- over one window of time.
--
-- snippet_events RLS is select-own, so nobody can read a teammate's rows
-- directly; this is SECURITY DEFINER for the same reason as
-- shared_snippet_last_use(), which already shows "Last used by NAME" on shared
-- snippet cards. It exposes no more than that function does, only counted:
--   - only events on snippets in a team folder the CALLER can read
--     (app.can_read_folder, the branch accessible_snippets() uses), so a
--     personal snippet's use is never counted or revealed, nor a folder the
--     caller was not given;
--   - one row per person with a total, never individual events or times;
--   - the name the way org_member_directory() resolves it (display name, then
--     email).
-- Events are trustworthy: the insert policy's WITH CHECK (auth.uid() = user_id)
-- guarantees user_id is the real actor.
--
-- The window is [p_from, p_to). It must run forward and span at most 400 days,
-- so a call cannot ask for the whole table at once. Built like the fast
-- snippet_usage_counts(): events first, then the snippets they touch, then
-- app.can_read_folder once per DISTINCT folder.
--
-- Undo: DROP FUNCTION public.team_usage_by_member(timestamptz, timestamptz);
-- Nothing else depends on it, and the pages hide the Team table when it is gone.

CREATE OR REPLACE FUNCTION public.team_usage_by_member(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(user_id uuid, member_name text, uses bigint, snippets bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  WITH ev AS (
    SELECT e.snippet_id, e.user_id
      FROM snippet_events e
     WHERE p_from IS NOT NULL
       AND p_to IS NOT NULL
       AND p_to > p_from
       AND p_to - p_from <= interval '400 days'
       AND auth.uid() IS NOT NULL
       AND e.created_at >= p_from
       AND e.created_at < p_to
       AND e.snippet_id IS NOT NULL
       AND e.user_id IS NOT NULL
  ),
  cand AS (
    SELECT s.id, s.folder_id
      FROM snippets s
     WHERE s.id IN (SELECT DISTINCT ev.snippet_id FROM ev)
       AND s.organization_id IS NOT NULL
       AND s.folder_id IS NOT NULL
  ),
  readable AS (
    SELECT f.folder_id
      FROM (SELECT DISTINCT c.folder_id FROM cand c) f
     WHERE app.can_read_folder(f.folder_id)
  ),
  shared AS (
    SELECT c.id FROM cand c WHERE c.folder_id IN (SELECT r.folder_id FROM readable r)
  )
  SELECT ev.user_id,
         COALESCE(NULLIF(u.raw_user_meta_data->>'display_name', ''), u.email)::text,
         count(*)::bigint,
         count(DISTINCT ev.snippet_id)::bigint
    FROM ev
    JOIN shared ON shared.id = ev.snippet_id
    LEFT JOIN auth.users u ON u.id = ev.user_id
   GROUP BY ev.user_id, u.raw_user_meta_data, u.email;
$$;

REVOKE ALL ON FUNCTION public.team_usage_by_member(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_usage_by_member(timestamptz, timestamptz) TO authenticated;
