// The honest numbers of a furnished shared space (SPEC 16.17): the walkway rule, the stations by type and the floor used against free. Pure.
// A walkway is a path 1 m wide (centre line 0.5 m clear of every wall and piece) that joins the room's doors and its two ends. The standards are
// "typical guidance, check your consultant": no code is claimed. The area counts a piece's footprint; "with use zones" adds the space each machine asks.
import type { FurnitureItem, Grid, Layout, Vec2 } from '../types';
import { GRID_FREE } from '../types';
import { catalogItem } from './catalog';
import { resolveDoors } from './doors';
import { pointInBox, polygonArea, sideEdge } from './geometry';
import { rasterizeLayout, stampFurniture } from './layout-raster';
import { categoryOf, pieceRule } from './pieces';
import { zoneNeedM } from './clearance';

export const WALKWAY_MIN_M = 1.0;

/** the categories whose pieces count as stations (a machine, a rack, a bench or a studio piece one person uses) */
const STATION_CATEGORIES = new Set(['cardio', 'strength', 'freeweights', 'studio']);
export const isStation = (item: Pick<FurnitureItem, 'catalogId'>): boolean => !!item.catalogId && STATION_CATEGORIES.has(categoryOf(item.catalogId));

/** a piece that lies on the floor or hangs overhead takes no floor a walker needs */
const takesFloor = (it: FurnitureItem): boolean => {
  if (it.heightM < 0.06) return false;
  const rule = pieceRule(it.catalogId);
  return !(rule?.mountY && rule.mountY >= 1.7);
};

export interface WalkwayReport {
  clear: boolean;
  /** the width tested, metres */
  widthM: number;
  /** when blocked: the two things the cut runs between ("Treadmill", "the wall"), and the sentence */
  between: [string, string] | null;
  message: string;
}

// ---------------------------------------------------------------- distance to the nearest obstacle (cells), exact Euclid in two passes

function distanceField(grid: Grid): Float32Array {
  const { nx, nz, cells } = grid;
  const INF = 1e12;
  const f = new Float64Array(nx * nz);
  for (let k = 0; k < f.length; k++) f[k] = cells[k] === GRID_FREE ? INF : 0;
  const edt1 = (get: (i: number) => number, set: (i: number, v: number) => void, n: number, v: Int32Array, z: Float64Array): void => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    const cross = (q: number, p: number): number => ((get(q) + q * q) - (get(p) + p * p)) / (2 * q - 2 * p);
    for (let q = 1; q < n; q++) {
      let s = cross(q, v[k]);
      while (s <= z[k]) { k--; s = cross(q, v[k]); }
      k++;
      v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const p = v[k];
      set(q, (q - p) * (q - p) + get(p));
    }
  };
  const n = Math.max(nx, nz);
  const v = new Int32Array(n), z = new Float64Array(n + 1);
  const col = new Float64Array(nz);
  for (let i = 0; i < nx; i++) {
    edt1((j) => f[j * nx + i], (j, val) => { col[j] = val; }, nz, v, z);
    for (let j = 0; j < nz; j++) f[j * nx + i] = col[j];
  }
  const row = new Float64Array(nx);
  for (let j = 0; j < nz; j++) {
    edt1((i) => f[j * nx + i], (i, val) => { row[i] = val; }, nx, v, z);
    for (let i = 0; i < nx; i++) f[j * nx + i] = row[i];
  }
  const out = new Float32Array(f.length);
  for (let k = 0; k < f.length; k++) out[k] = Math.sqrt(Math.min(f[k], INF));
  return out;
}

const nameOf = (it: FurnitureItem): string => (it.label && it.label.trim() ? it.label.trim() : 'a piece');

/** distance from a point to a box footprint, 0 inside */
function boxDistance(p: Vec2, it: FurnitureItem): number {
  const y = (it.box.yawDeg * Math.PI) / 180;
  const dx = p.x - it.box.cx, dz = p.z - it.box.cz;
  const along = Math.abs(dx * Math.sin(y) + dz * Math.cos(y)) - it.box.d / 2;
  const across = Math.abs(dx * Math.cos(y) - dz * Math.sin(y)) - it.box.w / 2;
  return Math.hypot(Math.max(0, along), Math.max(0, across));
}

/**
 * Is a walkway `widthM` wide open through the room? Its nodes are the room's doors (a point 0.8 m inside each) and the two ends of its long axis (the
 * most open spot in the outer fifth). They must all lie in one region of cells that is at least `widthM / 2` from every wall and piece. When they do not,
 * the answer names the two things the nearest cut runs between: "Walkway blocked between Treadmill and Power rack".
 */
