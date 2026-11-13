// A made-up two-bedroom corner with a passage, shaped like a real narrow case: the main bedroom is mostly bed and wardrobe, so the only
// 0.6 m-clear patch is a strip, and the way in is a plain opening to a passage that is not measured. Generic geometry, no real drawing.
import { DEFAULT_FINISHES } from '../../src/types';
import type { FurnitureItem, Layout, Opening, RoomTag } from '../../src/types';

const rect = (id: string, roomType: RoomTag['roomType'], label: string, x0: number, z0: number, x1: number, z1: number): RoomTag => ({
  id, roomType, label, polygon: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], edges: ['wall', 'wall', 'wall', 'wall'],
});

export const crowdedLayout: Layout = {
  wallHeightM: 2.6, wallThicknessM: 0.12, railingHeightM: 1.1,
  rooms: [
    rect('main', 'bedroom', 'Main Bedroom', -0.88, -1.91, 2.47, 1.9),
    rect('second', 'bedroom', 'Second Bedroom', -4.74, -1.9, -1.09, 0.84),
    rect('hall', 'other', 'Hall', -3.43, 0.97, -0.88, 1.93),
  ],
  openings: [
    { id: 'o1', roomId: 'main', edge: 3, type: 'opening', centreM: 0.49, widthM: 0.9, sillM: 0, headM: 2.1 },
    { id: 'w1', roomId: 'main', edge: 0, type: 'window', centreM: 1.83, widthM: 2.1, sillM: 0.9, headM: 2.1 },
    { id: 'd2', roomId: 'second', edge: 2, type: 'door', centreM: 2.03, widthM: 0.84, sillM: 0, headM: 2.1 },
    { id: 'd3', roomId: 'hall', edge: 2, type: 'door', centreM: 0.93, widthM: 0.84, sillM: 0, headM: 2.1 },
  ] satisfies Opening[],
  finishes: DEFAULT_FINISHES,
  scaleSource: 'typed-sizes',
};

export const crowdedFurniture: FurnitureItem[] = [
  { id: 'bed', source: 'real', kind: 'bed', label: 'Bed', box: { cx: 1.5, cz: 0.19, w: 1.5, d: 1.83, yawDeg: 270 }, heightM: 0.5, surfaceHeightM: 0.5 },
  { id: 'wardrobe', source: 'real', kind: 'wardrobe', label: 'Wardrobe', box: { cx: -0.58, cz: -0.43, w: 2.74, d: 0.61, yawDeg: 90 }, heightM: 2.1, surfaceHeightM: 2.1 },
];

/** the extras file a drawing import writes: the second bedroom only has its label's size, the hall runs off the sheet */
export const crowdedExtras = {
  rooms: [
    { id: 'main', method: 'label-rect', verified: true },
    { id: 'second', method: 'label-rect' },
    { id: 'hall', method: 'walls+strokes', verified: false, note: 'runs off the drawing' },
  ],
};
