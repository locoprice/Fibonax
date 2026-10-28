import { useCallback, useEffect, useMemo, useState } from 'react';
import { Globe, Share2 } from 'lucide-react';
import { EmptyState } from '@/components/layout/EmptyState';
import { LoadingBlock } from '@/components/layout/LoadingBlock';
import { CreateTeamPanel } from '@/features/org/CreateTeamPanel';
import { FolderShareModal } from '@/features/org/FolderShareModal';
import {
  canInvite,
  InvitationRows,
  InvitePeopleButton,
  ROLE_LABEL,
  useInvitations,
} from '@/features/org/InviteMemberPanel';
import { TeamCover } from '@/features/org/TeamCover';
import { Avatar } from '@/components/shared/Avatar';
import { AvatarStack, type StackMember } from '@/components/shared/AvatarStack';
import { useSnippetStore } from '@/stores/snippetStore';
import { usePromptStore } from '@/stores/promptStore';
import { useOrgStore } from '@/stores/orgStore';
import { useAuthStore } from '@/stores/authStore';
import { permissionsApi } from '@/lib/api/permissionsApi';
import { FolderIcon } from '@/lib/folderIcons';
import { describeFolderContents } from '@/lib/teamFolders';
import type {
  Folder,
  FolderPermission,
  FolderShareScope,
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
 * screen. The People list carries the one action, Invite people, and the
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
          <PeopleCard org={activeOrg} members={members} currentUserId={currentUserId} />

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

function PeopleCard({
  org,
  members,
  currentUserId,
}: {
  org: OrganizationSummary;
  members: OrgMember[];
  currentUserId: string | null;
}) {
  const inviter = canInvite(org.myRole);
  const { invitations, refresh } = useInvitations(inviter ? org.id : null);

  return (
    <section className="rounded-[16px] border border-line bg-card" aria-labelledby="team-people-title">
      <CardHeading
        id="team-people-title"
        title="People"
        count={members.length}
        action={inviter ? <InvitePeopleButton org={org} onSent={refresh} /> : undefined}
      />

      {members.length === 0 ? (
        // A team always holds at least you, so an empty list is one still on
        // its way (the directory is fetched after a switch).
        <p className="px-5 py-3 text-sm text-ink-subtle" role="status">
          Loading people…
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {members.map((m) => {
            const isYou = m.user_id === currentUserId;
            // The directory falls back to the email as the display name, so
            // only a real name earns the email a line of its own.
            const name = m.display_name.trim();
            const hasName = name !== '' && name.toLowerCase() !== m.email.toLowerCase();
            return (
              <li key={m.user_id} className="flex items-center gap-3 px-5 py-3">
                <Avatar name={m.display_name} email={m.email} highlight={isYou} size="md" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-ink">
                    {hasName ? name : m.email}
                    {isYou && <span className="font-normal text-ink-subtle"> (you)</span>}
                  </span>
                  {hasName && <span className="truncate text-xs text-ink-subtle">{m.email}</span>}
                </span>
                <span className="shrink-0 text-xs text-ink-muted">{ROLE_LABEL[m.role]}</span>
              </li>
            );
          })}
        </ul>
      )}

      {inviter && <InvitationRows org={org} invitations={invitations} onChanged={refresh} />}
    </section>
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
