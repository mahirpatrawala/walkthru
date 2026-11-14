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
import { GEN_QUALITY } from './gen';
import type { GenEnv, Roles } from './gen';
import { buildBench } from './gen/seating';
import type { BenchParams } from './gen/seating';
import { BENCH_DEFAULTS } from './gen/seating';
import {
  CURTAIN_DEFAULTS, PANELLING_DEFAULTS, RUG_DEFAULTS, SLAT_WALL_DEFAULTS, buildAc, buildBowlLights, buildCeilingBand, buildCurtain, buildDownlights,
  buildPanelling, buildRug, buildSlatWall,
} from './gen/decor';
import { getStyle, matOf, onStyleChange, roomFinishIds, sheetInForce } from './style';
import type { StyleState } from './style';
import type { SheetFixture } from './design-sheet';
import { finishDef } from './finishes';

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
      if (o.type !== 'window' || !room || room.partial || (room.roomType !== 'bedroom' && room.roomType !== 'living') || o.widthM < 0.9) continue;
      const f = frames.find((x) => x.roomId === o.roomId && x.edge === o.edge);
      if (!f) continue;
      const u0 = Math.max(0.05, o.centreM - o.widthM / 2 - 0.25), u1 = Math.min(f.length - 0.05, o.centreM + o.widthM / 2 + 0.25);
      if (u1 - u0 > 0.8) out.push({ kind: 'curtain', roomId: o.roomId, edge: o.edge, u0, u1 });
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
  return sheet ? sheet.fixtures : autoFixtures(layout, items, st);
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

export interface BuiltDecor { group: THREE.Group; triangles: number; counts: Record<string, number> }

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

