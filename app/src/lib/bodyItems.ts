/**
 * The elements a snippet body holds, for the editor's lists: every field,
 * button, automatic date, greeting and picture, where it sits, and the
 * settings its window loads to change it.
 *
 * Every element the editor inserts is listed with Edit and Remove (root
 * CLAUDE.md, Edit and Remove for every element). A window opens on what it
 * reads here, and Save writes the token back through the same builder that
 * wrote it, so an edit and an insert produce the same text.
 *
 * **Edit is offered only when nothing would be lost.** A token is read into
 * its window's settings and written again; if the two do not hold the same
 * settings, a setting the window does not know (written by hand, or by an
 * older builder) would vanish on Save. Such a token keeps Remove and is
 * changed in the body itself.
 *
 * Formulas, saved values and Show or hide rules have their own readers
 * (`@/lib/formulaToken`, `@/lib/conditionRule`).
 */

import { type ButtonTrim, type FormButtonConfig } from '@/lib/formButtonToken';
import {
  buildFormDateToken,
  DATE_FORMAT_OPTIONS,
  isValidFieldName,
  TIME_FORMAT_OPTIONS,
  type FormDateConfig,
} from '@/lib/formDateToken';
import { parseFormMenuToken, type FormMenuConfig } from '@/lib/formMenuToken';
import {
  buildFormNumberToken,
  CURRENCY_CODES,
  NUMBER_FORMATS,
  type CurrencyCode,
  type FormNumberConfig,
  type NumberFormat,
} from '@/lib/formNumberToken';
import { buildFormTextToken, type FormTextConfig } from '@/lib/formTextToken';
import {
  buildFormTimeToken,
  NAMED_SHIFT_LABELS,
  timeFormState,
  type FormTimeConfig,
  type NamedShift,
} from '@/lib/formTimeToken';
import { readLinkAttr } from '@/lib/linkRule';
import {
  buildPictureToken,
  isPictureSrc,
  PICTURE_SIZE_OPTIONS,
  PICTURE_SIZES,
  type PictureConfig,
  type PictureSize,
} from '@/lib/pictureToken';

export type BodyItemKind = 'text' | 'number' | 'date' | 'time' | 'menu' | 'button' | 'auto' | 'greeting' | 'picture';

interface ItemBase {
  /** Where the element sits. `end` is exclusive. */
  start: number;
  end: number;
  raw: string;
  /** The field name, or '' for an element that has none. */
  name: string;
}

/** `cfg` is null when the element cannot be edited without losing a setting. */
export type BodyItem =
  | (ItemBase & { kind: 'text'; cfg: FormTextConfig | null })
  | (ItemBase & { kind: 'number'; cfg: FormNumberConfig | null })
  | (ItemBase & { kind: 'date' | 'time'; cfg: FormDateConfig | null })
  | (ItemBase & { kind: 'menu'; cfg: FormMenuConfig | null })
  | (ItemBase & { kind: 'button'; cfg: FormButtonConfig | null })
  | (ItemBase & { kind: 'auto'; cfg: FormTimeConfig | null })
  | (ItemBase & { kind: 'greeting'; cfg: null })
  | (ItemBase & { kind: 'picture'; cfg: PictureConfig | null });

const BUTTON_CLOSE = '{/button}';

/** A token's settings, one per `;`, each trimmed and with its key lowercased. */
function settingsOf(inner: string): string[] {
  return inner
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => {
      const eq = s.indexOf('=');
      return eq === -1 ? s : `${s.slice(0, eq).trim().toLowerCase()}=${s.slice(eq + 1).trim()}`;
    });
}

/** What follows the token's `head:` up to its closing brace. */
function innerOf(raw: string): string {
  const colon = raw.indexOf(':');
  return colon === -1 ? '' : raw.slice(colon + 1, raw.lastIndexOf('}'));
}

/** Whether two tokens hold the same settings, in any order and spacing. */
function sameSettings(a: string, b: string): boolean {
  const x = settingsOf(innerOf(a)).sort();
  const y = settingsOf(innerOf(b)).sort();
  return x.length === y.length && x.every((s, i) => s === y[i]);
}

