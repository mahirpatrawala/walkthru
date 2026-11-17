// Furnishes the living room of a made-up sample home the way the brochure flats' living rooms are furnished (same catalogue pieces, same rules). The reader only
// gives such a home the sofa its drawing draws, so on its own the room is a sofa and a bare floor. One generic pass, no scene in it:
//   - the sofa stands on a wall (a solid stretch of one, a window wall only as the last resort) and a TV unit with its wall-mounted TV stands on the opposite wall,
//     on the same line, at least 2.6 m apart;
//   - a centre table sits between them, in front of the sofa (the lived-in layer lays a rug under it);
//   - a compact dining table sits near the kitchen's door when it fits without shutting a room or blocking a door run (src/building/clear-routes.ts decides).
// Ids start with `dress-` (the drawing's own sofa keeps its id and is moved), so running it again gives the same home. Pure: no I/O.
import { boxCorners, polygonArea, pointInPolygon } from '../src/core/geometry';
import { catalogItem, itemFromCatalog } from '../src/core/catalog';

/** a catalogue piece at the origin, at its own footprint */
const fromCatalog = (id: string): FurnitureItem => { const c = catalogItem(id); return itemFromCatalog(id, { cx: 0, cz: 0, w: c.footprint.w, d: c.footprint.d, yawDeg: 0 }, 'real'); };
import { freePos, resolveDoors } from '../src/core/doors';
import { doorFrame } from '../src/building/geom';
import { routeReport, wallEdges } from '../src/building/clear-routes';
import type { WallEdge } from '../src/building/clear-routes';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { nearestFree } from '../src/core/grid-query';
import type { Box, FurnitureItem, Layout, Vec2 } from '../src/types';

/** how far each door opens (radians, or metres of slide) with these pieces in the home */
function openings(layout: Layout, items: FurnitureItem[]): Map<string, number> {
  const grid = stampFurniture(rasterizeLayout(layout), items);
  return new Map(resolveDoors(layout).filter((d) => d.kind === 'hinged').map((d) => [d.id, freePos(grid, d, 0).pos]));
}
/** no door opens less far than it did before the dressing (or than nine tenths of its way): a piece never stands in a door's swing */
function swingsClear(layout: Layout, before: Map<string, number>, items: FurnitureItem[]): boolean {
  const now = openings(layout, items), max = new Map(resolveDoors(layout).map((d) => [d.id, d.maxPos]));
  for (const [id, pos] of now) if (pos < Math.min(before.get(id) ?? 0, 0.9 * (max.get(id) ?? 0)) - 1e-6) return false;
  return true;
}

/** the walker's start moved to the nearest spot a body fits (0.3 m clear) once the room is furnished */
export function freeSpawn(layout: Layout, items: FurnitureItem[], spawn: { x: number; z: number }): { x: number; z: number } {
  const q = nearestFree(stampFurniture(rasterizeLayout(layout), items), spawn.x, spawn.z, 0.3, 2.5);
  return q ? { x: r3(q.x), z: r3(q.z) } : spawn;
}

const DEG = 180 / Math.PI;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const yawOf = (n: Vec2): number => r3(Math.atan2(n.x, n.z) * DEG);

interface Span { e: WallEdge; lo: number; hi: number; windowed: boolean }

/** the free stretches of every wall: what a door or an opening cuts out (with `pad` m of margin) is not free; a stretch under a window with a low sill is marked */
function spansOf(layout: Layout, edges: WallEdge[], pad: number, sillMax: number): Span[] {
  const out: Span[] = [];
  const cuts = edges.map(() => [] as [number, number][]);
  const win = edges.map(() => [] as [number, number][]);
  for (const o of layout.openings) {
    const f = doorFrame(layout, o.id);
    if (!f) continue;
    edges.forEach((e, i) => {
      const off = (f.centre.x - e.a.x) * e.into.x + (f.centre.z - e.a.z) * e.into.z;
      const u = (f.centre.x - e.a.x) * e.dir.x + (f.centre.z - e.a.z) * e.dir.z;
      if (Math.abs(off) > 0.35 || u < -0.3 || u > e.length + 0.3) return;
      if (o.type === 'window') { if (o.sillM < sillMax) win[i].push([u - f.widthM / 2, u + f.widthM / 2]); } else cuts[i].push([u - f.widthM / 2 - pad, u + f.widthM / 2 + pad]);
    });
  }
  edges.forEach((e, i) => {
    let cur = 0.06;
    for (const [a, b] of [...cuts[i]].sort((x, y) => x[0] - y[0])) { if (a > cur) out.push({ e, lo: cur, hi: Math.min(a, e.length - 0.06), windowed: false }); cur = Math.max(cur, b); }
    if (cur < e.length - 0.06) out.push({ e, lo: cur, hi: e.length - 0.06, windowed: false });
  });
  for (const s of out) s.windowed = win[edges.indexOf(s.e)].some(([a, b]) => a < s.hi && b > s.lo);
  return out;
}

