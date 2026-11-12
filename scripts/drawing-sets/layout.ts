// C12a: flat layouts for the synthetic sets. Rooms are interior rectangles on a row grid, separated by partition walls;
// exterior walls sit outside the rooms. Everything in metres in the truth frame (x right, z down).
import type { RoomType } from '../../src/types';
import type { SetOptions, Template } from './types';

export interface Rect { x0: number; z0: number; x1: number; z1: number }
export type RoomKind = 'living' | 'bedroom' | 'master' | 'kids' | 'kitchen' | 'toilet' | 'passage' | 'balcony' | 'pooja' | 'utility' | 'store' | 'study' | 'foyer' | 'dining';
export interface LRoom { id: string; kind: RoomKind; rect: Rect; roomType: RoomType; row: number }
export interface WallRun { id: string; axis: 'h' | 'v'; rect: Rect; exterior: boolean }
export interface LOpening {
  id: string; type: 'door' | 'window' | 'opening'; style: 'swing' | 'sliding' | 'entrance' | 'window' | 'ventilator';
  run: string; axis: 'x' | 'z'; /** along-the-wall centre, metres on that axis */ centre: number; width: number;
  rooms: string[]; hingeEnd: 0 | 1; swingSide: 1 | -1;
  sill: number; head: number;
}
export interface Layout {
  rooms: LRoom[]; runs: WallRun[]; openings: LOpening[];
  W: number; D: number; o: number; p: number; balconies: LRoom[];
  rows: { z0: number; z1: number; passage: boolean; cells: { x0: number; x1: number; rooms: LRoom[] }[] }[];
}
export const ROOM_TYPE: Record<RoomKind, RoomType> = {
  living: 'living', dining: 'living', bedroom: 'bedroom', master: 'bedroom', kids: 'bedroom', kitchen: 'kitchen', toilet: 'bathroom',
  passage: 'other', foyer: 'other', pooja: 'other', store: 'other', study: 'other', balcony: 'balcony', utility: 'balcony',
};

const FT = 0.3048;
export interface Rng { (): number; int(a: number, b: number): number; pick<T>(xs: readonly T[]): T; chance(p: number): boolean; range(a: number, b: number): number }
export function makeRng(seed: number, base: () => number): Rng {
  void seed;
  const r = (() => base()) as Rng;
  r.int = (a, b) => a + Math.floor(base() * (b - a + 1));
  r.pick = <T,>(xs: readonly T[]): T => xs[Math.floor(base() * xs.length)];
  r.chance = (p) => base() < p;
  r.range = (a, b) => a + base() * (b - a);
  return r;
}

export function wallThickness(o: SetOptions): { o: number; p: number } {
  return o.units === 'ftin' ? { o: 9 * 0.0254, p: (o.ftinFormat === 'fraction' ? 4.5 : 5) * 0.0254 } : { o: 0.23, p: 0.115 };
}
/** Snap a room dimension to the set's grid: 6 inches, 50 mm or 5 cm. */
export function snapDim(m: number, o: SetOptions): number {
  const g = o.units === 'ftin' ? 0.5 * FT : 0.05;
  return Math.max(g, Math.round(m / g) * g);
}

interface CellSpec { w: number; rooms: { kind: RoomKind; h?: number }[] }
interface RowSpec { depth: number; passage?: boolean; cells: CellSpec[] }

