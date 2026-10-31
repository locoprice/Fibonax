#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../extension/manifest.json'), 'utf-8'));
const EXT_VERSION = `v${manifest.version}`;
const ROOT = path.resolve(__dirname, '../app/public/landing');
const PORT = 5174;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

function formatMonth(isoDate) {
  const [year, month] = isoDate.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

function getReleaseIso() {
  try {
    const repoRoot = path.resolve(__dirname, '..');
    const raw = execSync(
      'git log --pretty=format:"%s%x09%ad" --date=short --no-merges',
      { encoding: 'utf-8', cwd: repoRoot },
    ).trim();
    for (const line of raw.split('\n')) {
      const sep = line.lastIndexOf('\t');
      if (sep === -1) continue;
      const subject = line.slice(0, sep);
      const date = line.slice(sep + 1).trim();
      if (/[—\-–]\s*v\d+[\d.]*\s*$/.test(subject)) return date;
    }
  } catch {}
  return '';
}

const RELEASE_ISO   = getReleaseIso();
const RELEASE_DATE  = RELEASE_ISO ? formatDate(RELEASE_ISO) : '';
const RELEASE_MONTH = RELEASE_ISO ? formatMonth(RELEASE_ISO) : '';

const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.css':   'text/css',
  '.js':    'text/javascript',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.svg':   'image/svg+xml',
  '.webp':  'image/webp',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ico':   'image/x-icon',
};

function stamp(html) {
  return html
    .replace(/\{\{EXT_VERSION\}\}/g, EXT_VERSION)
    .replace(/\{\{RELEASE_DATE\}\}/g, RELEASE_DATE)
    .replace(/\{\{RELEASE_MONTH\}\}/g, RELEASE_MONTH);
}

const SOURCE = path.join(ROOT, 'index.html');