const pointIn = (p: Vec2, b: Box): boolean => {
  const c = Math.cos((b.yawDeg * Math.PI) / 180), s = Math.sin((b.yawDeg * Math.PI) / 180);
  const dx = p.x - b.cx, dz = p.z - b.cz;
  return Math.abs(dx * c - dz * s) <= b.w / 2 && Math.abs(dx * s + dz * c) <= b.d / 2;
};
/** do two footprints overlap, with `pad` m round the first? */
const overlap = (a: Box, b: Box, pad: number): boolean => {
  const ga = { ...a, w: a.w + 2 * pad, d: a.d + 2 * pad };
  if (boxCorners(ga).some((p) => pointIn(p, b)) || boxCorners(b).some((p) => pointIn(p, ga))) return true;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
    const c = Math.cos((ga.yawDeg * Math.PI) / 180), s = Math.sin((ga.yawDeg * Math.PI) / 180);
    const lx = (i / 4 - 0.5) * ga.w, lz = (j / 4 - 0.5) * ga.d;
    if (pointIn({ x: ga.cx + lx * c + lz * s, z: ga.cz - lx * s + lz * c }, b)) return true;
  }
  return false;
};

export function furnishLiving(layout: Layout, furniture: FurnitureItem[], spawn?: { x: number; z: number }): FurnitureItem[] {
  const base = furniture.filter((f) => !f.id.startsWith('dress-'));
  const living = layout.rooms.filter((r) => r.roomType === 'living' && !r.partial).sort((a, b) => Math.abs(polygonArea(b.polygon)) - Math.abs(polygonArea(a.polygon)))[0];
  if (!living) return base;
  const sofa = base.find((f) => f.kind === 'sofa' && f.box.w >= 1.4 && pointInPolygon({ x: f.box.cx, z: f.box.cz }, living.polygon));
  if (!sofa) return base;
  const edges = wallEdges(living.polygon);
  const spans = spansOf(layout, edges, 0.2, 1.0);
  const tvSpans = spansOf(layout, edges, 0.0, 1.0);
  // the drawing's own dining table in this room is placed again after the sofa group (nearest the kitchen's side), so it does not decide where the group goes
  const baseOpen = openings(layout, base);
  const dining0 = base.find((f) => f.kind === 'dining' && pointInPolygon({ x: f.box.cx, z: f.box.cz }, living.polygon));
  const others = base.filter((f) => f !== sofa && f !== dining0);
  const inside = (b: Box): boolean => boxCorners({ ...b, w: b.w + 0.04, d: b.d + 0.04 }).every((p) => pointInPolygon(p, living.polygon));
  const proto = (id: string): FurnitureItem => fromCatalog(id);
  const tbl = proto('coffee-rect');
  interface Plan { score: number; items: FurnitureItem[] }
  const plans: Plan[] = [];
  for (const ss of spans) {
    if (ss.hi - ss.lo < sofa.box.w + 0.05) continue;
    const sLo = ss.lo + sofa.box.w / 2, sHi = ss.hi - sofa.box.w / 2;
    for (const ts of tvSpans) {
      if (ts.e === ss.e || ss.e.into.x * ts.e.into.x + ss.e.into.z * ts.e.into.z > -0.98) continue;
      const dist = (ts.e.a.x - ss.e.a.x) * ss.e.into.x + (ts.e.a.z - ss.e.a.z) * ss.e.into.z; // between the two wall lines
      if (dist < 2.6) continue;
      const along = (e: WallEdge, p: Vec2): number => (p.x - e.a.x) * e.dir.x + (p.z - e.a.z) * e.dir.z;
      const p0 = { x: ts.e.a.x + ts.e.dir.x * ts.lo, z: ts.e.a.z + ts.e.dir.z * ts.lo }, p1 = { x: ts.e.a.x + ts.e.dir.x * ts.hi, z: ts.e.a.z + ts.e.dir.z * ts.hi };
      const t0 = Math.min(along(ss.e, p0), along(ss.e, p1)), t1 = Math.max(along(ss.e, p0), along(ss.e, p1));
      for (const tvId of ['tv-unit-150', 'tv-unit-120']) {
        const tv = proto(tvId);
        const tlo = t0 + tv.box.w / 2, thi = t1 - tv.box.w / 2;
        if (thi < tlo) continue;
        // the sofa in the middle of its stretch, or at either end of it (leaving the other end of the room for the dining table); the TV as near that line as its own
        // stretch lets it be (at most 1.2 m off it: a viewing angle under 20 degrees at 3.4 m)
        const mid = Math.max(sLo, Math.min(sHi, (ss.lo + ss.hi) / 2));
        for (const axis of [...new Set([mid, sLo, sHi])]) {
        const axisT = Math.max(tlo, Math.min(thi, axis));
        if (Math.abs(axisT - axis) > 1.2) continue;
        const base0 = { x: ss.e.a.x + ss.e.dir.x * axis, z: ss.e.a.z + ss.e.dir.z * axis };
        const at = (depth: number, from: number): Vec2 => ({ x: base0.x + ss.e.into.x * (from + depth / 2), z: base0.z + ss.e.into.z * (from + depth / 2) });
        const sc = at(sofa.box.d, 0.03);
        const sofaBox: Box = { cx: r3(sc.x), cz: r3(sc.z), w: sofa.box.w, d: sofa.box.d, yawDeg: yawOf(ss.e.into) };
        const baseT = { x: ss.e.a.x + ss.e.dir.x * axisT, z: ss.e.a.z + ss.e.dir.z * axisT };
        const tvc = { x: baseT.x + ss.e.into.x * (dist - tv.box.d / 2 - 0.02), z: baseT.z + ss.e.into.z * (dist - tv.box.d / 2 - 0.02) };
        const tvBox: Box = { cx: r3(tvc.x), cz: r3(tvc.z), w: tv.box.w, d: tv.box.d, yawDeg: yawOf(ts.e.into) };
        // the centre table in the middle of what is left between sofa and TV, at most 0.6 m off the sofa's front
        const free = dist - 0.03 - sofa.box.d - tv.box.d - 0.02;
        const off = Math.min(0.55, Math.max(0.35, free / 2 - tbl.box.d / 2));
        const tc = at(tbl.box.d, 0.03 + sofa.box.d + off);
        const tblBox: Box = { cx: r3(tc.x), cz: r3(tc.z), w: tbl.box.w, d: tbl.box.d, yawDeg: sofaBox.yawDeg };
        if (free < tbl.box.d + 0.7 || ![sofaBox, tvBox, tblBox].every(inside)) continue;
        if (others.some((o) => overlap(sofaBox, o.box, 0.05) || overlap(tvBox, o.box, 0.05) || overlap(tblBox, o.box, 0.05))) continue;
        plans.push({
          score: (axis === mid ? 0 : 0.2) + Math.abs(axisT - axis) * 0.5 + (ss.windowed ? 3 : 0) + (ts.windowed ? 1 : 0) + (tvId === 'tv-unit-120' ? 0.4 : 0) + (free < 1.9 ? 0.3 : 0),
          items: [{ ...sofa, box: sofaBox }, { ...tv, id: 'dress-tv', label: 'TV unit', box: tvBox }, { ...tbl, id: 'dress-table-centre', label: 'Centre table', box: tblBox }],
        });
        }
      }
    }
  }
  plans.sort((a, b) => a.score - b.score);
  // the best arrangement that also has room for the dining table; failing that, the best one without
  let bare: FurnitureItem[] | null = null;
  for (const p of plans) {
    const set = [...others, ...p.items];
    const rep = routeReport(layout, set, spawn && freeSpawn(layout, set, spawn));
    if (rep.shut.length || rep.blockedDoors.length || !swingsClear(layout, baseOpen, set)) continue;
    const dined = withDining(layout, living.id, set, spawn, dining0);
    if (dined.some((i) => i.kind === 'dining' && (!dining0 || i.id !== dining0.id || i.box.cx !== dining0.box.cx || i.box.cz !== dining0.box.cz) )) return dined;
    bare ??= dining0 && !set.some((o) => overlap(dining0.box, o.box, 0.4)) ? [...set, dining0] : set;
  }
  return bare ?? base;
}

