// C12e. Where a source box sits in the picture of its page. A box in the understanding file is in page units: for a vector page the
// normalised frame of src/import/vector-page.ts (y down, turned so the text reads upright), for a picture the pixels of the
// uploaded image. The review step shows crops of the page render, so the box has to be carried back to render pixels. Pure.
import type { Rect } from './pixels/image';

export interface PageMeta {
  n: number;
  kind: 'vector' | 'raster';
  /** the render, relative to the scene's understand cache folder (never under public/) */
  file: string;
  /** render size, pixels */
  w: number; h: number;
  /** vector pages: render pixels per page point */
  pxPerPt?: number;
  /** vector pages: the raw page size in points and the turn `normalizePage` applied (degrees, as `dominantTextAngle`) */
  raw?: { width: number; height: number; phi: number };
  /** vector pages: the PDF's own /Rotate (clockwise degrees), which the renderer applies and pdf.js's operator list does not */
  pdfRotate?: number;
  /** picture pages: the quarter turn (degrees clockwise) the picture reader applied so the sheet reads upright */
  turnCw?: number;
}
export interface PagesFile { version: 1; pages: PageMeta[] }

const rnd = (v: number): number => Math.round(v);

/** Normalised page point -> render pixel. */
export function pointToPx(meta: PageMeta, p: [number, number]): [number, number] {
  if (meta.kind === 'raster' || !meta.raw || !meta.pxPerPt) return [p[0], p[1]];
  const { width: W, height: H, phi } = meta.raw;
  const rad = (phi * Math.PI) / 180;
  const c = rnd(Math.cos(rad)), s = rnd(Math.sin(rad));
  // the same corners normalizePage turned, to find the offset it removed
  const corners: [number, number][] = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => [c * x + s * y, -s * x + c * y]);
  const minX = Math.min(...corners.map((q) => q[0])), minY = Math.min(...corners.map((q) => q[1]));
  const rx = p[0] + minX, ry = p[1] + minY;
  // undo the turn: (x, yDown) in the raw page, y down
  const x = c * rx - s * ry, yd = s * rx + c * ry;
  let X = x, Y = yd, ww = W, hh = H;
  switch (((meta.pdfRotate ?? 0) % 360 + 360) % 360) {
    case 90: X = H - yd; Y = x; ww = H; hh = W; break;
    case 180: X = W - x; Y = H - yd; break;
    case 270: X = yd; Y = W - x; ww = H; hh = W; break;
  }
  void ww; void hh;
  return [X * meta.pxPerPt, Y * meta.pxPerPt];
}

/** Quarter turns (degrees clockwise) that make the render read upright: the importer's own turn, undone, plus the PDF's /Rotate. Raster pages are shown as they are. */
export function turnOf(meta: PageMeta): 0 | 90 | 180 | 270 {
  if (meta.kind === 'raster') return ((Math.round(((meta.turnCw ?? 0) % 360 + 360) % 360 / 90) * 90) % 360) as 0 | 90 | 180 | 270;
  if (!meta.raw) return 0;
  const t = (((-(meta.raw.phi + (meta.pdfRotate ?? 0))) % 360) + 360) % 360;
  return (Math.round(t / 90) * 90 % 360) as 0 | 90 | 180 | 270;
}

/** Where a box (render pixels) lands in a crop of `region` turned `turnCw` degrees clockwise, as fractions of the turned picture. */
export function boxInCrop(region: Rect, box: Rect, turnCw: 0 | 90 | 180 | 270): [number, number, number, number] {
  const w = region[2] - region[0], h = region[3] - region[1];
  const pt = (x: number, y: number): [number, number] => {
    const px = x - region[0], py = y - region[1];
    switch (turnCw) {
      case 90: return [(h - py) / h, px / w];
      case 180: return [(w - px) / w, (h - py) / h];
      case 270: return [py / h, (w - px) / w];
      default: return [px / w, py / h];
    }
  };
  const a = pt(box[0], box[1]), b = pt(box[2], box[3]);
  return [Math.max(0, Math.min(a[0], b[0])), Math.max(0, Math.min(a[1], b[1])), Math.min(1, Math.max(a[0], b[0])), Math.min(1, Math.max(a[1], b[1]))];
}

/** A box in page units as a rectangle of render pixels, clipped to the render. A degenerate box (no location known) is null. */
export function boxToPx(meta: PageMeta, box: [number, number, number, number]): Rect | null {
  if (!(box[2] - box[0] > 0) || !(box[3] - box[1] > 0)) return null;
  const pts = [pointToPx(meta, [box[0], box[1]]), pointToPx(meta, [box[2], box[1]]), pointToPx(meta, [box[2], box[3]]), pointToPx(meta, [box[0], box[3]])];
  const x0 = Math.min(...pts.map((q) => q[0])), x1 = Math.max(...pts.map((q) => q[0]));
  const y0 = Math.min(...pts.map((q) => q[1])), y1 = Math.max(...pts.map((q) => q[1]));
  return [Math.max(0, x0), Math.max(0, y0), Math.min(meta.w, x1), Math.min(meta.h, y1)];
}

/**
 * The patch of the page to show for a box: the box plus context, with a floor so a small text box still shows its neighbourhood and
 * a ceiling so a whole-room box does not become the whole page. No box (not located): the whole page.
 */
export function cropRegion(meta: PageMeta, box: [number, number, number, number]): { region: Rect; box: Rect | null } {
  const b = boxToPx(meta, box);
  if (!b) return { region: [0, 0, meta.w, meta.h], box: null };
  const w = b[2] - b[0], h = b[3] - b[1];
  const unit = meta.kind === 'vector' && meta.pxPerPt ? meta.pxPerPt * 72 : Math.max(meta.w, meta.h) / 12; // about an inch of the sheet
  const padX = Math.max(0.35 * w, 0.8 * unit), padY = Math.max(0.35 * h, 0.5 * unit);
  let x0 = b[0] - padX, y0 = b[1] - padY, x1 = b[2] + padX, y1 = b[3] + padY;
  // keep a reasonable aspect: not thinner than 1 : 3
  const rw = x1 - x0, rh = y1 - y0;
  if (rh < rw / 3) { const d = (rw / 3 - rh) / 2; y0 -= d; y1 += d; }
  if (rw < rh / 3) { const d = (rh / 3 - rw) / 2; x0 -= d; x1 += d; }
  const clip = (lo: number, hi: number, max: number): [number, number] => { const len = hi - lo; if (len >= max) return [0, max]; let a = lo, z = hi; if (a < 0) { z -= a; a = 0; } if (z > max) { a -= z - max; z = max; } return [Math.max(0, a), Math.min(max, z)]; };
  const [cx0, cx1] = clip(x0, x1, meta.w), [cy0, cy1] = clip(y0, y1, meta.h);
  return { region: [Math.round(cx0), Math.round(cy0), Math.round(cx1), Math.round(cy1)], box: b };
}
