// A clean floor-plan picture drawn from a scene's layout alone: walls (with the doorways and windows cut out), room names and
// the sizes the scene carries. Never the source drawing, so nothing printed on a client's sheet (title block, names) can leak.
// Pure: returns an SVG string. Units inside the SVG are metres (x east, z south, so north is up as on the drawing).
import { polygonArea, pointInPolygon, distanceToSegment } from '../core/geometry';
import { computeEdgeFrames, computeWallPieces, pieceRect } from '../core/layout-geom';
import { polygonCentroid } from '../core/spawn';
import { formatArea } from '../core/units';
import type { Layout, RoomTag, Vec2 } from '../types';
import type { PlanLayout } from './manifest';

export interface PlanOptions {
  /** makes the pattern id unique when several plans share one page */
  idPrefix: string;
  /** room ids a buyer may tap (the picker); others are drawn dimmed */
  selectable?: ReadonlySet<string>;
  selectedId?: string | null;
  /** plain-language accessible name for the whole picture */
  title: string;
}

export interface PlanPicture { svg: string; aspect: number }

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const num = (n: number): string => (Math.round(n * 1000) / 1000).toString();
const pts = (p: Vec2[]): string => p.map((q) => `${num(q.x)},${num(q.z)}`).join(' ');

/** What a room's label says under its name. Honest: a partial room shows no size, an unmeasured one says so. */
export function roomSizeLine(room: RoomTag, unverified: Record<string, string>): string {
  if (room.partial) return 'partly on the drawing';
  if (unverified[room.id]) return 'not measured';
  return `${formatArea(Math.abs(polygonArea(room.polygon))).sqft} sq ft`;
}

/** Where to write a room's name: its centroid, or the roomiest point when the centroid falls outside (L shapes). */
function labelPoint(poly: Vec2[]): Vec2 {
  const c = polygonCentroid(poly);
  if (pointInPolygon(c, poly)) return c;
  let best = poly[0], bestD = -1;
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.1) {
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.1) {
      const q = { x, z };
      if (!pointInPolygon(q, poly)) continue;
      let d = Infinity;
      for (let i = 0; i < poly.length; i++) d = Math.min(d, distanceToSegment(q, poly[i], poly[(i + 1) % poly.length]));
      if (d > bestD) { best = q; bestD = d; }
    }
  }
  return best;
}

