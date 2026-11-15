// What the buyer page does with fittings (AC, fan, curtains, plants, the drawing's chairs ...): list them, pick one under a ray, edit the overlay
// (remove, undo, move, resize), and turn a pointer into a legal new place. The pieces that know the rules are in src/look/fittings.ts; this file is the
// glue to the store (which keeps the overlay, saves it and puts it in the link) and to the layout (walls, rooms, doors). No DOM, no three.
import { computeEdgeFrames } from '../core/layout-geom';
import { pointInPolygon } from '../core/geometry';
import { roomCentre } from '../look/kit/rules';
import { wallInfosOf } from '../look/kit/fittings';
import {
  checkFloorSpot, cloneFittings, fittingsClear, fittingsClearMove, fittingsClearSize, fittingsMove, fittingsRemove, fittingsRestore, fittingsSize,
  FLOOR_REASON_TEXT, hitSlack, nearestWallEdge, pickFitting, resolveCeilingMove, resolveWallMove, wallObb,
} from '../look/fittings';
import type { FittingRecord, FittingRegistry, FittingsOverlay, MoveSpec, Obb } from '../look/fittings';
import type { EdgeFrame, Grid, Layout, RoomTag, Vec2 } from '../types';

export interface FittingsStoreLike {
  fittings(): FittingsOverlay;
  setFittings(next: FittingsOverlay): void;
  /** the walking grid with every temporary obstacle except these keys (a chair's own, for the spot it is moving to) */
  gridExcludingTemporary?(keys: string[]): Grid;
  grid?(): Grid;
  /** the furniture now in the home: a wall fitting is not offered a stretch of wall that a tall piece stands in front of */
  all?(): Array<{ box: { cx: number; cz: number; w: number; d: number; yawDeg: number }; heightM: number }>;
}

/** A ray: origin and unit direction, in world metres. */
export interface Ray { origin: { x: number; y: number; z: number }; dir: { x: number; y: number; z: number } }

/** What a drag points at: the new place (or null when the pointer is not on anything this fitting can stand on), and whether it is legal. */
export interface Target {
  spec: MoveSpec;
  ok: boolean;
  /** why not, in words */
  reason?: string;
  /** the box to draw as the ghost */
  ghost: Obb;
}

export interface FittingsApi {
  registry: FittingRegistry;
  list(): FittingRecord[];
  get(id: string): FittingRecord | undefined;
  /** the nearest fitting a ray meets, with its distance along the ray */
  pick(ray: Ray, touch: boolean): { id: string; dist: number } | null;
  overlay(): FittingsOverlay;
  remove(id: string): void;
  restore(id: string): void;
  move(id: string, spec: MoveSpec): void;
  size(id: string, values: number[]): void;
  /** back to how the home has it: no move, no size, not removed */
  reset(id: string): void;
  clearSize(id: string): void;
  clearMove(id: string): void;
  /** the fittings the viewer removed (with their names, for the tray's Undo list) */
  removed(): FittingRecord[];
  /** a legal new place for `rec` from a pointer: `wallPoint` is where the ray meets a wall (if it does), `floor` where it meets the floor, `ceiling` where it meets the ceiling plane */
  target(rec: FittingRecord, at: { wallPoint: { x: number; y: number; z: number } | null; floor: Vec2 | null; ceiling: Vec2 | null; rayDirXZ: Vec2 | null }, grab?: Vec2): Target | null;
  /** the room a floor or ceiling fitting stands in (the record's, or the one under its centre) */
  roomOf(rec: FittingRecord): RoomTag | null;
  onChange(cb: () => void): () => void;
}

