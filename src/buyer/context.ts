// Owned by C3. Contract types from C0 (SPEC 7.1); C3 may add to this file but must keep these exactly.
import * as THREE from 'three';
import type { Box, CheckCard, FurnitureItem, Grid, PropertyFile, Vec2, Vec3 } from '../types';
import type { Viewer } from '../engine/viewer';
import type { Character } from '../engine/character';
import type { Input, PointerEvt } from '../engine/controls';
import type { FollowCamera } from '../engine/camera';
import { unmeasuredRoomsNear } from './store';
import type { UnverifiedRooms } from './store';

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
}

/** Builds the BuyerContext handed to every mode (SPEC 7.1). */
export function createBuyerContext(d: ContextDeps): BuyerContext {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

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
      const hits = raycaster.intersectObjects([d.shell, d.furnitureRoot], true);
      const h = hits[0];
      if (!h) return null;
      return { point: { x: h.point.x, y: h.point.y, z: h.point.z }, object: h.object };
    },
    raycastFloor(e) {
      setRay(e);
      const p = raycaster.ray.intersectPlane(floor, hit);
      return p ? { x: p.x, z: p.z } : null;
    },
  };
}
