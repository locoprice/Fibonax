/**
 * Names of snippets, prompts and memory items are read back as plain text
 * everywhere else: the extension picker, the popup list, the mobile rows, the
 * MCP index. Each lays the name out in a fixed-height line that a pictograph
 * breaks. Emoji and the joiners, keycaps, flags and skin tones that build them
 * are dropped as they are typed or pasted.
 *
 * A name is written in capital letters. Whatever is typed or pasted is turned
 * into capitals as it lands, in any script; digits, spaces and punctuation
 * pass through. This governs what goes into a name box, never what is already
 * saved: a name written before the rule keeps its letters until someone edits
 * it. The phone keeps its own copy of the rule (`memCleanName` in
 * `app/public/mobile/index.html`).
 */
const NAME_EMOJI =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\p{Emoji_Modifier}\u{FE0F}\u{20E3}\u{200D}]/gu;

export function sanitizeName(value: string): string {
  return value.replace(NAME_EMOJI, '').toUpperCase();
}

/** The parts of a text box the caret keeper reads and writes. */
export interface NameBox {
  value: string;
  selectionStart: number | null;
  setSelectionRange(start: number, end: number): void;
}

/**
 * The cleaned name a box holds, written back into the box with the caret left
 * where it was.
 *
 * A box whose value is replaced from the outside puts its caret at the end.
 * With capitals that would happen on every lower-case letter typed in the
 * middle of a name, and the next letter would land at the end of it. So the
 * box is rewritten here, before the editor's state changes: the caret goes
 * back to its place (counted in cleaned text, since dropping an emoji or
 * turning one letter into two moves it), and the editor then finds the box
 * already holding the value it is about to set, and leaves it alone.
 */
export function readNameInput(box: NameBox): string {
  const raw = box.value;
  const clean = sanitizeName(raw);
  if (clean !== raw) {
    const caret = sanitizeName(raw.slice(0, box.selectionStart ?? raw.length)).length;
    box.value = clean;
    box.setSelectionRange(caret, caret);
  }
  return clean;
}

/** A change or an end-of-composition event on a name box. */
interface NameBoxEvent {
  currentTarget: NameBox;
  nativeEvent: Event;
}

/**
 * The name to keep after a name box changed. Wire it to both `onChange` and
 * `onCompositionEnd`.
 *
 * While a letter is still being composed (an accent typed in two keys, a
 * keyboard that suggests words) the box is left exactly as it is: rewriting it
 * then breaks the letter in the making. The end of the composition cleans it.
 */
export function nameFromEvent(event: NameBoxEvent): string {
  const native = event.nativeEvent;
  const composing = 'isComposing' in native && native.isComposing === true;
  return composing ? event.currentTarget.value : readNameInput(event.currentTarget);
}
