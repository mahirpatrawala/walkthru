// The walkway round a pool (SPEC 19.3). A pool deck needs a clear path all round the water: this reads it. The width is an ASSUMPTION
// (1.2 m from the water's edge, the common guidance for a circulation path, not a code figure) and every sentence says so. Pure.
import { pointInBox, pointInPolygon } from '../core/geometry';
import type { Box, Vec2 } from '../types';
import type { PoolBasin, Side } from './types';
import { exposureOf, inRect, sideVec } from './pool';
import { rectD, rectW } from './types';

export const WALKWAY_M = 1.2;
/** under this the walkway is only tight (one person at a time): 0.9 m is a common minimum for a single passage */
export const WALKWAY_TIGHT_M = 0.9;
/** a piece lower than this does not stop a walker (a mat, a rubber tile) */
export const WALKWAY_MIN_OBSTACLE_M = 0.25;
export const WALKWAY_ASSUMPTION = `${WALKWAY_M.toFixed(1)} m clear all round the water is assumed (typical guidance, not code)`;

export interface WalkObstacle { box: Box; heightM: number; label: string }
export interface WalkwaySide {
  basin: string;
  side: Side;
  /** the narrowest clear width along this side, metres from the water's edge (capped a little above the need) */
  clearM: number;
  verdict: 'clear' | 'tight' | 'blocked';
  /** what ends the clear run at its narrowest: 'a wall', 'a lounger', 'the other pool' */
  by: string;
  /** the plan position where it is narrowest */
  at: Vec2;
}
export interface WalkwayReport {
  verdict: 'clear' | 'tight' | 'blocked';
  requiredM: number;
  sides: WalkwaySide[];
  message: string;
  /** the pill's words: "Pool walkway clear", "Walkway blocked on the south side" */
  short: string;
}

const SIDES: Side[] = ['N', 'E', 'S', 'W'];
const SAMPLE_M = 0.15;
const STEP_M = 0.05;

/** the span of a basin's side as a start point on the water's edge and the direction along it */
function sideSpan(b: PoolBasin, s: Side): { a: Vec2; dir: Vec2; len: number } {
  const r = b.rect;
  switch (s) {
    case 'N': return { a: { x: r.x0, z: r.z0 }, dir: { x: 1, z: 0 }, len: rectW(r) };
    case 'S': return { a: { x: r.x0, z: r.z1 }, dir: { x: 1, z: 0 }, len: rectW(r) };
    case 'W': return { a: { x: r.x0, z: r.z0 }, dir: { x: 0, z: 1 }, len: rectD(r) };
    case 'E': return { a: { x: r.x1, z: r.z0 }, dir: { x: 0, z: 1 }, len: rectD(r) };
  }
}

export interface WalkwayInput {
  basin: PoolBasin;
  /** the other basins of the space (the kids' pool beside this one) */
  others: readonly PoolBasin[];
  /** the room's inside polygon: beyond it is a wall */
  room: Vec2[];
  obstacles: readonly WalkObstacle[];
  requiredM?: number;
}

/** Walks out from the water along each side and reads how far the clear deck goes: to a wall, to a piece, or to the other pool. */
export function walkwaySides(inp: WalkwayInput): WalkwaySide[] {
  const need = inp.requiredM ?? WALKWAY_M;
  const cap = need + 0.4;
  const blockers = inp.obstacles.filter((o) => o.heightM >= WALKWAY_MIN_OBSTACLE_M);
  const out: WalkwaySide[] = [];
  // a stretch where another basin's water touches this one is water, not edge: only the stretches that meet the deck are walked
  const ex = exposureOf(inp.basin, inp.others);
  for (const side of SIDES) {
    if (ex.exposed[side].length === 0) continue;
    const { a, dir, len } = sideSpan(inp.basin, side);
    const n = sideVec(side);
    let worst = cap, by = 'the deck', at: Vec2 = { x: a.x, z: a.z };
    const points: number[] = [];
    for (const [e0, e1] of ex.exposed[side]) {
      // a stretch is walked from 2 cm in from each end, so an end that meets another basin's water does not read that water as an obstacle at once
      const t0 = e0 + 0.02, t1 = Math.max(t0, e1 - 0.02);
      const n = Math.max(2, Math.ceil((t1 - t0) / SAMPLE_M));
      for (let i = 0; i <= n; i++) points.push(t0 + (i / n) * (t1 - t0));
    }
    for (const t of points) {
      const o = { x: a.x + dir.x * t, z: a.z + dir.z * t };
      for (let d = STEP_M; d <= cap; d += STEP_M) {
        const p = { x: o.x + n.x * d, z: o.z + n.z * d };
        let hit: string | null = null;
        if (!pointInPolygon(p, inp.room)) hit = 'a wall';
        else {
          const other = inp.others.find((q) => q.id !== inp.basin.id && inRect(q.rect, p.x, p.z));
          if (other) hit = other.kids ? 'the children\'s pool' : 'the other pool';
          else { const ob = blockers.find((q) => pointInBox(p, q.box)); if (ob) hit = ob.label; }
        }
        if (hit) { if (d < worst) { worst = d; by = hit; at = p; } break; }
      }
    }
    // a side whose own corners reach the room wall gets the wall's distance; only a clear run to the cap is "clear"
    out.push({ basin: inp.basin.id, side, clearM: Math.round(worst * 100) / 100, verdict: worst >= need - 1e-6 ? 'clear' : worst >= WALKWAY_TIGHT_M ? 'tight' : 'blocked', by, at });
  }
  return out;
}

const SIDE_WORD: Record<Side, string> = { N: 'north', E: 'east', S: 'south', W: 'west' };

/** The verdict for all the pools of a space: the worst side of any of them, in words, with the assumption. */
export function walkwayReport(pools: readonly PoolBasin[], room: Vec2[], obstacles: readonly WalkObstacle[], requiredM = WALKWAY_M): WalkwayReport {
  const sides = pools.filter((p) => !p.kids).flatMap((p) => walkwaySides({ basin: p, others: pools, room, obstacles, requiredM }));
  if (sides.length === 0) return { verdict: 'clear', requiredM, sides: [], message: 'No pool in this space.', short: 'No pool' };
  const rank = { clear: 0, tight: 1, blocked: 2 } as const;
  const bad = sides.filter((s) => s.verdict !== 'clear').sort((a, b) => rank[b.verdict] - rank[a.verdict] || a.clearM - b.clearM);
  if (bad.length === 0) return { verdict: 'clear', requiredM, sides, message: `The walkway round the pool is clear: ${requiredM.toFixed(1)} m or more on every side (${WALKWAY_ASSUMPTION}).`, short: `Pool walkway clear, ${requiredM.toFixed(1)} m (assumed)` };
  const w = bad[0];
  const cm = Math.round(w.clearM * 100);
  const where = `on the ${SIDE_WORD[w.side]} side`;
  const message = w.verdict === 'blocked'
    ? `Walkway blocked ${where}: ${w.by} leaves ${cm} cm, a person cannot get past the water's edge there (${WALKWAY_ASSUMPTION}).`
    : `Walkway tight ${where}: ${w.by} leaves ${cm} cm of ${Math.round(requiredM * 100)} cm (${WALKWAY_ASSUMPTION}).`;
  const short = `Walkway ${w.verdict} ${where}`;
  return { verdict: w.verdict, requiredM, sides, short, message: bad.length > 1 ? `${message} ${bad.length - 1} more side${bad.length > 2 ? 's' : ''} short too.` : message };
}

/** The spacing a lounger needs beside the next one: a person stepping between them. An assumption, stated by the piece. */
export const LOUNGER_GAP_M = 0.6;
