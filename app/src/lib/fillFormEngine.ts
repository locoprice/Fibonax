/**
 * Bridge to the SHARED fill-form core, so the dashboard's live preview resolves
 * a snippet through exactly the code that expands it in Gmail or WhatsApp.
 *
 * `extension/formula-engine.js` and `extension/shared/fill-form.js` are UMD and
 * already shipped as plain scripts to the popup and the in-page overlay.
 * This module loads those same two files
 * and reads the globals they install — it does NOT re-implement or re-bundle
 * them, so the preview can never disagree with what the extension produces.
 * `scripts/check-fill-form.js` guards the shape both sides depend on.
 *
 * Serving: `extensionScriptsPlugin` in vite.config.ts copies `extension/` into
 * dist at build and serves it from the repo root in dev, so `/extension/*`
 * resolves on both.
 */

import type { LinkRule } from '@/lib/linkRule';

/** A field's kind, as decided by `fill-form.js` (token declaration, then name). */
export type SbFieldType = 'text' | 'date' | 'time' | 'datetime' | 'number' | 'dd';

/**
 * Where on a pasted web page a field's value sits (Fill from link), as the
 * engine's `sbParseLinkRule` reads a token's `link=`: the same shape the
 * builders' mirror in linkRule.ts reads and writes.
 */
export type SbLinkRule = LinkRule;

/** One choice in the Adjust panel's Format list, sampled against the value. */
export interface SbFormatChoice {
  /** An engine format, or '' for "print what the picker holds". */
  value: string;
  label: string;
  sample: string;
}

/** A labelled value in one of the Adjust panel's other lists. */
export interface SbAdjustChoice {
  value: string;
  label: string;
}

/**
 * The Date/Time builder's three decisions — which format, which day, what time
 * on it — offered again while the form is open. Every surface draws its own
 * controls from this one description. A list is empty when it does not apply:
 * a clock has no day to jump to, a calendar has no clock to set, and a datetime
 * has no format list because neither of the engine's lists prints it whole.
 */
export interface SbFieldAdjust {
  formats: SbFormatChoice[];
  modes: SbAdjustChoice[];
  units: SbAdjustChoice[];
  days: SbAdjustChoice[];
  hours: string[];
  minutes: string[];
  /** What the clock controls open on: the time already in the field. */
  hour: string;
  minute: string;
}

/** One row of the fill form. Mirrors FIELD_SHAPE in scripts/check-fill-form.js. */
export interface SbFillField {
  required?: boolean;
  error?: string;
  key: string;
  /**
   * Display name from a stored field_cfg, or '' when none is set — the renderer
   * decides how to title an unnamed field, and they deliberately differ (the
   * overlay prints {KEY}, the phone and this panel humanise it).
   */
  label: string;
  type: SbFieldType;
  /**
   * How the value prints once it leaves the form: one of the engine's date or
   * time formats, or `''` for the picker's own value. A number carries
   * 'plain' | 'currency' | 'percent'. Output only — a formula still reads the
   * raw value.
   */
  format: string;
  /** ISO code behind a currency field; '' for everything else. */
  currency: string;
  /** Choices, for `dd` only. */
  options: string[];
  /** Which choices are currently selected, for `dd` only. */
  picks: string[];
  multiple: boolean;
  /** The Other choice's label (`other=`), or '' for a menu without one. */
  other: string;
  /** Other is ticked: the value is what its box holds (after the picks, when multiple). */
  otherOn: boolean;
  /** What the Other box holds; '' while Other is not ticked. */
  otherText: string;
  /** Author-requested width in characters; 0 when unset. */
  cols: number;
  default: string;
  value: string;
  /** The prose immediately before/after the token, so a row reads like the body. */
  before: string;
  after: string;
  /**
   * The field this one may not open before, or '' for no ordering. Distinct
   * from `after` above, which is prose: this names another field.
   */
  notBefore: string;
  /** The earliest value the picker may offer, resolved from that field. */
  min: string;
  /** A choice list is block level: its context goes above and below, not beside. */
  block: boolean;
  /** What the Adjust panel offers this field; null for anything but a date. */
  adjust: SbFieldAdjust | null;
  /** Where on a pasted page the value is; null for a field never pointed at one. */
  link: SbLinkRule | null;
  /**
   * The value held now came from a page and nobody has touched it since: the
   * key was passed in `linked`. The renderer marks it "From link".
   */
  fromLink: boolean;
  visible: boolean;
  /**
   * Whether this box's answer reaches the text as the form stands: false only
   * for an empty box in a Show or hide section that is closed, which the
   * unfinished-text check then leaves out.
   */
  prints: boolean;
}

