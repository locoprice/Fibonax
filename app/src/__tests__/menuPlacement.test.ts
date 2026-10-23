import { describe, expect, it } from 'vitest';
import { placeMenu } from '@/lib/menuPlacement';

// A dropdown opened from a button low in the prompt panel must stay on screen.

const base = { viewportHeight: 700, gap: 4, margin: 8, maxHeight: 288, minHeight: 96 };

describe('placeMenu', () => {
  it('opens below the button when it fits', () => {
    const placed = placeMenu({ ...base, triggerTop: 100, triggerBottom: 132, contentHeight: 200 });
    expect(placed).toEqual({ top: 136, maxHeight: 288, up: false });
  });

  it('opens above when there is no room below and more room above', () => {
    // Button near the bottom: 668 - 700 leaves nothing below.
    const placed = placeMenu({ ...base, triggerTop: 600, triggerBottom: 632, contentHeight: 206 });
    expect(placed.up).toBe(true);
    // The menu's bottom edge sits one gap above the button.
    expect(placed.top + 206).toBe(600 - 4);
  });

  it('caps a long list to the room it has so it scrolls, and stays on screen', () => {
    // 13 folders is about 374px tall; the room above is far less.
    const placed = placeMenu({ ...base, triggerTop: 300, triggerBottom: 332, contentHeight: 374 });
    expect(placed.maxHeight).toBeLessThanOrEqual(288);
    expect(placed.top).toBeGreaterThanOrEqual(8);
    expect(placed.top + Math.min(374, placed.maxHeight)).toBeLessThanOrEqual(700 - 8);
  });

  it('never grows past the tallest allowed, however much room there is', () => {
    const placed = placeMenu({
      ...base,
      viewportHeight: 1400,
      triggerTop: 100,
      triggerBottom: 132,
      contentHeight: 900,
    });
    expect(placed.maxHeight).toBe(288);
    expect(placed.up).toBe(false);
  });

  it('keeps the menu on a very short screen', () => {
    const placed = placeMenu({ ...base, viewportHeight: 300, triggerTop: 140, triggerBottom: 172, contentHeight: 374 });
    const height = Math.min(374, placed.maxHeight);
    expect(placed.top).toBeGreaterThanOrEqual(8);
    expect(placed.top + height).toBeLessThanOrEqual(300 - 8);
  });

  it('prefers below when the menu fits there even if there is more room above', () => {
    const placed = placeMenu({ ...base, triggerTop: 450, triggerBottom: 482, contentHeight: 150 });
    expect(placed.up).toBe(false);
    expect(placed.top).toBe(486);
  });
});
