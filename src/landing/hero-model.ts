// The landing hero's drawing, as data: the featured building's levels stacked on their lift core, each room's wall lines, the pool
// water, a walk through one flat, and the few facts the labels state. Everything comes from building.json and the scenes behind its
// spaces; nothing here names a building, a flat or a number. Pure: no DOM, no canvas, no three.
import { polygonArea, pointInPolygon } from '../core/geometry';
import { carpetAreaM2, computeEdgeFrames } from '../core/layout-geom';
import { dirToLevel, doorFrame, toLevel } from '../building/geom';
import { flatRow } from '../building/flats';
import type { SceneInfo } from '../building/load';
import type { BuildingFile, Level, Space } from '../building/types';
import type { Layout, Vec2 } from '../types';

export interface HeroSeg { a: Vec2; b: Vec2; /** a railing (a balcony's open side), drawn lighter */ rail: boolean }
export interface HeroSpace {
  id: string;
  kind: Space['kind'];
  /** wall and railing lines of every room, on the shared plan */
  segs: HeroSeg[];
  /** room outlines (for the floor fill) */
  floors: Vec2[][];
  /** pool water outlines */
  water: Vec2[][];
  bounds: Bounds;
}
export interface HeroLevel {
  id: string; label: string;
  /** the floor's height above the lowest floor, and the height of the floor above it (its ceiling), metres */
  y: number; top: number;
  spaces: HeroSpace[]; bounds: Bounds;
  /** this level has flats */
  homes: boolean;
  /** the outline a band drawn tight round the whole floor would take (its convex hull): the envelope of a flats floor */
  hull: Vec2[];
}
export type FactId = 'flat' | 'pool' | 'flats' | 'lobby';
export interface HeroFact { id: FactId; text: string; levelId: string; /** the point on the plan the leader line starts from */ at: Vec2 }
export interface HeroWalk { levelId: string; spaceId: string; /** a closed loop on the shared plan */ path: Vec2[]; lengthM: number }
export interface Bounds { x0: number; z0: number; x1: number; z1: number }
export interface HeroModel {
  levels: HeroLevel[];
  facts: HeroFact[];
  walk: HeroWalk | null;
  /** what the picture must keep in frame, per level (the rest of a wide level may run off the edge) */
  focus: { levelId: string; bounds: Bounds }[];
  /** where the lift doors stand on the shared plan: the lines of the lift shafts, which run from the lowest floor to the roof */
  core: Vec2[];
  /** the level the settled picture lights */
  featuredLevelId: string | null;
}

const boundsOf = (pts: Vec2[]): Bounds => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  return { x0, z0, x1, z1 };
};
const union = (a: Bounds, b: Bounds): Bounds => ({ x0: Math.min(a.x0, b.x0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), z1: Math.max(a.z1, b.z1) });
/** The convex hull of a set of points, in order round it (Andrew's monotone chain); points on a straight run are dropped. */
export function convexHull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const half = (list: Vec2[]): Vec2[] => {
    const out: Vec2[] = [];
    for (const q of list) { while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 1e-9) out.pop(); out.push(q); }
    out.pop();
    return out;
  };
  return [...half(p), ...half(p.reverse())];
}
const EMPTY: Bounds = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
const centreOf = (b: Bounds): Vec2 => ({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 });
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

type Xf = (p: Vec2) => Vec2;

/**
 * Each level's plan has its own origin. The lifts run through all of them, so the lift doors line the levels up: a level is moved so
 * the middle of its lift doors is the origin and turned (in quarter turns) so the doors face south. A level with no lift door keeps
 * its own frame, centred.
 */
