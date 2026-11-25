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
//   20261125130000_ai_app_sign_in.sql            "Sign in with Fibonax": an AI app
//                                                registers, the person approves on
//                                                /connect, the app trades a one-time
//                                                code for a 1 hour key and renews it
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
  // The sign-in functions, in mcp_oauth_*'s shapes.
  const CLIENT = '8a420c4d-9ad3-429a-8fb9-8adb7369f1b0';
  const BACK = 'https://ai.example/callback?x=1';
  const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  const rpcCalls = [];
  async function oauthRpc(name, params) {
    rpcCalls.push({ name, params });
    if (name === 'mcp_oauth_client') return params.p_client_id === CLIENT ? { name: 'Example AI', redirect_ok: params.p_redirect_uri === BACK } : null;
    if (name === 'mcp_oauth_register') {
      if (params.p_redirect_uris.some((u) => !u.startsWith('https://'))) return { error: 'invalid_redirect_uri' };
      return { client_id: CLIENT, client_name: params.p_name || 'AI app', redirect_uris: params.p_redirect_uris };
    }
    if (name === 'mcp_oauth_token') {
      if (params.p_grant_type === 'authorization_code' && params.p_code === 'sbmc_good') {
        return { access_token: KEYS.full, token_type: 'Bearer', expires_in: 3600, refresh_token: 'sbmr_' + '1'.repeat(64), scope: 'fibonax' };
      }
      return { error: params.p_grant_type === 'password' ? 'unsupported_grant_type' : 'invalid_grant' };
    }
    throw new Error('unexpected function ' + name);
  }
  const PUBLIC = 'https://mcp.example.test';
  const mcp = createMcpServer({
    callDb, pack, rpc: oauthRpc, publicUrl: PUBLIC, consentUrl: 'https://app.example.test/connect',
    openaiChallenge: 'challenge-123', log: (m) => logs.push(m),
  });

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

  console.log('Sign in with Fibonax');
  const get = (pathAndQuery) => mcp.handle(new Request(PUBLIC + pathAndQuery));
  const form = (pathname, fields) => mcp.handle(new Request(PUBLIC + pathname, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString(),
  }));
  const noKeyRes = await mcp.handle(new Request(PUBLIC + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' }));
  check('no key: 401 that says where to sign in', [noKeyRes.status, noKeyRes.headers.get('www-authenticate')],
    [401, 'Bearer resource_metadata="' + PUBLIC + '/.well-known/oauth-protected-resource"']);
  const resource = await (await get('/.well-known/oauth-protected-resource/mcp')).json();
  check('the resource document names this server and where to sign in', [resource.resource, resource.authorization_servers], [PUBLIC + '/mcp', [PUBLIC]]);
  const meta = await (await get('/.well-known/oauth-authorization-server')).json();
  check('the sign-in document lists the three addresses, PKCE S256 and public clients',
    [meta.issuer, meta.authorization_endpoint, meta.token_endpoint, meta.registration_endpoint, meta.code_challenge_methods_supported, meta.token_endpoint_auth_methods_supported],
    [PUBLIC, PUBLIC + '/authorize', PUBLIC + '/token', PUBLIC + '/register', ['S256'], ['none']]);
  check("OpenAI's domain check text is served as plain text", await (await get('/.well-known/openai-apps-challenge')).text(), 'challenge-123');

  const authQuery = (over) => '/authorize?' + new URLSearchParams({ response_type: 'code', client_id: CLIENT, redirect_uri: BACK, code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 's 1', ...over });
  const sent = await get(authQuery({}));
  const consent = new URL(sent.headers.get('location'));
  check('a good request sends the person to the dashboard, with what it needs',
    [sent.status, consent.origin + consent.pathname, Object.fromEntries(consent.searchParams)],
    [302, 'https://app.example.test/connect', { client_id: CLIENT, redirect_uri: BACK, code_challenge: CHALLENGE, state: 's 1' }]);
  const stranger = await get(authQuery({ redirect_uri: 'https://evil.example/cb' }));
  check('a return address the app did not register sends nobody anywhere', [stranger.status, stranger.headers.get('location')], [400, null]);
  check('an unknown app sends nobody anywhere', (await get(authQuery({ client_id: 'ffffffff-0000-4000-8000-000000000000' }))).status, 400);
  const noPkce = await get(authQuery({ code_challenge_method: 'plain' }));
  check('a request without PKCE S256 is refused here: the server never forwards anyone to an app by itself',
    [noPkce.status, noPkce.headers.get('location')], [400, null]);
  check('the only place this server sends a person is the dashboard',
    (read('services', 'supabase', 'functions', 'mcp', 'server.js').match(/redirectTo\([^)]*\)/g) || []).filter((c) => !c.includes('location')), ['redirectTo(withParams(deps.consentUrl, { client_id: clientId, redirect_uri: redirect, code_challenge: challenge, state })']);

  const traded = await form('/token', { grant_type: 'authorization_code', client_id: CLIENT, code: 'sbmc_good', code_verifier: 'v'.repeat(43), redirect_uri: BACK });
  check('a code is traded for a key, never cached', [traded.status, traded.headers.get('cache-control'), (await traded.json()).access_token], [200, 'no-store', KEYS.full]);
  check('the token step hands the database every field under its own name', rpcCalls.filter((c) => c.name === 'mcp_oauth_token').pop().params,
    { p_grant_type: 'authorization_code', p_client_id: CLIENT, p_code: 'sbmc_good', p_verifier: 'v'.repeat(43), p_redirect_uri: BACK, p_refresh: null });
  const badCode = await form('/token', { grant_type: 'authorization_code', client_id: CLIENT, code: 'sbmc_bad' });
  check('a wrong code is invalid_grant', [badCode.status, await badCode.json()], [400, { error: 'invalid_grant' }]);
  check('a client id that is not one is refused before the database', await (async () => { const before = rpcCalls.length; const r = await form('/token', { grant_type: 'refresh_token', client_id: 'x' }); return [r.status, rpcCalls.length - before]; })(), [401, 0]);

  const reg = (body) => mcp.handle(new Request(PUBLIC + '/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const registered = await reg({ client_name: 'Example AI', redirect_uris: [BACK] });
  const regBody = await registered.json();
  check('an AI app registers as a public client', [registered.status, regBody.client_id, regBody.token_endpoint_auth_method, regBody.redirect_uris], [201, CLIENT, 'none', [BACK]]);
  check('a return address that is not safe is refused', (await reg({ client_name: 'X', redirect_uris: ['http://evil.example/cb'] })).status, 400);
  check('redirect_uris must be a list of addresses', (await reg({ client_name: 'X', redirect_uris: 'https://a.example' })).status, 400);

  const bearer = (key, body) => mcp.handle(new Request(PUBLIC + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body) }));
  const ended = await bearer(KEYS.off, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'list_brains', arguments: {} } });
  check('a signed-in app whose key ended gets 401 invalid_token, so it renews or asks again',
    [ended.status, /^Bearer error="invalid_token", resource_metadata=/.test(ended.headers.get('www-authenticate') || '')], [401, true]);
  check('and learns it at the first hello', (await bearer(KEYS.off, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).status, 401);
  check('a signed-in app with a good key is served', (await bearer(KEYS.full, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).status, 200);
  check('a copied link whose key ended still answers in words', (await rpc('tools/call', { name: 'list_brains', arguments: {} }, { key: KEYS.off })).status, 200);

  console.log('Wiring');
  const index = read('services', 'supabase', 'functions', 'mcp', 'index.ts');
  check('the server function holds no service-role key', /SERVICE_ROLE/.test(index), false);
  check('it calls database functions through one address', (index.match(/\/rest\/v1\/[a-z_/${}]+/g) || []), ['/rest/v1/rpc/${name}']);
  check('and only these four, each deciding for itself who may do what',
    /const FUNCTIONS = new Set\(\[([^\]]+)\]\)/.exec(index)[1].replace(/['\s]/g, '').split(','),
    ['mcp_call', 'mcp_oauth_client', 'mcp_oauth_register', 'mcp_oauth_token']);
  check('every sign-in function the server asks for is on that list',
    [...new Set([...read('services', 'supabase', 'functions', 'mcp', 'server.js').matchAll(/oauthRpc\('([a-z_]+)'/g)].map((m) => m[1]))].sort(),
    ['mcp_oauth_client', 'mcp_oauth_register', 'mcp_oauth_token']);
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

  const signIn = read('services', 'supabase', 'migrations', '20261125130000_ai_app_sign_in.sql');
  check('only a signed-in person can approve an AI app',
    [/revoke all on function public\.mcp_oauth_approve\([^)]*\) from public, anon;/.test(signIn), /grant execute on function public\.mcp_oauth_approve\([^)]*\) to authenticated;/.test(signIn)], [true, true]);
  const tokenFn = signIn.slice(signIn.indexOf('create or replace function public.mcp_oauth_token('));
  check('a code is deleted before it is judged, so it works once, right or wrong',
    tokenFn.indexOf('delete from app.mcp_oauth_codes k') !== -1 && tokenFn.indexOf('delete from app.mcp_oauth_codes k') < tokenFn.indexOf("v_code.code_challenge then"), true);
  check('the PKCE proof is S256, compared with the stored challenge',
    tokenFn.includes("translate(rtrim(encode(sha256(p_verifier::bytea), 'base64'), '='), '+/', '-_') <> v_code.code_challenge"), true);
  check('both secrets change at every refresh', /set token_hash\s+= encode\(sha256\(v_access::bytea\), 'hex'\),[\s\S]*?refresh_hash = encode\(sha256\(v_refresh::bytea\), 'hex'\)/.test(tokenFn), true);
  check('a switched-off connection cannot be renewed', tokenFn.includes('or v_row.revoked_at is not null'), true);
  const readable = /grant select \(([^)]+)\)\s+on public\.memory_tokens to authenticated;/.exec(signIn)[1];
  check('no hash is readable from a browser', [/hash/.test(readable), /revoke select on public\.memory_tokens from authenticated;/.test(signIn)], [false, true]);
  check('the sign-in tables are closed to everyone but the functions',
    ['mcp_oauth_clients', 'mcp_oauth_codes'].map((t) => signIn.includes('revoke all on app.' + t) && signIn.includes('alter table app.' + t)), [true, true]);
  check('the keys it hands out are the kind the server accepts', /app\.mcp_secret\('sbmw_'\)/.test(signIn) && /p_prefix\s*\|\| replace\(gen_random_uuid\(\)::text, '-', ''\)\s*\|\| replace\(gen_random_uuid\(\)::text, '-', ''\)/.test(signIn), true);

  const app = read('app', 'src', 'App.tsx');
  check('the approval page is served on computers and on phones', (app.match(/path="\/connect"/g) || []).length, 2);
  check('signing in on a phone comes back to the approval page, not to the phone app',
    [read('app', 'src', 'routes', 'LoginPage.tsx'), read('app', 'src', 'routes', 'AuthCallback.tsx')].map((t) => t.includes("!next.startsWith('/connect')")), [true, true]);
  const toml = read('netlify.toml');
  check('the approval page cannot be shown inside another site',
    [/for = "\/connect"\s*\n\s*\[headers\.values\]\s*\n\s*X-Frame-Options = "DENY"\s*\n\s*Content-Security-Policy = "frame-ancestors 'none'"/.test(toml),
     read('app', 'src', 'routes', 'ConnectAppPage.tsx').includes('window.top !== window.self')], [true, true]);
  check('mcp.fibonax.com forwards to the server function, ahead of every other rule',
    [/from\s*=\s*"https:\/\/mcp\.fibonax\.com\/\*"\s*\n\s*to\s*=\s*"https:\/\/eyowustlbqujaimaxggt\.supabase\.co\/functions\/v1\/mcp\/:splat"\s*\n\s*status\s*=\s*200\s*\n\s*force\s*=\s*true/.test(toml),
     toml.indexOf('mcp.fibonax.com') < toml.indexOf('from   = "/*"')], [true, true]);

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
