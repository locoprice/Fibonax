/**
 * Your details on the dashboard.
 *
 * `{my: name}`, `{my: company}` and `{my: job title}` print what the account of
 * the person using a snippet holds, and so may the seasonal line's wishes. What
 * a token means and how it prints are decided once, in
 * `extension/shared/my-details.js`, which the extension, its popup and the
 * phone read; the dashboard loads the same file with the snippet engine
 * (`lib/fillFormEngine.ts`). The values come from the server (`my_details()`,
 * migration 20261121120000): the account's name, its Company branding (else
 * the one of whoever created the person's team) and the job title the team
 * holds for them.
 *
 * `stores/settingsStore.ts` asks for them with the profile and hands them over
 * with `setMyDetails`; this file keeps the last answer and gives it to the
 * module as soon as the module is on the page.
 */
import { supabase } from '@/lib/supabase';
import { toApiError } from '@/lib/api/apiError';

/** The three details, as the server answers them. '' where the account holds none. */
export interface MyDetails {
  name: string;
  company: string;
  job_title: string;
}

/** A detail as a token writes it: `{my: job title}` holds `job title`. */
export type MyDetailWord = 'name' | 'company' | 'job title';

export interface SbMyDetailsApi {
  DETAILS: ReadonlyArray<{ word: MyDetailWord; key: keyof MyDetails; label: string }>;
  token(word: string): string;
  wordOf(tok: string): string;
  label(word: string): string;
  clean(raw: unknown): MyDetails;
  set(raw: unknown): void;
  get(): MyDetails;
  value(word: string): string;
  wordsIn(text: string): MyDetailWord[];
  missingIn(text: string): MyDetailWord[];
  fill(text: string, extra?: { year?: number }): string | null;
}

declare global {
  interface Window {
    SBMyDetails?: SbMyDetailsApi;
  }
}

export const MY_DETAILS_SRC = '/extension/shared/my-details.js';

/** The details and the words the editor shows for them. Must match DETAILS in the module. */
export const MY_DETAIL_WORDS: ReadonlyArray<{ word: MyDetailWord; key: keyof MyDetails; label: string }> = [
  { word: 'name', key: 'name', label: 'Your name' },
  { word: 'company', key: 'company', label: 'Company name' },
  { word: 'job title', key: 'job_title', label: 'Job title' },
];

/** The token the editor inserts for a detail: `{my: company}`. */
export function myToken(word: MyDetailWord): string {
  return `{my: ${word}}`;
}

export const EMPTY_MY_DETAILS: MyDetails = { name: '', company: '', job_title: '' };

let details: MyDetails = EMPTY_MY_DETAILS;
const listeners = new Set<() => void>();

/** The shared module, or null until its script has loaded. */
export function myDetailsApi(): SbMyDetailsApi | null {
  return typeof window === 'undefined' ? null : (window.SBMyDetails ?? null);
}

/** The details of the person signed in, for every preview on this page from now on. */
export function setMyDetails(next: MyDetails): void {
  details = next;
  myDetailsApi()?.set(next);
  listeners.forEach((listener) => listener());
}

/** The details last handed over. A new answer is a new object, so a preview can tell. */
export function myDetails(): MyDetails {
  return details;
}

/** Runs `listener` whenever the details change. For `useSyncExternalStore`. */
export function subscribeMyDetails(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Gives a module that has just loaded the details it missed. */
export function applyMyDetails(): void {
  myDetailsApi()?.set(details);
}

function text(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

/** Asks the server for the details of the person signed in. */
export async function fetchMyDetails(): Promise<MyDetails> {
  const { data, error } = await supabase.rpc('my_details');
  if (error) throw toApiError(error);
  const o: Record<string, unknown> = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  return { name: text(o['name']), company: text(o['company']), job_title: text(o['job_title']) };
}