export function levelFrame(level: Level, scenes: ReadonlyMap<string, SceneInfo>): Xf {
  const centres: Vec2[] = [];
  let ox = 0, oz = 0;
  for (const s of level.spaces) {
    const layout = scenes.get(s.sceneId)?.property.layout;
    if (!layout) continue;
    for (const p of s.portals) {
      if (p.kind !== 'lift') continue;
      const f = doorFrame(layout, p.opening);
      if (!f) continue;
      centres.push(toLevel(f.centre, s.placement));
      const o = dirToLevel(f.out, s.placement);
      ox += o.x; oz += o.z;
    }
  }
  if (centres.length === 0) {
    const pts: Vec2[] = [];
    for (const s of level.spaces) for (const r of scenes.get(s.sceneId)?.property.layout.rooms ?? []) for (const q of r.polygon) pts.push(toLevel(q, s.placement));
    if (pts.length === 0) return (p) => p;
    const c = centreOf(boundsOf(pts));
    return (p) => ({ x: p.x - c.x, z: p.z - c.z });
  }
  const c = { x: centres.reduce((s, p) => s + p.x, 0) / centres.length, z: centres.reduce((s, p) => s + p.z, 0) / centres.length };
  // quarter turns that bring the doors' outward direction to +z
  const turns = Math.abs(oz) >= Math.abs(ox) ? (oz >= 0 ? 0 : 2) : (ox > 0 ? 1 : 3);
  return (p) => {
    let x = p.x - c.x, z = p.z - c.z;
    for (let i = 0; i < turns; i++) { const t = x; x = -z; z = t; }
    return { x, z };
  };
}

function spaceGeometry(space: Space, scene: SceneInfo, xf: Xf): HeroSpace {
  const at: Xf = (p) => xf(toLevel(p, space.placement));
  const segs: HeroSeg[] = [];
  const floors: Vec2[][] = [];
  const all: Vec2[] = [];
  for (const r of scene.property.layout.rooms) {
    const poly = r.polygon.map(at);
    floors.push(poly);
    all.push(...poly);
    for (let i = 0; i < poly.length; i++) {
      const kind = r.edges[i] ?? 'wall';
      if (kind === 'none') continue;
      segs.push({ a: poly[i], b: poly[(i + 1) % poly.length], rail: kind === 'railing' });
    }
  }
  const water = (scene.outdoor?.pools ?? []).map((b) => [{ x: b.rect.x0, z: b.rect.z0 }, { x: b.rect.x1, z: b.rect.z0 }, { x: b.rect.x1, z: b.rect.z1 }, { x: b.rect.x0, z: b.rect.z1 }].map(at));
  return { id: space.id, kind: space.kind, segs, floors, water, bounds: all.length ? boundsOf(all) : EMPTY };
}

// ---------------------------------------------------------------- the walk through one flat

/** A point well inside a room: its centroid when that is inside, else the middle of its longest edge pulled inwards. */
function roomPoint(poly: Vec2[]): Vec2 {
  const a = polygonArea(poly);
  let cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const k = p.x * q.z - q.x * p.z;
    cx += (p.x + q.x) * k; cz += (p.z + q.z) * k;
  }
  const c = Math.abs(a) > 1e-9 ? { x: cx / (6 * a), z: cz / (6 * a) } : poly[0];
  if (pointInPolygon(c, poly)) return c;
  let best = c, bestD = -1;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const m = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
    const t = { x: m.x + (c.x - m.x) * 0.25, z: m.z + (c.z - m.z) * 0.25 };
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d > bestD && pointInPolygon(t, poly)) { best = t; bestD = d; }
  }
  return best;
}

/**
 * A stroll through a flat, in the flat's own frame: in at the main door, then room to room through the doorways (and across the open
 * sides of an open plan), back the way it came, so the path closes on itself. At most `maxRooms` rooms; wet rooms and balconies are
 * left out, as a visitor would be shown the living spaces first.
 */
