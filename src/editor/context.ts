// Owned by C5. Contract types from C0 (SPEC 7.1); C5 may add to this file but must keep these exactly.
import type { Grid, PropertyFile, Px, Vec2 } from '../types';
import type { Viewer } from '../engine/viewer';

export interface PlanCanvas {
  /** redraw everything from the draft */
  refresh(): void;
  screenToWorld(clientX: number, clientY: number): Vec2;
  worldToScreen(v: Vec2): Px;
  /** one active tool at a time; null restores pan/select */
  setTool(tool: PlanTool | null): void;
  /** extra drawing on top (pins, ghosts) */
  addLayer(draw: (g: CanvasRenderingContext2D, c: PlanCanvas) => void): () => void;
  setUnderlayImage(img: CanvasImageSource | null, placement?: { pxPerM: number; originPx: Px; opacity?: number }): void;
  pxPerMetreOnScreen(): number;
}
export interface PlanTool {
  cursor?: string;
  onDown?(w: Vec2, e: PointerEvent): void; onMove?(w: Vec2, e: PointerEvent): void; onUp?(w: Vec2, e: PointerEvent): void;
  onKey?(e: KeyboardEvent): void; draw?(g: CanvasRenderingContext2D, c: PlanCanvas): void; cancel?(): void;
}
export interface FrameStore { frames: ImageBitmap[]; onChange(cb: () => void): () => void; addVideo(f: File): Promise<void>; addImages(f: File[]): Promise<void> }
export interface EditorContext {
  sceneId: string;
  /** the mutable draft; call commit() after changing it */
  draft: PropertyFile;
  /** re-validate, re-rasterise, redraw the plan, rebuild the 3D preview, refresh step ticks */
  commit(): void;
  grid(): Grid;
  plan: PlanCanvas;
  frames: FrameStore;
  /** the 3D preview's viewer, for the scan step */
  viewer: Viewer;
  api: { saveProperty(p: PropertyFile): Promise<void>; saveFile(name: string, data: Blob): Promise<void>; exists(name: string): Promise<boolean> };
}
export interface EditorStep {
  id: string; title: string; optional?: boolean;
  mount(panel: HTMLElement, ctx: EditorContext): void;
  unmount(): void;
  isDone(ctx: EditorContext): boolean;
}
// each editor/steps/<name>.ts exports:  export const step: EditorStep
