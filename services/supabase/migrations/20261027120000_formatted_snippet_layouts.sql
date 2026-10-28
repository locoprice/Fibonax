-- Snippets · a formatted layout beside the plain body (Pro).
--
-- A snippet can carry a layout: the same text as formatted HTML (tables,
-- colours, bold, lists, an image), filled by the same fill form and Fill from
-- a pasted link, and pasted into Gmail as it is. The first case is a booking
-- confirmation card sent many times a day. Plan: docs/FORMATTED_SNIPPETS_DESIGN.md.
--
-- WHAT IS STORED. body_html holds the active language's layout, the way body
-- mirrors bodies; bodies_html holds one layout per language, in the shape of
-- bodies. body and bodies stay plain text carrying the same fields, derived
-- from the layout at every save, so the fill form, search, the AI functions,
-- Push to Notion and every extension from before this change keep reading
-- plain text. A snippet without a layout has body_html null and bodies_html
-- '{}'.
--
-- SAVING. save_snippet_with_revision takes two more arguments, both optional.
-- Both left out (null): the saved layout is kept, so a dashboard tab opened
-- before this change cannot wipe one. Either one given: the pair is saved
-- together, and '' with '{}' removes the layout. Each revision keeps the layout
-- it saved, so version history can restore it.
--
-- REVIEW. A layout is content: a non-approver's change to an approved
-- snippet's layout sends it back for review, as a change to its text does.
--
-- Additive: two columns on two tables, the save function rebuilt with the same
-- guard, the review guard with two more content keys. No row is touched.
-- Apply BEFORE releasing a dashboard or extension that names body_html or
-- bodies_html in a select: a select naming a missing column fails whole.
-- Undo: services/supabase/rollbacks/20261027120000_formatted_snippet_layouts.undo.sql

alter table public.snippets
  add column if not exists body_html text,
  add column if not exists bodies_html jsonb not null default '{}'::jsonb;

alter table public.snippets
  add constraint snippets_body_html_size
    check (body_html is null or octet_length(body_html) <= 200000),
  add constraint snippets_bodies_html_shape
    check (jsonb_typeof(bodies_html) = 'object' and octet_length(bodies_html::text) <= 1000000);

alter table public.snippet_revisions
  add column if not exists body_html text,
  add column if not exists bodies_html jsonb not null default '{}'::jsonb;

-- ── Save ─────────────────────────────────────────────────────────────────────
-- The 14-argument signature is dropped first so no call becomes ambiguous.
-- Every caller names its arguments and may leave the two new ones out.

drop function public.save_snippet_with_revision(
  text, text, text, text, jsonb, text, text, boolean, boolean,
  integer, integer, text, text, text[]
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
  p_edit_note             text     default null,
  p_alternative_queries   text[]   default '{}',
  p_body_html             text     default null,
  p_bodies_html           jsonb    default null
) returns integer
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_next         integer;
  v_uid          uuid := auth.uid();
  v_body_html    text;
  v_bodies_html  jsonb;
begin
  -- Personal owner OR org-folder edit/owner (Phase B write guard, unchanged).
  -- The saved layout is read under the same lock.
  select body_html, bodies_html
    into v_body_html, v_bodies_html
    from snippets
   where id = p_snippet_id
     and ( user_id = v_uid
        or ( organization_id is not null
             and folder_id is not null
             and app.can_write_folder(folder_id) ) )
     for update;

  if not found then
    raise exception 'snippet not found or access denied (id=%)', p_snippet_id;
  end if;

  -- Both left out: keep the saved layout. Otherwise the pair is saved together.
  if p_body_html is not null or p_bodies_html is not null then
    v_body_html   := nullif(p_body_html, '');
    v_bodies_html := coalesce(p_bodies_html, '{}'::jsonb);
  end if;

  select coalesce(max(version_number), 0) + 1
    into v_next
    from snippet_revisions
   where snippet_id = p_snippet_id;

  insert into snippet_revisions
    (snippet_id, version_number, editor_id, editor_display, title, body, bodies,
     body_html, bodies_html, edit_note)
  values
    (p_snippet_id, v_next, v_uid, p_editor_display, p_title, p_body, p_bodies,
     v_body_html, v_bodies_html, p_edit_note);

  update snippets
     set title                 = p_title,
         shortcut              = p_shortcut,
         body                  = p_body,
         bodies                = p_bodies,
         body_html             = v_body_html,
         bodies_html           = v_bodies_html,
         lang                  = p_lang,
         folder_id             = p_folder_id,
         pinned                = p_pinned,
         enable_urgency_timer  = p_enable_urgency_timer,
         timer_duration_ms     = p_timer_duration_ms,
         scarcity_count        = p_scarcity_count,
         alternative_queries   = p_alternative_queries,
         updated_at            = now()
   where id = p_snippet_id;

  return v_next;
end;
$$;

-- Authenticated callers only (mirrors the B0 hardening).
revoke execute on function public.save_snippet_with_revision(
  text, text, text, text, jsonb, text, text, boolean, boolean,
  integer, integer, text, text, text[], text, jsonb
) from public, anon;

grant execute on function public.save_snippet_with_revision(
  text, text, text, text, jsonb, text, text, boolean, boolean,
  integer, integer, text, text, text[], text, jsonb
) to authenticated, service_role;

-- ── Review ───────────────────────────────────────────────────────────────────
-- The function from 20261005120000_review_status.sql with body_html and
-- bodies_html added to the snippet content keys. Nothing else changes.

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
        when 'snippets'      then array['title', 'body', 'bodies', 'body_html', 'bodies_html']
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
