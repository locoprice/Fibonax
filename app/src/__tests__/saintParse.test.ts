import { describe, expect, it } from 'vitest';
import {
  MAX_NAME,
  describePage,
  parseSaint,
  sourceUrl,
} from '../../../services/supabase/functions/saint-of-the-day/parseSaint';

// Santo del Giorno: the server half.
//
// saint-of-the-day reads Vatican News' page for the day and hands the footers
// a name. These tests pin the two things that must never go wrong: a line the
// page does not really say is never shown (a page that changes shape shows no
// saint), and what comes back is plain text.
//
// The pages below are written for the tests. The two marked "as Vatican News
// writes it" follow the shape of the live pages as read on 2026-10-26: the main
// page names no saint in its HTML (it fills them in with JavaScript), the page
// for one day lists them as headings after "Santo del giorno".

const page = (body: string, head = '<title>Santo del giorno - Vatican News</title>'): string =>
  `<!doctype html><html><head>${head}<script>var x = "<h2>San Falso</h2>";</script></head><body>${body}</body></html>`;

describe('sourceUrl: the page for one day', () => {
  it('builds the address from the date alone', () => {
    expect(sourceUrl('2026-10-26')).toBe('https://www.vaticannews.va/it/santo-del-giorno/10/26.html');
    expect(sourceUrl('2027-01-05')).toBe('https://www.vaticannews.va/it/santo-del-giorno/01/05.html');
  });

  it('refuses anything that is not a date', () => {
    expect(() => sourceUrl('../../evil')).toThrow();
    expect(() => sourceUrl('2026-10-26/../x')).toThrow();
    expect(() => sourceUrl('')).toThrow();
  });
});

describe('parseSaint: the pages as Vatican News writes them', () => {
  const chrome = '<header><nav><h2>Menu</h2></nav><h2>Cerca</h2></header>';

  it('reads the first saint from the page for one day', () => {
    const html = page(
      `${chrome}<main><h1 class="content__innerTitle"> Santo del giorno</h1>` +
        '<h2>San Beano, vescovo</h2><p>…</p><h2>San Cedda, vescovo</h2><h2>San Demetrio, martire</h2></main>',
      '<title>Santo del Giorno e la sua storia - Calendario dei Santi del 26 ottobre - Vatican News</title>',
    );
    expect(parseSaint(html)).toBe('San Beano');
  });

  it('reads a feast day, which names no single saint', () => {
    const html = page(
      `${chrome}<main><h1 class="content__innerTitle"> Santo del giorno</h1><h2>Ognissanti</h2><p>…</p></main>`,
      '<title>Santo del Giorno e la sua storia - Calendario dei Santi del 1 novembre - Vatican News</title>',
    );
    expect(parseSaint(html)).toBe('Ognissanti');
  });

  it('takes a feast only from right below "Santo del giorno"', () => {
    expect(parseSaint(page('<h2>Ognissanti</h2><h1>Santo del giorno</h1>'))).toBeNull();
    expect(parseSaint(page('<h1>Santo del giorno</h1><h1>Ognissanti</h1>'))).toBeNull();
    expect(parseSaint(page('<h1>Santo del giorno</h1><h2>iscriviti alla newsletter</h2>'))).toBeNull();
    expect(parseSaint(page('<h1>Santo del giorno</h1><h2>Calendario</h2>'))).toBeNull();
  });

  it('finds no saint on the main page, which fills them in later', () => {
    const html = page(
      `${chrome}<main><h1 class="content__innerTitle"> Santo del giorno</h1>` +
        '<div class="dateSelector">Data<span id="dataFilter-text"> 26 ottobre</span></div></main>',
      '<title>Santo del Giorno e la sua storia - Calendario dei Santi - Vatican News</title>',
    );
    expect(parseSaint(html)).toBeNull();
  });
});

