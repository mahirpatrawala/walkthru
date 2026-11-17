// The walker's real body against the real walls, without a browser: a person body with the shipped clips walks a real layout,
// and every skinned vertex is checked against the drawn geometry itself (room polygons, door holes, frame posts, shut leaves,
// furniture boxes), not against the walk grid the engine uses.
import * as THREE from 'three';
import { DOOR_POST_M, DOOR_THICKNESS_M, leafSegment, resolveDoors } from '../../src/core/doors';
import type { Door } from '../../src/core/doors';
import { distanceToSegment, pointInBox, pointInPolygon } from '../../src/core/geometry';
import { computeEdgeFrames, computeTunnels } from '../../src/core/layout-geom';
import type { Character } from '../../src/engine/character';
import type { EdgeFrame, FurnitureItem, Layout, PropertyFile, Tunnel, Vec2 } from '../../src/types';

export interface Truth {
  layout: Layout;
  holes: { f: EdgeFrame; t: Tunnel; door: boolean }[];
  doors: Door[];
  furniture: FurnitureItem[];
  /** a 1 cm map of the plan: 0 inside a room, 1 wall or outside, 2 + k inside hole k (a doorway, a window) */
  map: { x0: number; z0: number; nx: number; nz: number; cells: Uint8Array };
}

const MAP_M = 0.01;

export function truthOf(prop: PropertyFile): Truth {
  const layout = prop.layout;
  const frames = new Map(computeEdgeFrames(layout).map((f) => [`${f.roomId}:${f.edge}`, f]));
  const holes = computeTunnels(layout).flatMap((t) => {
    const f = frames.get(`${t.roomId}:${t.edge}`);
    return f ? [{ f, t, door: t.type === 'door' && t.openingId !== null }] : [];
  });
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const r of layout.rooms) for (const p of r.polygon) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  x0 -= 1; z0 -= 1; x1 += 1; z1 += 1;
  const nx = Math.ceil((x1 - x0) / MAP_M), nz = Math.ceil((z1 - z0) / MAP_M);
  const cells = new Uint8Array(nx * nz).fill(1);
  for (const r of layout.rooms) {
    let a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity;
    for (const p of r.polygon) { a0 = Math.min(a0, p.x); b0 = Math.min(b0, p.z); a1 = Math.max(a1, p.x); b1 = Math.max(b1, p.z); }
    for (let j = Math.floor((b0 - z0) / MAP_M); j <= Math.ceil((b1 - z0) / MAP_M); j++) {
      for (let i = Math.floor((a0 - x0) / MAP_M); i <= Math.ceil((a1 - x0) / MAP_M); i++) {
        if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
        if (pointInPolygon({ x: x0 + (i + 0.5) * MAP_M, z: z0 + (j + 0.5) * MAP_M }, r.polygon)) cells[j * nx + i] = 0;
      }
    }
  }
  holes.forEach((h, k) => {
    if (k > 250) return;
    const c = [[h.t.u0, 0], [h.t.u1, 0], [h.t.u1, h.t.depth], [h.t.u0, h.t.depth]].map(([u, o]) => ({ x: h.f.a.x + h.f.dir.x * u + h.f.out.x * o, z: h.f.a.z + h.f.dir.z * u + h.f.out.z * o }));
    const a0 = Math.min(...c.map((p) => p.x)), a1 = Math.max(...c.map((p) => p.x)), b0 = Math.min(...c.map((p) => p.z)), b1 = Math.max(...c.map((p) => p.z));
    for (let j = Math.floor((b0 - z0) / MAP_M); j <= Math.ceil((b1 - z0) / MAP_M); j++) {
      for (let i = Math.floor((a0 - x0) / MAP_M); i <= Math.ceil((a1 - x0) / MAP_M); i++) {
        if (i < 0 || j < 0 || i >= nx || j >= nz || cells[j * nx + i] !== 1) continue;
        const dx = x0 + (i + 0.5) * MAP_M - h.f.a.x, dz = z0 + (j + 0.5) * MAP_M - h.f.a.z;
        const u = dx * h.f.dir.x + dz * h.f.dir.z, o = dx * h.f.out.x + dz * h.f.out.z;
        if (u >= h.t.u0 && u <= h.t.u1 && o >= -1e-6 && o <= h.t.depth + 1e-6) cells[j * nx + i] = 2 + k;
      }
    }
  });
  return { layout, holes, doors: resolveDoors(layout), furniture: prop.furniture, map: { x0, z0, nx, nz, cells } };
}

export interface Hit { depth: number; what: string }

/** 0 air, 1 wall, 2 a frame post: what stands at (x, z) at height y */
function solidAt(tr: Truth, x: number, y: number, z: number): 0 | 1 | 2 {
  const m = tr.map;
  const i = Math.floor((x - m.x0) / MAP_M), j = Math.floor((z - m.z0) / MAP_M);
  if (i < 0 || j < 0 || i >= m.nx || j >= m.nz) return 1;
  const v = m.cells[j * m.nx + i];
  if (v === 0) return 0;
  if (v === 1) return y < tr.layout.wallHeightM ? 1 : 0;
  const h = tr.holes[v - 2];
  if (y < h.t.sillM || y > h.t.headM) return 1;
  if (h.door) {
    const u = (x - h.f.a.x) * h.f.dir.x + (z - h.f.a.z) * h.f.dir.z;
    const w = Math.min(DOOR_POST_M, (h.t.u1 - h.t.u0) / 2);
    if (u < h.t.u0 + w || u > h.t.u1 - w) return 2;
  }
  return 0;
}

