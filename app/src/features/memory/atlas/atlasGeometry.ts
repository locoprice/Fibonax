// The Brain Atlas scene that never changes: a head seen from the front, the
// brain inside it as a neural mesh, all in a 1000 x 1000 logical space. Built
// once, from a fixed seed, so the mesh is the same on every visit.
//
// Shapes are drawn for the viewer's left and mirrored, which keeps the head
// and the brain exactly symmetric.

export type Pt = [number, number];

export type RegionKey = 'fL' | 'fR' | 'tL' | 'tR' | 'cb' | 'stem';

interface Region {
  poly: Pt[];
  spacing: number;
  inset: number;
  /** How far inside a lobe a point must sit to glow fully. */
  shade: number;
  /** Narrow channels the mesh keeps out of, so the folds of the brain read as folds. */
  sulci: Pt[][];
}

export interface MeshPoint {
  x: number;
  y: number;
  region: RegionKey;
  /** Phase of the slow shimmer. */
  pulse: number;
  /** 0 to 3: a point deep inside a lobe faces the viewer and glows fully. */
  band: number;
}

export interface MeshEdge {
  a: number;
  b: number;
  region: RegionKey;
  band: number;
}

export interface FacePoint {
  x: number;
  y: number;
}

export interface AtlasScene {
  regions: Record<RegionKey, Region>;
  regionKeys: RegionKey[];
  /** Every region but the brainstem, which is drawn last, in front. */
  body: RegionKey[];
  /** The brainstem footprint, widened: nothing else is drawn inside it. */
  stemHalo: Pt[];
  stemSides: Pt[][];
  outline: Pt[];
  head: Pt[];
  meshPts: MeshPoint[];
  meshEdges: MeshEdge[];
  /** Edge indexes meeting at each mesh point. */
  adjacency: number[][];
  edgesByRegion: Record<RegionKey, MeshEdge[]>;
  ptsByRegion: Record<RegionKey, MeshPoint[]>;
  facePts: FacePoint[];
  faceEdges: Array<[number, number]>;
}

/** Deterministic randomness (mulberry32). */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A smooth curve through the points (Catmull-Rom), as a polyline. */
function flatten(pts: Pt[], closed: boolean, steps: number): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const p0 = pts[closed ? (i - 1 + n) % n : Math.max(i - 1, 0)]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[closed ? (i + 2) % n : Math.min(i + 2, n - 1)]!;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  if (!closed) {
    const last = pts[n - 1]!;
    out.push([last[0], last[1]]);
  }
  return out;
}

