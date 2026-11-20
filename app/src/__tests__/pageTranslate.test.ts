import { describe, expect, it } from 'vitest';
import {
  SOURCE_LANGUAGE,
  isPageLanguage,
  translationCookieDomains,
  translationCookieValue,
} from '@/lib/pageTranslate';
import {
  PAGE_LANGUAGES,
  findPageLanguage,
  searchPageLanguages,
  suggestedPageLanguages,
} from '@/lib/pageTranslateLanguages';

// The language choice for the dashboard: which languages are on offer, how one
// is found, and what Google's cookie holds for it.

describe('page languages', () => {
  it('offers each language once, and never English, which is the dashboard itself', () => {
    const codes = PAGE_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).not.toContain(SOURCE_LANGUAGE);
    expect(codes.length).toBeGreaterThan(200);
  });

  it('gives every language a name in English and in its own words', () => {
    for (const language of PAGE_LANGUAGES) {
      expect(language.name.trim()).not.toBe('');
      expect(language.native.trim()).not.toBe('');
    }
    expect(findPageLanguage('it')).toEqual({ code: 'it', name: 'Italian', native: 'Italiano' });
  });

  it('finds a language by its English name, its own name, without accents, or its code', () => {
    const codes = (query: string) => searchPageLanguages(query).map((l) => l.code);
    expect(codes('ital')).toContain('it');
    expect(codes('espanol')).toContain('es');
    expect(codes('Deutsch')).toContain('de');
    expect(codes('zh-tw')).toEqual(['zh-TW']);
    expect(codes('')).toHaveLength(PAGE_LANGUAGES.length);
    expect(codes('no such language')).toEqual([]);
  });

  it("suggests the browser's languages, reading it-IT as Italian", () => {
    const codes = suggestedPageLanguages(['it-IT', 'it', 'en-US', 'es-ES', 'zh-TW', 'xx']).map((l) => l.code);
    expect(codes).toEqual(['it', 'es', 'zh-TW']);
  });
});

describe('page translation', () => {
  it('accepts English and every language on offer, and nothing else', () => {
    expect(isPageLanguage('en')).toBe(true);
    expect(isPageLanguage('it')).toBe(true);
    expect(isPageLanguage('zh-CN')).toBe(true);
    expect(isPageLanguage('klingon')).toBe(false);
    expect(isPageLanguage('')).toBe(false);
  });

  it('writes the cookie the way Google reads it', () => {
    expect(translationCookieValue('it')).toBe('/en/it');
    expect(translationCookieValue('zh-CN')).toBe('/en/zh-CN');
  });

  it('clears the cookie on the address and on the site above it', () => {
    expect(translationCookieDomains('app.fibonax.com')).toEqual([
      '',
      'app.fibonax.com',
      '.app.fibonax.com',
      'fibonax.com',
      '.fibonax.com',
    ]);
    expect(translationCookieDomains('localhost')).toEqual(['', 'localhost', '.localhost']);
    expect(translationCookieDomains('127.0.0.1')).toEqual(['', '127.0.0.1', '.127.0.0.1']);
  });
});
