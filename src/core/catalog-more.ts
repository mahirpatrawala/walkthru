// The catalogue rows added after the original table: Indian homes first, real retail sizes, one row and one rule each. The rows are
// spread onto CATALOG (src/core/catalog.ts); the rules are read through src/core/pieces.ts. Types only are imported from there, so
// the two files do not need each other when they load.
//
// Sizes are w (width, across the front) x d (depth) x h (total height), metres. `s` is the height of the thing you use: a seat, a mattress,
// a table top, a basin rim. A footprint includes the gap a piece asks for (a fridge's 5 cm for air, a washing machine's 10 cm for hoses): the
// size label says so. Honesty (SPEC 16.2): a clearance a verdict rests on is an assumption, and its text says which.
import type { AccessRule, CatalogItem, FurnitureKind, Side } from '../types';
import type { PieceCategory, PieceFamily, PieceRule, PoseKind, Zone } from './pieces';

const cm = (m: number): number => Math.round(m * 100);
const SOFA_WORDS: Record<Side, string> = { front: 'in front', back: 'behind', left: 'on the left', right: 'on the right' };
const BED_WORDS: Record<Side, string> = { front: 'at the foot', back: 'at the head', left: 'on the left', right: 'on the right' };
const DINING_WORDS: Record<Side, string> = { front: 'on the near side', back: 'on the far side', left: 'on the left', right: 'on the right' };

interface Def {
  id: string; name: string; cat: PieceCategory; kind: FurnitureKind;
  w: number; d: number; h: number; s: number;
  /** the size label when "w × d × h cm" is not the whole story */
  label?: string;
  inner?: { w: number; d: number };
  look: string; params?: Record<string, unknown>;
  family: PieceFamily | null; pose: PoseKind;
  kw: string;
  access?: AccessRule[];
  words?: 'sofa' | 'bed' | 'dining';
  prompt?: string; up?: string;
  mountY?: number; wall?: boolean; fullHeight?: boolean;
  rooms?: PieceRule['rooms']; roomNote?: string;
  zones?: Zone[]; note?: string; hung?: boolean; probe?: [number, number];
}

export interface MorePiece { row: CatalogItem; rule: PieceRule }

function piece(o: Def): MorePiece {
  const words = o.words === 'bed' ? BED_WORDS : o.words === 'dining' ? DINING_WORDS : SOFA_WORDS;
  const row: CatalogItem = {
    id: o.id, kind: o.kind, name: o.name,
    sizeLabel: o.label ?? `${cm(o.w)} × ${cm(o.d)} × ${cm(o.h)} cm`,
    footprint: { w: o.w, d: o.d }, heightM: o.h, surfaceHeightM: o.s,
    access: (o.access ?? []).map((r) => ({ sides: [...r.sides], minM: r.minM, mode: r.mode })), sideWords: { ...words },
  };
  if (o.inner) row.inner = { ...o.inner };
  const rule: PieceRule = {
    id: o.id, category: o.cat, keywords: o.kw.split(/\s+/).filter(Boolean), look: { kind: o.look, ...(o.params || o.mountY !== undefined ? { params: { ...(o.params ?? {}), ...(o.mountY !== undefined && ['cabinet', 'appliance', 'bath'].includes(o.look) ? { liftM: o.mountY } : {}) } } : {}) },
    family: o.family, pose: o.pose,
    ...(o.prompt ? { prompt: o.prompt } : {}), ...(o.up ? { upPrompt: o.up } : {}),
    ...(o.mountY !== undefined ? { mountY: o.mountY } : {}), ...(o.wall ? { wall: true } : {}), ...(o.fullHeight ? { fullHeight: true } : {}),
    ...(o.rooms ? { rooms: o.rooms } : {}), ...(o.roomNote ? { roomNote: o.roomNote } : {}),
    ...(o.zones ? { zones: o.zones } : {}), ...(o.note ? { note: o.note } : {}), ...(o.hung ? { hung: true } : {}), ...(o.probe ? { probe: o.probe } : {}),
  };
  return { row, rule };
}

// ---------------------------------------------------------------- zone recipes

const FRONT = (m: number): AccessRule => ({ sides: ['front'], minM: m, mode: 'all' });
const BED_SIDES: AccessRule = { sides: ['left', 'right'], minM: 0.6, mode: 'any' };

/** space in front to operate something: a door, a footrest, a drawer */
function operate(id: string, needM: number, assumption: Zone['assumption'], blocked: string, tight: string, opts: Partial<Zone> = {}): Zone {
  return { id, sides: ['front'], needM, where: 'in front', assumption, blockedText: blocked, tightText: tight, tightFrac: 0.75, ...opts };
}

/** a seat on chains: the chains swing `angleDeg` each way, from a hook `hang` high (the ceiling, or a frame beam) */
function arc(angleDeg: number, hang: 'ceiling' | number, seatHalfM: number, o: { sides?: Side[]; minNeedM?: number; minCeilingM?: number; where?: string; attachM?: number } = {}): Zone {
  return {
    id: 'arc', sides: o.sides ?? ['front', 'back'], needM: 0, where: o.where ?? 'in front and behind',
    assumption: `a ${angleDeg}° swing each way`, blockedText: 'it will hit {obs}', tightText: 'a full swing will brush {obs}', tightFrac: 0.75,
    swing: { angleDeg, hang, seatHalfM, seatTopM: o.attachM ?? 0.62, ...(o.minCeilingM ? { minCeilingM: o.minCeilingM } : {}) },
    ...(o.minNeedM ? { minNeedM: o.minNeedM } : {}),
  };
}

const BATH: PieceRule['rooms'] = ['bathroom'];
const WET = 'is for a bathroom (it needs a water point and a drain). This room is not a bathroom on the drawing, so check the plumbing points with your builder.';
const KIT_BATH: PieceRule['rooms'] = ['bathroom', 'kitchen'];

const tv = (id: string, name: string, w: number, tvIn: number, tvW: number, tvH: number): MorePiece => piece({
  id, name, cat: 'storage', kind: 'counter', w, d: 0.4, h: 0.8 + tvH, s: 0.45,
  label: `${cm(w)} × 40 × 45 cm unit, ${tvIn} in TV on the wall`,
  look: 'tvunit', params: { tvW, tvH }, family: 'storage', pose: 'dims', kw: `tv television unit cabinet living ${tvIn}`,
  access: [FRONT(0.5)], note: `${tvIn} in TV is ${cm(tvW)} × ${cm(tvH)} cm. The bracket height is an assumption: the bottom edge 80 cm from the floor.`,
});

