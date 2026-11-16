// Cutting the near walls down in the doll house, the pure part. A wall piece (one box of a room's wall, from `computeWallPieces`) has the outward normal of
// its edge: pointing away from its own room. When that normal faces the camera the piece stands between the camera and its room's floor, so it is cut down
// to about a metre; when it faces away it is the far wall of its room, seen from inside, and stays full height with its windows. A partition between two
// rooms is two pieces with opposite normals, so exactly one half is cut and the other stands: each room keeps its far walls.
import { computeEdgeFrames, computeWallPieces, pieceRect } from '../../core/layout-geom';
import type { Layout, Vec2 } from '../../types';

/** the height the near walls are cut to, metres */
export const CUT_HEIGHT_M = 1.0;
/** cos 75 degrees: a wall whose outward normal is within 75 degrees of the way to the camera is cut */
export const CUT_FACING = 0.26;
/** a wall already cut stays cut until it is this much less facing (the cut set does not flicker at the threshold) */
export const CUT_HYSTERESIS = 0.07;

export interface CutPiece {
  /** index in the list */
  i: number;
  /** `${roomId}:${edge}`: the pieces of one edge are cut together */
  key: string;
  roomId: string;
  y0: number; y1: number;
  /** the footprint, 4 corners in loop order */
  rect: [Vec2, Vec2, Vec2, Vec2];
  /** the outward unit normal of the piece's edge */
  out: Vec2;
}

/** Every wall box of the layout, in the order the shell builds them (a room's pieces keep this order inside its `walls:<room>` mesh). Railings, partly drawn rooms and skipped edges are not here. */
export function cutPieces(layout: Layout, skipEdges?: ReadonlySet<string>): CutPiece[] {
  const partial = new Set(layout.rooms.filter((r) => r.partial).map((r) => r.id));
  const frames = new Map(computeEdgeFrames(layout).map((f) => [`${f.roomId}:${f.edge}`, f]));
  const out: CutPiece[] = [];
  for (const p of computeWallPieces(layout)) {
    const key = `${p.roomId}:${p.edge}`;
    const f = frames.get(key);
    if (!f || p.kind !== 'wall' || partial.has(p.roomId) || skipEdges?.has(key)) continue;
    out.push({ i: out.length, key, roomId: p.roomId, y0: p.y0, y1: p.y1, rect: pieceRect(f, p), out: { x: f.out.x, z: f.out.z } });
  }
  return out;
}

/** The edges that are to be cut for a camera whose horizontal direction from the target is `cam` (a unit vector), with hysteresis against the set `prev`. */
export function cutEdges(pieces: readonly CutPiece[], cam: Vec2, prev?: ReadonlySet<string>): Set<string> {
  const best = new Map<string, number>();
  for (const p of pieces) if (!best.has(p.key)) best.set(p.key, p.out.x * cam.x + p.out.z * cam.z);
  const next = new Set<string>();
  for (const [key, f] of best) {
    const thr = prev?.has(key) ? CUT_FACING - CUT_HYSTERESIS : CUT_FACING;
    if (f > thr) next.add(key);
  }
  return next;
}

/** The top of a piece cut by `amount` (0 = as built, 1 = cut to `cutH`): a piece that starts above the cut (a lintel) collapses to nothing. */
export function cutTop(y0: number, y1: number, cutH: number, amount: number): number {
  const full = Math.max(y0, Math.min(y1, cutH));
  return y1 + (full - y1) * Math.min(1, Math.max(0, amount));
}

/** A piece the cut leaves with no height (a lintel over a door in a cut wall). */
export const collapses = (y0: number, cutH: number): boolean => y0 >= cutH - 1e-6;

/** Distance from a point to a convex quad's footprint, 0 inside. */
export function distToQuad(x: number, z: number, q: readonly Vec2[]): number {
  let inside = true;
  let best = Infinity;
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    const ex = b.x - a.x, ez = b.z - a.z;
    const cross = ex * (z - a.z) - ez * (x - a.x);
    if (sign === 0 && Math.abs(cross) > 1e-12) sign = Math.sign(cross);
    if (sign !== 0 && Math.sign(cross) !== sign && Math.abs(cross) > 1e-12) inside = false;
    const l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
    best = Math.min(best, Math.hypot(x - (a.x + t * ex), z - (a.z + t * ez)));
  }
  return inside ? 0 : best;
}

/** The piece a point (a triangle's middle, a fixture on a wall) belongs to: the nearest within `maxM`, preferring one whose footprint holds it, else -1. */
export function ownerOf(pieces: readonly CutPiece[], x: number, z: number, maxM = 0.3): number {
  let best = -1, bd = maxM + 1e-9;
  for (const p of pieces) {
    const d = distToQuad(x, z, p.rect);
    if (d < bd - 1e-9) { bd = d; best = p.i; }
  }
  return best;
}

/** For triangles given as positions (x, y, z, ...) and an optional index: the owning piece of each triangle's middle, and the height of that middle. */
export function triangleOwners(pieces: readonly CutPiece[], positions: ArrayLike<number>, index: ArrayLike<number> | null, maxM = 0.3): { owner: Int32Array; y: Float32Array } {
  const count = index ? index.length : Math.floor(positions.length / 3);
  const tris = Math.floor(count / 3);
  const owner = new Int32Array(tris);
  const y = new Float32Array(tris);
  const vi = (k: number): number => (index ? index[k] : k);
  for (let t = 0; t < tris; t++) {
    const a = vi(t * 3) * 3, b = vi(t * 3 + 1) * 3, c = vi(t * 3 + 2) * 3;
    const cx = (positions[a] + positions[b] + positions[c]) / 3, cz = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
    y[t] = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3;
    owner[t] = ownerOf(pieces, cx, cz, maxM);
  }
  return { owner, y };
}

/** The triangles to keep: those not on a cut edge above the cut. Writes their vertex indices (3 per triangle) into `out` (room for every triangle) and returns how many indices. */
export function keepUncutInto(owner: Int32Array, y: Float32Array, pieces: readonly CutPiece[], cutKeys: ReadonlySet<string>, cutH: number, sourceIndex: ArrayLike<number> | null, out: Uint32Array): number {
  let n = 0;
  for (let t = 0; t < owner.length; t++) {
    const o = owner[t];
    if (o >= 0 && y[t] > cutH - 0.05 && cutKeys.has(pieces[o].key)) continue;
    for (let k = 0; k < 3; k++) out[n++] = sourceIndex ? sourceIndex[t * 3 + k] : t * 3 + k;
  }
  return n;
}
