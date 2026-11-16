// A 3 BHK of 930 sq ft RERA carpet area, authored from the printed room sizes of a published builder brochure (its plan and its table).
// Positions are scaled off the plan's picture (about 10 cm); sizes are the printed ones. North is up the page, as printed. See flat-spec.ts.
import { printedPlan as pl, printedTable as tb } from '../flat-spec';
import type { AuthoredFlat } from '../flat-spec';

export const flat3bhkB: AuthoredFlat = {
  typeId: '3bhk-b',
  name: '3 BHK · 930 sq ft',
  sceneId: 'test-tower-flat-3bhk-b',
  title: 'Flat · 3 BHK, 930 sq ft',
  origin: 'Plan follows a published builder brochure',
  carpetAreaM2: 86.4,
  carpetToleranceFrac: 0.03,
  usableAreaM2: 89.81,
  northDeg: 0,
  wallHeightM: 2.75,
  mainDoor: 'door-main',
  spawn: { x: 10.74, z: 1.9, yawDeg: 180 },
  rooms: [
    { id: 'master-bedroom', label: 'Master bedroom', type: 'bedroom', finish: 'dry', parts: [{ x: 0, z: 1.56, w: 3.15, d: 5.27, printed: tb([10, 4], [17, 3]) }] },
    { id: 'master-toilet', label: 'Master toilet', type: 'bathroom', finish: 'wet', parts: [{ x: 0.22, z: 0, w: 2.37, d: 1.37, printed: pl(2.37, 1.37) }] },
    { id: 'master-passage', label: 'Master bed passage', type: 'other', finish: 'dry', openTo: ['passage'], parts: [{ x: 3.27, z: 1.56, w: 0.99, d: 1.07, printed: tb([3, 3], [3, 6]) }] },
    { id: 'passage', label: 'Passage', type: 'other', finish: 'dry', openTo: ['master-passage', 'dining'], parts: [{ x: 4.26, z: 1.56, w: 2.01, d: 1.07, printed: tb([6, 7], [3, 6]) }] },
    { id: 'toilet-2', label: 'Toilet 2', type: 'bathroom', finish: 'wet', parts: [{ x: 3.95, z: 0, w: 2.12, d: 1.37, printed: pl(2.12, 1.37) }] },
    { id: 'dining', label: 'Dining', type: 'living', finish: 'dry', openTo: ['passage', 'living'], parts: [{ x: 6.27, z: 0, w: 2.24, d: 2.6, printed: pl(2.24, 2.6) }] },
    { id: 'living', label: 'Living', type: 'living', finish: 'dry', openTo: ['dining'], parts: [{ x: 8.51, z: 0, w: 3.05, d: 5.6, printed: pl(3.05, 5.6) }] },
    { id: 'bedroom-2', label: 'Bedroom 2', type: 'bedroom', finish: 'dry', parts: [{ x: 3.24, z: 2.73, w: 2.75, d: 4.05, printed: pl(2.75, 4.05) }] },
    { id: 'kitchen', label: 'Kitchen', type: 'kitchen', finish: 'kitchen', parts: [{ x: 6.08, z: 2.73, w: 2.34, d: 4.05, printed: pl(2.34, 4.05) }] },
    { id: 'bedroom-1', label: 'Bedroom 1', type: 'bedroom', finish: 'dry', parts: [{ x: 11.71, z: 2.62, w: 2.75, d: 3.34, printed: pl(2.75, 3.34) }] },
    { id: 'toilet-1', label: 'Toilet 1', type: 'bathroom', finish: 'wet', parts: [{ x: 14.58, z: 2.62, w: 1.37, d: 2.27, printed: pl(1.37, 2.27) }] },
    { id: 'balcony', label: 'Balcony', type: 'balcony', finish: 'balcony', parts: [{ x: 8.51, z: 5.72, w: 3.12, d: 1.09, printed: tb([10, 3], [3, 7]) }] },
  ],
  openings: [
    { id: 'door-main', room: 'living', wall: 'N', at: 10.74, widthM: 1.0, kind: 'door', hinge: 'E', swing: 'in' },
    { id: 'slide-balcony', room: 'living', wall: 'S', at: 10.0, widthM: 2.5, kind: 'sliding', hinge: 'W', swing: 'in' },
    { id: 'open-master-passage', room: 'master-bedroom', wall: 'E', at: 2.1, widthM: 1.0, kind: 'opening' },
    { id: 'open-kitchen', room: 'kitchen', wall: 'N', at: 7.1, widthM: 1.15, kind: 'opening' },
    { id: 'door-master-toilet', room: 'master-toilet', wall: 'S', at: 2.19, widthM: 0.78, kind: 'door', hinge: 'E', swing: 'in' },
    { id: 'door-toilet-2', room: 'toilet-2', wall: 'S', at: 5.66, widthM: 0.74, kind: 'door', hinge: 'E', swing: 'in' },
    { id: 'door-bedroom-2', room: 'bedroom-2', wall: 'N', at: 5.52, widthM: 0.9, kind: 'door', hinge: 'E', swing: 'in' },
    { id: 'door-bedroom-1', room: 'bedroom-1', wall: 'W', at: 3.05, widthM: 0.75, kind: 'door', hinge: 'N', swing: 'in' },
    { id: 'door-toilet-1', room: 'toilet-1', wall: 'W', at: 2.99, widthM: 0.65, kind: 'door', hinge: 'N', swing: 'in' },
    { id: 'win-master-bedroom', room: 'master-bedroom', wall: 'S', at: 1.6, widthM: 1.87, kind: 'window' },
    { id: 'win-bedroom-2', room: 'bedroom-2', wall: 'S', at: 4.72, widthM: 2.3, kind: 'window' },
    { id: 'win-bedroom-1', room: 'bedroom-1', wall: 'S', at: 13.09, widthM: 1.7, kind: 'window' },
  ],
  pieces: [
    // master bedroom
    { id: 'bed-master', kind: 'bed', catalogId: 'bed-queen', label: 'Queen bed', at: { x: 2.07, z: 4.53 }, facing: 'W' },
    { id: 'wardrobe-master', kind: 'wardrobe', label: 'Wardrobe', at: { x: 0.75, z: 1.85 }, facing: 'S', w: 1.36, d: 0.58 },
    { id: 'tv-master', kind: 'counter', catalogId: 'tv-unit-180', label: 'TV unit', at: { x: 0.2, z: 4.75 }, facing: 'E' },
    { id: 'desk-master', kind: 'counter', label: 'Study table', at: { x: 0.9, z: 6.58 }, facing: 'N', w: 1.0, d: 0.5, h: 0.75 },
    // bedroom 2
    { id: 'bed-2', kind: 'bed', catalogId: 'bed-double', label: 'Double bed', at: { x: 4.985, z: 5.08 }, facing: 'W' },
    { id: 'tv-2', kind: 'counter', catalogId: 'tv-unit-150', label: 'TV unit', at: { x: 3.44, z: 4.99 }, facing: 'E' },
    { id: 'wardrobe-2', kind: 'wardrobe', label: 'Wardrobe', at: { x: 4.17, z: 3.0 }, facing: 'S', w: 1.7, d: 0.5 },
    // bedroom 1
    { id: 'bed-1', kind: 'bed', label: 'Bed', at: { x: 13.48, z: 4.2 }, facing: 'W', w: 1.55, d: 1.9 },
    { id: 'tv-1', kind: 'counter', label: 'TV unit', at: { x: 11.86, z: 4.2 }, facing: 'E', w: 1.5, d: 0.3, h: 0.5 },
    // living and dining
    { id: 'sofa-1', kind: 'sofa', catalogId: 'sofa-3', label: 'Sofa', at: { x: 8.96, z: 4.36 }, facing: 'E' },
    { id: 'ottoman-1', kind: 'sofa', label: 'Ottoman', at: { x: 9.5, z: 5.2 }, facing: 'E', w: 0.75, d: 0.55, h: 0.4 },
    { id: 'table-centre', kind: 'counter', catalogId: 'coffee-rect', label: 'Centre table', at: { x: 9.81, z: 3.99 }, facing: 'E' },
    { id: 'ottoman-2', kind: 'sofa', label: 'Ottoman', at: { x: 9.93, z: 2.81 }, facing: 'E', w: 0.7, d: 0.7, h: 0.4 },
    { id: 'tv-living', kind: 'counter', catalogId: 'tv-unit-150', label: 'TV unit', at: { x: 11.36, z: 4.57 }, facing: 'W' },
    { id: 'dining-1', kind: 'dining', catalogId: 'dining-6', label: 'Dining table with six chairs', at: { x: 8.13, z: 1.03 }, facing: 'S' },
    // kitchen
    { id: 'fridge-1', kind: 'counter', catalogId: 'fridge-1', label: 'Fridge', at: { x: 8.085, z: 3.14 }, facing: 'W' },
    { id: 'counter-k-east', kind: 'counter', label: 'Kitchen counter with hob', at: { x: 8.13, z: 4.95 }, facing: 'W', w: 2.54, d: 0.58 },
    { id: 'sink-1', kind: 'counter', catalogId: 'sink-single', label: 'Kitchen sink', at: { x: 6.6, z: 6.505 }, facing: 'N' },
    { id: 'counter-k-south', kind: 'counter', label: 'Kitchen counter', at: { x: 7.47, z: 6.505 }, facing: 'N', w: 0.74, d: 0.55 },
    // toilets
    { id: 'wc-master', kind: 'counter', catalogId: 'wc-western', label: 'Western commode', at: { x: 1.6, z: 0.36 }, facing: 'S' },
    { id: 'basin-master', kind: 'counter', catalogId: 'basin-wall', label: 'Wash basin', at: { x: 2.28, z: 0.225 }, facing: 'S' },
    { id: 'shower-master', kind: 'counter', catalogId: 'shower-over', label: 'Shower', at: { x: 0.59, z: 0.2 }, facing: 'S' },
    { id: 'wc-2', kind: 'counter', catalogId: 'wc-western', label: 'Western commode', at: { x: 5.13, z: 0.36 }, facing: 'S' },
    { id: 'basin-2', kind: 'counter', catalogId: 'basin-wall', label: 'Wash basin', at: { x: 5.75, z: 0.225 }, facing: 'S' },
    { id: 'shower-2', kind: 'counter', catalogId: 'shower-over', label: 'Shower', at: { x: 4.47, z: 0.2 }, facing: 'S' },
    { id: 'wc-1', kind: 'counter', catalogId: 'wc-western', label: 'Western commode', at: { x: 15.59, z: 3.66 }, facing: 'W' },
    { id: 'basin-1', kind: 'counter', catalogId: 'basin-wall', label: 'Wash basin', at: { x: 15.4, z: 2.845 }, facing: 'S' },
    // balcony
    { id: 'chair-balcony-1', kind: 'sofa', catalogId: 'armchair', label: 'Armchair', at: { x: 9.78, z: 6.25 }, facing: 'S' },
    { id: 'chair-balcony-2', kind: 'sofa', catalogId: 'armchair', label: 'Armchair', at: { x: 11.02, z: 6.25 }, facing: 'S' },
  ],
  ac: [
    { room: 'living', wall: 'E', at: 4.57 },
    { room: 'master-bedroom', wall: 'W', at: 4.75 },
    { room: 'bedroom-2', wall: 'W', at: 4.99 },
    { room: 'bedroom-1', wall: 'W', at: 4.2 },
  ],
  notes: [
    "Reading: the master bedroom has no door leaf; its entrance from the 'master bed passage' is a doorless opening 1.0 m wide, which makes the printed passage sizes and the wall between add up.",
    "Reading: a leaf drawn in the passage above bedroom 2's wall, with a post, is not a second door of bedroom 2; bedroom 2's door is the leaf at the east end of its north wall, which the cut-away render shows.",
    "Reading: the main door is in the living room's north wall at its east end (the leaf is drawn there and the render shows it open).",
    "Reading: the printed kitchen width is built exactly; the dark bar along its west wall in the plan is read as a wall with cupboards, not as floor.",
    "Not drawn: toilet 1's window and the glass shower partitions the render shows (no printed position), and a hob (no catalogue piece).",
  ],
};
