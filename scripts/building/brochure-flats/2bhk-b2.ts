// A 2 BHK of 589 sq ft RERA carpet area, authored from the printed room sizes of a published builder brochure (its plan and its table).
// Positions are scaled off the plan's picture (about 10 cm); sizes are the printed ones. The page's compass has its N to the right of the rose, so north is to the right of the page and the plan faces east (bottom of the page). See flat-spec.ts.
import { printedPlan as pl, printedTable as tb } from '../flat-spec';
import type { AuthoredFlat } from '../flat-spec';

export const flat2bhkB2: AuthoredFlat = {
  typeId: '2bhk-b2',
  name: '2 BHK · 589 sq ft',
  sceneId: 'test-tower-flat-2bhk-b2',
  title: 'Flat · 2 BHK, 589 sq ft',
  origin: 'Plan follows a published builder brochure',
  carpetAreaM2: 54.74,
  carpetToleranceFrac: 0.03,
  usableAreaM2: 59.36,
  northDeg: 270,
  brochureFacing: 'E',
  wallHeightM: 2.75,
  mainDoor: 'door-main',
  spawn: { x: -0.85, z: 1.5, yawDeg: 180 },
  rooms: [
    { id: 'foyer', label: 'Foyer', type: 'other', finish: 'dry', parts: [{ x: -1.52, z: 0.7, w: 1.35, d: 2.52, printed: pl(1.35, 2.52) }] },
    { id: 'kitchen', label: 'Kitchen', type: 'kitchen', finish: 'kitchen', openTo: ['living-dining'], parts: [{ x: 0, z: 0, w: 3.0, d: 2.17, printed: pl(3.0, 2.17) }] },
    { id: 'utility', label: 'Utility', type: 'other', finish: 'utility', parts: [{ x: 3.12, z: -0.1, w: 0.91, d: 1.78, printed: tb([3, 0], [5, 10]) }] },
    { id: 'living-dining', label: 'Living and dining', type: 'living', finish: 'dry', openTo: ['kitchen', 'passage'], parts: [{ x: 0, z: 2.17, w: 3.05, d: 4.417, printed: pl(3.05, 4.417) }] },
    { id: 'toilet-1', label: 'Toilet 1', type: 'bathroom', finish: 'wet', parts: [{ x: 3.12, z: 1.8, w: 2.27, d: 1.25, printed: pl(2.27, 1.25) }] },
    { id: 'passage', label: 'Passage', type: 'other', finish: 'dry', openTo: ['living-dining', 'master-passage'], parts: [{ x: 3.05, z: 3.18, w: 1.6, d: 0.94, printed: tb([5, 3], [3, 1]) }] },
    { id: 'master-passage', label: 'Master bed passage', type: 'other', finish: 'dry', openTo: ['passage'], parts: [{ x: 4.65, z: 3.18, w: 1.5, d: 0.94, printed: tb([4, 11], [3, 1]) }] },
    { id: 'bedroom-1', label: 'Bedroom 1', type: 'bedroom', finish: 'dry', parts: [{ x: 3.14, z: 4.24, w: 3.05, d: 2.75, printed: pl(3.05, 2.75) }] },
    { id: 'master-toilet', label: 'Master toilet', type: 'bathroom', finish: 'wet', parts: [{ x: 6.83, z: 1.8, w: 2.17, d: 1.25, printed: pl(2.17, 1.25) }] },
    { id: 'master-bedroom', label: 'Master bedroom', type: 'bedroom', finish: 'dry', parts: [{ x: 6.27, z: 3.18, w: 3.05, d: 3.8, printed: pl(3.05, 3.8) }] },
    { id: 'deck', label: 'Deck', type: 'balcony', finish: 'balcony', solidSides: ['W'], parts: [{ x: 0, z: 6.71, w: 3.05, d: 1.04, printed: tb([10, 0], [3, 5]) }] },
  ],
  openings: [
    { id: 'door-main', room: 'foyer', wall: 'N', at: -0.97, widthM: 1.0, kind: 'door', hinge: 'W', swing: 'in' },
    { id: 'open-foyer', room: 'foyer', wall: 'E', at: 2.78, widthM: 0.85, kind: 'opening' },
    { id: 'open-kitchen-utility', room: 'kitchen', wall: 'E', at: 0.7, widthM: 0.9, kind: 'opening' },
    { id: 'slide-deck', room: 'living-dining', wall: 'S', at: 1.46, widthM: 2.0, kind: 'sliding', hinge: 'W', swing: 'in' },
    { id: 'door-toilet-1', room: 'toilet-1', wall: 'S', at: 3.52, widthM: 0.74, kind: 'door', hinge: 'W', swing: 'in' },
    { id: 'door-master-toilet', room: 'master-toilet', wall: 'S', at: 7.23, widthM: 0.74, kind: 'door', hinge: 'W', swing: 'in' },
    { id: 'open-master-passage', room: 'master-bedroom', wall: 'W', at: 3.65, widthM: 0.9, kind: 'opening' },
    { id: 'door-bedroom-1', room: 'bedroom-1', wall: 'N', at: 3.71, widthM: 0.9, kind: 'door', hinge: 'W', swing: 'in' },
    { id: 'win-toilet-1', room: 'toilet-1', wall: 'E', at: 2.5, widthM: 0.6, kind: 'window', sillM: 1.5 },
    { id: 'win-bedroom-1', room: 'bedroom-1', wall: 'S', at: 4.6, widthM: 1.7, kind: 'window' },
    { id: 'win-master-bedroom', room: 'master-bedroom', wall: 'S', at: 7.63, widthM: 1.73, kind: 'window' },
  ],
  pieces: [
    // living and dining
    { id: 'sofa-1', kind: 'sofa', catalogId: 'sofa-3', label: 'Sofa', at: { x: 0.45, z: 5.37 }, facing: 'E' },
    { id: 'table-centre', kind: 'counter', catalogId: 'coffee-rect', label: 'Centre table', at: { x: 1.23, z: 4.98 }, facing: 'E' },
    { id: 'tv-living', kind: 'counter', catalogId: 'tv-unit-180', label: 'TV unit', at: { x: 2.85, z: 5.21 }, facing: 'W' },
    { id: 'dining-1', kind: 'dining', catalogId: 'dining-4', label: 'Dining table with four chairs', at: { x: 2.01, z: 2.91 }, facing: 'E' },
    // kitchen and utility
    { id: 'fridge-1', kind: 'counter', catalogId: 'fridge-1', label: 'Fridge', at: { x: 0.39, z: 0.4 }, facing: 'S' },
    { id: 'counter-k-north', kind: 'counter', label: 'Kitchen counter', at: { x: 1.35, z: 0.28 }, facing: 'S', w: 1.0, d: 0.55 },
    { id: 'sink-1', kind: 'counter', catalogId: 'sink-single', label: 'Kitchen sink', at: { x: 2.35, z: 0.275 }, facing: 'S' },
    { id: 'counter-k-hob', kind: 'counter', label: 'Kitchen counter with hob', at: { x: 1.9, z: 1.86 }, facing: 'N', w: 2.07, d: 0.62 },
    { id: 'washer-1', kind: 'counter', catalogId: 'washer-front', label: 'Washing machine', at: { x: 3.55, z: 1.3 }, facing: 'S' },
    // bedroom 1
    { id: 'bed-1', kind: 'bed', catalogId: 'bed-double', label: 'Double bed', at: { x: 5.2, z: 6.01 }, facing: 'W' },
    { id: 'tv-1', kind: 'counter', catalogId: 'tv-unit-150', label: 'TV unit', at: { x: 3.34, z: 6.0 }, facing: 'E' },
    { id: 'wardrobe-1', kind: 'wardrobe', label: 'Wardrobe', at: { x: 5.16, z: 4.49 }, facing: 'S', w: 1.94, d: 0.5 },
    // master bedroom
    { id: 'bed-master', kind: 'bed', catalogId: 'bed-queen', label: 'Queen bed', at: { x: 7.34, z: 5.76 }, facing: 'E' },
    { id: 'tv-master', kind: 'counter', catalogId: 'tv-unit-180', label: 'TV unit', at: { x: 9.12, z: 6.08 }, facing: 'W' },
    { id: 'wardrobe-master', kind: 'wardrobe', label: 'Wardrobe', at: { x: 8.29, z: 3.43 }, facing: 'S', w: 1.4, d: 0.5 },
    // toilets
    { id: 'basin-1', kind: 'counter', catalogId: 'basin-wall', label: 'Wash basin', at: { x: 3.42, z: 2.03 }, facing: 'S' },
    { id: 'wc-1', kind: 'counter', catalogId: 'wc-western', label: 'Western commode', at: { x: 4.02, z: 2.16 }, facing: 'S' },
    { id: 'shower-1', kind: 'counter', catalogId: 'shower-over', label: 'Shower', at: { x: 4.94, z: 1.98 }, facing: 'S' },
    { id: 'basin-master', kind: 'counter', catalogId: 'basin-wall', label: 'Wash basin', at: { x: 7.12, z: 2.03 }, facing: 'S' },
    { id: 'wc-master', kind: 'counter', catalogId: 'wc-western', label: 'Western commode', at: { x: 7.77, z: 2.16 }, facing: 'S' },
    { id: 'shower-master', kind: 'counter', catalogId: 'shower-over', label: 'Shower', at: { x: 8.61, z: 1.98 }, facing: 'S' },
    // deck
    { id: 'chair-deck-1', kind: 'sofa', catalogId: 'armchair', label: 'Armchair', at: { x: 1.02, z: 7.2 }, facing: 'S' },
    { id: 'chair-deck-2', kind: 'sofa', catalogId: 'armchair', label: 'Armchair', at: { x: 2.64, z: 7.24 }, facing: 'S' },
  ],
  ac: [
    { room: 'living-dining', wall: 'E', at: 5.21 },
    { room: 'master-bedroom', wall: 'E', at: 6.08 },
    { room: 'bedroom-1', wall: 'W', at: 6.0 },
  ],
  notes: [
    "Reading: the main door is in the foyer's north wall; the foyer is open to the living and dining room along its east side below the kitchen, as the plan draws it.",
    "Reading: the pale line between the kitchen and the utility is a doorless opening 0.9 m wide.",
    "Reading: the master bedroom is entered from the 'master bed passage' through a doorless opening; the 'passage' and the 'master bed passage' are the two printed rectangles of one strip.",
    "Not drawn: the utility's pale east edge (a jali, not a window onto outside) and a hob (no catalogue piece); the deck's west pier is drawn solid.",
  ],
};
