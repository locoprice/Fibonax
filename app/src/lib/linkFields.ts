/**
 * The fields the Fill from a web page window lists, and how its Save writes
 * them back.
 *
 * Every Text, Number, Date/Time and Choice field can say where its value sits
 * on a pasted page (`link=`, see `@/lib/linkRule`). The window shows them all
 * in one place, in body order, once per field: a name the body declares twice
 * is one box in the fill form, so it is one row here, and Save writes the same
 * rule on every token that declares it.
 */

import { bodyItems, type BodyItem } from '@/lib/bodyItems';
import { LABEL_LINK_MODES, LINK_MODES, parseLinkRule, tokenLink, withTokenLink, type LinkMode } from '@/lib/linkRule';

export type LinkFieldKind = 'text' | 'number' | 'date' | 'time' | 'menu';

export interface LinkField {
  /** The field's name, or `#<where it sits>` for a choice nobody named. */
  key: string;
  kind: LinkFieldKind;
  /** What the window calls it: the field's name. */
  title: string;
  /** The kind in plain words, with a choice's options. */
  detail: string;
  /**
   * The ways this field can be read. A count is a number (root CLAUDE.md,
   * Industry-Neutral), so only Number offers adding up the numbers before a
   * word; a rule written by hand in that mode keeps it on any field.
   */
  modes: readonly LinkMode[];
  /** The rule it carries now, in its written spelling, or ''. */
  link: string;
}

const KIND_WORD: Record<LinkFieldKind, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  time: 'Time',
  menu: 'Choice',
};

type LinkItem = Extract<BodyItem, { kind: LinkFieldKind }>;

function isLinkItem(item: BodyItem): item is LinkItem {
  return item.kind in KIND_WORD;
}

function keyOf(item: BodyItem): string {
  return item.name !== '' ? item.name : `#${item.start}`;
}

function detailOf(item: LinkItem): string {
  if (item.kind !== 'menu' || !item.cfg) return KIND_WORD[item.kind];
  return `${KIND_WORD.menu}: ${item.cfg.options.join(', ')}`;
}

function modesFor(kind: LinkFieldKind, link: string): readonly LinkMode[] {
  const offered = kind === 'number' ? LINK_MODES : LABEL_LINK_MODES;
  const mode = parseLinkRule(link)?.mode;
  return mode && !offered.includes(mode) ? [...offered, mode] : offered;
}

/** Every field in the body that can fill from a page, once each, in body order. */
export function linkFields(body: string): LinkField[] {
  const out: LinkField[] = [];
  const byKey = new Map<string, LinkField>();
  for (const item of bodyItems(body)) {
    if (!isLinkItem(item)) continue;
    const key = keyOf(item);
    const link = tokenLink(item.raw);
    const seen = byKey.get(key);
    if (seen) {
      // The rule shows wherever the body wrote it; Save then puts it on both.
      if (seen.link === '' && link !== '') {
        seen.link = link;
        seen.modes = modesFor(seen.kind, link);
      }
      continue;
    }
    const field: LinkField = {
      key,
      kind: item.kind,
      title: item.name !== '' ? item.name : 'Unnamed choice',
      detail: detailOf(item),
      modes: modesFor(item.kind, link),
      link,
    };
    byKey.set(key, field);
    out.push(field);
  }
  return out;
}

/**
 * The body with each field in `links` (by `LinkField.key`) reading that rule.
 * A rule that says nothing takes the field's rule out. Fields not named in
 * `links`, and everything that is not a field, are left exactly as they were.
 */
export function withLinkRules(body: string, links: Readonly<Record<string, string>>): string {
  let out = body;
  // From the end, so a token rewritten never moves one still to come.
  for (const item of bodyItems(body).reverse()) {
    if (!isLinkItem(item)) continue;
    const link = links[keyOf(item)];
    if (link === undefined) continue;
    const next = withTokenLink(item.raw, link);
    if (next !== item.raw) out = out.slice(0, item.start) + next + out.slice(item.end);
  }
  return out;
}