/** A token's `key=value` settings, or null when one is not in that shape. */
function attrsOf(raw: string): Map<string, string> | null {
  const out = new Map<string, string>();
  for (const s of settingsOf(innerOf(raw))) {
    const eq = s.indexOf('=');
    if (eq === -1) return null;
    out.set(s.slice(0, eq), s.slice(eq + 1));
  }
  return out;
}

function onlyKeys(attrs: Map<string, string>, allowed: readonly string[]): boolean {
  return [...attrs.keys()].every((k) => allowed.includes(k));
}

/** The `name=` a token carries, or ''. */
function nameIn(raw: string): string {
  return /(?:[:;]\s*)name\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/i.exec(raw)?.[1] ?? '';
}

export function parseFormTextToken(raw: string): FormTextConfig | null {
  const attrs = attrsOf(raw);
  if (!attrs || !onlyKeys(attrs, ['name', 'default', 'format', 'link'])) return null;
  const name = attrs.get('name') ?? '';
  if (!isValidFieldName(name)) return null;
  const format = attrs.get('format');
  if (format !== undefined && format !== 'name' && format !== 'plain') return null;
  const cfg: FormTextConfig = {
    name,
    default: attrs.get('default') ?? '',
    ...(format === 'name' ? { personName: true } : format === 'plain' ? { personName: false } : {}),
    link: readLinkAttr(innerOf(raw)),
  };
  return sameSettings(buildFormTextToken(cfg), raw) ? cfg : null;
}

export function parseFormNumberToken(raw: string): FormNumberConfig | null {
  const attrs = attrsOf(raw);
  if (!attrs || !onlyKeys(attrs, ['name', 'type', 'format', 'currency', 'default', 'label', 'link'])) return null;
  const name = attrs.get('name') ?? '';
  if (!isValidFieldName(name)) return null;
  const format = (attrs.get('format') ?? 'plain') as NumberFormat;
  const currency = (attrs.get('currency') ?? 'EUR') as CurrencyCode;
  if (!NUMBER_FORMATS.includes(format) || !CURRENCY_CODES.includes(currency)) return null;
  const cfg: FormNumberConfig = {
    name,
    format,
    currency,
    default: attrs.get('default') ?? '',
    label: attrs.get('label') ?? '',
    link: readLinkAttr(innerOf(raw)),
  };
  return sameSettings(buildFormNumberToken(cfg), raw) ? cfg : null;
}

export function parseFormDateToken(raw: string): FormDateConfig | null {
  const attrs = attrsOf(raw);
  if (!attrs || !onlyKeys(attrs, ['name', 'type', 'format', 'link', 'after'])) return null;
  const name = attrs.get('name') ?? '';
  const type = attrs.get('type') ?? 'date';
  if (!isValidFieldName(name) || (type !== 'date' && type !== 'time')) return null;
  const cfg: FormDateConfig = {
    name,
    kind: type,
    format: attrs.get('format') ?? '',
    link: readLinkAttr(innerOf(raw)),
    after: attrs.get('after') ?? '',
  };
  return sameSettings(buildFormDateToken(cfg), raw) ? cfg : null;
}

