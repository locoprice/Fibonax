import { atlasScene, type MeshEdge, type Pt, type RegionKey } from '@/features/memory/atlas/atlasGeometry';
import {
  FAR,
  QUARTERS,
  SPIRAL,
  SUN,
  layoutOrbits,
  placeOrbits,
  spiralPoint,
  type AtlasBrainInput,
  type Moon,
  type OrbitLayout,
  type Planet,
} from '@/features/memory/atlas/atlasOrbits';

// Draws the Brain Atlas on a canvas and keeps it moving: the glass head, the
// neural mesh, the golden spiral, the Brains on their orbits and their items
// as moons. The screen around it (panel, buttons, tooltip) is BrainAtlas.tsx.
//
// Every colour comes from the atlas tokens in index.css, read once through
// `readAtlasPalette`. Nothing here names a colour.

/** What a pointer can land on, named by id so it survives a redraw of the orbits. */
export type AtlasTarget =
  | { type: 'hub' }
  | { type: 'brain'; id: string }
  | { type: 'item'; brainId: string; index: number };

export interface AtlasHit {
  target: AtlasTarget;
  /** Where the thing is, in pixels from the canvas corner: the tooltip sits there. */
  x: number;
  y: number;
}

/** The atlas tokens, each as "r, g, b". */
export interface AtlasPalette {
  ground: string;
  glow: string;
  spark: string;
  mesh: string;
  fibre: string;
  gold: string;
  goldLight: string;
  muted: string;
}

export function readAtlasPalette(element: Element): AtlasPalette {
  const style = getComputedStyle(element);
  const read = (name: string): string => style.getPropertyValue(name).trim();
  return {
    ground: read('--atlas-ground'),
    glow: read('--atlas-glow'),
    spark: read('--atlas-spark'),
    mesh: read('--atlas-mesh'),
    fibre: read('--atlas-fibre'),
    gold: read('--atlas-gold'),
    goldLight: read('--atlas-gold-light'),
    muted: read('--atlas-muted'),
  };
}

export interface AtlasRenderer {
  /** Puts these Brains into orbit. The clock keeps running, so nothing jumps back to its start. */
  setBrains: (inputs: readonly AtlasBrainInput[]) => void;
  setSelected: (target: AtlasTarget | null) => void;
  setHover: (target: AtlasTarget | null) => void;
  setRunning: (on: boolean) => void;
  hitTest: (clientX: number, clientY: number) => AtlasHit | null;
  destroy: () => void;
}

type Pivot =
  | { kind: 'hub' }
  | { kind: 'brain'; planet: Planet }
  | { kind: 'item'; planet: Planet; moon: Moon };

interface Spot {
  x: number;
  y: number;
}

interface Pulse {
  from: Spot;
  to: Spot;
  t: number;
  speed: number;
}

interface Walker {
  edge: MeshEdge;
  from: number;
  to: number;
  t: number;
  speed: number;
  hops: number;
}

/** What the drawing remembers about a Brain between frames. */
interface PlanetView {
  glow: number;
  /** Which side of the planet its label sits on. */
  slot: number;
  lx: number | null;
  ly: number | null;
  /** 0 to 1: a label with no free side fades out and comes back when there is room. */
  show: number;
}

type Box = [number, number, number, number];

/** The frame closes in on the brain, with the skull and the ears around it. */
const VIEW = { x: 230, y: 128, w: 540, h: 572 };
const HUB_RADIUS = 9;
/** Brightness of the mesh by depth band: dimmer where the surface curves away. */
const BAND = [0.45, 0.65, 0.85, 1];
const GLOW_REACH = 78;
/** More Brains than this and a label is the name alone: the panel beside the picture has the counts. */
const ROOMY = 8;

const rgba = (rgb: string, alpha: number): string => `rgba(${rgb},${alpha})`;
const plural = (count: number): string => `${count} ${count === 1 ? 'item' : 'items'}`;
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const overlaps = (x0: number, y0: number, x1: number, y1: number, box: Box): boolean =>
  x0 < box[2] && x1 > box[0] && y0 < box[3] && y1 > box[1];

