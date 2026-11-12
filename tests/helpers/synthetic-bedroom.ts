// A synthetic bedroom with its own ground truth, for the tests that used to read numbers off one real drawing. Every value is
// invented here and chosen so the arithmetic is checkable by hand: 3 bays of 2'-7" pitch (1½" slack at each end of the 8'
// box), shutters 1'-3½", and 2'-4" clear from the wardrobe front to the bed, which leaves 1'-0½" of walking space. The shape of `designs` is what
// `src/look/designs.ts` parses; nothing in it is read from a drawing.
import { createEmptyProperty, normalizeRoom } from '../../src/core/layout-validate';
import type { FurnitureItem, PropertyFile } from '../../src/types';

export const FT = 0.3048;
export const IN = 0.0254;

export const TRUTH = {
  roomW: 126 * IN, roomD: 4.2, ceilingM: 8.5 * FT,
  wardrobeW: 96 * IN, wardrobeD: 24 * IN, bays: 3, bayPitch: 31 * IN, shutterW: 15.5 * IN,
  bedLen: 72 * IN, bedW: 48 * IN, bedEastGap: 2 * IN,
  /** wardrobe front to bed side: 126 - 24 - 72 - 2 = 28 inches */
  gapToBed: 28 * IN, walking: 12.5 * IN,
  interior: { side: 2 * IN, partition: 1 * IN, bayClear: 30 * IN, clearHeight: 94 * IN },
  baseGap: 2 * IN, drawerStrip: 8 * IN, wardrobeH: 96 * IN,
};
const half = TRUTH.roomW / 2;
export const WALL_W = -half, WALL_E = half;

