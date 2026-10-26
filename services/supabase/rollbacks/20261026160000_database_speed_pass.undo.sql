-- UNDO for 20261026160000_database_speed_pass.sql
--
-- Generated from that file by script (the same policies with the sub-select
-- taken off again), so the two cannot drift. Puts the 68 policies back to the
-- per-row auth.uid() call they had, drops the 20 foreign-key indexes and
-- resets the search_path of app.knowledge_tsv. Nobody gains or loses access
-- either way; run it only if the new form misbehaves.
--
-- Rules and indexes only: no row is touched.

alter function app.knowledge_tsv(text, text) reset search_path;

drop index if exists public.folder_permissions_granted_by_idx;
drop index if exists public.folders_user_id_idx;
drop index if exists public.knowledge_feedback_resolved_by_idx;
drop index if exists public.member_property_values_organization_id_idx;
drop index if exists public.member_property_values_user_id_idx;
drop index if exists public.memory_shard_versions_editor_id_idx;
drop index if exists public.memory_shards_reviewed_by_idx;
drop index if exists public.notion_sync_log_user_id_idx;
drop index if exists public.organization_invitations_invited_by_idx;
drop index if exists public.organizations_created_by_idx;
drop index if exists public.prompt_versions_editor_id_idx;
drop index if exists public.prompts_folder_id_idx;
drop index if exists public.prompts_reviewed_by_idx;
drop index if exists public.prompts_updated_by_idx;
drop index if exists public.snippet_revisions_editor_id_idx;
drop index if exists public.snippet_stats_user_id_idx;
drop index if exists public.snippets_reviewed_by_idx;
drop index if exists public.snippets_updated_by_idx;
drop index if exists public.snippets_user_id_idx;
drop index if exists public.teams_created_by_idx;

alter policy "Users can read own audit log" on public.auth_audit_log
  using ((auth.uid() = user_id));

alter policy "folders: delete own" on public.folders
  using (((auth.uid() = user_id) OR ((organization_id IS NOT NULL) AND (app.folder_level(id) = 'owner'::permission_level))));

alter policy "folders: insert own" on public.folders
  with check (((user_id = auth.uid()) AND ((organization_id IS NULL) OR app.is_org_member(organization_id))));

alter policy "folders: select own" on public.folders
  using (((auth.uid() = user_id) OR ((organization_id IS NOT NULL) AND app.can_read_folder(id))));

alter policy "folders: update own" on public.folders
  using (((auth.uid() = user_id) OR ((organization_id IS NOT NULL) AND (app.folder_level(id) = 'owner'::permission_level))))
  with check (((auth.uid() = user_id) OR ((organization_id IS NOT NULL) AND (app.folder_level(id) = 'owner'::permission_level))));

alter policy knowledge_feedback_insert on public.knowledge_feedback
  with check (((user_id = auth.uid()) AND (status = 'open'::text) AND (resolved_at IS NULL) AND (resolved_by IS NULL) AND ((organization_id IS NULL) OR app.is_org_member(organization_id))));

alter policy knowledge_feedback_select on public.knowledge_feedback
  using (((user_id = auth.uid()) OR ((organization_id IS NOT NULL) AND (app.org_role(organization_id) = 'admin'::org_role))));

alter policy knowledge_feedback_update on public.knowledge_feedback
  using (((user_id = auth.uid()) OR ((organization_id IS NOT NULL) AND (app.org_role(organization_id) = 'admin'::org_role))))
  with check (((user_id = auth.uid()) OR ((organization_id IS NOT NULL) AND (app.org_role(organization_id) = 'admin'::org_role))));

alter policy "labels: delete own" on public.labels
  using ((auth.uid() = user_id));

alter policy "labels: insert own" on public.labels
  with check ((user_id = auth.uid()));

alter policy "labels: select own" on public.labels
  using ((auth.uid() = user_id));

alter policy "labels: update own" on public.labels
  using ((auth.uid() = user_id))
  with check ((user_id = auth.uid()));

alter policy mpropval_select on public.member_property_values
  using (((user_id = auth.uid()) OR (app.org_role(organization_id) = 'admin'::org_role)));

alter policy mpropval_write on public.member_property_values
  using (((user_id = auth.uid()) OR (app.org_role(organization_id) = 'admin'::org_role)))
  with check (((user_id = auth.uid()) OR (app.org_role(organization_id) = 'admin'::org_role)));

