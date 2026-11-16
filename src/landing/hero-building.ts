// The landing hero's building in three dimensions: the plan model (hero-model.ts) raised into storeys. Each storey is an outline on
// the plan between two heights, with the runs of its outer wall, the windows the drawings put on them, and, for a flats floor, the
// plan inside, a few pieces of furniture and a stroll. The tower stands on open storeys over the lobby; the pool deck and the part of
// the clubhouse next to the tower stand on their own base beside it. Nothing here names a building. Pure: no DOM, no canvas.
import { boxCorners, distanceToSegment, pointInPolygon } from '../core/geometry';
import { computeEdgeFrames } from '../core/layout-geom';
import { toLevel } from '../building/geom';
import type { SceneInfo } from '../building/load';
import type { BuildingFile } from '../building/types';
import type { Vec2 } from '../types';
import type { Subject } from './hero-camera';
import { levelFrame } from './hero-model';
import type { Bounds, FactId, HeroModel, HeroSeg } from './hero-model';

export interface Run { a: Vec2; b: Vec2; /** unit, out of the building */ nx: number; nz: number; /** a balcony's railing: a low wall, open above */ rail: boolean }
export interface Win { a: Vec2; b: Vec2; nx: number; nz: number; /** metres above the storey's floor */ sill: number; head: number; door: boolean; spaceId: string }
export interface Block { poly: Vec2[]; h: number }
export type StoreyKind = 'stilts' | 'base' | 'flats' | 'club' | 'room' | 'core' | 'roof';
export interface Storey {
  id: string;
  levelId: string | null;
  group: 'tower' | 'podium' | 'pavilion' | 'lobby' | 'core';
  kind: StoreyKind;
  y0: number; y1: number;
  /** the outline on the plan: one loop, or several for a floor in separate parts */
  loops: Vec2[][];
  runs: Run[];
  windows: Win[];
  /** its top is drawn as a face (a deck, a roof); a tower storey is closed by the slab of the storey above instead */
  cap: boolean;
  /** water on the cap */
  water: Vec2[][];
  /** a flats floor: the lines of its plan, some furniture, and the walker's loop */
  plan: HeroSeg[];
  blocks: Block[];
  walk: Vec2[] | null;
  /** -1: standing from the start. 0, 1, ...: built in this order, the roof last. */
  build: number;
}
export interface Anchor { id: FactId; x: number; y: number; z: number; /** the wall it sits on faces this way; 0, 0 for a point that looks up */ nx: number; nz: number }
export interface HeroBuilding {
  storeys: Storey[];
  /** the floor heights at which storeys start, lowest first: the picture is drawn band by band */
  bands: number[];
  subject: Subject;
  anchors: Anchor[];
  /** how many things are built in the animation (floors, then the roof) */
  builds: number;
  roofY: number;
}

// ---------------------------------------------------------------- an outline round a set of rooms

const boundsOf = (pts: Vec2[]): Bounds => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  return { x0, z0, x1, z1 };
};
const areaOf = (p: Vec2[]): number => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i].x * q.z - q.x * p[i].z; } return a / 2; };

/**
 * The outer wall line of a floor: the outline round all its rooms taken together. Rooms are drawn by their inside faces, so there
 * are gaps the thickness of a wall between them; the rooms are painted on a grid (`cell` metres), gaps up to twice `close` cells are
 * closed, and the edge of the painted area is walked. Every loop of 4 m² or more is returned, each going the same way round;
 * courtyards and light wells (holes) are left out. The lines are axis-aligned and lie within a cell of the true wall.
 */
