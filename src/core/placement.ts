// Placement check and wall snap (SPEC 4.5). Pure.
import { GRID_VOID } from '../types';
import type { AccessRule, Box, CatalogItem, Grid, PlacementResult, Side, Tone } from '../types';
import { boxAxes, boxCorners, pointInBox, sideEdge } from './geometry';
import { clearance } from './grid-query';

const DEG = Math.PI / 180;
const SIDES: Side[] = ['front', 'back', 'left', 'right'];
const CLEARANCE_CAP_M = 3.0;
/** The five rays of checkPlacement start this far outside the side (4.5 step 3). */
const RAY_START_M = 0.03;
/** Cells within this distance of the box edge are ignored by the overlap test (4.5 step 2). */
const OVERLAP_SHRINK_M = 0.03;
const FIVE_RAYS = [-0.8, -0.4, 0, 0.4, 0.8];
const THREE_RAYS = [-0.8, 0, 0.8];

type Overlap = 'none' | 'outside' | 'collides';

/** 4.5 step 2: cells whose centre lies inside the box shrunk by 0.03 m. Void (or beyond the grid) beats obstacle. */
function overlap(grid: Grid, box: Box): Overlap {
  const c = grid.cellM;
  const corners = boxCorners(box);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of corners) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const i0 = Math.floor((minX - grid.originX) / c);
  const i1 = Math.floor((maxX - grid.originX) / c);
  const j0 = Math.floor((minZ - grid.originZ) / c);
  const j1 = Math.floor((maxZ - grid.originZ) / c);
  let hit: Overlap = 'none';
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const centre = { x: grid.originX + (i + 0.5) * c, z: grid.originZ + (j + 0.5) * c };
      if (!pointInBox(centre, box, OVERLAP_SHRINK_M)) continue;
      if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz) return 'outside';
      const v = grid.cells[j * grid.nx + i];
      if (v === GRID_VOID) return 'outside';
      if (v !== 0) hit = 'collides';
    }
  }
  return hit;
}

/**
 * Metres from the side of the box to the first non-free cell, minimum over rays at the given fractions of the
 * side's half length, capped at 3.0. Rays start 0.03 m outside the side; the answer is measured from the side
 * itself (so it is the true gap), and is 0 when the first sample is already blocked.
 */
function sideClearance(grid: Grid, box: Box, side: Side, offsets: number[]): number {
  const e = sideEdge(box, side);
  let best = CLEARANCE_CAP_M;
  for (const f of offsets) {
    const origin = {
      x: e.mid.x + e.along.x * f * e.half + e.normal.x * RAY_START_M,
      z: e.mid.z + e.along.z * f * e.half + e.normal.z * RAY_START_M,
    };
    const c = clearance(grid, origin, e.normal, CLEARANCE_CAP_M);
    const d = c === 0 ? 0 : Math.min(CLEARANCE_CAP_M, RAY_START_M + c);
    if (d < best) best = d;
  }
  return best;
}

function accessHolds(rule: AccessRule, clr: Record<Side, number>): boolean {
  return rule.mode === 'any'
    ? rule.sides.some((s) => clr[s] >= rule.minM)
    : rule.sides.every((s) => clr[s] >= rule.minM);
}

function toneFor(verdict: PlacementResult['verdict']): Tone {
  return verdict === 'fits' ? 'good' : verdict === 'tight' ? 'warn' : 'bad';
}

/** `grid` must exclude the item being placed. */
export function checkPlacement(grid: Grid, spec: CatalogItem, box: Box, ceilingM: number, ceilingKnown = true): PlacementResult {
  const clearanceM = {} as Record<Side, number>;
  for (const s of SIDES) clearanceM[s] = sideClearance(grid, box, s, FIVE_RAYS);

  let verdict: PlacementResult['verdict'];
  let reason: PlacementResult['reason'];
  if (spec.heightM > ceilingM - 0.02) {
    verdict = 'blocked'; reason = 'too-tall';
  } else {
    const o = overlap(grid, box);
    if (o === 'outside') { verdict = 'blocked'; reason = 'outside'; }
    else if (o === 'collides') { verdict = 'blocked'; reason = 'collides'; }
    else if (spec.access.every((r) => accessHolds(r, clearanceM))) { verdict = 'fits'; reason = 'ok'; }
    else { verdict = 'tight'; reason = 'access'; }
  }
  const partial = { verdict, reason, clearanceM, tone: toneFor(verdict) };
  return { ...partial, message: placementMessage(spec, partial, ceilingM, ceilingKnown) };
}

function cmOf(m: number): number {
  return Math.round(m * 100);
}

/** 2.6 -> "2.6", 2.0 -> "2.0", 2.75 -> "2.75". */
function ceilingText(m: number): string {
  const s = (Math.round(m * 100) / 100).toString();
  return s.includes('.') ? s : `${s}.0`;
}

