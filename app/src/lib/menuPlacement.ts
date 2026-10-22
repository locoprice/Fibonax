// Where a dropdown menu goes so the screen never cuts it off.
//
// A menu opened from a button near the bottom of a panel used to run straight
// off the bottom of the screen, with its last options out of reach. This works
// out the side with room, and caps the height to that room so a long list
// scrolls inside the menu instead.

export interface MenuPlacement {
  /** Distance from the top of the screen to the top of the menu. */
  top: number;
  /** The tallest the menu may be here. A longer list scrolls inside it. */
  maxHeight: number;
  /** True when the menu opens above its button. */
  up: boolean;
}

interface PlaceMenuInput {
  triggerTop: number;
  triggerBottom: number;
  /** The menu's full height with every option showing. */
  contentHeight: number;
  viewportHeight: number;
  /** Space between the button and the menu. */
  gap?: number;
  /** Space kept between the menu and the screen edge. */
  margin?: number;
  /** The tallest a menu is ever allowed to be, however much room there is. */
  maxHeight?: number;
  /** The shortest a menu is squeezed to before it stops shrinking. */
  minHeight?: number;
}

export function placeMenu({
  triggerTop,
  triggerBottom,
  contentHeight,
  viewportHeight,
  gap = 4,
  margin = 8,
  maxHeight = 288,
  minHeight = 96,
}: PlaceMenuInput): MenuPlacement {
  const roomBelow = viewportHeight - triggerBottom - gap - margin;
  const roomAbove = triggerTop - gap - margin;
  const wanted = Math.min(contentHeight, maxHeight);

  // Below is the default. Above wins only when the menu does not fit below and
  // there is more room above.
  const up = wanted > roomBelow && roomAbove > roomBelow;
  const room = up ? roomAbove : roomBelow;
  const cap = Math.max(minHeight, Math.min(maxHeight, room));
  const height = Math.min(contentHeight, cap);

  const idealTop = up ? triggerTop - gap - height : triggerBottom + gap;
  // Whatever the room, the menu stays on the screen.
  const top = Math.max(margin, Math.min(idealTop, viewportHeight - margin - height));
  return { top, maxHeight: cap, up };
}