export function outline(polys: Vec2[][], cell = 0.25, close = 2): Vec2[][] {
  const pts = polys.flat();
  if (pts.length < 3) return [];
  const b = boundsOf(pts), pad = close + 2;
  const ox = Math.floor(b.x0 / cell) - pad, oz = Math.floor(b.z0 / cell) - pad;
  const W = Math.ceil(b.x1 / cell) + pad - ox, H = Math.ceil(b.z1 / cell) + pad - oz;
  let g: Uint8Array = new Uint8Array(W * H);
  for (const poly of polys) {
    const pb = boundsOf(poly);
    for (let j = Math.max(0, Math.floor(pb.z0 / cell) - oz); j < Math.min(H, Math.ceil(pb.z1 / cell) - oz); j++) {
      const z = (j + oz + 0.5) * cell, xs: number[] = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        if ((p.z > z) !== (q.z > z)) xs.push(p.x + ((z - p.z) * (q.x - p.x)) / (q.z - p.z));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        // a cell is painted when its centre is inside
        for (let i = Math.max(0, Math.ceil(xs[k] / cell - 0.5) - ox); i <= Math.min(W - 1, Math.floor(xs[k + 1] / cell - 0.5) - ox); i++) g[j * W + i] = 1;
      }
    }
  }
  // closing: grow by `close` cells, then shrink by as many
  const pass = (src: Uint8Array, grow: boolean): Uint8Array => {
    const want = grow ? 1 : 0;
    const row = new Uint8Array(W * H), out = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let v = 1 - want;
      for (let k = -close; k <= close; k++) { const q = i + k; const c = q < 0 || q >= W ? 0 : src[j * W + q]; if (c === want) { v = want; break; } }
      row[j * W + i] = v;
    }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let v = 1 - want;
      for (let k = -close; k <= close; k++) { const q = j + k; const c = q < 0 || q >= H ? 0 : row[q * W + i]; if (c === want) { v = want; break; } }
      out[j * W + i] = v;
    }
    return out;
  };
  if (close > 0) g = pass(pass(g, true), false);
  const at = (i: number, j: number): number => (i < 0 || j < 0 || i >= W || j >= H ? 0 : g[j * W + i]);
  // the edges between a painted cell and an empty one, each pointing so the painted side is on its right
  const next = new Map<number, number[]>();
  const key = (i: number, j: number): number => j * (W + 1) + i;
  const add = (i0: number, j0: number, i1: number, j1: number): void => { const k = key(i0, j0); const list = next.get(k); if (list) list.push(key(i1, j1)); else next.set(k, [key(i1, j1)]); };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!g[j * W + i]) continue;
    if (!at(i, j - 1)) add(i, j, i + 1, j);
    if (!at(i + 1, j)) add(i + 1, j, i + 1, j + 1);
    if (!at(i, j + 1)) add(i + 1, j + 1, i, j + 1);
    if (!at(i - 1, j)) add(i, j + 1, i, j);
  }
  const loops: Vec2[][] = [];
  const pt = (k: number): Vec2 => ({ x: ((k % (W + 1)) + ox) * cell, z: (Math.floor(k / (W + 1)) + oz) * cell });
  for (const start of [...next.keys()]) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const loop: number[] = [];
      let at0 = start;
      for (let guard = 0; guard < 4 * W * H; guard++) {
        const list = next.get(at0);
        if (!list || list.length === 0) break;
        loop.push(at0);
        at0 = list.pop()!;
        if (at0 === start) break;
      }
      const raw = loop.map(pt);
      // drop the points in the middle of a straight run
      const poly = raw.filter((p, i) => { const a = raw[(i + raw.length - 1) % raw.length], c = raw[(i + 1) % raw.length]; return Math.abs((p.x - a.x) * (c.z - p.z) - (p.z - a.z) * (c.x - p.x)) > 1e-9; });
      if (poly.length >= 4) loops.push(poly);
    }
  }
  // painted on the right of every edge: outer loops all turn the same way, holes the other
  return loops.filter((l) => areaOf(l) >= 4);
}

const inLoops = (loops: Vec2[][], p: Vec2): boolean => loops.some((l) => pointInPolygon(p, l));

