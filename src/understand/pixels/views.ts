// C12d. SPEC 17.4 "views" for raster pages, and the privacy rule of 17.16 item 10: split a page image into groups of linework
// separated by white gaps wider than 5% of the page, and decide for each group whether it is a DRAWING (plan, elevation),
// a TEXT BLOCK (title block, notes, legend, schedule) or NOISE. Text blocks are whited out before any pixel leaves the machine.
// The test is by shape, never by words, so it works on a page in any language. Pure TypeScript.
import { newGray } from './image';
import type { Gray, Rect } from './image';

export type ViewKind = 'drawing' | 'text' | 'noise' | 'linework';
export interface View { id: string; rect: Rect; kind: ViewKind; /** share of the page area */ areaFrac: number; inkPx: number; thickFrac: number; glyphs: number; framed: boolean; longLines: number; reason: string }

/** Ink mask on a block grid: a block is ink when any of its pixels is dark, so hairlines survive the shrink. */
export function inkBlocks(g: Gray, k: number, thr = 195): { w: number; h: number; ink: Uint8Array } {
  const w = Math.ceil(g.width / k), h = Math.ceil(g.height / k);
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < g.height; y++) {
    const by = (y / k) | 0;
    for (let x = 0; x < g.width; x++) if (g.data[y * g.width + x] < thr) ink[by * w + ((x / k) | 0)] = 1;
  }
  return { w, h, ink };
}
function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) { if (src[y * w + x]) last = x; if (x - last <= r) t[y * w + x] = 1; }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (src[y * w + x]) last = x; if (last - x <= r) t[y * w + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) { if (t[y * w + x]) last = y; if (y - last <= r) o[y * w + x] = 1; }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) last = y; if (last - y <= r) o[y * w + x] = 1; }
  }
  return o;
}
function components(mask: Uint8Array, w: number, h: number): { label: Int32Array; boxes: Rect[]; count: number } {
  const label = new Int32Array(w * h); const boxes: Rect[] = []; let id = 0;
  const stack = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i]) continue;
    id++; let sp = 0; stack[sp++] = i; label[i] = id;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (sp) {
      const q = stack[--sp]; const x = q % w, y = (q / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx; if (mask[n] && !label[n]) { label[n] = id; stack[sp++] = n; }
      }
    }
    boxes.push([x0, y0, x1 + 1, y1 + 1]);
  }
  return { label, boxes, count: id };
}

/**
 * The sheet's border frame: a thin line along each edge, a few percent in from the paper edge, inked along most of its length
 * (compression and shading may break it). Erase those lines so the frame does not join everything to everything. A wall is thick,
 * so a row is only a frame line when the rows a few blocks either side of it are nearly empty.
 */
function eraseFrame(ink: Uint8Array, w: number, h: number): void {
  const band = 0.07;
  const rowCov = (y: number): number => { if (y < 0 || y >= h) return 0; let n = 0; for (let x = 0; x < w; x++) n += ink[y * w + x]; return n / w; };
  const colCov = (x: number): number => { if (x < 0 || x >= w) return 0; let n = 0; for (let y = 0; y < h; y++) n += ink[y * w + x]; return n / h; };
  for (let y = 0; y < h; y++) {
    if (y > band * h && y < (1 - band) * h) continue;
    if (rowCov(y) > 0.55 && rowCov(y - 3) < 0.3 && rowCov(y + 3) < 0.3) for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) ink.fill(0, yy * w, (yy + 1) * w);
  }
  for (let x = 0; x < w; x++) {
    if (x > band * w && x < (1 - band) * w) continue;
    if (colCov(x) > 0.55 && colCov(x - 3) < 0.3 && colCov(x + 3) < 0.3) for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) for (let y = 0; y < h; y++) ink[y * w + xx] = 0;
  }
}
/**
 * The sheet's border, however slightly tilted or broken by compression, is one ink component that spans nearly the whole page
 * and is hollow. A plan, however big, has solid walls in it. Erase the hollow giants.
 */
