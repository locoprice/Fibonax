import { supabase } from '@/lib/supabase';
import { toApiError } from '@/lib/api/apiError';
import { fetchAllPages } from '@/lib/api/fetchAllPages';
import type {
  ActivityData,
  ActivityDay,
  ActivityMonth,
  ActivityOverview,
} from '@/types/database';
import type {
  PromptEventRow,
  TeamUsageRow,
  UsageEventRow,
  UsageInput,
  UsagePromptRow,
  UsageSnippetRow,
} from '@/lib/usageAnalytics';

// Live reads over public.snippet_events. The extension and the phone write one
// row per real snippet insert (ANALYTICS-001). Two readers here:
//
//   getUsage()     the raw inputs of the Analytics figures (your own inserts for
//                  the last two years, the library, last uses, and your own
//                  prompt uses with the prompt library for the 80/20 view). The figures
//                  themselves are decided by extension/shared/usage-analytics.js
//                  (lib/usageAnalytics.ts), the same file the phone runs.
//   getActivity()  the year grid and the month-by-month overview.
//
// Events are read in pages (fetchAllPages): one read stopped at the server's
// 1,000-row cap, and an account with more uses than that saw totals that were
// silently short.

export interface AnalyticsApi {
  getUsage(loadFrom: Date): Promise<UsageInput>;
  getTeamUsage(from: Date, to: Date): Promise<TeamUsageRow[] | null>;
  getActivity(): Promise<ActivityData>;
}

// 53 columns = 52 full weeks + the current (partial) week — matches the
// GitHub contribution graph footprint.
const ACTIVITY_WEEKS = 53;

type EventRow = { shortcut: string; created_at: string };

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw toApiError(error);
  if (!data.user) throw new Error('Not authenticated');
  return data.user.id;
}

function dayKey(iso: string): string {
  // YYYY-MM-DD in the user's local timezone — matches the chart's axis labels.
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local midnight of the most recent Sunday on or before `d`. */
function startOfWeekSunday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

/** The first cell (a Sunday) and last cell (today) of the heatmap grid. */
function activityBounds(): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = startOfWeekSunday(end);
  start.setDate(start.getDate() - (ACTIVITY_WEEKS - 1) * 7);
  return { start, end };
}

