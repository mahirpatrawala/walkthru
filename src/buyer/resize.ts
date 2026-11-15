// A piece that came with the home can be moved and resized in "My layout" (SPEC 16.2: the drawing's own box is the record and never changes;
// a viewer's try-out is a separate value, `OriginalEdit`, stored in the overlay and carried by the share link). Pure: no DOM, no three.
// This file holds the value, the limits per family, the way an edit is put on the drawn piece, and the words that say so.
import type { Box, FurnitureItem } from '../types';

/** The whole state of an edited original: where it stands, how it is turned and how big it is (metres, degrees). */
export interface OriginalEdit { cx: number; cz: number; yawDeg: number; w: number; d: number; heightM: number; surfaceHeightM: number }

export type SizeKey = 'w' | 'd' | 'h';
export interface SizeLimit { key: SizeKey; label: string; min: number; max: number; step: number }

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** Which height an item's "height" stepper edits: a bed's mattress top, a table's top, a wardrobe's or counter's overall height, a sofa's overall height. */
export type HeightMode = 'surface' | 'overall' | 'both';
export function heightMode(item: Pick<FurnitureItem, 'kind'>): HeightMode {
  switch (item.kind) {
    case 'bed': return 'surface';
    case 'dining': return 'both';
    case 'counter': return 'both';
    case 'wardrobe': return 'both';
    default: return 'overall';
  }
}

/** The stepper ranges of a piece by family, in metres. A wardrobe cannot be taller than the room. */
export function sizeLimits(item: Pick<FurnitureItem, 'kind' | 'label'>, ceilingM = 2.6): SizeLimit[] {
  const W = (min: number, max: number, label = 'Width'): SizeLimit => ({ key: 'w', label, min, max, step: 0.05 });
  const D = (min: number, max: number, label = 'Depth'): SizeLimit => ({ key: 'd', label, min, max, step: 0.05 });
  const H = (min: number, max: number, label = 'Height'): SizeLimit => ({ key: 'h', label, min, max, step: 0.05 });
  switch (item.kind) {
    case 'bed': return [W(0.7, 2.4), D(1.5, 2.4, 'Length'), H(0.25, 0.8, 'Mattress height')];
    case 'sofa': return [W(0.6, 3.4), D(0.6, 1.3), H(0.6, 1.1)];
    case 'dining': return [W(0.6, 2.6), D(0.6, 1.4), H(0.6, 0.85, 'Table height')];
    case 'wardrobe': return [W(0.4, 4.2), D(0.35, 0.9), H(1.2, Math.max(1.3, ceilingM - 0.05))];
    default: return [W(0.3, 3.5), D(0.25, 1.1), H(0.3, 1.2)];
  }
}

/** The values a stepper shows for a piece: width, depth and the height its family edits (metres). */
export function sizeValues(item: Pick<FurnitureItem, 'kind' | 'box' | 'heightM' | 'surfaceHeightM'>): Record<SizeKey, number> {
  const m = heightMode(item);
  return { w: item.box.w, d: item.box.d, h: m === 'surface' ? item.surfaceHeightM : item.heightM };
}

/**
 * The drawn piece with `edit` put on it. The id, kind, label, finish and catalogue id stay; the box, the heights and the sleeping area follow the
 * new size (a bed's mattress margin on each side stays what the drawing has). Limits are enforced, so a link cannot make a 20 m bed.
 */
export function applyEdit(drawn: FurnitureItem, edit: OriginalEdit, ceilingM = 2.6): FurnitureItem {
  const lim = Object.fromEntries(sizeLimits(drawn, ceilingM).map((l) => [l.key, l])) as Record<SizeKey, SizeLimit>;
  // a size the drawing already has (below the family's range, say a 12 cm wardrobe panel) is never "corrected": the range grows to include it
  const keep = (v: number, key: SizeKey, drawnV: number): number => clamp(v, Math.min(lim[key].min, drawnV), Math.max(lim[key].max, drawnV));
  const w = r3(keep(edit.w, 'w', drawn.box.w));
  const d = r3(keep(edit.d, 'd', drawn.box.d));
  const mode = heightMode(drawn);
  const next: FurnitureItem = { ...drawn, box: { cx: r3(edit.cx), cz: r3(edit.cz), w, d, yawDeg: ((edit.yawDeg % 360) + 360) % 360 }, heightM: drawn.heightM, surfaceHeightM: drawn.surfaceHeightM };
  if (drawn.finish) next.finish = { ...drawn.finish };
  if (mode === 'surface') {
    const s = r3(keep(edit.surfaceHeightM, 'h', drawn.surfaceHeightM));
    next.surfaceHeightM = s;
    next.heightM = Math.abs(s - drawn.surfaceHeightM) < 0.0005 ? drawn.heightM : Math.max(drawn.heightM, r3(s + 0.2));
  } else if (mode === 'both') {
    const h = r3(keep(edit.heightM, 'h', drawn.heightM));
    next.heightM = h;
    // a table's, counter's or wardrobe's surface is its top
    next.surfaceHeightM = drawn.surfaceHeightM === drawn.heightM ? h : r3(clamp(drawn.surfaceHeightM + (h - drawn.heightM), 0.05, h));
  } else {
    const h = r3(keep(edit.heightM, 'h', drawn.heightM));
    next.heightM = h;
    next.surfaceHeightM = Math.min(drawn.surfaceHeightM, Math.max(0.05, h - 0.1));
  }
  if (drawn.inner) next.inner = { w: r3(Math.max(0.1, w - (drawn.box.w - drawn.inner.w))), d: r3(Math.max(0.1, d - (drawn.box.d - drawn.inner.d))) };
  return next;
}

