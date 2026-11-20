/**
 * Keeps the dashboard working while Google's page translator rewrites it.
 *
 * What Google does to a piece of text on the page (watched on 2026-11-16): it
 * puts a `<font>` element in front of the text, fills that element with the
 * translation, and takes the original text off the page. It never translates
 * that same piece of text again, even when it is put back.
 *
 * The screen code still holds the original, so its next change to that text
 * goes wrong in one of three ways:
 *
 *   - it removes the text, which is no longer where it left it: the browser
 *     refuses and the whole screen goes blank;
 *   - it puts something in front of the text: same refusal, same blank screen;
 *   - it rewrites the text ("3 snippets" to "4 snippets"): the change lands on
 *     a piece that is off the page, and the old number stays on screen.
 *
 * The guard remembers what stands on the page for each text Google took off,
 * and sends each of those three changes there. A rewritten text is shown
 * through a fresh copy of it, which Google sees as new and translates.
 *
 * It changes how the browser's own `insertBefore`, `removeChild`,
 * `appendChild` and text setters behave for the whole page, so it is installed
 * only once a person picks a language, never for someone reading English.
 */

/** For a text Google took off the page: what stands there in its place. */
const standIns = new WeakMap<Text, Node>();
/** The same pairs, read from the page side. */
const originals = new WeakMap<Node, Text>();

let installed = false;

function isText(node: Node | null | undefined): node is Text {
  return node != null && node.nodeType === 3;
}

function isTranslatorElement(node: Node | null | undefined): node is Element {
  return node != null && node.nodeType === 1 && node.nodeName === 'FONT';
}

/** True for a text Google took off the page, whether or not its stand-in survives. */
function wasTranslated(node: Node | null | undefined): node is Text {
  return isText(node) && standIns.has(node);
}

/** What stands on the page for `node`, while it is still there. */
function standInFor(node: Node | null | undefined): Node | null {
  if (!isText(node)) return null;
  const standIn = standIns.get(node);
  return standIn && standIn.parentNode ? standIn : null;
}

function pair(original: Text, standIn: Node): void {
  const previous = standIns.get(original);
  if (previous) originals.delete(previous);
  standIns.set(original, standIn);
  originals.set(standIn, original);
}

function forget(original: Text): void {
  const standIn = standIns.get(original);
  if (standIn) originals.delete(standIn);
  standIns.delete(original);
}

export function isTranslateGuardInstalled(): boolean {
  return installed;
}

export function installTranslateGuard(): void {
  if (installed || typeof Node === 'undefined') return;
  installed = true;

  const proto = Node.prototype;
  const nativeInsertBefore = proto.insertBefore;
  const nativeRemoveChild = proto.removeChild;
  const nativeReplaceChild = proto.replaceChild;

  /** A stand-in beside `node` on one side, when it is one we know. */
  function neighbour(node: Node, side: 'previousSibling' | 'nextSibling'): Node | null {
    const next = node[side];
    return next && originals.has(next) ? next : null;
  }

  /**
   * Shows the stand-ins beside `node` through fresh copies of their texts.
   *
   * Google translates a sentence as one piece and moves the spaces between its
   * parts, so a part translated alone ("4" beside "frammenti") would lose its
   * space. With its neighbours fresh too, the sentence is translated whole.
   */
  function freshenBeside(node: Node): void {
    const run: Node[] = [];
    for (let n = neighbour(node, 'previousSibling'); n; n = neighbour(n, 'previousSibling')) run.push(n);
    for (let n = neighbour(node, 'nextSibling'); n; n = neighbour(n, 'nextSibling')) run.push(n);
    for (const standIn of run) freshen(standIn);
  }

  /** Swaps a stand-in for a fresh copy of its text, which Google reads as new. */
  function freshen(standIn: Node): Text | null {
    const original = originals.get(standIn);
    const parent = standIn.parentNode;
    if (!original || !parent) return null;
    const copy = original.ownerDocument.createTextNode(original.data);
    nativeReplaceChild.call(parent, copy, standIn);
    pair(original, copy);
    return copy;
  }

  /** Every placement by the screen code ends here, with a spot that is really in `parent`. */
  function place<T extends Node>(parent: Node, newNode: T, before: Node | null): T {
    // A text Google has handled goes back as a fresh copy, or it would sit
    // there in English for good.
    if (wasTranslated(newNode)) {
      const standIn = standInFor(newNode);
      if (standIn?.parentNode) nativeRemoveChild.call(standIn.parentNode, standIn);
      const copy = newNode.ownerDocument.createTextNode(newNode.data);
      nativeInsertBefore.call(parent, copy, before === standIn ? null : before);
      pair(newNode, copy);
      freshenBeside(copy);
      return newNode;
    }
    const placed = nativeInsertBefore.call(parent, newNode, before) as T;
    if (isText(newNode)) freshenBeside(newNode);
    return placed;
  }

  proto.insertBefore = function insertBefore<T extends Node>(
    this: Node,
    newNode: T,
    reference: Node | null,
  ): T {
    // Google, about to take `reference` off the page. A fresh copy passes its
    // place on to the translation, under the text it was made from.
    if (isTranslatorElement(newNode) && isText(reference) && reference.parentNode === this) {
      pair(originals.get(reference) ?? reference, newNode);
      return nativeInsertBefore.call(this, newNode, reference) as T;
    }

    if (reference && reference.parentNode !== this && wasTranslated(reference)) {
      const standIn = standInFor(reference);
      // With the stand-in gone too, the end of the parent is the one place
      // left that the browser cannot refuse.
      return place(this, newNode, standIn && standIn.parentNode === this ? standIn : null);
    }
    return place(this, newNode, reference);
  };

  proto.appendChild = function appendChild<T extends Node>(this: Node, newNode: T): T {
    return place(this, newNode, null);
  };

  proto.removeChild = function removeChild<T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this && wasTranslated(child)) {
      const standIn = standInFor(child);
      if (standIn?.parentNode) nativeRemoveChild.call(standIn.parentNode, standIn);
      forget(child);
      return child;
    }
    return nativeRemoveChild.call(this, child) as T;
  };

  /** A rewritten text Google took off the page shows its new words through a fresh copy. */
  function showRewrite(node: Node): void {
    if (node.parentNode) return;
    const standIn = standInFor(node);
    if (!standIn) return;
    const copy = freshen(standIn);
    if (copy) freshenBeside(copy);
  }

  function guardTextSetter(target: object, property: 'nodeValue' | 'data'): void {
    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    const nativeSet = descriptor?.set;
    if (!descriptor || !nativeSet) return;
    Object.defineProperty(target, property, {
      ...descriptor,
      set(this: Node, value: string | null) {
        nativeSet.call(this, value);
        showRewrite(this);
      },
    });
  }

  guardTextSetter(proto, 'nodeValue');
  if (typeof CharacterData !== 'undefined') guardTextSetter(CharacterData.prototype, 'data');
}