/** Builds the decor group for a layout, its furniture and a style. No scene needed (the GLB export and the tests call this). */
export function buildDecorGroup(layout: Layout, items: FurnitureItem[], tier: Tier, st: StyleState = getStyle(), kit: FurnitureKit = furnitureKit): BuiltDecor {
  const group = new THREE.Group();
  group.name = 'design-decor';
  group.userData.decor = true;
  const counts: Record<string, number> = {};
  if (st.pack.classic) return { group, triangles: 0, counts };
  const env: GenEnv = { kit, q: GEN_QUALITY[tier] };
  const roles = decorRoles(st);
  const frames = computeEdgeFrames(layout);
  const frameOf = (roomId: string, edge: number): EdgeFrame | undefined => frames.find((f) => f.roomId === roomId && f.edge === edge);
  const rooms = new Map(layout.rooms.map((r) => [r.id, r]));
  const H = layout.wallHeightM;
  const add = (kind: string, g: THREE.Group): void => { group.add(g); counts[kind] = (counts[kind] ?? 0) + 1; };

  for (const fx of activeFixtures(layout, items, st)) {
    const room = rooms.get(fx.roomId);
    if (!room || room.partial) continue;
    switch (fx.kind) {
      case 'curtain': {
        const f = frameOf(fx.roomId, fx.edge);
        if (!f) break;
        const u0 = Math.max(0, fx.u0), u1 = Math.min(f.length, fx.u1);
        const g = buildCurtain(env, { ...CURTAIN_DEFAULTS, widthM: u1 - u0, heightM: H - 0.04, trackYM: H - 0.05, sheer: fx.sheer ?? true, drape: fx.drape ?? 'sides', ...(fx.trackYM ? { trackYM: fx.trackYM } : {}) }, roles);
        placeOnWall(g, f, u0, 0.012);
        nearFade(g);
        add('curtain', g);
        break;
      }
      case 'rug': {
        let cx = fx.x ?? 0, cz = fx.z ?? 0, w = fx.w ?? RUG_DEFAULTS.widthM, d = fx.d ?? RUG_DEFAULTS.depthM, yaw = ((fx.yawDeg ?? 0) * Math.PI) / 180;
        const it = fx.aroundItem ? items.find((i) => i.id === fx.aroundItem) : undefined;
        if (it) {
          // the item's footprint grown by a margin at its foot and sides; its head (the back, local -z) stays put
          const mh = fx.margin?.head ?? 0.05, mf = fx.margin?.foot ?? 0.65, ms = fx.margin?.side ?? 0.5;
          const ww = it.box.w + 2 * ms, dd = it.box.d + mf + mh;
          const y = (it.box.yawDeg * Math.PI) / 180;
          const lz = (mf - mh) / 2;
          cx = it.box.cx + Math.sin(y) * lz; cz = it.box.cz + Math.cos(y) * lz; w = ww; d = dd; yaw = y;
        }
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
        const g = buildAc(env, roles);
        placeOnWall(g, f, fx.u, 0);
        g.position.y = fx.y;
        add('ac', g);
        break;
      }
      case 'downlights': {
        const g = buildDownlights(env, fx.points, H, roles);
        add('downlights', g);
        break;
      }
      case 'bowl-lights': {
        const f = frameOf(fx.roomId, fx.edge);
        if (!f) break;
        // one group per light so each sits at its own u
        for (const u of fx.us) {
          const gi = buildBowlLights(env, [0], fx.y, roles);
          placeOnWall(gi, f, u, 0);
          add('bowl-lights', gi);
        }
        break;
      }
      case 'panelling': {
        const f = frameOf(fx.roomId, fx.edge);
        if (!f) break;
        const u0 = Math.max(0, fx.u0), u1 = Math.min(f.length, fx.u1);
        const g = buildPanelling(env, { ...PANELLING_DEFAULTS, widthM: u1 - u0, y0M: fx.y0M ?? 0.1, y1M: fx.y1M ?? H - 0.15, pitchM: fx.pitchM ?? PANELLING_DEFAULTS.pitchM, tierM: fx.tierM ?? 0 }, roles);
        placeOnWall(g, f, u0, 0.001);
        add('panelling', g);
        break;
      }
      case 'slat-wall': {
        const f = frameOf(fx.roomId, fx.edge);
        if (!f) break;
        const u0 = Math.max(0, fx.u0), u1 = Math.min(f.length, fx.u1);
        const g = buildSlatWall(env, { ...SLAT_WALL_DEFAULTS, widthM: u1 - u0, y0M: fx.y0M ?? 0, y1M: fx.y1M ?? H - 0.02, pitchM: fx.pitchM ?? SLAT_WALL_DEFAULTS.pitchM }, roles);
        placeOnWall(g, f, u0, 0.001);
        add('slat-wall', g);
        break;
      }
      case 'ceiling-band': {
        const g = buildCeilingBand(env, { widthM: fx.x1 - fx.x0, depthM: fx.z1 - fx.z0, dropM: fx.dropM ?? 0.05 }, roles);
        g.position.set(fx.x0, H, fx.z0);
        g.updateMatrixWorld(true);
        add('ceiling-band', g);
        break;
      }
      case 'window-seat': {
        const f = frameOf(fx.roomId, fx.edge);
        if (!f) break;
        const u0 = Math.max(0, fx.u0), u1 = Math.min(f.length, fx.u1);
        const depth = fx.depthM ?? 0.5, height = fx.heightM ?? 0.45;
        const bp: BenchParams = { ...BENCH_DEFAULTS, shape: fx.shape ?? 'curved-end', curveSide: fx.curveSide ?? 'right' };
        // the bench is built in its own item frame (centre at the origin, front +z); the wall frame has z into the room, so only a shift is needed
        const g = buildBench(env, { w: u1 - u0, d: depth, h: height, s: height }, bp, roles);
        const holder = new THREE.Group();
        g.position.set((u1 - u0) / 2, 0, depth / 2);
        holder.add(g);
        placeOnWall(holder, f, u0, 0.002);
        add('window-seat', holder);
        break;
      }
      default: break;
    }
  }
  const triangles = tag(group);
  group.updateMatrixWorld(true);
  return { group, triangles, counts };
}

// ---------------------------------------------------------------- room finishes (walls, floors)

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
    const ids = sampled ? {} : roomFinishIds(room.id, st);
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
        mesh.material = lm ? lm.wall(color) : new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
      } else if ((c.name.startsWith('floor:') || c.name.startsWith('threshold:'))) {
        const m = floorFor(room);
        if (m && !(mesh.material as THREE.Material).userData?.partialLook) mesh.material = m;
      }
    });
  }
  return changed;
}

// ---------------------------------------------------------------- mounting

export interface DesignMountOptions {
  scene: THREE.Object3D;
  layout: Layout;
  shell: THREE.Object3D;
  look: Look | null;
  store: { all(): FurnitureItem[]; onChange(cb: () => void): () => void };
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
  let current: BuiltDecor = { group: new THREE.Group(), triangles: 0, counts: {} };
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
    current = buildDecorGroup(o.layout, o.store.all(), tier, getStyle());
    holder.add(current.group);
    syncVisible();
  };
  const shown = (): boolean => {
    const kitPlain = (globalThis as { __walkthruKit?: { plain: boolean } }).__walkthruKit?.plain ?? false;
    return !kitPlain && !(o.look?.trueColours ?? false) && !((o.look?.materials().shared.plain.value ?? 0) > 0.5);
  };
  function syncVisible(): void { holder.visible = shown(); }
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
  const offStore = o.store.onChange(() => { if (timeout) clearTimeout(timeout); timeout = setTimeout(() => { timeout = null; build(); }, 250); });
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
