// The AI app link: what an AI app (Claude, ChatGPT and others) talks to over
// MCP, the Model Context Protocol, once a person pastes the link from
// Settings > Integrations > AI apps.
//
// Everything about the conversation is decided here, in plain JavaScript with
// no runtime of its own, so the same code runs in the server function
// (./index.ts, Deno) and in the CI gate (scripts/check-mcp-link.js, Node). The
// gate talks to it as an AI app would, with the database replaced by a fake.
//
// What it does not decide:
// - who may read what: public.mcp_call reads as the link's owner under the
//   tables' own row level security (20261121120000_ai_app_link.sql). This file
//   only ever passes the key it was given.
// - how a Brain is handed to an AI, or a prompt's Brain filled in: that is
//   extension/shared/memory-pack.js, the rule every other surface uses,
//   passed in as `pack`.
//
// Transport: Streamable HTTP, stateless. Every POST carries one JSON-RPC
// message (or a batch, for older clients) and gets one JSON answer; there is no
// session and no event stream, so GET answers 405 as the protocol allows.
//
// The key reaches this server in one of two ways, and is never logged:
// - `?key=<key>` in the link itself: the link a person copies from Settings.
// - `Authorization: Bearer <key>`: what an AI app sends after the person
//   connected it with "Sign in with Fibonax" (OAuth 2.1, below), or when the
//   app lets a person set a header by hand.
//
// "Sign in with Fibonax" is what the directories of Claude and ChatGPT ask
// for. This file serves its public addresses; the database decides everything
// (20261125130000_ai_app_sign_in.sql) and the person approves on the
// dashboard's /connect page:
//   /.well-known/oauth-protected-resource     where to sign in for this server
//   /.well-known/oauth-authorization-server   the addresses below, and PKCE S256
//   /register    an AI app registers its name and return addresses
//   /authorize   checks the app, then sends the person to the dashboard
//   /token       a one-time code, or a refresh secret, for a 1 hour key
// What the app receives is one of our own keys, so it can do exactly what a
// link can do and is listed and switched off in the same Settings card.

export const SERVER_VERSION = '3.166.0';

/** Protocol versions this server speaks, newest first. */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = '2025-06-18';

const KEY_RE = /^sbmw_[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DASHBOARD = 'https://app.fibonax.com';
const PRICING = 'https://fibonax.com/pricing/';

// The limits of a Brain item, as the database holds them (memory_shards).
export const LIMITS = { name: 64, text: 20000, summary: 280, query: 500 };

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id',
  'Access-Control-Expose-Headers': 'mcp-session-id, www-authenticate',
};

/** Every sentence an AI app can pass on to the person, in one place. */
export const TEXT = {
  noKey: 'This Fibonax link is missing its key. Copy the whole link again from Fibonax: Settings, Integrations, AI apps.',
  notValid: 'This Fibonax link was switched off or is not valid. Make a new one in Fibonax: Settings, Integrations, AI apps.',
  noPrompts: 'This link reaches Brains only. To use prompts as well, make a new link in Fibonax: Settings, Integrations, AI apps.',
  noSave: 'This link can read but not save. To let the AI app save to Brains, make a new link with saving turned on.',
  notFound: 'Nothing with that id is in this Fibonax account. Search or list again to get a current id.',
  rateLimited: 'Too many requests in a minute. Wait a moment, then try again.',
  unreachable: 'Fibonax could not be reached just now. Try again in a moment.',
  limitPrompt: "Today's free prompt uses are used up and there are no FiboTokens left. Add FiboTokens at " + PRICING + ' or try again tomorrow.',
  limitBrain: "Today's free Brain uses are used up and there are no FiboTokens left. Add FiboTokens at " + PRICING + ' or try again tomorrow.',
  signIn: 'Connect Fibonax again: the connection has ended or was switched off.',
  badRequest: 'This connection request is not valid. Go back to your AI app and connect Fibonax again.',
  nothingFound: 'Nothing matched. Try other words, or browse with list_prompts and list_brains.',
  deprecated: 'Marked deprecated in Fibonax: check it is still right before relying on it.',
};

