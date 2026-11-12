// C12a: elevation sheets for the synthetic sets: a wall of one room seen from inside, with the built-in unit, bed, openings,
// dimension strings and the truth for each (SPEC 17.10 "Elevation content").
import type { HingeSignals, SetOptions, TruthDimension, TruthElevation, TruthItem, UnitTruth } from './types';
import type { Furnished } from './symbols';
import type { Layout, LRoom, Rng } from './layout';
import { snapDim } from './layout';
import type { Canvas, TextStyle, WallPaint } from './draw';
import { drawWallRect, fmtLen } from './draw';

const FT = 0.3048;
export type WallSide = 'N' | 'E' | 'S' | 'W';
export const EDGE_SIDE: WallSide[] = ['N', 'E', 'S', 'W'];
const YAW: Record<WallSide, number> = { N: 0, S: 180, W: 90, E: 270 };
const SIGNALS: HingeSignals[] = ['both', 'handle', 'mark', 'neither', 'disagree', 'both'];

export interface DimMaker { (value: number, role: 'member' | 'overall' | 'wall'): { s: string; shownM: number; rounded: boolean; planted: boolean } }
export interface ElevCtx {
  L: Layout; F: Furnished; o: SetOptions; rng: Rng; H: number; paint: WallPaint; ts: (kind: 'label' | 'dim') => TextStyle;
  dimStr: DimMaker; dims: TruthDimension[]; nextDim: () => string; signalBase: number; unitNo: { n: number };
}
export interface ElevOut { truth: TruthElevation; ptPerM: number }

export const wallLengthOf = (room: LRoom, side: WallSide): number => (side === 'N' || side === 'S' ? room.rect.x1 - room.rect.x0 : room.rect.z1 - room.rect.z0);

/** Distance along the wall as seen from inside, for a point (x, z) on the plan. */
export function alongWall(room: LRoom, side: WallSide, x: number, z: number): number {
  const R = room.rect;
  return side === 'N' ? x - R.x0 : side === 'E' ? z - R.z0 : side === 'S' ? R.x1 - x : R.z1 - z;
}
function itemRange(room: LRoom, side: WallSide, b: [number, number, number, number]): [number, number] {
  const R = room.rect;
  if (side === 'N') return [b[0] - R.x0, b[2] - R.x0];
  if (side === 'E') return [b[1] - R.z0, b[3] - R.z0];
  if (side === 'S') return [R.x1 - b[2], R.x1 - b[0]];
  return [R.z1 - b[3], R.z1 - b[1]];
}
/** Items whose back is on this wall. */
export function itemsOnWall(F: Furnished, room: LRoom, side: WallSide): { item: TruthItem; u0: number; u1: number }[] {
  const out: { item: TruthItem; u0: number; u1: number }[] = [];
  for (const it of F.items) {
    if (it.roomId !== room.id || Math.abs(it.box.yawDeg - YAW[side]) > 1) continue;
    const sym = F.symbols.find((s) => s.itemId === it.id)!;
    const b = sym.bboxM, R = room.rect;
    const gap = side === 'N' ? b[1] - R.z0 : side === 'S' ? R.z1 - b[3] : side === 'W' ? b[0] - R.x0 : R.x1 - b[2];
    if (gap > 0.06) continue;
    const [u0, u1] = itemRange(room, side, b);
    out.push({ item: it, u0, u1 });
  }
  return out;
}