function isLocal(req) {
  const addr = req.socket.remoteAddress || '';
  const host = (req.headers.host || '').split(':')[0];
  return (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1') && host === 'localhost';
}

function reply(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const crypto = require('crypto');
const SKIP_TAGS = new Set(['script', 'style', 'template', 'noscript', 'svg']);

function revisionOf(raw) {
  return crypto.createHash('sha1').update(raw).digest('hex');
}

// Every element in <body>, keyed by where its tag starts in the source. Edit mode uses that offset as its id.
function indexElements(raw) {
  const parse5 = require(path.resolve(__dirname, '../app/node_modules/parse5'));
  const doc = parse5.parse(raw, { sourceCodeLocationInfo: true });
  const html = doc.childNodes.find((n) => n.tagName === 'html');
  const body = html && html.childNodes.find((n) => n.tagName === 'body');
  const byId = new Map();
  (function walk(node) {
    for (const child of node.childNodes || []) {
      if (!child.tagName || SKIP_TAGS.has(child.tagName)) continue;
      const loc = child.sourceCodeLocation;
      if (loc && raw.slice(loc.startOffset, loc.startOffset + 1 + child.tagName.length).toLowerCase() === '<' + child.tagName) {
        byId.set(loc.startOffset, child);
      }
      walk(child);
    }
  })(body || doc);
  return byId;
}

function markElements(raw) {
  let out = '';
  let from = 0;
  for (const [start, node] of [...indexElements(raw)].sort((a, b) => a[0] - b[0])) {
    const at = start + 1 + node.tagName.length;
    out += raw.slice(from, at) + ` data-ed="${start}"`;
    from = at;
  }
  return out + raw.slice(from);
}

function gapBefore(raw, start) {
  return /\s*$/.exec(raw.slice(Math.max(0, start - 200), start))[0];
}

function moveElement(raw, a, b, where) {
  const aLoc = a.sourceCodeLocation;
  const bLoc = b.sourceCodeLocation;
  const text = raw.slice(aLoc.startOffset, aLoc.endOffset);
  const gapB = gapBefore(raw, bLoc.startOffset);
  const at = where === 'before' ? bLoc.startOffset : bLoc.endOffset;
  const insert = where === 'before' ? text + gapB : gapB + text;
  const cutFrom = aLoc.startOffset - gapBefore(raw, aLoc.startOffset).length;
  const cutTo = aLoc.endOffset;
  if (at >= cutTo) return raw.slice(0, cutFrom) + raw.slice(cutTo, at) + insert + raw.slice(at);
  return raw.slice(0, at) + insert + raw.slice(at, cutFrom) + raw.slice(cutTo);
}

function deleteElement(raw, node) {
  const loc = node.sourceCodeLocation;
  return raw.slice(0, loc.startOffset - gapBefore(raw, loc.startOffset).length) + raw.slice(loc.endOffset);
}

function replaceText(raw, edit) {
  if (typeof edit.before !== 'string' || typeof edit.after !== 'string' || !edit.before.trim()) {
    return { error: 'bad request.' };
  }
  const found = raw.split(edit.before).length - 1;
  if (found === 0) return { error: 'this text is built by the page, so ask Claude to change it.' };
  if (found > 1) return { error: 'the same wording appears ' + found + ' times, so ask Claude to change it.' };
  return { html: raw.replace(edit.before, () => edit.after) };
}

function moveOrDelete(raw, edit) {
  if (edit.rev !== revisionOf(raw)) return { error: 'the page changed since it opened. Reload and try again.' };
  const byId = indexElements(raw);
  const node = byId.get(Number(edit.id));
  if (!node) return { error: 'this block is built by the page, so ask Claude to change it.' };
  if (edit.op === 'delete') return { html: deleteElement(raw, node) };
  const target = byId.get(Number(edit.targetId));
  if (!target || target === node || target.parentNode !== node.parentNode) {
    return { error: 'blocks can only move among their neighbours.' };
  }
  return { html: moveElement(raw, node, target, edit.where === 'after' ? 'after' : 'before') };
}

// The button that turns edit mode on and off. Local preview only.
function editToggle(editing) {
  const href = editing ? '/' : '/?edit';
  const label = editing ? 'Done editing' : 'Edit page';
  return `<a href="${href}" data-ed-ui style="position:fixed;bottom:16px;right:16px;z-index:2147483647;` +
    'display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;background:#1d1d1f;' +
    'color:#fff;font:600 13px/1 system-ui,sans-serif;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.25)">' +
    `<span aria-hidden="true">✎</span>${label}</a>`;
}

// Edit mode writes to the English source only. Italian and Spanish are not touched.
function saveEdit(req, res) {
  if (!isLocal(req)) return reply(res, 403, { ok: false, error: 'only this computer can save.' });
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let edit;
    try { edit = JSON.parse(body); } catch { return reply(res, 400, { ok: false, error: 'bad request.' }); }
    const raw = fs.readFileSync(SOURCE, 'utf-8');
    const result = edit.op === 'move' || edit.op === 'delete' ? moveOrDelete(raw, edit) : replaceText(raw, edit);
    if (result.error) return reply(res, 409, { ok: false, error: result.error });
    fs.writeFileSync(SOURCE, result.html);
    reply(res, 200, { ok: true });
  });
}

http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (urlPath === '/__editor.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    res.end(fs.readFileSync(path.join(__dirname, 'landing-editor.js')));
    return;
  }
  if (urlPath === '/__save' && req.method === 'POST') return saveEdit(req, res);

  let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  let content = fs.readFileSync(filePath);

  if (ext === '.html') {
    const raw = content.toString('utf-8');
    const editing = filePath === SOURCE && req.url.includes('?edit') && isLocal(req);
    content = stamp(editing ? markElements(raw) : raw);
    if (editing) {
      content = content.replace('</body>', `<script src="/__editor.js" data-rev="${revisionOf(raw)}"></script></body>`);
    }
    if (filePath === SOURCE && isLocal(req)) {
      content = content.replace('</body>', `${editToggle(editing)}</body>`);
    }
  }

  res.writeHead(200, { 'Content-Type': mime });
  res.end(content);
}).listen(PORT, () => {
  console.log(`Landing preview → http://localhost:${PORT}  (${EXT_VERSION}, ${RELEASE_DATE})`);
});