const INSTRUCTIONS =
  "Fibonax holds this person's prompts and Brains. A prompt is a ready-made instruction they wrote; a Brain is a set of " +
  'items with knowledge they saved. Use search, or list_prompts and list_brains, to find something, then fetch to get its ' +
  'full text. Follow a prompt as written, and base answers on Brain items rather than guessing. Each fetch of a prompt or a ' +
  "Brain counts as one use of the person's Fibonax plan, so fetch what the task needs.";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** The tools, as tools/list describes them. save_to_brain only for a link that may save. */
export function toolDefinitions(canSave) {
  const tools = [
    {
      name: 'search',
      title: 'Search Fibonax',
      description: "Find prompts and Brain items in the person's Fibonax library by words. Returns ids to pass to fetch.",
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to look for, in any language.' },
          limit: { type: 'integer', minimum: 1, maximum: 25, description: 'How many results, 10 if left out.' },
        },
        required: ['query'],
      },
      annotations: READ_ONLY,
    },
    {
      name: 'fetch',
      title: 'Get full text',
      description:
        'Get the full text of a prompt, a Brain item or a whole Brain, by an id from search, list_prompts or list_brains. ' +
        'A prompt comes ready to use, with any Brain it carries filled in.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'An id such as prompt:…, item:… or brain:…' } },
        required: ['id'],
      },
      annotations: READ_ONLY,
    },
    {
      name: 'list_prompts',
      title: 'List prompts',
      description: "List the person's prompts with their folder and first line, including prompts their team shares with them.",
      inputSchema: { type: 'object', properties: {} },
      annotations: READ_ONLY,
    },
    {
      name: 'list_brains',
      title: 'List Brains',
      description: "List the person's Brains, or, with brain_id, the items inside one Brain.",
      inputSchema: {
        type: 'object',
        properties: { brain_id: { type: 'string', description: 'A brain:… id from list_brains, to list its items.' } },
      },
      annotations: READ_ONLY,
    },
  ];
  if (canSave) {
    tools.push({
      name: 'save_to_brain',
      title: 'Save to a Brain',
      description:
        "Save a new item into one of the person's Brains: a fact, a decision or notes worth keeping. It only adds; it never " +
        'changes or deletes anything. The item is marked AI generated so the person can check it in Fibonax.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: LIMITS.name, description: 'A short title.' },
          text: { type: 'string', maxLength: LIMITS.text, description: 'What to keep.' },
          summary: { type: 'string', maxLength: LIMITS.summary, description: 'One line saying what it is, optional.' },
          brain_id: { type: 'string', description: 'A brain:… id from list_brains. Left out, it goes to the default Brain.' },
        },
        required: ['name', 'text'],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    });
  }
  return tools;
}

/** A tool failure the AI app relays to the person, as opposed to a protocol error. */
class ToolProblem extends Error {}

/**
 * The key and how it came: { key, signedIn }. `signedIn` is true for the
 * Authorization header, where a key that stopped working must answer 401 so
 * the AI app refreshes it or asks the person to connect again. Null when
 * neither the header nor ?key= in the link holds a key.
 */
export function keySource(request) {
  const header = request.headers.get('authorization') || '';
  const bearer = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (bearer && KEY_RE.test(bearer[1])) return { key: bearer[1], signedIn: true };
  const fromLink = new URL(request.url).searchParams.get('key');
  return fromLink && KEY_RE.test(fromLink.trim()) ? { key: fromLink.trim(), signedIn: false } : null;
}

/** The key alone, wherever it came from; null when there is none. */
export function keyFrom(request) {
  const source = keySource(request);
  return source ? source.key : null;
}

