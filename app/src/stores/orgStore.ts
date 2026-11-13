import { create } from 'zustand';
import type {
  MemberPlacement,
  OrgDepartment,
  OrgMember,
  OrganizationSummary,
} from '@/types/database';
import { orgApi } from '@/lib/api/orgApi';
import { supabase } from '@/lib/supabase';
import { pickActiveOrg, readStoredOrgId, writeStoredOrgId } from '@/lib/activeOrg';
import { sortDepartments } from '@/lib/orgChart';

/**
 * Organization store: every team the signed-in user belongs to, which one is
 * active, and that team's member directory.
 *
 * Loaded lazily (the folder-sharing modal calls `load()` the first time it
 * opens) so personal-only users never pay for an org round-trip. `load()` is
 * idempotent: it no-ops once `loaded` is true.
 *
 * A person may belong to several teams (TEAM-SWITCHER-001). The active choice
 * is remembered per user id and re-resolved on every refresh, so a team that
 * was left, removed, or deleted between sessions falls back to the oldest
 * membership instead of leaving the dashboard looking teamless.
 */
interface OrgStore {
  /** Every team the user belongs to, oldest membership first. */
  orgs: OrganizationSummary[];
  activeOrg: OrganizationSummary | null;
  /** Directory for `activeOrg` only. Re-fetched whenever the active team changes. */
  members: OrgMember[];
  /** Departments of `activeOrg` only, by name. Travels with `members`. */
  departments: OrgDepartment[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  /** Force a re-fetch (e.g. after membership changes). */
  refresh: () => Promise<void>;
  /** Switch teams. Remembers the choice and pulls the new team's directory. */
  setActiveOrg: (orgId: string) => Promise<void>;
  /**
   * Create a team with the signed-in user as its admin, then adopt it as the
   * active org so the roster and the share picker light up immediately.
   */
  createTeam: (name: string) => Promise<OrganizationSummary>;
  /** Set the team cover to a preset key or null (remove); updates activeOrg in place. */
  setCover: (cover: string | null) => Promise<void>;
  /** Upload a cover image for the active org; updates activeOrg in place. */
  uploadCover: (file: File) => Promise<void>;
  /** Add a department to the active team (admins). */
  addDepartment: (name: string) => Promise<OrgDepartment>;
  /** Rename a department of the active team (admins). */
  renameDepartment: (departmentId: string, name: string) => Promise<void>;
  /** Remove a department; its people stay in the team with no department (admins). */
  removeDepartment: (departmentId: string) => Promise<void>;
  /**
   * Set a person's department, job title and, for admins, lead mark, then
   * re-read the directory: choosing a lead changes someone else's row too.
   */
  setMemberPlacement: (userId: string, placement: MemberPlacement) => Promise<void>;
}

/** The directory and the departments of one team, read together. */
async function loadDirectory(
  orgId: string,
): Promise<{ members: OrgMember[]; departments: OrgDepartment[] }> {
  const [members, departments] = await Promise.all([
    orgApi.listMembers(orgId),
    orgApi.listDepartments(orgId),
  ]);
  return { members, departments };
}

/** The signed-in user's id, used to namespace the remembered team choice. */
async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * Keep `activeOrg` in sync with a changed org list, without clobbering a
 * cover/name edit that already landed in state.
 */
function reconcile(
  orgs: OrganizationSummary[],
  storedId: string | null,
): OrganizationSummary | null {
  return pickActiveOrg(orgs, storedId);
}

export const useOrgStore = create<OrgStore>((set, get) => ({
  orgs: [],
  activeOrg: null,
  members: [],
  departments: [],
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    if (get().loaded || get().loading) return;
    await get().refresh();
  },

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const userId = await currentUserId();
      const orgs = await orgApi.listMyOrgs();
      const active = reconcile(orgs, userId ? readStoredOrgId(userId) : null);
      const { members, departments } = active
        ? await loadDirectory(active.id)
        : { members: [], departments: [] };
      set({ orgs, activeOrg: active, members, departments, loaded: true, loading: false });
    } catch (err) {
      set({
        loading: false,
        loaded: true,
        error: err instanceof Error ? err.message : 'Failed to load organization',
      });
    }
  },

