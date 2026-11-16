// Layout helpers a builder needs (SPEC 16.17): a row of the same machine along a wall at its own spacing, a block of seats in rows with aisles (and the seat
// count), flooring tiles over an area, and snapping a piece to its neighbour. Pure: boxes in, boxes out. The furnish session places them through the
// ordinary overlay, so a builder's arrangement is saved and shared by link like any other.
import type { Box, CatalogItem, Vec2 } from '../types';
import { boxAxes, sideEdge } from './geometry';
import { pieceRule } from './pieces';

const round = (v: number): number => Math.round(v * 1e6) / 1e6;
const cm = (m: number): number => Math.round(m * 100);

/**
 * The gap a row of this piece is laid at: the space its side zones ask (a treadmill 50 cm, a bench 60 cm), else a hand's width for seats and mats, so the
 * zones of two neighbours meet and no more. A row is laid at the need plus 4 cm: the walking grid has 5 cm cells, and a gap of exactly the need can read 2 cm short.
 */
export function rowGapM(catalogId: string | undefined): number {
  const rule = pieceRule(catalogId);
  const need = (rule?.zones ?? []).filter((z) => z.sides.includes('left') || z.sides.includes('right')).reduce((m, z) => Math.max(m, z.needM), 0);
  if (need > 0) return round(need + 0.04);
  return rule?.category === 'seating' ? 0.03 : 0.05;
}

/** `count` copies of a piece beside `anchor` along its width axis (to its right for `dir` 1, its left for -1), each `gap` from the last, same turn. */
export function rowBoxes(spec: Pick<CatalogItem, 'footprint' | 'id'>, anchor: Box, count: number, dir: 1 | -1 = 1, gap: number = rowGapM(spec.id)): Box[] {
  const { b } = boxAxes(anchor);
  const out: Box[] = [];
  // the first copy sits beside the anchor's own edge, whatever its own width
  let off = anchor.w / 2 + gap + spec.footprint.w / 2;
  for (let k = 0; k < count; k++) {
    out.push({ cx: round(anchor.cx + b.x * dir * off), cz: round(anchor.cz + b.z * dir * off), w: spec.footprint.w, d: spec.footprint.d, yawDeg: anchor.yawDeg });
    off += spec.footprint.w + gap;
  }
  return out;
}

export interface SeatingOptions {
  /** chairs side by side in a row, and rows */
  cols: number;
  rows: number;
  /** gap between chairs in a row, metres (default 3 cm: hall chairs are set edge to edge) */
  seatGapM?: number;
  /** distance from one row's chair front to the next row's: 0.9 m is the common pitch (a 52 cm chair and room for knees) */
  rowPitchM?: number;
  /** a cross aisle after every `aisleEvery` chairs of a row (0 for none), `aisleM` wide */
  aisleEvery?: number;
  aisleM?: number;
}
export interface SeatingPlan {
  /** one box per chair: the grid's local frame has x across and z toward the front (the stage); the front row is at z 0 and the rows go back (-z) */
  local: Box[];
  seats: number;
  widthM: number;
  depthM: number;
  /** the same boxes turned `yawDeg` about, and centred on, `centre` (the middle of the front row), for the scene */
  place(centre: Vec2, yawDeg: number): Box[];
  /** "48 seats: 6 rows of 8, a 1.2 m aisle after every 4": the sentence a builder reads */
  words: string;
}

export const SEAT_PITCH_M = 0.9;
export const AISLE_M = 1.2;

