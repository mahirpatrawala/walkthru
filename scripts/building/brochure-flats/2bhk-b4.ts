// A 2 BHK of 644 sq ft RERA carpet area, authored from the printed room sizes of a published builder brochure (its plan and its table).
// Positions are scaled off the plan's picture (about 10 cm); sizes are the printed ones. North is up the page, as printed. See flat-spec.ts.
import { printedPlan as pl, printedTable as tb } from '../flat-spec';
import type { AuthoredFlat } from '../flat-spec';

export const flat2bhkB4: AuthoredFlat = {
  typeId: '2bhk-b4',
  name: '2 BHK · 644 sq ft',
  sceneId: 'test-tower-flat-2bhk-b4',
  title: 'Flat · 2 BHK, 644 sq ft',
  origin: 'Plan follows a published builder brochure',
  carpetAreaM2: 59.85,
  carpetToleranceFrac: 0.03,
  usableAreaM2: 64.85,
  northDeg: 0,
  wallHeightM: 2.75,
  mainDoor: 'door-main',
  spawn: { x: 0.9, z: 0.9, yawDeg: 180 },
  rooms: [
    { id: 'living', label: 'Living with foyer', type: 'living', finish: 'dry', openTo: ['dining'], parts: [{ x: 0, z: 0, w: 3.05, d: 4.83, printed: pl(3.05, 4.83) }, { x: 0, z: -0.6, w: 1.39, d: 0.6, printed: pl(1.39, 0.6) }] },
    { id: 'dining', label: 'Dining', type: 'living', finish: 'dry', openTo: ['living', 'passage'], parts: [{ x: 3.05, z: 0, w: 2.22, d: 2.46, printed: pl(2.22, 2.46) }] },
    { id: 'kitchen', label: 'Kitchen', type: 'kitchen', finish: 'kitchen', parts: [{ x: 3.05, z: 2.58, w: 2.12, d: 2.52, printed: pl(2.12, 2.52) }] },
    { id: 'utility', label: 'Utility', type: 'other', finish: 'utility', parts: [{ x: 3.2, z: 5.22, w: 1.96, d: 0.69, printed: tb([6, 5], [2, 3]) }] },
    { id: 'toilet-1', label: 'Toilet 1', type: 'bathroom', finish: 'wet', parts: [{ x: 5.38, z: -0.52, w: 1.37, d: 1.97, printed: pl(1.37, 1.97) }] },
    { id: 'cupboard', label: 'Cupboard', type: 'other', finish: 'dry', openTo: ['master-passage', 'master-bedroom'], parts: [{ x: 6.87, z: 1.07, w: 3.0, d: 0.5, printed: tb([9, 10], [1, 8]) }] },
    { id: 'passage', label: 'Passage', type: 'other', finish: 'dry', openTo: ['dining', 'master-passage'], parts: [{ x: 5.27, z: 1.57, w: 1.52, d: 0.89, printed: tb([5, 0], [2, 11]) }] },
    { id: 'master-passage', label: 'Master bed passage', type: 'other', finish: 'dry', openTo: ['passage', 'cupboard'], parts: [{ x: 6.79, z: 1.57, w: 1.47, d: 0.89, printed: tb([4, 10], [2, 11]) }] },
    { id: 'master-toilet', label: 'Master toilet', type: 'bathroom', finish: 'wet', parts: [{ x: 9.99, z: -0.84, w: 1.37, d: 2.27, printed: pl(1.37, 2.27) }] },
    { id: 'master-bedroom', label: 'Master bedroom', type: 'bedroom', finish: 'dry', openTo: ['cupboard'], parts: [{ x: 8.38, z: 1.57, w: 3.05, d: 3.85, printed: pl(3.05, 3.85) }] },
    { id: 'bedroom-1', label: 'Bedroom 1', type: 'bedroom', finish: 'dry', parts: [{ x: 5.3, z: 2.58, w: 2.95, d: 2.85, printed: pl(2.95, 2.85) }] },
    { id: 'deck', label: 'Deck', type: 'balcony', finish: 'balcony', solidSides: ['W'], parts: [{ x: 0, z: 4.95, w: 2.97, d: 1.12, printed: tb([9, 9], [3, 8]) }] },
  ],
  openings: [
    { id: 'door-main', room: 'living', wall: 'N', at: 0.86, widthM: 1.0, kind: 'door', hinge: 'W', swing: 'in' },
    { id: 'open-kitchen', room: 'kitchen', wall: 'N', at: 4.15, widthM: 0.95, kind: 'opening' },
    { id: 'slide-kitchen-utility', room: 'kitchen', wall: 'S', at: 4.32, widthM: 1.5, kind: 'sliding', hinge: 'W', swing: 'in' },
    { id: 'slide-deck', room: 'living', wall: 'S', at: 1.92, widthM: 2.0, kind: 'sliding', hinge: 'W', swing: 'in' },
    { id: 'door-toilet-1', room: 'toilet-1', wall: 'S', at: 5.82, widthM: 0.68, kind: 'door', hinge: 'W', swing: 'in' },
    { id: 'door-master-toilet', room: 'master-toilet', wall: 'S', at: 11.01, widthM: 0.68, kind: 'door', hinge: 'E', swing: 'in' },
    { id: 'open-master-passage', room: 'master-bedroom', wall: 'W', at: 2.02, widthM: 0.8, kind: 'opening' },
    { id: 'door-bedroom-1', room: 'bedroom-1', wall: 'N', at: 5.86, widthM: 0.92, kind: 'door', hinge: 'W', swing: 'in' },
    { id: 'win-toilet-1', room: 'toilet-1', wall: 'E', at: 0.63, widthM: 0.58, kind: 'window', sillM: 1.5 },
    { id: 'win-master-toilet', room: 'master-toilet', wall: 'W', at: 0.31, widthM: 0.65, kind: 'window', sillM: 1.5 },
    { id: 'win-bedroom-1', room: 'bedroom-1', wall: 'S', at: 7.07, widthM: 1.77, kind: 'window' },
    { id: 'win-master-bedroom', room: 'master-bedroom', wall: 'S', at: 9.41, widthM: 1.67, kind: 'window' },
  ],
  pieces: [
    // living and dining
    { id: 'sofa-1', kind: 'sofa', catalogId: 'sofa-3', label: 'Sofa', at: { x: 0.45, z: 3.6 }, facing: 'E' },
    { id: 'ottoman-1', kind: 'sofa', label: 'Ottoman', at: { x: 1.2, z: 4.33 }, facing: 'E', w: 0.68, d: 0.71, h: 0.4 },
    { id: 'table-centre', kind: 'counter', catalogId: 'coffee-rect', label: 'Centre table', at: { x: 1.31, z: 3.22 }, facing: 'E' },
    { id: 'dining-1', kind: 'dining', catalogId: 'dining-6', label: 'Dining table with six chairs', at: { x: 3.43, z: 0.98 }, facing: 'S' },
    // kitchen and utility
    { id: 'counter-k-west', kind: 'counter', label: 'Kitchen counter', at: { x: 3.37, z: 3.33 }, facing: 'E', w: 1.41, d: 0.5 },
    { id: 'sink-1', kind: 'counter', catalogId: 'sink-single', label: 'Kitchen sink', at: { x: 3.39, z: 4.55 }, facing: 'E' },
    { id: 'fridge-1', kind: 'counter', catalogId: 'fridge-1', label: 'Fridge', at: { x: 4.84, z: 2.95 }, facing: 'W' },
    { id: 'counter-k-east', kind: 'counter', label: 'Kitchen counter with hob', at: { x: 4.89, z: 4.19 }, facing: 'W', w: 1.68, d: 0.55 },
    { id: 'washer-1', kind: 'counter', catalogId: 'washer-front', label: 'Washing machine', at: { x: 3.57, z: 5.565 }, facing: 'E' },
    // bedroom 1
    { id: 'bed-1', kind: 'bed', label: 'Bed', at: { x: 7.245, z: 4.25 }, facing: 'W', w: 1.6, d: 1.95 },
    { id: 'tv-1', kind: 'counter', catalogId: 'tv-unit-150', label: 'TV unit', at: { x: 5.5, z: 4.33 }, facing: 'E' },
    { id: 'wardrobe-1', kind: 'wardrobe', label: 'Wardrobe', at: { x: 7.24, z: 2.87 }, facing: 'S', w: 1.84, d: 0.58 },
    // master bedroom
    { id: 'bed-master', kind: 'bed', catalogId: 'bed-queen', label: 'Queen bed', at: { x: 9.45, z: 3.69 }, facing: 'E' },
    { id: 'tv-master', kind: 'counter', catalogId: 'tv-unit-180', label: 'TV unit', at: { x: 11.23, z: 3.48 }, facing: 'W' },
    { id: 'desk-master', kind: 'counter', label: 'Study table', at: { x: 10.95, z: 5.15 }, facing: 'N', w: 1.0, d: 0.5, h: 0.75 },
    { id: 'wardrobe-master', kind: 'wardrobe', label: 'Cupboard', at: { x: 8.37, z: 1.32 }, facing: 'S', w: 3.0, d: 0.5 },
    // toilets
    { id: 'wc-1', kind: 'counter', catalogId: 'wc-western', label: 'Western commode', at: { x: 6.39, z: 0.63 }, facing: 'W' },
    { id: 'basin-1', kind: 'counter', catalogId: 'basin-wall', label: 'Wash basin', at: { x: 6.48, z: 1.225 }, facing: 'N' },
    { id: 'shower-1', kind: 'counter', catalogId: 'shower-over', label: 'Shower', at: { x: 6.4, z: -0.33 }, facing: 'S' },
    { id: 'wc-master', kind: 'counter', catalogId: 'wc-western', label: 'Western commode', at: { x: 11.0, z: 0.25 }, facing: 'W' },
    { id: 'basin-master', kind: 'counter', catalogId: 'basin-wall', label: 'Wash basin', at: { x: 10.3, z: 1.205 }, facing: 'N' },
    { id: 'shower-master', kind: 'counter', catalogId: 'shower-over', label: 'Shower', at: { x: 10.28, z: -0.66 }, facing: 'S' },
    // deck
    { id: 'chair-deck-1', kind: 'sofa', catalogId: 'armchair', label: 'Armchair', at: { x: 1.25, z: 5.4 }, facing: 'S' },
    { id: 'chair-deck-2', kind: 'sofa', catalogId: 'armchair', label: 'Armchair', at: { x: 2.53, z: 5.4 }, facing: 'S' },
  ],
  ac: [
    { room: 'living', wall: 'W', at: 3.6 },
    { room: 'master-bedroom', wall: 'E', at: 3.48 },
    { room: 'bedroom-1', wall: 'W', at: 4.33 },
  ],
  notes: [
    "Reading: the main door is in the foyer's north wall, hinged at its west end (the leaf is drawn there). The foyer is only 0.60 m deep and open to the living room along its whole south side, so it is built as one part of the living room (two printed rectangles, 3.05 x 4.83 and 1.39 x 0.60).",
    "Reading: the 'cupboard' is a 3.00 x 0.50 m niche of built-in wardrobe, open to the passage and the master bedroom; the master bedroom is entered from the 'master bed passage' through a doorless opening.",
    "Reading: the long glazed strip between the kitchen and the utility is a 1.5 m sliding door.",
    "Not drawn: a second leaf drawn in the passage with no wall to hang on, and a hob (no catalogue piece); the deck's west wall is drawn solid.",
  ],
};