export function strollPath(layout: Layout, entryOpeningId: string | null, maxRooms = 6): Vec2[] {
  const frames = computeEdgeFrames(layout);
  const byId = new Map(layout.rooms.map((r) => [r.id, r]));
  const roomAtPoint = (p: Vec2, not: string): string | null => layout.rooms.find((r) => r.id !== not && pointInPolygon(p, r.polygon))?.id ?? null;
  const links = new Map<string, { to: string; via: Vec2 }[]>();
  const link = (from: string, to: string, via: Vec2): void => {
    for (const [a, b] of [[from, to], [to, from]] as const) {
      const list = links.get(a) ?? [];
      if (!list.some((l) => l.to === b)) list.push({ to: b, via });
      links.set(a, list);
    }
  };
  for (const o of layout.openings) {
    if (o.type === 'window') continue;
    const f = frames.find((q) => q.roomId === o.roomId && q.edge === o.edge);
    if (!f) continue;
    const via = { x: f.a.x + f.dir.x * o.centreM, z: f.a.z + f.dir.z * o.centreM };
    for (const reach of [f.thickness + 0.25, f.thickness + 0.6, 0.15]) {
      const other = roomAtPoint({ x: via.x + f.out.x * reach, z: via.z + f.out.z * reach }, o.roomId);
      if (other) { link(o.roomId, other, { x: via.x + f.out.x * f.thickness / 2, z: via.z + f.out.z * f.thickness / 2 }); break; }
    }
  }
  for (const f of frames) {
    if (f.kind !== 'none') continue;
    const mid = { x: (f.a.x + f.b.x) / 2, z: (f.a.z + f.b.z) / 2 };
    const other = roomAtPoint({ x: mid.x + f.out.x * 0.12, z: mid.z + f.out.z * 0.12 }, f.roomId);
    if (other) link(f.roomId, other, mid);
  }
  const entry = layout.openings.find((o) => o.id === entryOpeningId);
  const start = (entry && byId.get(entry.roomId)) ?? layout.rooms.find((r) => r.roomType === 'living') ?? layout.rooms[0];
  if (!start) return [];
  const skip = (id: string): boolean => { const t = byId.get(id)?.roomType; return t === 'bathroom' || t === 'balcony'; };
  const seen = new Set<string>([start.id]);
  const path: Vec2[] = [];
  const visit = (id: string): void => {
    const here = roomPoint(byId.get(id)!.polygon);
    path.push(here);
    for (const l of links.get(id) ?? []) {
      if (seen.has(l.to) || skip(l.to) || seen.size >= maxRooms) continue;
      seen.add(l.to);
      path.push(l.via);
      visit(l.to);
      path.push(l.via, here);
    }
  };
  visit(start.id);
  return path;
}

const pathLength = (p: Vec2[]): number => p.reduce((s, q, i) => s + (i ? Math.hypot(q.x - p[i - 1].x, q.z - p[i - 1].z) : 0), 0);

// ---------------------------------------------------------------- the model

/** "Clubhouse: games, gym" -> "Clubhouse"; a summary with no such lead gives the level's own label. */
function levelName(level: Level): string {
  const lead = level.summary.split(':')[0].trim();
  return level.summary.includes(':') && lead.length > 0 && lead.length <= 24 ? lead : level.label;
}
const metres = (m: number): string => (Math.abs(m - Math.round(m)) <= 0.05 ? String(Math.round(m)) : m.toFixed(1));

