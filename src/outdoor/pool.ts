// The swimming pool as numbers (SPEC 19.3): the depth anywhere in a basin, its steps, what blocks the walker, and the person-against-the-water
// card. Pure, no three. Depths are metres below the water surface; the water sits `waterBelowDeckM` under the deck.
import type { Box } from '../types';
import type { PoolBasin, PoolSteps, Rect, Side } from './types';
import { rectD, rectW } from './types';

export const DEFAULT_STEP_TREAD_M = 0.3;
export const DEFAULT_STEP_RISER_M = 0.22;
export const DEFAULT_STEP_TOP_DEPTH_M = 0.3;
/** a typical pool: 1.2 m at the shallow end, 1.7 m at the deep end (the profile is data, these are the defaults the generator uses) */
export const TYPICAL_PROFILE: [number, number][] = [[0, 1.2], [0.4, 1.2], [0.75, 1.7], [1, 1.7]];

const SIDE_VEC: Record<Side, { x: number; z: number }> = { N: { x: 0, z: -1 }, E: { x: 1, z: 0 }, S: { x: 0, z: 1 }, W: { x: -1, z: 0 } };
export const sideVec = (s: Side): { x: number; z: number } => SIDE_VEC[s];

/** the axis the depth changes along: x for a pool shallow at the west or east, z for north or south */
export const depthAxis = (b: PoolBasin): 'x' | 'z' => (b.shallowEnd === 'W' || b.shallowEnd === 'E' ? 'x' : 'z');
/** length of the pool along its depth axis, metres */
export const basinLengthM = (b: PoolBasin): number => (depthAxis(b) === 'x' ? rectW(b.rect) : rectD(b.rect));
export const basinWidthM = (b: PoolBasin): number => (depthAxis(b) === 'x' ? rectD(b.rect) : rectW(b.rect));
export const inRect = (r: Rect, x: number, z: number): boolean => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/** 0 at the shallow end, 1 at the deep end */
export function alongOf(b: PoolBasin, x: number, z: number): number {
  const r = b.rect;
  switch (b.shallowEnd) {
    case 'W': return (x - r.x0) / rectW(r);
    case 'E': return (r.x1 - x) / rectW(r);
    case 'N': return (z - r.z0) / rectD(r);
    case 'S': return (r.z1 - z) / rectD(r);
  }
}

/** The depth of the basin's floor at position `u` (0..1) along it, by the profile. */
export function profileDepth(b: PoolBasin, u: number): number {
  const p = b.profile;
  const t = Math.min(1, Math.max(0, u));
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i][0]) {
      const k = (t - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
      return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k;
    }
  }
  return p[p.length - 1][1];
}

export const shallowestM = (b: PoolBasin): number => Math.min(...b.profile.map((q) => q[1]));
export const deepestM = (b: PoolBasin): number => Math.max(...b.profile.map((q) => q[1]));

/** A flight of steps as the rectangle it covers (scene frame) and the depth of each tread. */
export interface StepRect { rect: Rect; /** 0 = the top tread */ index: number; depthM: number; flight: number }

export function stepRects(b: PoolBasin): StepRect[] {
  const out: StepRect[] = [];
  b.steps.forEach((s, flight) => {
    const tread = s.treadM ?? DEFAULT_STEP_TREAD_M;
    const riser = s.riserM ?? DEFAULT_STEP_RISER_M;
    const top = s.topDepthM ?? DEFAULT_STEP_TOP_DEPTH_M;
    for (let i = 0; i < s.count; i++) out.push({ rect: stepRect(b.rect, s, i, tread), index: i, depthM: top + i * riser, flight });
  });
  return out;
}

function stepRect(r: Rect, s: PoolSteps, i: number, tread: number): Rect {
  const lo = s.fromM, hi = s.fromM + s.widthM;
  const a = i * tread, c = (i + 1) * tread;
  switch (s.edge) {
    case 'W': return { x0: r.x0 + a, x1: r.x0 + c, z0: r.z0 + lo, z1: r.z0 + hi };
    case 'E': return { x0: r.x1 - c, x1: r.x1 - a, z0: r.z0 + lo, z1: r.z0 + hi };
    case 'N': return { z0: r.z0 + a, z1: r.z0 + c, x0: r.x0 + lo, x1: r.x0 + hi };
    case 'S': return { z0: r.z1 - c, z1: r.z1 - a, x0: r.x0 + lo, x1: r.x0 + hi };
  }
}