/** The outer wall of an outline as runs with their outward normals; a stretch that lies along a balcony's railing is a railing. */
export function wallRuns(loops: Vec2[][], rails: HeroSeg[], step = 0.5): Run[] {
  const runs: Run[] = [];
  for (const loop of loops) {
    const sign = areaOf(loop) > 0 ? 1 : -1;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-6) continue;
      const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len, nx = dz * sign, nz = -dx * sign;
      const n = Math.max(1, Math.round(len / step));
      let from = 0, kind: boolean | null = null;
      for (let k = 0; k <= n; k++) {
        const mid = { x: a.x + dx * (len * (k + 0.5)) / n, z: a.z + dz * (len * (k + 0.5)) / n };
        const rail = k < n ? rails.some((s) => distanceToSegment(mid, s.a, s.b) < 0.7 && Math.abs((s.b.x - s.a.x) * dx + (s.b.z - s.a.z) * dz) > 0.9 * Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z)) : null;
        if (rail !== kind) {
          if (kind !== null && k > from) runs.push({ a: { x: a.x + dx * (len * from) / n, z: a.z + dz * (len * from) / n }, b: { x: a.x + dx * (len * k) / n, z: a.z + dz * (len * k) / n }, nx, nz, rail: kind });
          from = k; kind = rail;
        }
      }
    }
  }
  return runs;
}

/** A window (or a street door) of a room, put on the run of the outer wall it looks out of. Null when it looks into the building. */
function onWall(runs: Run[], c: Vec2, out: Vec2, widthM: number): { a: Vec2; b: Vec2; run: Run } | null {
  let best: { a: Vec2; b: Vec2; run: Run } | null = null, bestD = 1.1;
  for (const r of runs) {
    if (r.rail || r.nx * out.x + r.nz * out.z < 0.9) continue;
    const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z), dx = (r.b.x - r.a.x) / len, dz = (r.b.z - r.a.z) / len;
    const along = (c.x - r.a.x) * dx + (c.z - r.a.z) * dz, off = Math.abs((c.x - r.a.x) * r.nx + (c.z - r.a.z) * r.nz);
    if (off >= bestD || along < 0.2 || along > len - 0.2) continue;
    const u0 = Math.max(0.1, along - widthM / 2), u1 = Math.min(len - 0.1, along + widthM / 2);
    if (u1 - u0 < 0.3) continue;
    best = { a: { x: r.a.x + dx * u0, z: r.a.z + dz * u0 }, b: { x: r.a.x + dx * u1, z: r.a.z + dz * u1 }, run: r }; bestD = off;
  }
  return best;
}

// ---------------------------------------------------------------- the building

const overlap = (a: Bounds, b: Bounds): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
const ROOF_M = 0.9, OVERRUN_M = 2.4, MAX_BLOCKS = 9;

