import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  REVIEW_PROMPT_MAX_VIEWS,
  REVIEW_PROMPT_MESSAGE,
  REVIEW_PROMPT_PLAN_FREE,
  REVIEW_PROMPT_REVIEW_ARIA_LABEL,
  REVIEW_PROMPT_REVIEW_LABEL,
  REVIEW_PROMPT_START_LOGIN,
  REVIEW_PROMPT_STOP_LABEL,
  REVIEW_PROMPT_URL,
  readReviewPromptStatus,
  shouldShowReviewPrompt,
  type ReviewPromptState,
  type ReviewPromptStopReason,
} from '@/lib/reviewPrompt';

// ─────────────────────────────────────────────────────────────────────────────
// Review prompt: ask a free account for a Chrome Web Store review after 10
// sign-ins, at most 5 times.
//
//  1. The rule runs over the REAL extension module (extension/shared/
//     review-prompt.js, what the popup ships) and over the dashboard copy, so
//     the two cannot drift.
//  2. The store carries it out: count the view first, draw only when the
//     server added it, stop for good on click-through and "Don't ask again".
//  3. The numbers the migration holds on its own match the rule.
// ─────────────────────────────────────────────────────────────────────────────

interface ReviewPromptModule {
  START_LOGIN: number;
  MAX_VIEWS: number;
  PLAN_FREE: string;
  REVIEW_URL: string;
  MESSAGE: string;
  REVIEW_LABEL: string;
  REVIEW_ARIA_LABEL: string;
  STOP_LABEL: string;
  STOP_REVIEWED: string;
  STOP_DISMISSED: string;
  readStatus: (body: unknown) => ReviewPromptState | null;
  shouldShow: (state: ReviewPromptState | null) => boolean;
}

function loadModule(path: string): ReviewPromptModule {
  const src = readFileSync(path, 'utf8');
  const mod = { exports: {} as unknown };
  const run = new Function('module', 'exports', src) as (m: typeof mod, e: unknown) => void;
  run(mod, mod.exports);
  return mod.exports as ReviewPromptModule;
}

const ext = loadModule(resolve(process.cwd(), '..', 'extension', 'shared', 'review-prompt.js'));

const DUE: ReviewPromptState = {
  loginCount: 10,
  viewCount: 0,
  stopped: false,
  plan: 'free',
  viewedThisSession: false,
};

const surfaces: [string, (s: ReviewPromptState | null) => boolean][] = [
  ['dashboard copy', shouldShowReviewPrompt],
  ['extension module', ext.shouldShow],
];

describe.each(surfaces)('review prompt rule · %s', (_name, shouldShow) => {
  it('hides at login 9', () => {
    expect(shouldShow({ ...DUE, loginCount: 9 })).toBe(false);
  });

  it('shows at login 10', () => {
    expect(shouldShow({ ...DUE, loginCount: 10 })).toBe(true);
  });

  it('keeps showing after login 10 while views remain', () => {
    expect(shouldShow({ ...DUE, loginCount: 37, viewCount: 2 })).toBe(true);
  });

  it('shows the fifth view (four so far)', () => {
    expect(shouldShow({ ...DUE, viewCount: 4 })).toBe(true);
  });

  it('hides the sixth view (five so far)', () => {
    expect(shouldShow({ ...DUE, viewCount: 5 })).toBe(false);
    expect(shouldShow({ ...DUE, viewCount: 9 })).toBe(false);
  });

  it('hides once stopped (click-through or "Don\'t ask again")', () => {
    expect(shouldShow({ ...DUE, stopped: true })).toBe(false);
  });

  it('hides a paid account, and any plan that is not free', () => {
    expect(shouldShow({ ...DUE, plan: 'pro' })).toBe(false);
    expect(shouldShow({ ...DUE, plan: 'paid' })).toBe(false);
    expect(shouldShow({ ...DUE, plan: '' })).toBe(false);
  });

  it('hides when it was already shown in this sign-in session', () => {
    expect(shouldShow({ ...DUE, viewedThisSession: true })).toBe(false);
  });

  it('fails closed on anything unreadable', () => {
    expect(shouldShow(null)).toBe(false);
    expect(shouldShow({ ...DUE, loginCount: Number.NaN })).toBe(false);
    expect(shouldShow({ ...DUE, viewCount: Number.NaN })).toBe(false);
    expect(shouldShow({ ...DUE, loginCount: undefined as unknown as number })).toBe(false);
    expect(shouldShow({ ...DUE, stopped: undefined as unknown as boolean })).toBe(false);
    expect(shouldShow({ ...DUE, viewedThisSession: undefined as unknown as boolean })).toBe(false);
  });
});

