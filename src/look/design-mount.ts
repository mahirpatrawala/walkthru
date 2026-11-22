// Mounts the DECOR and the ROOM FINISHES of the active style (SPEC 16.13): curtains and track, rugs, AC, downlights, bowl lights,
// wall panelling, a slatted feature wall, a ceiling band and a window seat; plus each room's wall and floor colour. Decor lives in its
// own group (not under the shell or the furniture root), no ray can hit it, nothing in it feeds a measurement, a fit check, a clearance
// or the collision grid. It is "typical fittings, not from your drawing" unless the design sheet says it came from the designer's
// renders. "Plain" (the kit's switch) and "True colours" hide it, like the kit.
import * as THREE from 'three';
import type { FurnitureItem, Layout, RoomTag, EdgeFrame, Vec2 } from '../types';
import { computeEdgeFrames } from '../core/layout-geom';
import type { Look } from './look';
import type { Tier } from './types';
import { furnitureKit } from './furniture-materials';
import type { FurnitureKit } from './furniture-materials';
import { genQuality } from './gen';
import type { GenEnv, Roles } from './gen';
import { buildBench } from './gen/seating';
import type { BenchParams } from './gen/seating';
import { BENCH_DEFAULTS } from './gen/seating';
import {
  CURTAIN_DEFAULTS, PANELLING_DEFAULTS, RUG_DEFAULTS, SLAT_WALL_DEFAULTS, buildAc, buildBowlLights, buildCeilingBand, buildCurtain, buildDownlights,
  buildPanelling, buildRug, buildSlatWall,
} from './gen/decor';
import { getStyle, matOf, onStyleChange, roomFinishIds, sheetInForce, trimColours } from './style';
import type { StyleState } from './style';
import type { SheetFixture } from './design-sheet';
import { finishDef } from './finishes';
import {
  AC_CLASSES, AC_D_PER_W, AC_DEFAULT_W, AC_H_PER_W, KIND_NAMES, dimLimits, overlayFor, resolveCeilingMove, resolveWallMove, wallObb,
} from './fittings';
import type { FittingKind, FittingRecord, FittingRegistry, FittingsOverlay, WallShape } from './fittings';
import { wallInfosOf } from './kit/fittings';
import { roomCentre } from './kit/rules';

export const DESIGN_NOTE = 'Curtains, rugs, wall panelling and lights are typical styling, not from your drawing.';
export const DESIGN_NOTE_RENDERS = "Curtains, rugs, panelling and lights follow the designer's renders, they are not on your drawing.";

// ---------------------------------------------------------------- fixtures: where things go

const out2 = (f: EdgeFrame): Vec2 => ({ x: -f.out.x, z: -f.out.z });

/** puts a group built in a wall frame on the wall: x along the edge from `u`, y up, z out of the wall into the room */
export function placeOnWall(g: THREE.Object3D, f: EdgeFrame, u: number, standoff = 0): void {
  g.rotation.y = Math.atan2(-f.dir.z, f.dir.x);
  const into = out2(f);
  g.position.set(f.a.x + f.dir.x * u + into.x * standoff, 0, f.a.z + f.dir.z * u + into.z * standoff);
  g.updateMatrixWorld(true);
}

function polygonBounds(room: RoomTag): { x0: number; x1: number; z0: number; z1: number } {
  const xs = room.polygon.map((p) => p.x), zs = room.polygon.map((p) => p.z);
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}

