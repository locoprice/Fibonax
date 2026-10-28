/**
 * The `{picture:}` token: a picture in a snippet, shown where formatted text
 * can go (an email, a Copy pasted into one) and left out of plain text.
 *
 *   {picture: src=https://…; alt=Company logo; size=small}
 *
 * MIRRORED from buildPictureToken and sbParsePicture in
 * extension/formula-engine.js: the dashboard cannot import extension source
 * (app/CLAUDE.md §6). Change both together; src/__tests__/pictureToken.test.ts
 * runs the engine against this file. Reading a token back for the editor's
 * list is `parsePictureToken` in `@/lib/bodyItems`.
 */

export type PictureSize = 'small' | 'medium' | 'full';

export interface PictureConfig {
  /** The picture's public https address. */
  src: string;
  /** What it shows: read out to people who cannot see it, shown where it does not load. */
  alt: string;
  size: PictureSize;
}

export const PICTURE_SIZES: readonly PictureSize[] = ['small', 'medium', 'full'];

/** The width each size prints at in an email, in pixels. Mirrors PICTURE_SIZES in the engine. */
export const PICTURE_SIZE_PX: Record<PictureSize, number> = { small: 160, medium: 320, full: 600 };

export const PICTURE_SIZE_OPTIONS: readonly { value: PictureSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'full', label: 'Full width' },
];

const SRC_RE = /^https:\/\/[^\s"'<>{};\\]+$/i;

/** Whether an address can be a picture: https, with nothing that would end the token. */
export function isPictureSrc(src: string): boolean {
  return SRC_RE.test(src);
}

/** Whether the body holds a picture. */
export function hasPicture(body: string): boolean {
  return /\{\s*picture:/i.test(body);
}

// ── Upload ──────────────────────────────────────────────────────────────────

/** Where pictures are kept: public read, each person writes only their own folder. */
export const PICTURE_BUCKET = 'snippet-pictures';

/** Mirrors the bucket's file_size_limit, for an answer before anything is sent. */
export const PICTURE_MAX_BYTES = 5 * 1024 * 1024;

/** Accepted file types, and the extension each is stored under. */
export const PICTURE_MIME_TO_EXT: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** `accept` for the file chooser. */
export const PICTURE_INPUT_ACCEPT = Object.keys(PICTURE_MIME_TO_EXT).join(',');

/**
 * A photo wider than this is made smaller before upload: an email shows a
 * picture 600 px wide at most, twice that on a sharp screen. PNG and GIF keep
 * their file as it is (see `shrinksBeforeUpload`).
 */
export const PICTURE_MAX_WIDTH = 1200;

/** The largest photo taken in before it is made smaller. */
export const PICTURE_SOURCE_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Whether a file is made smaller before upload. Only photos: making a PNG or
 * a GIF smaller turns it into a JPEG, which loses a logo's see-through
 * background and stops a GIF moving.
 */
export function shrinksBeforeUpload(type: string): boolean {
  return type === 'image/jpeg' || type === 'image/webp';
}

/** Why a chosen file cannot be uploaded, or '' when it can. */
export function pictureFileError(file: { type: string; size: number }): string {
  if (!Object.prototype.hasOwnProperty.call(PICTURE_MIME_TO_EXT, file.type)) {
    return 'Choose a PNG, JPG, GIF or WebP picture.';
  }
  if (file.size === 0) return 'That file is empty.';
  const limit = shrinksBeforeUpload(file.type) ? PICTURE_SOURCE_MAX_BYTES : PICTURE_MAX_BYTES;
  return file.size > limit ? 'Choose a picture of 5 MB or less.' : '';
}

/** Where an upload is stored: the person's own folder, under a name never used before. */
export function picturePath(userId: string, type: string, id: string): string {
  return `${userId}/${id}.${PICTURE_MIME_TO_EXT[type] ?? 'png'}`;
}

/** The token the window writes. `;`, braces and line breaks would end it, so the description loses them. */
export function buildPictureToken(cfg: PictureConfig): string {
  const alt = cfg.alt.replace(/[;{}\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  const size = PICTURE_SIZES.includes(cfg.size) ? cfg.size : 'medium';
  return `{picture: src=${cfg.src}${alt ? `; alt=${alt}` : ''}; size=${size}}`;
}
