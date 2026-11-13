// C8. SPEC 13.5 steps 3 and 4: wall-fill selection, wall thickness, gap bridging. Pure TypeScript.
import type { Px } from '../types';
import type { VectorPage, VFill } from './types';
import { Bitmap, WALL, ringArea } from './bitmap';

export interface WallPoly { ring: Px[]; color: string; area: number; bbox: [number, number, number, number]; isRect: boolean; long: number; short: number }
export interface WallSet {
  colors: string[];
  /** merged, rectilinear wall pieces (triangle pairs joined into rectangles) */
  polys: WallPoly[];
  /** every fill of the chosen colours, triangles included, for rasterising */
  coverage: Px[][];
  /** wall thickness, page units */
  t: number;
  bbox: [number, number, number, number];
  /** dominant wall direction in [0, pi/2) */
  dominant: number;
  rejectedColors: { color: string; reason: string }[];
}
export interface Gap {
  a: Px; b: Px;            // centres of the two end faces
  widthPt: number;
  dir: Px;                 // unit a -> b
  /** the band that closes the gap, full wall thickness */
  band: Px[];
  polyA: number; polyB: number;
}

const key = (p: Px): string => `${Math.round(p.x * 50)},${Math.round(p.y * 50)}`;
const dist = (a: Px, b: Px): number => Math.hypot(a.x - b.x, a.y - b.y);

function bboxOf(r: Px[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of r) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return [x0, y0, x1, y1];
}

function isRectangle(q: Px[], tolDeg = 1.5): boolean {
  if (q.length !== 4) return false;
  const c = Math.cos(((90 - tolDeg) * Math.PI) / 180);
  for (let i = 0; i < 4; i++) {
    const a = q[i]; const b = q[(i + 1) % 4]; const d = q[(i + 2) % 4];
    const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - b.x, vy = d.y - b.y;
    const L = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (L < 1e-9 || Math.abs(ux * vx + uy * vy) / L > c) return false;
  }
  return true;
}

/** Pair triangles that share an edge when together they make a rectangle (CAD exports tessellate solid fills). */
export function mergeTriangles(fills: VFill[], minArea: number): { rings: Px[][]; color: string }[] {
  const out: { rings: Px[][]; color: string }[] = [];
  const byColor = new Map<string, Px[][]>();
  for (const f of fills) {
    if (f.rings.length === 1 && f.rings[0].length === 3 && f.area >= minArea * 0.5) {
      const l = byColor.get(f.color); if (l) l.push(f.rings[0]); else byColor.set(f.color, [f.rings[0]]);
    } else if (f.area >= minArea) out.push({ rings: f.rings, color: f.color });
  }
  for (const [color, tris] of byColor) {
    const used = new Array(tris.length).fill(false);
    const byEdge = new Map<string, number[]>();
    tris.forEach((t, i) => {
      for (let k = 0; k < 3; k++) {
        const a = key(t[k]); const b = key(t[(k + 1) % 3]);
        const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
        const l = byEdge.get(ek); if (l) l.push(i); else byEdge.set(ek, [i]);
      }
    });
    for (let i = 0; i < tris.length; i++) {
      if (used[i]) continue;
      let merged = false;
      for (let k = 0; k < 3 && !merged; k++) {
        const a = tris[i][k]; const b = tris[i][(k + 1) % 3]; const c = tris[i][(k + 2) % 3];
        const ka = key(a); const kb = key(b);
        const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        for (const j of byEdge.get(ek) ?? []) {
          if (j === i || used[j]) continue;
          const d = tris[j].find((p) => key(p) !== ka && key(p) !== kb);
          if (!d) continue;
          const quad = [c, a, d, b];
          if (!isRectangle(quad)) continue;
          used[i] = used[j] = true; merged = true;
          out.push({ rings: [quad], color });
          break;
        }
      }
      if (!merged) { used[i] = true; out.push({ rings: [tris[i]], color }); }
    }
  }
  return out;
}

function edgeAngles(ring: Px[]): { ang: number; len: number }[] {
  const e: { ang: number; len: number }[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    const len = dist(a, b); if (len < 1e-9) continue;
    let ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    ang = ((ang % 90) + 90) % 90;
    e.push({ ang, len });
  }
  return e;
}