/** A block of seating: `rows` x `cols` chairs, optional aisles. Reports the seat count and the size of the block. */
export function seatingPlan(chair: Pick<CatalogItem, 'footprint'>, o: SeatingOptions): SeatingPlan {
  const cols = Math.max(1, Math.floor(o.cols)), rows = Math.max(1, Math.floor(o.rows));
  const gap = o.seatGapM ?? 0.03;
  const pitch = Math.max(chair.footprint.d + 0.05, o.rowPitchM ?? SEAT_PITCH_M);
  const every = Math.max(0, Math.floor(o.aisleEvery ?? 0));
  const aisle = o.aisleM ?? AISLE_M;
  const aisles = every > 0 ? Math.max(0, Math.ceil(cols / every) - 1) : 0;
  const widthM = cols * chair.footprint.w + (cols - 1) * gap + aisles * aisle;
  const depthM = (rows - 1) * pitch + chair.footprint.d;
  const xs: number[] = [];
  let x = -widthM / 2 + chair.footprint.w / 2;
  for (let c = 0; c < cols; c++) {
    xs.push(round(x));
    x += chair.footprint.w + gap;
    if (every > 0 && (c + 1) % every === 0 && c + 1 < cols) x += aisle;
  }
  const local: Box[] = [];
  for (let r = 0; r < rows; r++) for (const lx of xs) local.push({ cx: lx, cz: round(-r * pitch), w: chair.footprint.w, d: chair.footprint.d, yawDeg: 0 });
  const seats = local.length;
  const place = (centre: Vec2, yawDeg: number): Box[] => {
    const { a, b } = boxAxes({ cx: 0, cz: 0, w: 1, d: 1, yawDeg });
    return local.map((l) => ({ cx: round(centre.x + b.x * l.cx + a.x * l.cz), cz: round(centre.z + b.z * l.cx + a.z * l.cz), w: l.w, d: l.d, yawDeg }));
  };
  const words = `${seats} seats: ${rows} row${rows === 1 ? '' : 's'} of ${cols}${aisles > 0 ? `, ${aisles} aisle${aisles === 1 ? '' : 's'} of ${cm(aisle)} cm after every ${every}` : ''}, ${cm(pitch)} cm from row to row, ${(Math.round(widthM * 10) / 10).toFixed(1)} × ${(Math.round(depthM * 10) / 10).toFixed(1)} m.`;
  return { local, seats, widthM, depthM, place, words };
}

/**
 * Flooring tiles (or any flat piece) laid edge to edge over a rectangle of the floor, in whole tiles from its `x0, z0` corner: `nx` by `nz` of them.
 * (The piece may be a 2 x 2 m block: the area is covered in whole blocks.)
 */
export function fillBoxes(spec: Pick<CatalogItem, 'footprint'>, rect: { x0: number; z0: number; x1: number; z1: number }): Box[] {
  const w = spec.footprint.w, d = spec.footprint.d;
  const nx = Math.max(0, Math.floor((rect.x1 - rect.x0) / w + 1e-6)), nz = Math.max(0, Math.floor((rect.z1 - rect.z0) / d + 1e-6));
  const out: Box[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) out.push({ cx: round(rect.x0 + (i + 0.5) * w), cz: round(rect.z0 + (j + 0.5) * d), w, d, yawDeg: 0 });
  return out;
}

/** how far two turns are from being the same, or a half turn apart, in degrees (a piece beside its twin may face the same way or the opposite way) */
const turnDiff = (a: number, b: number): number => { const d = Math.abs((((a - b) % 180) + 180) % 180); return Math.min(d, 180 - d); };

/**
 * Snaps a box to the nearest piece beside it: when the pieces face the same way and the gap between their sides is under `reachM`, the box slides along
 * its width axis to leave exactly `gap` (the piece's own spacing), and its back edge is lined up with the neighbour's when that is within 15 cm.
 * Returns the box unchanged when nothing is near.
 */
export function snapToNeighbour(box: Box, others: Box[], gap: number, reachM = 0.3): Box {
  const { a, b } = boxAxes(box);
  let best: { shift: number; align: number; gapNow: number } | null = null;
  for (const o of others) {
    if (turnDiff(o.yawDeg, box.yawDeg) > 3) continue;
    // the neighbour in the box's own frame: dx across, dz along the depth
    const dx = (o.cx - box.cx) * b.x + (o.cz - box.cz) * b.z;
    const dz = (o.cx - box.cx) * a.x + (o.cz - box.cz) * a.z;
    // side by side: their depths overlap
    if (Math.abs(dz) > (box.d + o.d) / 2 - 0.05) continue;
    const gapNow = Math.abs(dx) - (box.w + o.w) / 2;
    if (gapNow < -0.02 || gapNow > reachM) continue;
    const backShift = dz - o.d / 2 + box.d / 2;
    if (!best || gapNow < best.gapNow) best = { shift: (gapNow - gap) * Math.sign(dx), align: Math.abs(backShift) < 0.15 ? backShift : 0, gapNow };
  }
  if (!best) return box;
  return { ...box, cx: round(box.cx + b.x * best.shift + a.x * best.align), cz: round(box.cz + b.z * best.shift + a.z * best.align) };
}

/** The point on a side of a box, for a label or a test: where a row would continue. */
export function rowEnd(box: Box, dir: 1 | -1): Vec2 {
  const e = sideEdge(box, dir === 1 ? 'right' : 'left');
  return e.mid;
}