const BUTTON_HEAD = /^\{\s*button((?:\s+[A-Za-z]+=(?:"[^"]*"|[^\s}]+))*)\s*\}/i;
const BUTTON_LINE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*(.+)$/;
const TRIMS: readonly ButtonTrim[] = ['no', 'yes', 'left', 'right'];

export function parseFormButtonToken(raw: string): FormButtonConfig | null {
  const head = BUTTON_HEAD.exec(raw);
  if (!head || !raw.endsWith(BUTTON_CLOSE)) return null;
  let label = '';
  let trim: ButtonTrim = 'no';
  for (const m of (head[1] ?? '').matchAll(/([A-Za-z]+)=("[^"]*"|[^\s}]+)/g)) {
    const key = (m[1] ?? '').toLowerCase();
    const value = (m[2] ?? '').replace(/^"|"$/g, '');
    if (key === 'label') label = value;
    else if (key === 'trim' && TRIMS.includes(value.toLowerCase() as ButtonTrim)) trim = value.toLowerCase() as ButtonTrim;
    else return null;
  }
  const code = raw.slice(head[0].length, raw.length - BUTTON_CLOSE.length);
  const lines: FormButtonConfig['lines'] = [];
  for (const statement of code.split(/[;\n]/).map((s) => s.trim()).filter((s) => s !== '')) {
    const m = BUTTON_LINE.exec(statement);
    if (!m) return null;
    lines.push({ field: m[1] ?? '', expr: (m[2] ?? '').trim() });
  }
  // Every setting and every line was read above, or the token was turned
  // down, so writing these back loses nothing.
  return lines.length > 0 ? { label, trim, lines } : null;
}

export function parseFormTimeToken(raw: string): FormTimeConfig | null {
  const parts = settingsOf(innerOf(raw));
  const format = parts[0] ?? '';
  if (format === '' || format.includes('=')) return null;
  let shift = '';
  let at = '';
  for (const s of parts.slice(1)) {
    const eq = s.indexOf('=');
    const key = eq === -1 ? '' : s.slice(0, eq);
    if (key === 'shift') shift = s.slice(eq + 1);
    else if (key === 'at') at = s.slice(eq + 1);
    else return null;
  }
  const cfg: FormTimeConfig = { format, shift, at };
  if (settingsOf(innerOf(buildFormTimeToken(cfg))).join(';') !== parts.join(';')) return null;
  // Only what the window can show is offered for editing there.
  return timeFormState(cfg) ? cfg : null;
}

export function parsePictureToken(raw: string): PictureConfig | null {
  const attrs = attrsOf(raw);
  if (!attrs || !onlyKeys(attrs, ['src', 'alt', 'size'])) return null;
  const src = attrs.get('src') ?? '';
  const size = (attrs.get('size') ?? 'medium') as PictureSize;
  if (!isPictureSrc(src) || !PICTURE_SIZES.includes(size)) return null;
  const cfg: PictureConfig = { src, alt: attrs.get('alt') ?? '', size };
  return sameSettings(buildPictureToken(cfg), raw) ? cfg : null;
}

function kindOf(raw: string): BodyItemKind | null {
  if (/^\{\s*formtext:/i.test(raw)) return /;\s*type\s*=\s*number\s*(?:;|\}$)/i.test(raw) ? 'number' : 'text';
  if (/^\{\s*formdate:/i.test(raw)) return /;\s*type\s*=\s*time\s*(?:;|\}$)/i.test(raw) ? 'time' : 'date';
  if (/^\{\s*formmenu:/i.test(raw)) return 'menu';
  if (/^\{\s*time:/i.test(raw)) return 'auto';
  if (/^\{\s*greeting\s*(?::|\})/i.test(raw)) return 'greeting';
  if (/^\{\s*picture:/i.test(raw)) return 'picture';
  return null;
}

function itemOf(kind: BodyItemKind, start: number, end: number, raw: string): BodyItem {
  const base = { start, end, raw };
  switch (kind) {
    case 'text':
      return { ...base, kind, name: nameIn(raw), cfg: parseFormTextToken(raw) };
    case 'number':
      return { ...base, kind, name: nameIn(raw), cfg: parseFormNumberToken(raw) };
    case 'date':
    case 'time':
      return { ...base, kind, name: nameIn(raw), cfg: parseFormDateToken(raw) };
    case 'menu': {
      const cfg = parseFormMenuToken(raw);
      return { ...base, kind, name: cfg?.name ?? nameIn(raw), cfg };
    }
    case 'button':
      return { ...base, kind, name: '', cfg: parseFormButtonToken(raw) };
    case 'auto':
      return { ...base, kind, name: '', cfg: parseFormTimeToken(raw) };
    case 'greeting':
      return { ...base, kind, name: '', cfg: null };
    case 'picture':
      return { ...base, kind, name: '', cfg: parsePictureToken(raw) };
  }
}

/** Every element in the body, in order. A `{{…}}` placeholder is not one. */
export function bodyItems(body: string): BodyItem[] {
  const out: BodyItem[] = [];
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{', i);
    if (open === -1) break;
    if (body.charAt(open + 1) === '{') {
      const shut = body.indexOf('}}', open + 2);
      i = shut === -1 ? open + 2 : shut + 2;
      continue;
    }
    const close = body.indexOf('}', open + 1);
    if (close === -1) break;
    const raw = body.slice(open, close + 1);
    if (BUTTON_HEAD.test(raw)) {
      const shut = body.indexOf(BUTTON_CLOSE, close + 1);
      if (shut === -1) {
        i = close + 1;
        continue;
      }
      const end = shut + BUTTON_CLOSE.length;
      out.push(itemOf('button', open, end, body.slice(open, end)));
      i = end;
      continue;
    }
    const kind = kindOf(raw);
    if (kind) out.push(itemOf(kind, open, close + 1, raw));
    i = close + 1;
  }
  return out;
}

/** The menu's choices, the date's format: what the list shows beside the name. */
export function itemDetail(item: BodyItem): string {
  switch (item.kind) {
    case 'text':
      return item.cfg?.default ? `Starts with "${item.cfg.default}"` : 'Text';
    case 'number':
      return item.cfg?.label || (item.cfg?.format === 'currency' ? `Currency, ${item.cfg.currency}` : item.cfg?.format === 'percent' ? 'Percent' : 'Number');
    case 'date':
      return DATE_FORMAT_OPTIONS.find((o) => o.value === item.cfg?.format)?.label ?? 'Date';
    case 'time':
      return TIME_FORMAT_OPTIONS.find((o) => o.value === item.cfg?.format)?.label ?? 'Time';
    case 'menu':
      return item.cfg ? item.cfg.options.join(', ') : 'Choice';
    case 'button':
      return item.cfg ? item.cfg.lines.map((l) => `${l.field} = ${l.expr}`).join('; ') : 'Button';
    case 'auto': {
      const shift = item.cfg?.shift ?? '';
      const day = shift === '' ? 'Today' : (NAMED_SHIFT_LABELS[shift as NamedShift] ?? shift);
      return item.cfg ? `${day}, ${item.cfg.format}` : innerOf(item.raw).trim();
    }
    case 'greeting':
      return innerOf(item.raw).trim() || 'Hello, by time of day';
    case 'picture': {
      const size = PICTURE_SIZE_OPTIONS.find((o) => o.value === item.cfg?.size)?.label;
      return size ? `${size} picture` : 'Picture';
    }
  }
}

/** What the list calls the element: its name, the button's label, the date's format. */
export function itemTitle(item: BodyItem): string {
  if (item.name !== '') return item.name;
  if (item.kind === 'button') return item.cfg?.label || 'Button';
  if (item.kind === 'auto') return 'Automatic date';
  if (item.kind === 'greeting') return 'Greeting';
  if (item.kind === 'picture') return item.cfg?.alt || 'Picture';
  return 'Unnamed';
}

// Where a name can be read: inside any token, and in a button's code, which
// sits between its tags rather than inside braces.
const READ_SPOTS = /\{\s*button[^}]*\}[\s\S]*?\{\/button\}|\{[^{}]*\}/g;

/** How many other tokens read `name`, outside the element at `start`..`end`. */
export function readersOf(body: string, name: string, start: number, end: number): number {
  if (name === '') return 0;
  const word = new RegExp(`\\b${name}\\b`);
  let count = 0;
  for (const m of body.matchAll(READ_SPOTS)) {
    const at = m.index ?? 0;
    if (at >= start && at < end) continue;
    if (word.test(m[0])) count += 1;
  }
  return count;
}

/**
 * The body with every other token's `from` read as `to`, so renaming a field
 * keeps the formulas and rules that read it working. Prose is left alone, and
 * so is the element at `skipStart`..`skipEnd`, which was just written.
 */
export function renameInBody(body: string, from: string, to: string, skipStart: number, skipEnd: number): string {
  if (from === '' || from === to) return body;
  const word = new RegExp(`\\b${from}\\b`, 'g');
  return body.replace(READ_SPOTS, (spot, at: number) =>
    at >= skipStart && at < skipEnd ? spot : spot.replace(word, to),
  );
}

/** The one stretch where two texts differ, so a save replaces only what changed. */
export function changedSpan(before: string, after: string): { start: number; end: number; text: string } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let tail = 0;
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  return { start, end: before.length - tail, text: after.slice(start, after.length - tail) };
}

/** The field name a freshly written token declares, or ''. */
export function tokenName(token: string): string {
  return nameIn(token);
}
