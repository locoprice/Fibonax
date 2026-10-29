// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  chipTokens,
  cleanLayout,
  fragmentFromPlain,
  isEmailLayout,
  labelBefore,
  layoutSummary,
  layoutToPlain,
  numberFromSample,
  plainOffsetAt,
  plainSegments,
  pointAt,
  serializeLayout,
} from '@/lib/emailLayout';

// An email layout as a snippet body: what the cleaner lets in, how the plain
// body reads off it, and how the box maps between the two.

const CARD =
  '<table style="width:600px"><tbody>' +
  '<tr><td style="color:#555">Customer</td><td><b>Mario Rossi</b></td></tr>' +
  '<tr><td>Start</td><td>Fri, 03-04-2026</td></tr>' +
  '<tr><td>Total</td><td><div>€326.00</div><div>paid</div></td></tr>' +
  '</tbody></table>';

function chip(raw: string): Element {
  const el = document.createElement('span');
  el.setAttribute('data-token', raw);
  el.textContent = 'chip';
  return el;
}

function tree(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('cleanLayout', () => {
  it('keeps the table, its inline styles and https pictures', () => {
    const html = cleanLayout(CARD + '<img src="https://example.com/logo.png" width="120" alt="Logo">');
    expect(html).toContain('<table style="width:600px">');
    expect(html).toContain('<td style="color:#555">Customer</td>');
    expect(html).toContain('<img src="https://example.com/logo.png" width="120" alt="Logo">');
  });

  it('drops everything that could run, and comments', () => {
    const html = cleanLayout(
      '<!-- note --><div onclick="x()" class="a" id="b">Hi<script>alert(1)</script></div>' +
        '<style>p{color:red}</style><iframe src="https://x"></iframe>' +
        '<a href="javascript:alert(1)">link</a><img src="http://example.com/a.png">' +
        '<img src="data:image/png;base64,AAAA">',
    );
    expect(html).toBe('<div>Hi</div><a>link</a>');
  });

  it('collapses the markup\'s own spacing but keeps the spaces inside text', () => {
    const html = cleanLayout('<table>\n  <tr>\n    <td> Customer </td>\n    <td>Mario <b>Rossi</b> here</td>\n  </tr>\n</table>');
    expect(html).toBe('<table><tbody><tr><td>Customer</td><td>Mario <b>Rossi</b> here</td></tr></tbody></table>');
  });
});

describe('isEmailLayout', () => {
  it('is false for what the bar writes, pictures included', () => {
    expect(isEmailLayout('<div>Hello <b>you</b></div><ul><li>one</li></ul>')).toBe(false);
    expect(isEmailLayout('<div><img src="https://x/y.png" width="320" alt=""></div>')).toBe(false);
    expect(isEmailLayout(null)).toBe(false);
    expect(isEmailLayout('')).toBe(false);
  });

  it('is true for a table, or a styled line', () => {
    expect(isEmailLayout(CARD)).toBe(true);
    expect(isEmailLayout('<div style="color:red">Hi</div>')).toBe(true);
    expect(isEmailLayout('<p><span style="font-weight:bold">Hi</span></p>')).toBe(true);
  });
});

describe('layoutToPlain', () => {
  it('reads one line per row, the cells side by side, and a cell with lines of its own keeps them', () => {
    expect(layoutToPlain(CARD)).toBe('Customer Mario Rossi\nStart Fri, 03-04-2026\nTotal\n€326.00\npaid');
  });

  it('reads the rows of a table nested in a cell as lines', () => {
    expect(layoutToPlain('<table><tr><td align="center"><div>Title</div><table><tr><td>A</td><td>1</td></tr><tr><td>B</td><td>2</td></tr></table></td></tr></table>')).toBe(
      'Title\nA 1\nB 2',
    );
  });

  it('breaks lines on <br> and keeps an empty line held open by one', () => {
    expect(layoutToPlain('<div>Dear {formtext: name=WHO},</div><div><br></div><div>line one<br>line two</div>')).toBe(
      'Dear {formtext: name=WHO},\n\nline one\nline two',
    );
  });

  it('prefixes list lines like the bar, and leaves pictures out', () => {
    expect(layoutToPlain('<p>Bring:</p><ul><li>a hat</li><li>water</li></ul><ol><li>first</li><li>second</li></ol><img src="https://x/y.png">')).toBe(
      'Bring:\n• a hat\n• water\n1. first\n2. second',
    );
  });

  it('reads a chip as its code', () => {
    const root = tree('<div>Hi <span data-token="{formtext: name=WHO}">WHO</span>!</div>');
    expect(plainSegments(root).text).toBe('Hi {formtext: name=WHO}!');
  });

  it('counts what a layout holds', () => {
    expect(layoutSummary(CARD + '<img src="https://x/a.png"><table><tr><td>x</td></tr></table>')).toEqual({ tables: 2, pictures: 1 });
  });
});

describe('plain offsets and DOM points', () => {
  it('maps every character of the plain body back to its node and forth again', () => {
    const root = tree('<table><tr><td>Customer</td><td>Mario <b>Rossi</b></td></tr><tr><td>Note</td><td>Hi <span data-token="{X}">X</span> there</td></tr></table>');
    const { text, spans } = plainSegments(root);
    expect(text).toBe('Customer Mario Rossi\nNote Hi {X} there');
    for (let i = 0; i <= text.length; i++) {
      const p = pointAt(spans, root, i);
      const back = plainOffsetAt(spans, p.node, p.offset);
      // A character inside a separator (the space between cells, the line
      // break) or inside a chip has no place of its own in the box: it comes
      // back as the nearest edge.
      const inside = spans.some((s) => i > s.start && i < s.start + s.length && s.node.nodeType === 3);
      const atEdge = spans.some((s) => i === s.start || i === s.start + s.length);
      if (inside || atEdge) expect(back).toBe(i);
    }
  });

  it('maps the point before and after a chip to the chip\'s start and end', () => {
    const root = tree('<div>Hi <span data-token="{X}">X</span> there</div>');
    const { spans } = plainSegments(root);
    const chipEl = root.querySelector('[data-token]') as Element;
    expect(plainOffsetAt(spans, root.firstChild as Node, 1)).toBe(3);
    expect(plainOffsetAt(spans, root.firstChild as Node, 2)).toBe(6);
    expect(plainOffsetAt(spans, chipEl.firstChild as Node, 1)).toBe(6);
    // Before the chip is the end of the text before it; after it is the
    // point past it in the line.
    expect(pointAt(spans, root, 3)).toEqual({ node: root.firstChild?.firstChild, offset: 3 });
    expect(pointAt(spans, root, 6)).toEqual({ node: root.firstChild, offset: 2 });
  });

  it('puts an empty box\'s point at its end', () => {
    const root = tree('');
    expect(pointAt(plainSegments(root).spans, root, 0)).toEqual({ node: root, offset: 0 });
    expect(plainOffsetAt([], root, 0)).toBe(0);
  });
});

describe('chips and saving', () => {
  it('turns codes in text into chips and writes them back as codes', () => {
    const root = tree('<table><tr><td>Hi {formtext: name=WHO}, see {{VAR}}</td></tr></table>');
    chipTokens(root, chip);
    expect(root.querySelectorAll('[data-token]').length).toBe(2);
    expect(serializeLayout(root)).toBe('<table><tbody><tr><td>Hi {formtext: name=WHO}, see {{VAR}}</td></tr></tbody></table>');
  });

  it('builds plain text as nodes, codes as chips and line breaks as <br>', () => {
    const holder = document.createElement('div');
    holder.appendChild(fragmentFromPlain(document, 'a {X}\nb', chip));
    expect(holder.innerHTML).toBe('a <span data-token="{X}">chip</span><br>b');
  });
});

describe('labelBefore', () => {
  function select(root: HTMLElement, text: string): Range {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const at = (n.textContent ?? '').indexOf(text);
      if (at !== -1) {
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, at + text.length);
        return range;
      }
    }
    throw new Error('not found: ' + text);
  }

  it('takes the words before the value in its cell, with the colon dropped', () => {
    const root = tree('<div>Total: €326.00</div>');
    expect(labelBefore(select(root, '€326.00'), root)).toBe('Total');
  });

  it('takes the cell before when the value has its own cell', () => {
    const root = tree('<table><tr><td>Start date</td><td>Fri, 03-04-2026</td></tr></table>');
    expect(labelBefore(select(root, 'Fri, 03-04-2026'), root)).toBe('Start date');
  });

  it('keeps the last four words only, and gives nothing when there is nothing before', () => {
    const root = tree('<p>one two three four five six 42</p><p>7</p>');
    expect(labelBefore(select(root, '42'), root)).toBe('three four five six');
    expect(labelBefore(select(root, '7'), root)).toBe('');
  });
});

describe('numberFromSample', () => {
  it('reads an amount and its currency', () => {
    expect(numberFromSample('€326.00')).toEqual({ value: '326.00', currency: 'EUR' });
    expect(numberFromSample('$ 1,234.50')).toEqual({ value: '1234.50', currency: 'USD' });
    expect(numberFromSample('1.234,50 £')).toEqual({ value: '1234.50', currency: 'GBP' });
    expect(numberFromSample('2')).toEqual({ value: '2', currency: null });
    expect(numberFromSample('two')).toEqual({ value: '', currency: null });
  });
});
