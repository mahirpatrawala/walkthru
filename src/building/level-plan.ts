// One level of a building drawn as a plan: every space's walls and doors (the same drawing as a home's start-page plan), each space
// outlined and named, flats with their type and carpet area, placeholders marked. Areas come from the scenes' own rooms and follow
// the "not measured" rule of the rooms sheet: a flat with a room the drawing did not measure does not state a carpet area.
// Pure: returns SVG text (all text escaped). Units inside the SVG are metres, x east and z south, north up.
import { polygonArea } from '../core/geometry';
import { carpetAreaM2 } from '../core/layout-geom';
import { formatArea } from '../core/units';
import { planSvg } from '../start/plan-svg';
import type { PlanLayout } from '../start/manifest';
import type { Opening, RoomTag, Vec2 } from '../types';
import { roomsOnLevel, toLevel } from './geom';
import { outdoorPlanArt } from '../outdoor/plan-art';
import type { SceneInfo } from './load';
import type { BuildingFile, Level, Space } from './types';

export interface SpaceArea {
  /** "1,396 sq ft carpet", or why there is no number */
  text: string;
  /** the number is a measured one */
  measured: boolean;
}

/** What the map says a space measures. */
export function spaceArea(space: Space, scene: SceneInfo): SpaceArea {
  const layout = scene.property.layout;
  if (space.kind === 'home') {
    const flagged = layout.rooms.filter((r) => r.roomType !== 'balcony' && (r.partial || scene.unverified[r.id]));
    if (flagged.length > 0) return { text: 'area not confirmed', measured: false };
    return { text: `${formatArea(carpetAreaM2(layout)).sqft.toLocaleString('en-IN')} sq ft carpet`, measured: true };
  }
  const total = layout.rooms.reduce((s, r) => s + Math.abs(polygonArea(r.polygon)), 0);
  if (space.comingNext) return { text: `about ${formatArea(total).sqft.toLocaleString('en-IN')} sq ft, a placeholder`, measured: false };
  return { text: `${formatArea(total).sqft.toLocaleString('en-IN')} sq ft`, measured: true };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const n3 = (n: number): string => (Math.round(n * 1000) / 1000).toString();

export interface Rect { x0: number; z0: number; x1: number; z1: number }
/** `rects` outline the space (a flat's body, or each room of a lobby or corridor), each with the name of its room */
/** `poly` is the room's own outline when it is not a rectangle (an L-shaped pool wing, a passage round a lift core): the map outlines and labels that, not its bounding box */
export interface SpaceBox { spaceId: string; x0: number; z0: number; x1: number; z1: number; rects: (Rect & { label: string; poly?: Vec2[] })[]; area: SpaceArea }
/** one in-room label as drawn: what it says, where its middle is, how big its type and its box (the box fits the room's outline at 90 %) */
export interface PlanLabel { spaceId: string; lines: string[]; x: number; z: number; sizeM: number; widthM: number; heightM: number }
export interface LevelPlan { svg: string; aspect: number; boxes: SpaceBox[]; labels: PlanLabel[] }

const isRectangle = (poly: Vec2[]): boolean => poly.length === 4 && poly.every((p, i) => { const q = poly[(i + 1) % 4]; return Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.z - q.z) < 1e-6; });

/** a point well inside a polygon (the middle of its widest open spot, found on a grid): where a label of an L-shaped or notched room goes */
export function labelPoint(poly: Vec2[]): Vec2 {
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const inside = (q: Vec2): boolean => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i].z > q.z) !== (poly[j].z > q.z) && q.x < ((poly[j].x - poly[i].x) * (q.z - poly[i].z)) / (poly[j].z - poly[i].z) + poly[i].x) c = !c;
    return c;
  };
  const edgeDist = (q: Vec2): number => {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / l2));
      best = Math.min(best, Math.hypot(q.x - (a.x + t * dx), q.z - (a.z + t * dz)));
    }
    return best;
  };
  let best: Vec2 = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 }, bestD = -1;
  const N = 48;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const q = { x: x0 + ((x1 - x0) * i) / N, z: z0 + ((z1 - z0) * j) / N };
    if (!inside(q)) continue;
    const d = edgeDist(q);
    if (d > bestD) { bestD = d; best = q; }
  }
  return best;
}

/** the room's open span through a point, horizontally and vertically: the nearest wall crossing on each side (a rectangle's own width and depth, an L's arm) */
export function insideSpan(poly: Vec2[], p: Vec2): { w: number; h: number } {
  const cross = (axis: 'x' | 'z'): number => {
    const o = axis === 'x' ? 'z' : 'x';
    let lo = -Infinity, hi = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a[o] > p[o]) === (b[o] > p[o])) continue;
      const t = (p[o] - a[o]) / (b[o] - a[o]);
      const v = a[axis] + t * (b[axis] - a[axis]);
      if (v <= p[axis]) lo = Math.max(lo, v); else hi = Math.min(hi, v);
    }
    return Number.isFinite(lo) && Number.isFinite(hi) ? hi - lo : 0;
  };
  return { w: cross('x'), h: cross('z') };
}

