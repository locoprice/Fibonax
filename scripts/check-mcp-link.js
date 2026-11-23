#!/usr/bin/env node
// THE AI APP LINK gate.
//
// A person makes a link in Settings > Integrations > AI apps and pastes it into
// Claude, ChatGPT or another AI app, which then reads their Prompts and Brains
// over MCP. Three pieces make that work, and this gate holds them together:
//
//   services/supabase/functions/mcp/server.js   the conversation, run here as
//                                                an AI app would run it, with
//                                                the database replaced by a fake
//   services/supabase/functions/mcp/index.ts     the wiring: publishable key only,
//                                                one database function, the shared
//                                                Brain module
//   20261121120000_ai_app_link.sql               public.mcp_call: checks the key,
//                                                reads as its owner under row level
//                                                security, and switches back
//   app/src/lib/aiAppLink.ts                     the link the dashboard hands out
//
// What the database itself does (who sees which prompt, FiboTokens, the rate
// limit) was tested against a real Postgres when the migration was written;
// this gate pins the shapes and the guarantees the server relies on.
//
// Run: node scripts/check-mcp-link.js

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log('  ok  ' + name);
  else {
    failed++;
    console.error('  X   ' + name + '\n      expected ' + JSON.stringify(expected) + '\n      got      ' + JSON.stringify(actual));
  }
}

const pack = require(path.join(ROOT, 'extension', 'shared', 'memory-pack.js'));

// ── The fake database: mcp_call's answers, in mcp_call's shapes ─────────────

const KEYS = {
  full: 'sbmw_' + 'a'.repeat(64),
  brains: 'sbmw_' + 'b'.repeat(64),
  off: 'sbmw_' + 'c'.repeat(64),
  limit: 'sbmw_' + 'd'.repeat(64),
  rate: 'sbmw_' + 'e'.repeat(64),
  down: 'sbmw_' + 'f'.repeat(64),
};
const BRAIN = '5a5a5a5a-0000-4000-8000-000000000002';
const PROMPT = '9a000000-0000-4000-8000-000000000001';
const TWIN = '9a000000-0000-4000-8000-000000000003';
const ITEM = '1a000000-0000-4000-8000-000000000001';
const PROMPT_TEXT = '## Role\nYou answer emails.\n\n## Context\n' + pack.brainToken({ id: BRAIN, name: 'Marketing' }) + '\n\nKeep it warm.';
const ITEMS = [{ name: 'Tone', body: 'Friendly.' }, { name: 'Hours', body: '9 to 5' }];
const PROMPTS = [
  { id: PROMPT, name: 'Reply', folder: 'Mine', status: 'approved', first_line: 'You answer emails.', updated_at: '2026-11-20T10:00:00Z' },
  { id: TWIN, name: 'Reply', folder: null, status: 'deprecated', first_line: pack.brainToken({ id: BRAIN, name: 'Marketing' }), updated_at: '2026-11-20T10:00:00Z' },
];

const calls = [];
async function callDb(key, action, args) {
  calls.push({ key, action, args });
  if (key === KEYS.off) return null;
  if (key === KEYS.rate) throw Object.assign(new Error('rate limited'), { rateLimited: true });
  if (key === KEYS.down) throw new Error('connection refused');
  const prompts = key !== KEYS.brains;
  if (action === 'whoami') return { prompts, save: key === KEYS.full };
  if (action === 'search') {
    if (args.query === 'nothing') return { results: [] };
    return {
      results: [
        { kind: 'prompt', id: PROMPT, title: 'Reply', summary: 'You answer emails.', status: 'approved', brain_id: null, container_name: 'Mine' },
        { kind: 'memory', id: ITEM, title: 'Tone', summary: 'How we write', status: 'approved', brain_id: BRAIN, container_name: 'Marketing' },
      ],
    };
  }
  if (action === 'prompts') return prompts ? { prompts: PROMPTS, total: 2 } : { error: 'no_prompts' };
  if (action === 'brains') return { brains: [{ id: BRAIN, name: 'Marketing', description: '', default: false, items: 2 }] };
  if (action === 'brain_items') return args.brain === BRAIN ? { brain: { id: BRAIN, name: 'Marketing' }, items: [{ id: ITEM, name: 'Tone', summary: 'How we write', tokens: 3, status: 'approved' }] } : { error: 'not_found' };
  if (action === 'prompt') {
    if (!prompts) return { error: 'no_prompts' };
    if (key === KEYS.limit) return { error: 'limit', kind: 'prompt' };
    const hit = PROMPTS.find((p) => p.id === args.id);
    return hit ? { prompt: { id: hit.id, name: hit.name, text: PROMPT_TEXT, status: hit.status, folder: hit.folder } } : { error: 'not_found' };
  }
  if (action === 'item') return args.id === ITEM ? { item: { id: ITEM, name: 'Tone', summary: 'How we write', text: 'Friendly.', status: 'deprecated', brain_id: BRAIN, brain: 'Marketing' } } : { error: 'not_found' };
  if (action === 'brains_text') return { brains: args.ids.includes(BRAIN) ? [{ id: BRAIN, name: 'Marketing', items: ITEMS }] : [] };
  if (action === 'save') return key === KEYS.full ? { saved: { id: ITEM, name: args.name, brain_id: BRAIN, brain: 'Marketing' } } : { error: 'no_save' };
  return { error: 'bad_request' };
}