export function walkwayReport(layout: Layout, items: FurnitureItem[], widthM: number = WALKWAY_MIN_M, baseGrid?: Grid, ends = true): WalkwayReport {
  const base = baseGrid ?? rasterizeLayout(layout);
  const grid = stampFurniture(base, items.filter(takesFloor));
  const { nx, nz, cellM, originX, originZ, cells } = grid;
  const dist = distanceField(grid);
  const need = widthM / 2 / cellM - 0.55; // cells; a half cell of slack for the raster
  const ok = (k: number): boolean => cells[k] === GRID_FREE && dist[k] >= need;
  const at = (p: Vec2): [number, number] => [Math.floor((p.x - originX) / cellM), Math.floor((p.z - originZ) / cellM)];
  const world = (i: number, j: number): Vec2 => ({ x: originX + (i + 0.5) * cellM, z: originZ + (j + 0.5) * cellM });

  // the room's extent and its long axis
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of layout.rooms) for (const p of r.polygon) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  if (!isFinite(minX)) return { clear: true, widthM, between: null, message: 'No room to walk through.' };
  const alongX = maxX - minX >= maxZ - minZ;
  const endFrac = 0.2;

  // components of the wide-free cells
  const comp = new Int32Array(nx * nz).fill(-1);
  let nComp = 0;
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < comp.length; s++) {
    if (comp[s] !== -1 || !ok(s)) continue;
    let n = 0;
    comp[s] = nComp; stack.push(s);
    while (stack.length) {
      const k = stack.pop()!;
      n++;
      const i = k % nx, j = (k - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const kk = b * nx + a;
        if (comp[kk] === -1 && ok(kk)) { comp[kk] = nComp; stack.push(kk); }
      }
    }
    sizes.push(n); nComp++;
  }

  interface Node { label: string; comp: number; p: Vec2 }
  const nodes: Node[] = [];
  const missing: string[] = [];
  // the two ends: the most open wide-free cell in the outer fifth of the long axis
  for (const end of ends ? ([0, 1] as const) : ([] as const)) {
    let best = -1, bestD = -1;
    for (let k = 0; k < comp.length; k++) {
      if (comp[k] < 0) continue;
      const i = k % nx, j = (k - i) / nx;
      const w = world(i, j);
      const t = alongX ? (w.x - minX) / (maxX - minX) : (w.z - minZ) / (maxZ - minZ);
      if (end === 0 ? t > endFrac : t < 1 - endFrac) continue;
      if (t < 0 || t > 1) continue;
      if (dist[k] > bestD) { bestD = dist[k]; best = k; }
    }
    const label = alongX ? (end === 0 ? 'the west end' : 'the east end') : (end === 0 ? 'the north end' : 'the south end');
    if (best < 0) missing.push(label);
    else { const i = best % nx, j = (best - i) / nx; nodes.push({ label, comp: comp[best], p: world(i, j) }); }
  }
  // the doors
  for (const d of resolveDoors(layout)) {
    const mid = { x: d.edgeA.x + d.dir.x * ((d.u0 + d.u1) / 2), z: d.edgeA.z + d.dir.z * ((d.u0 + d.u1) / 2) };
    let found: Node | null = null;
    for (const out of [-0.8, 0.8]) {
      const p = { x: mid.x + d.out.x * out, z: mid.z + d.out.z * out };
      const room = layout.rooms.find((r) => r.id === d.roomId);
      if (!room) continue;
      const [i, j] = at(p);
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      if (cells[j * nx + i] === GRID_FREE && pointInRoom(layout, p)) { found = { label: 'the door', comp: comp[j * nx + i], p }; break; }
    }
    if (found) nodes.push(found);
  }
  // a space with no ends to test (a hall) tests its doors against the open floor: the most open spot of the largest wide-free region
  if (!ends && sizes.length > 0) {
    const big = sizes.indexOf(Math.max(...sizes));
    let best = -1, bestD = -1;
    for (let k = 0; k < comp.length; k++) if (comp[k] === big && dist[k] > bestD) { bestD = dist[k]; best = k; }
    if (best >= 0) { const i = best % nx, j = (best - i) / nx; nodes.push({ label: 'the open floor', comp: big, p: world(i, j) }); }
  } else if (!ends && sizes.length === 0) {
    return { clear: false, widthM, between: null, message: `No ${Math.round(widthM * 100)} cm wide walkway is left anywhere in the room.` };
  }
  if (missing.length > 0) {
    return { clear: false, widthM, between: null, message: `Walkway blocked at ${missing[0]}: no ${Math.round(widthM * 100)} cm wide path reaches it.` };
  }
  // nodes in a region too narrow for the walkway are in no component: the door is boxed in
  const boxed = nodes.find((n) => n.comp < 0);
  const main = nodes.length ? nodes[0].comp : -1;
  const apart = nodes.find((n) => n.comp !== main);
  if (!boxed && !apart) return { clear: true, widthM, between: null, message: `A ${Math.round(widthM * 100)} cm wide walkway is open through the room, door to door and end to end.` };

  // blocked: name what the nearest cut runs between. Take the other node, find the closest pair of cells of the two regions.
  const target = boxed ?? apart!;
  const source = nodes.find((n) => n.comp >= 0 && n !== target) ?? nodes[0];
  const regionA: number[] = [], regionB: number[] = [];
  const stride = 3;
  for (let k = 0; k < comp.length; k += 1) {
    if (comp[k] < 0) continue;
    const i = k % nx, j = (k - i) / nx;
    if ((i + j) % stride !== 0) continue;
    if (comp[k] === source.comp) regionA.push(k);
    else if (target.comp >= 0 && comp[k] === target.comp) regionB.push(k);
  }
  let pa: Vec2 = source.p, pb: Vec2 = target.p, best = Infinity;
  if (target.comp >= 0) {
    for (const a of regionA) {
      const ai = a % nx, aj = (a - ai) / nx;
      for (const b of regionB) {
        const bi = b % nx, bj = (b - bi) / nx;
        const dd = (ai - bi) * (ai - bi) + (aj - bj) * (aj - bj);
        if (dd < best) { best = dd; pa = world(ai, aj); pb = world(bi, bj); }
      }
    }
  }
  const mid = { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 };
  const ranked = items.filter(takesFloor).map((it) => ({ it, d: boxDistance(mid, it) })).sort((a, b) => a.d - b.d);
  const named: string[] = [];
  for (const r of ranked) { if (r.d > 1.6) break; const nm = nameOf(r.it); if (!named.includes(nm)) named.push(nm); if (named.length === 2) break; }
  const a = named[0] ?? 'the wall';
  const b = named[1] ?? (named[0] ? 'the wall' : 'the far side');
  return { clear: false, widthM, between: [a, b], message: `Walkway blocked between ${a} and ${b}: there is no ${Math.round(widthM * 100)} cm wide path past them.` };
}