  setActiveOrg: async (orgId) => {
    const next = get().orgs.find((o) => o.id === orgId);
    // Ignore an id the user does not belong to: the switcher only ever offers
    // teams from `orgs`, so this can only be a stale click.
    if (!next || next.id === get().activeOrg?.id) return;

    // Swap first so the header renames immediately, then pull the directory.
    set({ activeOrg: next, members: [], departments: [], error: null });
    const userId = await currentUserId();
    if (userId) writeStoredOrgId(userId, orgId);

    try {
      const directory = await loadDirectory(orgId);
      // Guard against a slower earlier switch landing after a later one.
      if (get().activeOrg?.id === orgId) set(directory);
    } catch (err) {
      if (get().activeOrg?.id === orgId) {
        set({ error: err instanceof Error ? err.message : 'Failed to load the team directory' });
      }
    }
  },

  createTeam: async (name) => {
    const org = await orgApi.createTeam(name);
    // Adopt it before refreshing: the org exists the moment the RPC returns,
    // so a failing directory fetch must not leave the UI teamless. Remember it
    // too, so a reload lands on the team the user just made rather than their
    // oldest one.
    const userId = await currentUserId();
    if (userId) writeStoredOrgId(userId, org.id);
    set((s) => ({
      orgs: [...s.orgs, org],
      activeOrg: org,
      members: [],
      departments: [],
      loaded: true,
      error: null,
    }));
    await get().refresh();
    return org;
  },

  setCover: async (cover) => {
    const org = get().activeOrg;
    if (!org) throw new Error('No active team');
    // Pass the current cover so a replaced/removed uploaded image is cleaned up.
    await orgApi.setCover(org.id, cover, org.cover);
    set((s) => ({
      activeOrg: s.activeOrg ? { ...s.activeOrg, cover } : null,
      orgs: s.orgs.map((o) => (o.id === org.id ? { ...o, cover } : o)),
    }));
  },

  uploadCover: async (file) => {
    const org = get().activeOrg;
    if (!org) throw new Error('No active team');
    const url = await orgApi.uploadCover(org.id, org.cover, file);
    set((s) => ({
      activeOrg: s.activeOrg ? { ...s.activeOrg, cover: url } : null,
      orgs: s.orgs.map((o) => (o.id === org.id ? { ...o, cover: url } : o)),
    }));
  },

  addDepartment: async (name) => {
    const org = get().activeOrg;
    if (!org) throw new Error('No active team');
    const department = await orgApi.addDepartment(org.id, name);
    if (get().activeOrg?.id === org.id) {
      set((s) => ({ departments: sortDepartments([...s.departments, department]) }));
    }
    return department;
  },

  renameDepartment: async (departmentId, name) => {
    const org = get().activeOrg;
    if (!org) throw new Error('No active team');
    await orgApi.renameDepartment(departmentId, name);
    // Re-read rather than patch: the stored name is the normalised one.
    const departments = await orgApi.listDepartments(org.id);
    if (get().activeOrg?.id === org.id) set({ departments });
  },

  removeDepartment: async (departmentId) => {
    const org = get().activeOrg;
    if (!org) throw new Error('No active team');
    await orgApi.removeDepartment(departmentId);
    if (get().activeOrg?.id !== org.id) return;
    // The database cleared the link on every member who sat there.
    set((s) => ({
      departments: s.departments.filter((d) => d.id !== departmentId),
      members: s.members.map((m) =>
        m.department_id === departmentId
          ? { ...m, department_id: null, is_department_lead: false }
          : m,
      ),
    }));
  },

  setMemberPlacement: async (userId, placement) => {
    const org = get().activeOrg;
    if (!org) throw new Error('No active team');
    await orgApi.setMemberPlacement(org.id, userId, placement);
    const directory = await loadDirectory(org.id);
    if (get().activeOrg?.id === org.id) set(directory);
  },
}));
