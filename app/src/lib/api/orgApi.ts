import { supabase } from '@/lib/supabase';
import { toApiError } from '@/lib/api/apiError';
import {
  buildTeamCoverPath,
  COVER_MAX_BYTES,
  objectPathFromPublicUrl,
  pickHttpsUrl,
  TEAM_COVER_BUCKET,
  validateCoverSource,
  validateImageFile,
} from '@/lib/branding';
import { COVER_MAX_WIDTH, downscaleImage } from '@/lib/imageResize';
import { isImageCover } from '@/lib/teamCoverPresets';
import { normalizeDepartmentName, normalizeJobTitle } from '@/lib/orgChart';
import type {
  MemberPlacement,
  OrgDepartment,
  OrgMember,
  OrgRole,
  OrganizationSummary,
} from '@/types/database';

// Organization reads for the dashboard. The folder-sharing UI (Phase B) needs
// to know the signed-in user's active organization and its member directory.
//
// RLS does the scoping: `organization_members` / `organizations` only return
// rows for orgs the user belongs to, and `org_member_directory` is a guarded
// SECURITY DEFINER function that returns teammate identity to co-members only.

type OrgRel = { id: string; name: string; slug: string | null; cover: string | null };
type MembershipRow = {
  role: OrgRole;
  // supabase-js may surface an embedded to-one relation as an object or a
  // single-element array depending on how it infers cardinality — handle both.
  organizations: OrgRel | OrgRel[] | null;
};

type DirectoryRow = {
  user_id: string;
  email: string;
  display_name: string;
  role: OrgRole;
  avatar_url: string | null;
  department_id: string | null;
  job_title: string | null;
  is_department_lead: boolean | null;
};

/** What the screen says when row security matched nothing: the caller is not an admin. */
const DEPARTMENTS_ADMIN_ONLY = 'Only a team admin can change departments.';

export interface OrgApi {
  /**
   * The signed-in user's active organization (their earliest membership), or
   * null when they belong to no org. Multi-org membership is supported in the
   * DB; a future org switcher will let users change the active one.
   */
  getActiveOrg(): Promise<OrganizationSummary | null>;
  /**
   * Every organization the caller belongs to, oldest membership first.
   *
   * No RPC needed: `org_select` and `orgmem_select` already admit exactly the
   * caller's own memberships, so RLS does the scoping. The team switcher reads
   * this; `getActiveOrg` is the same query truncated to the first row.
   */
  listMyOrgs(): Promise<OrganizationSummary[]>;
  /**
   * Create an organization and make the caller its admin.
   *
   * Runs through the `create_team` RPC rather than two inserts because
   * `org_insert` and `orgmem_write` deadlock a client-side create: the caller
   * may insert the organization but not their own membership row, leaving an
   * org with no members that `org_select` then hides from them.
   */
  createTeam(name: string): Promise<OrganizationSummary>;
  /** The member directory for an org the caller belongs to. */
  listMembers(orgId: string): Promise<OrgMember[]>;
  /** The team's departments, by name. Every member may read them. */
  listDepartments(orgId: string): Promise<OrgDepartment[]>;
  /**
   * Add, rename or remove a department. Admin-only, enforced by row security
   * on `org_departments`; a non-admin's write matches no row and is reported
   * as an error rather than passing as done. Removing a department keeps its
   * people in the team, with no department.
   */
  addDepartment(orgId: string, name: string): Promise<OrgDepartment>;
  renameDepartment(departmentId: string, name: string): Promise<void>;
  removeDepartment(departmentId: string): Promise<void>;
  /**
   * Set a person's department and job title, and for admins whether they lead
   * the department. Runs through `set_member_placement` because membership
   * rows are admin-only under row security, and a person may still set their
   * own place.
   */
  setMemberPlacement(orgId: string, userId: string, placement: MemberPlacement): Promise<void>;
  /**
   * Set the team cover to a preset key or null (remove). Admin-only — enforced
   * by the `org_update` RLS policy, which matches 0 rows for non-admins; we
   * surface that as a clear error rather than a silent no-op. Pass the previous
   * cover so a replaced/removed uploaded image gets cleaned out of storage.
   */
  setCover(orgId: string, cover: string | null, previousCover?: string | null): Promise<void>;
  /** Upload a cover image, point the org at its public URL, drop the previous upload. */
  uploadCover(orgId: string, currentCover: string | null, file: File): Promise<string>;
}