/** The depth of the water at a point of one basin (steps included), or null when the point is outside it. A step never rises above the floor beneath it. */
export function depthAt(b: PoolBasin, x: number, z: number): number | null {
  if (!inRect(b.rect, x, z)) return null;
  let d = profileDepth(b, alongOf(b, x, z));
  for (const s of stepRects(b)) if (inRect(s.rect, x, z)) d = Math.min(d, s.depthM);
  return d;
}

/** The deepest-first basin that holds the point and its depth there, or null on dry deck. */
export function waterAt(pools: readonly PoolBasin[], x: number, z: number): { basin: PoolBasin; depthM: number } | null {
  for (const b of pools) { const d = depthAt(b, x, z); if (d !== null) return { basin: b, depthM: d }; }
  return null;
}

/** The water's surface height in the scene frame (the deck is at y = 0). */
export const waterLevelY = (b: PoolBasin): number => -b.waterBelowDeckM;
/** Height of the basin floor at a point, in the scene frame: negative, below the deck. */
export function floorY(b: PoolBasin, x: number, z: number): number | null {
  const d = depthAt(b, x, z);
  return d === null ? null : waterLevelY(b) - d;
}

/**
 * What stops the walker. A walker cannot walk on water: the whole basin is an obstacle a little over the water, so they stop at the coping with
 * the deck under their feet. (Wading in at the steps is not built: SPEC 19.3.)
 */
export function waterObstacles(pools: readonly PoolBasin[]): { box: Box; heightM: number }[] {
  return pools.map((b) => ({ box: { cx: (b.rect.x0 + b.rect.x1) / 2, cz: (b.rect.z0 + b.rect.z1) / 2, w: rectW(b.rect), d: rectD(b.rect), yawDeg: 0 }, heightM: 0.2 }));
}

/** The depths printed on the coping and the wall: at the shallow end, the middle and the deep end, rounded to 0.1 m. */
export function markerStations(b: PoolBasin): { u: number; depthM: number; label: string }[] {
  const us = b.kids ? [0.5] : [0.06, 0.5, 0.94];
  return us.map((u) => { const d = Math.round(profileDepth(b, u) * 10) / 10; return { u, depthM: d, label: `${d.toFixed(1)} m` }; });
}

/** Where along the shallow-to-deep axis (0..1) the floor slopes (between two profile points of different depth). */
export const slopeSpan = (b: PoolBasin): [number, number] | null => {
  let a = -1, c = -1;
  for (let i = 1; i < b.profile.length; i++) if (b.profile[i][1] !== b.profile[i - 1][1]) { if (a < 0) a = b.profile[i - 1][0]; c = b.profile[i][0]; }
  return a < 0 ? null : [a, c];
};

// ---------------------------------------------------------------- a person against the water

/** Fractions of standing height of the landmarks the card names (Drillis and Contini's proportions, rounded): top of the foot to the top of the head. */
export const BODY_LANDMARKS: { upTo: number; word: string; phrase: string }[] = [
  { upTo: 0.07, word: 'ankle', phrase: 'ankle-deep' },
  { upTo: 0.18, word: 'shin', phrase: 'shin-deep' },
  { upTo: 0.32, word: 'knee', phrase: 'knee-deep' },
  { upTo: 0.45, word: 'thigh', phrase: 'thigh-deep' },
  { upTo: 0.56, word: 'hip', phrase: 'hip-deep' },
  { upTo: 0.65, word: 'waist', phrase: 'waist-deep' },
  { upTo: 0.78, word: 'chest', phrase: 'chest-deep' },
  { upTo: 0.84, word: 'shoulder', phrase: 'shoulder-deep' },
  { upTo: 0.9, word: 'chin', phrase: 'up to the chin' },
  { upTo: 0.97, word: 'eyes', phrase: 'up to the eyes' },
];

/** How deep the water is against a person standing on the floor: the landmark, and whether their head is under. */
export function levelAgainst(depthM: number, heightCm: number): { word: string; phrase: string; overHead: boolean; fraction: number } {
  const f = depthM / (heightCm / 100);
  const hit = BODY_LANDMARKS.find((l) => f < l.upTo);
  if (hit) return { word: hit.word, phrase: hit.phrase, overHead: false, fraction: f };
  return { word: 'head', phrase: f >= 1.02 ? 'over their head' : 'up to the top of the head', overHead: true, fraction: f };
}