export function makeBedroom(): { property: PropertyFile; designs: unknown; items: FurnitureItem[] } {
  const p = createEmptyProperty('synthetic-bedroom');
  p.layout.wallHeightM = TRUTH.ceilingM;
  p.layout.scaleSource = 'plan-dimensions';
  const z = TRUTH.roomD / 2;
  const room = normalizeRoom({
    id: 'bedroom-a', roomType: 'bedroom', label: 'Bedroom A',
    polygon: [{ x: -half, z: -z }, { x: half, z: -z }, { x: half, z }, { x: -half, z }], edges: ['wall', 'wall', 'wall', 'wall'],
  });
  p.layout.rooms = [room];
  p.layout.openings = [
    { id: 'door-1', roomId: 'bedroom-a', edge: 2, type: 'door', centreM: 0.9, widthM: 0.9, sillM: 0, headM: 2.1 },
    { id: 'window-1', roomId: 'bedroom-a', edge: 0, type: 'window', centreM: 1.6, widthM: 1.5, sillM: 0.9, headM: 2.1 },
  ];
  const wcz = -0.3;
  const zhi = wcz + TRUTH.wardrobeW / 2, zlo = wcz - TRUTH.wardrobeW / 2;
  const wardrobe: FurnitureItem = {
    id: 'wardrobe-1', source: 'real', kind: 'wardrobe', label: 'Wardrobe', heightM: 2.13, surfaceHeightM: 2.13,
    box: { cx: WALL_W + TRUTH.wardrobeD / 2, cz: wcz, w: TRUTH.wardrobeW, d: TRUTH.wardrobeD, yawDeg: 90 },
  };
  const bed: FurnitureItem = {
    id: 'bed-1', source: 'real', kind: 'bed', label: 'Bed', heightM: 0.9, surfaceHeightM: 0.5,
    box: { cx: WALL_E - TRUTH.bedEastGap - TRUTH.bedLen / 2, cz: zhi - 0.006 - TRUTH.bedW / 2, w: TRUTH.bedW, d: TRUTH.bedLen, yawDeg: 270 },
    inner: { w: TRUTH.bedW, d: TRUTH.bedLen },
  };
  const sideTable: FurnitureItem = {
    id: 'counter-1', source: 'real', kind: 'counter', label: 'Side table', heightM: 0.55, surfaceHeightM: 0.55,
    box: { cx: WALL_E - 0.2, cz: zhi + 0.35, w: 0.45, d: 0.4, yawDeg: 270 },
  };
  const studyW = 36 * IN;
  const study: FurnitureItem = {
    id: 'counter-2', source: 'real', kind: 'counter', label: 'Study', heightM: 0.75, surfaceHeightM: 0.75,
    box: { cx: WALL_E - 0.3048, cz: zlo + 0.41, w: studyW, d: 0.6096, yawDeg: 270 },
  };
  p.furniture = [wardrobe, bed, sideTable, study];
  p.spawn = { x: 0, z: 1.6, yawDeg: 180 };

  const bayZones = (kinds: [string, number, string, string][]): unknown[] => kinds.map(([kind, inch, dim, label]) => ({ kind, heightM: inch * IN, dim, label }));
  const mid = bayZones([
    ['footwear-drawer', 8, '8"', 'Footwear drawer'], ['board', 1, '1"', 'Board'], ['glass-drawer', 8, '8"', 'Glass drawer'], ['glass-drawer', 8, '8"', 'Glass drawer'],
    ['board', 1, '1"', 'Board'], ['hanging', 55, '4\'-7"', 'Hanging space'], ['board', 1, '1"', 'Board'], ['open-shelf', 12, '1\'', 'Open shelf'],
  ]);
  (mid[5] as Record<string, unknown>).derived = true;
  const last = bayZones([
    ['footwear-drawer', 8, '8"', 'Footwear drawer'], ['board', 1, '1"', 'Board'], ['lockable-drawer', 6, '6"', 'Lockable drawers (two side by side)'],
    ['board', 1, '1"', 'Board'], ['hanging', 58, '4\'-10"', 'Hanging space'], ['board', 1, '1"', 'Board'], ['open-shelf', 19, '1\'-7"', 'Open shelf'],
  ]);
  const designs = {
    version: 1,
    source: 'Synthetic bedroom for tests. No drawing.',
    items: {
      'wardrobe-1': {
        heightM: TRUTH.wardrobeH, surfaceHeightM: TRUTH.wardrobeH,
        wardrobe: { bays: 3, shuttersPerBay: 2, drawerStripM: TRUTH.drawerStrip, baseGapM: TRUTH.baseGap, frontColor: '#D9CFC4', handleColor: '#4A4A4A', handleYM: 1.0, handleLenM: 0.25 },
        openable: {
          bayPitchM: TRUTH.bayPitch, shutterWidthM: TRUTH.shutterW, bayCentresFromLeftM: [17 * IN, 48 * IN, 79 * IN], hinge: 'outer-edges', meet: 'bay-centre', maxAngleDeg: 90,
          gaps: [{ toItem: 'bed-1', label: 'bed', gapM: TRUTH.gapToBed, text: '2\'-4"', page: 1, sheet: 'PLAN' }],
          conflicts: ['Plan chain gives 2\'-7", 2\'-7", 2\'-8" (7\'-10"); the elevation shows three bays of 2\'-7" (7\'-9"). The elevation is used for shutter widths.'],
          cardConflict: 'the plan chain adds to 7\'-10" while the elevation shows three 2\'-7" bays (7\'-9"). Shutter widths use the elevation.',
          notInDrawing: ['shutter thickness', 'handle projection', 'hinge opening angle'],
          sources: {
            shutterWidthM: { page: 2, sheet: 'ELEVATION-A', text: '2\'-7" per bay, split at mid-bay' },
            interior: { page: 3, sheet: 'ELEVATION-AA (INTERNAL)', text: 'compartments bottom to top' },
          },
          interior: { sidePanelM: TRUTH.interior.side, partitionM: TRUTH.interior.partition, bayClearM: TRUTH.interior.bayClear, zonesBottomUp: [mid, mid, last] },
        },
        sources: { bays: { page: 2, sheet: 'ELEVATION-A', text: 'three bays of 2\'-7"' } },
      },
      'bed-1': { heightM: 1.05, surfaceHeightM: 0.5, bed: { baseTopM: 0.35 }, sources: { surfaceHeightM: { page: 3, sheet: 'ELEVATION-B', text: 'mattress top 1\'-8"' } } },
    },
    decor: [{ id: 'chair-1', look: 'chair', tiedTo: 'counter-2', offset: { x: 0, z: 0.34 }, faceItem: true }],
  };
  return { property: p, designs, items: p.furniture };
}
