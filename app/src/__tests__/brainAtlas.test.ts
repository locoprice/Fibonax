import { describe, expect, it } from 'vitest';
import { toAtlasBrains } from '@/features/memory/atlas/atlasData';
import { atlasScene, inPoly } from '@/features/memory/atlas/atlasGeometry';
import {
  INTRO_SECONDS,
  OPEN,
  SETTLED,
  introFrame,
  landingAt,
  launchAt,
  planetIntro,
} from '@/features/memory/atlas/atlasIntro';
import {
  ECC,
  FAR,
  MAX_BRAINS,
  PHI,
  SUN,
  layoutOrbits,
  orbitPosition,
  pickBrains,
  placeOrbits,
  spiralAngle,
  spiralRadius,
  type AtlasBrainInput,
  type Planet,
} from '@/features/memory/atlas/atlasOrbits';
import type { MemoryItem, MemorySpace } from '@/types/database';

// The Brain Atlas: Brains circle the Fibonax hub on Kepler ellipses whose far
// points lie on a golden spiral (Valentina, 2026-11-12). These pin the rules
// the picture is drawn from, so a later change cannot quietly break them.

function brain(index: number, patch: Partial<AtlasBrainInput> = {}): AtlasBrainInput {
  const day = String(index + 1).padStart(2, '0');
  return {
    id: `b${index}`,
    name: `Brain ${index}`,
    description: '',
    createdAt: `2026-01-${day}T00:00:00Z`,
    updatedAt: `2026-02-${day}T00:00:00Z`,
    itemCount: 0,
    itemNames: [],
    ...patch,
  };
}

const brains = (count: number): AtlasBrainInput[] => Array.from({ length: count }, (_, i) => brain(i));
const fromHub = (x: number, y: number): number => Math.hypot(x - SUN[0], y - SUN[1]);

/** Distance from the hub to a Brain's orbit in the direction `theta`. */
function orbitRadius(planet: Planet, theta: number): number {
  return (planet.sa * (1 - ECC * ECC)) / (1 + ECC * Math.cos(theta - planet.peri));
}

describe('the golden spiral', () => {
  it('grows by the golden ratio with each quarter turn', () => {
    for (const psi of [0.3, 1.7, 3.1, 4.4]) {
      expect(spiralRadius(psi + Math.PI / 2) / spiralRadius(psi)).toBeCloseTo(PHI, 10);
    }
  });

  it('reads back the angle it was given', () => {
    for (const radius of [11, 58, 120, 186]) {
      expect(spiralRadius(spiralAngle(radius))).toBeCloseTo(radius, 9);
    }
  });
});

describe('orbits', () => {
  it('puts the far point of every orbit on the spiral', () => {
    for (const planet of layoutOrbits(brains(8)).planets) {
      const far = fromHub(planet.fx, planet.fy);
      const psi = Math.atan2(planet.fy - SUN[1], planet.fx - SUN[0]);
      // The same direction, whichever turn of the spiral it is on.
      const turns = (spiralAngle(far) - psi) / (Math.PI * 2);
      expect(turns).toBeCloseTo(Math.round(turns), 9);
      expect(far).toBeGreaterThanOrEqual(FAR[0] - 1e-9);
      expect(far).toBeLessThanOrEqual(FAR[1] + 1e-9);
    }
  });

  it('keeps the hub at one focus of each ellipse', () => {
    for (const planet of layoutOrbits(brains(8)).planets) {
      // The other focus mirrors the hub through the centre.
      const fx = 2 * planet.cx - SUN[0];
      const fy = 2 * planet.cy - SUN[1];
      for (const seconds of [0, 3.7, 19, 140.2, 999]) {
        const at = orbitPosition(planet, seconds);
        expect(fromHub(at.x, at.y) + Math.hypot(at.x - fx, at.y - fy)).toBeCloseTo(2 * planet.sa, 6);
      }
    }
  });

  it('never carries a Brain past its far point', () => {
    const planet = layoutOrbits(brains(5)).planets[4]!;
    const far = fromHub(planet.fx, planet.fy);
    let furthest = 0;
    for (let seconds = 0; seconds < 600; seconds += 0.25) {
      const at = orbitPosition(planet, seconds);
      furthest = Math.max(furthest, fromHub(at.x, at.y));
    }
    expect(furthest).toBeLessThanOrEqual(far + 1e-6);
    expect(furthest).toBeGreaterThan(far - 0.05);
  });

  it('follows the third law: a wider orbit takes longer, by the power of three halves', () => {
    const { planets } = layoutOrbits(brains(6));
    const inner = planets[0]!;
    for (const planet of planets.slice(1)) {
      expect(inner.speed / planet.speed).toBeCloseTo((planet.sa / inner.sa) ** 1.5, 9);
    }
  });

  it('moves quickest at the near point', () => {
    const planet = layoutOrbits(brains(3)).planets[1]!;
    const lap = (Math.PI * 2) / planet.speed;
    const step = lap / 2000;
    let nearSpeed = 0;
    let nearDistance = Infinity;
    let farSpeed = 0;
    let farDistance = 0;
    for (let seconds = 0; seconds < lap; seconds += step) {
      const a = orbitPosition(planet, seconds);
      const b = orbitPosition(planet, seconds + step);
      const speed = Math.hypot(b.x - a.x, b.y - a.y);
      const distance = fromHub(a.x, a.y);
      if (distance < nearDistance) [nearDistance, nearSpeed] = [distance, speed];
      if (distance > farDistance) [farDistance, farSpeed] = [distance, speed];
    }
    expect(nearSpeed).toBeGreaterThan(farSpeed * 1.2);
  });

  it('never lets two orbits cross, from one Brain to the most that fit', () => {
    for (let count = 2; count <= MAX_BRAINS; count++) {
      const { planets } = layoutOrbits(brains(count));
      for (let i = 1; i < planets.length; i++) {
        for (let theta = 0; theta < Math.PI * 2; theta += 0.01) {
          expect(orbitRadius(planets[i]!, theta)).toBeGreaterThan(orbitRadius(planets[i - 1]!, theta) + 3);
        }
      }
    }
  });

  it('keeps every orbit inside the brain', () => {
    const { outline } = atlasScene();
    for (const planet of layoutOrbits(brains(MAX_BRAINS)).planets) {
      for (let seconds = 0; seconds < (Math.PI * 2) / planet.speed; seconds += 0.5) {
        const at = orbitPosition(planet, seconds);
        expect(inPoly(at.x, at.y, outline)).toBe(true);
      }
    }
  });

  it('gives a single Brain the middle orbit', () => {
    const planet = layoutOrbits(brains(1)).planets[0]!;
    expect(fromHub(planet.fx, planet.fy)).toBeCloseTo((FAR[0] + FAR[1]) / 2, 9);
  });
});