/** a 4-seat dining table near the kitchen's door, the nearest spot that keeps every route and door run clear; none when none does */
function withDining(layout: Layout, livingId: string, items: FurnitureItem[], spawn: { x: number; z: number } | undefined, drawn?: FurnitureItem): FurnitureItem[] {
  const living = layout.rooms.find((r) => r.id === livingId)!;
  const kitchen = layout.rooms.find((r) => r.roomType === 'kitchen' && !r.partial);
  // the way into the kitchen from this room, or else the opening of this room nearest the kitchen's middle
  let anchor: Vec2 | null = null;
  if (kitchen) {
    const kc = kitchen.polygon.reduce((a, p) => ({ x: a.x + p.x / kitchen.polygon.length, z: a.z + p.z / kitchen.polygon.length }), { x: 0, z: 0 });
    let best = Infinity;
    for (const o of layout.openings) {
      if (o.type === 'window' || o.roomId !== livingId) continue;
      const f = doorFrame(layout, o.id);
      if (f && Math.hypot(f.centre.x - kc.x, f.centre.z - kc.z) < best) { best = Math.hypot(f.centre.x - kc.x, f.centre.z - kc.z); anchor = { x: f.centre.x, z: f.centre.z }; }
    }
  }
  const fallback = drawn ? [...items, drawn] : items;
  if (!anchor) return fallback;
  const proto = drawn ?? fromCatalog('dining-4');
  const cands: { box: Box; d: number }[] = [];
  for (let x = anchor.x - 3.4; x <= anchor.x + 3.4; x += 0.1) {
    for (let z = anchor.z - 3.4; z <= anchor.z + 3.4; z += 0.1) {
      for (const yaw of [0, 90]) {
        const box: Box = { cx: r3(x), cz: r3(z), w: proto.box.w, d: proto.box.d, yawDeg: yaw };
        if (!boxCorners({ ...box, w: box.w + 0.1, d: box.d + 0.1 }).every((p) => pointInPolygon(p, living.polygon))) continue;
        if (items.some((o) => overlap(box, o.box, 0.5))) continue;
        cands.push({ box, d: Math.hypot(x - anchor!.x, z - anchor!.z) });
      }
    }
  }
  cands.sort((a, b) => a.d - b.d);
  let tries = 0;
  if (process.env.FDBG) console.log('dining anchor', anchor, 'cands', cands.length);
  for (const c of cands) {
    if (tries++ > 80) break;
    const set = [...items, { ...proto, id: drawn?.id ?? 'dress-dining', label: drawn?.label || 'Dining table with four chairs', box: c.box }];
    const rep = routeReport(layout, set, spawn && freeSpawn(layout, set, spawn));
    if (process.env.FDBG && tries < 4) console.log('  cand', c.box, rep.shut, rep.blockedDoors);
    if (!rep.shut.length && !rep.blockedDoors.length && swingsClear(layout, openings(layout, items), set)) return set;
  }
  return fallback;
}

