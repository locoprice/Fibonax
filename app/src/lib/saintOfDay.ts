/**
 * The two footer lines, decided once:
 *
 *   "Santo del Giorno · <name>"   the saint of the day, read from Vatican News
 *                                 by the saint-of-the-day server function
 *   "<N> days to Christmas"       plain date arithmetic, no network
 *
 * The popup runs extension/shared/saint-of-day.js. The dashboard cannot load
 * extension code, so this is its copy, and scripts/check-saint-of-day.js runs
 * both over the same cases (scripts/saint-cases.json) and fails when they
 * differ.
 *
 * A saint is fresh while it is under 24 hours old AND was read on today's date
 * in Rome, where the Vatican keeps its calendar, so a saint is never shown the
 * morning after it changed. A saint that cannot be read shows nothing. The
 * countdown does not depend on it and is always shown; it has no switch.
 */

export const SAINT_ENABLED_KEY = 'sb_saint_of_day_enabled';
export const SAINT_CACHE_KEY = 'sb_saint_of_day_cache';
export const SAINT_FUNCTION = 'saint-of-the-day';
export const SAINT_LABEL = 'Santo del Giorno';
export const SAINT_TTL_MS = 24 * 60 * 60 * 1000;
export const SAINT_MAX_NAME = 80;

const VATICAN_TIME_ZONE = 'Europe/Rome';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SaintReading {
  name: string;
  /** The date in Rome the name was read for, YYYY-MM-DD. */
  date: string;
}

export interface SaintEntry extends SaintReading {
  /** When this device read it, in milliseconds. */
  fetchedAt: number;
}

/** On until explicitly turned off. */
export function isSaintOn(value: unknown): boolean {
  return value !== false && value !== 'false';
}

/** Today's date in Rome as YYYY-MM-DD. */
export function romeDay(nowMs: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VATICAN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(nowMs));
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * A name that is safe to put in the footer: plain text on one line, not empty,
 * not long, no markup. null for anything else.
 */
export function cleanSaintName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s || s.length > SAINT_MAX_NAME || /[<>]/.test(s)) return null;
  return s;
}

function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** What the server function answered, or null when it gave no usable saint. */
export function readSaintResponse(body: unknown): SaintReading | null {
  if (!isRecord(body) || body.ok !== true) return null;
  const name = cleanSaintName(body.name);
  if (name === null || !isDay(body.date)) return null;
  return { name, date: body.date };
}

export function makeSaintEntry(reading: SaintReading, nowMs: number): SaintEntry {
  return { name: reading.name, date: reading.date, fetchedAt: nowMs };
}

/** A stored cache entry, or null when it is missing or damaged. */
export function readSaintEntry(raw: unknown): SaintEntry | null {
  if (!isRecord(raw)) return null;
  const name = cleanSaintName(raw.name);
  if (name === null || !isDay(raw.date)) return null;
  if (typeof raw.fetchedAt !== 'number' || !Number.isFinite(raw.fetchedAt)) return null;
  return { name, date: raw.date, fetchedAt: raw.fetchedAt };
}

export function isSaintFresh(raw: unknown, nowMs: number): boolean {
  const entry = readSaintEntry(raw);
  if (!entry || !Number.isFinite(nowMs)) return false;
  const age = nowMs - entry.fetchedAt;
  return age >= 0 && age < SAINT_TTL_MS && entry.date === romeDay(nowMs);
}

export function saintLabel(name: string): string {
  return `${SAINT_LABEL} · ${name}`;
}

/**
 * Whole days from today to the next 25 December, by the calendar on this
 * device. 0 on Christmas Day itself; from 26 December it counts to next year.
 * Calendar days are compared in UTC so a clock change cannot move the count.
 */
export function daysToChristmas(nowMs: number): number {
  const now = new Date(nowMs);
  const year = now.getFullYear();
  const today = Date.UTC(year, now.getMonth(), now.getDate());
  let christmas = Date.UTC(year, 11, 25);
  if (today > christmas) christmas = Date.UTC(year + 1, 11, 25);
  return Math.round((christmas - today) / DAY_MS);
}

export function christmasLabel(days: number): string {
  if (!Number.isFinite(days) || days < 0) return '';
  if (days === 0) return 'Merry Christmas';
  return days === 1 ? '1 day to Christmas' : `${days} days to Christmas`;
}

// Without a browser (the test runner, a build) there is no storage to read or
// write, which is the normal case there and not a failure to report.
const hasBrowser = (): boolean => typeof window !== 'undefined';

/** On unless this browser has stored an explicit "off". */
export function loadSaintEnabled(): boolean {
  if (!hasBrowser()) return true;
  try {
    return isSaintOn(window.localStorage.getItem(SAINT_ENABLED_KEY));
  } catch (err) {
    console.error('Santo del Giorno: could not read the setting on this device:', err);
    return true;
  }
}

/** False when the browser refused the write, so the caller can say so. */
export function saveSaintEnabled(on: boolean): boolean {
  if (!hasBrowser()) return false;
  try {
    window.localStorage.setItem(SAINT_ENABLED_KEY, on ? 'true' : 'false');
    return true;
  } catch (err) {
    console.error('Santo del Giorno: could not save the setting on this device:', err);
    return false;
  }
}

/** The stored saint, or null when there is none or it is damaged. */
export function loadSaintCache(): SaintEntry | null {
  if (!hasBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(SAINT_CACHE_KEY);
    return raw === null ? null : readSaintEntry(JSON.parse(raw));
  } catch (err) {
    console.error('Santo del Giorno: could not read the saved saint on this device:', err);
    return null;
  }
}

export function saveSaintCache(entry: SaintEntry): boolean {
  if (!hasBrowser()) return false;
  try {
    window.localStorage.setItem(SAINT_CACHE_KEY, JSON.stringify(entry));
    return true;
  } catch (err) {
    console.error('Santo del Giorno: could not save the saint on this device:', err);
    return false;
  }
}
