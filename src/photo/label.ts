// C12f. SPEC 17.14: the label is drawn into the image's own pixels, so a saved or shared copy still carries it. Strokes come from
// the pinned Hershey face the drawing reader already uses (no canvas text, so Node and the browser draw the same thing).
import { layoutString, stringWidth } from '../understand/hershey';
import type { StrokeOpts } from '../understand/hershey';
import { PHOTO_LABEL } from './config';

const OPTS = (capH: number): StrokeOpts => ({ capH, face: 'simplex', slantDeg: 0, widthScale: 1 });
const PARTS = PHOTO_LABEL.split(' · ');

interface Layout { bandH: number; y0: number; mask: Uint8Array }

/** The ink mask of the label over the whole image (1 where a letter stroke is) and the band it sits in. */
function layoutLabel(w: number, h: number): Layout {
  const bandH = Math.max(22, Math.round(h * 0.052));
  const y0 = h - bandH;
  let capH = bandH * 0.46;
  const gap = capH * 1.4;
  const total = (c: number): number => PARTS.reduce((s, p) => s + stringWidth(p, OPTS(c)), 0) + gap * (PARTS.length - 1);
  while (total(capH) > w * 0.94 && capH > 6) capH -= 1;
  const g = capH * 1.4;
  const brush = Math.max(0.8, capH * 0.085);
  const mask = new Uint8Array(w * h);
  const stamp = (cx: number, cy: number): void => {
    const x0 = Math.max(0, Math.floor(cx - brush)), x1 = Math.min(w - 1, Math.ceil(cx + brush));
    const yy0 = Math.max(0, Math.floor(cy - brush)), yy1 = Math.min(h - 1, Math.ceil(cy + brush));
    for (let y = yy0; y <= yy1; y++) for (let x = x0; x <= x1; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= brush * brush + 0.2) mask[y * w + x] = 1;
  };
  const width = PARTS.reduce((s, p) => s + stringWidth(p, OPTS(capH)), 0) + g * (PARTS.length - 1);
  let pen = (w - width) / 2;
  const base = y0 + bandH / 2 + capH / 2;
  PARTS.forEach((part, i) => {
    for (const poly of layoutString(part, OPTS(capH))) {
      for (let k = 0; k + 1 < poly.length; k++) {
        const [ax, ay] = poly[k], [bx, by] = poly[k + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
        for (let t = 0; t <= n; t++) stamp(pen + ax + ((bx - ax) * t) / n, base - (ay + ((by - ay) * t) / n));
      }
      if (poly.length === 1) stamp(pen + poly[0][0], base - poly[0][1]);
    }
    pen += stringWidth(part, OPTS(capH));
    if (i < PARTS.length - 1) {
      // the middle dot between the parts
      const dr = brush * 1.5;
      const cx = pen + g / 2, cy = base - capH * 0.36;
      for (let y = Math.floor(cy - dr); y <= Math.ceil(cy + dr); y++) for (let x = Math.floor(cx - dr); x <= Math.ceil(cx + dr); x++) {
        if (x >= 0 && y >= 0 && x < w && y < h && (x - cx) ** 2 + (y - cy) ** 2 <= dr * dr) mask[y * w + x] = 1;
      }
      pen += g;
    }
  });
  // only the band can hold ink
  for (let y = 0; y < y0; y++) mask.fill(0, y * w, (y + 1) * w);
  return { bandH, y0, mask };
}

/** Darkens a band along the bottom edge and writes the label in white. Changes `rgba` in place and returns it. */
export function stampLabel(rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const { y0, mask } = layoutLabel(w, h);
  for (let y = y0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (mask[y * w + x]) { rgba[i] = 255; rgba[i + 1] = 255; rgba[i + 2] = 255; }
    else { rgba[i] = rgba[i] * 0.16 + 20 * 0.84; rgba[i + 1] = rgba[i + 1] * 0.16 + 20 * 0.84; rgba[i + 2] = rgba[i + 2] * 0.16 + 20 * 0.84; }
    rgba[i + 3] = 255;
  }
  return rgba;
}

/** Reads the pixels back: the letter strokes are white and the band around them is dark. A JPEG round trip still passes. */
export function labelPresent(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): boolean {
  const { y0, mask } = layoutLabel(w, h);
  let inkN = 0, inkOk = 0, bgN = 0, bgOk = 0;
  const lum = (i: number): number => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  for (let y = y0; y < h; y++) for (let x = 0; x < w; x++) {
    const m = mask[y * w + x];
    const i = (y * w + x) * 4;
    if (m) {
      // strokes are thin: judge the centre pixels of the stroke (all neighbours also ink) so edge blur is not held against it
      let all = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h || !mask[yy * w + xx]) all = false; }
      if (!all) continue;
      inkN++; if (lum(i) >= 200) inkOk++;
    } else {
      let near = false;
      for (let dy = -3; dy <= 3 && !near; dy++) for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) { near = true; break; }
      }
      if (near) continue;
      bgN++; if (lum(i) <= 90) bgOk++;
    }
  }
  return inkN > 20 && bgN > 100 && inkOk / inkN >= 0.9 && bgOk / bgN >= 0.95;
}
