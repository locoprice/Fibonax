// The opening of the Brain Atlas: the hub lights up, a ring of light leaves
// it, a wave runs through the brain, the golden spiral draws itself and the
// Brains fly out to their orbits one after another, their items after them.
// Pure timing, in seconds from the moment the atlas appears, so it can be tested.

/** Everything has landed by then, with 13 Brains in orbit. */
export const INTRO_SECONDS = 3.4;

/** The first Brain leaves the hub once the wave is under way. */
const FIRST_LAUNCH = 1;
/** The Brains leave one after another, this far apart at most. */
const MAX_STAGGER = 0.14;
/** All the launches fit in this window, however many Brains there are. */
const LAUNCH_WINDOW = 1.1;
const FLIGHT = 0.9;
/** How much closer than the resting view the camera starts. */
const CAMERA_CLOSE = 0.14;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** 0 before `start`, 1 after `start + length`, straight in between. */
export const ramp = (t: number, start: number, length: number): number => clamp01((t - start) / length);

export const easeOut = (x: number): number => 1 - (1 - x) ** 3;

export const easeInOut = (x: number): number => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

/** Runs a little past the mark and settles back on it: how a Brain lands. */
export const easeOutBack = (x: number): number => {
  if (x <= 0) return 0;
  const c = 1.70158;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
};

export interface IntroFrame {
  /** The camera starts close on the hub and pulls back to the whole head. 1 is the resting view. */
  camera: number;
  /** The scanner grid. */
  grid: number;
  /** The size of the hub: from nothing, a little past full and back. */
  hub: number;
  /** The flash as the hub lights up. */
  flash: number;
  /** The ring of light leaving the hub: how far it has gone (0 to 1) and how bright it still is. */
  ringReach: number;
  ringAlpha: number;
  /** How far the wave has run through the brain, 0 to 1 of the farthest point. */
  wave: number;
  /** The glass head around the brain. */
  head: number;
  /** The share of the golden spiral drawn so far. */
  spiral: number;
}

export function introFrame(t: number): IntroFrame {
  return {
    camera: 1 + CAMERA_CLOSE * (1 - easeInOut(ramp(t, 0, 2.6))),
    grid: easeOut(ramp(t, 0, 0.9)),
    hub: easeOutBack(ramp(t, 0, 0.55)),
    flash: Math.sin(Math.PI * ramp(t, 0.05, 0.7)),
    ringReach: easeOut(ramp(t, 0.05, 1.3)),
    ringAlpha: 1 - ramp(t, 0.05, 1.3),
    wave: easeInOut(ramp(t, 0.15, 1.4)),
    head: easeOut(ramp(t, 0.6, 1)),
    spiral: easeOut(ramp(t, 0.7, 1.2)),
  };
}

/** When Brain number `index` (0 is the closest) leaves the hub. */
export function launchAt(index: number, count: number): number {
  const stagger = Math.min(MAX_STAGGER, LAUNCH_WINDOW / Math.max(1, count));
  return FIRST_LAUNCH + index * stagger;
}

/** When Brain number `index` reaches its orbit: its row in the panel appears then. */
export function landingAt(index: number, count: number): number {
  return launchAt(index, count) + FLIGHT * 0.7;
}

export interface PlanetIntro {
  /** How far along its way out, 0 at the hub and 1 on its orbit; runs a little past 1 as it lands. */
  flight: number;
  /** The planet's size. */
  grow: number;
  /** The share of its orbit drawn so far. */
  orbit: number;
  /** The ripple as it lands: 0 to 1, then gone. */
  ripple: number;
  /** Its items, flying out from it; runs a little past 1 as they land. */
  moons: number;
  /** Its name and the trail behind it, once it has settled. */
  settle: number;
}

export function planetIntro(t: number, index: number, count: number): PlanetIntro {
  const launch = launchAt(index, count);
  const ripple = ramp(t, landingAt(index, count), 0.7);
  return {
    flight: easeOutBack(ramp(t, launch, FLIGHT)),
    grow: easeOut(ramp(t, launch, 0.35)),
    orbit: easeOut(ramp(t, launch - 0.2, 1)),
    ripple: ripple > 0 && ripple < 1 ? ripple : 0,
    moons: easeOutBack(ramp(t, launch + 0.55, 0.6)),
    settle: ramp(t, launch + 0.8, 0.4),
  };
}

/** The opening once it is over: everything in place. */
export const OPEN: IntroFrame = introFrame(INTRO_SECONDS);
export const SETTLED: PlanetIntro = { flight: 1, grow: 1, orbit: 1, ripple: 0, moons: 1, settle: 1 };
