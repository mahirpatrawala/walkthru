// Owned by C3. Contract types from C0 (SPEC 7.1); C3 may add to this file but must keep these exactly.
import * as THREE from 'three';
import type { Box, CheckCard, FurnitureItem, Grid, PropertyFile, Vec2, Vec3 } from '../types';
import type { Viewer } from '../engine/viewer';
import type { Character } from '../engine/character';
import type { Input, PointerEvt } from '../engine/controls';
import type { FollowCamera } from '../engine/camera';
import { unmeasuredRoomsNear } from './store';
import type { UnverifiedRooms } from './store';
import type { FittingsApi } from './fittings-api';

export type BuyerModeId = 'walk' | 'measure' | 'furnish' | 'pose';
export interface BuyerMode { id: BuyerModeId; enter(): void; exit(): void; update(dt: number): void }
export interface FurnitureStore {
  all(): FurnitureItem[];
  add(item: FurnitureItem): void;                 // virtual only
  update(id: string, box: Box): void;
  remove(id: string): void;
  clearBuyerItems(): void;
  mesh(id: string): THREE.Group | undefined;
  onChange(cb: () => void): () => void;
}
export interface Hud {
  setPrompt(text: string | null, onActivate?: () => void): void;
  showCard(card: CheckCard): void; hideCard(): void;
  setRoomChip(text: string | null): void;
  setModeBar(text: string | null, onClose?: () => void): void;
  toast(text: string): void;
  /** slot for a mode's own UI (the furnish tray) */
  mount(el: HTMLElement, slot: 'bottom'): () => void;
}
export interface OverlayHandle { remove(): void }
export interface Overlays {
  // SPEC-GAP: 7.1 gives `clear(tag?)` but no way to tag an overlay when it is created. Both creators take an optional
  // trailing `tag` (default 'default'), so a 3-argument call still matches the spec. `clear()` removes everything.
  outlineBox(box: Box, y: number, color: string, tag?: string): OverlayHandle;
  line(a: Vec3, b: Vec3, label: string, color: string, tag?: string): OverlayHandle;
  clear(tag?: string): void;
}
export interface BuyerContext {
  viewer: Viewer; property: PropertyFile; character: Character; input: Input; camera: FollowCamera;
  hud: Hud; overlays: Overlays; furniture: FurnitureStore;
  /** layout + all furniture */ grid(): Grid;
  /** layout + all furniture except the given ids */ gridWithout(ids: string[]): Grid;
  heightM(): number;
  setMode(id: BuyerModeId): void; mode(): BuyerModeId;
  /** ray from a pointer event against shell + furniture meshes */
  raycast(e: PointerEvt): { point: Vec3; object: THREE.Object3D } | null;
  /** ray against the floor plane y = 0 */
  raycastFloor(e: PointerEvt): Vec2 | null;
  /** the fittings (AC, fan, curtains, plants, the drawing's chairs ...): tappable, movable, removable. Absent in a bare context (tests). */
  fittings?: FittingsApi;
  /**
   * The one hit-test of a tap, for furniture and fittings alike: the nearest thing under the pointer. A fitting is hit by an oriented box (small things get a
   * generous reach, more on a phone), furniture by its mesh; a wall or floor in front of either hides it. Nothing under the pointer: null.
   */
  pickAt?(e: PointerEvt): { kind: 'item' | 'fitting' | 'person'; id: string; dist: number } | null;
  /** ray against the walls and floor only (no furniture): where a wall fitting would go */
  raycastWalls?(e: PointerEvt): { x: number; y: number; z: number } | null;
  /** ray against the ceiling plane of the home */
  raycastCeiling?(e: PointerEvt): Vec2 | null;
  /** the unit direction of the pointer's ray in the floor plan, and the ray itself */
  rayOf?(e: PointerEvt): { origin: Vec3; dir: Vec3 };
  /** labels of the rooms near these floor points whose size is not measured on the drawing (empty for most homes) */
  notMeasuredNear?(pts: Vec2[]): string[];
}

// ---------------------------------------------------------------- C3 additions (everything above is the SPEC 7.1 contract)

/** Modes are registered eagerly or lazily (the furnish mode is built on first use, because C4 may not exist yet). */
export class ModeManager {
  private readonly modes = new Map<BuyerModeId, BuyerMode>();
  private readonly lazy = new Map<BuyerModeId, () => BuyerMode>();
  private current: BuyerModeId = 'walk';
  private readonly listeners = new Set<(id: BuyerModeId, prev: BuyerModeId) => void>();
  /** called with a readable message when a lazy mode cannot be built */
  onError: (id: BuyerModeId, err: unknown) => void = () => {};

