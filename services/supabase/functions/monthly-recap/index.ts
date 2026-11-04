// monthly-recap — Supabase Edge Function (Deno)
// The monthly recap email: one person's month with Fibonax, sent on the
// morning of the 1st through Resend. Migration 20261104120000_monthly_recap.sql.
//
// The figures are the Analytics page's own arithmetic
// (extension/shared/usage-analytics.js, carried here as ../_shared/usage-analytics.js
// by scripts/sync-usage-analytics.js) run for one calendar month, and the
// email itself is decided once in ./recap-email.js, which the node gate
// (scripts/check-monthly-recap.js) renders too. Nothing about the email is
// decided in this file: it loads, sends and records.
//
// Four ways in, each checked here (the gateway's JWT check is off so the stop
// link and the cron job can reach it):
//
//   ?stop=TOKEN            GET or POST, no sign-in: the "Stop the monthly
//                          recap" link in the email footer (also the one-click
//                          unsubscribe header). Turns that person's recap off.
//   { run: ID }            the cron job (monthly_recap_kick). The id is claimed
//                          once, within five minutes of being made, before a
//                          single email goes out, so a stray call sends nothing.
//   { action: 'send' }     a signed-in person: email me last month's recap now,
//                          whatever my switch says. The Settings button.
//   { action: 'preview' }  a signed-in person: the HTML of last month's recap,
//                          for looking at it.
//
// Months are Europe/Rome calendar months, the product's home time. The
// analytics module counts in the clock it runs on (UTC here), so every event
// is shifted by Rome's offset before it is counted, and the month's days come
// out as Rome days.
//
// Environment:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY   injected
//   RESEND_API_KEY                                               a function secret

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0';
import '../_shared/usage-analytics.js';
import { buildRecapModel, renderRecapEmail } from './recap-email.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

const FROM = 'Fibonax <ciao@fibonax.com>';
const RESEND_URL = 'https://api.resend.com/emails';
const DASHBOARD_SETTINGS = 'https://app.fibonax.com/settings';
const HOME_TIME_ZONE = 'Europe/Rome';
/** A run id is good for this long after the cron job makes it. */
const RUN_TTL_MS = 5 * 60 * 1000;
/** Rows per read of the event tables (the server's own page size). */
const PAGE = 1000;
/** Stop sending with this much of the function's time left, so the run row is always written. */
const SEND_BUDGET_MS = 110_000;

interface Engine {
  compute(input: Record<string, unknown>): Record<string, unknown>;
  pareto(input: Record<string, unknown>): Record<string, unknown>;
  formatCount(n: number): string;
  formatDuration(seconds: number): string;
}

const engine = (globalThis as unknown as { SBUsageAnalytics?: Engine }).SBUsageAnalytics;

interface Recipient {
  user_id: string;
  email: string;
  all_time_before: number;
  all_time_after: number;
  best_month_before: number;
  stop_token: string;
}

interface EventRow {
  snippet_id: string | null;
  created_at: string;
  fields_filled: number | null;
  lang: string | null;
  device: string | null;
}

interface PromptEventRow {
  prompt_id: string;
  created_at: string;
  device: string | null;
}

interface Library {
  snippets: unknown[];
  folders: unknown[];
  prompts: unknown[];
}

