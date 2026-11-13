// C8. SPEC 13.5 steps 0 and 1: the neutral page model, normalisation (y flip + rotation) and page classification.
// Pure TypeScript, no DOM, no pdf.js.
import type { Px } from '../types';
import type { PageKind, VectorPage, VFill, VStroke, VText } from './types';
import { isRoomLabel, pageKindWords } from '../understand/lexicon';

// SPEC-GAP: SPEC 13.4 types VectorPage as already-normalised ("y DOWN, text reads left to right") but 13.5 step 0
// has `normalizePage` do the y flip and the rotation, and 13.11 item 2 tests it on `buildDrawingPages` output.
// So the adapter and the fixture produce PDF user space (y UP, text angles as written) and `normalizePage` returns a
// page with `normalized: true`. The marker makes a second call a no-op instead of a mirror.
export type NormalizableVectorPage = VectorPage & { normalized?: boolean; rotationDeg?: number };

const snap90 = (deg: number): number => ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
const wrap180 = (d: number): number => { let a = ((d % 360) + 360) % 360; if (a > 180) a -= 360; return a; };

/** Dominant text angle after the y flip, weighted by string length, snapped to 0 / 90 / 180 / 270. */
export function dominantTextAngle(texts: VText[]): number {
  const w = new Map<number, number>();
  for (const t of texts) {
    const a = snap90(-t.angle); // y flip negates the angle
    w.set(a, (w.get(a) ?? 0) + t.str.length);
  }
  let best = 0; let bw = -1;
  for (const [a, v] of w) if (v > bw) { bw = v; best = a; }
  return best;
}

/**
 * Step 0. Flip y so it points down, then rotate the whole page so the dominant text reads left to right.
 * Rotation only, never a mirror.
 */
export function normalizePage(page: VectorPage): NormalizableVectorPage {
  const p = page as NormalizableVectorPage;
  if (p.normalized) return p;
  const H = page.height;
  const phi = dominantTextAngle(page.texts); // reading direction in the y-down frame
  const rad = (phi * Math.PI) / 180;
  const c = Math.round(Math.cos(rad)); const s = Math.round(Math.sin(rad));
  // (x, y) -> (c x + s y, -s x + c y): rotates by -phi so a text reading at phi reads at 0
  const rot = (x: number, y: number): Px => ({ x: c * x + s * y, y: -s * x + c * y });
  const corners = [rot(0, 0), rot(page.width, 0), rot(0, H), rot(page.width, H)];
  const minX = Math.min(...corners.map((q) => q.x)); const minY = Math.min(...corners.map((q) => q.y));
  const maxX = Math.max(...corners.map((q) => q.x)); const maxY = Math.max(...corners.map((q) => q.y));
  const tf = (q: Px): Px => { const r = rot(q.x, H - q.y); return { x: r.x - minX, y: r.y - minY }; };

  const fills: VFill[] = page.fills.map((f) => {
    const rings = f.rings.map((r) => r.map(tf));
    const xs = rings[0].map((q) => q.x); const ys = rings[0].map((q) => q.y);
    return { color: f.color, rings, area: f.area, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
  const strokes: VStroke[] = page.strokes.map((s) => ({ ...s, points: s.points.map(tf) }));
  const texts: VText[] = page.texts.map((t) => {
    const q = tf({ x: t.x, y: t.y });
    return { ...t, x: q.x, y: q.y, angle: wrap180(-t.angle - phi) };
  });
  return { index: page.index, width: maxX - minX, height: maxY - minY, fills, strokes, texts, imageCoverage: page.imageCoverage, normalized: true, rotationDeg: -phi };
}

/** Centre of a text run's ink box (baseline origin + half the width along the reading direction + about half a cap height up). */
export function textCentre(t: VText): Px {
  const r = (t.angle * Math.PI) / 180;
  const u = { x: Math.cos(r), y: Math.sin(r) };
  const up = { x: Math.sin(r), y: -Math.cos(r) };
  return { x: t.x + u.x * t.width / 2 + up.x * t.size * 0.35, y: t.y + u.y * t.width / 2 + up.y * t.size * 0.35 };
}

const isPlanWord = (str: string): boolean => pageKindWords(str).includes('plan');
const isElevWord = (str: string): boolean => { const k = pageKindWords(str); return k.includes('elevation') || k.includes('section'); };

/**
 * A page whose drawing is a picture placed in the PDF. C8's rule wants the picture to cover half the page, but a brochure page often
 * carries a plan picture that covers a quarter of it beside vector text and a table. What marks it is the lack of linework: a vector
 * plan is hundreds of strokes, a picture's page has a handful (the text and tables are text and a few fills). Generic: no word,
 * no layout, only picture area against stroke count.
 */
export function isPictureOfPlan(page: VectorPage): boolean {
  if (page.imageCoverage > 0.5 && page.strokes.length + page.fills.length < 200) return true;
  return page.imageCoverage >= 0.12 && page.strokes.length < 60;
}

/** Step 1. */
export function classifyPage(page: VectorPage): PageKind {
  if (isPictureOfPlan(page)) return 'raster';
  if (page.texts.some((t) => isPlanWord(t.str) && !isElevWord(t.str))) return 'plan';
  if (page.texts.some((t) => isElevWord(t.str))) return 'elevation';
  return 'other';
}

/** Room-label count, used to pick a plan page when no page says PLAN. */
export function roomLabelCount(page: VectorPage): number {
  return page.texts.filter((t) => isRoomLabel(t.str)).length;
}