export interface Person { id: string; label: string; heightCm: number }
export const ADULT: Person = { id: 'adult', label: 'Adult', heightCm: 175 };
export const CHILD: Person = { id: 'child', label: 'Child', heightCm: 120 };
export const TODDLER: Person = { id: 'toddler', label: 'Toddler', heightCm: 90 };

/** "a 175 cm adult", "a 120 cm child", or the label of a person the walker named */
const whoOf = (p: Person): string => (p.id === 'me' ? `you (${p.heightCm} cm)` : p.id === 'adult' || p.id === 'child' || p.id === 'toddler' ? `a ${p.heightCm} cm ${p.id}` : `${p.label} (${p.heightCm} cm)`);

/** "Water reaches 1.3 m: chest-deep for a 175 cm adult; over a 120 cm child's head." The product's sentence, for any depth and any people. */
export function depthSentence(depthM: number, people: readonly Person[] = [ADULT, CHILD]): string {
  const parts = people.map((p) => {
    const l = levelAgainst(depthM, p.heightCm);
    if (l.overHead) return `${l.phrase === 'over their head' ? 'over' : 'up to the top of'} ${p.id === 'me' ? 'your' : `${whoOf(p)}'s`} head`;
    return `${l.phrase} for ${whoOf(p)}`;
  });
  return `Water reaches ${depthM.toFixed(1)} m: ${parts.join('; ')}.`;
}

/** Typical guidance, never code: the notes under the card. Every one says so. */
export const POOL_GUIDANCE: readonly string[] = [
  'Typical guidance, not code: a shallow end of about 1.2 m and a deep end of 1.5 to 1.8 m suit a residential pool.',
  'Typical guidance, not code: a children\'s pool is about 0.6 m or less, with its own fence or a separate gate.',
  'Typical guidance, not code: no diving where the water is under about 1.5 m, and depth markers on the coping and the wall.',
  'Check your local pool code with your consultant: fencing, a lifeguard, depth signs and a drain cover are set by it, not by this model.',
];

export interface DepthRow { label: string; depthM: number; adult: ReturnType<typeof levelAgainst>; child: ReturnType<typeof levelAgainst> }
/** The rows of the card: the shallow end, the deep end and, for a pool with a sloped floor, the middle. */
export function depthRows(b: PoolBasin, a: Person = ADULT, c: Person = CHILD): DepthRow[] {
  const lo = shallowestM(b), hi = deepestM(b);
  const rows: DepthRow[] = [{ label: 'Shallow end', depthM: lo, adult: levelAgainst(lo, a.heightCm), child: levelAgainst(lo, c.heightCm) }];
  if (hi - lo > 0.05) rows.push({ label: 'Deep end', depthM: hi, adult: levelAgainst(hi, a.heightCm), child: levelAgainst(hi, c.heightCm) });
  return rows;
}

// ---------------------------------------------------------------- basins that touch share their water

/** The metres of a basin's side, from the side's start: N and S run from x0, E and W from z0 (the order the walkway and the steps already use). */
export const sideLengthM = (b: PoolBasin, s: Side): number => (s === 'N' || s === 'S' ? rectW(b.rect) : rectD(b.rect));
const TOUCH_M = 0.01;

export interface Seam { side: Side; fromM: number; toM: number; other: PoolBasin }
export interface Exposure { /** the parts of each side that meet the deck, not another basin's water: [from, to] metres along the side */ exposed: Record<Side, [number, number][]>; seams: Seam[] }

/**
 * Two basins whose rectangles touch along a stretch are one body of water there (an L-shaped pool drawn as rectangles): no coping, wall or
 * walkway on that stretch. This gives, for each side of `b`, the stretches that stay edge (coping, wall, walkway) and the seams.
 */
