// Keep the single-file mobile surface on the same DOM presentation helpers.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const file = path.join(root, 'app/public/mobile/index.html');
const start = '<!-- SB_FILL_FORM_UI:BEGIN -->', end = '<!-- SB_FILL_FORM_UI:END -->';
const js = fs.readFileSync(path.join(root, 'extension/shared/fill-form-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'extension/shared/fill-form-ui.css'), 'utf8');
const block = start + '\n<style>\n' + css + '</style>\n<script>\n' + js + '</script>\n' + end;
let html = fs.readFileSync(file, 'utf8');
const a = html.indexOf(start), b = html.indexOf(end);
const result = a < 0 ? html.replace('<!-- SB_FILL_FORM:END -->', '<!-- SB_FILL_FORM:END -->\n' + block) : html.slice(0, a) + block + html.slice(b + end.length);
if (process.argv.includes('--check')) {
  if (html !== result) { console.error('Fill form UI is out of sync'); process.exit(1); }
} else fs.writeFileSync(file, result);
