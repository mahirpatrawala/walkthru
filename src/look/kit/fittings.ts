// The kit's fittings as tappable, movable things (see ../fittings.ts): ceiling fans, tube lights and switchboards. Pure (no three, no DOM).
// The plan as drawn (rules.ts) is never changed. The viewer's overlay is put on it here: a removed, moved or resized fitting is reported as an
// edit, and every fitting becomes a FittingRecord with its card words, its movement rule and its size options.
import { computeEdgeFrames } from '../../core/layout-geom';
import type { FurnitureItem, Layout } from '../../types';
import {
  FAN_SWEEPS, KIND_NAMES, TUBE_LENGTHS, overlayFor, resolveCeilingMove, resolveWallMove, wallObb,
} from '../fittings';
import type { FittingRecord, FittingsOverlay, ResizeSpec, WallShape } from '../fittings';
import { roomCentre, wallInfos, bedheadBoards, doorBoards, fanSites, tubeSites, PLATE_H_M, PLATE_W_M } from './rules';
import type { BoardSite, FanSite, TubeSite, WallInfo } from './rules';
import { distanceToSegment } from '../../core/geometry';

const infoCache = new WeakMap<Layout, WallInfo[]>();
/** the walls of a layout with the holes cut in them (cached per layout object) */
export function wallInfosOf(layout: Layout): WallInfo[] {
  let v = infoCache.get(layout);
  if (!v) { v = wallInfos(layout); infoCache.set(layout, v); }
  return v;
}

const clearance = (pt: { x: number; z: number }, poly: { x: number; z: number }[]): number => {
  let b = Infinity;
  for (let i = 0; i < poly.length; i++) b = Math.min(b, distanceToSegment(pt, poly[i], poly[(i + 1) % poly.length]));
  return b;
};

export const TUBE_Y_MIN = 1.2;
export const BOARD_Y_MIN = 0.35;
export const BOARD_Y_MAX = 1.7;
/** blades keep this far from every wall of the room */
export const FAN_WALL_PAD_M = 0.3;

export const tubeShape = (lengthM: number, H: number): WallShape => ({ w: lengthM, yRange: (y) => [y - 0.034, y + 0.034], yMin: TUBE_Y_MIN, yMax: Math.max(TUBE_Y_MIN, H - 0.4) });
export const boardShape = (): WallShape => ({ w: PLATE_W_M, yRange: (y) => [y - PLATE_H_M / 2, y + PLATE_H_M / 2], yMin: BOARD_Y_MIN, yMax: BOARD_Y_MAX });

export interface KitFittings {
  /** the sites as drawn (the baked static meshes are built from these) */
  drawn: { fans: FanSite[]; tubes: TubeSite[]; boards: BoardSite[] };
  /** the sites now: removed ones gone, moved and resized ones at their new place and size. Bed-head boards follow the live beds. */
  live: { fans: FanSite[]; tubes: TubeSite[]; boards: BoardSite[]; bedheads: BoardSite[] };
  /** static ids that differ from the drawing (moved, resized or removed): taken out of the static meshes */
  editedStatic: Set<string>;
  /** the edited ones that still exist: built again, dynamically lit, at their new place */
  dynamic: { fans: FanSite[]; tubes: TubeSite[]; boards: BoardSite[] };
  records: FittingRecord[];
}

const sameNum = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

