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

// ---------------------------------------------------------------- C5 additions (the contract above is unchanged)

export interface Selection { roomId: string | null; openingId: string | null }
export interface Validation {
  errors: string[];
  warnings: string[];
  /** from the drawing import: proposal.json notes and proposal-extras.json warnings */
  importNotes: string[];
}

/**
 * What the C5 code adds on top of `EditorContext`. The object main.ts passes to `mount` is always an `EditorHost`;
 * the C5 steps call `asHost(ctx)` to get at the extras. C6 and C7 steps only need `EditorContext`.
 */
export interface EditorHost extends EditorContext {
  setSceneId(id: string): void;
  /** reads `property.json` for the id (or starts an empty draft), loads its plan image, shows import notes */
  loadScene(id: string): Promise<{ found: boolean; error?: string }>;
  selection: Selection;
  select(sel: Partial<Selection>): void;
  validation(): Validation;
  setImportNotes(notes: string[]): void;
  /** the plan image currently shown as underlay (not the scan image) */
  underlayImage: HTMLImageElement | null;
  /** shows `underlayImage` with the draft's `layout.underlay` placement, or clears it; call after changing either */
  applyUnderlay(): void;
  /** frame the plan image, else the rooms */
  fitPlan(): void;
  showPreview(on: boolean): void;
  previewVisible(): boolean;
  goto(stepId: string): void;
  toast(text: string, kind?: 'info' | 'warn' | 'error'): void;
}

export function asHost(ctx: EditorContext): EditorHost {
  const h = ctx as Partial<EditorHost>;
  if (typeof h.loadScene !== 'function' || typeof h.applyUnderlay !== 'function') {
    throw new Error('This editor step needs the walkthru editor page (EditorHost).');
  }
  return ctx as EditorHost;
}