/** at least 80% of the perimeter lies along two orthogonal directions (within 3 degrees) */
function rectilinear(ring: Px[]): boolean {
  const e = edgeAngles(ring);
  const total = e.reduce((s, x) => s + x.len, 0);
  if (total <= 0) return false;
  let best = 0;
  for (const c of e) {
    let w = 0;
    for (const x of e) { const d = Math.min(Math.abs(x.ang - c.ang), 90 - Math.abs(x.ang - c.ang)); if (d <= 3) w += x.len; }
    best = Math.max(best, w);
  }
  return best / total >= 0.8;
}

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y); const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function selectWalls(page: VectorPage): WallSet {
  const pageArea = page.width * page.height;
  const minArea = pageArea * 0.0001;
  const merged = mergeTriangles(page.fills.filter((f) => f.area > 0), minArea);
  interface Cand extends WallPoly { rings: Px[][] }
  const byColor = new Map<string, Cand[]>();
  for (const m of merged) {
    const ring = m.rings[0];
    const bb = bboxOf(ring);
    const area = Math.abs(ringArea(ring));
    if (area < minArea) continue;
    const isRect = isRectangle(ring);
    let long: number, short: number;
    if (isRect) { const a = dist(ring[0], ring[1]); const b = dist(ring[1], ring[2]); long = Math.max(a, b); short = Math.min(a, b); }
    else { const w = bb[2] - bb[0]; const h = bb[3] - bb[1]; long = Math.max(w, h); short = Math.min(w, h); }
    if (short < 2) continue;
    if (!rectilinear(ring)) continue;
    const c: Cand = { ring, rings: m.rings, color: m.color, area, bbox: bb, isRect, long, short };
    const l = byColor.get(m.color); if (l) l.push(c); else byColor.set(m.color, [c]);
  }
  const rejected: { color: string; reason: string }[] = [];
  const colors: string[] = []; const polys: WallPoly[] = [];
  // Floors, rooms and glass are fills too, and a colour-filled brochure has far more floor than wall. A wall is the dark one: when a
  // dark colour qualifies, a colour much lighter than it is a floor, and near-white is the paper or a window, never a wall.
  const lum = (hex: string): number => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex); return m ? (0.2126 * parseInt(m[1], 16) + 0.7152 * parseInt(m[2], 16) + 0.0722 * parseInt(m[3], 16)) / 255 : 0.5; };
  // wall pieces of a built-up plan are rectilinear outlines (L, T, frames), not long rectangles: their area is a small part of their
  // bounding box. A floor fill is most of its box. This is the second way for a colour to count as walls.
  const hollow = (list: Cand[]): number => median(list.map((c) => c.area / Math.max(1e-6, (c.bbox[2] - c.bbox[0]) * (c.bbox[3] - c.bbox[1]))));
  const qualifies = (list: Cand[]): boolean => {
    const total = list.reduce((s, c) => s + c.area, 0); const aspect = median(list.map((c) => c.long / c.short));
    return total >= pageArea * (aspect >= 5 ? 0.001 : 0.003) && (aspect >= 3 || total >= pageArea * 0.03 || (total >= pageArea * 0.01 && hollow(list) <= 0.55));
  };
  const darkest = Math.min(1, ...[...byColor].filter(([, l]) => qualifies(l)).map(([c]) => lum(c)));
  for (const [color, list] of byColor) {
    if (lum(color) >= 0.93) { rejected.push({ color, reason: 'near white: paper or glass, not a wall' }); continue; }
    if (darkest <= 0.6 && lum(color) >= 0.75 && lum(color) >= darkest + 0.3) { rejected.push({ color, reason: 'much lighter than the dark fills: a floor, not a wall' }); continue; }
    const total = list.reduce((s, c) => s + c.area, 0);
    const aspect = median(list.map((c) => c.long / c.short));
    // SPEC-GAP: 13.5 asks for 0.3% of the page, but the 13.10 fixture's 0.12 m partitions total 0.13% of an A4 page at
    // 31.7 pt per metre and must still be chosen (13.11 item 4). Strongly elongated groups (median aspect 5 or more,
    // which glyphs and hatching never are) only need 0.1%.
    const minShare = aspect >= 5 ? 0.001 : 0.003;
    if (total < pageArea * minShare) { rejected.push({ color, reason: `under ${(minShare * 100).toFixed(1)}% of the page` }); continue; }
    if (!(aspect >= 3 || total >= pageArea * 0.03 || (total >= pageArea * 0.01 && hollow(list) <= 0.55))) { rejected.push({ color, reason: `not elongated (median aspect ${aspect.toFixed(1)})` }); continue; }
    colors.push(color);
    for (const c of list) polys.push({ ring: c.ring, color: c.color, area: c.area, bbox: c.bbox, isRect: c.isRect, long: c.long, short: c.short });
  }
  const coverage = page.fills.filter((f) => colors.includes(f.color)).map((f) => f.rings[0]);
  const thin = polys.filter((p) => p.isRect && p.long / p.short >= 2).map((p) => p.short);
  const t = median(thin.length ? thin : polys.map((p) => p.short));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) { x0 = Math.min(x0, p.bbox[0]); y0 = Math.min(y0, p.bbox[1]); x1 = Math.max(x1, p.bbox[2]); y1 = Math.max(y1, p.bbox[3]); }
  // dominant direction: weighted mode of edge angles mod 90
  const hist = new Array(90).fill(0);
  for (const p of polys) for (const e of edgeAngles(p.ring)) hist[Math.min(89, Math.round(e.ang) % 90)] += e.len;
  let bi = 0; for (let i = 1; i < 90; i++) if (hist[i] > hist[bi]) bi = i;
  let sw = 0, sa = 0;
  for (const p of polys) for (const e of edgeAngles(p.ring)) {
    let d = e.ang - bi; if (d > 45) d -= 90; if (d < -45) d += 90;
    if (Math.abs(d) <= 3) { sw += e.len; sa += e.len * d; }
  }
  const dominant = ((bi + (sw ? sa / sw : 0)) * Math.PI) / 180;
  return { colors, polys, coverage, t, bbox: [x0, y0, x1, y1], dominant, rejectedColors: rejected };
}