/** The plan as drawn with the overlay on it. `drawnFurniture` is the home as drawn (decides where the drawn sites are), `liveFurniture` the beds as they stand now. */
export function kitFittings(layout: Layout, drawnFurniture: FurnitureItem[], liveFurniture: FurnitureItem[], overlay: FittingsOverlay | null): KitFittings {
  const H = layout.wallHeightM;
  const infos = wallInfosOf(layout);
  const frames = computeEdgeFrames(layout);
  const rooms = new Map(layout.rooms.map((r) => [r.id, r]));
  const drawn = { fans: fanSites(layout), tubes: tubeSites(layout, drawnFurniture), boards: doorBoards(layout, drawnFurniture) };
  const live = { fans: [] as FanSite[], tubes: [] as TubeSite[], boards: [] as BoardSite[], bedheads: [] as BoardSite[] };
  const editedStatic = new Set<string>();
  const dynamic = { fans: [] as FanSite[], tubes: [] as TubeSite[], boards: [] as BoardSite[] };
  const records: FittingRecord[] = [];
  const frameOf = (roomId: string, edge: number) => frames.find((f) => f.roomId === roomId && f.edge === edge);

  // ---- fans: across the ceiling of their room, sweep 900 / 1200 / 1400 mm
  for (const f of drawn.fans) {
    const room = rooms.get(f.roomId);
    if (!room) continue;
    const ov = overlayFor(overlay, f.id);
    const centre = roomCentre(room);
    const fitsSweep = (sweep: number, at: { x: number; z: number }): boolean => sweep / 2 + FAN_WALL_PAD_M <= clearance(at, room.polygon);
    let radiusM = f.radiusM;
    if (ov.size && ov.size[0] >= 0.5 && ov.size[0] <= 1.6) radiusM = ov.size[0] / 2;
    let at = { x: f.x, z: f.z };
    if (ov.move?.m === 'c') {
      const t = resolveCeilingMove(room, { x: ov.move.x, z: ov.move.z }, radiusM + FAN_WALL_PAD_M, centre);
      if (t) at = t;
    }
    // a sweep that no longer fits where the fan is (a bigger one, or a move toward a wall) is the largest that does
    while (radiusM > f.radiusM && !fitsSweep(radiusM * 2, at)) radiusM = Math.max(f.radiusM, Math.round((radiusM - 0.05) * 100) / 100);
    const site: FanSite = { ...f, x: at.x, z: at.z, radiusM };
    const edited = !sameNum(site.x, f.x) || !sameNum(site.z, f.z) || !sameNum(site.radiusM, f.radiusM);
    if (edited || ov.removed) editedStatic.add(f.id);
    if (!ov.removed) { live.fans.push(site); if (edited) dynamic.fans.push(site); }
    const options = FAN_SWEEPS.filter((o) => fitsSweep(o.value, at));
    const resize: ResizeSpec | null = options.length ? { kind: 'classes', label: 'Sweep', options } : null;
    records.push({
      id: f.id, kind: 'fan', name: KIND_NAMES.fan, mount: 'ceiling', roomId: f.roomId, removed: ov.removed, moved: !!ov.move && (!sameNum(site.x, f.x) || !sameNum(site.z, f.z)), sized: !sameNum(site.radiusM, f.radiusM),
      centre: { x: site.x, y: H - 0.13, z: site.z }, half: { x: radiusM, y: 0.14, z: radiusM }, yawDeg: 0,
      size: { w: radiusM * 2, d: radiusM * 2, h: 0.265, round: true }, heightM: H - 0.265,
      provenance: 'typical', movable: true, resize, defaultSize: [f.radiusM * 2], currentSize: [radiusM * 2],
      moveRule: { mount: 'ceiling', margin: radiusM + FAN_WALL_PAD_M },
    });
  }

  // ---- tubes: along a wall, 2 / 3 / 4 ft
  const tubeBase = (t: TubeSite): FittingRecord | null => {
    const frame = frameOf(t.roomId, t.edge);
    if (!frame) return null;
    return {
      id: t.id, kind: 'tube', name: KIND_NAMES.tube, mount: 'wall', roomId: t.roomId, removed: false, moved: false, sized: false,
      ...wallObb(frame, t.u, t.y - 0.037, t.y + 0.037, t.lengthM, 0.04),
      size: { w: t.lengthM, d: 0.04, h: 0.07 }, heightM: t.y - 0.037, wall: { edge: t.edge, u: t.u, y: t.y, length: frame.length },
      provenance: 'typical', movable: true, resize: null, defaultSize: [t.lengthM], currentSize: [t.lengthM],
      moveRule: { mount: 'wall', shape: tubeShape(t.lengthM, H) },
    };
  };
  for (const t of drawn.tubes) {
    const ov = overlayFor(overlay, t.id);
    let site: TubeSite = { ...t };
    if (ov.size && ov.size[0] >= 0.3 && ov.size[0] <= 1.4) site = { ...site, lengthM: ov.size[0] };
    if (ov.move?.m === 'w') {
      const tgt = resolveWallMove(infos, t.roomId, ov.move, tubeShape(site.lengthM, H));
      if (tgt) site = { ...site, edge: tgt.edge, u: tgt.u, y: tgt.y };
    } else if (!sameNum(site.lengthM, t.lengthM)) {
      // a longer tube stays where it is, as far as the wall allows
      const tgt = resolveWallMove(infos, t.roomId, { edge: t.edge, u: t.u, y: t.y }, tubeShape(site.lengthM, H));
      if (tgt) site = { ...site, u: tgt.u };
      else site = { ...site, lengthM: t.lengthM };
    }
    const edited = site.edge !== t.edge || !sameNum(site.u, t.u) || !sameNum(site.y, t.y) || !sameNum(site.lengthM, t.lengthM);
    if (edited || ov.removed) editedStatic.add(t.id);
    if (!ov.removed) { live.tubes.push(site); if (edited) dynamic.tubes.push(site); }
    const rec = tubeBase(site);
    if (!rec) continue;
    const infoFor = infos.find((w) => w.room.id === t.roomId && w.frame.edge === site.edge);
    const options = TUBE_LENGTHS.filter((o) => !!infoFor && !!resolveWallMove(infos, t.roomId, { edge: site.edge, u: site.u, y: site.y }, tubeShape(o.value, H)));
    rec.removed = ov.removed;
    rec.moved = site.edge !== t.edge || !sameNum(site.u, t.u) || !sameNum(site.y, t.y);
    rec.sized = !sameNum(site.lengthM, t.lengthM);
    rec.defaultSize = [t.lengthM];
    rec.resize = options.length ? { kind: 'classes', label: 'Length', options } : null;
    records.push(rec);
  }

  // ---- switchboards: along a wall, at switch height
  const boardRecord = (b: BoardSite, ov: ReturnType<typeof overlayFor>, orig: BoardSite): FittingRecord | null => {
    const frame = frameOf(b.roomId, b.edge);
    if (!frame) return null;
    return {
      id: b.id, kind: 'switchboard', name: KIND_NAMES.switchboard, mount: 'wall', roomId: b.roomId, removed: ov.removed,
      moved: b.edge !== orig.edge || !sameNum(b.u, orig.u) || !sameNum(b.y, orig.y), sized: false,
      ...wallObb(frame, b.u, b.y - PLATE_H_M / 2, b.y + PLATE_H_M / 2, PLATE_W_M, 0.02),
      size: { w: PLATE_W_M, d: 0.02, h: PLATE_H_M }, heightM: b.y - PLATE_H_M / 2, wall: { edge: b.edge, u: b.u, y: b.y, length: frame.length },
      provenance: 'typical', movable: true, resize: null, defaultSize: null, currentSize: null,
      moveRule: { mount: 'wall', shape: boardShape() },
    };
  };
  const placeBoard = (b: BoardSite): BoardSite => {
    const ov = overlayFor(overlay, b.id);
    if (ov.move?.m !== 'w') return b;
    const tgt = resolveWallMove(infos, b.roomId, ov.move, boardShape());
    return tgt ? { ...b, edge: tgt.edge, u: tgt.u, y: tgt.y } : b;
  };
  for (const b of drawn.boards) {
    const ov = overlayFor(overlay, b.id);
    const site = placeBoard(b);
    const edited = site.edge !== b.edge || !sameNum(site.u, b.u) || !sameNum(site.y, b.y);
    if (edited || ov.removed) editedStatic.add(b.id);
    if (!ov.removed) { live.boards.push(site); if (edited) dynamic.boards.push(site); }
    const rec = boardRecord(site, ov, b);
    if (rec) records.push(rec);
  }
  for (const b of bedheadBoards(layout, liveFurniture)) {
    const ov = overlayFor(overlay, b.id);
    const site = placeBoard(b);
    if (!ov.removed) live.bedheads.push(site);
    const rec = boardRecord(site, ov, b);
    if (rec) records.push(rec);
  }
  return { drawn, live, editedStatic, dynamic, records };
}