/**
 * A kitchen with no fridge gets one (catalogue "fridge-1", 58 x 67 cm): against a free stretch of wall, as near a corner as the doors and the worktop allow, out
 * of the way of every window and door run (src/building/clear-routes.ts decides), else none. The tall piece also gives the room a tall mass beside its worktop.
 */
export function furnishKitchen(layout: Layout, furniture: FurnitureItem[], spawn?: { x: number; z: number }): FurnitureItem[] {
  const base = furniture.filter((f) => f.id !== 'dress-fridge');
  const kitchen = layout.rooms.find((r) => r.roomType === 'kitchen' && !r.partial);
  if (!kitchen) return base;
  const inK = (f: FurnitureItem): boolean => pointInPolygon({ x: f.box.cx, z: f.box.cz }, kitchen.polygon);
  if (base.some((f) => inK(f) && /fridge/.test(`${f.catalogId ?? ''} ${f.id} ${f.label}`))) return base;
  const baseOpen = openings(layout, base);
  const edges = wallEdges(kitchen.polygon);
  const spans = spansOf(layout, edges, 0.1, 1.9);
  const fr = fromCatalog('fridge-1');
  const cands: { box: Box; score: number }[] = [];
  for (const s of spans) {
    for (let u = s.lo + fr.box.w / 2; u <= s.hi - fr.box.w / 2 + 1e-9; u += 0.05) {
      const c = { x: s.e.a.x + s.e.dir.x * u + s.e.into.x * (fr.box.d / 2 + 0.02), z: s.e.a.z + s.e.dir.z * u + s.e.into.z * (fr.box.d / 2 + 0.02) };
      const box: Box = { cx: r3(c.x), cz: r3(c.z), w: fr.box.w, d: fr.box.d, yawDeg: yawOf(s.e.into) };
      if (!boxCorners({ ...box, w: box.w + 0.04, d: box.d + 0.04 }).every((p) => pointInPolygon(p, kitchen.polygon))) continue;
      if (base.some((o) => overlap(box, o.box, 0.04))) continue;
      const toCorner = Math.min(u - fr.box.w / 2 - s.lo, s.hi - fr.box.w / 2 - u);
      cands.push({ box, score: toCorner + (s.windowed ? 2 : 0) });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  for (const c of cands.slice(0, 60)) {
    const set = [...base, { ...fr, id: 'dress-fridge', label: 'Fridge', box: c.box }];
    const rep = routeReport(layout, set, spawn && freeSpawn(layout, set, spawn));
    if (!rep.shut.length && !rep.blockedDoors.length && swingsClear(layout, baseOpen, set)) return set;
  }
  return base;
}
