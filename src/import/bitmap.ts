// C8 helper (not in the 13.3 list, shared by walls / regions / furniture). A small page-space bitmap: polygon fill,
// thick segments, 4-connected flood fill and outer-contour tracing. Pure TypeScript.
import type { Px } from '../types';

export const FREE = 0;
export const WALL = 1;
export const BARRIER = 2;

export class Bitmap {
  readonly nx: number;
  readonly ny: number;
  readonly data: Uint8Array;
  constructor(readonly width: number, readonly height: number, readonly px: number) {
    this.nx = Math.max(1, Math.ceil(width / px));
    this.ny = Math.max(1, Math.ceil(height / px));
    this.data = new Uint8Array(this.nx * this.ny);
  }
  clone(): Bitmap { const b = new Bitmap(this.width, this.height, this.px); b.data.set(this.data); return b; }
  ix(x: number): number { return Math.floor(x / this.px); }
  iy(y: number): number { return Math.floor(y / this.px); }
  inside(i: number, j: number): boolean { return i >= 0 && j >= 0 && i < this.nx && j < this.ny; }
  get(i: number, j: number): number { return this.inside(i, j) ? this.data[j * this.nx + i] : 255; }
  at(p: Px): number { return this.get(this.ix(p.x), this.iy(p.y)); }
  centre(i: number, j: number): Px { return { x: (i + 0.5) * this.px, y: (j + 0.5) * this.px }; }

  /** Scanline fill (even-odd) of one ring; pixels whose centre is inside, value `v`. */
  fillRing(ring: Px[], v: number): void {
    if (ring.length < 3) return;
    let minY = Infinity; let maxY = -Infinity;
    for (const p of ring) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const j0 = Math.max(0, Math.floor(minY / this.px - 0.5)); const j1 = Math.min(this.ny - 1, Math.ceil(maxY / this.px));
    const xs: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const y = (j + 0.5) * this.px;
      xs.length = 0;
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k]; const b = ring[(k + 1) % ring.length];
        if ((a.y <= y) !== (b.y <= y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil(xs[k] / this.px - 0.5)); const i1 = Math.min(this.nx - 1, Math.floor(xs[k + 1] / this.px - 0.5));
        for (let i = i0; i <= i1; i++) this.data[j * this.nx + i] = v;
      }
    }
  }

  /** A segment of the given width (page units), as a filled rectangle. */
  drawSegment(a: Px, b: Px, width: number, v: number): void {
    const dx = b.x - a.x; const dy = b.y - a.y; const L = Math.hypot(dx, dy);
    if (L < 1e-9) return;
    const h = Math.max(width, this.px * 1.5) / 2;
    const nx = (-dy / L) * h; const ny = (dx / L) * h;
    this.fillRing([{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }], v);
  }

  /** 4-connected flood from (i, j) over pixels equal to FREE. Returns the region mask (1 = in). */
  flood(i: number, j: number): { mask: Uint8Array; count: number; touchesBorder: boolean } {
    const mask = new Uint8Array(this.nx * this.ny);
    let count = 0; let touchesBorder = false;
    if (!this.inside(i, j) || this.data[j * this.nx + i] !== FREE) return { mask, count, touchesBorder };
    const stack = [j * this.nx + i];
    mask[stack[0]] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const ci = k % this.nx; const cj = (k - ci) / this.nx;
      count++;
      if (ci === 0 || cj === 0 || ci === this.nx - 1 || cj === this.ny - 1) touchesBorder = true;
      if (ci > 0 && !mask[k - 1] && this.data[k - 1] === FREE) { mask[k - 1] = 1; stack.push(k - 1); }
      if (ci < this.nx - 1 && !mask[k + 1] && this.data[k + 1] === FREE) { mask[k + 1] = 1; stack.push(k + 1); }
      if (cj > 0 && !mask[k - this.nx] && this.data[k - this.nx] === FREE) { mask[k - this.nx] = 1; stack.push(k - this.nx); }
      if (cj < this.ny - 1 && !mask[k + this.nx] && this.data[k + this.nx] === FREE) { mask[k + this.nx] = 1; stack.push(k + this.nx); }
    }
    return { mask, count, touchesBorder };
  }

  /** nearest FREE pixel to (i, j) within r pixels (ring search), or null. */
  nearestFree(i: number, j: number, r: number): [number, number] | null {
    if (this.get(i, j) === FREE) return [i, j];
    for (let d = 1; d <= r; d++) {
      for (let dj = -d; dj <= d; dj++) for (let di = -d; di <= d; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== d) continue;
        if (this.get(i + di, j + dj) === FREE) return [i + di, j + dj];
      }
    }
    return null;
  }

  /** Outer boundary of a mask as a closed polyline in page units (pixel-corner vertices, collinear points merged). */
  outerContour(mask: Uint8Array): Px[] {
    const nx = this.nx; const ny = this.ny;
    const m = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < nx && j < ny && mask[j * nx + i] === 1;
    // directed boundary edges with the region on the left (in y-down, clockwise on screen)
    const next = new Map<number, number[]>();
    const key = (i: number, j: number): number => j * (nx + 1) + i;
    const add = (a: number, b: number): void => { const l = next.get(a); if (l) l.push(b); else next.set(a, [b]); };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!m(i, j)) continue;
      if (!m(i, j - 1)) add(key(i, j), key(i + 1, j));         // top edge, left to right
      if (!m(i + 1, j)) add(key(i + 1, j), key(i + 1, j + 1)); // right edge, downward
      if (!m(i, j + 1)) add(key(i + 1, j + 1), key(i, j + 1)); // bottom edge, right to left
      if (!m(i - 1, j)) add(key(i, j + 1), key(i, j));         // left edge, upward
    }
    const loops: Px[][] = [];
    const vis = new Set<string>();
    for (const [start, outs] of next) {
      for (const first of outs) {
        const ek = `${start}>${first}`;
        if (vis.has(ek)) continue;
        const pts: number[] = [];
        let a = start; let b = first;
        for (let guard = 0; guard < 4 * nx * ny + 8; guard++) {
          vis.add(`${a}>${b}`);
          pts.push(a);
          const cand = next.get(b) ?? [];
          // prefer the turn that keeps the region on the left (a right turn first keeps 4-connectivity of the interior)
          const ax = a % (nx + 1); const ay = (a - ax) / (nx + 1); const bx = b % (nx + 1); const by = (b - bx) / (nx + 1);
          const dx = bx - ax; const dy = by - ay;
          let pick = -1; let bestScore = -9;
          for (const c of cand) {
            if (vis.has(`${b}>${c}`)) continue;
            const cx = c % (nx + 1); const cy = (c - cx) / (nx + 1);
            const ex = cx - bx; const ey = cy - by;
            const cross = dx * ey - dy * ex; // y-down: positive = turn clockwise on screen (right turn)
            const score = cross > 0 ? 2 : cross === 0 ? 1 : 0; // right turn, straight, left turn
            if (score > bestScore) { bestScore = score; pick = c; }
          }
          if (pick < 0) break;
          a = b; b = pick;
          if (a === start && b === first) break;
        }
        if (pts.length >= 4) loops.push(pts.map((k) => { const x = k % (nx + 1); return { x: x * this.px, y: ((k - x) / (nx + 1)) * this.px }; }));
      }
    }
    let best: Px[] = []; let bestA = -1;
    for (const l of loops) {
      let s = 0; for (let k = 0; k < l.length; k++) { const p = l[k]; const q = l[(k + 1) % l.length]; s += p.x * q.y - q.x * p.y; }
      if (Math.abs(s) > bestA) { bestA = Math.abs(s); best = l; }
    }
    return mergeCollinear(best);
  }
}

