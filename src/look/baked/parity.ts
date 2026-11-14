// SPEC 16.13: geometry parity. The bake must be made from exactly the geometry the scene data describes: the shell's floors, ceilings and
// walls must match the layout to a millimetre, a piece of furniture must stay inside its drawn box, and (checked in Blender, see
// tools/bake/bake_blender.py) every mesh must survive the round trip into the bake scene unchanged. Pure.
import { boxCorners } from '../../core/geometry';
import { computeEdgeFrames, computeWallPieces, pieceRect } from '../../core/layout-geom';
import type { FurnitureItem, Layout } from '../../types';
import type { DumpMesh } from './types';

export const PARITY_TOLERANCE_M = 0.001;

export type Box6 = [number, number, number, number, number, number];
export interface ParityFailure { key: string; what: string; deltaMm: number }
export interface ParityReport { ok: boolean; checked: number; failures: ParityFailure[]; maxDeltaMm: number }

const worst = (a: Box6, b: Box6): number => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

/** The boxes the layout says each shell mesh must occupy, keyed like the dump (`shell/floor:<room>` ...). */
export function expectedShellBoxes(layout: Layout): Map<string, Box6> {
  const out = new Map<string, Box6>();
  const frames = new Map(computeEdgeFrames(layout).map((f) => [`${f.roomId}:${f.edge}`, f]));
  const wall = new Map<string, Box6>();
  for (const p of computeWallPieces(layout)) {
    if (p.kind !== 'wall') continue;
    const f = frames.get(`${p.roomId}:${p.edge}`);
    if (!f) continue;
    const c = pieceRect(f, p);
    const b: Box6 = [Math.min(...c.map((q) => q.x)), p.y0, Math.min(...c.map((q) => q.z)), Math.max(...c.map((q) => q.x)), p.y1, Math.max(...c.map((q) => q.z))];
    const prev = wall.get(p.roomId);
    wall.set(p.roomId, prev ? [Math.min(prev[0], b[0]), Math.min(prev[1], b[1]), Math.min(prev[2], b[2]), Math.max(prev[3], b[3]), Math.max(prev[4], b[4]), Math.max(prev[5], b[5])] : b);
  }
  for (const r of layout.rooms) {
    if (r.polygon.length < 3 || r.partial) continue;
    const xs = r.polygon.map((p) => p.x), zs = r.polygon.map((p) => p.z);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    out.set(`shell/floor:${r.id}`, [x0, 0, z0, x1, 0, z1]);
    if (r.roomType !== 'balcony') out.set(`shell/ceiling:${r.id}`, [x0, layout.wallHeightM, z0, x1, layout.wallHeightM, z1]);
    const w = wall.get(r.id);
    if (w) out.set(`shell/walls:${r.id}`, w);
  }
  return out;
}

/** AABB of an item's rotated footprint, and its height. */
export function itemBox(item: FurnitureItem): Box6 {
  const cs = boxCorners(item.box);
  return [Math.min(...cs.map((c) => c.x)), 0, Math.min(...cs.map((c) => c.z)), Math.max(...cs.map((c) => c.x)), Math.max(item.heightM, item.surfaceHeightM), Math.max(...cs.map((c) => c.z))];
}

/**
 * Checks the dump against the scene data: shell meshes must equal the layout's boxes to 1 mm; furniture groups of the drawing must stay
 * inside their drawn box (plan) and height, to 1 mm. Meshes with nothing to compare with (kit, decor, items the buyer added) are not judged here.
 */
export function checkParity(meshes: Pick<DumpMesh, 'key' | 'bbox'>[], layout: Layout, items: FurnitureItem[], tol = PARITY_TOLERANCE_M, furnitureTol = tol): ParityReport {
  const failures: ParityFailure[] = [];
  let checked = 0, maxDelta = 0;
  const expected = expectedShellBoxes(layout);
  for (const m of meshes) {
    const e = expected.get(m.key);
    if (!e) continue;
    checked++;
    const d = worst(m.bbox, e);
    maxDelta = Math.max(maxDelta, d * 1000);
    if (d > tol) failures.push({ key: m.key, what: 'differs from the layout', deltaMm: d * 1000 });
  }
  const byGroup = new Map<string, Box6>();
  for (const m of meshes) {
    const g = /^furniture\/furniture:([^/]+)\//.exec(m.key);
    if (!g) continue;
    const prev = byGroup.get(g[1]);
    byGroup.set(g[1], prev ? [Math.min(prev[0], m.bbox[0]), Math.min(prev[1], m.bbox[1]), Math.min(prev[2], m.bbox[2]), Math.max(prev[3], m.bbox[3]), Math.max(prev[4], m.bbox[4]), Math.max(prev[5], m.bbox[5])] : [...m.bbox] as Box6);
  }
  for (const it of items) {
    const b = byGroup.get(it.id);
    if (!b) continue;
    checked++;
    const e = itemBox(it);
    const over = Math.max(e[0] - b[0], e[2] - b[2], b[3] - e[3], b[5] - e[5], b[4] - e[4]);
    if (over > 0) maxDelta = Math.max(maxDelta, over * 1000);
    if (over > furnitureTol) failures.push({ key: `furniture:${it.id}`, what: 'sticks out of its drawn box', deltaMm: over * 1000 });
  }
  return { ok: failures.length === 0, checked, failures, maxDeltaMm: maxDelta };
}