export const LABEL_CHAR_NAME = 0.6;
export const LABEL_CHAR_SUB = 0.52;
export const LABEL_LINE = 1.25;
export const LABEL_SUB_SCALE = 0.82;
export const LABEL_FILL = 0.9;

export interface FittedLabel { /** the name's lines first, then the sub lines (type, area) that fitted */ lines: string[]; nameLines: number; sizeM: number; widthM: number; heightM: number }

/** the name split over two lines at the space nearest its middle (null when it has no space) */
export function wrapName(name: string): string[] | null {
  const mid = name.length / 2;
  let best = -1;
  for (let i = 0; i < name.length; i++) if (name[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? null : [name.slice(0, best), name.slice(best + 1)];
}

/**
 * The ways a label may be set, best first: the name on one line and then wrapped over two, each first with all the sub lines (a flat's type, the area), then with the
 * last of them dropped, and so on. The area goes before the name does. `wUnit` and `hUnit` are the label's width and height per metre of type.
 */
export function labelVariants(name: string, subs: string[]): { lines: string[]; nameLines: number; wUnit: number; hUnit: number }[] {
  const wrapped = wrapName(name);
  const out: { lines: string[]; nameLines: number; wUnit: number; hUnit: number }[] = [];
  for (let k = subs.length; k >= 0; k--) {
    const kept = subs.slice(0, k);
    for (const nm of wrapped ? [[name], wrapped] : [[name]]) {
      out.push({
        lines: [...nm, ...kept], nameLines: nm.length,
        wUnit: Math.max(...nm.map((l) => l.length * LABEL_CHAR_NAME), ...kept.map((l) => l.length * LABEL_CHAR_SUB * LABEL_SUB_SCALE)),
        hUnit: (nm.length + kept.length * LABEL_SUB_SCALE) * LABEL_LINE,
      });
    }
  }
  return out;
}

/**
 * The rule for a room whose inner span is a width and a depth: each variant gets the largest type up to `maxM` that fits 90 % of the span; the first variant that fits at
 * a size of at least `minM` wins. When not even the bare name fits at the floor there is no label (null) and the side list still names the room.
 */
export function fitLabel(name: string, subs: string[], widthM: number, heightM: number, maxM: number, minM: number): FittedLabel | null {
  for (const v of labelVariants(name, subs)) {
    const f = Math.min(maxM, (widthM * LABEL_FILL) / v.wUnit, (heightM * LABEL_FILL) / v.hUnit);
    if (f >= minM) return { lines: v.lines, nameLines: v.nameLines, sizeM: f, widthM: v.wUnit * f, heightM: v.hUnit * f };
  }
  return null;
}

/** does the rectangle of `w` x `h` centred on (cx, cz) lie wholly inside the polygon? (its outline sampled every 0.4 m, and no corner of the polygon inside it) */
export function rectInPolygon(poly: Vec2[], cx: number, cz: number, w: number, h: number): boolean {
  const inside = (q: Vec2): boolean => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i].z > q.z) !== (poly[j].z > q.z) && q.x < ((poly[j].x - poly[i].x) * (q.z - poly[i].z)) / (poly[j].z - poly[i].z) + poly[i].x) c = !c;
    return c;
  };
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - h / 2, z1 = cz + h / 2;
  for (const p of poly) if (p.x > x0 + 1e-9 && p.x < x1 - 1e-9 && p.z > z0 + 1e-9 && p.z < z1 - 1e-9) return false;
  const nx = Math.max(1, Math.ceil(w / 0.4)), nz = Math.max(1, Math.ceil(h / 0.4));
  for (let i = 0; i <= nx; i++) for (const z of [z0, z1]) if (!inside({ x: x0 + (w * i) / nx, z })) return false;
  for (let j = 0; j <= nz; j++) for (const x of [x0, x1]) if (!inside({ x, z: z0 + (h * j) / nz })) return false;
  return true;
}

export interface PlacedLabel extends FittedLabel { x: number; z: number }

/**
 * `fitLabel` for a room of any shape: the same variants and sizes, but the label's own rectangle (90 % filled) must lie inside the room's outline, at the roomiest point
 * that holds it (the points are tried from the one farthest from every wall inward). So an L-shaped room's name goes in the arm that is wide enough, and a room that is
 * only a passage has none.
 */