/** A `{button}` control: sets field values when clicked, never prints. */
export interface SbFillButton {
  id: string;
  label: string;
  trim: string;
  code: string;
  statements: Array<{ name: string; expr: string }>;
  errors: string[];
}

/** A picture in a snippet, as `{picture: …}` holds it. */
export interface SbPicture {
  src: string;
  alt: string;
  size: 'small' | 'medium' | 'full';
}

/** One piece of a finished text: some text, or a picture. */
export type SbPreviewPart = { text: string } | { picture: SbPicture };

/** Where a text's pictures go, in the shared words (`pictureText`). */
export type SbPictureTextKey = 'left-out' | 'left-out-done' | 'copy' | 'share' | 'missing';

/** The view model every fill surface renders. Mirrors SHAPE in the gate. */
export interface SbFillFormViewModel {
  errors?: Array<{ key: string; message: string }>;
  sections?: Array<{ title: string; keys: string[] }>;
  fields: SbFillField[];
  buttons: SbFillButton[];
  preview: string;
  /**
   * The snippet's formatted layout filled with the same answers, every value
   * escaped, or null: no layout was passed, or it asks for other fields than
   * the text. A surface that can paste formatting inserts this, with
   * `preview` as its plain text. A plain text with pictures fills it too.
   */
  formatted: string | null;
  /**
   * The text with its pictures in order, or null when it has none. What a
   * preview draws: `preview` leaves the pictures out.
   */
  parts: SbPreviewPart[] | null;
  /**
   * How each date and time field prints, ready to hand straight to
   * `resolveBody`. A surface that resolves the body itself must pass this too,
   * or what it produces prints differently from the preview it just showed.
   */
  fmtOverride: Record<string, string>;
  /**
   * At least one field says where its value is on a page, so the form offers
   * the Link box. False for every snippet that never mentions `link=`.
   */
  linkable: boolean;
  layout: 'flat' | 'steps';
  steps: string[][];
}

export interface SbFillFormOptions {
  /** Stored per-field overrides; wins over whatever the body declares. */
  fieldCfg?: Record<string, unknown>;
  /**
   * Formats picked in the Adjust panel while the form is open, keyed by field.
   * Beside `values` because it is the same kind of thing: an answer given now
   * and never saved back to the snippet.
   */
  fieldFmt?: Record<string, string>;
  /** Snippet language — genders ambiguous names and picks the greeting. */
  lang?: string;
  now?: Date;
  /**
   * The fields whose value came from a page (Fill from link), `{ KEY: true }`.
   * The renderer drops a key the moment that field is edited by hand.
   */
  linked?: Record<string, boolean>;
  /**
   * The menus whose Other choice is ticked, with what its box holds,
   * `{ KEY: 'text' }`. Keeps Other ticked while the box is still empty.
   */
  other?: Record<string, string>;
  /** The snippet's formatted layout (`body_html`), filled into `formatted`. */
  formatted?: string | null;
}

/** Why a pasted link was refused before anything was sent. */
export type SbLinkProblem = 'link-empty' | 'link-invalid' | 'link-not-secure';

/** `linkUrl`'s answer: the link to read, or why it cannot be read. */
export interface SbLinkUrl {
  url: string;
  problem: SbLinkProblem | '';
}

/**
 * How one field fared against a page. `missing`: the label or word is not on
 * it. `unclear`: it is, but the value could be read more than one way, so the
 * field kept what it held. `none`: filled with the field's default because the
 * page counts none of it.
 */
export interface SbLinkResult {
  key: string;
  status: 'filled' | 'missing' | 'unclear';
  none: boolean;
}

/** `readFromPage`'s answer. */
export interface SbLinkRead {
  /** KEY to the value for its control: ISO dates, plain digits, option text. */
  values: Record<string, string>;
  /** One per field that has a `link`. */
  results: SbLinkResult[];
  filled: number;
  total: number;
}

/** Which of the three ways the Adjust panel's Day row chooses a date. */
export type SbDayMode = 'none' | 'fixed' | 'named';