  register(mode: BuyerMode): void {
    this.modes.set(mode.id, mode);
  }
  registerLazy(id: BuyerModeId, factory: () => BuyerMode): void {
    this.lazy.set(id, factory);
  }
  get id(): BuyerModeId {
    return this.current;
  }
  onChange(cb: (id: BuyerModeId, prev: BuyerModeId) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
  active(): BuyerMode | undefined {
    return this.modes.get(this.current);
  }
  /** Switches mode: exit the old, enter the new. Returns false (and stays put) when the mode cannot be built. */
  set(id: BuyerModeId): boolean {
    if (id === this.current) return true;
    let next = this.modes.get(id);
    if (!next) {
      const make = this.lazy.get(id);
      if (!make) { this.onError(id, new Error(`no mode "${id}" is registered`)); return false; }
      try {
        next = make();
        this.modes.set(id, next);
      } catch (err) {
        this.lazy.delete(id);
        this.onError(id, err);
        return false;
      }
    }
    const prev = this.current;
    try { this.modes.get(prev)?.exit(); } catch (err) { console.error(`[walkthru] mode "${prev}" exit threw`, err); }
    this.current = id;
    try {
      next.enter();
    } catch (err) {
      console.error(`[walkthru] mode "${id}" enter threw`, err);
      this.onError(id, err);
      try { next.exit(); } catch { /* ignore */ }
      this.current = 'walk';
      try { this.modes.get('walk')?.enter(); } catch { /* ignore */ }
    }
    for (const cb of [...this.listeners]) {
      try { cb(this.current, prev); } catch (err) { console.error('[walkthru] mode listener threw', err); }
    }
    return true;
  }
  update(dt: number): void {
    try { this.modes.get(this.current)?.update(dt); } catch (err) { console.error(`[walkthru] mode "${this.current}" update threw`, err); }
  }
}

export interface ContextDeps {
  viewer: Viewer; property: PropertyFile; character: Character; input: Input; camera: FollowCamera;
  hud: Hud; overlays: Overlays;
  furniture: FurnitureStore & { grid(): Grid; gridWithout(ids: string[]): Grid };
  /** shell group (raycast target) */
  shell: THREE.Object3D;
  /** parent of the furniture meshes (raycast target) */
  furnitureRoot: THREE.Object3D;
  modes: ModeManager;
  /** rooms whose size was not measured (drawing import), id -> reason; omitted when every room is measured */
  unverifiedRooms?: UnverifiedRooms;
  /** more things a ray may hit besides the shell and the furniture: the people a buyer added, so the measure tool can measure against them and a tap can pick them */
  extraTargets?: () => THREE.Object3D[];
  fittings?: FittingsApi;
}

/** Builds the BuyerContext handed to every mode (SPEC 7.1). */
export function createBuyerContext(d: ContextDeps): BuyerContext {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const touch = ((): boolean => { try { return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0; } catch { return false; } })();
  const itemIdOf = (o: THREE.Object3D | null): string | null => {
    while (o) {
      const id = o.userData?.itemId ?? o.userData?.openableFor;
      if (typeof id === 'string') return id;
      o = o.parent;
    }
    return null;
  };

  const personIdOf = (o: THREE.Object3D | null): string | null => {
    while (o) {
      const id = o.userData?.personId;
      if (typeof id === 'string') return id;
      o = o.parent;
    }
    return null;
  };

  const setRay = (e: PointerEvt): void => {
    d.viewer.camera.updateMatrixWorld(true);
    ndc.set(e.ndcX, e.ndcY);
    raycaster.setFromCamera(ndc, d.viewer.camera);
  };

  return {
    viewer: d.viewer, property: d.property, character: d.character, input: d.input, camera: d.camera,
    hud: d.hud, overlays: d.overlays, furniture: d.furniture,
    grid: () => d.furniture.grid(),
    gridWithout: (ids) => d.furniture.gridWithout(ids),
    heightM: () => d.character.heightM,
    notMeasuredNear: (pts) => (d.unverifiedRooms ? unmeasuredRoomsNear(d.property.layout, d.unverifiedRooms, pts) : []),
    setMode: (id) => { d.modes.set(id); },
    mode: () => d.modes.id,
    raycast(e) {
      setRay(e);
      const hits = raycaster.intersectObjects([d.shell, d.furnitureRoot, ...(d.extraTargets?.() ?? [])], true);
      const h = hits[0];
      if (!h) return null;
      return { point: { x: h.point.x, y: h.point.y, z: h.point.z }, object: h.object };
    },
    raycastFloor(e) {
      setRay(e);
      const p = raycaster.ray.intersectPlane(floor, hit);
      return p ? { x: p.x, z: p.z } : null;
    },
    fittings: d.fittings,
    pickAt(e) {
      setRay(e);
      const hits = raycaster.intersectObjects([d.shell, d.furnitureRoot], true);
      const first = hits[0];
      const itemId = first ? itemIdOf(first.object) : null;
      const blocker = first ? first.distance : Infinity;
      const fit = d.fittings?.pick({ origin: { x: raycaster.ray.origin.x, y: raycaster.ray.origin.y, z: raycaster.ray.origin.z }, dir: { x: raycaster.ray.direction.x, y: raycaster.ray.direction.y, z: raycaster.ray.direction.z } }, touch) ?? null;
      // a fitting stands on its wall, floor or piece: it is hit just before the surface it is on
      // an added person is a body in the room: the nearest of piece, fitting and person wins
      const extra = d.extraTargets?.() ?? [];
      const ph = extra.length && d.modes.id === 'walk' ? raycaster.intersectObjects(extra, true)[0] : undefined; // not while furnishing: pieces are edited, people are not
      const personId = ph ? personIdOf(ph.object) : null;
      if (personId && ph && ph.distance < blocker && (!fit || ph.distance <= fit.dist)) return { kind: 'person', id: personId, dist: ph.distance };
      if (fit && fit.dist <= blocker + 0.03) return { kind: 'fitting', id: fit.id, dist: fit.dist };
      if (itemId) return { kind: 'item', id: itemId, dist: blocker };
      return null;
    },
    raycastWalls(e) {
      setRay(e);
      const h = raycaster.intersectObject(d.shell, true)[0];
      return h ? { x: h.point.x, y: h.point.y, z: h.point.z } : null;
    },
    raycastCeiling(e) {
      setRay(e);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -d.property.layout.wallHeightM);
      const p = raycaster.ray.intersectPlane(plane, hit);
      return p ? { x: p.x, z: p.z } : null;
    },
    rayOf(e) {
      setRay(e);
      const o = raycaster.ray.origin, v = raycaster.ray.direction;
      return { origin: { x: o.x, y: o.y, z: o.z }, dir: { x: v.x, y: v.y, z: v.z } };
    },
  };
}
