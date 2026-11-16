// The outline of a union of axis-aligned rectangles (SPEC 19.3): an L-shaped pool is drawn as touching rectangles, and the deck needs one hole of its
// shape. Pure. Rectangles may touch or overlap; the result is the closed rectilinear polygons round the filled cells (the outer one first, then any holes),
// with collinear points removed, each wound clockwise on the plan (x east, z south) for an outer boundary.
import type { Vec2 } from '../types';
import type { Rect } from './types';

export function unionOutline(rects: readonly Rect[]): Vec2[][] {
  if (rects.length === 0) return [];
  const key = (v: number): number => Math.round(v * 1e4) / 1e4;
  const xs = [...new Set(rects.flatMap((r) => [key(r.x0), key(r.x1)]))].sort((a, b) => a - b);
  const zs = [...new Set(rects.flatMap((r) => [key(r.z0), key(r.z1)]))].sort((a, b) => a - b);
  const nx = xs.length - 1, nz = zs.length - 1;
  const filled = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < nx && j < nz && rects.some((r) => key(r.x0) <= xs[i] && key(r.x1) >= xs[i + 1] && key(r.z0) <= zs[j] && key(r.z1) >= zs[j + 1]);
  // directed boundary edges with the filled cell on the right (clockwise round an outer boundary on a plan with z down)
  const next = new Map<string, string[]>();
  const pt = (i: number, j: number): string => `${i},${j}`;
  const add = (a: string, b: string): void => { const l = next.get(a) ?? []; l.push(b); next.set(a, l); };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    if (!filled(i, j)) continue;
    if (!filled(i, j - 1)) add(pt(i, j), pt(i + 1, j));
    if (!filled(i + 1, j)) add(pt(i + 1, j), pt(i + 1, j + 1));
    if (!filled(i, j + 1)) add(pt(i + 1, j + 1), pt(i, j + 1));
    if (!filled(i - 1, j)) add(pt(i, j + 1), pt(i, j));
  }
  const loops: Vec2[][] = [];
  for (const start of [...next.keys()]) {
    while ((next.get(start) ?? []).length > 0) {
      const loop: string[] = [start];
      let cur = start;
      for (;;) {
        const outs = next.get(cur)!;
        const nxt = outs.shift()!;
        if (nxt === start) break;
        loop.push(nxt); cur = nxt;
        if (loop.length > 100000) throw new Error('unionOutline did not close');
      }
      const poly = loop.map((s) => { const [i, j] = s.split(',').map(Number); return { x: xs[i], z: zs[j] }; });
      // drop collinear points
      const out = poly.filter((p, k) => {
        const a = poly[(k + poly.length - 1) % poly.length], c = poly[(k + 1) % poly.length];
        return Math.abs((p.x - a.x) * (c.z - p.z) - (p.z - a.z) * (c.x - p.x)) > 1e-9;
      });
      loops.push(out);
    }
  }
  const area = (p: Vec2[]): number => p.reduce((s, q, k) => { const n = p[(k + 1) % p.length]; return s + (q.x * n.z - n.x * q.z); }, 0) / 2;
  return loops.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
}

/** `r` grown by `m` on every side */
export const growRect = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, z0: r.z0 - m, x1: r.x1 + m, z1: r.z1 + m });