/** `redirect` with `params` added to its query, keeping what it already has. */
export function withParams(redirect, params) {
  const url = new URL(redirect);
  for (const [name, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(name, value);
  }
  return url.toString();
}

/** `prompt:<uuid>` → { kind: 'prompt', id }, a bare uuid → { kind: null, id }; null when it is neither. */
export function parseId(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  const m = /^(?:(prompt|item|brain):)?([0-9a-f-]{36})$/.exec(text);
  if (!m || !UUID_RE.test(m[2])) return null;
  return { kind: m[1] || null, id: m[2] };
}

function brainUrl(brainId, itemId) {
  return DASHBOARD + '/memory/' + brainId + (itemId ? '?item=' + itemId : '');
}

function statusNote(status) {
  return status === 'deprecated' ? TEXT.deprecated : undefined;
}

function textResult(text, isError) {
  return isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };
}

function jsonResult(value) {
  return textResult(JSON.stringify(value, null, 2));
}

/**
 * The server for one deployment.
 *
 * deps.callDb(key, action, args) → the jsonb mcp_call answers (null for a key
 *   that is not valid), or throws { rateLimited: true } / any other error.
 * deps.pack → extension/shared/memory-pack.js.
 * deps.log(message) → where operational errors go. Never given a key.
 * deps.rpc(name, params) → one of the mcp_oauth_* database functions.
 * deps.publicUrl → this server's public address, without a trailing slash.
 * deps.consentUrl → the dashboard page where a person approves an AI app.
 * deps.openaiChallenge → OpenAI's domain check text, when there is one.
 */