export function mergeCollinear(pts: Px[], eps = 1e-9): Px[] {
  if (pts.length < 3) return pts;
  const out: Px[] = [];
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const a = pts[(k + n - 1) % n]; const b = pts[k]; const c = pts[(k + 1) % n];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) > eps) out.push(b);
  }
  return out;
}

/** Douglas-Peucker for a closed ring (splits at the two farthest-apart points). */
export function simplifyRing(ring: Px[], tol: number): Px[] {
  const n = ring.length;
  if (n <= 4) return ring;
  let i0 = 0; let i1 = 0; let best = -1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = Math.hypot(ring[i].x - ring[j].x, ring[i].y - ring[j].y);
    if (d > best) { best = d; i0 = i; i1 = j; }
  }
  const part = (from: number, to: number): Px[] => {
    const seg: Px[] = [];
    for (let k = from; ; k = (k + 1) % n) { seg.push(ring[k]); if (k === to) break; }
    return seg;
  };
  const dp = (pts: Px[]): Px[] => {
    if (pts.length < 3) return pts;
    const a = pts[0]; const b = pts[pts.length - 1];
    let md = -1; let mi = -1;
    for (let k = 1; k < pts.length - 1; k++) { const d = distPointSeg(pts[k], a, b); if (d > md) { md = d; mi = k; } }
    if (md <= tol) return [a, b];
    const l = dp(pts.slice(0, mi + 1)); const r = dp(pts.slice(mi));
    return [...l.slice(0, -1), ...r];
  };
  const A = dp(part(i0, i1)); const B = dp(part(i1, i0));
  return [...A.slice(0, -1), ...B.slice(0, -1)];
}

export function distPointSeg(p: Px, a: Px, b: Px): number {
  const dx = b.x - a.x; const dy = b.y - a.y; const L2 = dx * dx + dy * dy;
  if (L2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function ringArea(r: Px[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i]; const b = r[(i + 1) % r.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}
export function pointInRing(p: Px, r: Px[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]; const b = r[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
