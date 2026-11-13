// Synthetic brochure plans as pictures, for the local raster path (no model, no real file). A flat is a grid of rectangular rooms with
// thick dark walls between them, a light floor fill, door and window gaps in the walls, some furniture, and a label in each room (name and
// printed size). The truth is exact because the picture is drawn from it. Labels are returned as the reader would find them (box, name,
// size candidates), so the geometry and honesty checks can be tested with no OCR engine. Seeded; pure TypeScript.
import { mulberry32 } from '../../src/core/geometry';
import type { Gray } from './raster';
import type { LocalLabel } from '../../src/understand/raster-local';

export interface BrochureRoom { name: string; /** interior size, metres */ w: number; l: number; /** interior top-left, metres */ x: number; y: number; /** printed instead of the true size (a planted wrong label) */ printed?: { w: number; l: number } }
export interface Brochure { image: Gray; labels: LocalLabel[]; pxPerM: number; rooms: BrochureRoom[] }

/** A 2 BHK: living and a bedroom on top, kitchen, toilet, bedroom and balcony below. Interiors in metres, walls 0.2 m between. */
export function twoBhk(): BrochureRoom[] {
  return [
    { name: 'Living/Dining', w: 5.0, l: 3.4, x: 0, y: 0 },
    { name: 'Bedroom', w: 3.6, l: 3.4, x: 5.2, y: 0 },
    { name: 'Kitchen', w: 2.8, l: 2.4, x: 0, y: 3.6 },
    { name: 'Toilet', w: 1.6, l: 2.4, x: 3.0, y: 3.6 },
    { name: 'Bedroom', w: 3.4, l: 3.0, x: 4.8, y: 3.6 },
    { name: 'Balcony', w: 2.0, l: 1.4, x: 0, y: 6.2 },
  ];
}

export function drawBrochure(rooms: BrochureRoom[], opts: { pxPerM?: number; seed?: number; fill?: number; wall?: number } = {}): Brochure {
  const s = opts.pxPerM ?? 50, rnd = mulberry32(opts.seed ?? 1), wallV = opts.wall ?? 100, fillV = opts.fill ?? 225;
  const wt = 0.2 * s;
  const maxX = Math.max(...rooms.map((r) => r.x + r.w)), maxY = Math.max(...rooms.map((r) => r.y + r.l));
  const pad = 60, W = Math.round(maxX * s + 2 * pad + wt), H = Math.round(maxY * s + 2 * pad + wt);
  const image: Gray = { width: W, height: H, data: new Uint8ClampedArray(W * H).fill(255) };
  const px = (m: number, off: number): number => off + m * s;
  const rect = (x0: number, y0: number, x1: number, y1: number, v: number): void => { for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y1)); y++) for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x1)); x++) image.data[y * W + x] = v; };
  // walls first (a band around every room), then the floors on top, then the gaps and the furniture
  for (const r of rooms) rect(px(r.x, pad) - wt, px(r.y, pad) - wt, px(r.x + r.w, pad) + wt, px(r.y + r.l, pad) + wt, wallV);
  for (const r of rooms) rect(px(r.x, pad), px(r.y, pad), px(r.x + r.w, pad), px(r.y + r.l, pad), fillV);
  // a door gap of 0.9 m in one wall of each room that has a neighbour to the left or above, and a window gap in the outer wall
  for (const r of rooms) {
    const x0 = px(r.x, pad), y0 = px(r.y, pad), x1 = px(r.x + r.w, pad), y1 = px(r.y + r.l, pad);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    // doors sit toward a corner, as drawn plans put them, so they do not line up with the middle of the room
    const dy = y0 + 0.28 * (y1 - y0), dx = x0 + 0.28 * (x1 - x0);
    if (r.x > 0.1) rect(x0 - wt, dy - 0.4 * s, x0, dy + 0.4 * s, fillV);
    else if (r.y > 0.1) rect(dx - 0.4 * s, y0 - wt, dx + 0.4 * s, y0, fillV);
    // a window only in an outer wall
    if (r.x + r.w >= maxX - 0.01) rect(x1, cy - 0.5 * s, x1 + wt, cy + 0.5 * s, 200);
    // furniture: a thin outlined block and a small dark one off the label
    const fw = Math.min(1.8, 0.4 * r.w) * s, fh = Math.min(1.2, 0.3 * r.l) * s;
    const fx = x0 + 0.1 * s, fy = y1 - fh - 0.1 * s;
    rect(fx, fy, fx + fw, fy + 1.5, 60); rect(fx, fy + fh - 1.5, fx + fw, fy + fh, 60); rect(fx, fy, fx + 1.5, fy + fh, 60); rect(fx + fw - 1.5, fy, fx + fw, fy + fh, 60);
    rect(x1 - 0.5 * s, y0 + 0.2 * s, x1 - 0.2 * s, y0 + 0.5 * s, 90);
  }
  // light noise, as a scan has
  for (let i = 0; i < image.data.length; i++) image.data[i] = Math.max(0, Math.min(255, image.data[i] + (rnd() - 0.5) * 8));
  const labels: LocalLabel[] = rooms.map((r, i) => {
    const p = r.printed ?? { w: r.w, l: r.l };
    const cx = px(r.x + r.w / 2, pad), cy = px(r.y + r.l / 2, pad);
    const lineH = 10;
    return { id: `lbl-${i + 1}`, name: r.name, text: `${r.name} ${p.w.toFixed(2)}x${p.l.toFixed(2)}`, cands: [{ w: p.w, l: p.l, rank: 0, text: '' }], rect: [cx - 40, cy - lineH, cx + 40, cy + lineH], lineH, twoReads: true };
  });
  return { image, labels, pxPerM: s, rooms };
}
