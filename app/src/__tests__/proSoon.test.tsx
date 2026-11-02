import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Locked AI features (lib/proFeatures.ts).
//
// While the Pro plan does not exist, every entry point to a feature that calls
// the AI service is shown dimmed, with a lock and "Available to Pro users
// soon", and cannot start a request. These tests render each locked control
// and check what a person sees and what the control is allowed to reach.
// Server rendering is enough: the live control is not mounted at all while
// locked, so there is no click to simulate, only markup to read.

const { draft, suggestForSnippet } = vi.hoisted(() => ({
  draft: vi.fn(),
  suggestForSnippet: vi.fn(),
}));

vi.mock('@/lib/api/draftApi', () => ({ draftApi: { draft } }));
vi.mock('@/lib/api/labelSuggestApi', () => ({ labelSuggestApi: { suggestForSnippet } }));

import { ProSoonLock } from '@/components/shared/ProSoon';
import { DraftFromTextButton } from '@/components/shared/DraftWithAi';
import { LabelSuggestions } from '@/features/labels/LabelSuggestions';
import { isProFeatureAvailable, isProPlan, PRO_SOON_LABEL, type ProFeature } from '@/lib/proFeatures';
import { useAuthStore } from '@/stores/authStore';
import type { User } from '@/lib/supabase';

const FEATURES: ProFeature[] = ['ask', 'draft', 'translate', 'labels', 'picture'];
const NOW = Date.parse('2026-11-02T12:00:00Z');

function signInWith(appMetadata: Record<string, unknown>): void {
  useAuthStore.setState({ user: { id: 'u1', app_metadata: appMetadata } as unknown as User });
}

describe('proFeatures', () => {
  afterEach(() => {
    useAuthStore.setState({ user: null });
  });

  it('uses the words the product promises', () => {
    expect(PRO_SOON_LABEL).toBe('Available to Pro users soon');
  });

  it('keeps every AI feature locked for a signed-out or free account', () => {
    for (const feature of FEATURES) {
      expect(isProFeatureAvailable(feature), feature).toBe(false);
    }
    signInWith({ provider: 'email' });
    for (const feature of FEATURES) {
      expect(isProFeatureAvailable(feature), feature).toBe(false);
    }
  });

  it('opens every AI feature to a Pro account', () => {
    signInWith({ plan: 'pro', pro_until: new Date(Date.now() + 86_400_000).toISOString() });
    for (const feature of FEATURES) {
      expect(isProFeatureAvailable(feature), feature).toBe(true);
    }
  });

  it('locks them again once the paid month has passed', () => {
    signInWith({ plan: 'pro', pro_until: new Date(Date.now() - 1000).toISOString() });
    for (const feature of FEATURES) {
      expect(isProFeatureAvailable(feature), feature).toBe(false);
    }
  });

  it('keeps email layouts open to everyone and pictures in snippets off', () => {
    expect(isProFeatureAvailable('emailLayout')).toBe(true);
    signInWith({ plan: 'pro', pro_until: new Date(Date.now() + 86_400_000).toISOString() });
    expect(isProFeatureAvailable('snippetPictures')).toBe(false);
  });

  it('decides who is Pro the way is_pro() does on the server', () => {
    expect(isProPlan({ plan: 'pro', pro_until: '2026-12-02T12:00:00+00:00' }, NOW)).toBe(true);
    expect(isProPlan({ plan: 'pro', pro_until: '2026-11-01T12:00:00+00:00' }, NOW)).toBe(false);
    expect(isProPlan({ plan: 'pro' }, NOW)).toBe(false);
    expect(isProPlan({ plan: 'pro', pro_until: 'infinity' }, NOW)).toBe(false);
    expect(isProPlan({ plan: 'pro', pro_until: 'tomorrow' }, NOW)).toBe(false);
    expect(isProPlan({ plan: 'free', pro_until: '2026-12-02T12:00:00+00:00' }, NOW)).toBe(false);
    expect(isProPlan(null, NOW)).toBe(false);
  });
});

describe('ProSoonLock', () => {
  it('reads the label out for screen readers and shows only the lock', () => {
    const html = renderToStaticMarkup(<ProSoonLock />);
    expect(html).toContain('<svg');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`<span class="sr-only">${PRO_SOON_LABEL}</span>`);
  });
});

describe('Draft from text, locked', () => {
  const render = (tone?: 'light' | 'dark') =>
    renderToStaticMarkup(
      <DraftFromTextButton kind="snippet" noun="snippet" tone={tone} onDrafted={() => {}} />,
    );

  it('shows the button where it will live, switched off, with the lock', () => {
    const html = render();
    expect(html).toContain('Draft from text');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('cursor-not-allowed');
    expect(html).toContain(PRO_SOON_LABEL);
  });

  it('opens nothing: no paste box, no Write draft button', () => {
    const html = render();
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('Write draft');
    expect(draft).not.toHaveBeenCalled();
  });

  it('keeps the editor drawer palette on the dark tone', () => {
    expect(render('dark')).toContain('border-[#2E2E35]');
  });
});

describe('Suggest labels, locked', () => {
  it('shows the control switched off with the lock and never asks for suggestions', () => {
    const html = renderToStaticMarkup(
      <LabelSuggestions
        draft={{ name: 'Welcome', body: 'Hello and welcome aboard', folderName: null, language: 'EN' }}
        value={[]}
        onChange={() => {}}
      />,
    );
    expect(html).toContain('Suggest labels');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain(PRO_SOON_LABEL);
    expect(suggestForSnippet).not.toHaveBeenCalled();
  });
});

describe('AI controls, for a Pro account', () => {
  afterEach(() => {
    useAuthStore.setState({ user: null });
  });

  it('shows Draft from text and Suggest labels live, without the lock', () => {
    signInWith({ plan: 'pro', pro_until: new Date(Date.now() + 86_400_000).toISOString() });
    const draftHtml = renderToStaticMarkup(
      <DraftFromTextButton kind="snippet" noun="snippet" onDrafted={() => {}} />,
    );
    expect(draftHtml).toContain('Draft from text');
    expect(draftHtml).not.toContain(PRO_SOON_LABEL);
    expect(draftHtml).not.toContain('aria-disabled="true"');
    const labelsHtml = renderToStaticMarkup(
      <LabelSuggestions
        draft={{ name: 'Welcome', body: 'Hello and welcome aboard', folderName: null, language: 'EN' }}
        value={[]}
        onChange={() => {}}
      />,
    );
    expect(labelsHtml).toContain('Suggest labels');
    expect(labelsHtml).not.toContain(PRO_SOON_LABEL);
  });
});
