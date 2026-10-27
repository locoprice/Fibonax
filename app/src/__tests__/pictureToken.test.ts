import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bodyItems, itemDetail, itemTitle, parsePictureToken } from '@/lib/bodyItems';
import {
  buildPictureToken,
  hasPicture,
  isPictureSrc,
  pictureFileError,
  picturePath,
  shrinksBeforeUpload,
  type PictureConfig,
} from '@/lib/pictureToken';

// Pictures in snippets: the editor's writer is a copy of the engine's, so both
// are run here, and what the editor lists must read back exactly what it wrote
// (Edit and Remove for every element, root CLAUDE.md).

interface FormulaEngine {
  resolveBody: (body: string, vals: Record<string, unknown>, opts?: { html?: boolean }) => string;
  extractFields: (body: string) => string[];
  buildPictureToken: (cfg: PictureConfig) => string;
  sbParsePicture: (rest: string) => PictureConfig;
}

const src = readFileSync(resolve(process.cwd(), '..', 'extension', 'formula-engine.js'), 'utf8');
const module_ = { exports: {} as FormulaEngine };
new Function('module', 'exports', src)(module_, module_.exports);
const engine = module_.exports;

const LOGO = 'https://eyowustlbqujaimaxggt.supabase.co/storage/v1/object/public/snippet-pictures/u1/a.png';

const CONFIGS: PictureConfig[] = [
  { src: LOGO, alt: 'Company logo', size: 'small' },
  { src: LOGO, alt: '', size: 'medium' },
  { src: LOGO, alt: 'Map; {floor 2}\nentrance', size: 'full' },
];

describe('the picture token', () => {
  it('is written the same by the editor and the engine', () => {
    for (const cfg of CONFIGS) expect(buildPictureToken(cfg)).toBe(engine.buildPictureToken(cfg));
  });

  it('reads back what the window wrote, so Edit loses nothing', () => {
    for (const cfg of CONFIGS) {
      const token = buildPictureToken(cfg);
      const read = parsePictureToken(token);
      expect(read).not.toBeNull();
      expect(buildPictureToken(read as PictureConfig)).toBe(token);
      // The engine reads the same three settings.
      expect(engine.sbParsePicture(token.slice('{picture:'.length, -1))).toEqual(read);
    }
  });

  it('offers Remove only for a token it cannot write back as it is', () => {
    expect(parsePictureToken(`{picture: src=${LOGO}; alt=Logo; size=small; border=1}`)).toBeNull();
    expect(parsePictureToken('{picture: src=http://example.com/a.png; size=small}')).toBeNull();
    expect(parsePictureToken(`{picture: src=${LOGO}; size=huge}`)).toBeNull();
    // Spacing and order do not matter.
    expect(parsePictureToken(`{picture:size=small ;  alt=Logo; src=${LOGO}}`)).toEqual({
      src: LOGO,
      alt: 'Logo',
      size: 'small',
    });
  });

  it('is listed with what it shows and its size', () => {
    const body = `Hello {formtext: name=WHO}\n${buildPictureToken(CONFIGS[0] as PictureConfig)}\n{picture: src=${LOGO}; border=1}`;
    const items = bodyItems(body).filter((i) => i.kind === 'picture');
    expect(items.map((i) => [itemTitle(i), itemDetail(i), i.cfg !== null])).toEqual([
      ['Company logo', 'Small picture', true],
      ['Picture', 'Picture', false],
    ]);
    expect(hasPicture(body)).toBe(true);
    expect(hasPicture('Hello')).toBe(false);
  });

  it('is not a field, and is left out of plain text with its line', () => {
    const body = `Hello {formtext: name=WHO}\n${buildPictureToken(CONFIGS[0] as PictureConfig)}\nBye`;
    expect(engine.extractFields(body)).toEqual(['WHO']);
    expect(engine.resolveBody(body, { WHO: 'Ana' })).toBe('Hello Ana\nBye');
    expect(engine.resolveBody(buildPictureToken(CONFIGS[1] as PictureConfig), {}, { html: true })).toBe(
      `<img src="${LOGO}" alt="" width="320" style="width:320px;max-width:100%;height:auto;border:0">`,
    );
  });
});

describe('uploading a picture', () => {
  it('takes only https addresses that cannot end the token', () => {
    expect(isPictureSrc(LOGO)).toBe(true);
    expect(isPictureSrc('http://a.co/x.png')).toBe(false);
    expect(isPictureSrc('https://a.co/x;y.png')).toBe(false);
    expect(isPictureSrc('https://a.co/x}.png')).toBe(false);
    expect(isPictureSrc('javascript:alert(1)')).toBe(false);
  });

  it('says plainly why a file cannot be used', () => {
    expect(pictureFileError({ type: 'image/png', size: 1000 })).toBe('');
    expect(pictureFileError({ type: 'image/svg+xml', size: 1000 })).toBe('Choose a PNG, JPG, GIF or WebP picture.');
    expect(pictureFileError({ type: 'image/gif', size: 0 })).toBe('That file is empty.');
    expect(pictureFileError({ type: 'image/png', size: 6 * 1024 * 1024 })).toBe('Choose a picture of 5 MB or less.');
    // A large photo is made smaller before upload, so it is taken in.
    expect(pictureFileError({ type: 'image/jpeg', size: 9 * 1024 * 1024 })).toBe('');
    expect(pictureFileError({ type: 'image/jpeg', size: 30 * 1024 * 1024 })).toBe('Choose a picture of 5 MB or less.');
  });

  it('shrinks photos only, and stores each upload in the person’s own folder', () => {
    expect(shrinksBeforeUpload('image/jpeg')).toBe(true);
    expect(shrinksBeforeUpload('image/png')).toBe(false);
    expect(shrinksBeforeUpload('image/gif')).toBe(false);
    expect(picturePath('user-1', 'image/jpeg', 'abc')).toBe('user-1/abc.jpg');
    expect(picturePath('user-1', 'image/webp', 'abc')).toBe('user-1/abc.webp');
  });
});
