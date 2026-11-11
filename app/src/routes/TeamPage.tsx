import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Globe, Network, Pencil, Share2 } from 'lucide-react';
import { EmptyState } from '@/components/layout/EmptyState';
import { LoadingBlock } from '@/components/layout/LoadingBlock';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { CreateTeamPanel } from '@/features/org/CreateTeamPanel';
import { DepartmentsDialog } from '@/features/org/DepartmentsDialog';
import { FolderShareModal } from '@/features/org/FolderShareModal';
import {
  canInvite,
  InvitationRows,
  InvitePeopleButton,
  ROLE_LABEL,
  useInvitations,
} from '@/features/org/InviteMemberPanel';
import { MemberPlacementDialog } from '@/features/org/MemberPlacementDialog';
import { TeamCover } from '@/features/org/TeamCover';
import { Avatar } from '@/components/shared/Avatar';
import { AvatarStack, type StackMember } from '@/components/shared/AvatarStack';
import { useSnippetStore } from '@/stores/snippetStore';
import { usePromptStore } from '@/stores/promptStore';
import { useOrgStore } from '@/stores/orgStore';
import { useAuthStore } from '@/stores/authStore';
import { permissionsApi } from '@/lib/api/permissionsApi';
import { FolderIcon } from '@/lib/folderIcons';
import { groupByDepartment, hasOwnName } from '@/lib/orgChart';
import { describeFolderContents } from '@/lib/teamFolders';
import type {
  Folder,
  FolderPermission,
  FolderShareScope,
  OrgDepartment,
  OrgMember,
  OrganizationSummary,
} from '@/types/database';

/** What a shared folder holds, counted once per render for every row. */
interface FolderCounts {
  snippets: number;
  prompts: number;
}

const NO_ITEMS: FolderCounts = { snippets: 0, prompts: 0 };

/**
 * The Team page: who is in the team, and which folders are shared. One calm
 * screen. The People list is the team's org chart (people grouped by
 * department once the team has departments), with Invite people and the
 * invitations already sent; the folder list says who has each folder and
 * what it holds, with Manage sharing beside it. Sharing itself stays
 * folder-level (Phase B org ACL) and is managed through FolderShareModal;
 * the items inside a folder are read on the Snippets and Prompts pages.
 */
