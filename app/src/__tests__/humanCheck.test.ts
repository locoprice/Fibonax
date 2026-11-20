// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  createHumanCheck,
  createWidget,
  HUMAN_CHECK_FAILED,
  HUMAN_CHECK_LOAD_FAILED,
  HumanCheckError,
  humanCheckMessage,
  humanToken,
  type TurnstileApi,
} from '@/lib/humanCheck';

// The bot check Supabase asks for on every sign-in email, password sign-in and
// sign-up. These pin the promises the sign-in and sign-up pages rely on: one
// fresh token per request, failures worded for people, never a silent hang.

type RenderOptions = Parameters<TurnstileApi['render']>[1];

/** A stand-in for Cloudflare's widget that records what the page asked of it. */
function fakeTurnstile(renderResult: string | null = 'w1') {
  const calls: string[] = [];
  let options: RenderOptions | null = null;
  const api: TurnstileApi = {
    render(_container, opts) {
      options = opts;
      calls.push('render');
      return renderResult;
    },
    execute: () => calls.push('execute'),
    reset: () => calls.push('reset'),
    remove: () => calls.push('remove'),
  };
  return {
    api,
    calls,
    solve: (token: string) => options?.callback(token),
    fail: () => options?.['error-callback'](),
    options: () => options,
  };
}

describe('site key', () => {
  // The live project refuses tokens from Cloudflare's test key, so a local dev
  // server signs in with the real one. jsdom serves this page from localhost.
  it('uses the real Fibonax key, on a local dev server too', async () => {
    expect(window.location.hostname).toBe('localhost');
    const t = fakeTurnstile();
    const check = createHumanCheck(() => Promise.resolve(t.api));
    check.attach(document.createElement('div'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.options()?.sitekey).toBe('0x4AAAAAAGFeLqBN8kj1GzgT');
  });
});

describe('humanCheckMessage', () => {
  it('rewords a refused token and leaves every other message alone', () => {
    expect(humanCheckMessage('captcha protection: request disallowed (timeout-or-duplicate)')).toBe(
      HUMAN_CHECK_FAILED,
    );
    expect(humanCheckMessage('Email rate limit exceeded')).toBe('Email rate limit exceeded');
  });
});

describe('createWidget', () => {
  it('runs on demand and only draws a box when Cloudflare needs a click', () => {
    const t = fakeTurnstile();
    createWidget(t.api, document.createElement('div'), 'key');
    expect(t.options()).toMatchObject({ sitekey: 'key', execution: 'execute', appearance: 'interaction-only' });
    expect(t.calls).toEqual(['render']);
  });

  it('says when Cloudflare is about to draw its box', () => {
    const t = fakeTurnstile();
    let shown = 0;
    createWidget(t.api, document.createElement('div'), 'key', () => (shown += 1));
    t.options()?.['before-interactive-callback']();
    expect(shown).toBe(1);
  });

  it('hands out one token per request, resetting before every request after the first', async () => {
    const t = fakeTurnstile();
    const widget = createWidget(t.api, document.createElement('div'), 'key');

    const first = widget.getToken();
    t.solve('token-1');
    await expect(first).resolves.toBe('token-1');

    const second = widget.getToken();
    t.solve('token-2');
    await expect(second).resolves.toBe('token-2');

    expect(t.calls).toEqual(['render', 'execute', 'reset', 'execute']);
  });

  it('turns a Cloudflare error into a plain sentence and marks it handled', async () => {
    const t = fakeTurnstile();
    const widget = createWidget(t.api, document.createElement('div'), 'key');
    const token = widget.getToken();
    expect(t.fail()).toBe(true);
    await expect(token).rejects.toThrow(HUMAN_CHECK_FAILED);
  });

  it('never leaves a request waiting when the widget is taken away', async () => {
    const t = fakeTurnstile();
    const widget = createWidget(t.api, document.createElement('div'), 'key');
    const token = widget.getToken();
    widget.remove();
    await expect(token).rejects.toThrow();
    expect(t.calls).toContain('remove');
  });

  it('reports a widget Cloudflare refused to draw', () => {
    const t = fakeTurnstile(null);
    expect(() => createWidget(t.api, document.createElement('div'), 'key')).toThrow(HUMAN_CHECK_LOAD_FAILED);
  });
});

describe('createHumanCheck', () => {
  it('gives a token once the slot is on the page', async () => {
    const t = fakeTurnstile();
    const check = createHumanCheck(() => Promise.resolve(t.api), () => 'key');
    check.attach(document.createElement('div'));
    const token = check.getToken();
    await new Promise((resolve) => setTimeout(resolve, 0));
    t.solve('token-1');
    await expect(token).resolves.toBe('token-1');
  });

  it('tells the slot when the box is about to show, so it can make room under the button', async () => {
    const t = fakeTurnstile();
    const check = createHumanCheck(() => Promise.resolve(t.api), () => 'key');
    let shown = false;
    check.attach(document.createElement('div'), () => {
      shown = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    t.options()?.['before-interactive-callback']();
    expect(shown).toBe(true);
  });

  it('says the check did not load when Cloudflare cannot be reached', async () => {
    const check = createHumanCheck(
      () => Promise.reject(new HumanCheckError(HUMAN_CHECK_LOAD_FAILED)),
      () => 'key',
    );
    check.attach(document.createElement('div'));
    await expect(check.getToken()).rejects.toThrow(HUMAN_CHECK_LOAD_FAILED);
  });

  it('words anything unexpected from Cloudflare as a failed check', async () => {
    const check = createHumanCheck(() => Promise.reject(new Error('blocked')), () => 'key');
    check.attach(document.createElement('div'));
    await expect(check.getToken()).rejects.toThrow(HUMAN_CHECK_FAILED);
  });

  it('says the check did not load before the slot is on the page', async () => {
    const check = createHumanCheck(() => Promise.resolve(fakeTurnstile().api), () => 'key');
    await expect(check.getToken()).rejects.toThrow(HUMAN_CHECK_LOAD_FAILED);
  });

  it('draws again only after the old widget is gone, as React does on every load in development', async () => {
    let inContainer = 0;
    const t = fakeTurnstile();
    const api: TurnstileApi = {
      ...t.api,
      render(container, opts) {
        if (inContainer > 0) return null; // what Cloudflare does with a taken container
        inContainer += 1;
        return t.api.render(container, opts);
      },
      remove(id) {
        inContainer -= 1;
        t.api.remove(id);
      },
    };
    const check = createHumanCheck(() => Promise.resolve(api), () => 'key');
    const slot = document.createElement('div');
    check.attach(slot);
    check.detach();
    check.attach(slot);

    const token = check.getToken();
    await new Promise((resolve) => setTimeout(resolve, 0));
    t.solve('token-1');
    await expect(token).resolves.toBe('token-1');
    expect(t.calls).toEqual(['render', 'remove', 'render', 'execute']);
  });

  it('removes the widget when the slot leaves the page', async () => {
    const t = fakeTurnstile();
    const check = createHumanCheck(() => Promise.resolve(t.api), () => 'key');
    check.attach(document.createElement('div'));
    check.detach();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.calls).toEqual(['render', 'remove']);
  });
});

describe('humanToken', () => {
  it('passes the reason to the page and gives null, so the page stops', async () => {
    const check = createHumanCheck(() => Promise.resolve(fakeTurnstile().api), () => 'key');
    const shown: string[] = [];
    await expect(humanToken(check, (m) => shown.push(m))).resolves.toBeNull();
    expect(shown).toEqual([HUMAN_CHECK_LOAD_FAILED]);
  });
});