/** The decor of rooms with no design sheet: a rug under each bed and curtains on each large window of a bedroom or living room, when the pack asks. */
export function autoFixtures(layout: Layout, items: FurnitureItem[], st: StyleState = getStyle()): SheetFixture[] {
  const out: SheetFixture[] = [];
  if (st.pack.classic) return out;
  const frames = computeEdgeFrames(layout);
  const rooms = new Map(layout.rooms.map((r) => [r.id, r]));
  if (st.pack.decor.curtains) {
    for (const o of layout.openings) {
      const room = rooms.get(o.roomId);
      if (o.type !== 'window' || !room || room.partial || (room.roomType !== 'bedroom' && room.roomType !== 'living') || o.widthM < 0.9 || (o.sillM ?? 0.9) < 0.3) continue; // a floor-length opening is a way out, not a window: no curtain across its walkway
      const f = frames.find((x) => x.roomId === o.roomId && x.edge === o.edge);
      if (!f) continue;
      const u0 = Math.max(0.05, o.centreM - o.widthM / 2 - 0.25), u1 = Math.min(f.length - 0.05, o.centreM + o.widthM / 2 + 0.25);
      // a pack with a sheer of its own hangs sheers alone (a light veil, no heavy drape): calm, and the window still reads as a window
      if (u1 - u0 > 0.8) out.push(st.pack.roles.curtainSheer ? { kind: 'curtain', roomId: o.roomId, edge: o.edge, u0, u1, sheer: true, drape: 'none' } : { kind: 'curtain', roomId: o.roomId, edge: o.edge, u0, u1 });
    }
  }
  if (st.pack.decor.rug) {
    for (const it of items) {
      if (it.kind !== 'bed') continue;
      const room = layout.rooms.find((r) => !r.partial && pointInPolygon({ x: it.box.cx, z: it.box.cz }, r.polygon));
      if (!room || (room.roomType !== 'bedroom' && room.roomType !== 'living')) continue;
      out.push({ kind: 'rug', roomId: room.id, aroundItem: it.id });
    }
  }
  return out;
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** the fixtures in force: the designer's sheet while its look is on, else the pack's typical ones (automatic) */
export function activeFixtures(layout: Layout, items: FurnitureItem[], st: StyleState = getStyle()): SheetFixture[] {
  const sheet = sheetInForce(st);
  if (!sheet) return autoFixtures(layout, items, st);
  // a TYPICAL sheet (the brochure flats, the sample homes) names the specification only: the pack's usual curtains and rugs still dress the rooms it does not
  // dress itself. A designer's or broker's sheet is the whole word.
  if (sheet.source !== 'typical') return sheet.fixtures;
  const has = (kind: string, roomId: string, around?: string): boolean => sheet.fixtures.some((f) => f.kind === kind && f.roomId === roomId && (around === undefined || ('aroundItem' in f && f.aroundItem === around)));
  const extra = autoFixtures(layout, items, st).filter((f) => !(f.kind === 'curtain' ? has('curtain', f.roomId) : f.kind === 'rug' ? has('rug', f.roomId, 'aroundItem' in f ? f.aroundItem : undefined) : true));
  return [...sheet.fixtures, ...extra];
}

/**
 * Where the lived-in rug may still lie under a style (SPEC 16.15.2). A style dresses rooms with its own rugs (around the beds, or the sheet's);
 * a living room it leaves bare keeps the lived-in rug in front of the sofa, so the seating does not float on a bare floor. None at all when the
 * pack has no rugs, or when a designer's or broker's sheet is in force (that sheet is the whole word). The Classic look keeps every rug.
 */
export function livedInRugRooms(layout: Layout, items: FurnitureItem[], st: StyleState = getStyle()): (roomId: string) => boolean {
  if (st.pack.classic) return () => true;
  const sheet = sheetInForce(st);
  if (!st.pack.decor.rug || (sheet && sheet.source !== 'typical')) return () => false;
  const styled = new Set(activeFixtures(layout, items, st).filter((f) => f.kind === 'rug').map((f) => f.roomId));
  return (roomId) => !styled.has(roomId);
}

/** the roles every decor piece reads: the pack's, overridden by the sheet's `decor` roles when it has them (a sheet item named `decor`) */
function decorRoles(st: StyleState): Roles {
  const roles: Roles = {};
  const merge = (ids: Record<string, string>): void => { for (const [k, id] of Object.entries(ids)) { const m = matOf(id); if (m) roles[k] = m; } };
  merge(st.pack.roles);
  const sheet = sheetInForce(st);
  if (sheet?.items.decor?.roles) merge(sheet.items.decor.roles);
  return roles;
}

// ---------------------------------------------------------------- building the group

export interface BuiltDecor { group: THREE.Group; triangles: number; counts: Record<string, number>; /** what was built, as tappable, movable fittings (removed ones too, flagged) */ records: FittingRecord[] }

function tag(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.raycast = () => {};
    m.userData.decor = true;
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  });
  return tris;
}

/** Nothing but the overlay changes what is built: `overlay` is the viewer's removed, moved and resized fittings (My layout). */
export interface DecorExtra { overlay?: FittingsOverlay | null }

const nearly = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
const MIN_CURTAIN_W = 0.6;