export function buildHeroBuilding(b: BuildingFile, scenes: ReadonlyMap<string, SceneInfo>, m: HeroModel): HeroBuilding {
  const storeys: Storey[] = [];
  const blank = (s: Pick<Storey, 'id' | 'levelId' | 'group' | 'kind' | 'y0' | 'y1' | 'loops'> & Partial<Storey>): Storey => ({ runs: wallRuns(s.loops, []), windows: [], cap: false, water: [], plan: [], blocks: [], walk: null, build: -1, ...s });
  const homes = m.levels.map((l, i) => ({ l, i })).filter((q) => q.l.homes);
  const topHome = homes[homes.length - 1] ?? null;
  // the floors the animation builds: the top two with flats (the only one, when there is one)
  const built = homes.slice(-2).map((q) => q.i);
  const walkScene = m.walk ? m.levels.flatMap((l) => l.spaces).find((s) => s.id === m.walk!.spaceId)?.sceneId ?? null : null;

  /** the windows (and a street door) the drawings give a level's spaces, on the runs of `runs` */
  const windowsOf = (levelIndex: number, spaceIds: Set<string>, runs: Run[], doors: boolean): Win[] => {
    const level = b.levels[levelIndex], xf = levelFrame(level, scenes), out: Win[] = [];
    for (const sp of level.spaces) {
      if (!spaceIds.has(sp.id)) continue;
      const layout = scenes.get(sp.sceneId)?.property.layout;
      if (!layout) continue;
      const map = (p: Vec2): Vec2 => xf(toLevel(p, sp.placement));
      const street = new Set(sp.portals.filter((p) => p.kind === 'outside').map((p) => p.opening));
      const frames = computeEdgeFrames(layout);
      for (const o of layout.openings) {
        const door = street.has(o.id);
        if (o.type !== 'window' && !(doors && door)) continue;
        const f = frames.find((q) => q.roomId === o.roomId && q.edge === o.edge);
        if (!f) continue;
        const c0 = { x: f.a.x + f.dir.x * o.centreM, z: f.a.z + f.dir.z * o.centreM };
        const c = map(c0), c1 = map({ x: c0.x + f.out.x, z: c0.z + f.out.z });
        const hit = onWall(runs, c, { x: c1.x - c.x, z: c1.z - c.z }, o.widthM);
        if (hit) out.push({ a: hit.a, b: hit.b, nx: hit.run.nx, nz: hit.run.nz, sill: door ? 0 : o.sillM, head: o.headM, door, spaceId: sp.id });
      }
    }
    return out;
  };
  const furnitureOf = (levelIndex: number): Block[] => {
    const level = b.levels[levelIndex], xf = levelFrame(level, scenes), out: Block[] = [];
    for (const sp of level.spaces) {
      if (sp.kind !== 'home') continue;
      const items = [...(scenes.get(sp.sceneId)?.property.furniture ?? [])].filter((it) => it.box.w * it.box.d >= 0.7).sort((p, q) => q.box.w * q.box.d - p.box.w * p.box.d).slice(0, MAX_BLOCKS);
      for (const it of items) out.push({ poly: boxCorners(it.box).map((p) => xf(toLevel(p, sp.placement))), h: Math.min(it.heightM, 2.1) });
    }
    return out;
  };

  let towerLoops: Vec2[][] = [];
  let towerBounds: Bounds | null = null;
  if (topHome) {
    towerLoops = outline(homes[0].l.spaces.flatMap((s) => s.floors));
    towerBounds = boundsOf(towerLoops.flat());
  }
  const base = m.levels[0]?.y ?? 0;

  m.levels.forEach((level, i) => {
    if (level.homes) {
      const loops = outline(level.spaces.flatMap((s) => s.floors));
      const runs = wallRuns(loops, level.spaces.flatMap((s) => s.segs.filter((g) => g.rail)));
      const hasWalk = !!m.walk && !!walkScene && level.spaces.some((s) => s.sceneId === walkScene && Math.abs(s.bounds.x0 - m.levels.find((q) => q.id === m.walk!.levelId)!.spaces.find((q) => q.id === m.walk!.spaceId)!.bounds.x0) < 0.01);
      storeys.push(blank({
        id: `flats-${level.id}`, levelId: level.id, group: 'tower', kind: 'flats', y0: level.y, y1: level.top, loops, runs,
        windows: windowsOf(i, new Set(level.spaces.map((s) => s.id)), runs, false),
        plan: level.spaces.flatMap((s) => s.segs), blocks: furnitureOf(i), walk: hasWalk ? m.walk!.path : null, build: built.indexOf(i),
      }));
      return;
    }
    if (!topHome || !towerBounds) {
      // a building with no flats: every level is a plain storey of its own outline
      const loops = outline(level.spaces.flatMap((s) => s.floors));
      storeys.push(blank({ id: `level-${level.id}`, levelId: level.id, group: 'tower', kind: 'club', y0: level.y, y1: level.top, loops, cap: i === m.levels.length - 1, water: level.spaces.flatMap((s) => s.water) }));
      return;
    }
    if (i > topHome.i) return;
    // under the flats the tower stands on open storeys
    storeys.push(blank({ id: `stilts-${level.id}`, levelId: level.id, group: 'tower', kind: 'stilts', y0: level.y, y1: level.top, loops: towerLoops }));
    const under = level.spaces.filter((s) => !s.openAir && outsideByCentre(s.bounds, towerBounds!) === 0);
    if (under.length) {
      const loops = outline(under.flatMap((s) => s.floors), 0.25, 1);
      const runs = wallRuns(loops, []);
      storeys.push(blank({ id: `room-${level.id}`, levelId: level.id, group: 'lobby', kind: 'room', y0: level.y, y1: level.top, loops, runs, windows: windowsOf(i, new Set(under.map((s) => s.id)), runs, true), cap: true }));
    }
    // beside the tower: the open-air spaces the picture is about (the pool), and the rooms of this level that touch the frame
    const decks = level.spaces.filter((s) => s.openAir && overlap(s.bounds, m.keep) && s.water.some((w) => { const c = boundsOf(w); const x = (c.x0 + c.x1) / 2, z = (c.z0 + c.z1) / 2; return x > m.keep.x0 && x < m.keep.x1 && z > m.keep.z0 && z < m.keep.z1; }));
    const rooms = level.spaces.filter((s) => !s.openAir && !under.includes(s) && outsideByCentre(s.bounds, m.keep) === 0);
    if (decks.length) {
      // the deck is one slab: its paving, lawns and the basins set into it
      const loops = outline(decks.flatMap((s) => [...s.floors, ...s.water]), 0.25, 5);
      storeys.push(blank({ id: `deck-${level.id}`, levelId: level.id, group: 'podium', kind: 'base', y0: base, y1: level.y, loops, cap: true, water: decks.flatMap((s) => s.water) }));
    }
    if (rooms.length) {
      const loops = outline(rooms.flatMap((s) => s.floors));
      if (level.y > base) storeys.push(blank({ id: `plinth-${level.id}`, levelId: level.id, group: 'pavilion', kind: 'base', y0: base, y1: level.y, loops }));
      storeys.push(blank({ id: `club-${level.id}`, levelId: level.id, group: 'pavilion', kind: 'club', y0: level.y, y1: level.top, loops, cap: true }));
    }
  });

  const roofY = topHome ? topHome.l.top : (m.levels[m.levels.length - 1]?.top ?? 0);
  let builds = built.length;
  if (topHome) {
    const top = storeys.find((s) => s.id === `flats-${topHome.l.id}`)!;
    storeys.push(blank({ id: 'roof', levelId: null, group: 'tower', kind: 'roof', y0: roofY, y1: roofY + ROOF_M, loops: top.loops, runs: wallRuns(top.loops, []), build: builds }));
    builds += 1;
  }
  // the lift core: one shaft block from the ground to above the roof, a storey at a time
  if (m.shafts.length && topHome) {
    const cb = boundsOf(m.shafts.flat());
    const loop = [{ x: cb.x0 - 0.25, z: cb.z0 - 0.2 }, { x: cb.x1 + 0.25, z: cb.z0 - 0.2 }, { x: cb.x1 + 0.25, z: cb.z1 + 0.25 }, { x: cb.x0 - 0.25, z: cb.z1 + 0.25 }];
    m.levels.forEach((level, i) => { if (i <= topHome.i) storeys.push(blank({ id: `core-${level.id}`, levelId: level.id, group: 'core', kind: 'core', y0: level.y, y1: level.top, loops: [loop] })); });
    storeys.push(blank({ id: 'core-top', levelId: null, group: 'core', kind: 'core', y0: roofY, y1: roofY + OVERRUN_M, loops: [loop], cap: true }));
  }

  const solid = storeys.filter((s) => s.loops.length > 0);
  const all = solid.flatMap((s) => s.loops.flat());
  const bb = all.length ? boundsOf(all) : { x0: -1, z0: -1, x1: 1, z1: 1 };
  const pivot = { x: (bb.x0 + bb.x1) / 2, z: (bb.z0 + bb.z1) / 2 };
  const subject: Subject = { pivot, radius: all.reduce((r, p) => Math.max(r, Math.hypot(p.x - pivot.x, p.z - pivot.z)), 1), height: solid.reduce((h, s) => Math.max(h, s.y1), 1) };

  // where each label's leader line starts
  const anchors: Anchor[] = [];
  const nearestOn = (runs: Run[], p: Vec2): { p: Vec2; run: Run } | null => {
    let best: { p: Vec2; run: Run } | null = null, bd = Infinity;
    for (const r of runs) {
      const len2 = (r.b.x - r.a.x) ** 2 + (r.b.z - r.a.z) ** 2;
      const t = Math.max(0.15, Math.min(0.85, ((p.x - r.a.x) * (r.b.x - r.a.x) + (p.z - r.a.z) * (r.b.z - r.a.z)) / Math.max(len2, 1e-9)));
      const q = { x: r.a.x + (r.b.x - r.a.x) * t, z: r.a.z + (r.b.z - r.a.z) * t };
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) { bd = d; best = { p: q, run: r }; }
    }
    return best;
  };
  for (const f of m.facts) {
    const level = m.levels.find((l) => l.id === f.levelId);
    if (!level) continue;
    if (f.id === 'flat') {
      const st = storeys.find((s) => s.id === `flats-${level.id}`);
      const space = level.spaces.find((s) => s.kind === 'home' && f.at.x >= s.bounds.x0 && f.at.x <= s.bounds.x1 && f.at.z >= s.bounds.z0 && f.at.z <= s.bounds.z1);
      const wins = (st?.windows ?? []).filter((w) => w.spaceId === space?.id).sort((p, q) => Math.hypot(q.b.x - q.a.x, q.b.z - q.a.z) - Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z));
      const hit = st ? nearestOn(st.runs.filter((r) => !r.rail), f.at) : null;
      if (wins[0]) anchors.push({ id: f.id, x: (wins[0].a.x + wins[0].b.x) / 2, y: level.y + wins[0].head + 0.25, z: (wins[0].a.z + wins[0].b.z) / 2, nx: wins[0].nx, nz: wins[0].nz });
      else if (hit) anchors.push({ id: f.id, x: hit.p.x, y: (level.y + level.top) / 2, z: hit.p.z, nx: hit.run.nx, nz: hit.run.nz });
    } else if (f.id === 'flats') {
      const c = towerBounds ? { x: (towerBounds.x0 + towerBounds.x1) / 2, z: (towerBounds.z0 + towerBounds.z1) / 2 } : f.at;
      anchors.push({ id: f.id, x: c.x, y: roofY, z: c.z, nx: 0, nz: 0 });
    } else if (f.id === 'pool') {
      anchors.push({ id: f.id, x: f.at.x, y: level.y, z: f.at.z, nx: 0, nz: 0 });
    } else {
      const st = storeys.find((s) => s.id === `room-${level.id}`);
      const door = st?.windows.find((w) => w.door);
      if (door) anchors.push({ id: f.id, x: (door.a.x + door.b.x) / 2, y: level.y + door.head / 2, z: (door.a.z + door.b.z) / 2, nx: door.nx, nz: door.nz });
      else anchors.push({ id: f.id, x: f.at.x, y: st ? st.y1 : level.y, z: f.at.z, nx: 0, nz: 0 });
    }
  }
  return { storeys, bands: [...new Set(storeys.map((s) => s.y0))].sort((p, q) => p - q), subject, anchors, builds, roofY };
}