/** A bitmap of every chosen wall fill. Pixel size is `px` page units. */
export function wallBitmap(page: VectorPage, walls: WallSet, px: number): Bitmap {
  const bm = new Bitmap(page.width, page.height, px);
  for (const r of walls.coverage) bm.fillRing(r, WALL);
  return bm;
}

interface Face { c: Px; n: Px; len: number; poly: number }

/**
 * Step 4. SPEC-GAP: 13.5 bridges gaps of 2 t to 14 t. The reference drawing's son-room window is 14.2 t, so the limit is 16 t.
 */
export function bridgeGaps(walls: WallSet, mask: Bitmap): Gap[] {
  const t = walls.t;
  const faces: Face[] = [];
  walls.polys.forEach((p, pi) => {
    const r = p.ring; const sign = ringArea(r) >= 0 ? 1 : -1;
    for (let i = 0; i < r.length; i++) {
      const a = r[i]; const b = r[(i + 1) % r.length];
      const len = dist(a, b);
      if (len < 1e-6 || len > 2.5 * t) continue;
      const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
      const n = { x: sign * dy, y: -sign * dx };
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // an end face has open air in front of it
      const probe = { x: c.x + n.x * Math.max(0.4 * t, mask.px * 1.2), y: c.y + n.y * Math.max(0.4 * t, mask.px * 1.2) };
      if (mask.at(probe) === WALL) continue;
      faces.push({ c, n, len, poly: pi });
    }
  });
  const cos10 = Math.cos((10 * Math.PI) / 180);
  interface Cand { i: number; j: number; d: number }
  const cands: Cand[] = [];
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
    const A = faces[i]; const B = faces[j];
    if (A.poly === B.poly) continue;
    if (A.n.x * B.n.x + A.n.y * B.n.y > -cos10) continue;
    const dx = B.c.x - A.c.x, dy = B.c.y - A.c.y;
    const along = dx * A.n.x + dy * A.n.y;
    const lateral = Math.abs(dx * A.n.y - dy * A.n.x);
    if (along < 2 * t || along > 16 * t || lateral > 0.5 * t) continue;
    if ((A.c.x - B.c.x) * B.n.x + (A.c.y - B.c.y) * B.n.y < 0) continue;
    // no wall lies between the two faces
    const steps = Math.max(4, Math.ceil(along / mask.px));
    let blocked = false;
    for (let s = 1; s < steps && !blocked; s++) {
      const f = s / steps;
      if (f * along < 0.3 * t || (1 - f) * along < 0.3 * t) continue;
      if (mask.at({ x: A.c.x + dx * f, y: A.c.y + dy * f }) === WALL) blocked = true;
    }
    if (blocked) continue;
    cands.push({ i, j, d: along });
  }
  cands.sort((p, q) => p.d - q.d);
  const taken = new Set<number>();
  const gaps: Gap[] = [];
  for (const c of cands) {
    if (taken.has(c.i) || taken.has(c.j)) continue;
    taken.add(c.i); taken.add(c.j);
    const A = faces[c.i]; const B = faces[c.j];
    const w = dist(A.c, B.c);
    const dir = { x: (B.c.x - A.c.x) / w, y: (B.c.y - A.c.y) / w };
    const hw = (A.len + B.len) / 4;
    const nx = -dir.y * hw, ny = dir.x * hw;
    const band = [
      { x: A.c.x + nx, y: A.c.y + ny }, { x: B.c.x + nx, y: B.c.y + ny },
      { x: B.c.x - nx, y: B.c.y - ny }, { x: A.c.x - nx, y: A.c.y - ny },
    ];
    gaps.push({ a: A.c, b: B.c, widthPt: w, dir, band, polyA: A.poly, polyB: B.poly });
  }
  return gaps;
}
