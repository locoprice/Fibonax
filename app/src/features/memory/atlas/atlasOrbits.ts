import type { Pt } from '@/features/memory/atlas/atlasGeometry';

// Where the Brains sit in the Brain Atlas, and where each one is at a moment.
//
// The Fibonax hub is the sun. Every Brain circles it on a Kepler ellipse with
// the hub at one focus, quicker when it passes close. The far point of every
// orbit lies on a golden spiral that leaves the hub and grows by the golden
// ratio with each quarter turn, so the orbits turn and widen along it the way
// the arms of a spiral galaxy do. The first Brain made keeps the closest orbit.
//
// Pure numbers, no drawing: `src/__tests__/brainAtlas.test.ts` pins the rules.

export const SUN: Pt = [500, 420];
export const PHI = (1 + Math.sqrt(5)) / 2;
/** Far points of the innermost and the outermost orbit, from the hub. */
export const FAR: [number, number] = [58, 186];
export const ECC = 0.16;
/** Seconds the innermost Brain takes for one lap. */
const INNER_LAP = 32;
/** Brains in orbit at once (a Fibonacci number). More than this and neighbours touch. */
export const MAX_BRAINS = 13;
/** Moons on the first ring and on the second. A Brain with more items wears a belt for the rest. */
const MOONS: [number, number] = [7, 9];

/** How far the spiral is from the hub at the angle `psi`. */
export function spiralRadius(psi: number): number {
  return FAR[1] * PHI ** ((psi - Math.PI * 1.5) / (Math.PI / 2));
}

/** The angle at which the spiral is `radius` away from the hub. */
export function spiralAngle(radius: number): number {
  return Math.PI * 1.5 + ((Math.PI / 2) * Math.log(radius / FAR[1])) / Math.log(PHI);
}

export function spiralPoint(psi: number, outward = 0): Pt {
  const r = spiralRadius(psi) + outward;
  return [SUN[0] + r * Math.cos(psi), SUN[1] + r * Math.sin(psi)];
}

/** The stretch of the spiral the atlas draws, from near the hub to just past the outermost orbit. */
export const SPIRAL: Pt[] = Array.from({ length: 181 }, (_, i) => {
  const from = spiralAngle(11);
  const to = Math.PI * 1.5 + 0.12;
  return spiralPoint(from + ((to - from) * i) / 180);
});

/** The Fibonacci numbers the spiral's width follows, one at each quarter turn. */
export const QUARTERS: Array<[number, string]> = [
  [0, '8'],
  [Math.PI / 2, '13'],
  [Math.PI, '21'],
  [Math.PI * 1.5, '34'],
];

export interface AtlasBrainInput {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  /** Live items. Known from the totals before the names arrive. */
  itemCount: number;
  /** Item names, pinned first, then newest. Empty until they load. */
  itemNames: string[];
}

export interface Moon {
  /** Null while the names are still loading. */
  name: string | null;
  ring: number;
  /** Turns per second around its Brain; the second ring runs the other way. */
  turn: number;
  phase: number;
  x: number;
  y: number;
}

export interface Planet extends AtlasBrainInput {
  /** 0 for the closest orbit. */
  orbit: number;
  /** Semi-major and semi-minor axis of the ellipse. */
  sa: number;
  sb: number;
  /** Direction of the near point, from the hub. */
  peri: number;
  /** Mean motion, radians per second. */
  speed: number;
  /** Where on its orbit the Brain starts. */
  m0: number;
  /** Centre of the ellipse. */
  cx: number;
  cy: number;
  /** The far point, on the golden spiral. */
  fx: number;
  fy: number;
  r: number;
  /** Radius of everything that belongs to the Brain: planet, rings and belt. */
  reach: number;
  rings: number[];
  belt: number;
  moons: Moon[];
  x: number;
  y: number;
  /** Eccentric anomaly at the current moment, for the trail behind the Brain. */
  anomaly: number;
}

export interface OrbitLayout {
  planets: Planet[];
  /** Planets and moons shrink by this when the orbits are many. */
  fit: number;
  /** Brains left out because only `MAX_BRAINS` fit. */
  hidden: number;
}

/**
 * The Brains that go into orbit, oldest first. When there are more than fit,
 * the ones updated last are kept: they are the ones in use.
 */
