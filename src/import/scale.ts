// C8. SPEC 13.5 step 6: scale by voting. Pure TypeScript.
import type { Px } from '../types';
import type { ScaleVote, VectorPage } from './types';
import type { FurnitureLabel, RoomLabel } from './labels';
import type { WallSet } from './walls';

/** A drawn rectangle: oriented bounding box of a stroke that outlines a piece of furniture. */
export interface Outline {
  /** centre, page units */ cx: number; cy: number;
  /** side along `ang` and the perpendicular side, page units */ a: number; b: number;
  /** direction of side `a`, radians */ ang: number;
  /** the four corners, in order */ corners: Px[];
  closed: boolean;
}

function orientedBox(pts: Px[]): Outline {
  let best: Outline | null = null; let bestA = Infinity;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const ang = Math.atan2(q.y - p.y, q.x - p.x);
    if (Math.hypot(q.x - p.x, q.y - p.y) < 1e-9) continue;
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const r of pts) { const u = r.x * c + r.y * s, v = -r.x * s + r.y * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (area < bestA - 1e-9) {
      bestA = area;
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      const corner = (u: number, v: number): Px => ({ x: u * c - v * s, y: u * s + v * c });
      best = { cx: cu * c - cv * s, cy: cu * s + cv * c, a: u1 - u0, b: v1 - v0, ang, corners: [corner(u0, v0), corner(u1, v0), corner(u1, v1), corner(u0, v1)], closed: false };
    }
  }
  return best ?? { cx: pts[0].x, cy: pts[0].y, a: 0, b: 0, ang: 0, corners: pts, closed: false };
}

/**
 * Closed strokes that look like a piece of furniture. SPEC-GAP: 13.5 says "closed stroke (or fill)". In the reference
 * drawing a bed is an open rectilinear polyline of three sides (the headboard side is drawn separately), so a
 * three-sided U that covers at least 70% of its own bounding-box perimeter counts too.
 */
export function collectOutlines(page: VectorPage, walls: WallSet): Outline[] {
  const out: Outline[] = [];
  for (const s of page.strokes) {
    const n = s.points.length;
    if (n < 4) continue;
    if (walls.colors.includes(s.color)) continue;
    const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    if (w < 3 || h < 3) continue;
    if (w >= 0.7 * page.width || h >= 0.7 * page.height) continue; // border, title block, long wall lines
    if (s.closed) {
      out.push({ ...orientedBox(s.points), closed: true });
      continue;
    }
    // open: rectilinear, three or four sides, covers most of its bounding box perimeter
    let len = 0; let ok = n <= 6;
    for (let i = 0; i + 1 < n && ok; i++) {
      const dx = s.points[i + 1].x - s.points[i].x, dy = s.points[i + 1].y - s.points[i].y;
      len += Math.hypot(dx, dy);
      ok = Math.abs(dx) < 0.5 || Math.abs(dy) < 0.5;
    }
    if (ok && len >= 0.7 * 2 * (w + h)) out.push({ ...orientedBox(s.points), closed: false });
  }
  return out;
}

const ratioOk = (a: number, b: number, w: number, l: number): boolean => {
  const ro = Math.min(a, b) / Math.max(a, b); const rl = Math.min(w, l) / Math.max(w, l);
  return Math.abs(ro - rl) / rl <= 0.1;
};

/**
 * The outline that goes with a sized furniture label: smallest with the matching side ratio that contains the label
 * centre, else the smallest within 6 t of it.
 */
export function matchOutline(label: FurnitureLabel, outlines: Outline[], t: number): Outline | null {
  if (!label.dims) return null;
  const { w, l } = label.dims;
  const c = label.centre;
  const local = (o: Outline): { u: number; v: number } => {
    const dx = c.x - o.cx, dy = c.y - o.cy;
    const cs = Math.cos(o.ang), sn = Math.sin(o.ang);
    return { u: dx * cs + dy * sn, v: -dx * sn + dy * cs };
  };
  const inside = (o: Outline): boolean => { const { u, v } = local(o); return Math.abs(u) <= o.a / 2 && Math.abs(v) <= o.b / 2; };
  const near = (o: Outline): number => { const { u, v } = local(o); return Math.hypot(Math.max(0, Math.abs(u) - o.a / 2), Math.max(0, Math.abs(v) - o.b / 2)); };
  const cands = outlines.filter((o) => o.a > 0 && o.b > 0 && ratioOk(o.a, o.b, w, l));
  const byArea = (x: Outline, y: Outline): number => x.a * x.b - y.a * y.b;
  const inn = cands.filter(inside).sort(byArea);
  if (inn.length) return inn[0];
  const nr = cands.filter((o) => near(o) <= 6 * t).sort(byArea);
  return nr[0] ?? null;
}

/** ptPerM votes of one outline: short side over the short label side, long over long. */
export function outlineVotes(o: Outline, label: FurnitureLabel, name: string): ScaleVote[] {
  const { w, l } = label.dims!;
  const lo = Math.min(w, l), hi = Math.max(w, l);
  return [
    { source: `furniture ${name} short side`, ptPerM: Math.min(o.a, o.b) / lo },
    { source: `furniture ${name} long side`, ptPerM: Math.max(o.a, o.b) / hi },
  ];
}

/** Votes from a closed room region against its label. */
export function roomVotes(label: RoomLabel, polygon: Px[], areaPt2: number): ScaleVote[] {
  const votes: ScaleVote[] = [];
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
  if (label.areaM2) votes.push({ source: `room ${label.name} area`, ptPerM: Math.sqrt(areaPt2 / label.areaM2) });
  if (label.dims) {
    const lo = Math.min(label.dims.w, label.dims.l), hi = Math.max(label.dims.w, label.dims.l);
    votes.push({ source: `room ${label.name} short side`, ptPerM: Math.min(bw, bh) / lo });
    votes.push({ source: `room ${label.name} long side`, ptPerM: Math.max(bw, bh) / hi });
  }
  return votes;
}

const median = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export interface ScaleResult { ptPerM: number; votes: ScaleVote[]; agreeing: number; disagreementPct: number; agreeingVotes: ScaleVote[] }

/**
 * The largest set of votes that agree within 3% of their own median. Ties go to the set with more furniture votes,
 * then to the tighter set. Returns null when there are no votes.
 */
export function voteScale(votes: ScaleVote[]): ScaleResult | null {
  if (!votes.length) return null;
  const v = [...votes].sort((a, b) => a.ptPerM - b.ptPerM);
  const n = v.length;
  let best: { i: number; j: number; fur: number; spread: number } | null = null;
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
    const set = v.slice(i, j + 1);
    const m = median(set.map((x) => x.ptPerM));
    if (set.some((x) => Math.abs(x.ptPerM - m) / m > 0.03)) continue;
    const fur = set.filter((x) => x.source.startsWith('furniture')).length;
    const spread = (set[set.length - 1].ptPerM - set[0].ptPerM) / m;
    const size = j - i + 1;
    const bsize = best ? best.j - best.i + 1 : 0;
    if (!best || size > bsize || (size === bsize && (fur > best.fur || (fur === best.fur && spread < best.spread)))) best = { i, j, fur, spread };
  }
  const set = v.slice(best!.i, best!.j + 1);
  const m = median(set.map((x) => x.ptPerM));
  const all = median(v.map((x) => x.ptPerM));
  return { ptPerM: m, votes: v, agreeing: set.length, disagreementPct: ((v[n - 1].ptPerM - v[0].ptPerM) / all) * 100, agreeingVotes: set };
}
