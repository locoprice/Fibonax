/**
 * The seasonal line on the dashboard.
 *
 * A snippet body may carry `{seasonal}`: while an occasion is in season it
 * prints that occasion's sentence, and nothing for the rest of the year. Which
 * occasion is in season, its words and its period are decided once, in
 * `extension/shared/season.js`, which the extension, its popup and the phone
 * read. The dashboard loads that same file at runtime (as promptBrain.ts loads
 * the memory pack), for the editor's preview and for Your occasions, so there
 * is no second copy of the rules here.
 *
 * The person's occasions live in the account's settings (`profile.occasions`).
 * `stores/settingsStore.ts` hands them over with `setSeasonCalendar` whenever
 * they change; this file keeps the last list and gives it to the module as
 * soon as the module is on the page.
 */
import { loadScript } from '@/lib/loadScript';
import { applyMyDetails, MY_DETAILS_SRC, myDetailsApi } from '@/lib/myDetails';
import type { StoredOccasion } from '@/types/database';

/** One occasion, complete, as `list` in the module returns it. */
export interface Occasion {
  /** 'christmas', 'newyear' or 'easter' for a ready one, 'own-N' for the person's. */
  id: string;
  ready: boolean;
  name: string;
  /** First and last day as 'MM-DD'. Both '' for Easter, which moves every year. */
  from: string;
  to: string;
  /** Easter only: days before and after Easter Sunday. */
  before: number;
  after: number;
  /**
   * The person's sentence per language (EN, IT, ES, FR), '' where they wrote
   * none: a ready occasion prints its ready words there.
   */
  texts: Record<SeasonLang, string>;
  on: boolean;
}

/** The languages a wish is written in: LANGS in the module. */
export type SeasonLang = 'EN' | 'IT' | 'ES' | 'FR';
export const SEASON_LANGS: readonly SeasonLang[] = ['EN', 'IT', 'ES', 'FR'];

/** What {year} in a wish is called in the editor, and the token it writes. */
export const YEAR_TOKEN = '{year}';

/** The first occasion still to start, and the day it starts on. */
export interface NextOccasion {
  occasion: Occasion;
  month: number;
  day: number;
}

export interface SbSeasonApi {
  MAX_OWN: number;
  MAX_NAME: number;
  MAX_TEXT: number;
  EASTER_BEFORE_MAX: number;
  EASTER_AFTER_MAX: number;
  TOKEN: string;
  /** Whether a value is a day of the year written 'MM-DD'. */
  dayOk(value: unknown): boolean;
  list(raw: unknown): Occasion[];
  pack(items: readonly Occasion[]): StoredOccasion[];
  /** Whether a stored calendar is small enough for the account to keep. */
  fits(packed: readonly StoredOccasion[]): boolean;
  set(raw: unknown): void;
  active(now?: Date, raw?: unknown): Occasion | null;
  /** The year {year} prints for an occasion: the year of its own day. */
  yearOf(occasion: Occasion | null, now?: Date): number;
  next(now?: Date, raw?: unknown): NextOccasion | null;
  /** The ready sentence of a ready occasion in a snippet's language. */
  words(id: string, lang: string): string;
  /**
   * What an occasion prints in a language: the person's sentence with its
   * details and year filled in, else the ready words (or nothing, for an
   * occasion of their own).
   */
  textOf(occasion: Occasion | null, lang: string, year?: number): string;
  /** An occasion's period in words: "8 December to 26 December". */
  periodLabel(occasion: Occasion | null): string;
  hasLine(body: string): boolean;
}

declare global {
  interface Window {
    SBSeason?: SbSeasonApi;
  }
}

/** What the editor's Seasonal line entry inserts. Must equal TOKEN in the module. */
export const SEASONAL_TOKEN = '{seasonal}';

export const SEASON_SRC = '/extension/shared/season.js';

/** The person's occasions as last handed over, for a module that loads later. */
let calendar: StoredOccasion[] = [];
const listeners = new Set<() => void>();

/** The shared module, or null until its script has loaded. */
export function seasonApi(): SbSeasonApi | null {
  return typeof window === 'undefined' ? null : (window.SBSeason ?? null);
}

/** The person's occasions, for every preview on this page from now on. */
export function setSeasonCalendar(raw: StoredOccasion[]): void {
  calendar = raw;
  seasonApi()?.set(raw);
  listeners.forEach((listener) => listener());
}

/** The occasions last handed over. A new list is a new array, so a preview can tell. */
export function seasonCalendar(): StoredOccasion[] {
  return calendar;
}

/** Runs `listener` whenever the occasions change. For `useSyncExternalStore`. */
export function subscribeSeasonCalendar(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Gives a module that has just loaded the occasions it missed. */
export function applySeasonCalendar(): void {
  seasonApi()?.set(calendar);
}

/** The shared module, loading it on first use. Throws if the file cannot be served. */
export async function loadSeason(): Promise<SbSeasonApi> {
  const installed = seasonApi();
  if (installed && myDetailsApi()) return installed;
  // A wish can carry the account's details, so their module comes too.
  await loadScript(MY_DETAILS_SRC);
  await loadScript(SEASON_SRC);
  const api = seasonApi();
  if (!api || !myDetailsApi()) throw new Error('The seasonal line did not load');
  api.set(calendar);
  applyMyDetails();
  return api;
}