export function buildHeroModel(b: BuildingFile, scenes: ReadonlyMap<string, SceneInfo>): HeroModel {
  const levels: HeroLevel[] = [];
  const frames = new Map<string, Xf>();
  let y = 0;
  for (const level of b.levels) {
    const xf = levelFrame(level, scenes);
    frames.set(level.id, xf);
    const spaces: HeroSpace[] = [];
    for (const s of level.spaces) { const scene = scenes.get(s.sceneId); if (scene) spaces.push(spaceGeometry(s, scene, xf)); }
    const top = y + (level.floorToFloorM ?? b.floorToFloorM);
    levels.push({ id: level.id, label: level.label, y, top, spaces, bounds: spaces.reduce((acc, s) => union(acc, s.bounds), EMPTY), homes: level.spaces.some((s) => s.kind === 'home'), hull: convexHull(spaces.flatMap((s) => s.floors.flat())) });
    y = top;
  }
  const geo = (levelId: string, spaceId: string): HeroSpace | undefined => levels.find((l) => l.id === levelId)?.spaces.find((s) => s.id === spaceId);

  const facts: HeroFact[] = [];
  const focus: { levelId: string; bounds: Bounds }[] = [];
  let walk: HeroWalk | null = null;
  let featuredLevelId: string | null = null;

  // the flats: the largest measured flat of the highest floor that has flats
  const homeLevels = b.levels.filter((l) => l.spaces.some((s) => s.kind === 'home' && !s.comingNext));
  const flatsOf = (l: Level): Space[] => l.spaces.filter((s) => s.kind === 'home' && !s.comingNext);
  const top = homeLevels[homeLevels.length - 1];
  if (top) {
    featuredLevelId = top.id;
    let best: { space: Space; area: number } | null = null;
    for (const s of flatsOf(top)) {
      const scene = scenes.get(s.sceneId);
      if (!scene) continue;
      const flagged = scene.property.layout.rooms.some((r) => r.roomType !== 'balcony' && (r.partial || scene.unverified[r.id]));
      const area = flagged ? 0 : carpetAreaM2(scene.property.layout);
      if (!best || area > best.area) best = { space: s, area };
    }
    if (best) {
      const row = flatRow(b, best.space);
      const g = geo(top.id, best.space.id);
      if (g) facts.push({ id: 'flat', text: row.detail ? `${row.title} · ${row.detail}` : row.title, levelId: top.id, at: centreOf(g.bounds) });
      const scene = scenes.get(best.space.sceneId)!;
      const main = best.space.portals.find((p) => p.kind === 'door');
      const xf = frames.get(top.id)!;
      const path = strollPath(scene.property.layout, main?.opening ?? null).map((p) => xf(toLevel(p, best!.space.placement)));
      if (path.length >= 3) walk = { levelId: top.id, spaceId: best.space.id, path, lengthM: pathLength(path) };
    }
    const counts = homeLevels.map((l) => flatsOf(l).length);
    const same = counts.every((n) => n === counts[0]);
    const total = counts.reduce((s, n) => s + n, 0);
    // on the floor below the featured one when there is one, so the two labels do not crowd one level
    const host = homeLevels.length > 1 ? homeLevels[homeLevels.length - 2] : top;
    const hostLevel = levels.find((l) => l.id === host.id);
    if (hostLevel && total > 0) {
      const text = same && homeLevels.length > 1 ? `${plural(counts[0], 'flat', 'flats')} a floor` : plural(total, 'flat', 'flats');
      const corridor = hostLevel.spaces.find((s) => s.kind === 'corridor') ?? hostLevel.spaces[0];
      facts.push({ id: 'flats', text, levelId: host.id, at: centreOf(corridor ? corridor.bounds : hostLevel.bounds) });
    }
    for (const l of homeLevels) { const hl = levels.find((q) => q.id === l.id); if (hl) focus.push({ levelId: l.id, bounds: hl.bounds }); }
  }

  // the pool: the longest basin of any open-air space
  let pool: { level: Level; long: number; short: number; centre: Vec2; bounds: Bounds } | null = null;
  for (const level of b.levels) for (const s of level.spaces) {
    const xf = frames.get(level.id)!;
    for (const basin of scenes.get(s.sceneId)?.outdoor?.pools ?? []) {
      const w = basin.rect.x1 - basin.rect.x0, d = basin.rect.z1 - basin.rect.z0;
      const long = Math.max(w, d), short = Math.min(w, d);
      if (pool && long <= pool.long) continue;
      const corners = [{ x: basin.rect.x0, z: basin.rect.z0 }, { x: basin.rect.x1, z: basin.rect.z1 }].map((p) => xf(toLevel(p, s.placement)));
      pool = { level, long, short, centre: centreOf(boundsOf(corners)), bounds: boundsOf(corners) };
    }
  }
  if (pool) {
    const lap = pool.long >= 20 && pool.long / Math.max(pool.short, 0.1) >= 3;
    facts.push({ id: 'pool', text: `${levelName(pool.level)} · ${metres(pool.long)} m ${lap ? 'lap pool' : 'pool'}`, levelId: pool.level.id, at: pool.centre });
    focus.push({ levelId: pool.level.id, bounds: pool.bounds });
  }

  // the lobby and its lifts
  const ground = b.levels[0];
  const lobby = ground?.spaces.find((s) => s.kind === 'lobby');
  if (ground && lobby) {
    const g = geo(ground.id, lobby.id);
    const lifts = b.lifts.filter((l) => l.serves.includes(ground.id)).length;
    if (g) {
      facts.push({ id: 'lobby', text: lifts > 0 ? `Lobby · ${plural(lifts, 'lift', 'lifts')}` : 'Lobby', levelId: ground.id, at: centreOf(g.bounds) });
      focus.push({ levelId: ground.id, bounds: g.bounds });
    }
  }
  // the lift shafts: the lift doors of the featured floor (every floor's doors stand at the same place once lined up)
  const core: Vec2[] = [];
  const coreLevel = b.levels.find((l) => l.id === featuredLevelId) ?? b.levels[b.levels.length - 1];
  if (coreLevel) for (const s of coreLevel.spaces) {
    const layout = scenes.get(s.sceneId)?.property.layout;
    if (!layout) continue;
    for (const p of s.portals) { if (p.kind !== 'lift') continue; const f = doorFrame(layout, p.opening); if (f) core.push(frames.get(coreLevel.id)!(toLevel(f.centre, s.placement))); }
  }
  if (focus.length === 0) for (const l of levels) focus.push({ levelId: l.id, bounds: l.bounds });
  return { levels, facts, walk, focus, core, featuredLevelId: featuredLevelId ?? levels[levels.length - 1]?.id ?? null };
}