describe('parseSaint: a name that looks like a saint', () => {
  it('takes the first saint heading after the "Santo del giorno" heading', () => {
    const html = page('<h1>Santo del giorno</h1><h2>San Francesco d&#8217;Assisi, patrono d&#8217;Italia</h2>');
    expect(parseSaint(html)).toBe('San Francesco d’Assisi');
  });

  it('reads a label, a date and a name written in one heading', () => {
    expect(parseSaint(page('<h1>Santo del giorno: San Luca, evangelista</h1>'))).toBe('San Luca');
    expect(parseSaint(page('<h2>11 ottobre - San Giovanni XXIII, papa</h2>'))).toBe('San Giovanni XXIII');
    expect(parseSaint(page('<h2>Domenica 11 ottobre 2026: Santa Maria Goretti</h2>'))).toBe('Santa Maria Goretti');
  });

  it('decodes accents and apostrophes, and drops the description after the name', () => {
    expect(parseSaint(page('<h2>Sant&apos;Agostino di Ippona, vescovo e dottore della Chiesa</h2>'))).toBe("Sant'Agostino di Ippona");
    expect(parseSaint(page('<h2>San Nicol&ograve; (di Bari)</h2>'))).toBe('San Nicolò');
  });

  it('accepts the other ways a Church calendar names someone', () => {
    expect(parseSaint(page('<h2>Beata Vergine Maria del Rosario</h2>'))).toBe('Beata Vergine Maria del Rosario');
    expect(parseSaint(page('<h2>Ss. Cirillo e Metodio, patroni d&#8217;Europa</h2>'))).toBe('Ss. Cirillo e Metodio');
    expect(parseSaint(page('<h2>Santi Pietro e Paolo - apostoli</h2>'))).toBe('Santi Pietro e Paolo');
  });

  it('strips tags inside a heading and never returns markup', () => {
    const name = parseSaint(page('<h2>San <b>Luca</b> <script>alert(1)</script></h2>'));
    expect(name).not.toBeNull();
    expect(name).not.toMatch(/[<>]/);
  });

  it('falls back to the page title when no heading names a saint', () => {
    const html = page('<h1>Santo del giorno</h1><p>testo</p>', '<title>San Giuseppe - Vatican News</title>');
    expect(parseSaint(html)).toBe('San Giuseppe');
  });
});

describe('parseSaint: anything else shows no saint', () => {
  it('ignores headings that are the page itself, not a name', () => {
    expect(parseSaint(page('<h1>Santo del giorno</h1><h2>Ultime notizie</h2><h2>Vatican News</h2>'))).toBeNull();
    expect(parseSaint(page('<h1>Il santo del giorno</h1>'))).toBeNull();
    expect(parseSaint(page('<h2>Santo di oggi</h2>'))).toBeNull();
  });

  it('ignores a saint named only in code, menus or footers', () => {
    const html = page(
      '<nav><h2>San Marino</h2></nav><h1>Santo del giorno</h1><footer><h3>Santa Sede</h3></footer>',
    );
    expect(parseSaint(html)).toBeNull();
  });

  it('refuses a line that is too long to be a name', () => {
    expect(parseSaint(page(`<h2>San ${'A'.repeat(MAX_NAME)}</h2>`, ''))).toBeNull();
  });

  it('gives nothing for empty or non-page input', () => {
    expect(parseSaint('')).toBeNull();
    expect(parseSaint('plain text, no markup')).toBeNull();
    expect(parseSaint(undefined as unknown as string)).toBeNull();
    expect(parseSaint(null as unknown as string)).toBeNull();
  });

  it('does not let an entity name reach Object.prototype', () => {
    // An unknown entity stays as written; the ";" ends the name like any other.
    expect(parseSaint(page('<h2>San &constructor; Luca</h2>'))).toBe('San &constructor');
  });
});

describe('describePage: what the log may say about a page with no saint', () => {
  it('reports the title and the first headings, cut short', () => {
    const long = 'x'.repeat(200);
    const summary = describePage(page(`<h1>Santo del giorno</h1>${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<h2>${long}${n}</h2>`).join('')}`));
    expect(summary.marker).toBe(true);
    expect(summary.title).toBe('Santo del giorno - Vatican News');
    expect(summary.headings).toHaveLength(6);
    expect(summary.headings.every((h) => h.length <= 64)).toBe(true);
  });

  it('copes with a page that is not one', () => {
    expect(describePage('')).toEqual({ title: '', marker: false, headings: [] });
  });
});
