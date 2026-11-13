// C12d. Where a picture sent to a model came from. A model's boxes are in the pixels of the picture it saw; this record maps
// the uploaded page's pixels to those, so a box can be carried back to the file the broker uploaded (and so a recorded or
// simulated provider can place its answers). Real providers never look at it.
import type { Mat3, Rect } from './image';

export interface Lineage {
  pageId: string;
  kind: 'view' | 'crop' | 'thumb';
  /** uploaded-page pixels -> pixels of this picture */
  fromOriginal: Mat3;
  /** the part of the uploaded page this picture shows, in uploaded-page pixels */
  rectOriginal: Rect;
  size: { w: number; h: number };
}
const registry = new WeakMap<Uint8Array, Lineage>();
export const tagImage = (png: Uint8Array, l: Lineage): Uint8Array => { registry.set(png, l); return png; };
export const lineageOf = (png: Uint8Array): Lineage | undefined => registry.get(png);
