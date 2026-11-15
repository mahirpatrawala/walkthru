// Lived-in decor as tappable, movable fittings (see ../fittings.ts). Pure (no three, no DOM). The plan (plan.ts) is made on the home as drawn and is never
// changed; the viewer's overlay is put on it here (a removed piece is gone, a moved or resized one is somewhere else or another size), and every
// piece is reported as a FittingRecord. A piece that sits on a piece of furniture follows that furniture when My layout moves or resizes it.
import { computeEdgeFrames } from '../../core/layout-geom';
import { boxAxes } from '../../core/geometry';
import type { EdgeFrame, FurnitureItem, Layout } from '../../types';
import {
  CLOCK_SIZES, FRAME_WIDTHS, KIND_NAMES, dimLimits, nearestWallEdge, overlayFor, resolveWallMove, wallObb, yawOf,
} from '../fittings';
import type { FittingKind, FittingRecord, FittingsOverlay, ResizeSpec, WallShape } from '../fittings';
import { wallInfosOf } from '../kit/fittings';
import { pieceName } from '../../buyer/furnish-names';
import type { DecorPiece } from './plan';

export const LIVED_IN_NOTE = 'Decor added to show a lived-in home. Not from your drawing.';
export const fittingIdOf = (p: Pick<DecorPiece, 'id'>): string => `li:${p.id}`;

const nearly = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
const MOVABLE: Record<string, 'wall' | 'floor'> = { curtain: 'wall', clock: 'wall', frame: 'wall', pooja: 'wall', plant: 'floor', rug: 'floor', shoes: 'floor' };

export interface LivedFit {
  /** the pieces to build: the plan with moves and sizes put on, removed ones left out */
  pieces: DecorPiece[];
  removed: Set<string>;
  records: FittingRecord[];
}

/** Follows a host: where a piece standing on `drawn` stands once the piece of furniture is `live` (its place in the host's frame scales with the host). */
export function followHost(p: Pick<DecorPiece, 'x' | 'y' | 'z' | 'yawDeg'>, drawn: FurnitureItem, live: FurnitureItem): { x: number; y: number; z: number; yawDeg: number } {
  const da = boxAxes(drawn.box), la = boxAxes(live.box);
  const dx = p.x - drawn.box.cx, dz = p.z - drawn.box.cz;
  const lx = dx * da.b.x + dz * da.b.z, lz = dx * da.a.x + dz * da.a.z;
  const sx = drawn.box.w > 1e-6 ? live.box.w / drawn.box.w : 1, sz = drawn.box.d > 1e-6 ? live.box.d / drawn.box.d : 1;
  return {
    x: live.box.cx + la.b.x * lx * sx + la.a.x * lz * sz,
    z: live.box.cz + la.b.z * lx * sx + la.a.z * lz * sz,
    y: p.y + (live.surfaceHeightM - drawn.surfaceHeightM),
    yawDeg: p.yawDeg + (live.box.yawDeg - drawn.box.yawDeg),
  };
}

function resizeFor(p: DecorPiece): { spec: ResizeSpec | null; defaults: number[] | null } {
  switch (p.kind) {
    case 'curtain': return { spec: { kind: 'dims', dims: dimLimits('curtain', { w: p.w, d: p.d, h: p.height }) }, defaults: [p.w] };
    case 'rug': return { spec: { kind: 'dims', dims: dimLimits('rug', { w: p.w, d: p.d, h: p.height }) }, defaults: [p.w, p.d] };
    case 'plant': return { spec: { kind: 'dims', dims: dimLimits('plant', { w: p.w, d: p.d, h: p.height }) }, defaults: [p.height] };
    case 'clock': return { spec: { kind: 'classes', label: 'Diameter', options: CLOCK_SIZES }, defaults: [p.height] };
    case 'frame': return { spec: { kind: 'classes', label: 'Width', options: FRAME_WIDTHS }, defaults: [p.w] };
    default: return { spec: null, defaults: null };
  }
}

/** The piece with the viewer's size put on it. */
function sized(p: DecorPiece, size: number[] | undefined): DecorPiece {
  if (!size) return p;
  switch (p.kind) {
    case 'curtain': return { ...p, w: Math.min(4, Math.max(0.6, size[0])) };
    case 'rug': return size.length >= 2 ? { ...p, w: Math.min(3.2, Math.max(0.9, size[0])), d: Math.min(3.2, Math.max(0.9, size[1])) } : p;
    case 'plant': { const lim = dimLimits('plant', { w: p.w, d: p.d, h: p.height })[0]; return { ...p, height: Math.min(lim.max, Math.max(lim.min, size[0])) }; }
    case 'clock': { const v = Math.min(0.6, Math.max(0.15, size[0])); return { ...p, w: v, height: v }; }
    case 'frame': { const v = Math.min(1.2, Math.max(0.25, size[0])); return { ...p, w: v, height: v * 0.75 }; }
    default: return p;
  }
}