export const orgApi: OrgApi = {
  async getActiveOrg() {
    // The oldest membership, which is the default team until the user picks
    // another one. `listMyOrgs` is the source of truth for the whole list.
    return (await this.listMyOrgs())[0] ?? null;
  },

  async listMyOrgs() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return [];

    const { data, error } = await supabase
      .from('organization_members')
      .select('role, organizations(id, name, slug, cover)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (error) throw toApiError(error);

    const out: OrganizationSummary[] = [];
    for (const row of (data ?? []) as MembershipRow[]) {
      if (!row.organizations) continue;
      // supabase-js may surface the to-one relation either way (see MembershipRow).
      const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
      if (!org) continue;
      out.push({
        id: org.id,
        name: org.name,
        slug: org.slug,
        myRole: row.role,
        cover: org.cover,
      });
    }
    return out;
  },

  async createTeam(name) {
    const trimmed = name.trim();
    const { data, error } = await supabase.rpc('create_team', { p_name: trimmed });
    // The RPC raises human-readable messages (empty name, name too long,
    // already in a team) — surface them as written rather than remapping.
    if (error) throw toApiError(error);
    if (typeof data !== 'string') throw new Error('Could not create the team. Try again.');
    // The caller is the only member, so the summary is fully determined here:
    // no round-trip needed to learn a role we just assigned.
    return { id: data, name: trimmed, slug: null, myRole: 'admin', cover: null };
  },

  async listMembers(orgId) {
    const { data, error } = await supabase.rpc('org_member_directory', { p_org: orgId });
    if (error) throw toApiError(error);
    return ((data ?? []) as DirectoryRow[]).map((r) => ({
      user_id: r.user_id,
      email: r.email,
      display_name: r.display_name,
      role: r.role,
      // The function already keeps non-https values back; this is the same
      // guard every surface applies to a photo address before rendering it.
      avatar_url: pickHttpsUrl({ avatar_url: r.avatar_url }, 'avatar_url'),
      department_id: r.department_id ?? null,
      job_title: r.job_title ?? null,
      is_department_lead: r.is_department_lead === true,
    }));
  },

  async listDepartments(orgId) {
    const { data, error } = await supabase
      .from('org_departments')
      .select('id, name')
      .eq('organization_id', orgId)
      .order('name', { ascending: true });
    if (error) throw toApiError(error);
    return (data ?? []) as OrgDepartment[];
  },

  async addDepartment(orgId, name) {
    const { data, error } = await supabase
      .from('org_departments')
      .insert({ organization_id: orgId, name: normalizeDepartmentName(name) })
      .select('id, name')
      .single();
    if (error) {
      throw toApiError(
        error,
        error.code === '23505' ? 'You already have a department with that name.' : undefined,
      );
    }
    return data as OrgDepartment;
  },

  async renameDepartment(departmentId, name) {
    const { data, error } = await supabase
      .from('org_departments')
      .update({ name: normalizeDepartmentName(name) })
      .eq('id', departmentId)
      .select('id');
    if (error) {
      throw toApiError(
        error,
        error.code === '23505' ? 'You already have a department with that name.' : undefined,
      );
    }
    if (!data || data.length === 0) throw new Error(DEPARTMENTS_ADMIN_ONLY);
  },

  async removeDepartment(departmentId) {
    const { data, error } = await supabase
      .from('org_departments')
      .delete()
      .eq('id', departmentId)
      .select('id');
    if (error) throw toApiError(error);
    if (!data || data.length === 0) throw new Error(DEPARTMENTS_ADMIN_ONLY);
  },

  async setMemberPlacement(orgId, userId, placement) {
    const { error } = await supabase.rpc('set_member_placement', {
      p_org: orgId,
      p_user: userId,
      p_department: placement.departmentId,
      p_job_title: normalizeJobTitle(placement.jobTitle),
      // Left out when the caller is not choosing a lead, so the saved mark stays.
      ...(placement.lead === undefined ? {} : { p_lead: placement.lead }),
    });
    // The function words its own refusals ("That department no longer exists").
    if (error) throw toApiError(error);
  },

  async setCover(orgId, cover, previousCover = null) {
    const { data, error } = await supabase
      .from('organizations')
      .update({ cover })
      .eq('id', orgId)
      .select('id');
    if (error) throw toApiError(error);
    // RLS (org_update, admin-only) matches 0 rows for non-admins — make that explicit.
    if (!data || data.length === 0) {
      throw new Error('Only a team admin can change the cover.');
    }
    // Drop a replaced or removed uploaded image (best-effort; a leftover is harmless).
    if (isImageCover(previousCover) && previousCover !== cover) {
      const prevPath = objectPathFromPublicUrl(previousCover, TEAM_COVER_BUCKET);
      if (prevPath) void supabase.storage.from(TEAM_COVER_BUCKET).remove([prevPath]);
    }
  },

  async uploadCover(orgId, currentCover, file) {
    const badSource = validateCoverSource(file);
    if (badSource) throw new Error(badSource);

    // Resize before upload: a phone photo is far larger than the cover renders,
    // so the storage cap applies to the processed image, not the original.
    const prepared = await downscaleImage(file, {
      maxWidth: COVER_MAX_WIDTH,
      maxBytes: COVER_MAX_BYTES,
    });
    const invalid = validateImageFile(prepared, COVER_MAX_BYTES);
    if (invalid) throw new Error(invalid);

    // Timestamped per-org key — a replacement gets a fresh URL, so no
    // CDN/browser cache can keep serving the old image.
    const path = buildTeamCoverPath(orgId, prepared.type, Date.now());
    const { error: uploadErr } = await supabase.storage
      .from(TEAM_COVER_BUCKET)
      .upload(path, prepared, { contentType: prepared.type, cacheControl: '3600' });
    if (uploadErr) throw toApiError(uploadErr);

    const { publicUrl } = supabase.storage.from(TEAM_COVER_BUCKET).getPublicUrl(path).data;

    try {
      // setCover also drops the previously uploaded image once the pointer moves.
      await this.setCover(orgId, publicUrl, currentCover);
    } catch (err) {
      // The pointer never landed (e.g. not an admin) — drop the orphaned object.
      void supabase.storage.from(TEAM_COVER_BUCKET).remove([path]);
      throw toApiError(err);
    }
    return publicUrl;
  },
};
