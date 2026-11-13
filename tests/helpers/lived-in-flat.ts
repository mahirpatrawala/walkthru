// A made-up 2 BHK with an entry door, a balcony, a pooja room, a kitchen counter and a room that is only partly on the drawing.
// Generic geometry for the lived-in decor tests (no real drawing).
import { DEFAULT_FINISHES } from '../../src/types';
import type { FurnitureItem, Layout, Opening, RoomTag } from '../../src/types';

const rect = (id: string, roomType: RoomTag['roomType'], label: string, x0: number, z0: number, x1: number, z1: number, partial = false): RoomTag => ({
  id, roomType, label, polygon: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], edges: ['wall', 'wall', 'wall', 'wall'],
  ...(partial ? { partial: { reason: 'runs off the sheet' } } : {}),
});

export const livedInLayout: Layout = {
  wallHeightM: 2.7, wallThicknessM: 0.12, railingHeightM: 1.1,
  rooms: [
    rect('living', 'living', 'Living Room', 0, 0, 4.4, 3.6),
    rect('kitchen', 'kitchen', 'Kitchen', 4.52, 0, 7.0, 3.6),
    rect('bedroom', 'bedroom', 'Bedroom', 0, 3.72, 4.4, 7.2),
    rect('pooja', 'other', 'Pooja Room', 4.52, 3.72, 6.0, 5.6),
    rect('store', 'other', 'Store', 6.12, 3.72, 8.0, 5.6, true),
    rect('balcony', 'balcony', 'Balcony', 1.2, -1.9, 3.0, -0.12),
  ],
  openings: [
    { id: 'entry', roomId: 'living', edge: 3, type: 'door', centreM: 1.6, widthM: 0.9, sillM: 0, headM: 2.1 },
    { id: 'living-win', roomId: 'living', edge: 0, type: 'window', centreM: 3.7, widthM: 0.9, sillM: 0.9, headM: 2.1 },
    { id: 'to-balcony', roomId: 'living', edge: 0, type: 'opening', centreM: 2.1, widthM: 1.0, sillM: 0, headM: 2.1 },
    { id: 'to-kitchen', roomId: 'living', edge: 1, type: 'opening', centreM: 2.9, widthM: 0.9, sillM: 0, headM: 2.1 },
    { id: 'to-bedroom', roomId: 'living', edge: 2, type: 'door', centreM: 3.4, widthM: 0.8, sillM: 0, headM: 2.1 },
    { id: 'bed-win', roomId: 'bedroom', edge: 2, type: 'window', centreM: 2.2, widthM: 1.4, sillM: 0.9, headM: 2.1 },
    { id: 'kit-win', roomId: 'kitchen', edge: 0, type: 'window', centreM: 1.2, widthM: 1.0, sillM: 0.9, headM: 2.1 },
    { id: 'to-pooja', roomId: 'kitchen', edge: 2, type: 'door', centreM: 1.4, widthM: 0.8, sillM: 0, headM: 2.1 },
  ] satisfies Opening[],
  finishes: DEFAULT_FINISHES,
  scaleSource: 'typed-sizes',
};

const item = (id: string, kind: FurnitureItem['kind'], label: string, cx: number, cz: number, w: number, d: number, yawDeg: number, h: number, s: number): FurnitureItem => ({
  id, source: 'real', kind, label, box: { cx, cz, w, d, yawDeg }, heightM: h, surfaceHeightM: s,
});

export const livedInFurniture: FurnitureItem[] = [
  item('sofa', 'sofa', 'Sofa', 2.7, 3.15, 2.0, 0.9, 180, 0.85, 0.43),
  item('dining', 'dining', 'Dining', 0.95, 1.3, 1.8, 1.7, 0, 0.95, 0.75),
  item('bed', 'bed', 'Bed', 3.45, 5.4, 1.5, 1.9, 270, 0.9, 0.5),
  item('side', 'counter', 'Side table', 3.95, 4.3, 0.45, 0.45, 270, 0.55, 0.55),
  item('wardrobe', 'wardrobe', 'Wardrobe', 0.35, 5.4, 2.2, 0.6, 90, 2.13, 2.13),
  item('study', 'counter', 'Study', 2.9, 4.05, 1.2, 0.6, 0, 0.75, 0.75),
  item('platform', 'counter', 'Kitchen platform', 6.7, 1.8, 3.0, 0.6, 270, 0.85, 0.85),
  // in the room that is only partly on the drawing: none of these may be dressed
  item('store-bed', 'bed', 'Bed', 7.0, 4.7, 1.5, 1.9, 270, 0.9, 0.5),
  item('store-counter', 'counter', 'Kitchen platform', 6.5, 5.3, 1.4, 0.6, 0, 0.85, 0.85),
];