async function main() {
  const server = await import(pathToFileURL(path.join(ROOT, 'services', 'supabase', 'functions', 'mcp', 'server.js')).href);
  const { createMcpServer, TEXT, LIMITS, PROTOCOL_VERSIONS, SERVER_VERSION } = server;
  const logs = [];
  const mcp = createMcpServer({ callDb, pack, log: (m) => logs.push(m) });

  const URL_BASE = 'https://example.test/functions/v1/mcp';
  async function post(body, { key = KEYS.full, header = false } = {}) {
    const url = header || !key ? URL_BASE : URL_BASE + '?key=' + key;
    const headers = { 'content-type': 'application/json' };
    if (header) headers.authorization = 'Bearer ' + key;
    const res = await mcp.handle(new Request(url, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  let nextId = 1;
  const rpc = (method, params, opts) => post({ jsonrpc: '2.0', id: nextId++, method, params }, opts);
  async function tool(name, args, opts) {
    const r = await rpc('tools/call', { name, arguments: args }, opts);
    const result = r.body.result;
    return { error: !!result.isError, text: result.content[0].text };
  }

  console.log('HTTP');
  check('OPTIONS answers the browser check', (await mcp.handle(new Request(URL_BASE, { method: 'OPTIONS' }))).status, 204);
  check('GET is refused: no event stream', (await mcp.handle(new Request(URL_BASE + '?key=' + KEYS.full))).status, 405);
  check('a body that is not JSON is a parse error', (await post('{nope')).body.error.code, -32700);
  const noKey = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { key: null });
  check('a link without its key is refused, saying how to fix it', [noKey.status, noKey.body.error.message], [401, TEXT.noKey]);
  check('a key that is not a key is refused the same way', (await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { key: 'sbmw_short' })).status, 401);
  check('the key works from the Authorization header too', (await rpc('ping', {}, { key: KEYS.full, header: true })).body.result, {});

  console.log('Protocol');
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gate', version: '1' } });
  check('initialize answers the version asked for', init.body.result.protocolVersion, '2025-06-18');
  check('an unknown version gets the default', (await rpc('initialize', { protocolVersion: '1999-01-01' })).body.result.protocolVersion, '2025-06-18');
  check('the versions offered include the current spec', PROTOCOL_VERSIONS.includes('2025-06-18') && PROTOCOL_VERSIONS.includes('2025-03-26'), true);
  check('it offers tools and prompts', Object.keys(init.body.result.capabilities).sort(), ['prompts', 'tools']);
  check('it names itself Fibonax, at the release version', [init.body.result.serverInfo.title, SERVER_VERSION], ['Fibonax', JSON.parse(read('extension', 'manifest.json')).version]);
  const notified = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  check('a notification is accepted with no answer', [notified.status, notified.body], [202, null]);
  const batch = await post([{ jsonrpc: '2.0', id: 'a', method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }]);
  check('a batch answers each request and skips notifications', batch.body.map((m) => m.id), ['a']);
  check('an unknown method is method-not-found', (await rpc('resources/list', {})).body.error.code, -32601);
  check('an unknown tool is invalid-params', (await rpc('tools/call', { name: 'delete_everything', arguments: {} })).body.error.code, -32602);

  console.log('Tools');
  const names = async (key) => (await rpc('tools/list', {}, { key })).body.result.tools.map((t) => t.name);
  check('a link that may save lists save_to_brain', await names(KEYS.full), ['search', 'fetch', 'list_prompts', 'list_brains', 'save_to_brain']);
  check('a read-only link does not', await names(KEYS.brains), ['search', 'fetch', 'list_prompts', 'list_brains']);
  check('a switched-off link still lists the read tools (calling them says why not)', await names(KEYS.off), ['search', 'fetch', 'list_prompts', 'list_brains']);
  const readOnly = (await rpc('tools/list', {}, { key: KEYS.full })).body.result.tools.filter((t) => t.name !== 'save_to_brain');
  check('every read tool says it only reads', readOnly.every((t) => t.annotations.readOnlyHint === true), true);

  const search = JSON.parse((await tool('search', { query: 'reply' })).text);
  check('search hands back ids fetch understands', search.results.map((r) => r.id), ['prompt:' + PROMPT, 'item:' + ITEM]);
  check('a Brain item links to its place in the dashboard', search.results[1].url, 'https://app.fibonax.com/memory/' + BRAIN + '?item=' + ITEM);
  check('no match points to the lists', JSON.parse((await tool('search', { query: 'nothing' })).text).note, TEXT.nothingFound);
  check('an empty query asks for words, without a database call', await (async () => { const before = calls.length; const r = await tool('search', { query: '  ' }); return [r.error, calls.length - before]; })(), [true, 0]);

  const fetched = JSON.parse((await tool('fetch', { id: 'prompt:' + PROMPT })).text);
  const lookup = { [BRAIN]: { name: 'Marketing', items: ITEMS } };
  check("a prompt comes with its Brain filled in by memory-pack's own rule", fetched.text, pack.resolvePromptBrains(PROMPT_TEXT, lookup));
  check('the Brain is introduced the way every surface introduces it', fetched.text.includes(pack.brainLeadLine('Marketing')) && !fetched.text.includes('{brain:'), true);
  const whole = JSON.parse((await tool('fetch', { id: 'brain:' + BRAIN })).text);
  check('a whole Brain is handed out as Copy whole Brain hands it out', whole.text, pack.formatBrainBlock(ITEMS));
  const item = JSON.parse((await tool('fetch', { id: ITEM })).text);
  check('a bare id is found among prompts, then Brain items', item.id, 'item:' + ITEM);
  check('a deprecated item says so', item.metadata.note, TEXT.deprecated);
  check('an id that is not an id is refused without a database call', await (async () => { const before = calls.length; const r = await tool('fetch', { id: "1; drop table prompts" }); return [r.error, calls.length - before]; })(), [true, 0]);

  check('a Brains-only link explains it cannot read prompts', await tool('fetch', { id: 'prompt:' + PROMPT }, { key: KEYS.brains }), { error: true, text: TEXT.noPrompts });
  check('a switched-off link says so', await tool('list_brains', {}, { key: KEYS.off }), { error: true, text: TEXT.notValid });
  check('used-up free uses say what to do', await tool('fetch', { id: 'prompt:' + PROMPT }, { key: KEYS.limit }), { error: true, text: TEXT.limitPrompt });
  check('the rate limit asks to wait', await tool('list_brains', {}, { key: KEYS.rate }), { error: true, text: TEXT.rateLimited });
  check('an unreachable database is a calm retry message', await tool('list_brains', {}, { key: KEYS.down }), { error: true, text: TEXT.unreachable });
  check('nothing logged carries a key', logs.some((m) => Object.values(KEYS).some((k) => m.includes(k))), false);

  const list = (await tool('list_prompts', {})).text;
  check('list_prompts shows a Brain token as its name, never the raw token', list.includes('Brain: Marketing') && !list.includes('{brain:'), true);
  check('list_brains with a Brain id lists its items', (await tool('list_brains', { brain_id: 'brain:' + BRAIN })).text.includes('id: item:' + ITEM), true);

  console.log('Saving');
  check('a name over the limit is refused before the database', await (async () => { const before = calls.length; const r = await tool('save_to_brain', { name: 'x'.repeat(LIMITS.name + 1), text: 't' }); return [r.error, calls.length - before]; })(), [true, 0]);
  check('saving says where it went and that it is marked AI generated', (await tool('save_to_brain', { name: 'Note', text: 'Kept.', brain_id: 'brain:' + BRAIN })).text.startsWith('Saved "Note" in the Brain "Marketing". It is marked AI generated'), true);
  check('the Brain id reaches the database bare', calls.filter((c) => c.action === 'save').pop().args, { name: 'Note', text: 'Kept.', brain: BRAIN });
  check('a link without saving explains how to get it', await tool('save_to_brain', { name: 'N', text: 'T' }, { key: KEYS.brains }), { error: true, text: TEXT.noSave });

  console.log('Prompts as commands');
  const listed = (await rpc('prompts/list', {})).body.result.prompts;
  check('two prompts with one name get two names', listed.map((p) => p.name), ['reply', 'reply-2']);
  check('a prompt keeps its own name as the title', listed[0].title, 'Reply');
  const got = (await rpc('prompts/get', { name: 'reply' })).body.result;
  check('prompts/get hands out the finished prompt', got.messages[0].content.text, pack.resolvePromptBrains(PROMPT_TEXT, lookup));
  check('a Brains-only link offers no prompts', (await rpc('prompts/list', {}, { key: KEYS.brains })).body.result.prompts, []);

  console.log('Wiring');
  const index = read('services', 'supabase', 'functions', 'mcp', 'index.ts');
  check('the server function holds no service-role key', /SERVICE_ROLE/.test(index), false);
  check('it calls one database function, mcp_call', (index.match(/\/rest\/v1\/[a-z_/]+/g) || []), ['/rest/v1/rpc/mcp_call']);
  check('it loads the shared Brain module and the conversation', (index.match(/^import .*$/gm) || []), ["import '../_shared/memory-pack.js';", "import { createMcpServer } from './server.js';"]);

  const sql = read('services', 'supabase', 'migrations', '20261121120000_ai_app_link.sql');
  const fn = sql.slice(sql.indexOf('create or replace function public.mcp_call('), sql.indexOf('comment on function public.mcp_call('));
  check('mcp_call runs as its caller, so the role can switch', /\nsecurity invoker\n/.test(fn), true);
  check('it returns only before the switch (wrong key) or after switching back', (fn.match(/\breturn\b[^;]*;/g) || []), ['return null;', 'return v_result;']);
  const restore = fn.indexOf('end work;');
  check('the role and the claims are put back after the work block',
    restore !== -1 && ["set_config('role', v_role, true)", "set_config('request.jwt.claims', coalesce(v_claims, ''), true)"].every((s) => fn.indexOf(s) > restore), true);
  const actions = [...new Set([...read('services', 'supabase', 'functions', 'mcp', 'server.js').matchAll(/(?:db|callDb)\(key, '([a-z_]+)'/g)].map((m) => m[1]))].sort();
  check('every action the server asks for exists in mcp_call', actions.filter((a) => !fn.includes("p_action = '" + a + "'")), []);
  check('the key format the server accepts is the one memory_issue_token makes', /v_token\s*:=\s*'sbmw_'/.test(sql) && /replace\(gen_random_uuid\(\)::text, '-', ''\)\s*\n\s*\|\| replace\(gen_random_uuid\(\)::text, '-', ''\)/.test(sql), true);

  const migrations = fs.readdirSync(path.join(ROOT, 'services', 'supabase', 'migrations')).map((f) => read('services', 'supabase', 'migrations', f)).join('\n');
  check('the limits match the Brain item columns',
    [`char_length(btrim(name)) <= ${LIMITS.name}`, `char_length(body) between 1 and ${LIMITS.text}`, `char_length(summary) <= ${LIMITS.summary}`].map((s) => migrations.includes(s)), [true, true, true]);

  const link = read('app', 'src', 'lib', 'aiAppLink.ts');
  check('the dashboard hands out the function address with the key in it', /\$\{SUPABASE_URL\}\/functions\/v1\/mcp\?key=\$\{/.test(link), true);
  check('a dashboard link reaches Prompts and Brains, and saves only when asked', /\['read', 'prompts'\]/.test(link) && /'write'/.test(link), true);

  if (failed) {
    console.error('\n' + failed + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nThe AI app link holds together.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