export function placeLabel(poly: Vec2[], name: string, subs: string[], maxM: number, minM: number): PlacedLabel | null {
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const spots = candidatePoints(poly, x0, x1, z0, z1);
  const variants = labelVariants(name, subs);
  const sizes: number[] = [];
  for (let f = maxM; f > minM * 1.001; f *= 0.96) sizes.push(f);
  sizes.push(minM);
  for (const v of variants) {
    // the largest type that fits this variant anywhere: from the cap down to the floor in 4 % steps
    for (const f of sizes) {
      const w = v.wUnit * f / LABEL_FILL, h = v.hUnit * f / LABEL_FILL;
      if (w > x1 - x0 + 1e-9 || h > z1 - z0 + 1e-9) continue;
      for (const q of spots) if (rectInPolygon(poly, q.x, q.z, w, h)) return { lines: v.lines, nameLines: v.nameLines, sizeM: f, widthM: v.wUnit * f, heightM: v.hUnit * f, x: q.x, z: q.z };
    }
  }
  return null;
}

function candidatePoints(poly: Vec2[], x0: number, x1: number, z0: number, z1: number): { x: number; z: number; d: number }[] {
  const edgeDist = (q: Vec2): number => {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / l2));
      best = Math.min(best, Math.hypot(q.x - (a.x + t * dx), q.z - (a.z + t * dz)));
    }
    return best;
  };
  const out: { x: number; z: number; d: number }[] = [];
  const stepX = Math.max(0.25, (x1 - x0) / 60), stepZ = Math.max(0.25, (z1 - z0) / 60);
  for (let x = x0 + stepX / 2; x < x1; x += stepX) for (let z = z0 + stepZ / 2; z < z1; z += stepZ) {
    const q = { x, z };
    if (rectInPolygon(poly, x, z, 0.02, 0.02)) out.push({ x, z, d: Math.round(edgeDist(q) * 4) / 4 });
  }
  // the roomiest first (distance to the walls, to a quarter metre), and among equals the one nearest the middle of the outline's box
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  return out.sort((a, b) => b.d - a.d || Math.hypot(a.x - mx, a.z - mz) - Math.hypot(b.x - mx, b.z - mz));
}

export interface LevelPlanOptions {
  idPrefix: string;
  selected?: string | null;
  here?: { spaceId: string; /** the walker, in that space's own scene frame */ point?: Vec2 } | null;
}

