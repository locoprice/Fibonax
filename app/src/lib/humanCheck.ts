// The bot check on sign-in and sign-up: Cloudflare Turnstile.
//
// Once CAPTCHA protection is on in Supabase (Authentication > Attack
// Protection), GoTrue refuses a sign-in email, a password sign-in and a
// sign-up that do not carry a fresh Turnstile token. The widget runs on
// demand: most people never see it, and it only draws a box to click when
// Cloudflare is unsure. Each token works once, so every request asks for a
// new one.

/**
 * Public site key, not a secret. Cloudflare ties it to app.fibonax.com and
 * localhost. The local dev server uses it too: the live Supabase project checks
 * every token against this widget's secret and refuses one from Cloudflare's
 * test key.
 */
const SITE_KEY = '0x4AAAAAAGFeLqBN8kj1GzgT';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export const HUMAN_CHECK_LOAD_FAILED =
  "The security check didn't load. Check your connection, turn off any ad blocker for this page, then try again.";
export const HUMAN_CHECK_FAILED =
  "We couldn't confirm you're a person. Refresh the page and try again.";

export class HumanCheckError extends Error {}

interface TurnstileRenderOptions {
  sitekey: string;
  execution: 'render' | 'execute';
  appearance: 'always' | 'execute' | 'interaction-only';
  callback: (token: string) => void;
  'error-callback': () => boolean;
  'timeout-callback': () => void;
  'before-interactive-callback': () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | null | undefined;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Supabase's own wording for a refused token, in plain words. Other messages pass through. */
export function humanCheckMessage(serverMessage: string): string {
  return /captcha/i.test(serverMessage) ? HUMAN_CHECK_FAILED : serverMessage;
}

let loading: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once per page. A failed load can be tried again. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      const fail = () => {
        loading = null;
        script.remove();
        reject(new HumanCheckError(HUMAN_CHECK_LOAD_FAILED));
      };
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : fail());
      script.onerror = fail;
      document.head.appendChild(script);
    });
  }
  return loading;
}

interface Widget {
  getToken(): Promise<string>;
  remove(): void;
}

/**
 * One widget in `container` that hands out a fresh single-use token per call.
 * `onNeedsClick` runs when Cloudflare is about to draw its box.
 */
export function createWidget(
  api: TurnstileApi,
  container: HTMLElement,
  siteKey: string,
  onNeedsClick: () => void = () => undefined,
): Widget {
  let pending: { resolve: (token: string) => void; reject: (err: Error) => void } | null = null;
  let used = false;

  function settle(outcome: string | Error) {
    const waiting = pending;
    pending = null;
    if (!waiting) return;
    if (typeof outcome === 'string') waiting.resolve(outcome);
    else waiting.reject(outcome);
  }

  const id = api.render(container, {
    sitekey: siteKey,
    execution: 'execute',
    appearance: 'interaction-only',
    callback: (token) => settle(token),
    // Returning true tells Cloudflare the failure is handled here.
    'error-callback': () => {
      settle(new HumanCheckError(HUMAN_CHECK_FAILED));
      return true;
    },
    'timeout-callback': () => settle(new HumanCheckError(HUMAN_CHECK_FAILED)),
    'before-interactive-callback': onNeedsClick,
  });
  if (!id) throw new HumanCheckError(HUMAN_CHECK_LOAD_FAILED);
  const widgetId = id;

  return {
    getToken() {
      settle(new HumanCheckError(HUMAN_CHECK_FAILED));
      return new Promise<string>((resolve, reject) => {
        pending = { resolve, reject };
        if (used) api.reset(widgetId);
        used = true;
        api.execute(widgetId);
      });
    },
    remove() {
      settle(new HumanCheckError(HUMAN_CHECK_LOAD_FAILED));
      api.remove(widgetId);
    },
  };
}

export interface HumanCheck {
  /** Draws the widget into a slot. Called when the slot appears. `onNeedsClick` runs when the box shows. */
  attach(container: HTMLElement, onNeedsClick?: () => void): void;
  /** Takes the widget away. Called when the slot leaves the page. */
  detach(): void;
  /** A fresh token for the next Supabase call. Throws a HumanCheckError worded for people. */
  getToken(): Promise<string>;
}

export function createHumanCheck(
  load: () => Promise<TurnstileApi> = loadTurnstile,
  siteKey: () => string = () => SITE_KEY,
): HumanCheck {
  let ready: Promise<Widget> | null = null;
  // Cloudflare refuses a second widget in a container that still holds one, so
  // a new attach waits until the previous widget is gone. React's development
  // mode attaches, detaches and attaches again on every page load.
  let removed: Promise<void> = Promise.resolve();

  return {
    attach(container, onNeedsClick) {
      const attempt = removed
        .then(load)
        .then((api) => createWidget(api, container, siteKey(), onNeedsClick));
      ready = attempt;
      // A failed load is reported by getToken, when someone presses the button;
      // this only keeps the browser from logging it as unhandled meanwhile.
      attempt.catch(() => undefined);
    },
    detach() {
      const attempt = ready;
      ready = null;
      if (attempt) removed = attempt.then((widget) => widget.remove()).catch(() => undefined);
    },
    async getToken() {
      if (!ready) throw new HumanCheckError(HUMAN_CHECK_LOAD_FAILED);
      try {
        const widget = await ready;
        return await widget.getToken();
      } catch (err) {
        throw err instanceof HumanCheckError ? err : new HumanCheckError(HUMAN_CHECK_FAILED);
      }
    },
  };
}

/** A token for the next request, or null after handing the reason to `onError`. */
export async function humanToken(
  check: HumanCheck,
  onError: (message: string) => void,
): Promise<string | null> {
  try {
    return await check.getToken();
  } catch (err) {
    onError(err instanceof Error ? err.message : HUMAN_CHECK_FAILED);
    return null;
  }
}