/**
 * How far the point (x, y, z) is inside or beyond something solid, metres (0 when it is in the air on the walker's side), and what.
 * `root` is where the walker stands. Walls and frame posts: the length of the straight line from the walker to the point that lies past the
 * first solid surface it meets (so a hand through a thin wall into the next room counts in full), but never more than the distance to the
 * nearest room for a point inside a wall. A shut or open leaf: how far past its near face. Furniture: how far inside its box, below its top.
 */
export function penetration(tr: Truth, x: number, y: number, z: number, root: Vec2, leafPos: (id: string) => number = () => 0, withFurniture = true): Hit {
  const p = { x, z };
  let best: Hit = { depth: 0, what: '' };
  const take = (depth: number, what: string): void => { if (depth > best.depth) best = { depth, what }; };
  const dx = x - root.x, dz = z - root.z;
  const len = Math.hypot(dx, dz);
  const here = solidAt(tr, x, y, z);
  if (len > 0.12 || here !== 0) {
    const n = Math.max(1, Math.ceil(len / 0.01));
    for (let k = 1; k <= n; k++) {
      const s = solidAt(tr, root.x + (dx * k) / n, y, root.z + (dz * k) / n);
      if (s === 0) continue;
      let depth = len * (1 - (k - 1) / n);
      if (here === 1) {
        let d = Infinity;
        for (const r of tr.layout.rooms) for (let i = 0; i < r.polygon.length; i++) d = Math.min(d, distanceToSegment(p, r.polygon[i], r.polygon[(i + 1) % r.polygon.length]));
        depth = Math.min(depth, d);
      }
      take(depth, s === 2 ? 'post' : here === 0 ? 'through wall' : 'wall');
      break;
    }
  }
  for (const d of tr.doors) {
    if (y > d.topM) continue;
    const seg = leafSegment(d, leafPos(d.id));
    const nx = -seg.dir.z, nz = seg.dir.x;
    const along = (x - seg.a.x) * seg.dir.x + (z - seg.a.z) * seg.dir.z;
    if (along < 0 || along > d.panelWidthM) continue;
    const side = (x - seg.a.x) * nx + (z - seg.a.z) * nz;
    const rootSide = (root.x - seg.a.x) * nx + (root.z - seg.a.z) * nz;
    const half = DOOR_THICKNESS_M / 2;
    if (Math.sign(side) !== Math.sign(rootSide) && Math.abs(rootSide) < 1.2) take(Math.abs(side) + half, `leaf ${d.id}`);
    else if (Math.abs(side) < half) take(half - Math.abs(side), `leaf ${d.id}`);
  }
  if (withFurniture) {
    for (const it of tr.furniture) {
      if (it.heightM < 0.06 || y >= it.heightM) continue;
      if (!pointInBox(p, it.box)) continue;
      // how far to the nearest side of the box (the way out), or to its top
      let lo = 0, hi = Math.max(it.box.w, it.box.d) / 2;
      for (let k = 0; k < 12; k++) { const mid = (lo + hi) / 2; if (pointInBox(p, it.box, mid)) lo = mid; else hi = mid; }
      take(Math.min(lo, it.heightM - y), `furniture ${it.id}`);
    }
  }
  return best;
}

type Inner = { skinned: THREE.SkinnedMesh[] };
const V = new THREE.Vector3();

/** The worst penetration of the body as it is drawn now: every `stride`-th skinned vertex of every mesh. */
export function bodyPenetration(ch: Character, tr: Truth, opts: { stride?: number; leafPos?: (id: string) => number; furniture?: boolean } = {}): Hit & { at: [number, number, number]; mesh: string } {
  ch.object.updateMatrixWorld(true);
  const root = ch.position;
  let worst = { depth: 0, what: '', at: [0, 0, 0] as [number, number, number], mesh: '' };
  for (const s of (ch as unknown as Inner).skinned) {
    const n = s.geometry.attributes.position.count;
    for (let k = 0; k < n; k += opts.stride ?? 3) {
      s.getVertexPosition(k, V).applyMatrix4(s.matrixWorld);
      const h = penetration(tr, V.x, V.y, V.z, root, opts.leafPos, opts.furniture ?? true);
      if (h.depth > worst.depth) worst = { ...h, at: [V.x, V.y, V.z], mesh: s.name };
    }
  }
  return worst;
}

/** Named bones (shoulders, elbows, hands, head, knees, feet): the worst one, with its name. */
export function bonePenetration(ch: Character, tr: Truth, leafPos?: (id: string) => number): Hit & { bone: string } {
  ch.object.updateMatrixWorld(true);
  const root = ch.position;
  let worst = { depth: 0, what: '', bone: '' };
  for (const b of (ch as unknown as Inner).skinned[0].skeleton.bones) {
    if (!/^(head|neck_01|clavicle|upperarm|lowerarm|hand|thigh|calf|foot|ball|pelvis|spine_03)/i.test(b.name)) continue;
    b.getWorldPosition(V);
    const h = penetration(tr, V.x, V.y, V.z, root, leafPos);
    if (h.depth > worst.depth) worst = { ...h, bone: b.name };
  }
  return worst;
}