/** Null when the browser cannot draw on a canvas. */
export function createAtlasRenderer(
  canvas: HTMLCanvasElement,
  palette: AtlasPalette,
  fontFamily: string,
): AtlasRenderer | null {
  const main = canvas.getContext('2d');
  const layer = document.createElement('canvas');
  const layerCtx = layer.getContext('2d');
  if (!main || !layerCtx) return null;

  const scene = atlasScene();
  const { meshPts, meshEdges } = scene;
  const { ground, glow, spark, mesh, fibre, gold, goldLight, muted } = palette;
  const hub: Spot = { x: SUN[0], y: SUN[1] };

  let layout: OrbitLayout = layoutOrbits([]);
  let views: PlanetView[] = [];
  let hoverTarget: AtlasTarget | null = null;
  let selectedTarget: AtlasTarget | null = null;
  let hover: Pivot | null = null;
  let selected: Pivot | null = null;
  let running = true;
  let time = 0;
  let orbitTime = 0;
  const pulses: Pulse[] = [];
  const walkers: Walker[] = [];
  const glowLevel = new Uint8Array(meshPts.length);

  let ctx: CanvasRenderingContext2D = main;
  let dpr = 1;
  let width = 0;
  let height = 0;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let sizeK = 1;

  /** Screen pixels expressed in logical units. */
  const px = (value: number): number => value / scale;
  /** Planet and moon sizes: larger on a small stage, smaller when the orbits are many. */
  const unit = (value: number): number => value * sizeK * layout.fit;

  function resize(): void {
    const box = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = box.width;
    height = box.height;
    canvas.width = layer.width = Math.round(width * dpr);
    canvas.height = layer.height = Math.round(height * dpr);
    scale = Math.max(0.05, Math.min(width / VIEW.w, height / VIEW.h));
    offsetX = (width - VIEW.w * scale) / 2 - VIEW.x * scale;
    offsetY = (height - VIEW.h * scale) / 2 - VIEW.y * scale;
    sizeK = Math.min(1.35, Math.max(1, 0.8 / scale));
  }

  function resolve(target: AtlasTarget | null): Pivot | null {
    if (!target) return null;
    if (target.type === 'hub') return { kind: 'hub' };
    const id = target.type === 'brain' ? target.id : target.brainId;
    const planet = layout.planets.find((p) => p.id === id);
    if (!planet) return null;
    if (target.type === 'brain') return { kind: 'brain', planet };
    const moon = planet.moons[target.index];
    return moon ? { kind: 'item', planet, moon } : null;
  }

  function spawnPulse(to: Spot): void {
    pulses.push({ from: hub, to, t: 0, speed: 0.012 + Math.random() * 0.01 });
  }

  function spawnWalker(near: Spot | null): void {
    const pool = near
      ? meshEdges.filter((e) => {
          const a = meshPts[e.a]!;
          const b = meshPts[e.b]!;
          return Math.hypot((a.x + b.x) / 2 - near.x, (a.y + b.y) / 2 - near.y) < 80;
        })
      : meshEdges;
    const edge = pool[Math.floor(Math.random() * pool.length)];
    if (!edge) return;
    walkers.push({ edge, from: edge.a, to: edge.b, t: 0, speed: 1.1 + Math.random() * 0.9, hops: 3 + Math.floor(Math.random() * 5) });
  }

  function trace(poly: Pt[], close: boolean): void {
    const first = poly[0];
    if (!first) return;
    ctx.beginPath();
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i]![0], poly[i]![1]);
    if (close) ctx.closePath();
  }

  function font(size: number, weight: number): string {
    return `${weight} ${px(size)}px ${fontFamily}`;
  }

  function textWidth(text: string, size: number, weight = 500): number {
    ctx.font = font(size, weight);
    return ctx.measureText(text).width;
  }

  /** Text on a strip of the ground colour, so it reads over the mesh. */
  function label(text: string, x: number, y: number, size: number, colour: string, weight = 500, backing = 0.74): void {
    ctx.font = font(size, weight);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width;
    const h = px(size) * 1.35;
    const pad = px(4);
    ctx.fillStyle = rgba(ground, backing);
    ctx.fillRect(x - w / 2 - pad, y - h / 2, w + pad * 2, h);
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
  }

  /** `dt` moves the animation and is zero while paused; `real` is the true frame time, so labels still settle. */
  function draw(dt: number, real: number): void {
    if (width < 1 || height < 1) return;
    const pivot = hover ?? selected;
    const centre = pivot?.kind === 'brain' ? pivot.planet : null;
    const planetLit = (p: Planet): boolean => !pivot || pivot.kind === 'hub' || pivot.planet === p;
    const moonLit = (p: Planet, m: Moon): boolean =>
      !pivot || (pivot.kind === 'brain' && pivot.planet === p) || (pivot.kind === 'item' && pivot.moon === m);
    const hubLit = !pivot || pivot.kind !== 'item';
    const { planets } = layout;

    ctx = main!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Scanner-bed grid.
    ctx.strokeStyle = rgba(glow, 0.035);
    ctx.lineWidth = px(1);
    ctx.beginPath();
    for (let x = -300; x <= 1300; x += 50) {
      ctx.moveTo(x, -300);
      ctx.lineTo(x, 1300);
    }
    for (let y = -300; y <= 1300; y += 50) {
      ctx.moveTo(-300, y);
      ctx.lineTo(1300, y);
    }
    ctx.stroke();

    // Glass head: soft inner light, a wireframe skin and a hairline outline
    // with the ears. All three fade to nothing just below the brain.
    const headLight = ctx.createLinearGradient(0, 142, 0, 700);
    headLight.addColorStop(0, rgba(glow, 0.03));
    headLight.addColorStop(0.45, rgba(glow, 0.055));
    headLight.addColorStop(1, rgba(glow, 0));
    trace(scene.head, true);
    ctx.fillStyle = headLight;
    ctx.fill();
    const skin = (y: number): number =>
      (0.3 + 0.7 * Math.min(1, Math.max(0, (y - 150) / 480))) * Math.min(1, Math.max(0, (700 - y) / 90));
    ctx.lineWidth = px(0.8);
    for (const [a, b] of scene.faceEdges) {
      const A = scene.facePts[a]!;
      const B = scene.facePts[b]!;
      ctx.strokeStyle = rgba(spark, 0.09 * skin((A.y + B.y) / 2));
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }
    for (const p of scene.facePts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, px(1.1), 0, Math.PI * 2);
      ctx.fillStyle = rgba(mesh, 0.3 * skin(p.y));
      ctx.fill();
    }
    const headLine = ctx.createLinearGradient(0, 142, 0, 700);
    headLine.addColorStop(0, rgba(fibre, 0.14));
    headLine.addColorStop(0.55, rgba(fibre, 0.34));
    headLine.addColorStop(0.84, rgba(fibre, 0.42));
    headLine.addColorStop(1, rgba(fibre, 0));
    trace(scene.head, true);
    ctx.lineWidth = px(1.2);
    ctx.strokeStyle = headLine;
    ctx.stroke();
    ctx.restore();

    // The brain is drawn on its own layer, so the brainstem can fade out
    // without cutting a hole in the head.
    ctx = layerCtx!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Lobes: a faint fill, with the sulci as soft dark grooves under the mesh channels.
    const fillLobe = (key: RegionKey): void => {
      const region = scene.regions[key];
      trace(region.poly, true);
      ctx.fillStyle = rgba(glow, 0.04);
      ctx.fill();
      ctx.strokeStyle = rgba(ground, 0.5);
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      for (const sulcus of region.sulci) {
        trace(sulcus, false);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    };
    // Neural mesh, one stroke per lobe and depth band.
    const strokeMesh = (key: RegionKey): void => {
      ctx.lineWidth = px(0.8);
      for (let band = 0; band < 4; band++) {
        ctx.strokeStyle = rgba(glow, (pivot ? 0.11 : 0.17) * BAND[band]!);
        ctx.beginPath();
        for (const e of scene.edgesByRegion[key]) {
          if (e.band !== band) continue;
          const A = meshPts[e.a]!;
          const B = meshPts[e.b]!;
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(B.x, B.y);
        }
        ctx.stroke();
      }
    };
    // Mesh nodes, with a slow shimmer.
    const dotMesh = (key: RegionKey): void => {
      const base = pivot ? 0.42 : 0.6;
      const r = px(key === 'cb' ? 1.1 : 1.4);
      for (let band = 0; band < 4; band++) {
        ctx.fillStyle = rgba(mesh, base * BAND[band]!);
        ctx.beginPath();
        for (const p of scene.ptsByRegion[key]) {
          if (p.band !== band) continue;
          ctx.moveTo(p.x + r, p.y);
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      ctx.fillStyle = rgba(glow, base * 0.35);
      ctx.beginPath();
      for (const p of scene.ptsByRegion[key]) {
        if (Math.sin(time * 1.3 + p.pulse) > 0.96) {
          ctx.moveTo(p.x + r * 2.6, p.y);
          ctx.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    };
    // Where a Brain passes, the tissue around it lights up: four brightness
    // levels, strongest right under the planet.
    planets.forEach((p, i) => {
      views[i]!.glow = !pivot ? 0.9 : p === centre ? 1.3 : planetLit(p) ? 0.8 : 0.2;
    });
    for (let i = 0; i < meshPts.length; i++) {
      const p = meshPts[i]!;
      let level = 0;
      for (let k = 0; k < planets.length; k++) {
        const planet = planets[k]!;
        const d = Math.hypot(p.x - planet.x, p.y - planet.y);
        if (d < GLOW_REACH) {
          const f = 1 - d / GLOW_REACH;
          const w = f * f * views[k]!.glow;
          if (w > level) level = w;
        }
      }
      glowLevel[i] = Math.max(0, Math.min(4, Math.ceil(level * 4 - 0.2)));
    }
    const glowMesh = (stem: boolean): void => {
      for (let level = 1; level <= 4; level++) {
        ctx.strokeStyle = rgba(spark, 0.12 * level);
        ctx.lineWidth = px(1);
        ctx.beginPath();
        for (const e of meshEdges) {
          if ((e.region === 'stem') !== stem || Math.ceil((glowLevel[e.a]! + glowLevel[e.b]!) / 2) !== level) continue;
          const A = meshPts[e.a]!;
          const B = meshPts[e.b]!;
          ctx.moveTo(A.x, A.y);
          ctx.lineTo(B.x, B.y);
        }
        ctx.stroke();
        const r = px(1.4 + level * 0.18);
        ctx.fillStyle = rgba(mesh, 0.22 * level);
        ctx.beginPath();
        for (let i = 0; i < meshPts.length; i++) {
          const p = meshPts[i]!;
          if ((p.region === 'stem') !== stem || glowLevel[i] !== level) continue;
          ctx.moveTo(p.x + r, p.y);
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    };

    // Cerebrum and cerebellum first, under one silhouette: a soft glow and a hairline.
    for (const key of scene.body) fillLobe(key);
    ctx.save();
    trace(scene.outline, true);
    ctx.clip();
    planets.forEach((p, i) => {
      const reach = 92;
      const light = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, reach);
      light.addColorStop(0, rgba(glow, 0.12 * views[i]!.glow));
      light.addColorStop(1, rgba(glow, 0));
      ctx.fillStyle = light;
      ctx.fillRect(p.x - reach, p.y - reach, reach * 2, reach * 2);
    });
    ctx.restore();
    const silhouette = (): void => {
      trace(scene.outline, true);
      ctx.stroke();
    };
    ctx.strokeStyle = rgba(glow, 0.07);
    ctx.lineWidth = px(7);
    silhouette();
    ctx.strokeStyle = rgba(spark, 0.38);
    ctx.lineWidth = px(1);
    silhouette();
    for (const key of scene.body) strokeMesh(key);
    for (const key of scene.body) dotMesh(key);
    glowMesh(false);

    // The brainstem sits in front of the cerebellum: clear its footprint, then draw it on top.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    trace(scene.stemHalo, true);
    ctx.fillStyle = rgba(ground, 1);
    ctx.fill();
    ctx.restore();
    fillLobe('stem');
    const stemSides = (): void => {
      for (const side of scene.stemSides) {
        trace(side, false);
        ctx.stroke();
      }
    };
    ctx.strokeStyle = rgba(glow, 0.07);
    ctx.lineWidth = px(7);
    stemSides();
    ctx.strokeStyle = rgba(spark, 0.38);
    ctx.lineWidth = px(1);
    stemSides();
    strokeMesh('stem');
    dotMesh('stem');
    glowMesh(true);

    // Firing: bright packets wandering along the mesh.
    for (let i = walkers.length - 1; i >= 0; i--) {
      const w = walkers[i]!;
      w.t += w.speed * dt;
      let done = false;
      while (w.t >= 1) {
        w.hops -= 1;
        const options = scene.adjacency[w.to]!.filter((j) => meshEdges[j] !== w.edge);
        const next = meshEdges[options[Math.floor(Math.random() * options.length)] ?? -1];
        if (w.hops <= 0 || !next) {
          done = true;
          break;
        }
        w.edge = next;
        w.from = w.to;
        w.to = next.a === w.from ? next.b : next.a;
        w.t -= 1;
      }
      if (done) {
        walkers.splice(i, 1);
        continue;
      }
      const A = meshPts[w.from]!;
      const B = meshPts[w.to]!;
      const tail = Math.max(0, w.t - 0.6);
      const x = A.x + (B.x - A.x) * w.t;
      const y = A.y + (B.y - A.y) * w.t;
      const x0 = A.x + (B.x - A.x) * tail;
      const y0 = A.y + (B.y - A.y) * tail;
      const streak = ctx.createLinearGradient(x0, y0, x, y);
      streak.addColorStop(0, rgba(glow, 0));
      streak.addColorStop(1, rgba(spark, 0.9));
      ctx.strokeStyle = streak;
      ctx.lineWidth = px(1.4);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, px(1.8), 0, Math.PI * 2);
      ctx.fillStyle = rgba(mesh, 0.95);
      ctx.fill();
    }

    // The stem fades out at its foot: erased progressively, inside its own footprint only.
    const stemFade = ctx.createLinearGradient(0, 592, 0, 660);
    stemFade.addColorStop(0, rgba(ground, 0));
    stemFade.addColorStop(1, rgba(ground, 1));
    ctx.save();
    trace(scene.stemHalo, true);
    ctx.clip();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = stemFade;
    ctx.fillRect(440, 592, 120, 80);
    ctx.restore();

    // The golden spiral, under everything that moves: a soft glow and a line
    // that brightens as it leaves the hub.
    const fade = pivot ? 0.45 : 1;
    trace(SPIRAL, false);
    ctx.strokeStyle = rgba(goldLight, 0.07 * fade);
    ctx.lineWidth = px(6);
    ctx.stroke();
    const spiralLine = ctx.createRadialGradient(SUN[0], SUN[1], 10, SUN[0], SUN[1], FAR[1]);
    spiralLine.addColorStop(0, rgba(goldLight, 0.34 * fade));
    spiralLine.addColorStop(1, rgba(goldLight, 0.88 * fade));
    ctx.strokeStyle = spiralLine;
    ctx.lineWidth = px(1.6);
    ctx.stroke();
    const small = scale < 0.75;
    // The Fibonacci numbers its width follows, one at each quarter turn. Left out on a small stage.
    if (!small) {
      ctx.font = font(10, 500);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = rgba(goldLight, 0.62 * fade);
      for (const [psi, text] of QUARTERS) {
        const [x, y] = spiralPoint(psi, px(12));
        ctx.fillText(text, x, y);
      }
    }

    // Orbits: one ellipse per Brain with the hub at a focus, a mark where it
    // meets the spiral, and behind each Brain the stretch it has just travelled.
    for (const p of planets) {
      const lit = p === centre || pivot?.kind === 'hub';
      const dim = pivot !== null && !planetLit(p);
      ctx.beginPath();
      ctx.ellipse(p.cx, p.cy, p.sa, p.sb, p.peri, 0, Math.PI * 2);
      ctx.lineWidth = px(lit ? 1.4 : 1);
      ctx.strokeStyle = rgba(gold, lit ? 0.7 : dim ? 0.06 : 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.fx, p.fy, px(lit ? 3 : 2.2), 0, Math.PI * 2);
      ctx.fillStyle = rgba(goldLight, dim ? 0.15 : 0.95);
      ctx.fill();
      if (dim) continue;
      const span = 72 / ((p.sa + p.sb) / 2);
      ctx.lineWidth = px(2);
      for (let k = 0; k < 12; k++) {
        ctx.beginPath();
        ctx.ellipse(p.cx, p.cy, p.sa, p.sb, p.peri, -p.anomaly + (span * k) / 12, -p.anomaly + (span * (k + 1)) / 12 + 0.004);
        ctx.strokeStyle = rgba(goldLight, 0.8 * (1 - k / 12));
        ctx.stroke();
      }
    }
    // The link to the hub, drawn for the Brains in play.
    for (const p of planets) {
      const lit = p === centre || pivot?.kind === 'hub' || (pivot?.kind === 'item' && pivot.planet === p);
      if (!lit) continue;
      ctx.beginPath();
      ctx.moveTo(hub.x, hub.y);
      ctx.lineTo(p.x, p.y);
      ctx.lineWidth = px(1.6);
      ctx.strokeStyle = rgba(gold, 0.8);
      ctx.stroke();
    }
    // Gold packets travelling from the hub out to a Brain.
    for (let i = pulses.length - 1; i >= 0; i--) {
      const pulse = pulses[i]!;
      pulse.t += pulse.speed * dt * 60;
      if (pulse.t >= 1) {
        pulses.splice(i, 1);
        continue;
      }
      const x = pulse.from.x + (pulse.to.x - pulse.from.x) * pulse.t;
      const y = pulse.from.y + (pulse.to.y - pulse.from.y) * pulse.t;
      ctx.beginPath();
      ctx.arc(x, y, px(2.2), 0, Math.PI * 2);
      ctx.fillStyle = rgba(gold, 1);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, px(6), 0, Math.PI * 2);
      ctx.fillStyle = rgba(gold, 0.18);
      ctx.fill();
    }

    // The hub: the sun every Brain circles.
    const hubAlpha = hubLit ? 1 : 0.3;
    const hubR = unit(HUB_RADIUS) + (pivot?.kind === 'hub' ? px(2.5) : 0);
    const corona = ctx.createRadialGradient(hub.x, hub.y, hubR, hub.x, hub.y, hubR * 5);
    corona.addColorStop(0, rgba(fibre, 0.45 * hubAlpha));
    corona.addColorStop(1, rgba(fibre, 0));
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, hubR * 5, 0, Math.PI * 2);
    ctx.fillStyle = corona;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, hubR + px(7) + Math.sin(time * 1.6) * px(1.5), 0, Math.PI * 2);
    ctx.strokeStyle = rgba(fibre, 0.4 * hubAlpha);
    ctx.lineWidth = px(1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, hubR + px(1.6), 0, Math.PI * 2);
    ctx.fillStyle = rgba(ground, 0.9 * hubAlpha);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, hubR, 0, Math.PI * 2);
    ctx.fillStyle = rgba(fibre, hubAlpha);
    ctx.fill();
    // Its name fades out while a Brain passes over it and comes back after, so
    // the two never fight for the same spot. A small stage leaves it out.
    const nameSize = small ? 10 : 12;
    const hubLabelY = hub.y - hubR - px(16);
    const hubLabelW = textWidth('FIBONAX', nameSize + 1) + px(8);
    const hubPad = hubR + px(8);
    let room = 1;
    for (const p of planets) {
      room = Math.min(room, (Math.hypot(p.x - hub.x, p.y - hubLabelY) - unit(p.reach) - px(14)) / px(16));
    }
    if (!small && room > 0) {
      label('FIBONAX', hub.x, hubLabelY, nameSize + 1, rgba(fibre, (hubLit ? 0.95 : 0.3) * room), 500, 0.74 * room);
    }

    // Brains: planets, each with the rings its moons travel on.
    for (const p of planets) {
      const dim = pivot !== null && !planetLit(p);
      const alpha = dim ? 0.2 : 1;
      const picked = pivot?.kind === 'brain' && pivot.planet === p;
      const r = unit(p.r) + (picked ? px(2.5) : 0);
      ctx.lineWidth = px(0.7);
      ctx.strokeStyle = rgba(spark, dim ? 0.03 : p === centre ? 0.32 : 0.12);
      for (const ring of p.rings) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, unit(ring), 0, Math.PI * 2);
        ctx.stroke();
      }
      if (p.belt) {
        ctx.setLineDash([px(1.5), px(3)]);
        ctx.lineWidth = px(1.6);
        ctx.strokeStyle = rgba(spark, dim ? 0.06 : 0.45);
        ctx.beginPath();
        ctx.arc(p.x, p.y, unit(p.belt), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (!dim) {
        const halo = ctx.createRadialGradient(p.x, p.y, r, p.x, p.y, r * 4);
        halo.addColorStop(0, rgba(gold, 0.4));
        halo.addColorStop(1, rgba(gold, 0));
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2);
        ctx.fillStyle = halo;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + px(1.6), 0, Math.PI * 2);
      ctx.fillStyle = rgba(ground, 0.9 * alpha);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(gold, alpha);
      ctx.fill();
    }
    // Items: moons.
    for (const p of planets) {
      for (const moon of p.moons) {
        const alpha = moonLit(p, moon) ? 1 : 0.18;
        const picked = pivot?.kind === 'item' && pivot.moon === moon;
        const r = unit(2.1) + (picked ? px(1.8) : 0);
        ctx.beginPath();
        ctx.arc(moon.x, moon.y, r + px(1.2), 0, Math.PI * 2);
        ctx.fillStyle = rgba(ground, 0.9 * alpha);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(moon.x, moon.y, r, 0, Math.PI * 2);
        ctx.fillStyle = rgba(spark, alpha);
        ctx.fill();
      }
    }
    // Brain labels last, so nothing draws over them. A label sits under its
    // planet, and slides above or beside it when that spot is taken. With no
    // side free it fades out until there is room: labels never cover each
    // other. The Brain in play is placed first, so its name always shows.
    const taken: Box[] = [[hub.x - hubPad, hub.y - hubPad, hub.x + hubPad, hub.y + hubPad]];
    if (!small) taken.push([hub.x - hubLabelW / 2, hubLabelY - px(10), hub.x + hubLabelW / 2, hubLabelY + px(10)]);
    const nameOnly = small || planets.length > ROOMY;
    const order = planets.map((_, i) => i);
    if (pivot && pivot.kind !== 'hub') {
      const first = planets.indexOf(pivot.planet);
      order.splice(order.indexOf(first), 1);
      order.unshift(first);
    }
    for (const i of order) {
      const p = planets[i]!;
      const view = views[i]!;
      const inPlay = pivot !== null && pivot.kind !== 'hub' && pivot.planet === p;
      const dim = pivot !== null && !planetLit(p);
      const name = clip(p.name, 20).toUpperCase();
      const count = plural(p.itemCount);
      const w = Math.max(textWidth(name, nameSize), nameOnly ? 0 : textWidth(count, 10, 400)) + px(8);
      const h = px(nameOnly ? 16 : 31);
      const gap = unit(p.reach) + px(3);
      const slots: Pt[] = [
        [0, gap + h / 2],
        [0, -gap - h / 2],
        [gap + w / 2, 0],
        [-gap - w / 2, 0],
      ];
      const free = (k: number): boolean => {
        const slot = slots[k]!;
        const cx = p.x + slot[0];
        const cy = p.y + slot[1];
        const x0 = cx - w / 2;
        const y0 = cy - h / 2;
        const x1 = cx + w / 2;
        const y1 = cy + h / 2;
        for (const box of taken) if (overlaps(x0, y0, x1, y1, box)) return false;
        for (const other of planets) {
          const reach = unit(other.reach) + px(2);
          if (other !== p && overlaps(x0, y0, x1, y1, [other.x - reach, other.y - reach, other.x + reach, other.y + reach])) return false;
        }
        return true;
      };
      let room = free(view.slot);
      if (!room) {
        const k = slots.findIndex((_, index) => free(index));
        if (k >= 0) {
          view.slot = k;
          room = true;
        }
      }
      const [tx, ty] = slots[view.slot]!;
      const fresh = view.lx === null || view.ly === null;
      const ease = fresh ? 1 : Math.min(1, real * 6);
      view.lx = (view.lx ?? tx) + (tx - (view.lx ?? tx)) * ease;
      view.ly = (view.ly ?? ty) + (ty - (view.ly ?? ty)) * ease;
      const wanted = room || inPlay ? 1 : 0;
      view.show = fresh ? wanted : view.show + (wanted - view.show) * Math.min(1, real * 8);
      if (view.show < 0.02) continue;
      if (wanted) taken.push([p.x + tx - w / 2, p.y + ty - h / 2, p.x + tx + w / 2, p.y + ty + h / 2]);
      const lx = p.x + view.lx;
      const ly = p.y + view.ly;
      label(name, lx, nameOnly ? ly : ly - px(7.5), nameSize, rgba(goldLight, (dim ? 0.3 : 0.95) * view.show), 500, 0.74 * view.show);
      if (!nameOnly) label(count, lx, ly + px(8.5), 10, rgba(muted, (dim ? 0.35 : 0.9) * view.show), 400, 0.74 * view.show);
    }
    ctx.restore();

    ctx = main!;
    ctx.drawImage(layer, 0, 0, width, height);
  }

  // The frame loop: the orbits turn, the mesh fires, gold packets leave the
  // hub. Pointing at something holds the orbits still, so a Brain is easy to catch.
  let last = performance.now();
  let sincePulse = 0;
  let frameId = 0;
  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (running) {
      time += dt;
      if (!hover) orbitTime += dt;
      const pivot = hover ?? selected;
      const centre = pivot?.kind === 'brain' ? pivot.planet : null;
      if (walkers.length < 18 && Math.random() < 0.35) spawnWalker(centre && Math.random() < 0.7 ? centre : null);
      sincePulse += dt;
      if (sincePulse > 0.55 && layout.planets.length) {
        sincePulse = 0;
        spawnPulse(layout.planets[Math.floor(Math.random() * layout.planets.length)]!);
      }
    }
    placeOrbits(layout, orbitTime, unit);
    draw(running ? dt : 0, dt);
    frameId = requestAnimationFrame(frame);
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  frameId = requestAnimationFrame(frame);

  return {
    setBrains(inputs) {
      layout = layoutOrbits(inputs);
      views = layout.planets.map(() => ({ glow: 1, slot: 0, lx: null, ly: null, show: 1 }));
      // Packets in flight belong to Brains that may be gone.
      pulses.length = 0;
      placeOrbits(layout, orbitTime, unit);
      hover = resolve(hoverTarget);
      selected = resolve(selectedTarget);
    },
    setSelected(target) {
      selectedTarget = target;
      selected = resolve(target);
      if (!selected) return;
      if (selected.kind === 'hub') layout.planets.forEach((p) => spawnPulse(p));
      else spawnPulse(selected.planet);
      if (selected.kind === 'brain' && running) for (let i = 0; i < 6; i++) spawnWalker(selected.planet);
    },
    setHover(target) {
      hoverTarget = target;
      hover = resolve(target);
    },
    setRunning(on) {
      running = on;
    },
    hitTest(clientX, clientY) {
      const box = canvas.getBoundingClientRect();
      const x = (clientX - box.left - offsetX) / scale;
      const y = (clientY - box.top - offsetY) / scale;
      let best: AtlasHit | null = null;
      let bestDistance = Infinity;
      const test = (target: AtlasTarget, at: Spot, radius: number): void => {
        const d = Math.hypot(at.x - x, at.y - y);
        if (d < radius && d < bestDistance) {
          best = { target, x: offsetX + at.x * scale, y: offsetY + at.y * scale };
          bestDistance = d;
        }
      };
      test({ type: 'hub' }, hub, unit(HUB_RADIUS) + px(8));
      for (const p of layout.planets) {
        test({ type: 'brain', id: p.id }, p, unit(p.r) + px(6));
        p.moons.forEach((moon, index) => {
          // A moon is nameless until the items load: nothing to say about it yet.
          if (moon.name !== null) test({ type: 'item', brainId: p.id, index }, moon, unit(2.1) + px(6));
        });
      }
      return best;
    },
    destroy() {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    },
  };
}