export interface SbDayChoice {
  mode: SbDayMode;
  /** How many units to count, for `fixed`. */
  amount?: string | number;
  /** Which unit to count in ('D' | 'W' | 'Mo' | 'Y', plus 'H' | 'M' on a datetime). */
  unit?: string;
  /** Count backwards instead of forwards. */
  back?: boolean;
  /** One of the engine's named anchors, for `named`. */
  named?: string;
}

/**
 * One piece of a finished text that looks unfinished, as `unfinished()` in
 * extension/shared/fill-form.js reports it: an empty box, or a fragment such
 * as "[xxx]" with where it sits.
 */
export interface SbUnfinishedItem {
  /** 'empty', 'placeholder', 'gap', 'note', 'instruction', 'field' or 'sample'. */
  kind: string;
  /** The fragment itself, or the title of the box left empty. */
  text: string;
  /** Why it was flagged, in the words every surface shows. */
  reason: string;
  /** The field it belongs to, or '' when it is written in the snippet itself. */
  key: string;
  /** Where the fragment starts in the text; -1 for an empty box. */
  start: number;
}

interface SbFillFormApi {
  /** What in a finished text looks unfinished. Pure; see SbUnfinishedItem. */
  unfinished(text: string, fields: readonly SbFillField[]): SbUnfinishedItem[];
  /** The shared words for the warning, with {name} slots filled in. */
  unfinishedText(key: string, slots?: Record<string, string | number>): string;
  /** How many pieces a list shows before "and N more". */
  UNFINISHED_SHOWN: number;
  fillForm(
    text: string,
    values: Record<string, string>,
    opts: SbFillFormOptions,
  ): SbFillFormViewModel;
  /** A menu's value from its ticked options and, when Other is ticked, its text. */
  menuValue(multiple: boolean, picks: readonly string[], other: string | null): string;
  /** The hint inside the Other box, the same on every surface. */
  OTHER_PLACEHOLDER: string;
  /** The picker value a Day choice lands on, in the picker's own spelling. */
  dayValue(type: SbFieldType, choice: SbDayChoice, current: string, now?: Date): string;
  /** The picker value a Clock choice lands on; '' for a field with no clock. */
  clockValue(
    type: SbFieldType,
    hour: string,
    minute: string,
    current: string,
    now?: Date,
  ): string;
  /**
   * The earliest value a field ordered after another may hold, given what that
   * other field holds now; '' for no limit.
   */
  orderedMin(dstType: SbFieldType, srcValue: string): string;
  linkUrl(raw: string): SbLinkUrl;
  readFromPage(fields: readonly SbFillField[], pieces: readonly string[]): SbLinkRead;
  linkText(key: string): string;
  linkSummary(read: SbLinkRead): string;
  linkNote(result: SbLinkResult | null | undefined): string;
  pictureText(key: SbPictureTextKey, count: number): string;
  pictureCount(vm: SbFillFormViewModel): number;
  /** A formatted text rebuilt for the screen: lines, lists, marks, https pictures, nothing else. */
  layoutFragment(html: string): DocumentFragment | null;
  /** Whether a layout is an email's, rather than the bar's lines, lists and marks. */
  isEmailLayout(html: string): boolean;
  /** The document a preview frame shows an email layout in, the same on every surface. */
  layoutDocument(html: string): string;
}

interface SbFormulaEngineApi {
  extractButtons(body: string): SbFillButton[];
  applyButtonCode(
    statements: Array<{ name: string; expr: string }>,
    values: Record<string, string>,
  ): { values: Record<string, number>; errors: string[] };
  /**
   * The date formatter every surface prints through. Exposed so the Date/Time
   * builder can preview a {time:} token against the real one rather than
   * carrying a third copy of the token table — the dialog would be the only
   * place in the product where a date could be formatted a different way.
   * `lang` is read by the `long` format only, which writes the date out in the
   * snippet's language.
   */
  sbFormatDate(d: Date, fmt: string, lang?: string): string;
  /**
   * Resolves a body with the values given, whether or not the body declares
   * those fields itself. The formula builder previews a lone `{= }` with it,
   * which the fill form cannot do: it only fills fields its text declares.
   */
  resolveBody(body: string, vals: Record<string, string>): string;
}

/** The engine's date formatter, or null until the scripts have loaded. */
export function formulaEngine(): SbFormulaEngineApi | null {
  return window.SBFormulaEngine ?? null;
}