/** The edit that gives exactly this item (what the store keeps after a move or a resize). */
export function editOf(item: Pick<FurnitureItem, 'box' | 'heightM' | 'surfaceHeightM'>): OriginalEdit {
  return { cx: item.box.cx, cz: item.box.cz, yawDeg: item.box.yawDeg, w: item.box.w, d: item.box.d, heightM: item.heightM, surfaceHeightM: item.surfaceHeightM };
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.0005;
/** true when the edit changes nothing about the drawn piece (then the store drops it) */
export function isNoEdit(drawn: FurnitureItem, edit: OriginalEdit): boolean {
  return near(edit.cx, drawn.box.cx) && near(edit.cz, drawn.box.cz) && Math.abs((((edit.yawDeg - drawn.box.yawDeg) % 360) + 540) % 360 - 180) < 0.05
    && near(edit.w, drawn.box.w) && near(edit.d, drawn.box.d) && near(edit.heightM, drawn.heightM) && near(edit.surfaceHeightM, drawn.surfaceHeightM);
}

export const sizeChanged = (drawn: FurnitureItem, cur: FurnitureItem): boolean =>
  !near(cur.box.w, drawn.box.w) || !near(cur.box.d, drawn.box.d) || !near(cur.heightM, drawn.heightM) || !near(cur.surfaceHeightM, drawn.surfaceHeightM);
/** the middle of the back edge: what stays put when a piece grows toward its front, so growing is not "moving" */
export function backMid(b: Box): { x: number; z: number } {
  const y = (b.yawDeg * Math.PI) / 180;
  return { x: b.cx - Math.sin(y) * (b.d / 2), z: b.cz - Math.cos(y) * (b.d / 2) };
}
/** moved = the back edge is somewhere else, or it is turned. A piece that only grew toward its front (the back edge stays) has not moved. */
export const placeChanged = (drawn: Box, cur: Box): boolean => {
  const a = backMid(drawn), c = backMid(cur);
  return !near(c.x, a.x) || !near(c.z, a.z) || Math.abs((((cur.yawDeg - drawn.yawDeg) % 360) + 540) % 360 - 180) >= 0.05;
};

const cmText = (m: number): string => String(Math.round(m * 100));
const dims = (i: Pick<FurnitureItem, 'box'>): string => `${cmText(i.box.w)} × ${cmText(i.box.d)} cm`;

export const MOVED_NOTE = 'Moved in your layout';

/** The plain-words note of an original that has been moved and/or resized, or null when it is as drawn. */
export function editNote(drawn: FurnitureItem, cur: FurnitureItem): string | null {
  const moved = placeChanged(drawn.box, cur.box);
  const sized = sizeChanged(drawn, cur);
  if (!moved && !sized) return null;
  const parts: string[] = [];
  if (moved) parts.push(MOVED_NOTE);
  if (sized) {
    const h = heightMode(drawn) === 'surface' ? drawn.surfaceHeightM : drawn.heightM;
    const hc = heightMode(cur) === 'surface' ? cur.surfaceHeightM : cur.heightM;
    const hTxt = !near(h, hc) ? ` · ${cmText(hc)} cm ${heightMode(cur) === 'surface' ? 'mattress height' : 'high'}` : '';
    const hDrawn = !near(h, hc) ? ` · ${cmText(h)} cm` : '';
    parts.push(`Your size: ${dims(cur)}${hTxt}. On the drawing: ${dims(drawn)}${hDrawn}.`);
  }
  return parts.join('. ').replace(/\.\./g, '.');
}

export const BACK_TO_DRAWN_SIZE = 'Back to drawn size';
export const BACK_TO_DRAWN_PLACE = 'Back to drawn place';

/**
 * The patch that sets one size of a piece of the home (metres): 'w', 'd' or 'h' (the height its family edits). The back edge stays where it is (a bed's
 * head, a wardrobe's back on its wall), so a piece grows or shrinks toward its front, and the width changes about the middle. Limits per family apply.
 */
export function resizePatch(item: FurnitureItem, drawn: FurnitureItem | undefined, key: SizeKey, value: number, ceilingM = 2.6): Partial<OriginalEdit> {
  const lim = sizeLimits(item, ceilingM).find((l) => l.key === key);
  if (!lim) return {};
  const dv = drawn ? sizeValues(drawn)[key] : sizeValues(item)[key];
  const v = Math.round(clamp(value, Math.min(lim.min, dv), Math.max(lim.max, dv)) * 100) / 100;
  if (key === 'w') return { w: v };
  if (key === 'd') {
    const y = (item.box.yawDeg * Math.PI) / 180;
    const a = { x: Math.sin(y), z: Math.cos(y) };
    const back = { x: item.box.cx - a.x * (item.box.d / 2), z: item.box.cz - a.z * (item.box.d / 2) };
    return { d: v, cx: back.x + a.x * (v / 2), cz: back.z + a.z * (v / 2) };
  }
  return heightMode(item) === 'surface' ? { surfaceHeightM: v } : { heightM: v };
}