function outsideByCentre(a: Bounds, b: Bounds): number {
  const c = { x: (a.x0 + a.x1) / 2, z: (a.z0 + a.z1) / 2 };
  return Math.hypot(Math.max(b.x0 - c.x, 0, c.x - b.x1), Math.max(b.z0 - c.z, 0, c.z - b.z1));
}

/**
 * Whether a point is hidden from the camera by the building: a ray from the point towards the camera (`toward`, a unit vector)
 * is walked, and the point is hidden if the ray passes inside a storey that `solid` says is standing.
 */
export function occluded(hb: HeroBuilding, p: { x: number; y: number; z: number }, toward: { x: number; y: number; z: number }, solid: (s: Storey) => boolean): boolean {
  const reach = 2 * hb.subject.radius + hb.subject.height;
  for (let t = 0.8; t < reach; t += 0.6) {
    const q = { x: p.x + toward.x * t, z: p.z + toward.z * t }, y = p.y + toward.y * t;
    if (y > hb.subject.height + 3) return false;
    for (const s of hb.storeys) {
      if (s.kind === 'stilts' || s.kind === 'roof' || y < s.y0 + 0.05 || y > s.y1 - 0.05 || !solid(s)) continue;
      if (inLoops(s.loops, q)) return true;
    }
  }
  return false;
}