export function pickBrains(
  inputs: readonly AtlasBrainInput[],
  max = MAX_BRAINS,
): { shown: AtlasBrainInput[]; hidden: number } {
  const kept =
    inputs.length > max
      ? [...inputs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, max)
      : [...inputs];
  kept.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return { shown: kept, hidden: inputs.length - kept.length };
}

export function layoutOrbits(inputs: readonly AtlasBrainInput[]): OrbitLayout {
  const { shown, hidden } = pickBrains(inputs);
  const n = shown.length;
  const fit = Math.min(1, Math.max(0.72, 1 - 0.07 * (n - 6)));
  const planets = shown.map((brain, i): Planet => {
    // Far points step out evenly from the innermost orbit to the outermost.
    // The spiral says how far round each one sits.
    const far = FAR[0] + (FAR[1] - FAR[0]) * (n > 1 ? i / (n - 1) : 0.5);
    const psi = spiralAngle(far);
    const sa = far / (1 + ECC);
    const count = Math.max(0, brain.itemCount);
    const r = 5 + 1.15 * Math.sqrt(Math.min(count, 36));
    const first = Math.min(count, MOONS[0]);
    const second = Math.min(count - first, MOONS[1]);
    const rings = second ? [r + 8.5, r + 15] : first ? [r + 8.5] : [];
    const belt = count > first + second ? r + (second ? 21 : 15) : 0;
    const moons = Array.from({ length: first + second }, (_, k): Moon => {
      const inner = k < first;
      const onRing = inner ? first : second;
      const index = inner ? k : k - first;
      return {
        name: brain.itemNames[k] ?? null,
        ring: (inner ? rings[0] : rings[1]) ?? r,
        turn: inner ? 0.5 : -0.3,
        phase: (index / onRing) * Math.PI * 2 + i,
        x: 0,
        y: 0,
      };
    });
    return {
      ...brain,
      orbit: i,
      sa,
      sb: sa * Math.sqrt(1 - ECC * ECC),
      peri: psi + Math.PI,
      // Kepler's third law: the lap time grows with the size of the orbit to the power of three halves.
      speed: ((Math.PI * 2) / INNER_LAP) * (FAR[0] / far) ** 1.5,
      m0: 0.6 + i * 2.39996,
      cx: SUN[0] + sa * ECC * Math.cos(psi),
      cy: SUN[1] + sa * ECC * Math.sin(psi),
      fx: SUN[0] + far * Math.cos(psi),
      fy: SUN[1] + far * Math.sin(psi),
      r,
      reach: (belt || rings[rings.length - 1] || r) + 3,
      rings,
      belt,
      moons,
      x: 0,
      y: 0,
      anomaly: 0,
    };
  });
  return { planets, fit, hidden };
}

/**
 * Where a Brain is `seconds` into the animation. Kepler's equation, solved by
 * Newton's method: equal areas in equal times, so a Brain is quickest at its
 * near point. Brains run counter-clockwise, as the planets do seen from above.
 */
export function orbitPosition(planet: Planet, seconds: number): { x: number; y: number; anomaly: number } {
  const mean = planet.m0 + planet.speed * seconds;
  let anomaly = mean;
  for (let i = 0; i < 6; i++) {
    anomaly -= (anomaly - ECC * Math.sin(anomaly) - mean) / (1 - ECC * Math.cos(anomaly));
  }
  const along = planet.sa * (Math.cos(anomaly) - ECC);
  const across = -planet.sb * Math.sin(anomaly);
  const cos = Math.cos(planet.peri);
  const sin = Math.sin(planet.peri);
  return { x: SUN[0] + along * cos - across * sin, y: SUN[1] + along * sin + across * cos, anomaly };
}

/** Moves every Brain and moon to its place at `seconds`. `size` scales a moon ring as it is drawn. */
export function placeOrbits(layout: OrbitLayout, seconds: number, size: (value: number) => number): void {
  for (const planet of layout.planets) {
    const at = orbitPosition(planet, seconds);
    planet.x = at.x;
    planet.y = at.y;
    planet.anomaly = at.anomaly;
    for (const moon of planet.moons) {
      const angle = moon.phase + moon.turn * seconds;
      const ring = size(moon.ring);
      moon.x = planet.x + ring * Math.cos(angle);
      moon.y = planet.y + ring * Math.sin(angle);
    }
  }
}