alter policy "memory_audit_log: select own" on public.memory_audit_log
  using ((auth.uid() = user_id));

alter policy memdoc_delete on public.memory_documents
  using ((user_id = auth.uid()));

alter policy memdoc_insert on public.memory_documents
  with check ((user_id = auth.uid()));

alter policy memdoc_select on public.memory_documents
  using ((user_id = auth.uid()));

alter policy memdoc_update on public.memory_documents
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));

alter policy "memory_shard_labels: delete own" on public.memory_shard_labels
  using ((auth.uid() = user_id));

alter policy "memory_shard_labels: insert own" on public.memory_shard_labels
  with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM labels l
  WHERE ((l.id = memory_shard_labels.label_id) AND (l.user_id = auth.uid())))) AND (EXISTS ( SELECT 1
   FROM memory_shards s
  WHERE ((s.id = memory_shard_labels.shard_id) AND (s.user_id = auth.uid()))))));

alter policy "memory_shard_labels: select own" on public.memory_shard_labels
  using ((auth.uid() = user_id));

alter policy "memory_shard_versions: select own" on public.memory_shard_versions
  using ((EXISTS ( SELECT 1
   FROM memory_shards s
  WHERE ((s.id = memory_shard_versions.shard_id) AND (s.user_id = auth.uid())))));

alter policy "memory_shards: delete own" on public.memory_shards
  using ((auth.uid() = user_id));

alter policy "memory_shards: insert own" on public.memory_shards
  with check ((user_id = auth.uid()));

alter policy "memory_shards: select own" on public.memory_shards
  using ((auth.uid() = user_id));

alter policy "memory_shards: update own" on public.memory_shards
  using ((auth.uid() = user_id))
  with check ((user_id = auth.uid()));

alter policy "memory_spaces: delete own" on public.memory_spaces
  using ((auth.uid() = user_id));

alter policy "memory_spaces: insert own" on public.memory_spaces
  with check ((user_id = auth.uid()));

alter policy "memory_spaces: select own" on public.memory_spaces
  using ((auth.uid() = user_id));

alter policy "memory_spaces: update own" on public.memory_spaces
  using ((auth.uid() = user_id))
  with check ((user_id = auth.uid()));

alter policy "memory_step_labels: delete own" on public.memory_step_labels
  using ((auth.uid() = user_id));

alter policy "memory_step_labels: insert own" on public.memory_step_labels
  with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM labels l
  WHERE ((l.id = memory_step_labels.label_id) AND (l.user_id = auth.uid())))) AND (EXISTS ( SELECT 1
   FROM memory_steps s
  WHERE ((s.id = memory_step_labels.step_id) AND (s.user_id = auth.uid()))))));

alter policy "memory_step_labels: select own" on public.memory_step_labels
  using ((auth.uid() = user_id));

alter policy "memory_step_labels: update own" on public.memory_step_labels
  using ((auth.uid() = user_id))
  with check ((user_id = auth.uid()));

alter policy "memory_steps: delete own" on public.memory_steps
  using ((auth.uid() = user_id));

alter policy "memory_steps: insert own" on public.memory_steps
  with check ((user_id = auth.uid()));

alter policy "memory_steps: select own" on public.memory_steps
  using ((auth.uid() = user_id));

alter policy "memory_steps: update own" on public.memory_steps
  using ((auth.uid() = user_id))
  with check ((user_id = auth.uid()));

alter policy "memory_tokens: delete own" on public.memory_tokens
  using ((auth.uid() = user_id));

alter policy "memory_tokens: select own" on public.memory_tokens
  using ((auth.uid() = user_id));

alter policy "memory_tokens: update own" on public.memory_tokens
  using ((auth.uid() = user_id))
  with check ((user_id = auth.uid()));

alter policy "notion_log: insert own" on public.notion_sync_log
  with check ((auth.uid() = user_id));

alter policy "notion_log: select own" on public.notion_sync_log
  using ((auth.uid() = user_id));

alter policy org_insert on public.organizations
  with check ((created_by = auth.uid()));

alter policy "prompt_labels: delete own" on public.prompt_labels
  using ((auth.uid() = user_id));

alter policy "prompt_labels: insert own" on public.prompt_labels
  with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM labels l
  WHERE ((l.id = prompt_labels.label_id) AND (l.user_id = auth.uid()))))));