export function createMcpServer(deps) {
  const { callDb, pack } = deps;
  const log = deps.log || (() => {});
  const publicUrl = String(deps.publicUrl || '').replace(/\/+$/, '');
  // Keys the database refused during the request in hand. Two requests with
  // one key agree on whether it works, so sharing the mark between them is safe.
  const refused = new Set();

  // One database call, with its refusals turned into the sentence the person reads.
  async function db(key, action, args) {
    let data;
    try {
      data = await callDb(key, action, args || {});
    } catch (error) {
      if (error && error.rateLimited) throw new ToolProblem(TEXT.rateLimited);
      log('mcp_call ' + action + ' failed: ' + (error && error.message ? error.message : String(error)));
      throw new ToolProblem(TEXT.unreachable);
    }
    if (data == null) {
      refused.add(key);
      throw new ToolProblem(TEXT.notValid);
    }
    if (data.error === 'no_prompts') throw new ToolProblem(TEXT.noPrompts);
    if (data.error === 'no_save') throw new ToolProblem(TEXT.noSave);
    if (data.error === 'not_found') throw new ToolProblem(TEXT.notFound);
    if (data.error === 'limit') throw new ToolProblem(data.kind === 'prompt' ? TEXT.limitPrompt : TEXT.limitBrain);
    if (data.error) throw new ToolProblem('That request is missing something or is not in the expected form.');
    return data;
  }

  // What this key may do; a key that is not valid, or a database that cannot
  // be reached, may do nothing beyond reading (and reading then says why not).
  async function abilities(key) {
    try {
      const who = await callDb(key, 'whoami', {});
      if (who == null) refused.add(key);
      return { prompts: !!(who && who.prompts), save: !!(who && who.save) };
    } catch (error) {
      log('whoami failed: ' + (error && error.message ? error.message : String(error)));
      return { prompts: false, save: false };
    }
  }

  // A prompt's text, its Brains filled in the way every other surface fills them.
  async function promptText(key, prompt) {
    const refs = pack.promptBrainRefs(prompt.text).slice(0, 10);
    if (!refs.length) return { text: prompt.text, note: undefined };
    const lookup = {};
    let fallback = 'missing';
    try {
      const got = await db(key, 'brains_text', { ids: refs.map((ref) => ref.id) });
      for (const brain of got.brains) lookup[String(brain.id).toLowerCase()] = { name: brain.name, items: brain.items };
    } catch (error) {
      if (!(error instanceof ToolProblem)) throw error;
      // The prompt still goes out, with one visible line where each Brain was.
      fallback = 'failed';
      if (error.message === TEXT.limitBrain) {
        return {
          text: pack.resolvePromptBrains(prompt.text, lookup, fallback),
          note: pack.brainGapNote(pack.promptBrainGaps(prompt.text, lookup, fallback)) + ' ' + TEXT.limitBrain,
        };
      }
    }
    const note = pack.brainGapNote(pack.promptBrainGaps(prompt.text, lookup, fallback));
    return { text: pack.resolvePromptBrains(prompt.text, lookup, fallback), note: note || undefined };
  }

  async function fetchPrompt(key, id) {
    const { prompt } = await db(key, 'prompt', { id });
    const filled = await promptText(key, prompt);
    return {
      id: 'prompt:' + prompt.id,
      title: prompt.name,
      text: filled.text,
      url: DASHBOARD + '/prompts',
      metadata: { kind: 'prompt', folder: prompt.folder || null, status: prompt.status, note: filled.note || statusNote(prompt.status) },
    };
  }

  async function fetchItem(key, id) {
    const { item } = await db(key, 'item', { id });
    return {
      id: 'item:' + item.id,
      title: item.name,
      text: item.text,
      url: brainUrl(item.brain_id, item.id),
      metadata: { kind: 'brain_item', brain: item.brain, brain_id: 'brain:' + item.brain_id, summary: item.summary || null, status: item.status, note: statusNote(item.status) },
    };
  }

  async function fetchBrain(key, id) {
    const { brains } = await db(key, 'brains_text', { ids: [id] });
    const brain = brains[0];
    if (!brain) throw new ToolProblem(TEXT.notFound);
    return {
      id: 'brain:' + brain.id,
      title: brain.name,
      text: brain.items.length ? pack.formatBrainBlock(brain.items) : 'This Brain has no items yet.',
      url: brainUrl(brain.id),
      metadata: { kind: 'brain', items: brain.items.length },
    };
  }

  async function runFetch(key, args) {
    const ref = parseId(args.id);
    if (!ref) throw new ToolProblem('Give an id from search, list_prompts or list_brains, such as prompt:…, item:… or brain:….');
    if (ref.kind === 'prompt') return fetchPrompt(key, ref.id);
    if (ref.kind === 'item') return fetchItem(key, ref.id);
    if (ref.kind === 'brain') return fetchBrain(key, ref.id);
    // A bare id: whichever of the three it is.
    const can = await abilities(key);
    const tries = can.prompts ? [fetchPrompt, fetchItem, fetchBrain] : [fetchItem, fetchBrain];
    for (const attempt of tries) {
      try {
        return await attempt(key, ref.id);
      } catch (error) {
        if (!(error instanceof ToolProblem) || error.message !== TEXT.notFound) throw error;
      }
    }
    throw new ToolProblem(TEXT.notFound);
  }

  async function runSearch(key, args) {
    const query = String(args.query == null ? '' : args.query).trim().slice(0, LIMITS.query);
    if (!query) throw new ToolProblem('Say what to look for.');
    const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 25) : 10;
    const { results } = await db(key, 'search', { query, limit: String(limit) });
    const out = results.map((row) => {
      const prompt = row.kind === 'prompt';
      return {
        id: (prompt ? 'prompt:' : 'item:') + row.id,
        title: row.title,
        url: prompt ? DASHBOARD + '/prompts' : brainUrl(row.brain_id, row.id),
        kind: prompt ? 'prompt' : 'brain_item',
        where: row.container_name || null,
        summary: row.summary ? (prompt ? pack.labelBrainTokens(row.summary) : row.summary) : null,
        status: row.status,
      };
    });
    return out.length ? { results: out } : { results: [], note: TEXT.nothingFound };
  }

  async function runListPrompts(key) {
    const { prompts, total } = await db(key, 'prompts', {});
    if (!prompts.length) return 'There are no prompts in this Fibonax account yet.';
    const lines = prompts.map((p) => {
      const parts = ['- ' + p.name];
      if (p.folder) parts.push('(folder: ' + p.folder + ')');
      if (p.status === 'deprecated') parts.push('[deprecated]');
      const first = p.first_line ? ': ' + pack.labelBrainTokens(p.first_line) : '';
      return parts.join(' ') + first + '\n  id: prompt:' + p.id;
    });
    const head = total > prompts.length
      ? 'The first ' + prompts.length + ' of ' + total + ' prompts. Use search to find the others.'
      : prompts.length + (prompts.length === 1 ? ' prompt.' : ' prompts.');
    return head + ' Pass an id to fetch for the full text.\n\n' + lines.join('\n');
  }

  async function runListBrains(key, args) {
    if (args.brain_id != null && String(args.brain_id).trim() !== '') {
      const ref = parseId(args.brain_id);
      if (!ref || (ref.kind && ref.kind !== 'brain')) throw new ToolProblem('Give a brain:… id from list_brains.');
      const { brain, items } = await db(key, 'brain_items', { brain: ref.id });
      if (!items.length) return 'The Brain "' + brain.name + '" has no items yet.';
      const lines = items.map((it) =>
        '- ' + it.name + (it.status === 'deprecated' ? ' [deprecated]' : '') + (it.summary ? ': ' + it.summary : '') + '\n  id: item:' + it.id);
      return 'The Brain "' + brain.name + '" has ' + items.length + (items.length === 1 ? ' item' : ' items') +
        '. Fetch an item id for its text, or brain:' + brain.id + ' for the whole Brain.\n\n' + lines.join('\n');
    }
    const { brains } = await db(key, 'brains', {});
    if (!brains.length) return 'There are no Brains in this Fibonax account yet.';
    const lines = brains.map((b) =>
      '- ' + b.name + (b.default ? ' (default)' : '') + ': ' + b.items + (b.items === 1 ? ' item' : ' items') +
      (b.description ? '. ' + b.description : '') + '\n  id: brain:' + b.id);
    return brains.length + (brains.length === 1 ? ' Brain.' : ' Brains.') +
      ' Pass a brain id to list_brains for its items, or to fetch for the whole Brain.\n\n' + lines.join('\n');
  }

  async function runSave(key, args) {
    const name = String(args.name == null ? '' : args.name).trim();
    const text = String(args.text == null ? '' : args.text);
    const summary = args.summary == null ? '' : String(args.summary).trim();
    if (!name) throw new ToolProblem('Give the item a short name.');
    if (name.length > LIMITS.name) throw new ToolProblem('The name is longer than ' + LIMITS.name + ' characters. Make it shorter.');
    if (!text.trim()) throw new ToolProblem('Give the text to save.');
    if (text.length > LIMITS.text) throw new ToolProblem('The text is longer than ' + LIMITS.text + ' characters. Save it as several items.');
    if (summary.length > LIMITS.summary) throw new ToolProblem('The summary is longer than ' + LIMITS.summary + ' characters. Make it shorter.');
    const payload = { name, text };
    if (summary) payload.summary = summary;
    if (args.brain_id != null && String(args.brain_id).trim() !== '') {
      const ref = parseId(args.brain_id);
      if (!ref || (ref.kind && ref.kind !== 'brain')) throw new ToolProblem('Give a brain:… id from list_brains, or leave brain_id out.');
      payload.brain = ref.id;
    }
    const { saved } = await db(key, 'save', payload);
    return 'Saved "' + saved.name + '" in the Brain "' + saved.brain + '". It is marked AI generated, so the person can check it in Fibonax.\n' +
      'id: item:' + saved.id;
  }

  async function callTool(key, name, args) {
    const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    try {
      if (name === 'search') return jsonResult(await runSearch(key, input));
      if (name === 'fetch') return jsonResult(await runFetch(key, input));
      if (name === 'list_prompts') return textResult(await runListPrompts(key));
      if (name === 'list_brains') return textResult(await runListBrains(key, input));
      if (name === 'save_to_brain') return textResult(await runSave(key, input));
    } catch (error) {
      if (error instanceof ToolProblem) return textResult(error.message, true);
      log('tool ' + name + ' failed: ' + (error && error.message ? error.message : String(error)));
      return textResult(TEXT.unreachable, true);
    }
    return null;
  }

  // The person's prompts, offered to AI apps that show prompts as commands.
  // Names are made from the prompt's name and kept unique in list order, so
  // prompts/get finds the same prompt from the same list.
  function promptNames(prompts) {
    const used = new Set();
    return prompts.map((p) => {
      const base = String(p.name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'prompt';
      let name = base;
      for (let n = 2; used.has(name); n += 1) name = base + '-' + n;
      used.add(name);
      return { name, prompt: p };
    });
  }

  async function listMcpPrompts(key) {
    const can = await abilities(key);
    if (!can.prompts) return [];
    const { prompts } = await db(key, 'prompts', {});
    return promptNames(prompts);
  }

  // One JSON-RPC request → its answer object (result or error), or null for a notification.
  async function answer(key, message, signedIn) {
    const isRequest = message && typeof message === 'object' && 'id' in message && message.id !== null;
    if (!message || typeof message !== 'object' || typeof message.method !== 'string') {
      return isRequest ? rpcError(message.id, -32600, 'Invalid request') : null;
    }
    if (!isRequest) return null;
    const { id, method } = message;
    const params = message.params && typeof message.params === 'object' ? message.params : {};

    if (method === 'initialize') {
      // A signed-in app learns at once that its key ended, and refreshes it.
      if (signedIn) await abilities(key);
      const asked = params.protocolVersion;
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: 'fibonax', title: 'Fibonax', version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    if (method === 'ping') return rpcResult(id, {});
    if (method === 'tools/list') {
      const can = await abilities(key);
      return rpcResult(id, { tools: toolDefinitions(can.save) });
    }
    if (method === 'tools/call') {
      const result = await callTool(key, params.name, params.arguments);
      return result ? rpcResult(id, result) : rpcError(id, -32602, 'Unknown tool: ' + String(params.name));
    }
    if (method === 'prompts/list') {
      try {
        const named = await listMcpPrompts(key);
        return rpcResult(id, {
          prompts: named.map(({ name, prompt }) => ({
            name,
            title: prompt.name,
            description: [prompt.folder ? 'Folder: ' + prompt.folder : '', prompt.first_line ? pack.labelBrainTokens(prompt.first_line) : '']
              .filter(Boolean).join('. ') || 'A Fibonax prompt.',
          })),
        });
      } catch (error) {
        if (error instanceof ToolProblem) return rpcError(id, -32603, error.message);
        throw error;
      }
    }
    if (method === 'prompts/get') {
      try {
        const named = await listMcpPrompts(key);
        const hit = named.find((entry) => entry.name === params.name);
        if (!hit) return rpcError(id, -32602, 'Unknown prompt: ' + String(params.name));
        const got = await fetchPrompt(key, hit.prompt.id);
        return rpcResult(id, {
          description: got.title,
          messages: [{ role: 'user', content: { type: 'text', text: got.text } }],
        });
      } catch (error) {
        if (error instanceof ToolProblem) return rpcError(id, -32603, error.message);
        throw error;
      }
    }
    return rpcError(id, -32601, 'Method not found: ' + method);
  }

  // ── Sign in with Fibonax ────────────────────────────────────────────────

  const authServer = () => ({
    issuer: publicUrl,
    authorization_endpoint: publicUrl + '/authorize',
    token_endpoint: publicUrl + '/token',
    registration_endpoint: publicUrl + '/register',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['fibonax'],
    service_documentation: 'https://docs.fibonax.com/integrations/ai-apps',
  });

  function unauthorized(id, message, invalidToken) {
    const challenge = 'Bearer ' + (invalidToken ? 'error="invalid_token", ' : '') +
      'resource_metadata="' + publicUrl + '/.well-known/oauth-protected-resource"';
    return json(401, rpcError(id, -32001, message), { 'WWW-Authenticate': challenge });
  }

  async function oauthRpc(name, params) {
    try {
      return { data: await deps.rpc(name, params) };
    } catch (error) {
      log(name + ' failed: ' + (error && error.message ? error.message : String(error)));
      return { failed: true };
    }
  }

  // /authorize: the app and its return address are checked before anyone is
  // sent anywhere, and a faulty request is answered here, in words. Nobody is
  // ever sent to an app's address by this server: any app can register any
  // address, so only the person's own Allow or Cancel, on the dashboard, does
  // that. Otherwise this address would forward strangers wherever a link said.
  async function authorize(url) {
    const q = url.searchParams;
    const clientId = q.get('client_id') || '';
    const redirect = q.get('redirect_uri') || '';
    if (!UUID_RE.test(clientId) || !redirect) return page(400, TEXT.badRequest);
    const known = await oauthRpc('mcp_oauth_client', { p_client_id: clientId, p_redirect_uri: redirect });
    if (known.failed) return page(503, TEXT.unreachable);
    if (!known.data || !known.data.redirect_ok) return page(400, TEXT.badRequest);

    const state = q.get('state') || '';
    const challenge = q.get('code_challenge') || '';
    if (q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
      return page(400, TEXT.badRequest);
    }
    return redirectTo(withParams(deps.consentUrl, { client_id: clientId, redirect_uri: redirect, code_challenge: challenge, state }));
  }

  async function readFields(request) {
    const text = await request.text();
    if ((request.headers.get('content-type') || '').includes('application/json')) {
      try {
        const body = JSON.parse(text);
        return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
      } catch {
        return {};
      }
    }
    return Object.fromEntries(new URLSearchParams(text));
  }

  async function token(request) {
    const f = await readFields(request);
    const clientId = typeof f.client_id === 'string' ? f.client_id : '';
    if (!UUID_RE.test(clientId)) return json(401, { error: 'invalid_client' }, NO_STORE);
    const text = (value) => (typeof value === 'string' && value !== '' ? value : null);
    const out = await oauthRpc('mcp_oauth_token', {
      p_grant_type: text(f.grant_type) || '',
      p_client_id: clientId,
      p_code: text(f.code),
      p_verifier: text(f.code_verifier),
      p_redirect_uri: text(f.redirect_uri),
      p_refresh: text(f.refresh_token),
    });
    if (out.failed || !out.data) return json(503, { error: 'temporarily_unavailable' }, NO_STORE);
    if (out.data.error) return json(out.data.error === 'invalid_client' ? 401 : 400, out.data, NO_STORE);
    return json(200, out.data, NO_STORE);
  }

  async function register(request) {
    const f = await readFields(request);
    const uris = Array.isArray(f.redirect_uris) ? f.redirect_uris.filter((u) => typeof u === 'string') : [];
    if (!uris.length || uris.length !== (f.redirect_uris || []).length) {
      return json(400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be a list of addresses' });
    }
    const out = await oauthRpc('mcp_oauth_register', {
      p_name: typeof f.client_name === 'string' ? f.client_name : '',
      p_redirect_uris: uris,
    });
    if (out.failed || !out.data) return json(503, { error: 'temporarily_unavailable' });
    if (out.data.error === 'slow_down') return json(429, { error: 'temporarily_unavailable', error_description: 'Too many registrations. Try again later.' });
    if (out.data.error) {
      return json(400, { error: 'invalid_redirect_uri', error_description: 'Each redirect URI must be https, http on localhost, or an app scheme, with no fragment.' });
    }
    return json(201, {
      client_id: out.data.client_id,
      client_name: out.data.client_name,
      redirect_uris: out.data.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(Date.now() / 1000),
    });
  }

  // The sign-in addresses, or null when the request is for MCP itself.
  async function signInRoute(request, url) {
    const path = url.pathname.replace(/\/+$/, '');
    const wellKnown = path.indexOf('/.well-known/');
    if (wellKnown !== -1) {
      if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...CORS_HEADERS, Allow: 'GET, OPTIONS' } });
      const [doc, ...rest] = path.slice(wellKnown + '/.well-known/'.length).split('/');
      if (doc === 'oauth-protected-resource') {
        return json(200, {
          resource: publicUrl + (rest.length ? '/' + rest.join('/') : ''),
          authorization_servers: [publicUrl],
          bearer_methods_supported: ['header'],
          scopes_supported: ['fibonax'],
          resource_name: 'Fibonax',
          resource_documentation: 'https://docs.fibonax.com/integrations/ai-apps',
        });
      }
      if (doc === 'oauth-authorization-server' || doc === 'openid-configuration') return json(200, authServer());
      if (doc === 'openai-apps-challenge' && deps.openaiChallenge) {
        return new Response(deps.openaiChallenge, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
      return new Response(null, { status: 404, headers: CORS_HEADERS });
    }
    if (path.endsWith('/authorize')) {
      return request.method === 'GET' ? authorize(url) : new Response(null, { status: 405, headers: { Allow: 'GET' } });
    }
    if (path.endsWith('/token') || path.endsWith('/register')) {
      if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...CORS_HEADERS, Allow: 'POST, OPTIONS' } });
      return path.endsWith('/token') ? token(request) : register(request);
    }
    return null;
  }

  /** The whole HTTP exchange. `request` is a standard Fetch API Request. */
  async function handle(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    const signIn = await signInRoute(request, new URL(request.url));
    if (signIn) return signIn;
    if (request.method !== 'POST') {
      return new Response(null, { status: 405, headers: { ...CORS_HEADERS, Allow: 'POST, OPTIONS' } });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, rpcError(null, -32700, 'Parse error'));
    }

    const source = keySource(request);
    if (!source) return unauthorized(firstId(body), TEXT.noKey, false);
    const { key, signedIn } = source;

    const messages = Array.isArray(body) ? body : [body];
    if (!messages.length) return json(400, rpcError(null, -32600, 'Invalid request'));
    refused.delete(key);
    const answers = [];
    for (const message of messages) {
      try {
        const reply = await answer(key, message, signedIn);
        if (reply) answers.push(reply);
      } catch (error) {
        log('request failed: ' + (error && error.message ? error.message : String(error)));
        if (message && message.id != null) answers.push(rpcError(message.id, -32603, TEXT.unreachable));
      }
    }
    // A link keeps answering in words (the person reads them in the AI app); a
    // signed-in app is told in HTTP, which is what makes it refresh its key.
    const ended = refused.delete(key);
    if (ended && signedIn) return unauthorized(firstId(body), TEXT.signIn, true);
    if (!answers.length) return new Response(null, { status: 202, headers: CORS_HEADERS });
    return json(200, Array.isArray(body) ? answers : answers[0]);
  }

  return { handle };
}

function firstId(body) {
  const first = Array.isArray(body) ? body[0] : body;
  return first && typeof first === 'object' && first.id != null ? first.id : null;
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id == null ? null : id, error: { code, message } };
}

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

function json(status, value, headers) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...(headers || {}) },
  });
}

function redirectTo(location) {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

// A plain page for the one case with nobody to send back to. The text is ours,
// never the request's.
function page(status, sentence) {
  const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Fibonax</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:18vh auto;padding:0 1.5rem;color:#1C1C1E">' +
    '<h1 style="font-size:1.25rem">Fibonax</h1><p>' + sentence + '</p></body>';
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