describe('which Brains go into orbit', () => {
  it('orders them oldest first, whatever order they arrive in', () => {
    const { planets } = layoutOrbits([brain(2), brain(0), brain(1)]);
    expect(planets.map((p) => p.id)).toEqual(['b0', 'b1', 'b2']);
    expect(planets.map((p) => p.orbit)).toEqual([0, 1, 2]);
  });

  it('keeps the ones updated last when there are more than fit, still oldest first', () => {
    const many = brains(MAX_BRAINS + 4);
    // The oldest Brain is also the one touched most recently.
    many[0] = brain(0, { updatedAt: '2026-12-31T00:00:00Z' });
    const { shown, hidden } = pickBrains(many);
    expect(hidden).toBe(4);
    expect(shown).toHaveLength(MAX_BRAINS);
    expect(shown[0]!.id).toBe('b0');
    expect(shown.map((b) => b.id)).not.toContain('b1');
    expect(shown.map((b) => b.id)).toContain(`b${MAX_BRAINS + 3}`);
    expect(layoutOrbits(many).hidden).toBe(4);
  });

  it('leaves nothing out when they all fit', () => {
    expect(pickBrains(brains(MAX_BRAINS)).hidden).toBe(0);
    expect(layoutOrbits([]).planets).toEqual([]);
  });
});

describe('items as moons', () => {
  const withItems = (count: number): Planet =>
    layoutOrbits([brain(0, { itemCount: count, itemNames: Array.from({ length: count }, (_, i) => `Item ${i}`) })])
      .planets[0]!;

  it('puts up to seven on a first ring and nine on a second, then a belt', () => {
    expect(withItems(0).moons).toHaveLength(0);
    expect(withItems(0).rings).toHaveLength(0);
    expect(withItems(5).rings).toHaveLength(1);
    expect(withItems(7).belt).toBe(0);
    expect(withItems(8).rings).toHaveLength(2);
    expect(withItems(16).moons).toHaveLength(16);
    expect(withItems(16).belt).toBe(0);
    const crowded = withItems(40);
    expect(crowded.moons).toHaveLength(16);
    expect(crowded.belt).toBeGreaterThan(crowded.rings[1]!);
    expect(crowded.reach).toBeGreaterThan(crowded.belt);
  });

  it('names each moon after its item, in the order given', () => {
    expect(withItems(3).moons.map((m) => m.name)).toEqual(['Item 0', 'Item 1', 'Item 2']);
  });

  it('shows the moons before their names arrive', () => {
    const planet = layoutOrbits([brain(0, { itemCount: 4 })]).planets[0]!;
    expect(planet.moons.map((m) => m.name)).toEqual([null, null, null, null]);
  });

  it('grows a planet with its items', () => {
    expect(withItems(9).r).toBeGreaterThan(withItems(1).r);
    expect(withItems(500).r).toBe(withItems(36).r);
  });

  it('keeps each moon on its ring around its Brain', () => {
    const layout = layoutOrbits([brain(0, { itemCount: 10 })]);
    placeOrbits(layout, 12.5, (value) => value * 2);
    const planet = layout.planets[0]!;
    for (const moon of planet.moons) {
      expect(Math.hypot(moon.x - planet.x, moon.y - planet.y)).toBeCloseTo(moon.ring * 2, 9);
    }
  });
});

