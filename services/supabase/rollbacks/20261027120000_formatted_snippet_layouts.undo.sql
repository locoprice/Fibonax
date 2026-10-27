-- UNDO for 20261027120000_formatted_snippet_layouts.sql
--
-- Puts back the 14-argument save_snippet_with_revision and the review guard
-- from 20261005120000_review_status.sql, then drops the four layout columns.
--
-- Dropping the columns deletes every saved layout and every layout kept in
-- version history. The project is on the free plan, so there is no restore
-- point: once run, the layouts are gone. Each snippet keeps its plain text.
-- Run it only after every dashboard and extension in use has stopped naming
-- body_html or bodies_html in a select, or their snippet lists fail to load.

drop function if exists public.save_snippet_with_revision(
  text, text, text, text, jsonb, text, text, boolean, boolean,
  integer, integer, text, text, text[], text, jsonb
);

create function public.save_snippet_with_revision(
  p_snippet_id            text,
  p_title                 text,
  p_shortcut              text,
  p_body                  text,
  p_bodies                jsonb,
  p_lang                  text,
  p_folder_id             text,
  p_pinned                boolean,
  p_enable_urgency_timer  boolean,
  p_timer_duration_ms     integer,
  p_scarcity_count        integer,
  p_editor_display        text,
  p_edit_note             text     DEFAULT NULL,
  p_alternative_queries   text[]   DEFAULT '{}'
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_next  integer;
  v_uid   uuid := auth.uid();
BEGIN
  -- Personal owner OR org-folder edit/owner (Phase B write guard, unchanged).
  PERFORM 1
    FROM snippets
   WHERE id = p_snippet_id
     AND ( user_id = v_uid
        OR ( organization_id IS NOT NULL
             AND folder_id IS NOT NULL
             AND app.can_write_folder(folder_id) ) )
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'snippet not found or access denied (id=%)', p_snippet_id;
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next
    FROM snippet_revisions
   WHERE snippet_id = p_snippet_id;

  INSERT INTO snippet_revisions
    (snippet_id, version_number, editor_id, editor_display, title, body, bodies, edit_note)
  VALUES
    (p_snippet_id, v_next, v_uid, p_editor_display, p_title, p_body, p_bodies, p_edit_note);

  UPDATE snippets
     SET title                 = p_title,
         shortcut              = p_shortcut,
         body                  = p_body,
         bodies                = p_bodies,
         lang                  = p_lang,
         folder_id             = p_folder_id,
         pinned                = p_pinned,
         enable_urgency_timer  = p_enable_urgency_timer,
         timer_duration_ms     = p_timer_duration_ms,
         scarcity_count        = p_scarcity_count,
         alternative_queries   = p_alternative_queries,
         updated_at            = now()
   WHERE id = p_snippet_id;

  RETURN v_next;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_snippet_with_revision(
  text, text, text, text, jsonb, text, text, boolean, boolean,
  integer, integer, text, text, text[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_snippet_with_revision(
  text, text, text, text, jsonb, text, text, boolean, boolean,
  integer, integer, text, text, text[]
) TO authenticated, service_role;

create or replace function app.review_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_row       jsonb := to_jsonb(new);
  v_org       uuid := nullif(v_row ->> 'organization_id', '')::uuid;
  v_approver  boolean;
  v_keys      text[];
  v_changed   boolean := false;
  v_key       text;
  -- Statuses only an approver may set or leave.
  c_reviewed  constant text[] := array['approved', 'deprecated', 'archived'];
begin
  -- No signed-in user: service role, migrations, token-authenticated MCP
  -- functions. They are trusted server code and set what they set.
  if v_uid is null then
    return new;
  end if;

  v_approver := case
    when v_org is not null then coalesce(app.org_role(v_org) = 'admin', false)
    else new.user_id = v_uid
  end;

  if tg_op = 'INSERT' then
    -- Something new from a non-approver waits for an approver, whatever the
    -- client asked for.
    if not v_approver and new.review_status = any (c_reviewed) then
      new.review_status := 'under_review';
    end if;
    -- Nobody reviewed it yet; a client cannot claim otherwise.
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;

  -- UPDATE from here on.
  if new.review_status is distinct from old.review_status then
    if not v_approver
       and (new.review_status = any (c_reviewed) or old.review_status = any (c_reviewed)) then
      raise exception 'review: only a team admin can change this status'
        using errcode = '42501';
    end if;
  else
    -- Status untouched. A non-approver's content edit to an approved item
    -- sends it back for review. Usage writes (pin, last used, counts, the
    -- enable switch) are not content and leave it alone.
    if not v_approver and old.review_status = 'approved' then
      v_keys := case tg_table_name
        when 'snippets'      then array['title', 'body', 'bodies']
        when 'prompts'       then array['name', 'content', 'blocks']
        when 'memory_shards' then array['name', 'summary', 'body']
        else array[]::text[]
      end;
      foreach v_key in array v_keys loop
        if (v_row -> v_key) is distinct from (to_jsonb(old) -> v_key) then
          v_changed := true;
          exit;
        end if;
      end loop;
      -- Moving into a team is a change too: otherwise a member could approve
      -- something as its personal owner, then move it into a team folder
      -- already approved.
      if v_org is not null
         and v_org is distinct from nullif(to_jsonb(old) ->> 'organization_id', '')::uuid then
        v_changed := true;
      end if;
      if v_changed then
        new.review_status := 'under_review';
      end if;
    end if;
  end if;

  -- Who reviewed it, and when, is stamped here and nowhere else.
  if new.review_status is distinct from old.review_status
     and new.review_status = any (c_reviewed) then
    new.reviewed_by := v_uid;
    new.reviewed_at := now();
  else
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;

  return new;
end;
$$;

alter table public.snippet_revisions
  drop column if exists bodies_html,
  drop column if exists body_html;

alter table public.snippets
  drop constraint if exists snippets_bodies_html_shape,
  drop constraint if exists snippets_body_html_size,
  drop column if exists bodies_html,
  drop column if exists body_html;
