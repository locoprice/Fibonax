// saint-of-the-day — Supabase Edge Function (Deno)
// The "Santo del Giorno" line in the footer of the dashboard and the popup.
//
//   Vatican News' "Santo del giorno" page → the saint's name
//
// Both footers call this one function and read the same answer, so the two can
// never show different saints. What the name must look like is decided in
// parseSaint.ts; how long a device keeps it is decided in
// extension/shared/saint-of-day.js (and its dashboard copy).
//
// Guarantees, each enforced here:
//
// 1. Only a signed-in caller can use it: the JWT is checked first, and there
//    is no service-role client in this file.
// 2. One fixed address. Nothing the caller sends is ever fetched, so there is
//    nothing to point it elsewhere, and a redirect is followed only while it
//    stays on the same https host.
// 3. Bounded: 8 seconds for the whole fetch, 2 MB read at most, HTML only.
// 4. Easy on the source: the saint is kept in memory for the rest of the day in
//    Rome, one fetch is shared by callers who arrive together, and a failed
//    read is not retried for 5 minutes. This is per running copy of the
//    function, so it is "about once a day", not a promise of exactly once.
// 5. Nothing is stored and the page is never logged. When no name is found the
//    log carries the page's title and first headings, cut short, so the reader
//    can be fixed without guessing.
//
// Environment (injected automatically by the runtime):
//   SUPABASE_URL, SUPABASE_ANON_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { describePage, parseSaint } from './parseSaint.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const SOURCE_URL = 'https://www.vaticannews.va/it/santo-del-giorno.html';
const SOURCE_HOST = 'www.vaticannews.va';
/** The whole fetch, redirects included. */
const TIMEOUT_MS = 8_000;
/** Bytes read from the page before giving up on it. */
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** Redirects followed before giving up. */
const MAX_REDIRECTS = 2;
/** How long a failed read is remembered, so a broken source is not hammered. */
const RETRY_AFTER_MS = 5 * 60 * 1000;
/** What the page is told is reading it. */
const USER_AGENT = 'Mozilla/5.0 (compatible; SprintBrain-SaintReader/1.0; +https://sprintbrain.com)';
/** The day the Vatican keeps its calendar by. */
const VATICAN_TIME_ZONE = 'Europe/Rome';

type Failure = { code: string; status: number; upstream?: number };
type Reading = { date: string; name: string };

class ReadFailure extends Error {
  constructor(readonly failure: Failure) {
    super(failure.code);
  }
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function fail(code: string, status: number, upstream?: number): never {
  throw new ReadFailure({ code, status, upstream });
}

/** Today's date in Rome as YYYY-MM-DD. */
function romeToday(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VATICAN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Reads at most MAX_PAGE_BYTES of a body, then stops. */
async function readCapped(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_PAGE_BYTES) fail('saint_unavailable', 502);
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PAGE_BYTES) {
      await reader.cancel();
      fail('saint_unavailable', 502);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*"?([A-Za-z0-9._:-]+)/i.exec(contentType)?.[1]?.toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Fetches the page, following a redirect only while it stays on the same https host. */
async function fetchPage(signal: AbortSignal): Promise<{ html: string; status: number }> {
  let current = SOURCE_URL;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'Accept-Language': 'it',
        },
      });
    } catch (err) {
      if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        fail('saint_timeout', 504);
      }
      fail('saint_unavailable', 502);
    }

    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      await res.body?.cancel();
      if (!next) fail('saint_unavailable', 502, res.status);
      const target = new URL(next, current);
      if (target.protocol !== 'https:' || target.hostname !== SOURCE_HOST) {
        fail('saint_unavailable', 502, res.status);
      }
      current = target.toString();
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel();
      fail('saint_unavailable', 502, res.status);
    }
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.startsWith('text/html') && !contentType.startsWith('application/xhtml+xml')) {
      await res.body?.cancel();
      fail('saint_unavailable', 502, res.status);
    }
    return { html: decode(await readCapped(res), contentType), status: res.status };
  }
  fail('saint_unavailable', 502, 310);
}

async function readSaintFromSource(date: string): Promise<Reading> {
  const started = Date.now();
  try {
    const page = await fetchPage(AbortSignal.timeout(TIMEOUT_MS));
    const name = parseSaint(page.html);
    if (!name) {
      console.error('saint-of-the-day: no name found', JSON.stringify({
        upstream: page.status,
        bytes: page.html.length,
        ms: Date.now() - started,
        page: describePage(page.html),
      }));
      fail('saint_not_found', 502, page.status);
    }
    return { date, name };
  } catch (err) {
    if (err instanceof ReadFailure && err.failure.code === 'saint_not_found') throw err;
    const failure: Failure = err instanceof ReadFailure ? err.failure : { code: 'saint_unavailable', status: 502 };
    console.error('saint-of-the-day: page not read', JSON.stringify({
      code: failure.code,
      upstream: failure.upstream ?? null,
      ms: Date.now() - started,
      cause: err instanceof ReadFailure ? null : (err instanceof Error ? err.name : 'unknown'),
    }));
    throw err instanceof ReadFailure ? err : new ReadFailure(failure);
  }
}

// ── What this running copy remembers ─────────────────────────────────
let cached: Reading | null = null;
let failed: { until: number; failure: Failure } | null = null;
let inflight: Promise<Reading> | null = null;

/** Today's saint: from memory, from a read already under way, or from the source. */
function currentSaint(): Promise<Reading> {
  const today = romeToday();
  if (cached && cached.date === today) return Promise.resolve(cached);
  if (failed && Date.now() < failed.until) return Promise.reject(new ReadFailure(failed.failure));
  if (!inflight) {
    inflight = readSaintFromSource(today)
      .then((reading) => {
        cached = reading;
        failed = null;
        return reading;
      })
      .catch((err: unknown) => {
        const failure = err instanceof ReadFailure ? err.failure : { code: 'saint_unavailable', status: 502 };
        failed = { until: Date.now() + RETRY_AFTER_MS, failure };
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  // ── Auth: validate the caller's JWT ──────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();
  if (authError || !user) return json({ error: 'unauthorized' }, 401);

  // The request carries nothing the answer depends on, so the body is ignored.
  try {
    const reading = await currentSaint();
    return json({ ok: true, date: reading.date, name: reading.name }, 200);
  } catch (err) {
    const failure = err instanceof ReadFailure ? err.failure : { code: 'saint_unavailable', status: 502 };
    return json({ error: failure.code }, failure.status);
  }
});