/** The verdict-bar copy of 2.1 (furnish mode, step 5), built exactly as the table there. */
export function placementMessage(spec: CatalogItem, r: Omit<PlacementResult, 'message'>, ceilingM: number, ceilingKnown = true): string {
  const name = spec.name;
  // a ceiling height nobody confirmed is not printed as a number
  if (r.reason === 'too-tall') return ceilingKnown ? `${name} is too tall for this ceiling (${ceilingText(ceilingM)} m).` : `${name} may be too tall for this ceiling. The ceiling height is not confirmed yet.`;
  if (r.verdict === 'blocked') return `${name} does not fit here.`;

  // up to two sides, smallest clearance first, never the back, skipping sides with 1.5 m or more
  const candidates = (['front', 'left', 'right'] as Side[])
    .filter((s) => r.clearanceM[s] < 1.5)
    .sort((a, b) => r.clearanceM[a] - r.clearanceM[b])
    .slice(0, 2);
  let phrases: string;
  if (candidates.length === 0) {
    phrases = 'Plenty of space around it';
  } else {
    const parts = candidates.map((s, i) => {
      const cm = cmOf(r.clearanceM[s]);
      return i === 0 ? `${cm} cm walking space ${spec.sideWords[s]}` : `${cm} cm ${spec.sideWords[s]}`;
    });
    // SPEC-GAP: 2.1 does not say how two phrases are joined; " and " reads naturally.
    phrases = parts.join(' and ');
  }
  return r.verdict === 'fits' ? `${name} fits. ${phrases}.` : `${name} fits, but it is tight. ${phrases}.`;
}

function withYaw(box: Box, yawDeg: number): Box {
  return { ...box, yawDeg: ((yawDeg % 360) + 360) % 360 };
}

/** The three back-edge ray distances (offsets -0.8h, 0, 0.8h), each capped at 0.6 m. */
function backDistances(grid: Grid, box: Box): number[] {
  const e = sideEdge(box, 'back');
  return THREE_RAYS.map((f) => {
    const origin = { x: e.mid.x + e.along.x * f * e.half, z: e.mid.z + e.along.z * f * e.half };
    return clearance(grid, origin, e.normal, 0.6);
  });
}

/**
 * Squares a box up to the wall behind it (4.5): rotate so the back edge is parallel to the wall when all three
 * back rays hit within 0.40 m and the tilt is at most 20 degrees, slide back to 0.02 m off the wall, then slide
 * toward a side wall that is closer than 0.25 m. Returns the original box if the result would overlap.
 */
export function snapToWalls(grid: Grid, box: Box): Box {
  let out = box;
  let d = backDistances(grid, out);
  if (d.every((v) => v < 0.4)) {
    const h = box.w / 2;
    const L = 1.6 * h;
    const angle = Math.atan2(d[2] - d[0], L);
    if (Math.abs(angle) <= 20 * DEG) {
      // The sign that makes the back edge parallel to the wall is the one that shrinks |d3 - d1|.
      const a = withYaw(box, box.yawDeg + angle / DEG);
      const b = withYaw(box, box.yawDeg - angle / DEG);
      const da = backDistances(grid, a);
      const db = backDistances(grid, b);
      if (da.every((v) => v < 0.6) && db.every((v) => v < 0.6)) {
        const pick = Math.abs(da[2] - da[0]) <= Math.abs(db[2] - db[0]) ? a : b;
        out = pick;
        d = pick === a ? da : db;
      }
    }
    const { a: ax } = boxAxes(out);
    const back = Math.min(...d) - 0.02;
    out = { ...out, cx: out.cx - ax.x * back, cz: out.cz - ax.z * back };
  }

  // Step 2: side walls. Both sides are measured from the same box; if both are close, only the nearer one pulls.
  const { b } = boxAxes(out);
  const cl = sideClearance(grid, out, 'left', THREE_RAYS);
  const cr = sideClearance(grid, out, 'right', THREE_RAYS);
  // SPEC-GAP: 4.5 step 2 does not say what to do when both sides are under 0.25 m; the nearer side wins.
  const pullLeft = cl < 0.25 && cl >= 0.02 && cl <= cr;
  const pullRight = cr < 0.25 && cr >= 0.02 && cr < cl;
  if (pullLeft) out = { ...out, cx: out.cx - b.x * (cl - 0.02), cz: out.cz - b.z * (cl - 0.02) };
  else if (pullRight) out = { ...out, cx: out.cx + b.x * (cr - 0.02), cz: out.cz + b.z * (cr - 0.02) };

  if (out === box) return box;
  return overlap(grid, out) === 'none' ? out : box;
}
