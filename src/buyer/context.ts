// Owned by C3. Contract types from C0 (SPEC 7.1); C3 may add to this file but must keep these exactly.
import type * as THREE from 'three';
import type { Box, CheckCard, FurnitureItem, Grid, PropertyFile, Vec2, Vec3 } from '../types';
import type { Viewer } from '../engine/viewer';
import type { Character } from '../engine/character';
import type { Input, PointerEvt } from '../engine/controls';
import type { FollowCamera } from '../engine/camera';

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
  outlineBox(box: Box, y: number, color: string): OverlayHandle;
  line(a: Vec3, b: Vec3, label: string, color: string): OverlayHandle;
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
}