/** The scene ids a building's picture needs, each once. */
export function heroSceneIds(b: BuildingFile): string[] {
  return [...new Set(b.levels.flatMap((l) => l.spaces.map((s) => s.sceneId)))];
}

// ---------------------------------------------------------------- the view (an orthographic camera looking down at the stack)

export interface HeroView {
  /** radians: the turn about the vertical, and how far the camera looks down (0 is a side elevation, PI/2 a plan) */
  yaw: number; pitch: number;
  /** pixels per metre, and how much the storey heights are stretched so each floor's plan shows */
  scale: number; stretch: number;
  /** where the plan origin at height 0 lands, pixels */
  cx: number; cy: number;
}

/** A point of the shared plan at height y (metres) on the screen: x right, y down. */
export function project(v: HeroView, x: number, y: number, z: number): [number, number] {
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
  const xr = x * c - z * s, zr = x * s + z * c;
  return [v.cx + xr * v.scale, v.cy + (zr * Math.sin(v.pitch) - y * v.stretch * Math.cos(v.pitch)) * v.scale];
}

/** The scale and centre that put the model's focus inside a w x h box with `pad` to spare on every side (same units as w and h). */
export function fitView(m: HeroModel, w: number, h: number, yaw: number, pitch: number, stretch: number, pad: number): HeroView {
  const unit: HeroView = { yaw, pitch, stretch, scale: 1, cx: 0, cy: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of m.focus) {
    const level = m.levels.find((l) => l.id === f.levelId);
    if (!level || !Number.isFinite(f.bounds.x0)) continue;
    for (const [x, z] of [[f.bounds.x0, f.bounds.z0], [f.bounds.x1, f.bounds.z0], [f.bounds.x1, f.bounds.z1], [f.bounds.x0, f.bounds.z1]]) {
      // a flats floor is drawn with its storey above it (the envelope), so its ceiling must fit too
      for (const y of level.homes ? [level.y, level.top] : [level.y]) {
        const [sx, sy] = project(unit, x, y, z);
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
      }
    }
  }
  if (!Number.isFinite(x0)) return { ...unit, cx: w / 2, cy: h / 2 };
  const scale = Math.max(0.01, Math.min((w - 2 * pad) / Math.max(x1 - x0, 1e-6), (h - 2 * pad) / Math.max(y1 - y0, 1e-6)));
  return { ...unit, scale, cx: w / 2 - ((x0 + x1) / 2) * scale, cy: h / 2 - ((y0 + y1) / 2) * scale };
}

/** The point `d` metres along a path (wrapped), for the walker. */
export function pointAlong(path: Vec2[], d: number): Vec2 {
  const total = pathLength(path);
  if (path.length === 0) return { x: 0, z: 0 };
  if (total <= 0) return path[0];
  let left = ((d % total) + total) % total;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], q = path[i];
    const len = Math.hypot(q.x - a.x, q.z - a.z);
    if (left <= len) { const t = len > 0 ? left / len : 0; return { x: a.x + (q.x - a.x) * t, z: a.z + (q.z - a.z) * t }; }
    left -= len;
  }
  return path[path.length - 1];
}