export const MORE_PIECES: MorePiece[] = [
  // ------------------------------------------------------------ swing (jhoola)
  piece({
    id: 'swing-2', name: 'Jhoola, 2-seater, hung from the ceiling', cat: 'swing', kind: 'sofa', w: 1.3, d: 0.58, h: 0.95, s: 0.45,
    label: 'seat 122 × 51 cm, on four chains', look: 'swing', params: { variant: 'hung-2' }, family: 'swing', pose: 'swing', kw: 'swing jhoola jhula hanging bench chain wooden seat',
    prompt: 'Sit on the swing', up: 'Get up', zones: [arc(20, 'ceiling', 0.255, { minCeilingM: 2.3 })], hung: true, probe: [0, 0.02],
    note: 'Hanging needs a structural hook: check with your builder. The hook positions and their load are not on the drawing.',
  }),
  piece({
    id: 'swing-3', name: 'Jhoola, 3-seater, hung from the ceiling', cat: 'swing', kind: 'sofa', w: 1.6, d: 0.62, h: 0.95, s: 0.45,
    label: 'seat 152 × 56 cm, on four chains', look: 'swing', params: { variant: 'hung-3' }, family: 'swing', pose: 'swing', kw: 'swing jhoola jhula hanging bench chain wooden seat three',
    prompt: 'Sit on the swing', up: 'Get up', zones: [arc(20, 'ceiling', 0.28, { minCeilingM: 2.3 })], hung: true, probe: [0, 0.02],
    note: 'Hanging needs a structural hook: check with your builder. The hook positions and their load are not on the drawing.',
  }),
  piece({
    id: 'swing-2-frame', name: 'Jhoola, 2-seater, free-standing frame', cat: 'swing', kind: 'sofa', w: 1.55, d: 1.25, h: 1.95, s: 0.45,
    label: 'seat 122 × 51 cm, steel frame 155 × 125 × 195 cm', look: 'swing', params: { variant: 'frame-2' }, family: 'swing', pose: 'swing', kw: 'swing jhoola jhula frame stand free standing balcony steel',
    prompt: 'Sit on the swing', up: 'Get up', zones: [arc(12, 1.88, 0.255, { minNeedM: 0.3 })], probe: [0, 0.02],
    note: 'No ceiling hook needed. The frame is assumed to be 125 cm deep so the seat swings inside it.',
  }),
  piece({
    id: 'swing-3-frame', name: 'Jhoola, 3-seater, free-standing frame', cat: 'swing', kind: 'sofa', w: 1.85, d: 1.25, h: 1.95, s: 0.45,
    label: 'seat 152 × 56 cm, steel frame 185 × 125 × 195 cm', look: 'swing', params: { variant: 'frame-3' }, family: 'swing', pose: 'swing', kw: 'swing jhoola jhula frame stand free standing balcony steel three',
    prompt: 'Sit on the swing', up: 'Get up', zones: [arc(12, 1.88, 0.28, { minNeedM: 0.3 })], probe: [0, 0.02],
    note: 'No ceiling hook needed. The frame is assumed to be 125 cm deep so the seat swings inside it.',
  }),
  piece({
    id: 'hang-chair', name: 'Hanging chair, ceiling hook', cat: 'swing', kind: 'sofa', w: 0.95, d: 0.85, h: 1.15, s: 0.45,
    label: 'basket 95 × 85 cm, one hook', look: 'swing', params: { variant: 'chair-hook' }, family: 'swing', pose: 'swing', kw: 'hanging chair swing egg basket balcony hook',
    prompt: 'Sit in the hanging chair', up: 'Get up', zones: [arc(15, 'ceiling', 0.425, { sides: ['front', 'back', 'left', 'right'], minCeilingM: 2.3, where: 'all round', attachM: 0.7 })], hung: true, probe: [0, 0.15],
    note: 'Hanging needs a structural hook: check with your builder. The hook position and its load are not on the drawing.',
  }),
  piece({
    id: 'hang-chair-stand', name: 'Hanging chair, with stand', cat: 'swing', kind: 'sofa', w: 1.0, d: 1.2, h: 1.95, s: 0.45,
    label: 'basket 80 cm across, steel stand 100 × 120 × 195 cm', look: 'swing', params: { variant: 'chair-stand' }, family: 'swing', pose: 'swing', kw: 'hanging chair swing egg basket balcony stand free standing',
    prompt: 'Sit in the hanging chair', up: 'Get up', zones: [arc(15, 1.88, 0.36, { minNeedM: 0.3, attachM: 0.7 })], probe: [0, 0.2],
    note: 'No ceiling hook needed. The stand is assumed to be 120 cm deep.',
  }),

  // ------------------------------------------------------------ seating
  piece({
    id: 'recliner', name: 'Recliner', cat: 'seating', kind: 'sofa', w: 0.9, d: 0.95, h: 1.05, s: 0.47,
    label: '90 × 95 cm closed, about 150 cm long open', look: 'seatx', params: { variant: 'recliner' }, family: 'chair', pose: 'sit', kw: 'recliner reclining armchair lounge push back footrest',
    prompt: 'Sit in the recliner', up: 'Get up', access: [FRONT(0.6)],
    zones: [operate('footrest', 0.6, 'footrest out: the recliner is about 150 cm long open', 'it cannot open', 'the footrest opens only partway', { blockedText: 'the footrest cannot come out, {obs} is in the way' })],
    note: 'A wall-hugger model: it leans back without needing space behind it.', probe: [0, 0.05],
  }),
  piece({
    id: 'bean-bag', name: 'Bean bag', cat: 'seating', kind: 'sofa', w: 0.9, d: 0.9, h: 0.65, s: 0.32,
    label: '90 cm across, 65 cm high', look: 'seatx', params: { variant: 'beanbag' }, family: 'pouf', pose: 'chair', kw: 'bean bag beanbag pouf floor seat kids lounge',
    prompt: 'Sit on the bean bag', up: 'Get up', note: 'A bean bag settles as you sit: its seat is about 32 cm.', probe: [0, 0.15],
  }),
  piece({
    id: 'sofa-bed', name: 'Sofa-cum-bed, 3-seat', cat: 'seating', kind: 'sofa', w: 1.9, d: 0.9, h: 0.85, s: 0.43,
    label: '190 × 90 cm sofa, opens to 190 × 190 cm bed', look: 'seatx', params: { variant: 'sofabed' }, family: 'sofa', pose: 'sit', kw: 'sofa cum bed sofabed sofa bed pull out convertible guest',
    prompt: 'Sit on the sofa-bed', up: 'Get up', access: [FRONT(0.75)],
    zones: [operate('opened', 0, (fp) => `opened bed ${Math.round(fp.w * 100)} × ${Math.round(fp.w * 100)} cm, ${Math.round((fp.w - fp.d) * 100)} cm longer than the sofa`, 'it cannot open', 'it opens most of the way', { tightFrac: 0.85, blockedText: 'it cannot fold out, {obs} is in the way', opensToSquare: true })],
    note: 'Shown closed. The dotted outline is the bed opened.', probe: [0, 0.1],
  }),
  piece({
    id: 'bar-stool', name: 'Bar stool', cat: 'seating', kind: 'sofa', w: 0.4, d: 0.4, h: 1.05, s: 0.75,
    label: '40 × 40 cm, seat 75 cm (for a 90 cm counter)', look: 'seatx', params: { variant: 'barstool' }, family: 'chair', pose: 'chair', kw: 'bar stool barstool counter kitchen high chair',
    prompt: 'Sit on the stool', up: 'Get up', probe: [0, 0],
  }),
  piece({
    id: 'office-chair', name: 'Office chair', cat: 'seating', kind: 'sofa', w: 0.62, d: 0.62, h: 1.05, s: 0.46,
    label: '62 × 62 cm, seat 46 cm', look: 'seatx', params: { variant: 'office' }, family: 'chair', pose: 'chair', kw: 'office chair desk swivel study work computer',
    prompt: 'Sit on the chair', up: 'Get up', probe: [0, 0],
  }),

  // ------------------------------------------------------------ beds
  piece({
    id: 'bunk-bed', name: 'Bunk bed', cat: 'beds', kind: 'bed', w: 1.1, d: 1.93, h: 1.7, s: 0.45, inner: { w: 0.91, d: 1.83 },
    label: '2 × 91 × 183 cm mattresses, 170 cm high, ladder at the side', look: 'bedx', params: { variant: 'bunk' }, family: 'bunk', pose: 'lie', kw: 'bunk bed kids two level double decker ladder',
    access: [BED_SIDES], words: 'bed', prompt: 'Lie on the lower bunk', up: 'Get up', note: 'You lie on the lower bunk. The upper bunk is 85 cm above its mattress, in this standard size.',
  }),
  piece({
    id: 'bed-single-storage', name: 'Single bed with storage', cat: 'beds', kind: 'bed', w: 1.01, d: 1.93, h: 0.9, s: 0.5, inner: { w: 0.91, d: 1.83 },
    label: '91 × 183 cm (36 × 72 in), drawers under', look: 'bed', params: { base: 'box' }, family: 'bed', pose: 'lie', kw: 'single bed storage box drawers hydraulic',
    access: [BED_SIDES], words: 'bed', probe: [0, 0.2],
  }),
  piece({
    id: 'bed-queen-storage', name: 'Queen bed with storage', cat: 'beds', kind: 'bed', w: 1.62, d: 2.08, h: 0.9, s: 0.5, inner: { w: 1.52, d: 1.98 },
    label: '152 × 198 cm (60 × 78 in), hydraulic box', look: 'bed', params: { base: 'box' }, family: 'bed', pose: 'lie', kw: 'queen bed storage box hydraulic lift',
    access: [BED_SIDES], words: 'bed', probe: [0, 0.2],
  }),
  piece({
    id: 'diwan', name: 'Diwan, day bed', cat: 'beds', kind: 'bed', w: 1.0, d: 1.9, h: 0.8, s: 0.45, inner: { w: 0.9, d: 1.8 },
    label: '90 × 180 cm mattress, bolsters and back rest', look: 'bedx', params: { variant: 'diwan' }, family: 'bunk', pose: 'lie', kw: 'diwan divan day bed daybed single sofa bed bolster',
    access: [FRONT(0.6)], words: 'bed', probe: [0, 0.2],
  }),

  // ------------------------------------------------------------ storage and utility
  tv('tv-unit-120', 'TV unit 120 cm, 43 in TV', 1.2, 43, 0.95, 0.54),
  tv('tv-unit-150', 'TV unit 150 cm, 55 in TV', 1.5, 55, 1.23, 0.68),
  tv('tv-unit-180', 'TV unit 180 cm, 65 in TV', 1.8, 65, 1.45, 0.82),
  piece({
    id: 'shoe-rack', name: 'Shoe rack cabinet', cat: 'storage', kind: 'counter', w: 0.8, d: 0.33, h: 1.1, s: 1.1,
    look: 'cabinet', params: { variant: 'shoe' }, family: 'storage', pose: 'dims', kw: 'shoe rack cabinet footwear entrance foyer', access: [FRONT(0.5)],
  }),
  piece({
    id: 'mandir-floor', name: 'Pooja unit (floor)', cat: 'storage', kind: 'counter', w: 0.91, d: 0.46, h: 1.83, s: 0.85,
    label: '91 × 46 × 183 cm (3 × 1.5 × 6 ft)', look: 'cabinet', params: { variant: 'mandir-floor' }, family: 'storage', pose: 'dims', kw: 'pooja puja mandir temple prayer unit god', access: [FRONT(0.6)],
    note: 'The idol shelf is at 85 cm. A diya or incense needs a clear wall around it: not checked here.',
  }),
  piece({
    id: 'mandir-wall', name: 'Pooja mandir (wall-mounted)', cat: 'storage', kind: 'counter', w: 0.6, d: 0.3, h: 1.85, s: 1.12,
    label: '60 × 30 × 75 cm, base 110 cm from the floor', look: 'cabinet', params: { variant: 'mandir-wall' }, family: 'storage', pose: 'dims', kw: 'pooja puja mandir temple prayer wall mounted hanging god',
    mountY: 1.1, wall: true, note: 'Wall strength is not on the drawing: a mandir with idols is heavy, check with your builder.',
  }),
  piece({
    id: 'bookshelf-narrow', name: 'Bookshelf, narrow', cat: 'storage', kind: 'counter', w: 0.6, d: 0.3, h: 1.8, s: 1.8,
    look: 'cabinet', params: { variant: 'bookshelf' }, family: 'storage', pose: 'dims', kw: 'bookshelf bookcase books shelf rack library', access: [FRONT(0.5)],
  }),
  piece({
    id: 'bookshelf-wide', name: 'Bookshelf, wide', cat: 'storage', kind: 'counter', w: 1.2, d: 0.32, h: 1.8, s: 1.8,
    look: 'cabinet', params: { variant: 'bookshelf' }, family: 'storage', pose: 'dims', kw: 'bookshelf bookcase books shelf rack library wide', access: [FRONT(0.5)],
  }),
  piece({
    id: 'chest-drawers', name: 'Chest of drawers', cat: 'storage', kind: 'counter', w: 0.8, d: 0.45, h: 1.05, s: 1.05,
    label: '80 × 45 × 105 cm, 5 drawers', look: 'cabinet', params: { variant: 'chest' }, family: 'storage', pose: 'dims', kw: 'chest of drawers dresser drawers bedroom clothes',
    zones: [operate('drawers', 0.55, 'a drawer pulls out about 45 cm', 'the drawers cannot open', 'the bottom drawers open only partway')],
  }),
  piece({
    id: 'crockery-unit', name: 'Crockery unit', cat: 'storage', kind: 'counter', w: 1.2, d: 0.4, h: 1.8, s: 0.85,
    label: '120 × 40 × 180 cm, glass doors above', look: 'cabinet', params: { variant: 'crockery' }, family: 'storage', pose: 'dims', kw: 'crockery unit cabinet glass display dining utensils', access: [FRONT(0.6)],
  }),
  piece({
    id: 'sideboard', name: 'Sideboard', cat: 'storage', kind: 'counter', w: 1.5, d: 0.45, h: 0.85, s: 0.85,
    label: '150 × 45 × 85 cm', look: 'cabinet', params: { variant: 'sideboard' }, family: 'storage', pose: 'dims', kw: 'sideboard console buffet cabinet dining credenza', access: [FRONT(0.6)],
  }),
  piece({
    id: 'steel-almirah', name: 'Steel almirah', cat: 'storage', kind: 'counter', w: 0.91, d: 0.51, h: 1.98, s: 1.98,
    label: '91 × 51 × 198 cm (36 × 20 × 78 in)', look: 'cabinet', params: { variant: 'almirah' }, family: 'storage', pose: 'dims', kw: 'steel almirah cupboard locker wardrobe metal iron',
    zones: [operate('doors', 0.46, 'two doors, each 45 cm wide, opened to 90°', 'the doors cannot open', 'the doors open only partway')],
  }),
  piece({
    id: 'loft-unit', name: 'Ceiling-height loft unit', cat: 'storage', kind: 'counter', w: 1.2, d: 0.55, h: 2.4, s: 2.4,
    label: '120 × 55 cm, up to the ceiling', look: 'cabinet', params: { variant: 'loft' }, family: 'storage', pose: 'dims', kw: 'loft unit full height cupboard ceiling tall storage built in',
    fullHeight: true, access: [FRONT(0.6)], note: 'Its height is set to the ceiling when you place it, less 4 cm.',
  }),
  piece({
    id: 'ironing-board', name: 'Ironing board (open)', cat: 'storage', kind: 'counter', w: 1.3, d: 0.4, h: 0.9, s: 0.9,
    label: '130 × 40 cm open, top 90 cm', look: 'fit', params: { variant: 'ironing' }, family: 'plain', pose: 'dims', kw: 'ironing board iron press clothes utility laundry',
    zones: [operate('stand', 0.6, 'room to stand at it', 'there is no room to stand at it', 'the room to stand is tight')], note: 'Shown open, standing. Folded it is 130 × 35 × 10 cm: not drawn.',
  }),

  // ------------------------------------------------------------ tables
  piece({
    id: 'coffee-rect', name: 'Centre table', cat: 'tables', kind: 'counter', w: 1.0, d: 0.55, h: 0.42, s: 0.42,
    look: 'tablex', params: { variant: 'coffee-rect' }, family: 'table', pose: 'dims', kw: 'centre table center coffee table living room', probe: [0, 0],
  }),
  piece({
    id: 'coffee-round', name: 'Round centre table', cat: 'tables', kind: 'counter', w: 0.8, d: 0.8, h: 0.45, s: 0.45,
    label: '80 cm across, 45 cm high', look: 'tablex', params: { variant: 'coffee-round' }, family: 'table', pose: 'dims', kw: 'round centre table coffee table circular living room', probe: [0, 0],
  }),
  piece({
    id: 'dining-4', name: '4-seat dining table', cat: 'tables', kind: 'dining', w: 1.2, d: 1.48, h: 0.95, s: 0.75,
    label: '120 × 68 cm table, chairs included', look: 'dining', params: { chairs: 4 }, family: 'table', pose: 'dims', kw: 'dining table four seater 4 seat chairs',
    access: [{ sides: ['front', 'back'], minM: 0.6, mode: 'all' }], words: 'dining',
  }),
  piece({
    id: 'dining-8', name: '8-seat dining table', cat: 'tables', kind: 'dining', w: 2.4, d: 1.8, h: 0.95, s: 0.75,
    label: '240 × 100 cm table, chairs included', look: 'dining', params: { chairs: 8 }, family: 'table', pose: 'dims', kw: 'dining table eight seater 8 seat chairs large',
    access: [{ sides: ['front', 'back'], minM: 0.6, mode: 'all' }], words: 'dining',
  }),
  piece({
    id: 'dining-round-4', name: 'Round 4-seat dining table', cat: 'tables', kind: 'dining', w: 1.5, d: 1.5, h: 0.95, s: 0.75,
    label: '90 cm round table, 4 chairs', look: 'tablex', params: { variant: 'dining-round' }, family: 'table', pose: 'dims', kw: 'dining table round circular four seater 4 seat chairs',
    access: [{ sides: ['front', 'back'], minM: 0.6, mode: 'all' }], words: 'dining',
  }),
  piece({
    id: 'computer-desk', name: 'Computer desk', cat: 'tables', kind: 'counter', w: 1.2, d: 0.6, h: 1.2, s: 0.75,
    label: '120 × 60 cm, keyboard tray, shelf above', look: 'tablex', params: { variant: 'computer' }, family: 'table', pose: 'dims', kw: 'computer desk work study laptop office table keyboard',
    zones: [operate('chair', 0.6, 'room to pull a chair out', 'a chair cannot be pulled out', 'the chair has little room')], probe: [0, 0.1],
  }),
  piece({
    id: 'dressing-table', name: 'Dressing table with mirror and stool', cat: 'tables', kind: 'counter', w: 1.0, d: 0.5, h: 1.5, s: 0.76,
    label: '100 × 50 cm, mirror up to 150 cm, stool tucked under', look: 'tablex', params: { variant: 'dressing' }, family: 'table', pose: 'dims', kw: 'dressing table mirror stool vanity bedroom makeup',
    zones: [operate('stool', 0.6, 'room to pull the stool out', 'the stool cannot be pulled out', 'the stool has little room')], probe: [0.3, 0.05],
  }),

  // ------------------------------------------------------------ kitchen and appliances
  piece({
    id: 'fridge-1', name: 'Fridge, single door', cat: 'kitchen', kind: 'counter', w: 0.58, d: 0.67, h: 1.45, s: 1.45,
    label: '58 × 62 × 145 cm, plus 5 cm behind for air', look: 'appliance', params: { variant: 'fridge-1' }, family: 'appliance', pose: 'dims', kw: 'fridge refrigerator single door 230 litre kitchen',
    zones: [operate('door', 0.02, (fp) => `the door is ${Math.round(fp.w * 100)} cm wide, opened to 90°`, 'the door will not open', 'the door opens only partway', { doorOfWidth: { frac: 1 } })],
    rooms: ['kitchen', 'living', 'other'], roomNote: 'is usually in the kitchen or dining area. A fridge also needs a power socket close by, which the drawing does not show.',
  }),
  piece({
    id: 'fridge-2', name: 'Fridge, double door', cat: 'kitchen', kind: 'counter', w: 0.62, d: 0.74, h: 1.65, s: 1.65,
    label: '62 × 69 × 165 cm, plus 5 cm behind for air', look: 'appliance', params: { variant: 'fridge-2' }, family: 'appliance', pose: 'dims', kw: 'fridge refrigerator double door top freezer frost free 260 litre kitchen',
    zones: [operate('door', 0.02, (fp) => `the door is ${Math.round(fp.w * 100)} cm wide, opened to 90°`, 'the doors will not open', 'the doors open only partway', { doorOfWidth: { frac: 1 } })],
    rooms: ['kitchen', 'living', 'other'], roomNote: 'is usually in the kitchen or dining area. A fridge also needs a power socket close by, which the drawing does not show.',
  }),
  piece({
    id: 'fridge-sbs', name: 'Fridge, side by side', cat: 'kitchen', kind: 'counter', w: 0.91, d: 0.78, h: 1.78, s: 1.78,
    label: '91 × 73 × 178 cm, plus 5 cm behind for air', look: 'appliance', params: { variant: 'fridge-sbs' }, family: 'appliance', pose: 'dims', kw: 'fridge refrigerator side by side french door large 600 litre kitchen',
    zones: [operate('door', 0.025, (fp) => `two doors, each ${Math.round(fp.w * 50)} cm wide, opened to 90°`, 'the doors will not open', 'the doors open only partway', { doorOfWidth: { frac: 0.5 } })],
    rooms: ['kitchen', 'living', 'other'], roomNote: 'is usually in the kitchen or dining area. A fridge also needs a power socket close by, which the drawing does not show.',
  }),
  piece({
    id: 'washer-front', name: 'Washing machine, front load', cat: 'kitchen', kind: 'counter', w: 0.6, d: 0.7, h: 0.85, s: 0.85,
    label: '60 × 60 × 85 cm, plus 10 cm behind for hoses', look: 'appliance', params: { variant: 'washer-front' }, family: 'appliance', pose: 'dims', kw: 'washing machine washer front load laundry utility',
    zones: [operate('door', 0.6, 'the door opens about 43 cm, then room to load', 'the door will not open', 'the door opens, but loading is tight', { tightFrac: 0.75 })],
    rooms: ['bathroom', 'kitchen', 'balcony', 'other'], roomNote: 'is usually in the kitchen, a bathroom or the utility balcony. It needs a water inlet and a drain, which the drawing does not show.',
  }),
  piece({
    id: 'washer-top', name: 'Washing machine, top load', cat: 'kitchen', kind: 'counter', w: 0.56, d: 0.68, h: 0.98, s: 0.98,
    label: '56 × 58 × 98 cm, plus 10 cm behind for hoses', look: 'appliance', params: { variant: 'washer-top' }, family: 'appliance', pose: 'dims', kw: 'washing machine washer top load semi automatic laundry utility',
    zones: [operate('stand', 0.5, 'room to stand and load from the front', 'there is no room to stand at it', 'loading room is tight')],
    rooms: ['bathroom', 'kitchen', 'balcony', 'other'], roomNote: 'is usually in the kitchen, a bathroom or the utility balcony. It needs a water inlet and a drain, which the drawing does not show.',
    note: 'The lid swings up and back: keep 40 cm clear above it (a shelf above is not checked here).',
  }),
  piece({
    id: 'purifier-wall', name: 'Water purifier (wall)', cat: 'kitchen', kind: 'counter', w: 0.3, d: 0.24, h: 1.55, s: 1.55,
    label: '30 × 24 × 50 cm, base 105 cm from the floor', look: 'appliance', params: { variant: 'purifier' }, family: 'appliance', pose: 'dims', kw: 'water purifier ro aquaguard kent wall filter kitchen',
    mountY: 1.05, wall: true, rooms: ['kitchen', 'other'], roomNote: 'is fitted near the kitchen water point, with a power socket. Neither is on the drawing.',
    note: 'Needs a water point and a power socket within about 1 m: not on the drawing.',
  }),
  piece({
    id: 'microwave-unit', name: 'Microwave on stand', cat: 'kitchen', kind: 'counter', w: 0.6, d: 0.5, h: 1.13, s: 0.85,
    label: '60 × 50 cm stand, 85 cm high, microwave on top', look: 'appliance', params: { variant: 'microwave' }, family: 'appliance', pose: 'dims', kw: 'microwave oven stand trolley kitchen otg',
    zones: [operate('door', 0.45, 'the door swings out about 30 cm, plus room to reach', 'the door will not open', 'the door opens, but reaching is tight')],
  }),
  piece({
    id: 'sink-single', name: 'Kitchen sink, single bowl', cat: 'kitchen', kind: 'counter', w: 1.0, d: 0.55, h: 1.1, s: 0.85,
    label: '100 × 55 cm, bowl and drainboard, on a 85 cm unit', look: 'bath', params: { variant: 'sink-single' }, family: 'sanitary', pose: 'stand', kw: 'kitchen sink single bowl steel drainboard tap',
    prompt: 'Stand at the sink', up: 'Step back', rooms: ['kitchen', 'other'], roomNote: 'is a kitchen fitting, it needs a water point and a drain. Check the plumbing points with your builder.',
    zones: [operate('stand', 0.7, 'room to stand at it', 'there is no room to stand at it', 'the room to stand is tight')],
  }),
  piece({
    id: 'sink-double', name: 'Kitchen sink, double bowl', cat: 'kitchen', kind: 'counter', w: 1.3, d: 0.55, h: 1.1, s: 0.85,
    label: '130 × 55 cm, two bowls and drainboard, on a 85 cm unit', look: 'bath', params: { variant: 'sink-double' }, family: 'sanitary', pose: 'stand', kw: 'kitchen sink double bowl two steel drainboard tap',
    prompt: 'Stand at the sink', up: 'Step back', rooms: ['kitchen', 'other'], roomNote: 'is a kitchen fitting, it needs a water point and a drain. Check the plumbing points with your builder.',
    zones: [operate('stand', 0.7, 'room to stand at it', 'there is no room to stand at it', 'the room to stand is tight')],
  }),

  // ------------------------------------------------------------ bathroom
  piece({
    id: 'wc-western', name: 'Western commode, floor-mounted', cat: 'bathroom', kind: 'counter', w: 0.4, d: 0.72, h: 0.8, s: 0.42,
    label: '40 × 72 cm with cistern, seat at 42 cm', look: 'bath', params: { variant: 'wc-floor' }, family: 'sanitary', pose: 'dims', kw: 'wc western commode toilet floor cistern ewc water closet',
    wall: true, rooms: BATH, roomNote: WET,
    zones: [
      operate('wc-front', 0.6, 'assumed 60 cm in front and 20 cm each side', 'there is not room to use it', 'it is a squeeze to use'),
      { id: 'wc-side', sides: ['left', 'right'], needM: 0.2, where: 'on each side', assumption: 'assumed 60 cm in front and 20 cm each side', blockedText: 'there is not room to use it', tightText: 'it is a squeeze to use', tightFrac: 0.5 },
    ],
  }),
  piece({
    id: 'wc-wallhung', name: 'Wall-hung commode', cat: 'bathroom', kind: 'counter', w: 0.36, d: 0.56, h: 1.12, s: 0.4,
    label: '36 × 56 cm, seat at 40 cm, concealed cistern behind the wall', look: 'bath', params: { variant: 'wc-wall' }, family: 'sanitary', pose: 'dims', kw: 'wc western commode toilet wall hung wall mounted concealed cistern',
    mountY: 0.28, wall: true, rooms: BATH, roomNote: WET,
    zones: [
      operate('wc-front', 0.6, 'assumed 60 cm in front and 20 cm each side', 'there is not room to use it', 'it is a squeeze to use'),
      { id: 'wc-side', sides: ['left', 'right'], needM: 0.2, where: 'on each side', assumption: 'assumed 60 cm in front and 20 cm each side', blockedText: 'there is not room to use it', tightText: 'it is a squeeze to use', tightFrac: 0.5 },
    ],
    note: 'A wall-hung pan needs a frame in the wall (about 25 cm of wall depth). The drawing does not show the wall depth.',
  }),
  piece({
    id: 'wc-indian', name: 'Indian squat pan', cat: 'bathroom', kind: 'counter', w: 0.44, d: 0.58, h: 0.04, s: 0.04,
    label: '44 × 58 cm pan (orissa), flush with the floor', look: 'bath', params: { variant: 'wc-indian' }, family: 'sanitary', pose: 'dims', kw: 'indian squat pan toilet orissa wc floor',
    rooms: BATH, roomNote: WET,
    zones: [{ id: 'squat', sides: ['left', 'right'], needM: 0.25, where: 'on each side', assumption: 'assumed 25 cm each side for the feet and 45 cm in front', blockedText: 'there is not room to squat', tightText: 'it is a squeeze to use', tightFrac: 0.6 },
      operate('squat-front', 0.45, 'assumed 25 cm each side for the feet and 45 cm in front', 'there is not room to squat', 'it is a squeeze to use')],
  }),
  piece({
    id: 'health-faucet', name: 'Health faucet (jet spray)', cat: 'bathroom', kind: 'counter', w: 0.1, d: 0.12, h: 1.05, s: 1.05,
    label: 'spray on a hook, 85 cm from the floor, beside the WC', look: 'bath', params: { variant: 'health' }, family: 'sanitary', pose: 'dims', kw: 'health faucet jet spray bidet toilet hose',
    mountY: 0.85, wall: true, rooms: BATH, roomNote: WET, note: 'Fixed on the wall beside the commode, 85 cm up. Its water point is not on the drawing.',
  }),
  piece({
    id: 'basin-wall', name: 'Wash basin, wall-hung', cat: 'bathroom', kind: 'counter', w: 0.55, d: 0.45, h: 0.95, s: 0.85,
    label: '55 × 45 cm, rim at 85 cm', look: 'bath', params: { variant: 'basin-wall' }, family: 'sanitary', pose: 'stand', kw: 'wash basin sink wall hung bathroom hand wash',
    prompt: 'Stand at the basin', up: 'Step back', mountY: 0.7, wall: true, rooms: ['bathroom', 'kitchen', 'other'], roomNote: WET,
    zones: [operate('basin-front', 0.6, 'room to stand and wash', 'there is no room to stand at it', 'the room to stand is tight')],
  }),
  piece({
    id: 'basin-pedestal', name: 'Wash basin, pedestal', cat: 'bathroom', kind: 'counter', w: 0.5, d: 0.42, h: 0.95, s: 0.85,
    label: '50 × 42 cm on a pedestal, rim at 85 cm', look: 'bath', params: { variant: 'basin-pedestal' }, family: 'sanitary', pose: 'stand', kw: 'wash basin sink pedestal bathroom hand wash',
    prompt: 'Stand at the basin', up: 'Step back', wall: true, rooms: ['bathroom', 'kitchen', 'other'], roomNote: WET,
    zones: [operate('basin-front', 0.6, 'room to stand and wash', 'there is no room to stand at it', 'the room to stand is tight')],
  }),
  piece({
    id: 'vanity-60', name: 'Vanity with counter-top basin', cat: 'bathroom', kind: 'counter', w: 0.6, d: 0.48, h: 1.05, s: 0.9,
    label: '60 × 48 cm cabinet, basin rim at 90 cm', look: 'bath', params: { variant: 'vanity-60' }, family: 'sanitary', pose: 'stand', kw: 'vanity basin counter top cabinet bathroom wash',
    prompt: 'Stand at the vanity', up: 'Step back', wall: true, rooms: ['bathroom', 'other'], roomNote: WET,
    zones: [operate('basin-front', 0.6, 'room to stand and wash', 'there is no room to stand at it', 'the room to stand is tight')],
  }),
  piece({
    id: 'vanity-mirror', name: 'Vanity unit with mirror', cat: 'bathroom', kind: 'counter', w: 0.9, d: 0.46, h: 1.95, s: 0.85,
    label: '90 × 46 cm, basin at 85 cm, mirror to 195 cm', look: 'bath', params: { variant: 'vanity-mirror' }, family: 'sanitary', pose: 'stand', kw: 'vanity unit mirror basin cabinet bathroom wash light',
    prompt: 'Stand at the vanity', up: 'Step back', wall: true, rooms: ['bathroom', 'other'], roomNote: WET,
    zones: [operate('basin-front', 0.6, 'room to stand and wash', 'there is no room to stand at it', 'the room to stand is tight')],
  }),
  piece({
    id: 'shower-over', name: 'Overhead shower with mixer and arm', cat: 'bathroom', kind: 'counter', w: 0.3, d: 0.35, h: 2.1, s: 2.0,
    label: 'head at 200 cm on a 35 cm arm, mixer at 100 cm', look: 'bath', params: { variant: 'shower-over' }, family: 'sanitary', pose: 'dims', kw: 'shower overhead rain head mixer arm bathroom',
    mountY: 1.0, wall: true, rooms: BATH, roomNote: WET,
    zones: [operate('shower-area', 0.8, 'assumed a shower area 80 × 80 cm', 'there is no room to shower', 'the shower area is cramped', { widthM: 0.8 })],
  }),
  piece({
    id: 'shower-hand', name: 'Hand shower on a rail', cat: 'bathroom', kind: 'counter', w: 0.06, d: 0.1, h: 1.75, s: 1.75,
    label: 'hose and holder on a 70 cm rail, base at 105 cm', look: 'bath', params: { variant: 'shower-hand' }, family: 'sanitary', pose: 'dims', kw: 'hand shower rail hose bathroom',
    mountY: 1.05, wall: true, rooms: BATH, roomNote: WET,
  }),
  piece({
    id: 'shower-enclosure', name: 'Shower enclosure 90 × 90', cat: 'bathroom', kind: 'counter', w: 0.9, d: 0.9, h: 2.0, s: 0.05,
    label: '90 × 90 cm, glass door, 200 cm high, tray', look: 'bath', params: { variant: 'enclosure' }, family: 'sanitary', pose: 'dims', kw: 'shower enclosure cubicle glass 900 corner tray cabin',
    rooms: BATH, roomNote: WET, zones: [operate('door', 0.55, 'the glass door opens about 45 cm outward', 'the door will not open', 'the door opens only partway')],
    note: 'Two glass sides and a door: stand it in a corner, door facing out.',
  }),
  piece({
    id: 'shower-partition', name: 'Glass shower partition', cat: 'bathroom', kind: 'counter', w: 0.9, d: 0.06, h: 1.9, s: 1.9,
    label: '90 cm straight glass screen, 190 cm high', look: 'bath', params: { variant: 'partition' }, family: 'sanitary', pose: 'dims', kw: 'shower partition glass screen straight bathroom divider',
    rooms: BATH, roomNote: WET,
  }),
  piece({
    id: 'bathtub', name: 'Bathtub (optional)', cat: 'bathroom', kind: 'counter', w: 1.5, d: 0.7, h: 0.58, s: 0.55,
    label: '150 × 70 cm, rim at 55 cm', look: 'bath', params: { variant: 'tub' }, family: 'sanitary', pose: 'dims', kw: 'bathtub bath tub soak bathroom',
    rooms: BATH, roomNote: WET, zones: [operate('tub-front', 0.6, 'assumed 60 cm along the long side to step in', 'you cannot step in', 'stepping in is tight')],
  }),
  piece({
    id: 'geyser-15', name: 'Geyser, vertical 15 L', cat: 'bathroom', kind: 'counter', w: 0.31, d: 0.32, h: 2.37, s: 2.37,
    label: '31 × 32 × 47 cm, base 190 cm from the floor', look: 'appliance', params: { variant: 'geyser-15' }, family: 'appliance', pose: 'dims', kw: 'geyser water heater vertical 15 litre bathroom wall',
    mountY: 1.9, wall: true, rooms: KIT_BATH, roomNote: 'is for a bathroom or kitchen (it needs a water point and a power socket). Check the points with your builder.',
    note: 'Fixed with its base 190 cm up. Wall strength and its power point are not on the drawing.',
  }),
  piece({
    id: 'geyser-25', name: 'Geyser, vertical 25 L', cat: 'bathroom', kind: 'counter', w: 0.36, d: 0.37, h: 2.47, s: 2.47,
    label: '36 × 37 × 57 cm, base 190 cm from the floor', look: 'appliance', params: { variant: 'geyser-25' }, family: 'appliance', pose: 'dims', kw: 'geyser water heater vertical 25 litre bathroom wall',
    mountY: 1.9, wall: true, rooms: KIT_BATH, roomNote: 'is for a bathroom or kitchen (it needs a water point and a power socket). Check the points with your builder.',
    note: 'Fixed with its base 190 cm up. Wall strength and its power point are not on the drawing.',
  }),
  piece({
    id: 'towel-rail', name: 'Towel rail', cat: 'bathroom', kind: 'counter', w: 0.6, d: 0.12, h: 1.45, s: 1.45,
    label: '60 cm, two bars, base 105 cm from the floor', look: 'bath', params: { variant: 'towel' }, family: 'sanitary', pose: 'dims', kw: 'towel rail rack bathroom wall bar',
    mountY: 1.05, wall: true, rooms: KIT_BATH, roomNote: 'belongs in a bathroom.',
  }),
  piece({
    id: 'exhaust-fan', name: 'Exhaust fan', cat: 'bathroom', kind: 'counter', w: 0.25, d: 0.12, h: 2.25, s: 2.25,
    label: '25 × 25 cm (6 in), centre at 212 cm', look: 'appliance', params: { variant: 'exhaust' }, family: 'appliance', pose: 'dims', kw: 'exhaust fan ventilation bathroom kitchen wall',
    mountY: 2.0, wall: true, rooms: KIT_BATH, roomNote: 'belongs in a bathroom or kitchen, in an outer wall or a window.',
    note: 'It needs an outer wall or window to vent through: the drawing does not say which wall is outer.',
  }),
  piece({
    id: 'floor-drain', name: 'Floor drain', cat: 'bathroom', kind: 'counter', w: 0.15, d: 0.15, h: 0.01, s: 0.01,
    label: '15 × 15 cm, in the floor', look: 'bath', params: { variant: 'drain' }, family: 'sanitary', pose: 'dims', kw: 'floor drain trap bathroom outlet',
    rooms: ['bathroom', 'kitchen', 'balcony', 'other'], roomNote: 'belongs in a wet area.', note: 'Floor slope to the drain is not on the drawing.',
  }),

  // ------------------------------------------------------------ kids
  piece({
    id: 'cot', name: 'Baby cot', cat: 'kids', kind: 'bed', w: 0.7, d: 1.3, h: 0.95, s: 0.45, inner: { w: 0.6, d: 1.2 },
    label: '60 × 120 cm mattress, 70 × 130 cm cot', look: 'bedx', params: { variant: 'cot' }, family: 'bunk', pose: 'dims', kw: 'cot crib baby cradle infant nursery kids',
    access: [BED_SIDES], words: 'bed', note: 'A standard 60 × 120 cm cot mattress. The cot takes a child up to about 2 years.',
  }),
  piece({
    id: 'kids-desk', name: 'Kids study desk', cat: 'kids', kind: 'counter', w: 1.0, d: 0.5, h: 1.2, s: 0.7,
    label: '100 × 50 cm, 70 cm high, shelf above', look: 'tablex', params: { variant: 'kids-desk' }, family: 'table', pose: 'dims', kw: 'kids study desk child homework table shelf',
    zones: [operate('chair', 0.5, 'room to pull a chair out', 'a chair cannot be pulled out', 'the chair has little room')], probe: [0, 0.05],
  }),

  // ------------------------------------------------------------ balcony
  piece({
    id: 'balcony-set', name: 'Balcony set, 2 chairs and a table', cat: 'balcony', kind: 'counter', w: 1.5, d: 0.6, h: 0.85, s: 0.43,
    label: '150 × 60 cm, 2 chairs and a 60 cm round table', look: 'seatx', params: { variant: 'balcony-set' }, family: 'chair', pose: 'dims', kw: 'balcony set two chairs table bistro outdoor cane',
  }),
  piece({
    id: 'balcony-chair', name: 'Balcony chair', cat: 'balcony', kind: 'sofa', w: 0.55, d: 0.6, h: 0.85, s: 0.43,
    label: '55 × 60 cm, seat 43 cm', look: 'seatx', params: { variant: 'balcony-chair' }, family: 'chair', pose: 'chair', kw: 'balcony chair outdoor cane garden',
    prompt: 'Sit on the chair', up: 'Get up', probe: [0, 0],
  }),
  piece({
    id: 'planter-box', name: 'Planter box', cat: 'balcony', kind: 'counter', w: 0.9, d: 0.25, h: 0.45, s: 0.3,
    label: '90 × 25 cm, 30 cm box, plants to 45 cm', look: 'outdoor', params: { variant: 'box' }, family: 'plain', pose: 'dims', kw: 'planter box plants balcony garden trough',
  }),
  piece({
    id: 'planter-pot', name: 'Large planter pot', cat: 'balcony', kind: 'counter', w: 0.45, d: 0.45, h: 0.9, s: 0.45,
    label: '45 cm across, 45 cm pot, plant to 90 cm', look: 'outdoor', params: { variant: 'pot' }, family: 'plain', pose: 'dims', kw: 'planter pot plant balcony garden large',
  }),

  // ------------------------------------------------------------ fitness
  piece({
    id: 'treadmill', name: 'Treadmill', cat: 'fitness', kind: 'counter', w: 0.7, d: 1.4, h: 1.3, s: 0.15,
    label: '70 × 140 cm, console at 130 cm', look: 'fit', params: { variant: 'treadmill' }, family: 'appliance', pose: 'dims', kw: 'treadmill running exercise gym cardio walking',
    zones: [operate('runoff', 1.0, 'assumed 1 m behind the belt to step on and off safely', 'there is no safe room to step off', 'stepping off is tight', { tightFrac: 0.7 })],
    note: 'The console end goes to the wall. The belt is 130 cm long; the step-on end is the front.',
  }),
  piece({
    id: 'yoga-mat', name: 'Yoga mat', cat: 'fitness', kind: 'bed', w: 0.61, d: 1.83, h: 0.005, s: 0.005, inner: { w: 0.61, d: 1.83 },
    label: '61 × 183 cm (24 × 72 in), 5 mm thick', look: 'fit', params: { variant: 'yoga' }, family: 'plain', pose: 'lie', kw: 'yoga mat exercise stretch floor workout',
    prompt: 'Lie on the yoga mat', up: 'Get up', access: [BED_SIDES], words: 'bed', note: 'A mat lies on the floor: you can walk over it.',
  }),
];

export const MORE_ROWS: CatalogItem[] = MORE_PIECES.map((p) => p.row);
