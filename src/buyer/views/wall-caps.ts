// Wall tops for the doll house, pure. The shell's walls are closed boxes (their tops are faces of the same material as the wall), but seen from
// above a cut wall should read as a solid, clean line: one neutral cap laid on the top of every full-height wall piece, built from the
// layout's own wall footprints (the pieces the shell is built from), so it can never disagree with the walls under it.
import { computeEdgeFrames, computeWallPieces, pieceRect } from '../../core/layout-geom';
import type { Layout, Vec2 } from '../../types';

export type Quad = [Vec2, Vec2, Vec2, Vec2];

/** How far above the wall top the cap floats (so it never fights the wall's own top face). */
export const CAP_LIFT_M = 0.004;

/**
 * The footprint of every wall piece whose top is the wall's top (a full wall, or the lintel over a door or window: both reach the ceiling).
 * Railings and the low footing of a partly-drawn room are not capped. `skipEdges` are edges another module draws (an open-air space's boundary).
 */
export function wallCapQuads(layout: Layout, skipEdges?: ReadonlySet<string>): Quad[] {
  const partial = new Set(layout.rooms.filter((r) => r.partial).map((r) => r.id));
  const frames = new Map(computeEdgeFrames(layout).map((f) => [`${f.roomId}:${f.edge}`, f]));
  const out: Quad[] = [];
  for (const p of computeWallPieces(layout)) {
    if (p.kind !== 'wall' || partial.has(p.roomId)) continue;
    if (p.y1 < layout.wallHeightM - 1e-6) continue;
    const key = `${p.roomId}:${p.edge}`;
    if (skipEdges?.has(key)) continue;
    const f = frames.get(key);
    if (!f) continue;
    out.push(pieceRect(f, p));
  }
  return out;
}

/** Triangles (x, y, z, ...) facing up, two per quad, at `y`. */
export function capPositions(quads: readonly Quad[], y: number): Float32Array {
  const pos = new Float32Array(quads.length * 18);
  let n = 0;
  const put = (p: Vec2): void => { pos[n++] = p.x; pos[n++] = y; pos[n++] = p.z; };
  for (const q of quads) {
    // wound so the face looks up whichever way the corners run
    const area = (q[1].x - q[0].x) * (q[2].z - q[0].z) - (q[1].z - q[0].z) * (q[2].x - q[0].x);
    const c = area >= 0 ? [q[0], q[2], q[1], q[0], q[3], q[2]] : [q[0], q[1], q[2], q[0], q[2], q[3]];
    for (const p of c) put(p);
  }
  return pos;
}