describe('the Brains handed to the atlas', () => {
  const space = (id: string, patch: Partial<MemorySpace> = {}): MemorySpace => ({
    id,
    user_id: 'u',
    name: id.toUpperCase(),
    description: `About ${id}`,
    ico: '',
    is_default: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    deleted_at: null,
    ...patch,
  });
  const item = (spaceId: string, name: string, pinned = false): MemoryItem =>
    ({ id: `${spaceId}-${name}`, space_id: spaceId, name, pinned }) as MemoryItem;

  it('counts from the totals while the items are loading', () => {
    const [a, b] = toAtlasBrains([space('a'), space('b')], new Map([['a', { items: 3, tokens: 30 }]]), null);
    expect(a).toMatchObject({ id: 'a', name: 'A', description: 'About a', itemCount: 3, itemNames: [] });
    expect(b).toMatchObject({ itemCount: 0, itemNames: [] });
  });

  it('lists a Brain\'s own items, pinned first, then in the order they came', () => {
    const items = [item('a', 'newest'), item('b', 'other'), item('a', 'pinned', true), item('a', 'oldest')];
    const [a, b] = toAtlasBrains([space('a'), space('b')], new Map([['a', { items: 99, tokens: 0 }]]), items);
    expect(a!.itemNames).toEqual(['pinned', 'newest', 'oldest']);
    expect(a!.itemCount).toBe(3);
    expect(b!.itemNames).toEqual(['other']);
  });
});

describe('the scene', () => {
  it('is the same on every visit and mirrored left to right', () => {
    const scene = atlasScene();
    expect(atlasScene()).toBe(scene);
    expect(scene.meshPts.length).toBeGreaterThan(400);
    expect(scene.meshEdges.length).toBeGreaterThan(scene.meshPts.length);
    const xs = scene.head.map(([x]) => x);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(1000, 6);
  });

  it('keeps the hub inside the brain', () => {
    expect(inPoly(SUN[0], SUN[1], atlasScene().outline)).toBe(true);
  });
});

// The opening (Valentina, 2026-11-22: "a wow effect when the user surfs this
// page for the first time"): the hub lights up, a wave runs through the brain
// and the Brains fly out to their orbits.
describe('the opening', () => {
  it('starts from an empty stage', () => {
    const frame = introFrame(0);
    expect(frame.hub).toBeCloseTo(0, 9);
    expect(frame.wave).toBe(0);
    expect(frame.spiral).toBe(0);
    expect(frame.head).toBe(0);
    expect(frame.camera).toBeGreaterThan(1);
    const step = planetIntro(0, 0, 8);
    expect(step.flight).toBeCloseTo(0, 9);
    expect(step.grow).toBe(0);
    expect(step.settle).toBe(0);
  });

  it('has every Brain in place by the end, for 1 to 13 Brains', () => {
    for (let count = 1; count <= MAX_BRAINS; count++) {
      for (let index = 0; index < count; index++) {
        const step = planetIntro(INTRO_SECONDS, index, count);
        expect(step.flight).toBeCloseTo(1, 9);
        expect(step.grow).toBe(1);
        expect(step.orbit).toBe(1);
        expect(step.ripple).toBe(0);
        expect(step.moons).toBeCloseTo(1, 9);
        expect(step.settle).toBe(1);
        expect(landingAt(index, count)).toBeLessThan(INTRO_SECONDS);
      }
    }
    expect(OPEN.camera).toBe(1);
    expect(OPEN.wave).toBe(1);
    expect(OPEN.spiral).toBe(1);
    expect(OPEN.head).toBe(1);
    expect(OPEN.ringAlpha).toBe(0);
    expect(OPEN.hub).toBeCloseTo(1, 9);
    expect(OPEN.flash).toBeCloseTo(0, 9);
    expect(SETTLED).toEqual({ flight: 1, grow: 1, orbit: 1, ripple: 0, moons: 1, settle: 1 });
  });

  it('sends the closest Brain out first, the others one after another', () => {
    for (const count of [2, 5, 8, 13]) {
      for (let index = 1; index < count; index++) {
        expect(launchAt(index, count)).toBeGreaterThan(launchAt(index - 1, count));
      }
    }
  });

  it('lets a Brain run a little past its orbit and settle back', () => {
    const launch = launchAt(0, 1);
    const path = Array.from({ length: 200 }, (_, i) => planetIntro(launch + (i / 199) * 1.2, 0, 1).flight);
    expect(Math.max(...path)).toBeGreaterThan(1);
    expect(Math.max(...path)).toBeLessThan(1.15);
    expect(path[path.length - 1]).toBeCloseTo(1, 9);
  });

  it('never draws anything at a negative size', () => {
    for (let t = 0; t <= INTRO_SECONDS; t += 0.01) {
      expect(introFrame(t).hub).toBeGreaterThanOrEqual(0);
      const step = planetIntro(t, 3, 8);
      expect(step.flight).toBeGreaterThanOrEqual(0);
      expect(step.moons).toBeGreaterThanOrEqual(0);
    }
  });
});