export function planUnit(ctx: ElevCtx, item: TruthItem, wall: number): UnitTruth {
  const { rng, o } = ctx;
  const w = item.box.w;
  const n = Math.max(2, Math.min(5, Math.round(w / 0.9)));
  const pitch = snapDim(w / n, o);
  const bayWidths = Array.from({ length: n }, (_, i) => (i < n - 1 ? pitch : w - pitch * (n - 1)));
  const shutters = bayWidths.map((bw) => (bw < 0.7 ? 1 : rng.pick([1, 2, 2])));
  const heights = [7, 8, 8.5].map((f) => f * FT).filter((h) => h <= ctx.H - 0.1);
  const heightM = rng.pick(heights.length ? heights : [7 * FT]);
  const loftM = heightM > 7 * FT + 1e-6 ? heightM - 7 * FT : 0;
  const hinge: UnitTruth['hinge'] = []; const signals: HingeSignals[] = [];
  for (let i = 0; i < n; i++) {
    const sig = SIGNALS[(ctx.signalBase + i) % SIGNALS.length];
    signals.push(sig);
    const trueHinge = shutters[i] === 2 ? 'outer-edges' : rng.pick(['left', 'right'] as const);
    hinge.push(sig === 'neither' ? 'unknown' : sig === 'disagree' ? 'conflict' : trueHinge);
  }
  return {
    id: `unit-${++ctx.unitNo.n}`, itemId: item.id, wall, bays: n, bayWidthsM: bayWidths, shuttersPerBay: shutters, hinge, hingeSignals: signals,
    drawerStripM: rng.pick([0, 7 * 0.0254, 8 * 0.0254]), baseGapM: o.units === 'ftin' ? rng.pick([0, 2 * 0.0254, 4 * 0.0254]) : rng.pick([0, 0.1, 0.15]), loftM, heightM,
    handle: { yM: rng.pick([0.9, 1.0, 1.05]), lengthM: rng.pick([0.2, 0.25, 0.3]) }, widthM: w,
    notes: shutters.map((s) => (s === 2 ? '2 SHUTTER OPENABLE' : '1 SHUTTER OPENABLE')),
  };
}

interface Frame { X: (u: number) => number; Y: (h: number) => number; S: number }