export function exposureOf(b: PoolBasin, pools: readonly PoolBasin[]): Exposure {
  const r = b.rect;
  const seams: Seam[] = [];
  for (const o of pools) {
    if (o === b || o.id === b.id) continue;
    const q = o.rect;
    const zOv: [number, number] = [Math.max(r.z0, q.z0), Math.min(r.z1, q.z1)], xOv: [number, number] = [Math.max(r.x0, q.x0), Math.min(r.x1, q.x1)];
    if (Math.abs(q.x0 - r.x1) < TOUCH_M && zOv[1] - zOv[0] > TOUCH_M) seams.push({ side: 'E', fromM: zOv[0] - r.z0, toM: zOv[1] - r.z0, other: o });
    if (Math.abs(q.x1 - r.x0) < TOUCH_M && zOv[1] - zOv[0] > TOUCH_M) seams.push({ side: 'W', fromM: zOv[0] - r.z0, toM: zOv[1] - r.z0, other: o });
    if (Math.abs(q.z0 - r.z1) < TOUCH_M && xOv[1] - xOv[0] > TOUCH_M) seams.push({ side: 'S', fromM: xOv[0] - r.x0, toM: xOv[1] - r.x0, other: o });
    if (Math.abs(q.z1 - r.z0) < TOUCH_M && xOv[1] - xOv[0] > TOUCH_M) seams.push({ side: 'N', fromM: xOv[0] - r.x0, toM: xOv[1] - r.x0, other: o });
  }
  const exposed = { N: [] as [number, number][], E: [] as [number, number][], S: [] as [number, number][], W: [] as [number, number][] };
  for (const s of ['N', 'E', 'S', 'W'] as Side[]) {
    const len = sideLengthM(b, s);
    const cut = seams.filter((m) => m.side === s).sort((a, c) => a.fromM - c.fromM);
    let at = 0;
    for (const m of cut) { if (m.fromM > at + 1e-6) exposed[s].push([at, m.fromM]); at = Math.max(at, m.toM); }
    if (at < len - 1e-6) exposed[s].push([at, len]);
  }
  return { exposed, seams };
}

/** Is the point at `t` metres along side `s` of `b` on an exposed stretch (deck beyond it), not on a seam? */
export const isExposedAt = (ex: Exposure, s: Side, t: number): boolean => ex.exposed[s].some(([a, c]) => t >= a - 1e-6 && t <= c + 1e-6);

/** At a corner of a basin's rectangle, is the next side also edge (deck beyond it) there? Then the coping of this side wraps the corner. */
function cornerOpen(b: PoolBasin, ex: Exposure, side: Side, end: 'lo' | 'hi'): boolean {
  // the perpendicular side that shares this corner, and where on that side the corner is (its start or its end)
  const next: Record<Side, { lo: [Side, 'lo' | 'hi']; hi: [Side, 'lo' | 'hi'] }> = {
    N: { lo: ['W', 'lo'], hi: ['E', 'lo'] }, S: { lo: ['W', 'hi'], hi: ['E', 'hi'] },
    W: { lo: ['N', 'lo'], hi: ['S', 'lo'] }, E: { lo: ['N', 'hi'], hi: ['S', 'hi'] },
  };
  const [s2, at] = next[side][end];
  const spans = ex.exposed[s2];
  if (spans.length === 0) return false;
  return at === 'lo' ? spans[0][0] < 1e-6 : Math.abs(spans[spans.length - 1][1] - sideLengthM(b, s2)) < 1e-6;
}

/**
 * The coping of a basin as boxes on the plan: one along each stretch of its edge that meets the deck, none along a seam where another basin's water touches.
 * A stretch that ends at a corner with the next side also on deck runs on past it by the coping's width, so a convex corner has no gap.
 */
export function copingRects(b: PoolBasin, ex: Exposure = exposureOf(b, [b])): Rect[] {
  const R = b.rect, cm = b.copingM;
  const out: Rect[] = [];
  for (const side of ['N', 'E', 'S', 'W'] as Side[]) for (const [t0, t1] of ex.exposed[side]) {
    const full = sideLengthM(b, side);
    const lo = t0 < 1e-6 && cornerOpen(b, ex, side, 'lo') ? cm : 0, hi = t1 > full - 1e-6 && cornerOpen(b, ex, side, 'hi') ? cm : 0;
    if (side === 'N' || side === 'S') { const z = side === 'N' ? [R.z0 - cm, R.z0] : [R.z1, R.z1 + cm]; out.push({ x0: R.x0 + t0 - lo, x1: R.x0 + t1 + hi, z0: z[0], z1: z[1] }); }
    else { const x = side === 'W' ? [R.x0 - cm, R.x0] : [R.x1, R.x1 + cm]; out.push({ x0: x[0], x1: x[1], z0: R.z0 + t0 - lo, z1: R.z0 + t1 + hi }); }
  }
  return out;
}
