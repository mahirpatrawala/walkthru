// A one-way hook so furnish mode can ask "does this item sit in a wardrobe's shutter swing?" without importing the wardrobe
// controller (which needs three and the HUD). The controller registers itself when the buyer page starts; headless furnish
// tests never register one, so the answer there is always null.
import { stampFurniture } from '../core/layout-raster';
import type { Box, Grid } from '../types';

export type SwingProvider = (box: Box, selfId?: string) => string | null;
let provider: SwingProvider | null = null;

export function setSwingProvider(p: SwingProvider | null): void {
  provider = p;
}

/** The doors' answer to the same question (src/buyer/doors.ts): "Blocks the Bedroom door from opening." */
let doorProvider: SwingProvider | null = null;
export function setDoorSwingProvider(p: SwingProvider | null): void {
  doorProvider = p;
}

/** "Wardrobe shutters need 44 cm to open here." when `box` sits in a wardrobe's swing, and "Blocks the Bedroom door from opening." when it sits in a door's. Else null. `selfId` is skipped. */
export function swingNoteFor(box: Box, selfId?: string): string | null {
  const parts = [provider?.(box, selfId) ?? null, doorProvider?.(box, selfId) ?? null].filter((x): x is string => !!x);
  return parts.length ? parts.join(' ') : null;
}

/** The verdict message with the swing sentence added when there is one. */
export function withSwingNote(message: string, box: Box, selfId?: string): string {
  const note = swingNoteFor(box, selfId);
  return note ? `${message} ${note}` : message;
}

/**
 * Obstacles that are not furniture and not saved (people the viewer added, src/buyer/people): a wardrobe's shutters swing through
 * a grid that leaves out every temporary obstacle, so these are stamped back on top of it. Nothing registered, nothing stamped.
 */
export type ExtraObstacles = () => { box: Box; heightM: number }[];
let extra: ExtraObstacles | null = null;
export function setExtraObstacles(p: ExtraObstacles | null): void {
  extra = p;
}
export function withExtraObstacles(grid: Grid): Grid {
  const list = extra?.() ?? [];
  if (list.length === 0) return grid;
  return stampFurniture(grid, list.map((o, i) => ({
    id: `extra:${i}`, source: 'virtual' as const, kind: 'wardrobe' as const, label: 'person', box: o.box, heightM: o.heightM, surfaceHeightM: o.heightM,
  })));
}