function rowsFor(t: Template, rng: Rng, o: SetOptions): RowSpec[] {
  const f = (a: number, b: number): number => snapDim(rng.range(a, b) * FT, o);
  switch (t) {
    case 'studio':
      return [{ depth: f(12, 14), cells: [{ w: f(14, 17), rooms: [{ kind: 'living' }] }, { w: f(7, 8.5), rooms: [{ kind: 'kitchen', h: f(6, 7.5) }, { kind: 'toilet' }] }] }];
    case '1bhk':
      return [
        { depth: f(11, 12.5), cells: [{ w: f(12, 15), rooms: [{ kind: 'living' }] }, { w: f(11, 13), rooms: [{ kind: 'master' }] }] },
        { depth: f(8, 9.5), cells: [{ w: f(8, 10), rooms: [{ kind: 'kitchen' }] }, { w: f(5, 6), rooms: [{ kind: 'toilet' }] }, { w: f(3, 4), rooms: [{ kind: 'foyer' }] }] },
      ];
    case '2bhk': {
      const rows: RowSpec[] = [
        { depth: f(11, 13), cells: [{ w: f(11, 13), rooms: [{ kind: 'master' }] }, { w: f(13, 16), rooms: [{ kind: 'living' }] }, { w: f(10, 12), rooms: [{ kind: 'bedroom' }] }] },
        { depth: f(3.5, 4), passage: true, cells: [{ w: f(10, 10.5), rooms: [{ kind: 'passage' }] }] },
        { depth: f(8, 10), cells: [{ w: f(5, 6), rooms: [{ kind: 'toilet' }] }, { w: f(5, 6), rooms: [{ kind: 'toilet' }] }, { w: f(9, 11), rooms: [{ kind: 'kitchen' }] }, { w: f(4, 6), rooms: [{ kind: 'utility' }] }] },
      ];
      return rows;
    }
    case '3bhk':
      return [
        { depth: f(12, 13.5), cells: [{ w: f(12, 14), rooms: [{ kind: 'master' }] }, { w: f(12, 14), rooms: [{ kind: 'kids' }] }, { w: f(11, 13), rooms: [{ kind: 'bedroom' }] }, { w: f(14, 17), rooms: [{ kind: 'living' }] }] },
        { depth: f(3.5, 4.5), passage: true, cells: [{ w: f(10, 11), rooms: [{ kind: 'passage' }] }] },
        { depth: f(8.5, 10), cells: [{ w: f(5, 6), rooms: [{ kind: 'toilet' }] }, { w: f(5, 6), rooms: [{ kind: 'toilet' }] }, { w: f(4, 5), rooms: [{ kind: 'pooja' }] }, { w: f(9, 11), rooms: [{ kind: 'kitchen' }] }, { w: f(5, 7), rooms: [{ kind: 'store' }] }] },
      ];
    case 'single-bedroom':
    default:
      return [{ depth: f(11, 13), cells: [{ w: f(11, 14), rooms: [{ kind: 'master' }] }] }];
  }
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export function buildLayout(o: SetOptions, rng: Rng): Layout {
  const { o: wo, p } = wallThickness(o);
  const specs = rowsFor(o.template, rng, o);
  const rowW = specs.map((r) => sum(r.cells.map((c) => c.w)) + (r.cells.length - 1) * p);
  const W = Math.max(...rowW);
  const rooms: LRoom[] = []; const runs: WallRun[] = [];
  const rows: Layout['rows'] = [];
  let z = 0; let nRun = 0;
  const addRun = (axis: 'h' | 'v', rect: Rect, exterior: boolean): WallRun => { const r = { id: `w${++nRun}`, axis, rect, exterior }; runs.push(r); return r; };
  const counts: Record<string, number> = {};
  specs.forEach((rs, ri) => {
    const z0 = z, z1 = z + rs.depth;
    const widths = rs.cells.map((c) => c.w);
    const used = sum(widths) + (widths.length - 1) * p;
    widths[widths.length - 1] += W - used; // the last cell absorbs the remainder
    let x = 0;
    const cells: Layout['rows'][number]['cells'] = [];
    rs.cells.forEach((c, ci) => {
      const x0 = x, x1 = x + widths[ci];
      const cellRooms: LRoom[] = [];
      let zz = z0;
      c.rooms.forEach((r, k) => {
        const last = k === c.rooms.length - 1;
        const h = last ? z1 - zz : (r.h ?? (z1 - z0 - p) / 2);
        counts[r.kind] = (counts[r.kind] ?? 0) + 1;
        const room: LRoom = { id: `${r.kind}-${counts[r.kind]}`, kind: r.kind, rect: { x0, z0: zz, x1, z1: zz + h }, roomType: ROOM_TYPE[r.kind], row: ri };
        rooms.push(room); cellRooms.push(room);
        if (!last) addRun('h', { x0, z0: zz + h, x1, z1: zz + h + p }, false);
        zz += h + p;
      });
      cells.push({ x0, x1, rooms: cellRooms });
      if (ci < rs.cells.length - 1) addRun('v', { x0: x1, z0, x1: x1 + p, z1 }, false);
      x = x1 + p;
    });
    rows.push({ z0, z1, passage: !!rs.passage, cells });
    if (ri < specs.length - 1) addRun('h', { x0: 0, z0: z1, x1: W, z1: z1 + p }, false);
    z = z1 + p;
  });
  const D = z - p;
  addRun('h', { x0: -wo, z0: -wo, x1: W + wo, z1: 0 }, true);
  addRun('h', { x0: -wo, z0: D, x1: W + wo, z1: D + wo }, true);
  addRun('v', { x0: -wo, z0: 0, x1: 0, z1: D }, true);
  addRun('v', { x0: W, z0: 0, x1: W + wo, z1: D }, true);
  const layout: Layout = { rooms, runs, openings: [], W, D, o: wo, p, balconies: [], rows };
  addOpenings(layout, o, rng);
  return layout;
}

const overlapLen = (a0: number, a1: number, b0: number, b1: number): number => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
interface Adj { a: LRoom; b: LRoom; axis: 'x' | 'z'; /** wall middle-line coordinate on the other axis */ line: number; lo: number; hi: number; run: WallRun | undefined }
function adjacencies(L: Layout): Adj[] {
  const out: Adj[] = [];
  const near = (u: number, v: number): boolean => Math.abs(u - v) < 1e-6;
  for (let i = 0; i < L.rooms.length; i++) for (let j = 0; j < L.rooms.length; j++) {
    if (i === j) continue;
    const A = L.rooms[i], B = L.rooms[j];
    if (near(A.rect.x1 + L.p, B.rect.x0)) {
      const lo = Math.max(A.rect.z0, B.rect.z0), hi = Math.min(A.rect.z1, B.rect.z1);
      if (hi - lo > 0.5) out.push({ a: A, b: B, axis: 'z', line: A.rect.x1 + L.p / 2, lo, hi, run: L.runs.find((r) => r.axis === 'v' && near(r.rect.x0, A.rect.x1) && r.rect.z0 <= lo + 1e-6 && r.rect.z1 >= hi - 1e-6) });
    }
    if (near(A.rect.z1 + L.p, B.rect.z0)) {
      const lo = Math.max(A.rect.x0, B.rect.x0), hi = Math.min(A.rect.x1, B.rect.x1);
      if (hi - lo > 0.5) out.push({ a: A, b: B, axis: 'x', line: A.rect.z1 + L.p / 2, lo, hi, run: L.runs.find((r) => r.axis === 'h' && near(r.rect.z0, A.rect.z1) && r.rect.x0 <= lo + 1e-6 && r.rect.x1 >= hi - 1e-6) });
    }
  }
  return out;
}

const PRIVATE: RoomKind[] = ['bedroom', 'master', 'kids', 'toilet', 'pooja', 'store', 'study', 'utility', 'kitchen'];
const PUBLIC: RoomKind[] = ['passage', 'foyer', 'living', 'dining'];

function addOpenings(L: Layout, o: SetOptions, rng: Rng): void {
  const adj = adjacencies(L);
  const busy: { run: string; lo: number; hi: number }[] = [];
  const free = (run: string, lo: number, hi: number): boolean => !busy.some((b) => b.run === run && Math.min(hi, b.hi) - Math.max(lo, b.lo) > -0.15);
  let n = 0;
  const grid = (m: number): number => snapDim(m, o);
  const place = (run: WallRun, lo: number, hi: number, width: number, margin: number): number | null => {
    const span = hi - lo - 2 * margin - width;
    if (span < -1e-6) return null;
    for (let tries = 0; tries < 14; tries++) {
      const c0 = lo + margin + width / 2 + (tries === 0 ? span / 2 : rng() * Math.max(span, 0));
      const c = Math.round(c0 / 0.05) * 0.05;
      if (c - width / 2 < lo + margin - 1e-6 || c + width / 2 > hi - margin + 1e-6) continue;
      if (free(run.id, c - width / 2, c + width / 2)) { busy.push({ run: run.id, lo: c - width / 2, hi: c + width / 2 }); return c; }
    }
    return null;
  };
  const addDoor = (a: Adj, intoRoom: LRoom, other: LRoom, width: number): boolean => {
    if (!a.run) return false;
    const c = place(a.run, a.lo, a.hi, width, 0.25 + 0.05);
    if (c === null) return false;
    // swing side: +1 = the swing opens toward +x / +z of the wall
    const intoIsA = intoRoom.id === a.a.id;
    L.openings.push({ id: `door-${++n}`, type: 'door', style: 'swing', run: a.run.id, axis: a.axis, centre: c, width, rooms: [intoRoom.id, other.id], hingeEnd: rng.chance(0.5) ? 0 : 1, swingSide: intoIsA ? -1 : 1, sill: 0, head: 2.1 });
    return true;
  };
  // one door per room, to the best neighbour
  for (const r of L.rooms) {
    const mine = adj.filter((a) => (a.a.id === r.id || a.b.id === r.id));
    if (!mine.length) continue;
    const nb = (a: Adj): LRoom => (a.a.id === r.id ? a.b : a.a);
    const already = L.openings.some((d) => d.type === 'door' && d.rooms.includes(r.id));
    if (already) continue;
    const prefer = mine.filter((a) => PUBLIC.includes(nb(a).kind)).sort((x, y) => Number(nb(y).kind === 'passage') - Number(nb(x).kind === 'passage'));
    const cands = [...prefer, ...mine.filter((a) => !prefer.includes(a))];
    const width = r.kind === 'toilet' || r.kind === 'store' || r.kind === 'pooja' ? grid(0.75) : grid(0.9);
    for (const a of cands) {
      const other = nb(a);
      // a private room's door swings into it; between two public rooms into the smaller
      const into = PRIVATE.includes(r.kind) || !PRIVATE.includes(other.kind) && areaOf(r) <= areaOf(other) ? r : other;
      if (PRIVATE.includes(r.kind) && PRIVATE.includes(other.kind) && r.kind !== 'toilet') continue;
      if (addDoor(a, into, into.id === r.id ? other : r, width)) break;
    }
  }
  // rooms still without a door (private-private only): open to the nearest neighbour
  for (const r of L.rooms) {
    if (L.openings.some((d) => d.type === 'door' && d.rooms.includes(r.id))) continue;
    for (const a of adj.filter((x) => x.a.id === r.id || x.b.id === r.id)) { if (addDoor(a, r, a.a.id === r.id ? a.b : a.a, grid(0.9))) break; }
  }
  // exterior: entrance, windows, sliding doors
  const ext = (room: LRoom): { side: 'N' | 'S' | 'W' | 'E'; run: WallRun; lo: number; hi: number }[] => {
    const out: { side: 'N' | 'S' | 'W' | 'E'; run: WallRun; lo: number; hi: number }[] = [];
    const find = (pred: (r: WallRun) => boolean): WallRun => L.runs.find((r) => r.exterior && pred(r))!;
    if (room.rect.z0 < 1e-6) out.push({ side: 'N', run: find((r) => r.axis === 'h' && r.rect.z1 <= 1e-6), lo: room.rect.x0, hi: room.rect.x1 });
    if (Math.abs(room.rect.z1 - L.D) < 1e-6) out.push({ side: 'S', run: find((r) => r.axis === 'h' && r.rect.z0 >= L.D - 1e-6), lo: room.rect.x0, hi: room.rect.x1 });
    if (room.rect.x0 < 1e-6) out.push({ side: 'W', run: find((r) => r.axis === 'v' && r.rect.x1 <= 1e-6), lo: room.rect.z0, hi: room.rect.z1 });
    if (Math.abs(room.rect.x1 - L.W) < 1e-6) out.push({ side: 'E', run: find((r) => r.axis === 'v' && r.rect.x0 >= L.W - 1e-6), lo: room.rect.z0, hi: room.rect.z1 });
    return out;
  };
  const entryRoom = L.rooms.find((r) => r.kind === 'foyer') ?? L.rooms.find((r) => r.kind === 'passage') ?? L.rooms.find((r) => r.kind === 'living') ?? L.rooms[0];
  const entryWalls = ext(entryRoom).filter((e) => e.side !== 'N');
  const ew = entryWalls[0] ?? ext(entryRoom)[0];
  if (ew) {
    const w = grid(1.0);
    const c = place(ew.run, ew.lo, ew.hi, w, 0.3);
    if (c !== null) L.openings.push({ id: `door-${++n}`, type: 'door', style: 'entrance', run: ew.run.id, axis: ew.side === 'N' || ew.side === 'S' ? 'x' : 'z', centre: c, width: w, rooms: [entryRoom.id], hingeEnd: 0, swingSide: ew.side === 'N' || ew.side === 'W' ? 1 : -1, sill: 0, head: 2.1 });
  }
  for (const r of L.rooms) {
    if (r.kind === 'passage' || r.kind === 'foyer') continue;
    const sides = ext(r);
    if (!sides.length) continue;
    const e = rng.pick(sides);
    const small = r.kind === 'toilet' || r.kind === 'store' || r.kind === 'pooja';
    const w = small ? grid(0.5) : grid(rng.range(1.0, 1.8));
    const c = place(e.run, e.lo, e.hi, w, 0.35);
    if (c !== null) L.openings.push({ id: `window-${++n}`, type: 'window', style: small ? 'ventilator' : 'window', run: e.run.id, axis: e.side === 'N' || e.side === 'S' ? 'x' : 'z', centre: c, width: w, rooms: [r.id], hingeEnd: 0, swingSide: 1, sill: small ? 1.5 : 0.9, head: small ? 2.0 : 2.1 });
  }
  // balcony on the north wall of the living room (or master bedroom)
  const host = L.rooms.find((r) => r.kind === 'living' && r.rect.z0 < 1e-6) ?? L.rooms.find((r) => r.kind === 'master' && r.rect.z0 < 1e-6);
  if (host && o.template !== 'single-bedroom' && o.template !== 'studio') {
    const wRoom = host.rect.x1 - host.rect.x0;
    const bw = snapDim(Math.min(wRoom - 0.9, rng.range(8, 12) * FT), o);
    const bd = snapDim(rng.range(4, 5) * FT, o);
    const bx0 = snapDim(host.rect.x0 + (wRoom - bw) / 2, o);
    const room: LRoom = { id: `${rng.chance(0.5) ? 'balcony' : 'balcony'}-1`, kind: 'balcony', rect: { x0: bx0, z0: -L.o - bd, x1: bx0 + bw, z1: -L.o }, roomType: 'balcony', row: -1 };
    L.rooms.push(room); L.balconies.push(room);
    const run = L.runs.find((r) => r.exterior && r.axis === 'h' && r.rect.z1 <= 1e-6)!;
    const sw = snapDim(Math.min(bw - 0.4, rng.range(1.5, 2.4)), o);
    const cx = Math.round((bx0 + bw / 2) / 0.05) * 0.05;
    // drop any window already in that span
    for (let i = L.openings.length - 1; i >= 0; i--) { const q = L.openings[i]; if (q.run === run.id && Math.abs(q.centre - cx) < (q.width + sw) / 2 + 0.1) { L.openings.splice(i, 1); } }
    L.openings.push({ id: `door-${++n}`, type: 'opening', style: 'sliding', run: run.id, axis: 'x', centre: cx, width: sw, rooms: [host.id, room.id], hingeEnd: 0, swingSide: 1, sill: 0, head: 2.1 });
  }
}
export const areaOf = (r: LRoom): number => (r.rect.x1 - r.rect.x0) * (r.rect.z1 - r.rect.z0);

/** Wall pieces after the openings are cut out: rectangles to draw. */
export function wallPieces(L: Layout): { rect: Rect; run: WallRun }[] {
  const out: { rect: Rect; run: WallRun }[] = [];
  for (const run of L.runs) {
    const cuts = L.openings.filter((q) => q.run === run.id).map((q) => [q.centre - q.width / 2, q.centre + q.width / 2] as [number, number]).sort((a, b) => a[0] - b[0]);
    const horizontal = run.axis === 'h';
    const s0 = horizontal ? run.rect.x0 : run.rect.z0, s1 = horizontal ? run.rect.x1 : run.rect.z1;
    let cur = s0;
    const push = (a: number, b: number): void => {
      if (b - a < 1e-6) return;
      out.push({ run, rect: horizontal ? { x0: a, x1: b, z0: run.rect.z0, z1: run.rect.z1 } : { x0: run.rect.x0, x1: run.rect.x1, z0: a, z1: b } });
    };
    for (const [a, b] of cuts) { push(cur, a); cur = b; }
    push(cur, s1);
  }
  return out;
}
export { overlapLen };
