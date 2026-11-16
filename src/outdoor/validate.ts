// Checks of an outdoor.json against the scene it sits beside (SPEC 19.2): everything lies inside the room, the pools keep clear of each other and of the
// walls, a boundary names a real edge, only the facade has a door in it. Errors stop the generator; warnings are said. Pure.
import { pointInPolygon } from '../core/geometry';
import type { Layout, Vec2 } from '../types';
import { rectD, rectW } from './types';
import type { OutdoorFile, PoolBasin, Rect } from './types';
import { basinLengthM, basinWidthM, exposureOf, shallowestM } from './pool';

export interface OutdoorReport { errors: string[]; warnings: string[] }

const EPS = 0.02;
const rectPts = (r: Rect): Vec2[] => [{ x: r.x0, z: r.z0 }, { x: r.x1, z: r.z0 }, { x: r.x1, z: r.z1 }, { x: r.x0, z: r.z1 }];
const grow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, z0: r.z0 - m, x1: r.x1 + m, z1: r.z1 + m });
const overlap = (a: Rect, b: Rect): boolean => a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6;

/** inside the polygon, or within EPS of its edge (a bed laid right up to a wall) */
function inside(room: Vec2[], p: Vec2): boolean {
  if (pointInPolygon(p, room)) return true;
  for (const q of [{ x: p.x + EPS, z: p.z }, { x: p.x - EPS, z: p.z }, { x: p.x, z: p.z + EPS }, { x: p.x, z: p.z - EPS }, { x: p.x + EPS, z: p.z + EPS }, { x: p.x - EPS, z: p.z - EPS }, { x: p.x + EPS, z: p.z - EPS }, { x: p.x - EPS, z: p.z + EPS }]) if (pointInPolygon(q, room)) return true;
  return false;
}

export function validateOutdoor(file: OutdoorFile, layout: Layout): OutdoorReport {
  const errors: string[] = [], warnings: string[] = [];
  const room = layout.rooms[0]?.polygon;
  if (!room) return { errors: ['the scene has no room'], warnings };
  const roomIds = new Set(layout.rooms.map((r) => r.id));
  for (const a of file.areas) for (const [i, p] of a.polygon.entries()) if (!inside(room, p)) { errors.push(`areas "${a.id}" point ${i} (${p.x}, ${p.z}) is outside the room`); break; }
  for (const b of file.beds) for (const [i, p] of b.polygon.entries()) if (!inside(room, p)) { errors.push(`beds "${b.id}" point ${i} (${p.x}, ${p.z}) is outside the room`); break; }
  for (const t of file.trees) if (!inside(room, t)) errors.push(`a ${t.species} at (${t.x}, ${t.z}) is outside the room`);
  for (const r of file.rows) for (const p of [r.from, r.to]) if (!inside(room, p)) errors.push(`row "${r.id}" runs outside the room at (${p.x}, ${p.z})`);
  for (const r of file.roofs) {
    if (!rectPts(r.rect).every((p) => inside(room, p))) errors.push(`roof "${r.id}" is not inside the room`);
    for (const c of r.columns) if (!inside(room, c)) errors.push(`roof "${r.id}" has a column outside the room at (${c.x}, ${c.z})`);
    if (r.kind === 'slab' && r.columns.length < 2) warnings.push(`roof "${r.id}" is a slab on fewer than two columns`);
  }
  file.pools.forEach((b: PoolBasin, i) => {
    const out = grow(b.rect, b.copingM);
    if (!rectPts(out).every((p) => inside(room, p))) errors.push(`pool "${b.id}" and its coping are not inside the room`);
    for (const o of file.pools.slice(i + 1)) {
      // two basins that touch along an edge are one body of water (an L-shaped pool drawn as rectangles): only their water must not overlap
      const joined = exposureOf(b, [b, o]).seams.length > 0;
      if (joined ? overlap(b.rect, o.rect) : overlap(out, grow(o.rect, o.copingM))) errors.push(`pools "${b.id}" and "${o.id}" overlap`);
    }
    const lengthByEdge = (e: string): number => (e === 'N' || e === 'S' ? rectW(b.rect) : rectD(b.rect));
    for (const s of b.steps) {
      if (s.fromM + s.widthM > lengthByEdge(s.edge) + 1e-6) errors.push(`pool "${b.id}": steps on edge ${s.edge} run past the end of the edge`);
      const into = (s.treadM ?? 0.3) * s.count;
      const across = s.edge === 'N' || s.edge === 'S' ? rectD(b.rect) : rectW(b.rect);
      if (into > across / 2) errors.push(`pool "${b.id}": steps on edge ${s.edge} go more than halfway across`);
    }
    for (const l of b.ladders) if (l.atM > lengthByEdge(l.edge)) errors.push(`pool "${b.id}": a ladder on edge ${l.edge} is past the end of the edge`);
    if (!b.kids && shallowestM(b) > 1.5) warnings.push(`pool "${b.id}" is nowhere shallower than ${shallowestM(b).toFixed(1)} m`);
    if (b.kids && Math.max(...b.profile.map((p) => p[1])) > 0.7) warnings.push(`children's pool "${b.id}" is deeper than 0.7 m`);
    if (Math.min(basinLengthM(b), basinWidthM(b)) < 1) errors.push(`pool "${b.id}" is under a metre wide`);
  });
  for (const e of file.boundary) {
    const r = layout.rooms.find((x) => x.id === e.room);
    if (!roomIds.has(e.room) || !r) { errors.push(`boundary names room "${e.room}", which is not in the scene`); continue; }
    if (e.edge >= r.polygon.length) { errors.push(`boundary edge ${e.edge} of "${e.room}" does not exist`); continue; }
    const doors = layout.openings.filter((o) => o.roomId === e.room && o.edge === e.edge);
    if (doors.length && e.kind !== 'facade') errors.push(`edge ${e.edge} of "${e.room}" has an opening but its boundary is a ${e.kind}: only the facade can have a door`);
    if (e.kind === 'facade' && doors.length === 0) warnings.push(`the facade of "${e.room}" (edge ${e.edge}) has no door`);
  }
  const named = new Set(file.boundary.map((b) => `${b.room}:${b.edge}`));
  layout.rooms.forEach((r) => r.polygon.forEach((_, k) => { if (!named.has(`${r.id}:${k}`)) warnings.push(`edge ${k} of "${r.id}" has no boundary: the plain layout wall stands there`); }));
  return { errors, warnings };
}
