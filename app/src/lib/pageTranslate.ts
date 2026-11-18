import { useSyncExternalStore } from 'react';
import { findPageLanguage } from '@/lib/pageTranslateLanguages';
import { installTranslateGuard } from '@/lib/translateGuard';

/**
 * Shows the dashboard in another language with Google's page translator, the
 * same one the GTranslate plugin drives on a WordPress site.
 *
 * The dashboard is written in English. When a person picks another language,
 * Google's script is loaded and rewrites the words on the page as they appear.
 * Nothing is asked of Google while the choice is English: no script, no
 * cookie, no request.
 *
 * What a person wrote (snippets, prompts, Brains, names) is marked
 * `translate="no"` where it is shown, so Google leaves it alone: it is neither
 * rewritten nor sent off to be translated. A name printed inside a sentence of
 * the interface (a confirmation message) still travels with that sentence.
 *
 * The choice is kept on this device, like the theme. Google itself reads it
 * from the `googtrans` cookie when its script starts.
 */

/** The language the dashboard is written in. */
export const SOURCE_LANGUAGE = 'en';

const STORAGE_KEY = 'fibonax-page-language';
const COOKIE_NAME = 'googtrans';
const HOST_ID = 'page-translate-host';
const READY_CALLBACK = 'fibonaxPageTranslateReady';
const SCRIPT_SRC = `https://translate.google.com/translate_a/element.js?cb=${READY_CALLBACK}`;

/** How often, and how many times, the page is checked before Google is given a push. */
const NUDGE_EVERY_MS = 500;
const NUDGE_TRIES = 30;

/**
 * off: English, Google not loaded. loading: Google is on its way. on: the page
 * is translated. failed: Google could not be reached.
 */
export type PageTranslateStatus = 'off' | 'loading' | 'on' | 'failed';

export interface PageTranslateState {
  language: string;
  status: PageTranslateStatus;
}

interface TranslateElementConstructor {
  new (options: { pageLanguage: string; autoDisplay: boolean }, hostId: string): unknown;
}

declare global {
  interface Window {
    google?: { translate?: { TranslateElement?: TranslateElementConstructor } };
    fibonaxPageTranslateReady?: () => void;
  }
}

/** True for a code the dashboard can be shown in, English included. */
export function isPageLanguage(code: string): boolean {
  return code === SOURCE_LANGUAGE || findPageLanguage(code) !== null;
}

/** What Google's cookie holds for a language: "/en/it". */
export function translationCookieValue(code: string): string {
  return `/${SOURCE_LANGUAGE}/${code}`;
}

/**
 * Every `domain` the cookie may sit under for this address, '' for the address
 * itself.
 *
 * Google writes its cookie for the address and for the site above it
 * (`.fibonax.com` from `app.fibonax.com`). Two cookies with two languages
 * would leave Google to pick one, so a change clears all of them first.
 */
export function translationCookieDomains(hostname: string): string[] {
  const domains = ['', hostname, `.${hostname}`];
  const parts = hostname.split('.');
  const isAddress = /^[\d.]+$/.test(hostname) || hostname.includes(':');
  if (!isAddress) {
    for (let i = 1; i < parts.length - 1; i += 1) {
      const parent = parts.slice(i).join('.');
      domains.push(parent, `.${parent}`);
    }
  }
  return domains;
}

function readStoredLanguage(): string {
  // Read at module load. Storage is not always reachable there: a browser with
  // site data blocked throws on access, and the vitest 'node' environment has
  // none at all. English is what a first-time visitor gets anyway.
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && isPageLanguage(stored) ? stored : SOURCE_LANGUAGE;
  } catch {
    return SOURCE_LANGUAGE;
  }
}

function writeCookies(code: string): void {
  for (const domain of translationCookieDomains(window.location.hostname)) {
    const scope = domain === '' ? '' : `; domain=${domain}`;
    document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${scope}`;
  }
  if (code !== SOURCE_LANGUAGE) {
    document.cookie = `${COOKIE_NAME}=${translationCookieValue(code)}; path=/`;
  }
}

let state: PageTranslateState = { language: readStoredLanguage(), status: 'off' };
let started = false;
const listeners = new Set<() => void>();

function setState(next: Partial<PageTranslateState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getState(): PageTranslateState {
  return state;
}

export function getPageTranslateState(): PageTranslateState {
  return state;
}

/** The language in use and whether the translation is on, for a component. */
export function usePageTranslate(): PageTranslateState {
  return useSyncExternalStore(subscribe, getState, getState);
}

function isPageTranslated(): boolean {
  const classes = document.documentElement.classList;
  return classes.contains('translated-ltr') || classes.contains('translated-rtl');
}

/**
 * Google translates on its own from the cookie. When it has not, its hidden
 * menu is set to the language and told it changed, which is how GTranslate
 * drives it.
 */
function nudge(code: string, triesLeft: number): void {
  if (isPageTranslated()) return;
  if (triesLeft === 0) {
    // A tab in the background is not translated until it is looked at, so
    // only a page in view that stayed in English counts as a failure.
    if (document.visibilityState === 'visible') setState({ status: 'failed' });
    return;
  }
  const menu = document.querySelector<HTMLSelectElement>(`#${HOST_ID} select`);
  if (menu && menu.options.length > 0 && triesLeft % 4 === 0) {
    menu.value = code;
    menu.dispatchEvent(new Event('change'));
  }
  window.setTimeout(() => nudge(code, triesLeft - 1), NUDGE_EVERY_MS);
}

/**
 * Loads Google's translator when the stored choice is not English. Called once
 * as the app starts, and again by `setPageLanguage` for a first choice.
 */
export function startPageTranslation(): void {
  const code = state.language;
  if (started || code === SOURCE_LANGUAGE || typeof document === 'undefined') return;
  started = true;
  setState({ status: 'loading' });

  // Before Google's script, so every text it takes off the page is known.
  installTranslateGuard();
  writeCookies(code);

  const watcher = new MutationObserver(() => {
    if (isPageTranslated() && state.status !== 'on') setState({ status: 'on' });
  });
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.hidden = true;
  document.body.appendChild(host);

  window[READY_CALLBACK] = () => {
    const TranslateElement = window.google?.translate?.TranslateElement;
    if (!TranslateElement) {
      setState({ status: 'failed' });
      return;
    }
    new TranslateElement({ pageLanguage: SOURCE_LANGUAGE, autoDisplay: false }, HOST_ID);
    nudge(code, NUDGE_TRIES);
  };

  const script = document.createElement('script');
  script.src = SCRIPT_SRC;
  script.async = true;
  script.onerror = () => setState({ status: 'failed' });
  document.head.appendChild(script);
}

/**
 * Changes the language the dashboard is shown in.
 *
 * A first choice translates the page where it stands. Any later change (to
 * another language, or back to English) reloads the page, so Google always
 * starts from the dashboard's own English words, never from a translation.
 */
export function setPageLanguage(code: string): void {
  if (!isPageLanguage(code)) return;
  if (code === state.language) {
    // Picking the same language again after a failure is "try again".
    if (state.status === 'failed') window.location.reload();
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Site data is blocked: the choice still holds for this visit.
  }
  writeCookies(code);

  if (!started && code !== SOURCE_LANGUAGE) {
    setState({ language: code });
    startPageTranslation();
    return;
  }
  window.location.reload();
}