function buildActivity(events: EventRow[]): Omit<ActivityData, 'overview'> {
  const { start, end } = activityBounds();

  const counts = new Map<string, number>();
  let total = 0;
  for (const ev of events) {
    const k = dayKey(ev.created_at);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    total += 1;
  }

  const days: ActivityDay[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = dayKey(cursor.toISOString());
    days.push({ date: key, count: counts.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  return {
    days,
    total,
    start: dayKey(start.toISOString()),
    end: dayKey(end.toISOString()),
  };
}

type ActivityEventRow = { snippet_id: string | null; created_at: string };

function monthLabel(key: string): string {
  const parts = key.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

interface OverviewInput {
  events: ActivityEventRow[];
  snippetToFolder: Map<string, string | null>;
  folderNames: Map<string, string>;
  promptCount: number;
  brainCount: number;
}

function buildOverview(input: OverviewInput): ActivityOverview {
  const { events, snippetToFolder, folderNames, promptCount, brainCount } = input;

  function folderOf(snippetId: string | null): string {
    const folderId = snippetId ? snippetToFolder.get(snippetId) : null;
    return (folderId && folderNames.get(folderId)) || 'Other';
  }

  // Per-month totals + per-folder breakdown, and a global folder tally.
  const months = new Map<string, { total: number; folders: Map<string, number> }>();
  const folderTotals = new Map<string, number>();

  for (const ev of events) {
    const monthKey = dayKey(ev.created_at).slice(0, 7); // YYYY-MM
    let bucket = months.get(monthKey);
    if (!bucket) {
      bucket = { total: 0, folders: new Map() };
      months.set(monthKey, bucket);
    }
    const folder = folderOf(ev.snippet_id);
    bucket.total += 1;
    bucket.folders.set(folder, (bucket.folders.get(folder) ?? 0) + 1);
    folderTotals.set(folder, (folderTotals.get(folder) ?? 0) + 1);
  }

  const timeline: ActivityMonth[] = Array.from(months.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // most recent first
    .map(([key, bucket]) => ({
      key,
      label: monthLabel(key),
      total: bucket.total,
      items: Array.from(bucket.folders.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, count]) => ({ label, count })),
    }));

  const activeFolders = Array.from(folderTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name]) => name);

  return {
    axes: [
      { key: 'snippets', label: 'Snippets', count: snippetToFolder.size },
      { key: 'prompts', label: 'Prompts', count: promptCount },
      { key: 'folders', label: 'Folders', count: folderNames.size },
      { key: 'brains', label: 'Brains', count: brainCount },
    ],
    activeFolders,
    timeline,
  };
}

export const analyticsApi: AnalyticsApi = {
  async getUsage(loadFrom) {
    const userId = await currentUserId();
    const fromIso = loadFrom.toISOString();

    const [events, snippets, foldersRes, lastUsedRes, promptEvents, prompts] = await Promise.all([
      // Your own inserts only: snippet_events RLS is select-own, and these are
      // figures about how YOU work. Team figures come from getTeamUsage().
      fetchAllPages<UsageEventRow>((from, to) =>
        supabase
          .from('snippet_events')
          .select('snippet_id, created_at, fields_filled, lang, device')
          .eq('user_id', userId)
          .gte('created_at', fromIso)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      // The library you can read (yours and shared with you), as the snippet
      // list shows it. Archived snippets never expand, so they are left out, as
      // the phone leaves them out.
      fetchAllPages<UsageSnippetRow>((from, to) =>
        supabase
          .from('snippets')
          .select('id, title, shortcut, folder_id, lang, created_at')
          .neq('review_status', 'archived')
          .order('id', { ascending: true })
          .range(from, to),
      ),
      supabase.from('folders').select('id, name'),
      supabase.rpc('snippet_last_used'),
      // Your own prompt uses (prompt_events is select-own), for the 80/20 view.
      fetchAllPages<PromptEventRow>((from, to) =>
        supabase
          .from('prompt_events')
          .select('prompt_id, created_at, device')
          .eq('user_id', userId)
          .gte('created_at', fromIso)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      // The prompts you can read, archived ones left out as snippets are.
      fetchAllPages<UsagePromptRow>((from, to) =>
        supabase
          .from('prompts')
          .select('id, name, shortcut')
          .or('review_status.is.null,review_status.neq.archived')
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ]);
    if (foldersRes.error) throw toApiError(foldersRes.error);
    // Last uses decide "never used" and "not used for 90 days". Without them
    // those two would be guessed from two years of your own inserts only, so
    // a failure here is an error, not a quiet fallback.
    if (lastUsedRes.error) throw toApiError(lastUsedRes.error);

    const lastUsed: Record<string, string> = {};
    for (const row of (lastUsedRes.data ?? []) as Array<{ snippet_id: string; last_used_at: string }>) {
      if (row.snippet_id && row.last_used_at) lastUsed[row.snippet_id] = row.last_used_at;
    }

    return {
      events,
      snippets,
      folders: (foldersRes.data ?? []) as Array<{ id: string; name: string }>,
      lastUsed,
      loadedFrom: fromIso,
      promptEvents,
      prompts,
    };
  },

  async getTeamUsage(from, to) {
    const { data, error } = await supabase.rpc('team_usage_by_member', {
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    });
    if (error) {
      // PGRST202: the function is not installed on this database. The page
      // then hides the Team table rather than showing an error for a feature
      // the server does not carry yet.
      if ((error as { code?: string }).code === 'PGRST202') return null;
      throw toApiError(error);
    }
    return ((data ?? []) as Array<{ user_id: string; member_name: string | null; uses: number | string; snippets: number | string }>).map(
      (row) => ({
        user_id: row.user_id,
        member_name: row.member_name,
        uses: Number(row.uses) || 0,
        snippets: Number(row.snippets) || 0,
      }),
    );
  },

  async getActivity() {
    const userId = await currentUserId();
    const { start } = activityBounds();
    const fromIso = start.toISOString();

    const [events, snippetsRes, foldersRes, promptsRes, brainsRes] = await Promise.all([
      fetchAllPages<EventRow & { snippet_id: string | null }>((from, to) =>
        supabase
          .from('snippet_events')
          .select('snippet_id, shortcut, created_at')
          .eq('user_id', userId)
          .gte('created_at', fromIso)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      // No user_id filter: RLS surfaces shared (org) snippets + folders too, so
      // expansions of team snippets resolve to their real folder names instead of
      // an "Other" bucket — matching listSnippets/listFolders (app/CLAUDE.md §6).
      supabase.from('snippets').select('id, folder_id'),
      supabase.from('folders').select('id, name'),
      supabase
        .from('prompts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      // Brains in the trash are not counted, as on the Brains page.
      supabase
        .from('memory_spaces')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .is('deleted_at', null),
    ]);
    if (snippetsRes.error) throw toApiError(snippetsRes.error);
    if (foldersRes.error) throw toApiError(foldersRes.error);

    const grid = buildActivity(events);

    const snippetToFolder = new Map<string, string | null>(
      ((snippetsRes.data ?? []) as Array<{ id: string; folder_id: string | null }>).map((s) => [
        s.id,
        s.folder_id,
      ]),
    );
    const folderNames = new Map<string, string>(
      ((foldersRes.data ?? []) as Array<{ id: string; name: string }>).map((f) => [f.id, f.name]),
    );

    const overview = buildOverview({
      events,
      snippetToFolder,
      folderNames,
      promptCount: promptsRes.count ?? 0,
      brainCount: brainsRes.error ? 0 : brainsRes.count ?? 0,
    });

    return { ...grid, overview };
  },
};
