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
  if (space.kind === 'flat') {
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
export interface SpaceBox { spaceId: string; x0: number; z0: number; x1: number; z1: number; rects: (Rect & { label: string })[]; area: SpaceArea }
export interface LevelPlan { svg: string; aspect: number; boxes: SpaceBox[] }

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
  for (const s of level.spaces) {
    const sc = scenes.get(s.sceneId);
    if (!sc) continue;
    const lay = sc.property.layout;
    wall = Math.max(wall, lay.wallHeightM);
    const placed = roomsOnLevel(lay, s.placement);
    const key = (id: string): string => `${s.id}~${id}`;
    for (const r of placed) { rooms.push({ ...r, id: key(r.id) }); if (sc.unverified[r.id]) unverified[key(r.id)] = sc.unverified[r.id]; }
    for (const op of lay.openings) openings.push({ ...op, id: key(op.id), roomId: key(op.roomId) });
    const rectOf = (rs: RoomTag[]): Rect => {
      const xs = rs.flatMap((r) => r.polygon.map((p) => p.x)), zs = rs.flatMap((r) => r.polygon.map((p) => p.z));
      return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs), z1: Math.max(...zs) };
    };
    const body = placed.filter((r) => r.roomType !== 'balcony');
    const rects = s.kind === 'flat' || body.length <= 1 ? [{ ...rectOf(body.length ? body : placed), label: s.name }] : body.map((r) => ({ ...rectOf([r]), label: r.label }));
    const all = rectOf(placed);
    boxes.push({ spaceId: s.id, ...all, rects, area: spaceArea(s, sc) });
  }
  const layout: PlanLayout = { wallHeightM: wall, wallThicknessM: 0.12, railingHeightM: 1.1, rooms, openings };
  const pic = planSvg(layout, unverified, { idPrefix: o.idPrefix, title: `Plan of ${level.label}, ${b.name}` });
  // the room names of every flat are too small to read at this scale: the spaces carry the labels
  let svg = pic.svg.replace(/<text class="plan-label[\s\S]*?<\/text>/g, '');
  const vb = /viewBox="([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)"/.exec(svg);
  const span = vb ? Math.max(+vb[3], +vb[4]) : 30;
  const font = span * 0.021;
  const over: string[] = [];
  for (const bx of boxes) {
    const space = level.spaces.find((x) => x.id === bx.spaceId)!;
    const on = o.selected === space.id;
    const here = o.here?.spaceId === space.id;
    const title = space.kind === 'flat' ? space.name.split(' · ')[0] : space.name.replace(/ \(placeholder\)$/, '');
    const sub = space.kind === 'flat' ? `${space.name.split(' · ')[1] ?? ''}` : '';
    const aria = `${space.name}, ${space.comingNext ? 'coming in the next stage' : bx.area.text}`;
    const labels = bx.rects.map((r) => {
      const w = r.x1 - r.x0;
      // a space of one room is named once and carries the area; a lobby with two rooms names each, and the narrow corridor is left to the list
      const single = bx.rects.length === 1;
      const lines = single ? [title, ...(sub ? [sub] : []), ...(space.comingNext ? ['Coming in the next stage'] : [bx.area.text])] : (w >= 3.5 ? [r.label] : []);
      if (lines.length === 0) return '';
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      // shrink the type to the room, never grow past the level's own scale
      const longest = Math.max(...lines.map((l, i) => l.length * (i === 0 ? 0.6 : 0.52)));
      const f = Math.max(span * 0.011, Math.min(font, (w * 0.9) / longest));
      const text = lines.map((l, i) => `<tspan x="${n3(cx)}" dy="${i === 0 ? n3(-((lines.length - 1) * f * 1.25) / 2) : n3(f * 1.25)}" class="${i === 0 ? 'bm-name' : 'bm-sub'}" font-size="${n3(i === 0 ? f : f * 0.82)}">${esc(l)}</tspan>`).join('');
      return `<text class="bm-label" x="${n3(cx)}" y="${n3(cz + f * 0.35)}" text-anchor="middle" style="stroke-width:${n3(f * 0.3)}px">${text}</text>`;
    }).join('');
    over.push(
      `<g class="bm-space${on ? ' is-on' : ''}${here ? ' is-here' : ''}${space.comingNext ? ' is-soon' : ''}" data-space="${esc(space.id)}" role="button" tabindex="0" aria-pressed="${on}" aria-label="${esc(aria)}">` +
      bx.rects.map((r) => `<rect class="bm-hit" x="${n3(r.x0)}" y="${n3(r.z0)}" width="${n3(r.x1 - r.x0)}" height="${n3(r.z1 - r.z0)}"/><rect class="bm-outline" x="${n3(r.x0 - 0.1)}" y="${n3(r.z0 - 0.1)}" width="${n3(r.x1 - r.x0 + 0.2)}" height="${n3(r.z1 - r.z0 + 0.2)}" rx="0.25"/>`).join('') +
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
  return { svg, aspect: pic.aspect, boxes };
}