interface Email {
  subject: string;
  html: string;
  text: string;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function page(html: string, status: number): Response {
  return new Response(html, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ── Rome time ────────────────────────────────────────────────────────────
const ROME_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: HOME_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Rome's offset from UTC at one instant, in milliseconds. */
function romeOffsetMs(ms: number): number {
  const parts = ROME_PARTS.formatToParts(new Date(ms));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The same instant written so that a UTC clock reads it as Rome local time. */
function shiftToRome(iso: string): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + romeOffsetMs(t)).toISOString();
}

/** The UTC instant of midnight in Rome on the 1st of a month (1-12). */
function romeMonthStart(year: number, month: number): number {
  const guess = Date.UTC(year, month - 1, 1);
  return guess - romeOffsetMs(guess);
}

function parseMonth(value: unknown): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(typeof value === 'string' ? value : '');
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(m[1]), month };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** The calendar month before the current one, in Rome. */
function lastMonthInRome(nowMs: number): { year: number; month: number } {
  const local = new Date(nowMs + romeOffsetMs(nowMs));
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + 1;
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// ── Reads ────────────────────────────────────────────────────────────────
async function readAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function recipients(service: SupabaseClient, month: string, userId: string | null): Promise<Recipient[]> {
  const { data, error } = await service.rpc('monthly_recap_recipients', { p_month: month, p_user: userId });
  if (error) throw new Error(error.message);
  return (data ?? []) as Recipient[];
}

/**
 * One person's recap for a month: the subject, the HTML and the text. Reads
 * the month and the one before it (the comparison), the library the person
 * can read, and renders through the shared module and the shared template.
 */
async function recapFor(service: SupabaseClient, who: Recipient, year: number, month: number, nowMs: number): Promise<Email> {
  if (!engine) throw new Error('usage analytics module not loaded');
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const fromIso = new Date(romeMonthStart(prev.year, prev.month)).toISOString();
  const toIso = new Date(romeMonthStart(next.year, next.month)).toISOString();

  const events = await readAll<EventRow>((from, to) =>
    service
      .from('snippet_events')
      .select('snippet_id, created_at, fields_filled, lang, device')
      .eq('user_id', who.user_id)
      .gte('created_at', fromIso)
      .lt('created_at', toIso)
      .order('created_at', { ascending: true })
      .range(from, to));
  const promptEvents = await readAll<PromptEventRow>((from, to) =>
    service
      .from('prompt_events')
      .select('prompt_id, created_at, device')
      .eq('user_id', who.user_id)
      .gte('created_at', fromIso)
      .lt('created_at', toIso)
      .order('created_at', { ascending: true })
      .range(from, to));
  const { data: libraryData, error: libraryError } = await service.rpc('monthly_recap_library', { p_user: who.user_id });
  if (libraryError) throw new Error(libraryError.message);
  const library = (libraryData ?? { snippets: [], folders: [], prompts: [] }) as Library;

  const shifted = events
    .map((e) => ({ ...e, created_at: shiftToRome(e.created_at) }))
    .filter((e) => e.created_at !== null);
  const shiftedPrompts = promptEvents
    .map((e) => ({ ...e, created_at: shiftToRome(e.created_at) }))
    .filter((e) => e.created_at !== null);
  const input = {
    month: monthKey(year, month),
    now: nowMs + romeOffsetMs(nowMs),
    loadedFrom: shiftToRome(fromIso),
    events: shifted,
    promptEvents: shiftedPrompts,
    snippets: library.snippets,
    folders: library.folders,
    prompts: library.prompts,
  };
  const report = engine.compute(input);
  const pareto = engine.pareto(input);
  const model = buildRecapModel({
    report,
    pareto,
    format: { count: engine.formatCount, duration: engine.formatDuration },
    allTimeBefore: who.all_time_before,
    allTimeAfter: who.all_time_after,
    bestMonthBefore: who.best_month_before,
    stopUrl: `${SUPABASE_URL}/functions/v1/monthly-recap?stop=${encodeURIComponent(who.stop_token)}`,
  });
  return renderRecapEmail(model) as Email;
}

// ── Send ─────────────────────────────────────────────────────────────────
/** Sends one email through Resend. Resolves to null, or to the reason it was not sent. */
async function send(to: string, email: Email, stopUrl: string): Promise<string | null> {
  if (!RESEND_API_KEY) return 'no_resend_key';
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: {
          'List-Unsubscribe': `<${stopUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        tags: [{ name: 'kind', value: 'monthly-recap' }],
      }),
    });
    if (res.ok) return null;
    const body = await res.text();
    return `resend ${res.status}: ${body.slice(0, 300)}`;
  } catch (err) {
    return `resend unreachable: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function stopUrlFor(token: string): string {
  return `${SUPABASE_URL}/functions/v1/monthly-recap?stop=${encodeURIComponent(token)}`;
}

// ── The stop link ────────────────────────────────────────────────────────
const STOP_PAGE_STYLE = 'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;background:#F2F2F7;color:#1C1C1E;margin:0;padding:55px 21px;';
const STOP_CARD_STYLE = 'max-width:480px;margin:0 auto;background:#FFFFFF;border:1px solid #E5E5EA;border-radius:21px;padding:34px;';

function stopPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>`
    + `<body style="${STOP_PAGE_STYLE}"><div style="${STOP_CARD_STYLE}">`
    + `<div style="font-size:17px;font-weight:700;margin-bottom:21px;"><span style="display:inline-block;width:13px;height:13px;border-radius:3px;background:#1B4FD8;vertical-align:-1px;margin-right:8px;"></span>Fibonax</div>`
    + `<h1 style="font-size:21px;margin:0 0 8px;">${title}</h1><p style="font-size:15px;line-height:1.5;color:#6E6E73;margin:0;">${body}</p>`
    + `</div></body></html>`;
}

async function handleStop(service: SupabaseClient, token: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return page(stopPage('This link is not valid', 'Open Settings on the dashboard to change the monthly recap.'), 400);
  }
  const { data, error } = await service
    .from('monthly_recap')
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq('stop_token', token)
    .select('user_id');
  if (error) {
    return page(stopPage('Something went wrong', 'The recap could not be turned off. Try the link again in a minute, or open Settings on the dashboard.'), 500);
  }
  if (!data || data.length === 0) {
    return page(stopPage('This link is not valid any more', `Open <a href="${DASHBOARD_SETTINGS}" style="color:#1B4FD8;">Settings</a> on the dashboard to change the monthly recap.`), 404);
  }
  return page(stopPage('Done', `You will not get the monthly recap any more. To turn it back on, open <a href="${DASHBOARD_SETTINGS}" style="color:#1B4FD8;">Settings</a> on the dashboard.`), 200);
}

// ── The scheduled run ────────────────────────────────────────────────────
async function handleRun(service: SupabaseClient, runId: string, startedAt: number): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return json({ error: 'invalid_run' }, 400);
  const notBefore = new Date(startedAt - RUN_TTL_MS).toISOString();
  const { data: claimed, error: claimError } = await service
    .from('monthly_recap_runs')
    .update({ claimed_at: new Date(startedAt).toISOString() })
    .eq('id', runId)
    .is('claimed_at', null)
    .gte('requested_at', notBefore)
    .select('id, month');
  if (claimError) return json({ error: 'run_failed', detail: claimError.message }, 500);
  if (!claimed || claimed.length === 0) return json({ error: 'run_not_claimable' }, 403);

  const month = claimed[0].month as string;
  const key = parseMonth(month);
  if (!key) return json({ error: 'invalid_month' }, 400);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const notes: string[] = [];
  try {
    const list = await recipients(service, month, null);
    for (const who of list) {
      if (Date.now() - startedAt > SEND_BUDGET_MS) {
        skipped++;
        continue;
      }
      try {
        const email = await recapFor(service, who, key.year, key.month, startedAt);
        const problem = await send(who.email, email, stopUrlFor(who.stop_token));
        if (problem) {
          failed++;
          if (notes.length < 5) notes.push(`${who.user_id}: ${problem}`);
          continue;
        }
        const { error: markError } = await service
          .from('monthly_recap')
          .update({ last_sent_month: month, updated_at: new Date().toISOString() })
          .eq('user_id', who.user_id);
        if (markError && notes.length < 5) notes.push(`${who.user_id}: sent but not recorded: ${markError.message}`);
        sent++;
      } catch (err) {
        failed++;
        if (notes.length < 5) notes.push(`${who.user_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    notes.push(`recipients: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (skipped > 0) notes.push(`${skipped} left for lack of time; run again to send them`);

  await service
    .from('monthly_recap_runs')
    .update({ finished_at: new Date().toISOString(), sent, skipped, failed, note: notes.join('\n').slice(0, 2000) || null })
    .eq('id', runId);
  return json({ status: 'done', month, sent, skipped, failed }, 200);
}

// ── A signed-in person ───────────────────────────────────────────────────
async function handlePerson(req: Request, service: SupabaseClient, action: string, startedAt: number): Promise<Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user || !user.email) return json({ error: 'unauthorized' }, 401);

  const key = lastMonthInRome(startedAt);
  const month = monthKey(key.year, key.month);
  let who: Recipient;
  let email: Email;
  try {
    const list = await recipients(service, month, user.id);
    if (list.length === 0) return json({ error: 'not_eligible' }, 409);
    who = list[0];
    email = await recapFor(service, who, key.year, key.month, startedAt);
  } catch (err) {
    console.error('monthly-recap: could not build the recap', { user: user.id, month, reason: err instanceof Error ? err.message : String(err) });
    return json({ error: 'recap_failed' }, 500);
  }

  if (action === 'preview') return page(email.html, 200);

  const problem = await send(who.email, email, stopUrlFor(who.stop_token));
  if (problem) {
    console.error('monthly-recap: send to self failed', { user: user.id, month, reason: problem });
    return json({ error: problem === 'no_resend_key' ? 'not_configured' : 'send_failed' }, 502);
  }
  return json({ status: 'sent', month, to: who.email }, 200);
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const url = new URL(req.url);
  const stopToken = url.searchParams.get('stop');
  if (stopToken !== null && (req.method === 'GET' || req.method === 'POST')) {
    return handleStop(service, stopToken);
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: { run?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  if (typeof body.run === 'string') return handleRun(service, body.run, startedAt);
  const action = typeof body.action === 'string' ? body.action : '';
  if (action === 'send' || action === 'preview') return handlePerson(req, service, action, startedAt);
  return json({ error: 'invalid_action' }, 400);
});