alter policy "prompt_labels: select own" on public.prompt_labels
  using ((auth.uid() = user_id));

alter policy promptver_select on public.prompt_versions
  using ((EXISTS ( SELECT 1
   FROM prompts p
  WHERE ((p.id = prompt_versions.prompt_id) AND ((p.user_id = auth.uid()) OR ((p.organization_id IS NOT NULL) AND (p.folder_id IS NOT NULL) AND app.can_read_folder(p.folder_id)))))));

alter policy "prompts: delete own" on public.prompts
  using (((auth.uid() = user_id) OR ((organization_id IS NOT NULL) AND (folder_id IS NOT NULL) AND app.can_write_folder(folder_id))));

alter policy "prompts: insert own" on public.prompts
  with check (((user_id = auth.uid()) AND ((organization_id IS NULL) OR ((folder_id IS NOT NULL) AND app.can_write_folder(folder_id)))));

alter policy "prompts: select own" on public.prompts
  using (((auth.uid() = user_id) OR ((organization_id IS NOT NULL) AND (folder_id IS NOT NULL) AND app.can_read_folder(folder_id))));

alter policy "prompts: update own" on public.prompts
  using (((auth.uid() = user_id) OR ((organization_id IS NOT NULL) AND (folder_id IS NOT NULL) AND app.can_write_folder(folder_id))))
  with check (((auth.uid() = user_id) OR ((organization_id IS NOT NULL) AND (folder_id IS NOT NULL) AND app.can_write_folder(folder_id))));

alter policy "snippet_events: insert own" on public.snippet_events
  with check ((auth.uid() = user_id));

alter policy "snippet_events: select own" on public.snippet_events
  using ((auth.uid() = user_id));

alter policy "snippet_labels: delete own" on public.snippet_labels
  using ((auth.uid() = user_id));

alter policy "snippet_labels: insert own" on public.snippet_labels
  with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM labels l
  WHERE ((l.id = snippet_labels.label_id) AND (l.user_id = auth.uid()))))));

alter policy "snippet_labels: select own" on public.snippet_labels
  using ((auth.uid() = user_id));

alter policy snippet_revisions_insert on public.snippet_revisions
  with check (((editor_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM snippets s
  WHERE ((s.id = snippet_revisions.snippet_id) AND ((s.user_id = auth.uid()) OR ((s.organization_id IS NOT NULL) AND (s.folder_id IS NOT NULL) AND app.can_write_folder(s.folder_id))))))));

alter policy snippet_revisions_select on public.snippet_revisions
  using ((EXISTS ( SELECT 1
   FROM snippets s
  WHERE ((s.id = snippet_revisions.snippet_id) AND ((s.user_id = auth.uid()) OR ((s.organization_id IS NOT NULL) AND (s.folder_id IS NOT NULL) AND app.can_read_folder(s.folder_id)))))));

alter policy "stats: delete own" on public.snippet_stats
  using ((auth.uid() = user_id));

alter policy "stats: insert own" on public.snippet_stats
  with check ((auth.uid() = user_id));

alter policy "stats: select own" on public.snippet_stats
  using ((auth.uid() = user_id));

alter policy "stats: update own" on public.snippet_stats
  using ((auth.uid() = user_id))
  with check ((auth.uid() = user_id));

alter policy "snippets: delete own" on public.snippets
  using (((auth.uid() = user_id) OR ((organization_id IS NOT NULL) AND (folder_id IS NOT NULL) AND app.can_write_folder(folder_id))));

alter policy "snippets: insert own" on public.snippets
  with check (((user_id = auth.uid()) AND ((organization_id IS NULL) OR ((folder_id IS NOT NULL) AND app.can_write_folder(folder_id)))));

alter policy "snippets: select own" on public.snippets
  using (((auth.uid() = user_id) OR ((organization_id IS NOT NULL) AND (folder_id IS NOT NULL) AND app.can_read_folder(folder_id))));

alter policy "snippets: update own" on public.snippets
  using (((auth.uid() = user_id) OR ((organization_id IS NOT NULL) AND (folder_id IS NOT NULL) AND app.can_write_folder(folder_id))))
  with check (((auth.uid() = user_id) OR ((organization_id IS NOT NULL) AND (folder_id IS NOT NULL) AND app.can_write_folder(folder_id))));