export function planSvg(layout: PlanLayout, unverified: Record<string, string>, opts: PlanOptions): PlanPicture {
  const full = layout as Layout; // computeWallPieces reads only the fields PlanLayout keeps
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const r of layout.rooms) for (const p of r.polygon) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const pad = 0.35 + layout.wallThicknessM;
  minX -= pad; minZ -= pad; maxX += pad; maxZ += pad;
  const w = maxX - minX, h = maxZ - minZ;
  const span = Math.max(w, h);
  const font = Math.min(0.5, Math.max(0.2, span * 0.031));
  const id = opts.idPrefix;
  const partialIds = new Set(layout.rooms.filter((r) => r.partial).map((r) => r.id));

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="wt-plan" viewBox="${num(minX)} ${num(minZ)} ${num(w)} ${num(h)}" ` +
    `preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(opts.title)}">`,
  );
  out.push(
    `<defs><pattern id="${id}-hatch" patternUnits="userSpaceOnUse" width="0.28" height="0.28" patternTransform="rotate(45)">` +
    `<line x1="0" y1="0" x2="0" y2="0.28" class="plan-hatch" stroke-width="0.05"/></pattern></defs>`,
  );

  // floors
  for (const r of layout.rooms) {
    const pick = opts.selectable?.has(r.id) ?? false;
    const on = opts.selectedId === r.id;
    const cls = ['plan-room', r.partial ? 'is-partial' : '', pick ? 'is-pick' : '', on ? 'is-on' : '', opts.selectable && !pick ? 'is-dim' : '']
      .filter(Boolean).join(' ');
    const a11y = pick
      ? ` role="button" tabindex="0" aria-pressed="${on}" aria-label="${esc(`${r.label}, ${roomSizeLine(r, unverified)}`)}"`
      : '';
    out.push(`<g class="${cls}" data-room="${esc(r.id)}"${a11y}>` +
      `<polygon class="plan-floor" points="${pts(r.polygon)}"/>` +
      (r.partial ? `<polygon class="plan-floor-hatch" points="${pts(r.polygon)}" fill="url(#${id}-hatch)"/>` : '') +
      `</g>`);
  }

  // walls with the doorways cut out (the same pieces the 3D shell is built from)
  const frames = new Map(computeEdgeFrames(full).map((f) => [`${f.roomId}:${f.edge}`, f]));
  const frameOf = (roomId: string, edge: number) => frames.get(`${roomId}:${edge}`);
  for (const p of computeWallPieces(full)) {
    const f = frameOf(p.roomId, p.edge);
    if (!f) continue;
    const isFull = p.y0 <= 1e-9 && p.y1 >= (p.kind === 'wall' ? layout.wallHeightM : layout.railingHeightM) - 1e-6;
    if (!isFull && p.y0 > 1e-9) continue; // the wall above a doorway or window is not in the plan
    const cls = p.kind === 'railing' ? 'plan-rail' : isFull ? 'plan-wall' : 'plan-sill';
    out.push(`<polygon class="${cls}${partialIds.has(p.roomId) ? ' is-partial' : ''}" points="${pts(pieceRect(f, p))}"/>`);
  }
  // windows and doors on top
  for (const o of layout.openings) {
    const f = frameOf(o.roomId, o.edge);
    if (!f || f.kind === 'none') continue;
    const u0 = Math.max(0, o.centreM - o.widthM / 2), u1 = Math.min(f.length, o.centreM + o.widthM / 2);
    const t = Math.max(f.thickness, 0.06);
    const at = (u: number, off: number): Vec2 => ({ x: f.a.x + f.dir.x * u + f.out.x * off, z: f.a.z + f.dir.z * u + f.out.z * off });
    if (o.type === 'window') {
      out.push(`<polygon class="plan-window" points="${pts([at(u0, 0), at(u1, 0), at(u1, t), at(u0, t)])}"/>`);
      const m0 = at(u0, t / 2), m1 = at(u1, t / 2);
      out.push(`<line class="plan-window-line" x1="${num(m0.x)}" y1="${num(m0.z)}" x2="${num(m1.x)}" y2="${num(m1.z)}"/>`);
    } else if (o.type === 'door') {
      const m0 = at(u0, t / 2), m1 = at(u1, t / 2);
      out.push(`<line class="plan-door" x1="${num(m0.x)}" y1="${num(m0.z)}" x2="${num(m1.x)}" y2="${num(m1.z)}"/>`);
    }
  }

  // names and sizes
  for (const r of layout.rooms) {
    const xs = r.polygon.map((p) => p.x), zs = r.polygon.map((p) => p.z);
    const rw = Math.max(...xs) - Math.min(...xs), rh = Math.max(...zs) - Math.min(...zs);
    const size = roomSizeLine(r, unverified);
    const nameChars = Math.max(r.label.length, size.length * 0.85, 4);
    const fit = (rw * 0.92) / (nameChars * 0.56);
    const f = Math.max(0.1, Math.min(font, fit, rh / 5));
    const c = labelPoint(r.polygon);
    const dim = opts.selectable && !opts.selectable.has(r.id) ? ' is-dim' : '';
    out.push(
      `<text class="plan-label${dim}" x="${num(c.x)}" y="${num(c.z - f * 0.1)}" font-size="${num(f)}" text-anchor="middle" style="stroke-width:${num(f * 0.28)}px">` +
      `<tspan class="plan-name">${esc(r.label)}</tspan>` +
      `<tspan class="plan-size" x="${num(c.x)}" dy="${num(f * 1.2)}" font-size="${num(f * 0.85)}">${esc(size)}</tspan></text>`,
    );
  }
  out.push('</svg>');
  return { svg: out.join(''), aspect: w / h };
}