function pointInRoom(layout: Layout, p: Vec2): boolean {
  for (const r of layout.rooms) {
    let inside = false;
    const poly = r.polygon;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if ((poly[i].z > p.z) !== (poly[j].z > p.z) && p.x < ((poly[j].x - poly[i].x) * (p.z - poly[i].z)) / (poly[j].z - poly[i].z) + poly[i].x) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

// ---------------------------------------------------------------- the summary

export interface SpaceSummary {
  /** stations: machines, racks, benches and studio pieces */
  /** stacking chairs in the room */
  seats: number;
  stations: { total: number; byCategory: Array<{ category: string; label: string; count: number }>; byPiece: Array<{ id: string; name: string; count: number }> };
  /** square metres: the room, the footprints of its pieces, the footprints plus the space the pieces ask (the use zones), and what is left */
  area: { roomM2: number; piecesM2: number; withZonesM2: number; freeM2: number; freePct: number };
  walkway: WalkwayReport;
  /** the card lines, in words */
  lines: string[];
  tone: 'good' | 'warn' | 'bad';
  /** the one-line standards note */
  footer: string;
}

const CAT_LABEL: Record<string, string> = { cardio: 'Cardio', strength: 'Strength', freeweights: 'Free weights', studio: 'Studio' };
export const SUMMARY_FOOTER = 'Spacing and walkway widths are typical guidance, check your consultant. They are not a code.';

/** the use-zone rectangles of a piece (the swept areas the clearance check draws), as boxes on the floor */
function zoneBoxes(it: FurnitureItem, ceilingM: number): Array<{ cx: number; cz: number; w: number; d: number; yawDeg: number }> {
  const rule = pieceRule(it.catalogId);
  if (!rule?.zones || !it.catalogId) return [];
  const spec = { ...catalogItem(it.catalogId), footprint: { w: it.box.w, d: it.box.d } };
  const out: Array<{ cx: number; cz: number; w: number; d: number; yawDeg: number }> = [];
  for (const z of rule.zones) for (const side of z.sides) {
    const need = zoneNeedM(z, spec, side, ceilingM);
    if (need <= 0) continue;
    const e = sideEdge(it.box, side);
    const width = z.widthM ?? e.half * 2;
    out.push({ cx: e.mid.x + e.normal.x * (need / 2), cz: e.mid.z + e.normal.z * (need / 2), w: width, d: need, yawDeg: ((Math.atan2(e.normal.x, e.normal.z) * 180) / Math.PI + 360) % 360 });
  }
  return out;
}

export function spaceSummary(layout: Layout, items: FurnitureItem[], baseGrid?: Grid, kind?: string): SpaceSummary {
  const base = baseGrid ?? rasterizeLayout(layout);
  const cell = base.cellM;
  const stations = items.filter((i) => isStation(i));
  const byCat = new Map<string, number>();
  const byPiece = new Map<string, { name: string; count: number }>();
  for (const s of stations) {
    const c = categoryOf(s.catalogId!);
    byCat.set(c, (byCat.get(c) ?? 0) + 1);
    const e = byPiece.get(s.catalogId!) ?? { name: s.label, count: 0 };
    e.count++; byPiece.set(s.catalogId!, e);
  }
  // areas by cells: the room's free cells, then the cells a piece covers, then those a piece or a zone covers
  let roomCells = 0;
  for (let k = 0; k < base.cells.length; k++) if (base.cells[k] === GRID_FREE) roomCells++;
  const roomM2 = layout.rooms.reduce((a, r) => a + Math.abs(polygonArea(r.polygon)), 0);
  const covered = new Uint8Array(base.cells.length);
  const mark = (b: { cx: number; cz: number; w: number; d: number; yawDeg: number }, v: number): void => {
    const r = Math.hypot(b.w, b.d) / 2;
    const i0 = Math.max(0, Math.floor((b.cx - r - base.originX) / cell)), i1 = Math.min(base.nx - 1, Math.floor((b.cx + r - base.originX) / cell));
    const j0 = Math.max(0, Math.floor((b.cz - r - base.originZ) / cell)), j1 = Math.min(base.nz - 1, Math.floor((b.cz + r - base.originZ) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * base.nx + i;
      if (base.cells[k] !== GRID_FREE) continue;
      if (pointInBox({ x: base.originX + (i + 0.5) * cell, z: base.originZ + (j + 0.5) * cell }, b)) covered[k] = Math.max(covered[k], v);
    }
  };
  const floorItems = items.filter(takesFloor);
  for (const it of floorItems) mark(it.box, 2);
  for (const it of floorItems) for (const zb of zoneBoxes(it, layout.wallHeightM)) mark(zb, 1);
  let piece = 0, zone = 0;
  for (let k = 0; k < covered.length; k++) { if (covered[k] === 2) piece++; else if (covered[k] === 1) zone++; }
  const m2 = (cells: number): number => Math.round(cells * cell * cell * 10) / 10;
  const roomUse = roomCells * cell * cell || roomM2;
  const piecesM2 = m2(piece), withZonesM2 = m2(piece + zone);
  const freeM2 = Math.max(0, Math.round((roomUse - piece * cell * cell) * 10) / 10);
  const walkway = walkwayReport(layout, items, WALKWAY_MIN_M, base, kind !== 'hall' && kind !== 'games');
  const seats = items.reduce((n, i) => n + (i.catalogId === 'hall-chair' ? 1 : i.catalogId === 'hall-banquet-set-4' ? 4 : i.catalogId === 'hall-cafe-set-2' ? 2 : 0), 0);
  const byCategory = [...byCat.entries()].map(([category, count]) => ({ category, label: CAT_LABEL[category] ?? category, count })).sort((a, b) => b.count - a.count);
  const freePct = roomUse > 0 ? Math.round((freeM2 / roomUse) * 100) : 0;
  const lines = [
    seats > 0 ? `${seats} seat${seats === 1 ? '' : 's'}${stations.length > 0 ? `, ${stations.length} station${stations.length === 1 ? '' : 's'}` : ''}.` : stations.length === 0 ? 'No stations yet.' : `${stations.length} station${stations.length === 1 ? '' : 's'}: ${byCategory.map((c) => `${c.count} ${c.label.toLowerCase()}`).join(', ')}.`,
    `Floor used by equipment ${piecesM2.toFixed(1)} m², about ${withZonesM2.toFixed(1)} m² with the use zones, of ${roomUse.toFixed(1)} m²: ${freeM2.toFixed(1)} m² (${freePct}%) free.`,
    walkway.message,
  ];
  const tone: SpaceSummary['tone'] = !walkway.clear ? 'bad' : withZonesM2 > roomUse * 0.8 ? 'warn' : 'good';
  return {
    seats, stations: { total: stations.length, byCategory, byPiece: [...byPiece.entries()].map(([id, e]) => ({ id, name: e.name, count: e.count })) },
    area: { roomM2: Math.round(roomM2 * 10) / 10, piecesM2, withZonesM2, freeM2, freePct },
    walkway, lines, tone, footer: SUMMARY_FOOTER,
  };
}
