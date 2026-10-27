/**
 * Text colours for a snippet body: the formatting bar's Text colour menu.
 *
 * A closed set, registered in docs/DESIGN_SYSTEM.md ("Text colour palette").
 * The editor keeps a key; the layout an email gets carries `hex` inline,
 * because email clients drop classes and stylesheets. Each `hex` holds 4.5:1
 * on white, and each `dark` 4.5:1 on the dark theme's card, where the body
 * box shows it. This is the only file in `app/` allowed to spell them out.
 */
export type TextColor = 'grey' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red';

export interface TextColorSwatch {
  /** The name in the menu, and what a screen reader says. */
  name: string;
  /** The colour an email gets. */
  hex: string;
  /** The same colour on the dark theme, for the box only. */
  dark: string;
  /** Text in this colour on screen, in either theme. */
  text: string;
  /** A fill in this colour on screen, in either theme. */
  fill: string;
}

export const TEXT_COLORS: Readonly<Record<TextColor, TextColorSwatch>> = {
  grey: {
    name: 'Grey',
    hex: '#6E6E73',
    dark: '#AEAEB2',
    text: 'text-[#6E6E73] [[data-theme=dark]_&]:text-[#AEAEB2]',
    fill: 'bg-[#6E6E73] [[data-theme=dark]_&]:bg-[#AEAEB2]',
  },
  brown: {
    name: 'Brown',
    hex: '#8B5E3C',
    dark: '#C8A07E',
    text: 'text-[#8B5E3C] [[data-theme=dark]_&]:text-[#C8A07E]',
    fill: 'bg-[#8B5E3C] [[data-theme=dark]_&]:bg-[#C8A07E]',
  },
  orange: {
    name: 'Orange',
    hex: '#C2410C',
    dark: '#FB923C',
    text: 'text-[#C2410C] [[data-theme=dark]_&]:text-[#FB923C]',
    fill: 'bg-[#C2410C] [[data-theme=dark]_&]:bg-[#FB923C]',
  },
  yellow: {
    name: 'Yellow',
    hex: '#A16207',
    dark: '#FACC15',
    text: 'text-[#A16207] [[data-theme=dark]_&]:text-[#FACC15]',
    fill: 'bg-[#A16207] [[data-theme=dark]_&]:bg-[#FACC15]',
  },
  green: {
    name: 'Green',
    hex: '#15803D',
    dark: '#4ADE80',
    text: 'text-[#15803D] [[data-theme=dark]_&]:text-[#4ADE80]',
    fill: 'bg-[#15803D] [[data-theme=dark]_&]:bg-[#4ADE80]',
  },
  blue: {
    name: 'Blue',
    hex: '#1B4FD8',
    dark: '#6E96F0',
    text: 'text-[#1B4FD8] [[data-theme=dark]_&]:text-[#6E96F0]',
    fill: 'bg-[#1B4FD8] [[data-theme=dark]_&]:bg-[#6E96F0]',
  },
  purple: {
    name: 'Purple',
    hex: '#7C3AED',
    dark: '#C084FC',
    text: 'text-[#7C3AED] [[data-theme=dark]_&]:text-[#C084FC]',
    fill: 'bg-[#7C3AED] [[data-theme=dark]_&]:bg-[#C084FC]',
  },
  pink: {
    name: 'Pink',
    hex: '#BE185D',
    dark: '#F472B6',
    text: 'text-[#BE185D] [[data-theme=dark]_&]:text-[#F472B6]',
    fill: 'bg-[#BE185D] [[data-theme=dark]_&]:bg-[#F472B6]',
  },
  red: {
    name: 'Red',
    hex: '#D70015',
    dark: '#F87171',
    text: 'text-[#D70015] [[data-theme=dark]_&]:text-[#F87171]',
    fill: 'bg-[#D70015] [[data-theme=dark]_&]:bg-[#F87171]',
  },
};

/** Menu order, after Default: Notion's. */
export const TEXT_COLOR_KEYS = Object.keys(TEXT_COLORS) as TextColor[];

export function isTextColor(value: string): value is TextColor {
  return Object.prototype.hasOwnProperty.call(TEXT_COLORS, value);
}

/** A CSS colour as `#rrggbb`: from `#rgb`, `#rrggbb` or an opaque `rgb()`. Null for anything else. */
function toHex(value: string): string | null {
  const v = value.replace(/!important/i, '').trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*1(?:\.0+)?\s*)?\)$/.exec(v);
  if (!rgb) return null;
  return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

// Either shade names its colour: the browser writes the shade it shows when
// it moves coloured text about (joining two lines), the dark one on the dark theme.
const BY_HEX = new Map<string, TextColor>(
  TEXT_COLOR_KEYS.flatMap((key) => [
    [TEXT_COLORS[key].hex.toLowerCase(), key],
    [TEXT_COLORS[key].dark.toLowerCase(), key],
  ]),
);

/** The palette colour a CSS colour value names, or null for any other colour. */
export function textColorOf(value: string): TextColor | null {
  const hex = toHex(value);
  return hex ? BY_HEX.get(hex) ?? null : null;
}
