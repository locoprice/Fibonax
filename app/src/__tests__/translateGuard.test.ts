// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installTranslateGuard, isTranslateGuardInstalled } from '@/lib/translateGuard';

// The guard keeps the dashboard working while Google's page translator rewrites
// it. These tests replay what Google was seen to do to a piece of text, then
// make the three changes the screen code makes afterwards.

/**
 * What Google does to one text: a <font> goes in front of it, the translation
 * goes inside, and the text itself comes off the page.
 */
function googleTranslates(text: Text, translated: string): HTMLElement {
  const parent = text.parentNode;
  if (!parent) throw new Error('the text is not on the page');
  const outer = document.createElement('font');
  parent.insertBefore(outer, text);
  const inner = document.createElement('font');
  outer.appendChild(inner);
  inner.appendChild(document.createTextNode(translated));
  parent.removeChild(text);
  return outer;
}

let line: HTMLParagraphElement;

beforeAll(() => {
  installTranslateGuard();
});

beforeEach(() => {
  document.body.innerHTML = '';
  line = document.createElement('p');
  document.body.appendChild(line);
});

describe('translate guard', () => {
  it('is installed once', () => {
    installTranslateGuard();
    expect(isTranslateGuardInstalled()).toBe(true);
  });

  it('removes the translation when the screen removes the text it replaced', () => {
    const text = line.appendChild(document.createTextNode('This message can be hidden'));
    googleTranslates(text, 'Questo messaggio può essere nascosto');

    expect(() => line.removeChild(text)).not.toThrow();
    expect(line.textContent).toBe('');
  });

  it('places a new element in front of the translation, where the text used to be', () => {
    const first = line.appendChild(document.createTextNode('Status: '));
    const last = line.appendChild(document.createTextNode('today'));
    googleTranslates(first, 'Stato: ');
    googleTranslates(last, 'oggi');

    const badge = document.createElement('b');
    badge.textContent = 'open';
    expect(() => line.insertBefore(badge, last)).not.toThrow();
    expect(line.textContent).toBe('Stato: openoggi');
  });

  it('shows a rewritten number, not the old one', () => {
    const count = line.appendChild(document.createTextNode('3'));
    const words = line.appendChild(document.createTextNode(' snippets in this folder'));
    googleTranslates(count, '3 ');
    googleTranslates(words, 'frammenti in questa cartella');

    count.nodeValue = '4';

    // The whole sentence is back in English, ready for Google to translate
    // again as one piece.
    expect(line.textContent).toBe('4 snippets in this folder');
    expect(line.querySelector('font')).toBeNull();
    expect(count.parentNode).toBeNull();
  });

  it('keeps following a text through a second translation', () => {
    const count = line.appendChild(document.createTextNode('3'));
    googleTranslates(count, '3');
    count.nodeValue = '4';

    const copy = line.firstChild;
    expect(copy?.nodeType).toBe(3);
    googleTranslates(copy as Text, '4');
    expect(line.textContent).toBe('4');

    count.nodeValue = '5';
    expect(line.textContent).toBe('5');
    expect(() => line.removeChild(count)).not.toThrow();
    expect(line.textContent).toBe('');
  });

  it('puts a moved text back as a fresh copy, without leaving the old translation behind', () => {
    const text = line.appendChild(document.createTextNode('First reminder'));
    googleTranslates(text, 'Primo promemoria');

    const other = document.createElement('p');
    document.body.appendChild(other);
    other.appendChild(text);

    expect(line.textContent).toBe('');
    expect(other.textContent).toBe('First reminder');
    expect(text.parentNode).toBeNull();
  });

  it('still refuses a removal that was wrong before any translation', () => {
    const stray = document.createTextNode('never on this line');
    expect(() => line.removeChild(stray)).toThrow();
  });

  it('leaves text Google never touched exactly as the browser handles it', () => {
    const text = line.appendChild(document.createTextNode('Save changes'));
    text.nodeValue = 'Saved';
    expect(line.textContent).toBe('Saved');
    expect(text.parentNode).toBe(line);
    line.removeChild(text);
    expect(line.childNodes.length).toBe(0);
  });
});