export function TeamPage() {
  const folders = useSnippetStore((s) => s.folders);
  const folderShares = useSnippetStore((s) => s.folderShares);
  const snippets = useSnippetStore((s) => s.snippets);
  const snippetsLoading = useSnippetStore((s) => s.loading);
  const loadSnippets = useSnippetStore((s) => s.load);

  const prompts = usePromptStore((s) => s.prompts);
  const loadPrompts = usePromptStore((s) => s.load);

  const members = useOrgStore((s) => s.members);
  const departments = useOrgStore((s) => s.departments);
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const orgLoaded = useOrgStore((s) => s.loaded);
  const loadOrg = useOrgStore((s) => s.load);

  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const [shareFolder, setShareFolder] = useState<Folder | null>(null);
  const [grantsByFolder, setGrantsByFolder] = useState<Map<string, FolderPermission[]>>(new Map());

  // Per-folder grants drive the "who has access" faces. Non-fatal: a failure
  // degrades to scope-only badges (the store's folderShares stays authoritative).
  const loadGrants = useCallback(() => {
    permissionsApi
      .listAllGrants()
      .then((rows) => {
        const map = new Map<string, FolderPermission[]>();
        for (const g of rows) {
          const arr = map.get(g.folder_id) ?? [];
          arr.push(g);
          map.set(g.folder_id, arr);
        }
        setGrantsByFolder(map);
      })
      .catch(() => setGrantsByFolder(new Map()));
  }, []);

  // Cold-open hydration: fetch whichever sources haven't been visited yet.
  useEffect(() => {
    if (snippets.length === 0 && folders.length === 0) void loadSnippets();
  }, [loadSnippets, snippets.length, folders.length]);
  useEffect(() => {
    if (prompts.length === 0) void loadPrompts();
  }, [loadPrompts, prompts.length]);
  useEffect(() => {
    void loadOrg();
  }, [loadOrg]);
  useEffect(() => {
    loadGrants();
  }, [loadGrants]);

  const memberById = useMemo(() => {
    const map = new Map<string, OrgMember>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  const sharedFolders = useMemo(
    () =>
      folders
        .filter((f) => folderShares.has(f.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, folderShares],
  );

  const countsByFolder = useMemo(() => {
    const map = new Map<string, FolderCounts>();
    const bump = (folderId: string | null, key: keyof FolderCounts) => {
      if (!folderId) return;
      const counts = map.get(folderId) ?? { snippets: 0, prompts: 0 };
      counts[key] += 1;
      map.set(folderId, counts);
    };
    for (const s of snippets) bump(s.folder_id, 'snippets');
    for (const p of prompts) bump(p.folder_id, 'prompts');
    return map;
  }, [snippets, prompts]);

  const mine = sharedFolders.filter((f) => f.user_id === currentUserId);
  const withMe = sharedFolders.filter((f) => f.user_id !== currentUserId);

  function reload() {
    void loadSnippets();
    void loadPrompts();
    loadGrants();
  }

  function accessFaces(folder: Folder): StackMember[] {
    const grants = grantsByFolder.get(folder.id) ?? [];
    const map = new Map<string, StackMember>();
    if (folder.user_id) {
      const owner = memberById.get(folder.user_id);
      map.set(folder.user_id, {
        id: folder.user_id,
        name: owner?.display_name ?? null,
        email: owner?.email ?? null,
        avatar: owner?.avatar_url ?? null,
        highlight: folder.user_id === currentUserId,
      });
    }
    for (const g of grants) {
      if (g.principal_type !== 'user') continue;
      const m = memberById.get(g.principal_id);
      map.set(g.principal_id, {
        id: g.principal_id,
        name: m?.display_name ?? null,
        email: m?.email ?? null,
        avatar: m?.avatar_url ?? null,
        highlight: g.principal_id === currentUserId,
      });
    }
    return Array.from(map.values());
  }

  const canManage = useCallback(
    (folder: Folder) => folder.user_id === currentUserId || activeOrg?.myRole === 'admin',
    [currentUserId, activeOrg],
  );

  function renderRow(folder: Folder) {
    return (
      <SharedFolderRow
        key={folder.id}
        folder={folder}
        scope={folderShares.get(folder.id)?.scope ?? 'shared'}
        faces={accessFaces(folder)}
        counts={countsByFolder.get(folder.id) ?? NO_ITEMS}
        canManage={canManage(folder)}
        onManage={() => setShareFolder(folder)}
      />
    );
  }

  // The first load has nothing to show yet; an empty state here would flash
  // "Nothing shared yet" at people whose folders are still on their way.
  const foldersLoading = snippetsLoading && folders.length === 0;

  return (
    <>
      <TeamCover />

      {!orgLoaded ? (
        <LoadingBlock what="your team" />
      ) : !activeOrg ? (
        // No team yet: offer the one action that unblocks everything else.
        <CreateTeamPanel />
      ) : (
        <div className="flex flex-col gap-4">
          <PeopleCard
            org={activeOrg}
            members={members}
            departments={departments}
            currentUserId={currentUserId}
          />

          {foldersLoading ? (
            <LoadingBlock what="shared folders" />
          ) : sharedFolders.length === 0 ? (
            <EmptyState
              icon={Share2}
              title="Nothing shared yet"
              description="On the Snippets page, right-click a folder and choose Share with team. Everyone you share it with gets its snippets and prompts straight away."
            />
          ) : (
            <section
              className="rounded-[16px] border border-line bg-card"
              aria-labelledby="team-folders-title"
            >
              <CardHeading id="team-folders-title" title="Shared folders" count={sharedFolders.length} />
              {mine.length > 0 && <FolderGroup title="Shared by you">{mine.map(renderRow)}</FolderGroup>}
              {mine.length > 0 && withMe.length > 0 && <div className="h-px bg-line" />}
              {withMe.length > 0 && (
                <FolderGroup title="Shared with you">{withMe.map(renderRow)}</FolderGroup>
              )}
            </section>
          )}
        </div>
      )}

      <FolderShareModal
        folder={shareFolder}
        onClose={() => setShareFolder(null)}
        onShared={reload}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */

function CardHeading({
  id,
  title,
  count,
  action,
}: {
  id: string;
  title: string;
  count: number;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
      <h2 id={id} className="text-sm font-semibold text-ink">
        {title} <span className="font-normal text-ink-subtle">· {count}</span>
      </h2>
      {action}
    </header>
  );
}

/** The tile grid every group of people uses, grouped by department or not. */
const PEOPLE_GRID = 'grid grid-cols-2 gap-x-2 gap-y-1 p-3 xl:grid-cols-3 2xl:grid-cols-4';

function PeopleCard({
  org,
  members,
  departments,
  currentUserId,
}: {
  org: OrganizationSummary;
  members: OrgMember[];
  departments: OrgDepartment[];
  currentUserId: string | null;
}) {
  const inviter = canInvite(org.myRole);
  const isAdmin = org.myRole === 'admin';
  const { invitations, refresh } = useInvitations(inviter ? org.id : null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [departmentsOpen, setDepartmentsOpen] = useState(false);
  // Where the keyboard focus goes back to when a window closes: the button
  // that opened it. A person may have moved to another group meanwhile, so
  // their pencil is looked up again rather than remembered.
  const cardRef = useRef<HTMLElement>(null);
  const departmentsButtonRef = useRef<HTMLButtonElement>(null);
  const lastEditedId = useRef<string | null>(null);

  const groups = useMemo(() => groupByDepartment(members, departments), [members, departments]);
  // A department nobody sits in is an admin's to fill; everyone else sees
  // only the ones with people in them.
  const shownGroups = groups.filter((g) => g.members.length > 0 || isAdmin);
  // The how-to is said once, on the first empty department, not on each.
  const firstEmpty = shownGroups.find((g) => g.members.length === 0) ?? null;
  const editing = members.find((m) => m.user_id === editingId) ?? null;

  function renderTile(m: OrgMember) {
    const isYou = m.user_id === currentUserId;
    return (
      <MemberTile
        key={m.user_id}
        member={m}
        isYou={isYou}
        // Admins place anyone; everyone else sets their own department and title.
        onEdit={
          isAdmin || isYou
            ? () => {
                lastEditedId.current = m.user_id;
                setEditingId(m.user_id);
              }
            : undefined
        }
      />
    );
  }

  function focusLastEdited() {
    const id = lastEditedId.current;
    if (id === null) return;
    cardRef.current
      ?.querySelector<HTMLButtonElement>(`button[data-edit-member="${id}"]`)
      ?.focus();
  }

  return (
    <section
      ref={cardRef}
      className="rounded-[16px] border border-line bg-card"
      aria-labelledby="team-people-title"
    >
      <CardHeading
        id="team-people-title"
        title="People"
        count={members.length}
        action={
          (isAdmin || inviter) && (
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Button
                  ref={departmentsButtonRef}
                  variant="ghost"
                  size="sm"
                  onClick={() => setDepartmentsOpen(true)}
                >
                  <Network className="h-4 w-4" aria-hidden="true" />
                  Departments
                </Button>
              )}
              {inviter && <InvitePeopleButton org={org} onSent={refresh} />}
            </div>
          )
        }
      />

      {members.length === 0 ? (
        // A team always holds at least you, so an empty list is one still on
        // its way (the directory is fetched after a switch).
        <p className="px-5 py-3 text-sm text-ink-subtle" role="status">
          Loading people…
        </p>
      ) : departments.length === 0 ? (
        // No departments yet: one grid of faces, in the directory's own order.
        <ul className={PEOPLE_GRID}>{members.map(renderTile)}</ul>
      ) : (
        // The org chart: one block per department, its lead first, then the
        // people who have no department yet.
        <div className="divide-y divide-line">
          {shownGroups.map((group) => {
            const headingId = `team-department-${group.department?.id ?? 'none'}`;
            return (
              <section key={headingId} aria-labelledby={headingId}>
                <h3 id={headingId} className="px-5 pt-3.5 text-[13px] font-semibold text-ink">
                  {group.department?.name ?? 'No department yet'}{' '}
                  <span className="font-normal text-ink-subtle">· {group.members.length}</span>
                </h3>
                {group.members.length === 0 ? (
                  <p className="px-5 pb-3.5 pt-1 text-sm text-ink-subtle">
                    Nobody here yet.
                    {group === firstEmpty &&
                      ' Click the pencil beside a person to choose their department.'}
                  </p>
                ) : (
                  <ul className={`${PEOPLE_GRID} pt-1.5`}>{group.members.map(renderTile)}</ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {inviter && <InvitationRows org={org} invitations={invitations} onChanged={refresh} />}

      <MemberPlacementDialog
        member={editing}
        isSelf={editing !== null && editing.user_id === currentUserId}
        isAdmin={isAdmin}
        onClose={() => setEditingId(null)}
        onRestoreFocus={focusLastEdited}
      />
      {isAdmin && (
        <DepartmentsDialog
          open={departmentsOpen}
          onOpenChange={setDepartmentsOpen}
          onRestoreFocus={() => departmentsButtonRef.current?.focus()}
        />
      )}
    </section>
  );
}

/**
 * One person: their photo (or initial), name, job title when they have one,
 * then role and email on one muted line. The pencil opens their department
 * and job title, and shows only to whoever may change them.
 */
function MemberTile({
  member,
  isYou,
  onEdit,
}: {
  member: OrgMember;
  isYou: boolean;
  onEdit?: () => void;
}) {
  // The directory falls back to the email as the display name, so only a
  // real name earns the email a place on the last line.
  const named = hasOwnName(member);
  const name = named ? member.display_name.trim() : member.email;
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-[12px] px-2 py-2">
      <Avatar
        src={member.avatar_url}
        name={member.display_name}
        email={member.email}
        highlight={isYou}
        size="lg"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-ink">
            {name}
            {isYou && <span className="font-normal text-ink-subtle"> (you)</span>}
          </span>
          {member.is_department_lead && (
            <span className="shrink-0 rounded-full bg-primary-light px-2 py-0.5 text-[11px] font-semibold text-primary">
              Lead
            </span>
          )}
        </span>
        {member.job_title && (
          <span className="truncate text-xs text-ink-muted" title={member.job_title}>
            {member.job_title}
          </span>
        )}
        <span className="truncate text-xs text-ink-subtle" title={named ? member.email : undefined}>
          {ROLE_LABEL[member.role]}
          {named && ` · ${member.email}`}
        </span>
      </span>
      {onEdit && (
        <Tooltip label="Department and job title" className="shrink-0">
          <button
            type="button"
            onClick={onEdit}
            data-edit-member={member.user_id}
            aria-label={isYou ? 'Edit your department and job title' : `Edit ${name}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-subtle transition-colors hover:bg-bg-alt hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </Tooltip>
      )}
    </li>
  );
}

function FolderGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-5 pb-1 pt-3 text-xs font-medium text-ink-subtle">{title}</p>
      <ul className="divide-y divide-line">{children}</ul>
    </div>
  );
}

interface SharedFolderRowProps {
  folder: Folder;
  scope: FolderShareScope;
  faces: StackMember[];
  counts: FolderCounts;
  canManage: boolean;
  onManage: () => void;
}

function SharedFolderRow({ folder, scope, faces, counts, canManage, onManage }: SharedFolderRowProps) {
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <FolderIcon icon={folder.icon} className="h-[18px] w-[18px] text-ink-muted" />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-sm font-medium text-ink">{folder.name}</span>
        <span className="shrink-0 text-xs text-ink-subtle">
          {describeFolderContents(counts.snippets, counts.prompts)}
        </span>
      </span>

      {scope === 'team' ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-light px-2 py-0.5 text-[11px] font-semibold text-primary">
          <Globe className="h-3 w-3" aria-hidden="true" />
          Whole team
        </span>
      ) : (
        faces.length > 0 && <AvatarStack members={faces} className="shrink-0" />
      )}

      <button
        type="button"
        onClick={onManage}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-line bg-card px-3 text-xs font-medium text-ink-muted transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
        {canManage ? 'Manage sharing' : 'View access'}
      </button>
    </li>
  );
}