/** Draws the elevation of `room`'s wall `edge` into `region` (points). */
export function drawElevation(
  cv: Canvas, region: [number, number, number, number], ctx: ElevCtx, room: LRoom, edge: number,
  meta: { id: string; caption: string; tag: string; page: number; onPlanPage: boolean; unit?: UnitTruth },
): ElevOut {
  const { o, H } = ctx;
  const side = EDGE_SIDE[edge];
  const Lw = wallLengthOf(room, side);
  const [rx0, ry0, rx1, ry1] = region;
  const wallT = 0.23, slabT = 0.25;
  const S = Math.min((rx1 - rx0 - 70) / (Lw + 2 * wallT + 1.6), (ry1 - ry0 - 80) / (H + slabT + 0.8));
  const ox = rx0 + 30 + wallT * S, floorY = ry0 + 20 + (slabT + H) * S;
  const f: Frame = { X: (u) => ox + u * S, Y: (h) => floorY - h * S, S };
  const black = '#000000';
  const dimsText = ctx.ts('dim'), labelText = ctx.ts('label');
  const tsz = Math.max(4.2, Math.min(7, S * 0.09));
  // structure: floor line, side walls, slab band
  cv.line(black, 0.6, [f.X(-wallT), f.Y(0)], [f.X(Lw + wallT), f.Y(0)]);
  drawWallRect(cv, ctx.paint, f.X(-wallT), f.Y(H + slabT), f.X(Lw + wallT), f.Y(H), false, true);
  drawWallRect(cv, ctx.paint, f.X(-wallT), f.Y(H), f.X(0), f.Y(0), false, false);
  drawWallRect(cv, ctx.paint, f.X(Lw), f.Y(H), f.X(Lw + wallT), f.Y(0), false, false);
  const levels: TruthElevation['levels'] = [];
  const truthDims: TruthDimension[] = [];
  const addDim = (kind: TruthDimension['kind'], chain: string, a: [number, number], b: [number, number], value: number, role: 'member' | 'overall'): { s: string; shownM: number } => {
    const d = ctx.dimStr(value, role);
    truthDims.push({ id: ctx.nextDim(), kind, chain, view: meta.id, a, b, valueM: value, shownM: d.shownM, string: d.s, textMode: dimsText.mode, rounded: d.rounded, planted: d.planted });
    return d;
  };
  // vertical dimension: a line at x (points) from height h0 to h1, text left of it reading upward
  const vdim = (xPt: number, h0: number, h1: number, chain: string, kind: TruthDimension['kind'], role: 'member' | 'overall' = 'member', textSide = -1): void => {
    const d = addDim(kind, chain, [0, h0], [0, h1], h1 - h0, role);
    const y0 = f.Y(h0), y1 = f.Y(h1);
    cv.line(black, 0.3, [xPt, y0], [xPt, y1]);
    for (const y of [y0, y1]) { cv.line(black, 0.3, [xPt - 2.5, y + 2.5], [xPt + 2.5, y - 2.5]); }
    cv.text(d.s, xPt + textSide * 1.6, (y0 + y1) / 2 + textWidthOf(d.s, tsz, dimsText) / 2, tsz, dimsText, -90, 'start');
  };
  const textWidthOf = (s: string, size: number, st: TextStyle): number => (st.mode === 'real' ? size * 0.55 * s.length : size * 0.72 / 6 * 5.2 * st.widthScale * s.length);
  const hdim = (yPt: number, u0: number, u1: number, chain: string, kind: TruthDimension['kind'], role: 'member' | 'overall' = 'member'): void => {
    const d = addDim(kind, chain, [u0, 0], [u1, 0], u1 - u0, role);
    const x0 = f.X(u0), x1 = f.X(u1);
    cv.line(black, 0.3, [x0, yPt], [x1, yPt]);
    for (const x of [x0, x1]) cv.line(black, 0.3, [x - 2.5, yPt + 2.5], [x + 2.5, yPt - 2.5]);
    cv.text(d.s, (x0 + x1) / 2, yPt - 1.6, tsz, dimsText, 0, 'mid');
  };

  // openings on this wall
  const trOpenings: TruthElevation['openings'] = [];
  for (const q of ctx.L.openings) {
    if (!q.rooms.includes(room.id) || q.style === 'sliding') continue;
    const run = ctx.L.runs.find((r) => r.id === q.run)!;
    const R = room.rect;
    const onSide = side === 'N' ? run.axis === 'h' && Math.abs(run.rect.z1 - R.z0) < 0.3 : side === 'S' ? run.axis === 'h' && Math.abs(run.rect.z0 - R.z1) < 0.3
      : side === 'W' ? run.axis === 'v' && Math.abs(run.rect.x1 - R.x0) < 0.3 : run.axis === 'v' && Math.abs(run.rect.x0 - R.x1) < 0.3;
    if (!onSide) continue;
    const cx = side === 'N' || side === 'S' ? q.centre : q.centre;
    const c = side === 'N' ? cx - R.x0 : side === 'S' ? R.x1 - cx : side === 'E' ? cx - R.z0 : R.z1 - cx;
    const u0 = c - q.width / 2, u1 = c + q.width / 2;
    cv.rect(black, 0.4, f.X(u0), f.Y(q.head), f.X(u1), f.Y(q.sill));
    if (q.type === 'window') { cv.line(black, 0.2, [f.X(c), f.Y(q.head)], [f.X(c), f.Y(q.sill)]); cv.line(black, 0.15, [f.X(u0), f.Y((q.sill + q.head) / 2)], [f.X(u1), f.Y((q.sill + q.head) / 2)]); }
    else cv.rect(black, 0.2, f.X(u0 + 0.06), f.Y(q.head - 0.06), f.X(u1 - 0.06), f.Y(0.02));
    trOpenings.push({ type: q.type === 'window' ? 'window' : 'door', fromLeftM: u0, widthM: q.width, sillM: q.sill, headM: q.head });
    if (q.type === 'window') {
      const xd = u0 > 0.45 ? f.X(u0) - 6 : f.X(u1) + 6;
      cv.line(black, 0.3, [xd, f.Y(q.sill)], [xd, f.Y(q.head)]);
      const dSill = addDim('elev-vertical', `win-${trOpenings.length}`, [u0, 0], [u0, q.sill], q.sill, 'member');
      const dHead = addDim('elev-vertical', `win-${trOpenings.length}`, [u0, q.sill], [u0, q.head], q.head - q.sill, 'member');
      cv.text(dSill.s, xd - 1.4, f.Y(q.sill / 2) + 6, tsz * 0.9, dimsText, -90);
      cv.text(dHead.s, xd - 1.4, f.Y((q.sill + q.head) / 2) + 6, tsz * 0.9, dimsText, -90);
      for (const h of [q.sill, q.head]) cv.line(black, 0.3, [xd - 2.5, f.Y(h) + 2.5], [xd + 2.5, f.Y(h) - 2.5]);
      levels.push({ kind: 'sill', heightM: q.sill, string: dSill.s }, { kind: 'head', heightM: q.head, string: fmtLen(q.head, o).s });
    }
  }

  const units: UnitTruth[] = [];
  let bed: TruthElevation['bed'];
  for (const { item, u0, u1 } of itemsOnWall(ctx.F, room, side)) {
    if (item.cls === 'wardrobe') {
      const unit = meta.unit && meta.unit.itemId === item.id ? meta.unit : planUnit(ctx, item, edge);
      units.push(unit);
      drawUnit(cv, f, unit, u0, u1, dimsText, labelText, tsz, ctx, hdim, vdim, S);
    } else if (item.cls === 'bed') {
      const baseTop = 0.35 + (ctx.rng() > 0.5 ? 0 : 0.05) , matT = 0.15, headTop = ctx.rng.pick([0.95, 1.05, 1.2]);
      const w = u1 - u0;
      cv.rect(black, 0.4, f.X(u0), f.Y(0.12), f.X(u1), f.Y(baseTop));
      cv.rect(black, 0.3, f.X(u0 + 0.02), f.Y(baseTop + matT), f.X(u1 - 0.02), f.Y(baseTop));
      cv.rect(black, 0.4, f.X(u0), f.Y(headTop), f.X(u1), f.Y(baseTop + matT));
      cv.line(black, 0.15, [f.X(u0 + 0.05), f.Y(headTop - 0.2)], [f.X(u1 - 0.05), f.Y(headTop - 0.2)]);
      for (const x of [u0 + 0.05, u1 - 0.1]) cv.rect(black, 0.3, f.X(x), f.Y(0), f.X(x + 0.05), f.Y(0.12));
      const xd = f.X(u1) + 8;
      vdim(xd, 0, baseTop, 'bed', 'elev-vertical');
      vdim(xd, baseTop, baseTop + matT, 'bed', 'elev-vertical');
      vdim(xd, baseTop + matT, headTop, 'bed', 'elev-vertical');
      if (o.labelStyle === 'designer') cv.text(o.upper ? 'MATTRESS' : 'Mattress', f.X(u0) + 3, f.Y(baseTop + matT / 2) + tsz * 0.35, tsz * 0.85, labelText);
      bed = { itemId: item.id, baseTopM: baseTop, mattressTopM: baseTop + matT, headboardTopM: headTop, widthM: w };
      levels.push({ kind: 'bed-base', heightM: baseTop, string: fmtLen(baseTop, o).s }, { kind: 'mattress-top', heightM: baseTop + matT, string: fmtLen(baseTop + matT, o).s }, { kind: 'headboard-top', heightM: headTop, string: fmtLen(headTop, o).s });
    } else if (item.cls === 'side table' || item.cls === 'desk') {
      const h = item.cls === 'desk' ? 0.75 : 0.55;
      cv.rect(black, 0.35, f.X(u0), f.Y(h), f.X(u1), f.Y(h - 0.04));
      for (const x of [u0 + 0.03, u1 - 0.05]) cv.rect(black, 0.3, f.X(x), f.Y(h - 0.04), f.X(x + 0.03), f.Y(0));
    }
  }
  // ceiling height
  const ceil = addDim('elev-vertical', 'ceiling', [Lw + 0.3, 0], [Lw + 0.3, H], H, 'overall');
  const cxd = f.X(Lw + wallT) + 14;
  cv.line(black, 0.3, [cxd, f.Y(0)], [cxd, f.Y(H)]);
  for (const h of [0, H]) cv.line(black, 0.3, [cxd - 2.5, f.Y(h) + 2.5], [cxd + 2.5, f.Y(h) - 2.5]);
  cv.text(ceil.s, cxd - 1.6, f.Y(H / 2) + 8, tsz, dimsText, -90);
  levels.push({ kind: 'ceiling', heightM: H, string: ceil.s });
  ctx.dims.push(...truthDims);
  return {
    ptPerM: S,
    truth: {
      id: meta.id, page: meta.page, onPlanPage: meta.onPlanPage, caption: meta.caption, tag: meta.tag, ptPerM: S, wall: { roomId: room.id, edge },
      ceilingM: H, ceilingString: ceil.s, levels, openings: trOpenings, units, ...(bed ? { bed } : {}),
    },
  };
}

