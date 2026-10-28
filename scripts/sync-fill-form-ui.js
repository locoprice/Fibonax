// Keep the single-file mobile surface on the same DOM presentation helpers.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const file = path.join(root, 'app/public/mobile/index.html');
const start = '<!-- SB_FILL_FORM_UI:BEGIN -->', end = '<!-- SB_FILL_FORM_UI:END -->';
// Windows checkouts (core.autocrlf=true) can hold these files with CRLF while
// the committed blobs are LF. Read every file as LF, as sync-fill-form.js does,
// so a fresh checkout does not read as drift and every write stays LF.
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const js = read(path.join(root, 'extension/shared/fill-form-ui.js'));
const css = read(path.join(root, 'extension/shared/fill-form-ui.css'));
const block = start + '\n<style>\n' + css + '</style>\n<script>\n' + js + '</script>\n' + end;
let html = read(file);
const a = html.indexOf(start), b = html.indexOf(end);
const result = a < 0 ? html.replace('<!-- SB_FILL_FORM:END -->', '<!-- SB_FILL_FORM:END -->\n' + block) : html.slice(0, a) + block + html.slice(b + end.length);
if (process.argv.includes('--check')) {
  if (html !== result) { console.error('Fill form UI is out of sync'); process.exit(1); }
} else fs.writeFileSync(file, result);
