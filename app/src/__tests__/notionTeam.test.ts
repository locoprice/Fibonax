import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTION_ORG_ID } from '../../../services/supabase/functions/_shared/notionGuard';
import { NOTION_TEAM_ID, PROMPT_NOTION_PUSH_AVAILABLE, canPushToNotion } from '@/lib/notionTeam';

// The dashboard shows Push to Notion to the people the server lets push, and
// to nobody else. Anyone outside that team would only get an error, and before
// v3.86.1 their text would have landed in that team's Notion.

const OTHER_TEAM = '00000000-0000-4000-8000-000000000001';

describe('who sees Push to Notion', () => {
  it('names the same team the server checks', () => {
    expect(NOTION_TEAM_ID).toBe(DEFAULT_NOTION_ORG_ID);
  });

  it('shows it to a member of that team', () => {
    expect(canPushToNotion([{ id: NOTION_TEAM_ID }])).toBe(true);
  });

  it('shows it when that team is one of several', () => {
    expect(canPushToNotion([{ id: OTHER_TEAM }, { id: NOTION_TEAM_ID }])).toBe(true);
  });

  it('hides it from every other team and from people with no team', () => {
    expect(canPushToNotion([{ id: OTHER_TEAM }])).toBe(false);
    expect(canPushToNotion([])).toBe(false);
  });

  it('keeps the prompt button hidden while notion-prompt-push is not deployed', () => {
    expect(PROMPT_NOTION_PUSH_AVAILABLE).toBe(false);
  });
});