function eraseHollowFrames(ink: Uint8Array, w: number, h: number): void {
  const { label, boxes, count } = components(ink, w, h);
  const thick = erode1(ink, w, h);
  for (let c = 1; c <= count; c++) {
    const [x0, y0, x1, y1] = boxes[c - 1];
    if (x1 - x0 < 0.7 * w || y1 - y0 < 0.7 * h) continue;
    let n = 0, t = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; if (label[i] === c) { n++; if (thick[i]) t++; } }
    if (t / Math.max(1, n) < 0.05 && n < 0.06 * (x1 - x0) * (y1 - y0)) {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; if (label[i] === c) ink[i] = 0; }
    }
  }
}
function erode1(src: Uint8Array, w: number, h: number): Uint8Array {
  const o = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (src[i] && src[i - 1] && src[i + 1] && src[i - w] && src[i + w]) o[i] = 1;
  }
  return o;
}

/** `textHints`: rectangles (in this image's pixels) a model reported as title block, notes, legend or schedule. */
export interface FindViewsOpts { gapFrac?: number; blockPx?: number; textHints?: Rect[] }
/** Split a page image into views. Rectangles are in the image's own pixels. */
export function findViews(g: Gray, opts: FindViewsOpts = {}): { views: View[]; blockPx: number } {
  const long = Math.max(g.width, g.height);
  const k = opts.blockPx ?? Math.max(1, Math.floor(long / 700));
  const { w, h, ink } = inkBlocks(g, k);
  eraseFrame(ink, w, h);
  eraseHollowFrames(ink, w, h);
  const thick = erode1(ink, w, h);
  const gap = Math.max(2, Math.round(((opts.gapFrac ?? 0.02) * Math.max(w, h)) / 2));
  const joined = dilate(ink, w, h, gap);
  const { label, boxes, count } = components(joined, w, h);
  // glyph-sized components of the undilated ink, to tell text from line work
  const small = components(ink, w, h);
  const hp = Math.max(w, h);
  const glyphLo = Math.max(2, 0.0035 * hp), glyphHi = 0.03 * hp;
  const views: View[] = [];
  for (let c = 1; c <= count; c++) {
    const [x0, y0, x1, y1] = boxes[c - 1];
    let inkPx = 0, thickPx = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; if (label[i] === c) { if (ink[i]) inkPx++; if (thick[i]) thickPx++; } }
    if (inkPx < 6) continue;
    let glyphs = 0, longLines = 0;
    for (let s = 1; s <= small.count; s++) {
      const b = small.boxes[s - 1];
      const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      if (cx < x0 || cx >= x1 || cy < y0 || cy >= y1 || label[Math.floor(cy) * w + Math.floor(cx)] !== c) continue;
      const bw = b[2] - b[0], bh = b[3] - b[1];
      if (Math.max(bw, bh) >= glyphLo && Math.max(bw, bh) <= glyphHi && Math.min(bw, bh) >= 1 && Math.max(bw, bh) / Math.min(bw, bh) < 8) glyphs++;
      if (Math.max(bw, bh) > 0.6 * Math.max(x1 - x0, y1 - y0) && Math.min(bw, bh) <= 3) longLines++;
    }
    const areaFrac = ((x1 - x0) * (y1 - y0)) / (w * h);
    const thickFrac = thickPx / inkPx;
    const framed = longLines >= 3;
    let kind: ViewKind, reason: string;
    if (thickFrac >= 0.1 && areaFrac >= 0.03) { kind = 'drawing'; reason = 'solid wall-like ink'; }
    else if (areaFrac >= 0.14) { kind = 'drawing'; reason = 'large line drawing'; }
    else if (framed && glyphs >= 3) { kind = 'text'; reason = 'ruled block with text'; }
    else if (glyphs >= 8 && longLines === 0) { kind = 'text'; reason = 'text lines with no drawing in them'; }
    else if (glyphs >= 3 || longLines > 0) { kind = 'linework'; reason = 'thin lines and figures: a dimension chain or a detail'; }
    else { kind = 'noise'; reason = 'specks or a hatch patch'; }
    views.push({ id: `v${views.length + 1}`, rect: [x0 * k, y0 * k, Math.min(g.width, x1 * k), Math.min(g.height, y1 * k)], kind, areaFrac, inkPx, thickFrac, glyphs, framed, longLines, reason });
  }
  // areas a model called title block, notes or legend: any group mostly inside one is text, and the area is blanked whatever the pixels say
  const hints = opts.textHints ?? [];
  if (hints.length) {
    const ov = (a: Rect, b: Rect): number => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    for (const v of views) {
      if (v.kind === 'text') continue;
      const va = (v.rect[2] - v.rect[0]) * (v.rect[3] - v.rect[1]);
      if (hints.some((hr) => ov(v.rect, hr) >= 0.6 * va)) { v.kind = 'text'; v.reason = 'a model reported a title block or notes here'; }
    }
    hints.forEach((hr) => views.push({ id: 'h', rect: [Math.max(0, hr[0]), Math.max(0, hr[1]), Math.min(g.width, hr[2]), Math.min(g.height, hr[3])], kind: 'text', areaFrac: ((hr[2] - hr[0]) * (hr[3] - hr[1])) / (g.width * g.height), inkPx: 0, thickFrac: 0, glyphs: 0, framed: false, longLines: 0, reason: 'model-reported text area' }));
  }
  // thin line work next to a drawing belongs to it (dimension chains stand a little way off the walls); on its own it is noise
  const reach = 0.06 * Math.max(g.width, g.height);
  const dist = (a: Rect, b: Rect): number => Math.hypot(Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2])), Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3])));
  for (const v of views.filter((x) => x.kind === 'linework')) {
    const host = views.filter((x) => x.kind === 'drawing').sort((a, b) => dist(a.rect, v.rect) - dist(b.rect, v.rect))[0];
    if (host && dist(host.rect, v.rect) <= reach) {
      host.rect = [Math.min(host.rect[0], v.rect[0]), Math.min(host.rect[1], v.rect[1]), Math.max(host.rect[2], v.rect[2]), Math.max(host.rect[3], v.rect[3])];
      host.inkPx += v.inkPx; host.glyphs += v.glyphs; v.kind = 'noise'; v.reason = 'merged into the drawing beside it'; v.inkPx = 0;
    } else if (v.areaFrac >= 0.02) { v.kind = 'drawing'; v.reason = 'line work on its own'; } else { v.kind = 'noise'; v.reason = 'thin lines on their own'; }
  }
  // text that sits inside a drawing is the drawing's own labels (room names, furniture notes), not a title block or notes
  for (const v of views.filter((x) => x.kind === 'text' && !x.reason.startsWith('model-reported') && !x.reason.startsWith('a model reported'))) {
    const ta = (v.rect[2] - v.rect[0]) * (v.rect[3] - v.rect[1]);
    const inside = views.some((d) => d.kind === 'drawing' && Math.max(0, Math.min(d.rect[2], v.rect[2]) - Math.max(d.rect[0], v.rect[0])) * Math.max(0, Math.min(d.rect[3], v.rect[3]) - Math.max(d.rect[1], v.rect[1])) >= 0.6 * ta);
    if (inside) { v.kind = 'noise'; v.reason = 'labels inside the drawing'; }
  }
  for (const v of views) if (v.kind === 'drawing') v.areaFrac = ((v.rect[2] - v.rect[0]) * (v.rect[3] - v.rect[1])) / (g.width * g.height);
  const keep = views.filter((v) => !(v.kind === 'noise' && v.reason.startsWith('merged')));
  views.length = 0; views.push(...keep);
  views.sort((a, b) => b.areaFrac - a.areaFrac).forEach((v, i) => { v.id = `v${i + 1}`; });
  return { views, blockPx: k };
}

/** The pixels of a page with every text block painted white. */
export function redactTextBlocks(g: Gray, views: View[], padFrac = 0.01): Gray {
  const out = newGray(g.width, g.height); out.data.set(g.data);
  const pad = padFrac * Math.max(g.width, g.height);
  for (const v of views) if (v.kind === 'text') {
    const x0 = Math.max(0, Math.floor(v.rect[0] - pad)), y0 = Math.max(0, Math.floor(v.rect[1] - pad)), x1 = Math.min(g.width, Math.ceil(v.rect[2] + pad)), y1 = Math.min(g.height, Math.ceil(v.rect[3] + pad));
    for (let y = y0; y < y1; y++) out.data.fill(255, y * g.width + x0, y * g.width + x1);
  }
  return out;
}

