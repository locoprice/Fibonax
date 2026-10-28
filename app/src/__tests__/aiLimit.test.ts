import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The per-person AI limit (ai_call_allow, 20261026150000_ai_call_limit.sql).
// Every AI edge function answers 429 `rate_limited` once the caller has used
// 30 calls in an hour or 200 in a day, and every AI feature on the dashboard
// says so in the same words as the phone. Only the network is stubbed.

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke } } }));

import { askApi } from '@/lib/api/askApi';
import { draftApi } from '@/lib/api/draftApi';
import { AI_LIMIT_MESSAGE } from '@/lib/api/edgeFunctionError';
import { labelSuggestApi } from '@/lib/api/labelSuggestApi';
import { translateApi } from '@/lib/api/translateApi';

afterEach(() => {
  invoke.mockReset();
});

function failWith(status: number, code: string): void {
  invoke.mockResolvedValue({
    data: null,
    error: new FunctionsHttpError(
      new Response(JSON.stringify({ error: code }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  });
}

const DRAFT_TEXT = 'Please confirm the delivery date for the order we discussed.';

describe('the AI limit message', () => {
  it('reaches Draft with AI', async () => {
    failWith(429, 'rate_limited');
    await expect(draftApi.draft({ kind: 'snippet', text: DRAFT_TEXT })).rejects.toThrow(AI_LIMIT_MESSAGE);
  });

  it('reaches FiboChat', async () => {
    failWith(429, 'rate_limited');
    await expect(askApi.ask('What is the refund rule?')).rejects.toThrow(AI_LIMIT_MESSAGE);
  });

  it('reaches Translate', async () => {
    failWith(429, 'rate_limited');
    await expect(translateApi.translateBody('Hello there', 'IT')).rejects.toThrow(AI_LIMIT_MESSAGE);
  });

  it('reaches label suggestions', async () => {
    failWith(429, 'rate_limited');
    await expect(
      labelSuggestApi.suggestForSnippet(
        { name: 'Payment terms', body: 'Payment is due in 30 days.', folderName: null, language: 'EN' },
        [],
        [],
      ),
    ).rejects.toThrow(AI_LIMIT_MESSAGE);
  });

  it('is worded the same on the phone', () => {
    const mobile = readFileSync(resolve(process.cwd(), 'public', 'mobile', 'index.html'), 'utf8')
      .replace(/\r\n/g, '\n');
    const match = /var AI_LIMIT_TEXT='([^']*)';/.exec(mobile);
    expect(match?.[1]).toBe(AI_LIMIT_MESSAGE);
    expect(mobile).toContain('var PICTURE_ERRORS={\n  rate_limited:AI_LIMIT_TEXT,');
    expect(mobile).toContain('var ASK_ERRORS={\n  rate_limited:AI_LIMIT_TEXT,');
  });
});

describe('translate and label errors read the code from the reply', () => {
  it('says a changed field was discarded', async () => {
    failWith(422, 'placeholders_corrupted');
    await expect(translateApi.translateBody('Hello {name}', 'ES')).rejects.toThrow(
      'The translation changed a field, so it was discarded. Try again.',
    );
  });

  it('says suggestions are not set up', async () => {
    failWith(503, 'anthropic_not_configured');
    await expect(
      labelSuggestApi.suggestForSnippet(
        { name: 'Payment terms', body: 'Payment is due in 30 days.', folderName: null, language: 'EN' },
        [],
        [],
      ),
    ).rejects.toThrow('AI suggestions are not configured yet.');
  });

  it('falls back to a plain retry message for an unknown code', async () => {
    failWith(503, 'limit_check_failed');
    await expect(translateApi.translateBody('Hello there', 'FR')).rejects.toThrow(
      'Could not reach the translation service. Try again.',
    );
  });
});