export function livedInFittings(layout: Layout, planned: DecorPiece[], overlay: FittingsOverlay | null, live: FurnitureItem[], drawn: FurnitureItem[]): LivedFit {
  const frames = computeEdgeFrames(layout);
  const infos = wallInfosOf(layout);
  const H = layout.wallHeightM;
  const drawnById = new Map(drawn.map((i) => [i.id, i]));
  const liveById = new Map(live.map((i) => [i.id, i]));
  const out: LivedFit = { pieces: [], removed: new Set(), records: [] };
  const frameOf = (roomId: string, edge: number): EdgeFrame | undefined => frames.find((f) => f.roomId === roomId && f.edge === edge);

  for (const base of planned) {
    const id = fittingIdOf(base);
    const ov = overlayFor(overlay, id);
    const kind = base.kind as FittingKind;
    const mount = base.place;
    let p = sized(base, ov.size);
    const rz = resizeFor(base);
    const rec: FittingRecord = {
      id, kind, name: KIND_NAMES[kind], mount, roomId: base.roomId, removed: ov.removed, moved: false, sized: false,
      centre: { x: p.x, y: p.y + p.height / 2, z: p.z }, half: { x: p.w / 2, y: Math.max(0.02, p.height / 2), z: p.d / 2 }, yawDeg: p.yawDeg,
      size: { w: p.w, d: p.d, h: p.height }, heightM: p.y, provenance: 'typical', label: LIVED_IN_NOTE, movable: false,
      resize: rz.spec, defaultSize: rz.defaults, currentSize: rz.defaults ? currentOf(base.kind, p) : null,
    };
    if (mount === 'wall') {
      const found = nearestWallEdge(frames, base.roomId, { x: base.x, z: base.z });
      const drawnEdge = found?.frame.edge ?? 0;
      const drawnU = found?.u ?? 0;
      const shape = (pp: DecorPiece): WallShape => (pp.kind === 'curtain'
        ? { w: pp.w, yRange: () => [pp.y, pp.y + pp.height], yMin: pp.y + pp.height / 2, yMax: pp.y + pp.height / 2, overWindows: true }
        : { w: pp.w, yRange: (yc) => [yc - pp.height / 2, yc + pp.height / 2], yMin: 0.7 + pp.height / 2, yMax: Math.max(0.8 + pp.height / 2, H - 0.15 - pp.height / 2) });
      let at = { frame: found?.frame, edge: drawnEdge, u: drawnU, yc: base.y + base.height / 2 };
      const mv = ov.move;
      if (mv?.m === 'w') {
        const t = resolveWallMove(infos, base.roomId, mv, shape(p));
        if (t) at = { frame: t.frame, edge: t.edge, u: t.u, yc: t.y };
      } else if (ov.size && at.frame) {
        // a piece made wider stays where it is, as far as its wall allows
        const t = resolveWallMove(infos, base.roomId, { edge: at.edge, u: at.u, y: at.yc }, shape(p));
        if (t) at = { frame: t.frame, edge: t.edge, u: t.u, yc: t.y };
        else p = base;
      }
      if (at.frame) {
        const f = at.frame;
        const into = { x: -f.out.x, z: -f.out.z };
        p = { ...p, x: f.a.x + f.dir.x * at.u, z: f.a.z + f.dir.z * at.u, y: at.yc - p.height / 2, yawDeg: yawOf(into.x, into.z) };
        Object.assign(rec, wallObb(f, at.u, p.y, p.y + p.height, p.w, p.d), { size: { w: p.w, d: p.d, h: p.height }, heightM: p.y });
        rec.wall = { edge: at.edge, u: at.u, y: at.yc, length: f.length };
        rec.moved = at.edge !== drawnEdge || !nearly(at.u, drawnU) || !nearly(at.yc, base.y + base.height / 2);
        rec.movable = MOVABLE[kind] === 'wall';
        if (rec.movable) rec.moveRule = { mount: 'wall', shape: shape(p) };
        if (rz.spec?.kind === 'classes' && base.kind === 'frame') rec.resize = { kind: 'classes', label: 'Width', options: FRAME_WIDTHS };
      }
    } else if (mount === 'floor') {
      if (ov.move?.m === 'f') p = { ...p, x: ov.move.x, z: ov.move.z, yawDeg: ov.move.yawDeg ?? p.yawDeg };
      rec.moved = !nearly(p.x, base.x) || !nearly(p.z, base.z) || !nearly(p.yawDeg, base.yawDeg);
      Object.assign(rec, { centre: { x: p.x, y: p.y + p.height / 2, z: p.z }, half: { x: p.w / 2, y: Math.max(0.02, p.height / 2), z: p.d / 2 }, yawDeg: p.yawDeg, size: { w: p.w, d: p.d, h: p.height }, heightM: 0 });
      rec.movable = MOVABLE[kind] === 'floor';
      if (rec.movable) rec.moveRule = { mount: 'floor', w: p.w, d: p.d, needFree: kind !== 'rug', doorKeepM: kind === 'rug' ? 0.05 : 0.5, turn: kind === 'rug' };
    } else {
      // on a piece of furniture: it goes where the piece goes
      const dh = base.hostId ? drawnById.get(base.hostId) : undefined;
      const lh = base.hostId ? liveById.get(base.hostId) : undefined;
      if (dh && lh) {
        const f = followHost(p, dh, lh);
        p = { ...p, x: f.x, y: f.y, z: f.z, yawDeg: f.yawDeg };
      }
      rec.hostLabel = lh ? pieceName(lh) : undefined;
      Object.assign(rec, { centre: { x: p.x, y: p.y + p.height / 2, z: p.z }, yawDeg: p.yawDeg, heightM: p.y });
      // a host that is gone (hidden in My layout) takes its decor with it: nothing to tap
      if (!lh && base.hostId) rec.removed = true;
    }
    rec.sized = !nearly(p.w, base.w) || !nearly(p.d, base.d) || !nearly(p.height, base.height);
    rec.currentSize = rz.defaults ? currentOf(base.kind, p) : null;
    out.records.push(rec);
    if (ov.removed) out.removed.add(base.id);
    else out.pieces.push(p);
  }
  return out;
}

function currentOf(kind: string, p: DecorPiece): number[] {
  switch (kind) {
    case 'curtain': return [p.w];
    case 'rug': return [p.w, p.d];
    case 'plant': return [p.height];
    case 'clock': return [p.height];
    case 'frame': return [p.w];
    default: return [];
  }
}