function drawUnit(
  cv: Canvas, f: Frame, unit: UnitTruth, u0: number, u1: number, dimsText: TextStyle, labelText: TextStyle, tsz: number, ctx: ElevCtx,
  hdim: (yPt: number, u0: number, u1: number, chain: string, kind: TruthDimension['kind'], role?: 'member' | 'overall') => void,
  vdim: (xPt: number, h0: number, h1: number, chain: string, kind: TruthDimension['kind'], role?: 'member' | 'overall') => void, S: number,
): void {
  const black = '#000000';
  const g = unit.baseGapM, top = unit.heightM, loftLine = unit.loftM > 0 ? 7 * FT : top;
  cv.rect(black, 0.5, f.X(u0), f.Y(top), f.X(u1), f.Y(g));
  if (unit.loftM > 0) cv.line(black, 0.4, [f.X(u0), f.Y(loftLine)], [f.X(u1), f.Y(loftLine)]);
  let u = u0;
  const bayEdges: number[] = [u0];
  unit.bayWidthsM.forEach((bw, i) => {
    const a = u, b = u + bw; u = b; bayEdges.push(b);
    if (i > 0) cv.line(black, 0.45, [f.X(a), f.Y(top)], [f.X(a), f.Y(g)]);
    const lowY = g + unit.drawerStripM;
    if (unit.drawerStripM > 0) {
      cv.line(black, 0.3, [f.X(a), f.Y(lowY)], [f.X(b), f.Y(lowY)]);
      if (ctx.o.labelStyle === 'designer') cv.text(ctx.o.upper ? 'DRAWER' : 'Drawer', f.X((a + b) / 2), f.Y(g + unit.drawerStripM / 2) + tsz * 0.3, tsz * 0.7, labelText, 0, 'mid');
    }
    const n = unit.shuttersPerBay[i];
    const sig = unit.hingeSignals[i];
    const truth = unit.hinge[i];
    const mid = (a + b) / 2;
    const shutterEdges = n === 2 ? [a, mid, b] : [a, b];
    if (n === 2) cv.line(black, 0.3, [f.X(mid), f.Y(loftLine)], [f.X(mid), f.Y(lowY)]);
    for (let s = 0; s < n; s++) {
      const e0 = shutterEdges[s], e1 = shutterEdges[s + 1];
      // true hinge side of this shutter: a pair hinges at the outer edges, a single one at the side the truth names
      const hingeLeft = n === 2 ? s === 0 : truth === 'left' || (truth === 'conflict' && i % 2 === 0) || (truth === 'unknown' && i % 2 === 0);
      const drawMark = sig === 'both' || sig === 'mark' || sig === 'disagree';
      const drawHandle = sig === 'both' || sig === 'handle' || sig === 'disagree';
      if (drawMark) {
        const apexU = hingeLeft ? e0 : e1, farU = hingeLeft ? e1 : e0;
        const am = (loftLine + lowY) / 2;
        cv.prims.push({ t: 'stroke', color: black, width: 0.1, pts: [[f.X(farU), f.Y(loftLine)], [f.X(apexU), f.Y(am)], [f.X(farU), f.Y(lowY)]], closed: false, dash: true });
      }
      if (drawHandle) {
        // the handle sits on the free edge; when the signals disagree it is drawn on the hinge edge
        const handleLeft = sig === 'disagree' ? hingeLeft : !hingeLeft;
        const hx = handleLeft ? e0 + 0.04 : e1 - 0.04;
        cv.line(black, 0.9, [f.X(hx), f.Y(unit.handle.yM - unit.handle.lengthM / 2)], [f.X(hx), f.Y(unit.handle.yM + unit.handle.lengthM / 2)]);
      }
    }
    if (unit.loftM > 0) for (let k = 1; k < n * 2; k++) cv.line(black, 0.2, [f.X(a + (bw * k) / (n * 2)), f.Y(top)], [f.X(a + (bw * k) / (n * 2)), f.Y(loftLine)]);
    if (ctx.o.labelStyle === 'designer') cv.text(unit.notes[i], f.X(mid), f.Y(top - 0.12), tsz * 0.7, labelText, 0, 'mid');
  });
  // chain under the floor line: bay widths and the overall width
  const chainY = f.Y(0) + 11, overallY = f.Y(0) + 20;
  unit.bayWidthsM.forEach((_, i) => hdim(chainY, bayEdges[i], bayEdges[i + 1], `unit-${unit.id}`, 'elev-chain'));
  hdim(overallY, u0, u1, `unit-${unit.id}`, 'elev-overall', 'overall');
  // right-hand stack: base gap, drawer strip, to the loft line, the loft
  const xd = f.X(u1) + 9 + (u1 > 0 ? 0 : 0);
  const marks = [0, g, g + unit.drawerStripM, loftLine, top].filter((h, k, a) => k === 0 || h > a[k - 1] + 1e-6);
  for (let k = 0; k + 1 < marks.length; k++) vdim(xd, marks[k], marks[k + 1], `stack-${unit.id}`, 'elev-vertical');
  vdim(xd + 9, 0, top, `stack-${unit.id}`, 'elev-vertical', 'overall');
  void S;
}