describe('review prompt · the two surfaces agree', () => {
  it('share every constant and word', () => {
    expect(ext.START_LOGIN).toBe(REVIEW_PROMPT_START_LOGIN);
    expect(ext.MAX_VIEWS).toBe(REVIEW_PROMPT_MAX_VIEWS);
    expect(ext.PLAN_FREE).toBe(REVIEW_PROMPT_PLAN_FREE);
    expect(ext.REVIEW_URL).toBe(REVIEW_PROMPT_URL);
    expect(ext.MESSAGE).toBe(REVIEW_PROMPT_MESSAGE);
    expect(ext.REVIEW_LABEL).toBe(REVIEW_PROMPT_REVIEW_LABEL);
    expect(ext.REVIEW_ARIA_LABEL).toBe(REVIEW_PROMPT_REVIEW_ARIA_LABEL);
    expect(ext.STOP_LABEL).toBe(REVIEW_PROMPT_STOP_LABEL);
  });

  it('start at 10 sign-ins and 5 views', () => {
    expect(REVIEW_PROMPT_START_LOGIN).toBe(10);
    expect(REVIEW_PROMPT_MAX_VIEWS).toBe(5);
  });

  it('read the same server answers the same way', () => {
    const row = { login_count: 12, view_count: 3, stopped: false, plan: 'free', viewed_this_session: true };
    const expected: ReviewPromptState = {
      loginCount: 12,
      viewCount: 3,
      stopped: false,
      plan: 'free',
      viewedThisSession: true,
    };
    expect(readReviewPromptStatus([row])).toEqual(expected);
    expect(ext.readStatus([row])).toEqual(expected);
    for (const bad of [null, undefined, [], {}, 'x', [{ ...row, login_count: '12' }], [{ ...row, plan: null }]]) {
      expect(readReviewPromptStatus(bad)).toBeNull();
      expect(ext.readStatus(bad)).toBeNull();
    }
  });

  it('send the review link to the Chrome Web Store reviews tab', () => {
    expect(REVIEW_PROMPT_URL).toMatch(/^https:\/\/chromewebstore\.google\.com\/detail\/[^/]+\/[a-p]{32}\/reviews$/);
  });

  it('say what the owners asked for: an enterprise tool for free, leave us a review', () => {
    expect(REVIEW_PROMPT_MESSAGE).toMatch(/enterprise tool for free/i);
    expect(REVIEW_PROMPT_REVIEW_LABEL).toMatch(/^leave us a review/i);
  });

  it('speak the review button without the smiley', () => {
    expect(REVIEW_PROMPT_REVIEW_LABEL.replace(/\s*:\)$/, '')).toBe(REVIEW_PROMPT_REVIEW_ARIA_LABEL);
  });

  it('keep the copy to one short sentence without long dashes', () => {
    expect(REVIEW_PROMPT_MESSAGE.split(/[.!?]\s/).length).toBe(1);
    expect(REVIEW_PROMPT_MESSAGE.length).toBeLessThanOrEqual(80);
    for (const text of [REVIEW_PROMPT_MESSAGE, REVIEW_PROMPT_REVIEW_LABEL, REVIEW_PROMPT_STOP_LABEL]) {
      expect(text).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe('review prompt · the migration holds the cap on its own', () => {
  const sql = readFileSync(
    resolve(process.cwd(), '..', 'services', 'supabase', 'migrations', '20261027140000_review_prompt.sql'),
    'utf8',
  );

  it('refuses a view above the cap, in the table and in the function', () => {
    expect(sql).toMatch(new RegExp(`check \\(view_count between 0 and ${REVIEW_PROMPT_MAX_VIEWS}\\)`));
    expect(sql).toMatch(new RegExp(`and view_count < ${REVIEW_PROMPT_MAX_VIEWS}\\s`));
  });

  it('counts one login per recorded login event', () => {
    expect(sql).toMatch(/after insert on public\.auth_audit_log/);
    expect(sql).toMatch(/when \(new\.event = 'login' and new\.user_id is not null\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The store: decide, count, draw, stop.
// ─────────────────────────────────────────────────────────────────────────────

const api = vi.hoisted(() => ({
  getStatus: vi.fn(),
  recordView: vi.fn(),
  stop: vi.fn(),
  whenLoginRecorded: vi.fn(),
  calls: [] as string[],
}));

vi.mock('@/lib/api/reviewPromptApi', () => ({
  reviewPromptApi: { getStatus: api.getStatus, recordView: api.recordView, stop: api.stop },
}));
vi.mock('@/lib/api/securityApi', () => ({
  securityApi: { whenLoginRecorded: api.whenLoginRecorded },
}));

// A fresh store, as a fresh page load gives: the per-page check starts over.
async function freshStore() {
  vi.resetModules();
  const mod = await import('@/stores/reviewPromptStore');
  return mod.useReviewPromptStore;
}

// What the server does, as the migration does it (checked against Postgres
// separately): count a view only while not stopped, under the cap, and once
// per sign-in session.
function fakeServer(plan = 'free') {
  const server = { logins: 0, views: 0, stopped: false, session: 0, viewedSession: -1 };
  api.getStatus.mockImplementation(async () => ({
    loginCount: server.logins,
    viewCount: server.views,
    stopped: server.stopped,
    plan,
    viewedThisSession: server.viewedSession === server.session,
  }));
  api.recordView.mockImplementation(async () => {
    if (server.stopped || server.views >= REVIEW_PROMPT_MAX_VIEWS || server.viewedSession === server.session) {
      return false;
    }
    server.views += 1;
    server.viewedSession = server.session;
    return true;
  });
  api.stop.mockImplementation(async (_reason: ReviewPromptStopReason) => {
    server.stopped = true;
  });
  return {
    server,
    signIn() {
      server.logins += 1;
      server.session += 1;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.calls.length = 0;
  api.whenLoginRecorded.mockResolvedValue(undefined);
  api.getStatus.mockResolvedValue(null);
  api.recordView.mockResolvedValue(false);
  api.stop.mockResolvedValue(undefined);
});

describe('review prompt store', () => {
  it('stays hidden and counts nothing below login 10', async () => {
    api.getStatus.mockResolvedValue({ ...DUE, loginCount: 9 });
    const store = await freshStore();
    await store.getState().check('u1');
    expect(store.getState().visible).toBe(false);
    expect(api.recordView).not.toHaveBeenCalled();
  });

  it('counts the view, then shows, at login 10', async () => {
    api.getStatus.mockResolvedValue(DUE);
    api.recordView.mockImplementation(async () => {
      api.calls.push('recordView');
      return true;
    });
    const store = await freshStore();
    await store.getState().check('u1');
    expect(api.recordView).toHaveBeenCalledTimes(1);
    expect(store.getState().visible).toBe(true);
  });

  it('never draws when the server refuses the view', async () => {
    api.getStatus.mockResolvedValue(DUE);
    api.recordView.mockResolvedValue(false);
    const store = await freshStore();
    await store.getState().check('u1');
    expect(store.getState().visible).toBe(false);
  });

  it('stays hidden for a paid account without counting a view', async () => {
    api.getStatus.mockResolvedValue({ ...DUE, plan: 'pro' });
    const store = await freshStore();
    await store.getState().check('u1');
    expect(store.getState().visible).toBe(false);
    expect(api.recordView).not.toHaveBeenCalled();
  });

  it('stays hidden when the counts cannot be read', async () => {
    api.getStatus.mockResolvedValue(null);
    const store = await freshStore();
    await store.getState().check('u1');
    expect(store.getState().visible).toBe(false);
    expect(api.recordView).not.toHaveBeenCalled();
  });

  it('reads the counts only after the sign-in just made is recorded', async () => {
    const order: string[] = [];
    api.whenLoginRecorded.mockImplementation(async () => {
      order.push('login recorded');
    });
    api.getStatus.mockImplementation(async () => {
      order.push('status read');
      return { ...DUE, loginCount: 9 };
    });
    const store = await freshStore();
    await store.getState().check('u1');
    expect(order).toEqual(['login recorded', 'status read']);
  });

  it('checks once per person per page load', async () => {
    api.getStatus.mockResolvedValue({ ...DUE, loginCount: 9 });
    const store = await freshStore();
    await store.getState().check('u1');
    await store.getState().check('u1');
    expect(api.getStatus).toHaveBeenCalledTimes(1);
  });

  it('hides and stops for good on click-through', async () => {
    api.getStatus.mockResolvedValue(DUE);
    api.recordView.mockResolvedValue(true);
    const store = await freshStore();
    await store.getState().check('u1');
    expect(store.getState().visible).toBe(true);
    store.getState().review();
    expect(store.getState().visible).toBe(false);
    expect(api.stop).toHaveBeenCalledWith('reviewed');
  });

  it('hides and stops for good on "Don\'t ask again"', async () => {
    api.getStatus.mockResolvedValue(DUE);
    api.recordView.mockResolvedValue(true);
    const store = await freshStore();
    await store.getState().check('u1');
    store.getState().dismiss();
    expect(store.getState().visible).toBe(false);
    expect(api.stop).toHaveBeenCalledWith('dismissed');
  });
});

describe('review prompt · a whole life, page load by page load', () => {
  // One sign-in then one page load per round, as a person using the dashboard
  // every day. Returns the sign-in numbers on which the prompt was drawn.
  async function live(
    plan: string,
    rounds: number,
    answer?: (signIn: number, store: Awaited<ReturnType<typeof freshStore>>) => void,
  ): Promise<number[]> {
    const { server, signIn } = fakeServer(plan);
    const drawn: number[] = [];
    for (let n = 1; n <= rounds; n += 1) {
      signIn();
      const store = await freshStore();
      await store.getState().check('u1');
      if (store.getState().visible) {
        drawn.push(n);
        answer?.(n, store);
      }
      // A reload inside the same sign-in session draws nothing more.
      const reloaded = await freshStore();
      await reloaded.getState().check('u1');
      expect(reloaded.getState().visible).toBe(false);
    }
    expect(server.views).toBeLessThanOrEqual(REVIEW_PROMPT_MAX_VIEWS);
    return drawn;
  }

  it('draws on sign-ins 10 to 14 and never a sixth time', async () => {
    expect(await live('free', 40)).toEqual([10, 11, 12, 13, 14]);
  });

  it('stops for good after a click-through', async () => {
    expect(await live('free', 30, (n, store) => n === 12 && store.getState().review())).toEqual([10, 11, 12]);
  });

  it('stops for good after "Don\'t ask again"', async () => {
    expect(await live('free', 30, (n, store) => n === 10 && store.getState().dismiss())).toEqual([10]);
  });

  it('never draws for a paid account', async () => {
    expect(await live('pro', 30)).toEqual([]);
  });
});
