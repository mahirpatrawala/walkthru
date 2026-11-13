// Rooms that are only partly on the drawing (SPEC 16.2 spirit: never present a guess as a measurement). A room can run off the edge of
// the sheet (its far wall is not drawn) or a passage can end at the sheet border. The importer still builds a shape for it, but the
// room is tagged `partial` so the 3D view, the room list and the editor show that the shape is a guess. Pure, no scene knowledge.
import type { Px, RoomTag } from '../types';
import { formatFtIn } from '../core/units';
import type { VectorPage } from './types';

export type SheetBox = [number, number, number, number];

/** The drawing area of the sheet: the border rectangle when one is drawn (a stroke spanning most of the page both ways), else the page. */
export function sheetArea(page: Pick<VectorPage, 'width' | 'height' | 'strokes'>): SheetBox {
  let best: SheetBox | null = null;
  for (const s of page.strokes) {
    if (!s.closed || s.points.length < 4) continue;
    const xs = s.points.map((p) => p.x), ys = s.points.map((p) => p.y);
    const b: SheetBox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    if (b[2] - b[0] < 0.7 * page.width || b[3] - b[1] < 0.7 * page.height) continue;
    if (!best || (b[2] - b[0]) * (b[3] - b[1]) > (best[2] - best[0]) * (best[3] - best[1])) best = b;
  }
  return best ?? [0, 0, page.width, page.height];
}

/**
 * A room drawn as a rectangle of its printed size (its walls are not closed on the drawing) whose rectangle sticks out past the sheet
 * by more than `tol` (page units) has a far wall that is off the sheet. Returns the reason, or null. `ptPerM` turns the kept side into metres.
 */
export function offSheetReason(ring: Px[], sheet: SheetBox, tol: number, ptPerM: number): string | null {
  const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const overX = Math.max(sheet[0] - x0, x1 - sheet[2]), overY = Math.max(sheet[1] - y0, y1 - sheet[3]);
  const cutX = overX > tol, cutY = overY > tol;
  if (!cutX && !cutY) return null;
  const w = (x1 - x0) / ptPerM, h = (y1 - y0) / ptPerM;
  if (cutX && cutY) return 'This room runs off the corner of your drawing. Its size and shape are a guess.';
  // the side that stays on the sheet is the one the drawing really shows
  const kept = cutX ? h : w, other = cutX ? w : h;
  const name = kept <= other ? 'width' : 'length';
  return `Only its ${formatFtIn(kept)} ${name} is on your drawing. Its far wall is off the sheet, so the rest of this room is a guess.`;
}

/** A passage the importer found running into the sheet border: its far end is not drawn. */
export const PASSAGE_OFF_SHEET_REASON = 'This passage runs off the edge of your drawing. Only part of it is shown, and where it ends is a guess.';

export const isPartial = (r: Pick<RoomTag, 'partial'>): boolean => !!r.partial;