/**
 * The shared fill-form module, or null until the scripts have loaded. Exposed so
 * a builder can ask what fields a body already holds through the same decider
 * every fill surface uses, rather than re-deriving the rule from the text.
 */
export function fillFormApi(): SbFillFormApi | null {
  return window.SBFillForm ?? null;
}

declare global {
  interface Window {
    SBFillForm?: SbFillFormApi;
    SBFormulaEngine?: SbFormulaEngineApi;
  }
}

/** Load order matters only for clarity — fill-form reads the engine lazily. */
const ENGINE_SCRIPTS = [
  '/extension/formula-engine.js',
  '/extension/shared/fill-form.js',
] as const;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-sb-engine="${src}"]`,
    );
    if (existing) {
      if (existing.dataset.sbLoaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error(`Could not load ${src}`)),
        { once: true },
      );
      return;
    }

    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.dataset.sbEngine = src;
    el.addEventListener(
      'load',
      () => {
        el.dataset.sbLoaded = 'true';
        resolve();
      },
      { once: true },
    );
    el.addEventListener(
      'error',
      () => reject(new Error(`Could not load ${src}`)),
      { once: true },
    );
    document.head.appendChild(el);
  });
}

/** One in-flight load shared by every caller; retried only after a failure. */
let pending: Promise<SbFillFormApi> | null = null;

/**
 * Resolves once both shared scripts have installed their globals. Rejects with
 * an actionable message if they cannot be served, so the caller can say so
 * rather than rendering an empty form that looks like a broken snippet.
 */
export function loadFillFormEngine(): Promise<SbFillFormApi> {
  if (window.SBFillForm && window.SBFormulaEngine) {
    return Promise.resolve(window.SBFillForm);
  }
  if (pending) return pending;

  pending = (async () => {
    for (const src of ENGINE_SCRIPTS) {
      await loadScript(src);
    }
    const api = window.SBFillForm;
    if (!api || !window.SBFormulaEngine) {
      throw new Error('Snippet engine loaded but installed no interface');
    }
    return api;
  })().catch((error: unknown) => {
    // Clear the cache so a later open retries rather than repeating a stale
    // failure for the rest of the session.
    pending = null;
    throw error;
  });

  return pending;
}

/** The engine globals, once `loadFillFormEngine` has resolved. */
export function fillForm(
  body: string,
  values: Record<string, string>,
  opts: SbFillFormOptions = {},
): SbFillFormViewModel | null {
  const api = window.SBFillForm;
  if (!api) return null;
  return api.fillForm(body, values, opts);
}

/**
 * What looks unfinished in a finished text, decided by the same rules the
 * extension and the phone run right before a snippet goes out. [] until the
 * engine has loaded.
 */
export function unfinishedItems(
  text: string,
  fields: readonly SbFillField[],
): SbUnfinishedItem[] {
  return window.SBFillForm?.unfinished(text, fields) ?? [];
}

/** The warning's shared words; '' until the engine has loaded. */
export function unfinishedWords(key: string, slots?: Record<string, string | number>): string {
  return window.SBFillForm?.unfinishedText(key, slots) ?? '';
}

/** How many pieces a list shows before "and N more". */
export function unfinishedShown(): number {
  return window.SBFillForm?.UNFINISHED_SHOWN ?? 6;
}

/** The hint inside a menu's Other box; '' until the engine has loaded. */
export function otherPlaceholder(): string {
  return window.SBFillForm?.OTHER_PLACEHOLDER ?? '';
}

/**
 * The picker value one Adjust panel choice lands on. Both answer '' when the
 * engine has not loaded or the field has no such control, and the caller writes
 * nothing rather than clearing a date the operator already set.
 */
export function dayValue(
  type: SbFieldType,
  choice: SbDayChoice,
  current: string,
): string {
  return window.SBFillForm?.dayValue(type, choice, current) ?? '';
}

export function clockValue(
  type: SbFieldType,
  hour: string,
  minute: string,
  current: string,
): string {
  return window.SBFillForm?.clockValue(type, hour, minute, current) ?? '';
}

/**
 * The closing dates a write has left before their opening ones, in field order.
 *
 * The ordering rule every fill surface runs after a value changes (the
 * overlay's `_sbReorder`, the phone's `sbReorderDates`): a closing date the new
 * opening one has just invalidated is emptied rather than left sitting in the
 * form as an impossible pair. The limit itself is `orderedMin`, decided in
 * shared/fill-form.js. A date emptied here frees the field ordered after it,
 * as it does on the other surfaces.
 *
 * What the write itself sets is never emptied. A date typed from the keyboard
 * passes through earlier days on its way (the picker reports `0002-10-14` after
 * the first digit of a year), and emptying it there would wipe the box under
 * the operator's fingers. A closing date typed before its opening one stays,
 * flagged by the picker's `min`, and still limits the date ordered after it.
 *
 * @param fields  the form's fields, for which one follows which
 * @param held    every field's value once the write lands, defaults included
 * @param written the keys the write sets, which are kept as written
 * @returns the keys to empty; none until the engine has loaded
 */
export function backwardDates(
  fields: readonly SbFillField[],
  held: Readonly<Record<string, string>>,
  written: readonly string[] = [],
): string[] {
  const api = window.SBFillForm;
  if (!api) return [];
  const now: Record<string, string> = { ...held };
  const emptied: string[] = [];
  for (const field of fields) {
    if (!field.notBefore || written.includes(field.key)) continue;
    const min = api.orderedMin(field.type, now[field.notBefore] ?? '');
    const value = now[field.key] ?? '';
    if (min !== '' && value !== '' && value < min) {
      now[field.key] = '';
      emptied.push(field.key);
    }
  }
  return emptied;
}

/**
 * Applies one `{button}`'s statements to the current values. Returns the fields
 * it wrote plus anything it could not work out, exactly as the overlay, the
 * popup detail and the composer already do.
 */
export function runFormButton(
  body: string,
  buttonId: string,
  values: Record<string, string>,
): { values: Record<string, string>; errors: string[] } {
  const engine = window.SBFormulaEngine;
  if (!engine) return { values: {}, errors: [] };

  const spec = engine.extractButtons(body).find((b) => b.id === buttonId);
  if (!spec) return { values: {}, errors: [] };

  const result = engine.applyButtonCode(spec.statements, values);
  const written: Record<string, string> = {};
  for (const [name, value] of Object.entries(result.values)) {
    written[name] = String(value);
  }
  return { values: written, errors: [...spec.errors, ...result.errors] };
}

// ── Fill from link ──
// What a pasted page means for the form is decided once, in
// shared/fill-form.js, for all four fill surfaces; these only hand it through.
// Each answers nothing until the engine has loaded, and the Link box that
// calls them only exists once it has.

/** The link to read, or why it cannot be read (a `linkText` key). */
export function linkUrl(raw: string): SbLinkUrl {
  return window.SBFillForm?.linkUrl(raw) ?? { url: '', problem: 'link-invalid' };
}

/**
 * What a page's text puts in each field that says where its value is. Fields
 * the page does not settle get no value, so they keep whatever they held.
 */
export function readFromPage(
  fields: readonly SbFillField[],
  pieces: readonly string[],
): SbLinkRead {
  return (
    window.SBFillForm?.readFromPage(fields, pieces) ?? {
      values: {},
      results: [],
      filled: 0,
      total: 0,
    }
  );
}

/** Every sentence Fill from link says, by key. An unknown key reads as the generic failure. */
export function linkText(key: string): string {
  return window.SBFillForm?.linkText(key) ?? '';
}

/** The one status line after a read. */
export function linkSummary(read: SbLinkRead): string {
  return window.SBFillForm?.linkSummary(read) ?? '';
}

/** The note beside one field after a read, or '' for a field filled cleanly. */
export function linkNote(result: SbLinkResult | null | undefined): string {
  return window.SBFillForm?.linkNote(result) ?? '';
}

/** What every surface says about a text's pictures, for `count` of them. */
export function pictureText(key: SbPictureTextKey, count: number): string {
  return window.SBFillForm?.pictureText(key, count) ?? '';
}

/** How many pictures a view model's text shows. */
export function pictureCount(vm: SbFillFormViewModel): number {
  return window.SBFillForm?.pictureCount(vm) ?? 0;
}

/** A formatted text rebuilt for the screen, or null before the engine has loaded. */
export function layoutFragment(html: string): DocumentFragment | null {
  return window.SBFillForm?.layoutFragment(html) ?? null;
}