/** Builds the decor group for a layout, its furniture and a style. No scene needed (the GLB export and the tests call this). */
export function buildDecorGroup(layout: Layout, items: FurnitureItem[], tier: Tier, st: StyleState = getStyle(), kit: FurnitureKit = furnitureKit, extra: DecorExtra = {}): BuiltDecor {
  const group = new THREE.Group();
  group.name = 'design-decor';
  group.userData.decor = true;
  const counts: Record<string, number> = {};
  const records: FittingRecord[] = [];
  if (st.pack.classic) return { group, triangles: 0, counts, records };
  const env: GenEnv = { kit, q: genQuality(tier) };
  const roles = decorRoles(st);
  const frames = computeEdgeFrames(layout);
  const infos = wallInfosOf(layout);
  const frameOf = (roomId: string, edge: number): EdgeFrame | undefined => frames.find((f) => f.roomId === roomId && f.edge === edge);
  const rooms = new Map(layout.rooms.map((r) => [r.id, r]));
  const H = layout.wallHeightM;
  const overlay = extra.overlay ?? null;
  const provenance: FittingRecord['provenance'] = sheetInForce(st)?.source === 'designer-renders' ? 'renders' : 'typical';
  const add = (kind: string, g: THREE.Group): void => { group.add(g); counts[kind] = (counts[kind] ?? 0) + 1; };
  // stable ids: `<kind>:<room>:<n>` with n counting that kind in that room in the order the fixtures list them
  const seen = new Map<string, number>();
  const idFor = (kind: string, roomId: string, edge?: number): string => {
    const k = `${kind}:${roomId}${edge === undefined ? '' : `:${edge}`}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return `${k}:${n}`;
  };
  const base = (id: string, kind: FittingKind, roomId: string, over: Partial<FittingRecord>): FittingRecord => ({
    id, kind, name: KIND_NAMES[kind], mount: 'wall', roomId, removed: false, moved: false, sized: false,
    centre: { x: 0, y: 0, z: 0 }, half: { x: 0.1, y: 0.1, z: 0.1 }, yawDeg: 0, size: { w: 0, d: 0, h: 0 }, heightM: 0, provenance,
    movable: false, resize: null, defaultSize: null, currentSize: null, ...over,
  });
  /** which wall a wall fitting stands on, after a viewer's move (it can jump to another wall of its room) */
  const onWall = (id: string, roomId: string, edge: number, u: number, y: number, shape: WallShape): { frame: EdgeFrame; edge: number; u: number; y: number } | null => {
    const mv = overlayFor(overlay, id).move;
    if (mv?.m === 'w') {
      const t = resolveWallMove(infos, roomId, mv, shape);
      if (t) return { frame: t.frame, edge: t.edge, u: t.u, y: t.y };
    }
    const f = frameOf(roomId, edge);
    return f ? { frame: f, edge, u, y } : null;
  };
  const wallRec = (id: string, kind: FittingKind, roomId: string, t: { frame: EdgeFrame; edge: number; u: number; y: number }, drawn: { edge: number; u: number; y: number }, w: number, y0: number, y1: number, d: number, shape: WallShape, over: Partial<FittingRecord> = {}): FittingRecord =>
    base(id, kind, roomId, {
      ...wallObb(t.frame, t.u, y0, y1, w, d), size: { w, d, h: y1 - y0 }, heightM: y0, wall: { edge: t.edge, u: t.u, y: t.y, length: t.frame.length },
      moved: t.edge !== drawn.edge || !nearly(t.u, drawn.u) || !nearly(t.y, drawn.y), movable: true, moveRule: { mount: 'wall', shape }, ...over,
    });

  for (const fx of activeFixtures(layout, items, st)) {
    const room = rooms.get(fx.roomId);
    if (!room || room.partial) continue;
    switch (fx.kind) {
      case 'curtain': {
        const f = frameOf(fx.roomId, fx.edge);
        if (!f) break;
        const id = idFor('curtain', fx.roomId, fx.edge);
        const ov = overlayFor(overlay, id);
        const u0 = Math.max(0, fx.u0), u1 = Math.min(f.length, fx.u1);
        const drawnW = u1 - u0, drawnU = (u0 + u1) / 2;
        const trackY = fx.trackYM ?? H - 0.05;
        const yMid = (0.02 + trackY) / 2;
        const lim = dimLimits('curtain', { w: drawnW, d: 0, h: 0 })[0];
        let w = ov.size ? Math.min(lim.max, Math.max(lim.min, ov.size[0])) : drawnW;
        const shape = (ww: number): WallShape => ({ w: ww, yRange: () => [0.02, trackY + 0.02], yMin: yMid, yMax: yMid, overWindows: true });
        let t = onWall(id, fx.roomId, fx.edge, drawnU, yMid, shape(w));
        // a width the wall cannot hold is the widest it can
        if (t && !resolveWallMove(infos, fx.roomId, { edge: t.edge, u: t.u, y: yMid }, shape(w))) { w = drawnW; t = onWall(id, fx.roomId, fx.edge, drawnU, yMid, shape(w)); }
        if (!t) break;
        const at = resolveWallMove(infos, fx.roomId, { edge: t.edge, u: t.u, y: yMid }, shape(w));
        if (at) t = { frame: at.frame, edge: at.edge, u: at.u, y: at.y };
        const rec = wallRec(id, 'curtain', fx.roomId, t, { edge: fx.edge, u: drawnU, y: yMid }, w, 0.02, trackY + 0.02, 0.15, shape(w), {
          removed: ov.removed, sized: !nearly(w, drawnW), resize: { kind: 'dims', dims: [{ ...lim, max: Math.min(lim.max, Math.max(lim.min, t.frame.length - 0.2)) }] }, defaultSize: [drawnW], currentSize: [w],
        });
        records.push(rec);
        if (ov.removed) break;
        const g = buildCurtain(env, { ...CURTAIN_DEFAULTS, widthM: w, heightM: H - 0.04, trackYM: trackY, sheer: fx.sheer ?? true, drape: fx.drape ?? 'sides' }, roles);
        placeOnWall(g, t.frame, t.u - w / 2, 0.012);
        nearFade(g);
        add('curtain', g);
        break;
      }
      case 'rug': {
        const id = idFor('rug', fx.roomId);
        const ov = overlayFor(overlay, id);
        let cx = fx.x ?? 0, cz = fx.z ?? 0, w = fx.w ?? RUG_DEFAULTS.widthM, d = fx.d ?? RUG_DEFAULTS.depthM, yaw = ((fx.yawDeg ?? 0) * Math.PI) / 180;
        const it = fx.aroundItem ? items.find((i) => i.id === fx.aroundItem) : undefined;
        if (it) {
          // the item's footprint grown by a margin at its foot and sides; its head (the back, local -z) stays put
          const mh = fx.margin?.head ?? 0.05, mf = fx.margin?.foot ?? 0.65, ms = fx.margin?.side ?? 0.5;
          const ww = it.box.w + 2 * ms, dd = it.box.d + mf + mh;
          const y = (it.box.yawDeg * Math.PI) / 180;
          const lz = (mf - mh) / 2;
          cx = it.box.cx + Math.sin(y) * lz; cz = it.box.cz + Math.cos(y) * lz; w = ww; d = dd; yaw = y;
        } else if (fx.aroundItem) break;
        const drawn = { w, d, cx, cz, yaw };
        const [lw, ld] = dimLimits('rug', { w, d, h: 0 });
        if (ov.size && ov.size.length >= 2) { w = Math.min(Math.max(lw.max, drawn.w), Math.max(Math.min(lw.min, drawn.w), ov.size[0])); d = Math.min(Math.max(ld.max, drawn.d), Math.max(Math.min(ld.min, drawn.d), ov.size[1])); }
        if (ov.move?.m === 'f') { cx = ov.move.x; cz = ov.move.z; if (ov.move.yawDeg !== undefined) yaw = (ov.move.yawDeg * Math.PI) / 180; }
        records.push(base(id, 'rug', fx.roomId, {
          mount: 'floor', removed: ov.removed, moved: ov.move?.m === 'f', sized: !nearly(w, drawn.w) || !nearly(d, drawn.d),
          centre: { x: cx, y: 0.0125, z: cz }, half: { x: w / 2, y: 0.0125, z: d / 2 }, yawDeg: (yaw * 180) / Math.PI,
          size: { w, d, h: RUG_DEFAULTS.pileM }, heightM: 0, movable: true, moveRule: { mount: 'floor', w, d, needFree: false, doorKeepM: 0.05, turn: true },
          resize: { kind: 'dims', dims: [lw, ld] }, defaultSize: [drawn.w, drawn.d], currentSize: [w, d],
        }));
        if (ov.removed) break;
        const g = buildRug(env, { ...RUG_DEFAULTS, widthM: w, depthM: d }, roles);
        g.position.set(cx, 0.001, cz);
        g.rotation.y = yaw;
        g.updateMatrixWorld(true);
        add('rug', g);
        break;
      }
      case 'ac': {
        const f = frameOf(fx.roomId, fx.edge);
        if (!f) break;
        const id = idFor('ac', fx.roomId);
        const ov = overlayFor(overlay, id);
        const sizeOf = (w: number) => ({ w, h: w * AC_H_PER_W, d: w * AC_D_PER_W });
        const shapeOf = (w: number): WallShape => { const s = sizeOf(w); return { w, yRange: (y) => [y - s.h / 2, y + s.h / 2], yMin: 1.7 + s.h / 2, yMax: Math.max(1.8, H - s.h / 2 - 0.08) }; };
        let w = ov.size && ov.size[0] >= 0.6 && ov.size[0] <= 1.5 ? ov.size[0] : AC_DEFAULT_W;
        let t = onWall(id, fx.roomId, fx.edge, fx.u, fx.y, shapeOf(w));
        if (!t) break;
        // a unit that no longer fits where it hangs slides to where it does; if the wall cannot take it at all it stays as drawn
        const fit = resolveWallMove(infos, fx.roomId, { edge: t.edge, u: t.u, y: t.y }, shapeOf(w));
        if (fit) t = { frame: fit.frame, edge: fit.edge, u: fit.u, y: fit.y };
        else { w = AC_DEFAULT_W; t = { frame: f, edge: fx.edge, u: fx.u, y: fx.y }; }
        const sz = sizeOf(w);
        const options = AC_CLASSES.filter((o) => !!resolveWallMove(infos, fx.roomId, { edge: t!.edge, u: t!.u, y: t!.y }, shapeOf(o.value)));
        records.push(wallRec(id, 'ac', fx.roomId, t, { edge: fx.edge, u: fx.u, y: fx.y }, sz.w, t.y - sz.h / 2, t.y + sz.h / 2, sz.d, shapeOf(sz.w), {
          removed: ov.removed, sized: !nearly(w, AC_DEFAULT_W), resize: options.length ? { kind: 'classes', label: 'Width', options } : null, defaultSize: [AC_DEFAULT_W], currentSize: [w],
        }));
        if (ov.removed) break;
        const g = buildAc(env, roles);
        placeOnWall(g, t.frame, t.u, 0);
        g.scale.setScalar(w / AC_DEFAULT_W);
        g.position.y = t.y;
        g.updateMatrixWorld(true);
        add('ac', g);
        break;
      }
      case 'downlights': {
        const ids = fx.points.map((_, i) => `downlight:${fx.roomId}:${(seen.get(`downlight:${fx.roomId}`) ?? 0)}:${i}`);
        seen.set(`downlight:${fx.roomId}`, (seen.get(`downlight:${fx.roomId}`) ?? 0) + 1);
        const centre = roomCentre(room);
        const pts: [number, number][] = [];
        fx.points.forEach((p, i) => {
          const ov = overlayFor(overlay, ids[i]);
          let at = { x: p[0], z: p[1] };
          if (ov.move?.m === 'c') { const t = resolveCeilingMove(room, { x: ov.move.x, z: ov.move.z }, 0.15, centre); if (t) at = t; }
          records.push(base(ids[i], 'downlight', fx.roomId, {
            mount: 'ceiling', removed: ov.removed, moved: !nearly(at.x, p[0]) || !nearly(at.z, p[1]), centre: { x: at.x, y: H - 0.01, z: at.z }, half: { x: 0.056, y: 0.03, z: 0.056 },
            size: { w: 0.112, d: 0.112, h: 0.01, round: true }, heightM: H - 0.01, movable: true, moveRule: { mount: 'ceiling', margin: 0.15 },
          }));
          if (!ov.removed) pts.push([at.x, at.z]);
        });
        if (pts.length) add('downlights', buildDownlights(env, pts, H, roles));
        break;
      }
      case 'bowl-lights': {
        const f = frameOf(fx.roomId, fx.edge);
        if (!f) break;
        const n = seen.get(`bowl:${fx.roomId}`) ?? 0;
        seen.set(`bowl:${fx.roomId}`, n + 1);
        const shape: WallShape = { w: 0.2, yRange: (y) => [y - 0.1, y + 0.1], yMin: 0.9, yMax: Math.max(1, H - 0.4) };
        // one group per light so each sits at its own u
        fx.us.forEach((u, i) => {
          const id = `wall-light:${fx.roomId}:${n}:${i}`;
          const ov = overlayFor(overlay, id);
          const t = onWall(id, fx.roomId, fx.edge, u, fx.y, shape);
          if (!t) return;
          records.push(wallRec(id, 'wall-light', fx.roomId, t, { edge: fx.edge, u, y: fx.y }, 0.2, t.y - 0.1, t.y + 0.1, 0.09, shape, { removed: ov.removed }));
          if (ov.removed) return;
          const gi = buildBowlLights(env, [0], t.y, roles);
          placeOnWall(gi, t.frame, t.u, 0);
          add('bowl-lights', gi);
        });
        break;
      }
      case 'panelling': {
        const f = frameOf(fx.roomId, fx.edge);
        if (!f) break;
        const id = idFor('panelling', fx.roomId, fx.edge);
        const ov = overlayFor(overlay, id);
        const u0 = Math.max(0, fx.u0), u1 = Math.min(f.length, fx.u1);
        const y0 = fx.y0M ?? 0.1, y1 = fx.y1M ?? H - 0.15;
        records.push(wallRec(id, 'panelling', fx.roomId, { frame: f, edge: fx.edge, u: (u0 + u1) / 2, y: (y0 + y1) / 2 }, { edge: fx.edge, u: (u0 + u1) / 2, y: (y0 + y1) / 2 }, u1 - u0, y0, y1, 0.03, { w: u1 - u0, yRange: () => [y0, y1], yMin: 0, yMax: 0 }, { removed: ov.removed, movable: false, moveRule: undefined }));
        if (ov.removed) break;
        const g = buildPanelling(env, { ...PANELLING_DEFAULTS, widthM: u1 - u0, y0M: y0, y1M: y1, pitchM: fx.pitchM ?? PANELLING_DEFAULTS.pitchM, tierM: fx.tierM ?? 0 }, roles);
        placeOnWall(g, f, u0, 0.001);
        add('panelling', g);
        break;
      }
      case 'slat-wall': {
        const f = frameOf(fx.roomId, fx.edge);
        if (!f) break;
        const id = idFor('slat-wall', fx.roomId, fx.edge);
        const ov = overlayFor(overlay, id);
        const u0 = Math.max(0, fx.u0), u1 = Math.min(f.length, fx.u1);
        const y0 = fx.y0M ?? 0, y1 = fx.y1M ?? H - 0.02;
        records.push(wallRec(id, 'slat-wall', fx.roomId, { frame: f, edge: fx.edge, u: (u0 + u1) / 2, y: (y0 + y1) / 2 }, { edge: fx.edge, u: (u0 + u1) / 2, y: (y0 + y1) / 2 }, u1 - u0, y0, y1, 0.04, { w: u1 - u0, yRange: () => [y0, y1], yMin: 0, yMax: 0 }, { removed: ov.removed, movable: false, moveRule: undefined }));
        if (ov.removed) break;
        const g = buildSlatWall(env, { ...SLAT_WALL_DEFAULTS, widthM: u1 - u0, y0M: y0, y1M: y1, pitchM: fx.pitchM ?? SLAT_WALL_DEFAULTS.pitchM }, roles);
        placeOnWall(g, f, u0, 0.001);
        add('slat-wall', g);
        break;
      }
      case 'ceiling-band': {
        const id = idFor('ceiling-band', fx.roomId);
        const ov = overlayFor(overlay, id);
        const drop = fx.dropM ?? 0.05;
        records.push(base(id, 'ceiling-band', fx.roomId, {
          mount: 'ceiling', removed: ov.removed, centre: { x: (fx.x0 + fx.x1) / 2, y: H - drop / 2, z: (fx.z0 + fx.z1) / 2 }, half: { x: (fx.x1 - fx.x0) / 2, y: Math.max(0.03, drop / 2), z: (fx.z1 - fx.z0) / 2 },
          size: { w: fx.x1 - fx.x0, d: fx.z1 - fx.z0, h: drop }, heightM: H - drop,
        }));
        if (ov.removed) break;
        const g = buildCeilingBand(env, { widthM: fx.x1 - fx.x0, depthM: fx.z1 - fx.z0, dropM: drop }, roles);
        g.position.set(fx.x0, H, fx.z0);
        g.updateMatrixWorld(true);
        add('ceiling-band', g);
        break;
      }
      case 'window-seat': {
        const f = frameOf(fx.roomId, fx.edge);
        if (!f) break;
        const id = idFor('window-seat', fx.roomId, fx.edge);
        const ov = overlayFor(overlay, id);
        const u0 = Math.max(0, fx.u0), u1 = Math.min(f.length, fx.u1);
        const depth = fx.depthM ?? 0.5, height = fx.heightM ?? 0.45;
        const drawnW = u1 - u0, drawnU = (u0 + u1) / 2;
        const lim: import('./fittings').DimSpec = { key: 'w', label: 'Length', min: 0.8, max: Math.min(3.2, f.length - 0.2), step: 0.1 };
        let w = ov.size ? Math.min(lim.max, Math.max(lim.min, ov.size[0])) : drawnW;
        const shape = (ww: number): WallShape => ({ w: ww, yRange: () => [0, height], yMin: height / 2, yMax: height / 2, overWindows: true });
        let t = onWall(id, fx.roomId, fx.edge, drawnU, height / 2, shape(w));
        if (t && !resolveWallMove(infos, fx.roomId, { edge: t.edge, u: t.u, y: height / 2 }, shape(w))) { w = drawnW; t = onWall(id, fx.roomId, fx.edge, drawnU, height / 2, shape(w)); }
        if (!t) break;
        const at = resolveWallMove(infos, fx.roomId, { edge: t.edge, u: t.u, y: height / 2 }, shape(w));
        if (at) t = { frame: at.frame, edge: at.edge, u: at.u, y: at.y };
        records.push(wallRec(id, 'window-seat', fx.roomId, t, { edge: fx.edge, u: drawnU, y: height / 2 }, w, 0, height, depth, shape(w), {
          removed: ov.removed, sized: !nearly(w, drawnW), resize: { kind: 'dims', dims: [{ ...lim, max: Math.max(lim.min, Math.min(lim.max, t.frame.length - 0.2)) }] }, defaultSize: [drawnW], currentSize: [w],
        }));
        if (ov.removed) break;
        const bp: BenchParams = { ...BENCH_DEFAULTS, shape: fx.shape ?? 'curved-end', curveSide: fx.curveSide ?? 'right' };
        // the bench is built in its own item frame (centre at the origin, front +z); the wall frame has z into the room, so only a shift is needed
        const g = buildBench(env, { w, d: depth, h: height, s: height }, bp, roles);
        const holder = new THREE.Group();
        g.position.set(w / 2, 0, depth / 2);
        holder.add(g);
        placeOnWall(holder, t.frame, t.u - w / 2, 0.002);
        add('window-seat', holder);
        break;
      }
      default: break;
    }
  }
  const triangles = tag(group);
  group.updateMatrixWorld(true);
  return { group, triangles, counts, records };
}

// ---------------------------------------------------------------- room finishes (walls, floors)

/** a wet room's glazed wall tile: 300 x 600, to the ceiling (SPEC 16.19) */
const WET_WALL_TILE = { wM: 0.3, hM: 0.6 } as const;

interface RoomOriginals { wallColor?: string; floorColor?: string }
const originals = new WeakMap<RoomTag, RoomOriginals>();

/**
 * Sets each room's wall and floor colour from the style (the sheet's room finishes, else the pack's) and swaps the shell's wall and
 * floor materials to match. Sampled colours win (SPEC 16.2 rule 2): nothing is changed when the layout's finishes were sampled, nor
 * for a room that already carried its own colour. The Classic style restores what the layout had. Returns the rooms it changed.
 */
export function applyRoomFinishes(layout: Layout, shell: THREE.Object3D, look: Look | null, st: StyleState = getStyle()): string[] {
  const changed: string[] = [];
  const sampled = layout.finishes.source === 'sampled';
  const lm = look?.materials();
  const fin = layout.finishes;
  const floorMats = new Map<string, THREE.Material>();
  const floorFor = (room: RoomTag): THREE.Material | null => {
    if (!lm) return null;
    const color = room.floorColor ?? fin.floorColor;
    const key = `${color}|${room.roomType === 'balcony'}`;
    let m = floorMats.get(key);
    if (!m) { m = lm.floor({ color, tile: fin.tile, groutColor: fin.groutColor, balcony: room.roomType === 'balcony' }); floorMats.set(key, m); }
    return m;
  };
  for (const room of layout.rooms) {
    if (room.partial) continue;
    let o = originals.get(room);
    if (!o) { o = { wallColor: room.wallColor, floorColor: room.floorColor }; originals.set(room, o); }
    const ids = sampled ? {} : roomFinishIds(room.id, st, room.roomType);
    const wallId = o.wallColor === undefined ? ids.wall?.[0] : undefined;
    const floorId = o.floorColor === undefined && room.roomType !== 'balcony' ? ids.floor?.[0] : undefined;
    const wantWall = wallId ? finishDef(wallId)?.colour : o.wallColor;
    const wantFloor = floorId ? finishDef(floorId)?.colour : o.floorColor;
    if (room.wallColor === wantWall && room.floorColor === wantFloor) continue;
    room.wallColor = wantWall;
    room.floorColor = wantFloor;
    changed.push(room.id);
    shell.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.roomId !== room.id) return;
      if (c.name === `walls:${room.id}`) {
        const color = room.wallColor ?? fin.wallColor;
        const tiled = !!wallId && finishDef(wallId)?.kind === 'tile';
        mesh.material = lm ? lm.wall(color, tiled ? WET_WALL_TILE : undefined) : new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
      } else if ((c.name.startsWith('floor:') || c.name.startsWith('threshold:'))) {
        const m = floorFor(room);
        if (m && !(mesh.material as THREE.Material).userData?.partialLook) mesh.material = m;
      }
    });
  }
  // ceilings: the pack's ceiling finish (a light warm grey, one step darker than the walls) where nothing was sampled
  if (lm) {
    const ceilId = sampled ? undefined : (layout.rooms.map((r) => roomFinishIds(r.id, st).ceiling?.[0]).find((x) => !!x));
    const want = (ceilId ? finishDef(ceilId)?.colour : undefined) ?? fin.ceilingColor;
    shell.traverse((c) => { if (c.name.startsWith('ceiling:') && (c as THREE.Mesh).isMesh) (c as THREE.Mesh).material = lm.ceiling(want); });
  }
  // door and window frames, architraves: the pack's frame finish where nothing was sampled (a pack that names none leaves the layout's colour)
  const frames = shell.getObjectByName('frames') as THREE.Mesh | undefined;
  if (frames && lm) {
    const trim = trimColours(st);
    const want = !sampled && trim.frame ? trim.frame : fin.frameColor;
    frames.material = lm.frame(want, !sampled && trim.frame ? trim.frameGrain : true);
  }
  return changed;
}

// ---------------------------------------------------------------- mounting

export interface DesignMountOptions {
  scene: THREE.Object3D;
  layout: Layout;
  shell: THREE.Object3D;
  look: Look | null;
  store: { all(): FurnitureItem[]; onChange(cb: () => void): () => void; /** the viewer's removed, moved and resized fittings */ fittings?(): FittingsOverlay };
  /** where the decor reports itself as tappable, movable fittings */
  registry?: FittingRegistry;
  tier: Tier;
  /** called before the room finishes are applied and after (the kit's floors are swapped on the shell: take them off, put them back) */
  beforeRestyle?: () => void;
  afterRestyle?: () => void;
}
export interface DesignMount {
  readonly group: THREE.Group;
  /** the label for the look panel, null when there is no decor in the home */
  note(): string | null;
  stats(): { triangles: number; counts: Record<string, number> };
  /** rebuild for a new tier, or after the style changed */
  rebuild(tier?: Tier): void;
  dispose(): void;
}

/** Cloth hanging at a wall must not fill the screen when the camera backs into it: fragments closer than half a metre are dropped. */
function nearFade(g: THREE.Object3D): void {
  const seen = new Set<THREE.Material>();
  g.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = (shader, renderer) => {
        prev?.call(mat, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  if (length(vViewPosition) < 0.5) discard;');
      };
      mat.customProgramCacheKey = () => 'wt-near-fade';
      mat.needsUpdate = true;
    }
  });
}

export function mountDesign(o: DesignMountOptions): DesignMount {
  let tier = o.tier;
  let current: BuiltDecor = { group: new THREE.Group(), triangles: 0, counts: {}, records: [] };
  const holder = new THREE.Group();
  holder.name = 'design';
  o.scene.add(holder);
  const dispose = (g: THREE.Object3D): void => {
    g.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.dispose();
    });
    g.removeFromParent();
  };
  const build = (): void => {
    dispose(current.group);
    current = buildDecorGroup(o.layout, o.store.all(), tier, getStyle(), undefined, { overlay: o.store.fittings?.() ?? null });
    holder.add(current.group);
    syncVisible();
  };
  const shown = (): boolean => {
    const kitPlain = (globalThis as { __walkthruKit?: { plain: boolean } }).__walkthruKit?.plain ?? false;
    return !kitPlain && !(o.look?.trueColours ?? false) && !((o.look?.materials().shared.plain.value ?? 0) > 0.5);
  };
  function syncVisible(): void { holder.visible = shown(); o.registry?.set('design', holder.visible ? current.records : []); }
  let lastShown = shown();
  const offLook = o.look?.onChange(() => { syncVisible(); });
  // the kit's Plain switch has no event we can hear: look at it on a slow timer
  const timer = typeof setInterval !== 'undefined' ? setInterval(() => { const s = shown(); if (s !== lastShown) { lastShown = s; syncVisible(); } }, 300) : null;
  const restyle = (): void => {
    o.beforeRestyle?.();
    applyRoomFinishes(o.layout, o.shell, o.look);
    o.afterRestyle?.();
    build();
  };
  const offStyle = onStyleChange(restyle);
  // rugs follow the beds: rebuild a moment after furniture changes
  let timeout: ReturnType<typeof setTimeout> | null = null;
  // a viewer's edit of a fitting shows at once; furniture moving under a rug waits a moment (a drag fires many changes)
  let fitKey = JSON.stringify(o.store.fittings?.() ?? null);
  const offStore = o.store.onChange(() => {
    if (timeout) clearTimeout(timeout);
    const key = JSON.stringify(o.store.fittings?.() ?? null);
    if (key !== fitKey) { fitKey = key; timeout = null; build(); return; }
    timeout = setTimeout(() => { timeout = null; build(); }, 250);
  });
  restyle();

  return {
    group: holder,
    note() {
      if (!Object.keys(current.counts).length) return null;
      return sheetInForce()?.source === 'designer-renders' ? DESIGN_NOTE_RENDERS : DESIGN_NOTE;
    },
    stats: () => ({ triangles: Math.round(current.triangles), counts: { ...current.counts } }),
    rebuild(t) { if (t) tier = t; build(); },
    dispose() {
      offLook?.(); offStyle(); offStore();
      if (timer) clearInterval(timer);
      if (timeout) clearTimeout(timeout);
      dispose(current.group);
      holder.removeFromParent();
    },
  };
}