/** Interior view of a unit: bays as columns with their compartments bottom to top (an optional extra sheet). */
export function drawInternal(
  cv: Canvas, region: [number, number, number, number], ctx: ElevCtx, unit: UnitTruth, meta: { id: string; caption: string; page: number; parent: string },
): TruthElevation {
  const [rx0, ry0, rx1, ry1] = region;
  const S = Math.min((rx1 - rx0 - 90) / unit.widthM, (ry1 - ry0 - 70) / (unit.heightM + 0.3));
  const ox = rx0 + 30, floorY = ry0 + 20 + (unit.heightM + 0.2) * S;
  const X = (u: number): number => ox + u * S, Y = (h: number): number => floorY - h * S;
  const ts = ctx.ts('dim'), lt = ctx.ts('label');
  const tsz = Math.max(4, Math.min(6.5, S * 0.08));
  const black = '#000000';
  cv.rect(black, 0.6, X(0), Y(unit.heightM), X(unit.widthM), Y(unit.baseGapM));
  const kinds = ['footwear drawer', 'drawer', 'hanging', 'open shelf', 'folded shirts'];
  const zonesAll: { kind: string; heightM: number; string: string }[][] = [];
  let u = 0;
  unit.bayWidthsM.forEach((bw, i) => {
    if (i > 0) cv.line(black, 0.5, [X(u), Y(unit.heightM)], [X(u), Y(unit.baseGapM)]);
    // compartments from the bottom: a drawer strip, a shelf band, hanging space, a top shelf; they sum to the clear height
    const clear = unit.heightM - unit.baseGapM;
    const strip = unit.drawerStripM || 7 * 0.0254;
    const top = snapDim(Math.min(0.45, clear * 0.2), ctx.o);
    const shelf = snapDim(Math.min(0.45, clear * 0.2), ctx.o);
    const hang = clear - strip - shelf - top;
    const seq: [string, number][] = [[kinds[0], strip], [kinds[3], shelf], [kinds[2], hang], [kinds[3], top]];
    const zones: { kind: string; heightM: number; string: string }[] = [];
    let h = unit.baseGapM;
    seq.forEach(([k, zh], zi) => {
      const hh = zi === seq.length - 1 ? unit.heightM - h : zh;
      const x0 = X(u), x1 = X(u + bw);
      if (zi > 0) cv.line(black, 0.3, [x0, Y(h)], [x1, Y(h)]);
      const d = ctx.dimStr(hh, 'member');
      ctx.dims.push({ id: ctx.nextDim(), kind: 'elev-vertical', chain: `${unit.id}-int-${i}`, view: meta.id, a: [u, h], b: [u, h + hh], valueM: hh, shownM: d.shownM, string: d.s, textMode: ts.mode, rounded: d.rounded, planted: d.planted });
      if (i === 0) {
        const xd = X(unit.widthM) + 10;
        cv.line(black, 0.3, [xd, Y(h)], [xd, Y(h + hh)]);
        for (const y of [Y(h), Y(h + hh)]) cv.line(black, 0.3, [xd - 2.5, y + 2.5], [xd + 2.5, y - 2.5]);
        cv.text(d.s, xd - 1.6, (Y(h) + Y(h + hh)) / 2 + 6, tsz, ts, -90);
      }
      if (ctx.o.labelStyle === 'designer') cv.text(ctx.o.upper ? k.toUpperCase() : k, (x0 + x1) / 2, Y(h + hh / 2) + tsz * 0.3, tsz * 0.8, lt, 0, 'mid');
      zones.push({ kind: k, heightM: hh, string: d.s });
      h += hh;
    });
    zonesAll.push(zones);
    u += bw;
  });
  return {
    id: meta.id, page: meta.page, onPlanPage: false, caption: meta.caption, tag: meta.parent, ptPerM: S, wall: null, ceilingM: ctx.H, ceilingString: fmtLen(ctx.H, ctx.o).s,
    levels: [], openings: [], units: [], internal: { unitId: unit.id, zonesBottomUp: zonesAll },
  };
}
