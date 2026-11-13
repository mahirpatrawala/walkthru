// A room that is not closed by walls on the drawing (a sliding door leaves its wall open, a hatched wall misses a stretch) is drawn as a
// rectangle of the size printed in it. Where that rectangle goes is not guessed from rays from the label (a ray can leave through the
// opening): every position that holds the label is tried, and the one wins whose rectangle holds no wall, overlaps no room already
// found, and has walls flush against its four sides. Pure TypeScript, page units.
import type { Px } from '../types';
import { Bitmap, WALL } from './bitmap';

export interface RectFit { polygon: Px[]; /** share of the four sides that has wall right outside it, 0 to 1 */ contact: number; /** the smallest of the four */ weakest: number }

/** Summed-area table of a 0/1 mask. */
class Integral {
  private readonly s: Float64Array; private readonly w: number;
  constructor(mask: (k: number) => number, readonly nx: number, readonly ny: number) {
    this.w = nx + 1; this.s = new Float64Array((nx + 1) * (ny + 1));
    for (let j = 0; j < ny; j++) { let row = 0; for (let i = 0; i < nx; i++) { row += mask(j * nx + i); this.s[(j + 1) * this.w + i + 1] = this.s[j * this.w + i + 1] + row; } }
  }
  /** sum over cells i0 <= i < i1, j0 <= j < j1 (clamped) */
  sum(i0: number, j0: number, i1: number, j1: number): number {
    const a = Math.max(0, Math.min(this.nx, i0)), b = Math.max(0, Math.min(this.nx, i1)), c = Math.max(0, Math.min(this.ny, j0)), d = Math.max(0, Math.min(this.ny, j1));
    if (b <= a || d <= c) return 0;
    return this.s[d * this.w + b] - this.s[c * this.w + b] - this.s[d * this.w + a] + this.s[c * this.w + a];
  }
}

/**
 * The rectangle of W x H page units (either way round) that holds `label`, lies in free space, overlaps nothing in `taken`, and has the
 * most wall against its sides. `t` is the wall thickness. Null when no position qualifies (the caller keeps its own placement).
 */
export function fitLabelRect(walls: Bitmap, taken: Uint8Array | null, label: Px, W: number, H: number, t: number): RectFit | null {
  const px = walls.px, nx = walls.nx, ny = walls.ny;
  const wallI = new Integral((k) => (walls.data[k] === WALL ? 1 : 0), nx, ny);
  const takenI = taken ? new Integral((k) => taken[k], nx, ny) : null;
  const inset = Math.max(1, Math.round((0.3 * t) / px));
  const b0 = Math.max(1, Math.round((0.25 * t) / px)), b1 = Math.max(b0 + 1, Math.round((0.8 * t) / px));
  let best: (RectFit & { score: number }) | null = null;
  for (const [w, h] of W === H ? [[W, H]] : [[W, H], [H, W]]) {
    const wi = Math.round(w / px), hi = Math.round(h / px);
    const lx = label.x / px, ly = label.y / px;
    // the label sits inside the room, a little in from its sides
    const margin = Math.round((0.5 * t) / px);
    for (let i0 = Math.round(lx - wi + margin); i0 <= Math.round(lx - margin); i0++) for (let j0 = Math.round(ly - hi + margin); j0 <= Math.round(ly - margin); j0++) {
      const i1 = i0 + wi, j1 = j0 + hi;
      const area = Math.max(1, (wi - 2 * inset) * (hi - 2 * inset));
      if (wallI.sum(i0 + inset, j0 + inset, i1 - inset, j1 - inset) > 0.02 * area) continue;
      if (takenI && takenI.sum(i0 + inset, j0 + inset, i1 - inset, j1 - inset) > 0.02 * area) continue;
      // the walls right outside each side
      const sides = [
        wallI.sum(i0, j0 - b1, i1, j0 - b0) / (wi * (b1 - b0)),
        wallI.sum(i0, j1 + b0, i1, j1 + b1) / (wi * (b1 - b0)),
        wallI.sum(i0 - b1, j0, i0 - b0, j1) / (hi * (b1 - b0)),
        wallI.sum(i1 + b0, j0, i1 + b1, j1) / (hi * (b1 - b0)),
      ];
      const contact = sides.reduce((a, b) => a + b, 0) / 4, weakest = Math.min(...sides);
      const near = Math.hypot((i0 + i1) / 2 - lx, (j0 + j1) / 2 - ly) * px / Math.max(1, Math.max(W, H));
      const score = contact - 0.05 * near;
      if (!best || score > best.score) best = { polygon: [{ x: i0 * px, y: j0 * px }, { x: i1 * px, y: j0 * px }, { x: i1 * px, y: j1 * px }, { x: i0 * px, y: j1 * px }], contact, weakest, score };
    }
  }
  return best ? { polygon: best.polygon, contact: best.contact, weakest: best.weakest } : null;
}

/** A polygon rasterised into `mask` (1 = taken). */
export function markTaken(mask: Uint8Array, walls: Bitmap, ring: Px[]): void {
  const tmp = new Bitmap(walls.width, walls.height, walls.px);
  tmp.fillRing(ring, WALL);
  for (let k = 0; k < mask.length; k++) if (tmp.data[k] === WALL) mask[k] = 1;
}
