import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// No sideways scrollbars, anywhere (Valentina, 2026-11-20). A box that is too
// narrow for what it holds makes it fit: set column widths, wrap or shorten
// text, fold columns away, share the width in fractions. Scrolling up and
// down stays allowed, so `overflow-y-auto` is the one scroll class a box may
// carry. `overflow-auto` and `overflow-scroll` scroll sideways too, so they
// count as sideways here. See DESIGN_SYSTEM.md, No sideways scrolling.

const SRC = resolve(__dirname, '..');
const SIDEWAYS = /(?:^|[\s'"`:])(overflow-x-auto|overflow-x-scroll|overflow-auto|overflow-scroll)(?=[\s'"`]|$)/gm;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe('no sideways scrolling on the dashboard', () => {
  it('uses no class that lets a box scroll sideways', () => {
    const found = sourceFiles(SRC).flatMap((file) =>
      Array.from(readFileSync(file, 'utf8').matchAll(SIDEWAYS), (m) => `${relative(SRC, file)}: ${m[1]}`),
    );
    expect(found).toEqual([]);
  });

  it('catches the classes it is meant to catch', () => {
    const sample = 'className="overflow-x-auto rounded" cn("overflow-auto", x) hover:overflow-scroll';
    expect(Array.from(sample.matchAll(SIDEWAYS), (m) => m[1])).toEqual([
      'overflow-x-auto',
      'overflow-auto',
      'overflow-scroll',
    ]);
    expect(Array.from('overflow-y-auto overflow-x-hidden'.matchAll(SIDEWAYS))).toEqual([]);
  });
});
