// What to call a piece of furniture (shared by the tray and by decor that sits on a piece). Pure.
import type { FurnitureItem, FurnitureKind } from '../types';

const KIND_NAMES: Record<FurnitureKind, string> = { bed: 'Bed', sofa: 'Sofa', wardrobe: 'Wardrobe', dining: 'Dining table', counter: 'Counter' };
/** What to call a piece: its own label, else its kind (the drawing does not always name a piece). */
export function pieceName(item: Pick<FurnitureItem, 'label' | 'kind'>): string {
  return item.label && item.label.trim() ? item.label.trim() : KIND_NAMES[item.kind];
}