export function createFittingsApi(deps: { registry: FittingRegistry; store: FittingsStoreLike; layout: Layout }): FittingsApi {
  const { registry, store, layout } = deps;
  const frames: EdgeFrame[] = computeEdgeFrames(layout);
  const infos = wallInfosOf(layout);
  const rooms = new Map(layout.rooms.map((r) => [r.id, r]));
  const doors = layout.openings.filter((o) => o.type !== 'window').flatMap((o) => {
    const f = frames.find((x) => x.roomId === o.roomId && x.edge === o.edge);
    return f ? [{ at: { x: f.a.x + f.dir.x * o.centreM, z: f.a.z + f.dir.z * o.centreM }, widthM: o.widthM, frame: f }] : [];
  });
  const edit = (fn: (o: FittingsOverlay) => FittingsOverlay): void => { store.setFittings(fn(store.fittings())); };
  const roomOf = (rec: FittingRecord): RoomTag | null => {
    const r = rec.roomId ? rooms.get(rec.roomId) : undefined;
    if (r) return r;
    return layout.rooms.find((x) => !x.partial && pointInPolygon({ x: rec.centre.x, z: rec.centre.z }, x.polygon)) ?? null;
  };

  return {
    registry,
    list: () => registry.all(),
    get: (id) => registry.get(id),
    pick(ray, touch) { return pickFitting(registry.all(), ray.origin, ray.dir, (r) => hitSlack(r, touch)); },
    overlay: () => cloneFittings(store.fittings()),
    remove: (id) => edit((o) => fittingsRemove(o, id)),
    restore: (id) => edit((o) => fittingsRestore(o, id)),
    move: (id, spec) => edit((o) => fittingsMove(o, id, spec)),
    size: (id, values) => edit((o) => fittingsSize(o, id, values)),
    reset: (id) => edit((o) => fittingsClear(o, id)),
    clearSize: (id) => edit((o) => fittingsClearSize(o, id)),
    clearMove: (id) => edit((o) => fittingsClearMove(o, id)),
    removed: () => registry.all().filter((r) => r.removed && !r.hidden),
    roomOf,
    onChange: (cb) => registry.onChange(cb),
    target(rec, at, grab) {
      const rule = rec.moveRule;
      if (!rule) return null;
      const room = roomOf(rec);
      if (!room) return null;
      if (rule.mount === 'wall') {
        const p = at.wallPoint;
        if (!p) return null;
        const found = nearestWallEdge(frames, room.id, { x: p.x, z: p.z }, at.rayDirXZ ?? undefined);
        // the point has to be on a wall of this fitting's room (the ray ends at a wall face)
        if (!found || found.dist > 0.4) return null;
        const t = resolveWallMove(infos, room.id, { edge: found.frame.edge, u: found.u, y: p.y }, rule.shape, store.all?.() ?? []);
        if (!t) {
          const ghost = wallObb(found.frame, found.u, p.y - rec.size.h / 2, p.y + rec.size.h / 2, rec.size.w, Math.max(rec.size.d, 0.03));
          return { spec: { m: 'w', edge: found.frame.edge, u: found.u, y: p.y }, ok: false, reason: 'No room for it on that wall.', ghost: { cx: ghost.centre.x, cy: ghost.centre.y, cz: ghost.centre.z, hx: ghost.half.x, hy: ghost.half.y, hz: ghost.half.z, yawDeg: ghost.yawDeg } };
        }
        const g = wallObb(t.frame, t.u, t.y - rec.size.h / 2, t.y + rec.size.h / 2, rec.size.w, Math.max(rec.size.d, 0.03));
        return { spec: { m: 'w', edge: t.edge, u: t.u, y: t.y }, ok: true, ghost: { cx: g.centre.x, cy: g.centre.y, cz: g.centre.z, hx: g.half.x, hy: g.half.y, hz: g.half.z, yawDeg: g.yawDeg } };
      }
      if (rule.mount === 'ceiling') {
        const p = at.ceiling;
        if (!p) return null;
        const t = resolveCeilingMove(room, p, rule.margin, roomCentre(room));
        if (!t) return null;
        return { spec: { m: 'c', x: t.x, z: t.z }, ok: true, ghost: { cx: t.x, cy: rec.centre.y, cz: t.z, hx: rec.half.x, hy: rec.half.y, hz: rec.half.z, yawDeg: rec.yawDeg } };
      }
      const f = at.floor;
      if (!f) return null;
      const cx = f.x + (grab?.x ?? 0), cz = f.z + (grab?.z ?? 0);
      const grid = rule.needFree ? (store.gridExcludingTemporary?.(['seats']) ?? store.grid?.() ?? null) : null;
      const v = checkFloorSpot({ cx, cz, w: rule.w, d: rule.d, yawDeg: rec.yawDeg }, room, grid, doors, { needFree: rule.needFree, doorKeepM: rule.doorKeepM });
      return {
        spec: { m: 'f', x: cx, z: cz, yawDeg: rec.yawDeg }, ok: v.ok, ...(v.ok ? {} : { reason: FLOOR_REASON_TEXT[v.reason] }),
        ghost: { cx, cy: rec.centre.y, cz, hx: rec.half.x, hy: rec.half.y, hz: rec.half.z, yawDeg: rec.yawDeg },
      };
    },
  };
}