export function inPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToPoly(x: number, y: number, poly: Pt[], open = false): number {
  let best = Infinity;
  for (let i = open ? 1 : 0, j = open ? 0 : poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j]!;
    const dx = poly[i]![0] - ax;
    const dy = poly[i]![1] - ay;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((x - ax) * dx + (y - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t - x;
    const py = ay + dy * t - y;
    const d = px * px + py * py;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function crossesPolyline(ax: number, ay: number, bx: number, by: number, line: Pt[]): boolean {
  for (let i = 1; i < line.length; i++) {
    const p = line[i - 1]!;
    const q = line[i]!;
    if (segmentsCross(ax, ay, bx, by, p[0], p[1], q[0], q[1])) return true;
  }
  return false;
}

function bounds(poly: Pt[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of poly) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function centroid(poly: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
}

/** Points along a polygon's edge, one every `spacing`. */
function perimeterPoints(poly: Pt[], spacing: number, open = false): Pt[] {
  const out: Pt[] = [];
  let carried = spacing;
  const count = open ? poly.length - 1 : poly.length;
  for (let i = 0; i < count; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    let pos = 0;
    while (carried + (len - pos) >= spacing) {
      pos += spacing - carried;
      out.push([a[0] + (dx * pos) / len, a[1] + (dy * pos) / len]);
      carried = 0;
    }
    carried += len - pos;
  }
  return out;
}

type Reject = (x: number, y: number) => boolean;

/** An even point cloud inside a polygon: a ring just inside the edge, then darts in the interior. */
function scatter(poly: Pt[], spacing: number, inset: number, random: () => number, reject?: Reject): FacePoint[] {
  const c = centroid(poly);
  const pts: FacePoint[] = perimeterPoints(poly, spacing)
    .map(([x, y]) => {
      const dx = c[0] - x;
      const dy = c[1] - y;
      const d = Math.hypot(dx, dy) || 1;
      return { x: x + (dx / d) * inset, y: y + (dy / d) * inset };
    })
    .filter((p) => inPoly(p.x, p.y, poly) && !(reject && reject(p.x, p.y)));
  const [x0, y0, x1, y1] = bounds(poly);
  const min2 = spacing * spacing * 0.8;
  for (let tries = 0; tries < 9000; tries++) {
    const x = x0 + random() * (x1 - x0);
    const y = y0 + random() * (y1 - y0);
    if (!inPoly(x, y, poly) || distToPoly(x, y, poly) < inset || (reject && reject(x, y))) continue;
    let free = true;
    for (const p of pts) {
      const ddx = p.x - x;
      const ddy = p.y - y;
      if (ddx * ddx + ddy * ddy < min2) {
        free = false;
        break;
      }
    }
    if (free) pts.push({ x, y });
  }
  return pts;
}

interface Triangle {
  a: number;
  b: number;
  c: number;
  cx: number;
  cy: number;
  r2: number;
}

/** Delaunay triangulation (Bowyer-Watson). Returns each edge once, as a pair of point indexes. */
function triangulate(pts: FacePoint[]): Array<[number, number]> {
  const n = pts.length;
  const [x0, y0, x1, y1] = bounds(pts.map((p): Pt => [p.x, p.y]));
  const span = Math.max(x1 - x0, y1 - y0);
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const all = pts.concat([
    { x: mx - 20 * span, y: my - span },
    { x: mx, y: my + 20 * span },
    { x: mx + 20 * span, y: my - span },
  ]);
  const triangle = (a: number, b: number, c: number): Triangle => {
    const A = all[a]!;
    const B = all[b]!;
    const C = all[c]!;
    const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
    if (Math.abs(d) < 1e-9) return { a, b, c, cx: 0, cy: 0, r2: Infinity };
    const a2 = A.x * A.x + A.y * A.y;
    const b2 = B.x * B.x + B.y * B.y;
    const c2 = C.x * C.x + C.y * C.y;
    const cx = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / d;
    const cy = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / d;
    return { a, b, c, cx, cy, r2: (A.x - cx) ** 2 + (A.y - cy) ** 2 };
  };
  const key = (u: number, v: number): number => (u < v ? u * (n + 3) + v : v * (n + 3) + u);
  let tris: Triangle[] = [triangle(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const p = all[i]!;
    const bad: Triangle[] = [];
    const keep: Triangle[] = [];
    for (const t of tris) {
      const dx = p.x - t.cx;
      const dy = p.y - t.cy;
      (dx * dx + dy * dy < t.r2 ? bad : keep).push(t);
    }
    const seen = new Map<number, { u: number; v: number; count: number }>();
    for (const t of bad) {
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as Array<[number, number]>) {
        const k = key(u, v);
        const entry = seen.get(k);
        if (entry) entry.count += 1;
        else seen.set(k, { u, v, count: 1 });
      }
    }
    for (const { u, v, count } of seen.values()) if (count === 1) keep.push(triangle(u, v, i));
    tris = keep;
  }
  const edges = new Map<number, [number, number]>();
  for (const t of tris) {
    if (t.a >= n || t.b >= n || t.c >= n) continue;
    for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as Array<[number, number]>) {
      edges.set(key(u, v), u < v ? [u, v] : [v, u]);
    }
  }
  return [...edges.values()];
}

const mirrorPt = ([x, y]: Pt): Pt => [1000 - x, y];
const mirror = (pts: Pt[]): Pt[] => pts.map(mirrorPt);

const FRONTAL: Pt[] = [[497, 192], [480, 184], [452, 181], [420, 186], [388, 198], [358, 218], [334, 246], [318, 282], [310, 322], [310, 362], [316, 398], [330, 428], [348, 444], [386, 452], [426, 454], [464, 452], [488, 446], [497, 436], [497, 300]];
const TEMPORAL: Pt[] = [[348, 456], [388, 458], [428, 460], [458, 468], [460, 508], [452, 540], [430, 560], [398, 568], [364, 560], [338, 538], [324, 508], [328, 476]];
const CEREBELLUM: Pt[] = [[396, 580], [424, 576], [452, 578], [476, 586], [500, 588], [524, 586], [548, 578], [576, 576], [604, 580], [618, 598], [620, 622], [608, 644], [580, 656], [548, 660], [524, 658], [500, 656], [476, 658], [452, 660], [420, 656], [392, 644], [380, 622], [382, 598]];
const STEM: Pt[] = [[470, 468], [530, 468], [538, 500], [536, 536], [526, 570], [522, 604], [522, 660], [478, 660], [478, 604], [474, 570], [464, 536], [462, 500]];
const SULCI: Pt[][] = [
  [[454, 210], [446, 252], [444, 300], [438, 348], [426, 392], [414, 412]],
  [[396, 220], [382, 262], [372, 310], [368, 356], [364, 396], [366, 416]],
  [[356, 286], [344, 326], [340, 368], [346, 404]],
];
const OUTLINE_LEFT: Pt[] = [[497, 192], [480, 184], [452, 181], [420, 186], [388, 198], [358, 218], [334, 246], [318, 282], [310, 322], [310, 362], [316, 398], [330, 428], [340, 452], [328, 480], [324, 508], [338, 538], [364, 560], [398, 568], [388, 584], [380, 604], [382, 626], [396, 646], [424, 657], [452, 660], [476, 658]];
const STEM_SIDE: Pt[] = [[470, 468], [462, 500], [464, 536], [474, 570], [478, 604], [478, 660]];
const HEAD_LEFT: Pt[] = [[500, 142], [448, 147], [398, 161], [354, 186], [316, 222], [290, 266], [276, 316], [272, 366], [276, 408], [262, 424], [256, 452], [258, 488], [270, 514], [286, 526], [294, 552], [306, 596], [324, 644], [352, 688], [392, 722], [440, 744], [500, 752]];

function region(pts: Pt[], spacing: number, inset: number, shade: number, sulci: Pt[][]): Region {
  return { poly: flatten(pts, true, 6), spacing, inset, shade, sulci: sulci.map((s) => flatten(s, false, 6)) };
}

function buildScene(): AtlasScene {
  const random = seededRandom(20261104);
  const regions: Record<RegionKey, Region> = {
    fL: region(FRONTAL, 17, 6, 70, SULCI),
    fR: region(mirror(FRONTAL), 17, 6, 70, SULCI.map(mirror)),
    tL: region(TEMPORAL, 17, 6, 50, []),
    tR: region(mirror(TEMPORAL), 17, 6, 50, []),
    cb: region(CEREBELLUM, 11, 5, 30, []),
    stem: region(STEM, 13, 5, 26, []),
  };
  const regionKeys: RegionKey[] = ['fL', 'fR', 'tL', 'tR', 'cb', 'stem'];
  const body = regionKeys.filter((k) => k !== 'stem');

  // The brainstem passes in front of the cerebellum: no other mesh is drawn inside its footprint.
  const stem = regions.stem.poly;
  const stemHalo = stem.map(([x, y]): Pt => [x + Math.sign(x - 500) * 6, y]);
  const nearStem = (x: number, y: number, margin: number): boolean => inPoly(x, y, stem) || distToPoly(x, y, stem) < margin;
  const nearBrain = (x: number, y: number, margin: number): boolean =>
    regionKeys.some((k) => inPoly(x, y, regions[k].poly) || distToPoly(x, y, regions[k].poly) < margin);
  const bandOf = (depth: number): number => Math.min(3, Math.floor(depth * 4));

  // Neural mesh: an even point cloud per lobe, triangulated, edges kept only
  // inside their own lobe and off the sulci.
  const cloud: Array<MeshPoint & { depth: number }> = [];
  for (const k of regionKeys) {
    const r = regions[k];
    const reject: Reject = (x, y) => r.sulci.some((s) => distToPoly(x, y, s, true) < 5.5) || (k !== 'stem' && nearStem(x, y, 8));
    for (const p of scatter(r.poly, r.spacing, r.inset, random, reject)) {
      const depth = Math.min(1, distToPoly(p.x, p.y, r.poly) / r.shade);
      cloud.push({ x: p.x, y: p.y, region: k, pulse: random() * Math.PI * 2, depth, band: bandOf(depth) });
    }
  }
  const meshEdges: MeshEdge[] = [];
  for (const [a, b] of triangulate(cloud)) {
    const A = cloud[a]!;
    const B = cloud[b]!;
    if (A.region !== B.region) continue;
    const r = regions[A.region];
    const len = Math.hypot(A.x - B.x, A.y - B.y);
    const mx = (A.x + B.x) / 2;
    const my = (A.y + B.y) / 2;
    if (len > r.spacing * 1.9 || !inPoly(mx, my, r.poly)) continue;
    if (r.sulci.some((s) => distToPoly(mx, my, s, true) < 5.5 || crossesPolyline(A.x, A.y, B.x, B.y, s))) continue;
    if (A.region !== 'stem' && nearStem(mx, my, 6)) continue;
    meshEdges.push({ a, b, region: A.region, band: bandOf((A.depth + B.depth) / 2) });
  }
  const meshPts: MeshPoint[] = cloud.map(({ x, y, region: key, pulse, band }) => ({ x, y, region: key, pulse, band }));
  const adjacency: number[][] = meshPts.map(() => []);
  meshEdges.forEach((e, i) => {
    adjacency[e.a]!.push(i);
    adjacency[e.b]!.push(i);
  });
  const byRegion = <T extends { region: RegionKey }>(list: T[]): Record<RegionKey, T[]> => {
    const out: Record<RegionKey, T[]> = { fL: [], fR: [], tL: [], tR: [], cb: [], stem: [] };
    for (const item of list) out[item.region].push(item);
    return out;
  };

  // The glass head, face on: a hairline outline with the ears and a symmetric
  // wireframe skin. No neck: the head fades out below the brain.
  const head = flatten([...HEAD_LEFT, ...mirror(HEAD_LEFT.slice(1, -1)).reverse()], true, 8);
  const facePts: FacePoint[] = [];
  const addFace = (x: number, y: number): void => {
    for (const p of facePts) if ((p.x - x) ** 2 + (p.y - y) ** 2 < 100) return;
    facePts.push({ x, y });
  };
  const addPair = (x: number, y: number): void => {
    addFace(x, y);
    addFace(1000 - x, y);
  };
  for (const [x, y] of perimeterPoints(flatten(HEAD_LEFT, false, 8), 44, true)) addPair(x, y);
  addPair(500, 752);
  for (const p of scatter(head, 54, 20, random, (x, y) => x > 474 || nearBrain(x, y, 28))) addPair(p.x, p.y);
  const faceEdges: Array<[number, number]> = [];
  for (const [a, b] of triangulate(facePts)) {
    const A = facePts[a]!;
    const B = facePts[b]!;
    const len = Math.hypot(A.x - B.x, A.y - B.y);
    const mx = (A.x + B.x) / 2;
    const my = (A.y + B.y) / 2;
    if (len > 108 || !inPoly(mx, my, head) || nearBrain(mx, my, 12)) continue;
    faceEdges.push([a, b]);
  }

  return {
    regions,
    regionKeys,
    body,
    stemHalo,
    stemSides: [STEM_SIDE, mirror(STEM_SIDE)],
    outline: flatten([...OUTLINE_LEFT, [500, 656], ...mirror(OUTLINE_LEFT).reverse(), [500, 200]], true, 8),
    head,
    meshPts,
    meshEdges,
    adjacency,
    edgesByRegion: byRegion(meshEdges),
    ptsByRegion: byRegion(meshPts),
    facePts,
    faceEdges,
  };
}

let scene: AtlasScene | null = null;

/** The scene, built on first use and kept: it costs a few milliseconds and never changes. */
export function atlasScene(): AtlasScene {
  if (!scene) scene = buildScene();
  return scene;
}