export function levelPlan(b: BuildingFile, level: Level, scenes: ReadonlyMap<string, SceneInfo>, o: LevelPlanOptions): LevelPlan {
  const rooms: RoomTag[] = [];
  const openings: Opening[] = [];
  const unverified: Record<string, string> = {};
  let wall = 2.7;
  const boxes: SpaceBox[] = [];
  const art: string[] = [];
  for (const s of level.spaces) {
    const sc = scenes.get(s.sceneId);
    if (!sc) continue;
    const lay = sc.property.layout;
    wall = Math.max(wall, lay.wallHeightM);
    const placed = roomsOnLevel(lay, s.placement);
    if (sc.outdoor) art.push(outdoorPlanArt(sc.outdoor, `${o.idPrefix}-${s.id}`, (p) => toLevel(p, s.placement)));
    const key = (id: string): string => `${s.id}~${id}`;
    for (const r of placed) { rooms.push({ ...r, id: key(r.id) }); if (sc.unverified[r.id]) unverified[key(r.id)] = sc.unverified[r.id]; }
    for (const op of lay.openings) openings.push({ ...op, id: key(op.id), roomId: key(op.roomId) });
    const rectOf = (rs: RoomTag[]): Rect => {
      const xs = rs.flatMap((r) => r.polygon.map((p) => p.x)), zs = rs.flatMap((r) => r.polygon.map((p) => p.z));
      return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
    };
    const body = placed.filter((r) => r.roomType !== 'balcony');
    const polyOf = (rs: RoomTag[]): Vec2[] | undefined => (rs.length === 1 && !isRectangle(rs[0].polygon) ? rs[0].polygon : undefined);
    const rects = s.kind === 'home' || body.length <= 1
      ? [{ ...rectOf(body.length ? body : placed), label: s.name, ...(s.kind === 'home' ? {} : { poly: polyOf(body.length ? body : placed) }) }]
      : body.map((r) => ({ ...rectOf([r]), label: r.label, poly: polyOf([r]) }));
    const all = rectOf(placed);
    boxes.push({ spaceId: s.id, ...all, rects, area: spaceArea(s, sc) });
  }
  const layout: PlanLayout = { wallHeightM: wall, wallThicknessM: 0.12, railingHeightM: 1.1, rooms, openings };
  const pic = planSvg(layout, unverified, { idPrefix: o.idPrefix, title: `Plan of ${level.label}, ${b.name}` });
  // the room names of every flat are too small to read at this scale: the spaces carry the labels
  let svg = pic.svg.replace(/<text class="plan-label[\s\S]*?<\/text>/g, '');
  // the ground, water and planting of the open-air spaces go under the walls (above the floors), so the water is drawn as water and the lawn as lawn
  if (art.length) {
    const at = svg.search(/<polygon class="plan-(wall|rail|sill)/);
    svg = at >= 0 ? `${svg.slice(0, at)}${art.join('')}${svg.slice(at)}` : svg.replace(/<\/svg>$/, `${art.join('')}</svg>`);
  }
  const vb = /viewBox="([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)"/.exec(svg);
  const span = vb ? Math.max(+vb[3], +vb[4]) : 30;
  const font = span * 0.021;
  const over: string[] = [];
  const placed: PlanLabel[] = [];
  for (const bx of boxes) {
    const space = level.spaces.find((x) => x.id === bx.spaceId)!;
    const on = o.selected === space.id;
    const here = o.here?.spaceId === space.id;
    const title = space.kind === 'home' ? space.name.split(' · ')[0] : space.name.replace(/ \(placeholder\)$/, '');
    const sub = space.kind === 'home' ? `${space.name.split(' · ')[1] ?? ''}` : '';
    const aria = `${space.name}, ${space.comingNext ? 'coming in the next stage' : bx.area.text}`;
    const labels = bx.rects.map((r) => {
      // a space of one room is named once and carries the area (or says it is a placeholder); a lobby with several rooms names each room
      const single = bx.rects.length === 1;
      const poly = r.poly ?? [{ x: r.x0, z: r.z0 }, { x: r.x1, z: r.z0 }, { x: r.x1, z: r.z1 }, { x: r.x0, z: r.z1 }];
      const fit = placeLabel(poly, single ? title : r.label, single ? [...(sub ? [sub] : []), space.comingNext ? 'Coming in the next stage' : bx.area.text] : [], font, span * 0.0085);
      if (!fit) return '';
      const f = fit.sizeM;
      placed.push({ spaceId: space.id, lines: fit.lines, x: fit.x, z: fit.z, sizeM: f, widthM: fit.widthM, heightM: fit.heightM });
      const text = fit.lines.map((l, i) => {
        const isSub = i >= fit.nameLines;
        return `<tspan x="${n3(fit.x)}" dy="${i === 0 ? n3(-((fit.lines.length - 1) * f * LABEL_LINE) / 2) : n3(f * LABEL_LINE)}" class="${isSub ? 'bm-sub' : 'bm-name'}" font-size="${n3(isSub ? f * LABEL_SUB_SCALE : f)}">${esc(l)}</tspan>`;
      }).join('');
      return `<text class="bm-label" x="${n3(fit.x)}" y="${n3(fit.z + f * 0.35)}" text-anchor="middle" style="stroke-width:${n3(f * 0.3)}px">${text}</text>`;
    }).join('');
    over.push(
      `<g class="bm-space${on ? ' is-on' : ''}${here ? ' is-here' : ''}${space.comingNext ? ' is-soon' : ''}" data-space="${esc(space.id)}" role="button" tabindex="0" aria-pressed="${on}" aria-label="${esc(aria)}">` +
      bx.rects.map((r) => r.poly
        ? `<polygon class="bm-hit" points="${r.poly.map((p) => `${n3(p.x)},${n3(p.z)}`).join(' ')}"/><polygon class="bm-outline" points="${r.poly.map((p) => `${n3(p.x)},${n3(p.z)}`).join(' ')}" stroke-linejoin="round"/>`
        : `<rect class="bm-hit" x="${n3(r.x0)}" y="${n3(r.z0)}" width="${n3(r.x1 - r.x0)}" height="${n3(r.z1 - r.z0)}"/><rect class="bm-outline" x="${n3(r.x0 - 0.1)}" y="${n3(r.z0 - 0.1)}" width="${n3(r.x1 - r.x0 + 0.2)}" height="${n3(r.z1 - r.z0 + 0.2)}" rx="0.25"/>`).join('') +
      `${labels}</g>`,
    );
  }
  // the walker: a dot where they stand in the space they are in
  const hereBox = o.here ? level.spaces.find((x) => x.id === o.here!.spaceId) : null;
  if (hereBox && o.here?.point) {
    const p = toLevel(o.here.point, hereBox.placement);
    const r = span * 0.012;
    over.push(`<g class="bm-you" aria-hidden="true"><circle class="bm-you-ring" cx="${n3(p.x)}" cy="${n3(p.z)}" r="${n3(r * 2.2)}"/><circle class="bm-you-dot" cx="${n3(p.x)}" cy="${n3(p.z)}" r="${n3(r)}"/></g>`);
  }
  svg = svg.replace(/<\/svg>$/, `${over.join('')}</svg>`);
  return { svg, aspect: pic.aspect, boxes, labels: placed };
}
