// C12c. Rooms with no label. C8 finds a room by flooding from its label, so a plan with no room names (a bare brochure
// drawing, or a room the designer did not name) gave no rooms at all. Here every free space the walls close off, that no label
// already claimed, becomes a room of type "other" with its polygon; the symbols found inside later give it a type (bed means
// bedroom, hob means kitchen, and so on, in understand/room-types.ts). Pure TypeScript.
import type { Px } from '../types';
import type { Bitmap } from '../import/bitmap';
import { FREE, ringArea } from '../import/bitmap';
import type { WallSet } from '../import/walls';
import { polygonFromMask } from '../import/regions';
import type { RoomLabel } from '../import/labels';
import type { RegionResult } from '../import/regions';

export interface UnlabelledOptions { minAreaInT2?: number; maxShareOfPlan?: number }

/** Enclosed free regions of `bm` that contain none of `claimed` (page-unit points: label centres and traced rooms' interior points). */
export function findUnlabelledRegions(bm: Bitmap, walls: WallSet, claimed: Px[], lines: Parameters<typeof polygonFromMask>[3], opts: UnlabelledOptions = {}): RegionResult[] {
  const t = walls.t;
  const minPx = ((opts.minAreaInT2 ?? 25) * t * t) / (bm.px * bm.px);
  const nx = bm.nx, ny = bm.ny, N = nx * ny;
  const label = new Int32Array(N); // 0 = none
  const stack = new Int32Array(N);
  const comps: { id: number; count: number; border: boolean }[] = [];
  let id = 0;
  for (let k0 = 0; k0 < N; k0++) {
    if (label[k0] || bm.data[k0] !== FREE) continue;
    id++;
    let sp = 0, count = 0, border = false;
    stack[sp++] = k0; label[k0] = id;
    while (sp) {
      const k = stack[--sp];
      count++;
      const i = k % nx, j = (k - i) / nx;
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) border = true;
      if (i > 0 && !label[k - 1] && bm.data[k - 1] === FREE) { label[k - 1] = id; stack[sp++] = k - 1; }
      if (i < nx - 1 && !label[k + 1] && bm.data[k + 1] === FREE) { label[k + 1] = id; stack[sp++] = k + 1; }
      if (j > 0 && !label[k - nx] && bm.data[k - nx] === FREE) { label[k - nx] = id; stack[sp++] = k - nx; }
      if (j < ny - 1 && !label[k + nx] && bm.data[k + nx] === FREE) { label[k + nx] = id; stack[sp++] = k + nx; }
    }
    comps.push({ id, count, border });
  }
  const claimedIds = new Set<number>();
  for (const p of claimed) {
    const i = bm.ix(p.x), j = bm.iy(p.y);
    if (!bm.inside(i, j)) continue;
    const near = bm.nearestFree(i, j, Math.ceil((2 * t) / bm.px));
    if (near) claimedIds.add(label[near[1] * nx + near[0]]);
  }
  const out: RegionResult[] = [];
  const maxPx = (opts.maxShareOfPlan ?? 0.6) * N;
  for (const c of comps) {
    if (c.border || claimedIds.has(c.id) || c.count < minPx || c.count > maxPx) continue;
    const mask = new Uint8Array(N);
    let sx = 0, sy = 0;
    for (let k = 0; k < N; k++) if (label[k] === c.id) { mask[k] = 1; sx += k % nx; sy += Math.floor(k / nx); }
    const polygon = polygonFromMask(bm, mask, walls, lines);
    if (polygon.length < 3) continue;
    const centre: Px = bm.centre(Math.round(sx / c.count), Math.round(sy / c.count));
    const bbox: [number, number, number, number] = [Math.min(...polygon.map((p) => p.x)), Math.min(...polygon.map((p) => p.y)), Math.max(...polygon.map((p) => p.x)), Math.max(...polygon.map((p) => p.y))];
    const label0: RoomLabel = { kind: 'room', block: { lines: [], angle: 0, centre, bbox, size: 0 }, name: 'Room', roomType: 'other', centre };
    out.push({ label: label0, method: 'walls', polygon, areaPt2: Math.abs(ringArea(polygon)), barrierSegments: [] });
  }
  return out;
}
