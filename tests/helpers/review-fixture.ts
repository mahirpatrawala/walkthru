// A small understanding file with its machine outputs, written by hand for the review tests (C12e). Every number is invented here and
// chosen so the arithmetic is checkable: a 4.0 x 3.0 m bedroom, a 3 x 2.5 m kitchen that the drawing's scale verified, a lounge whose label
// and walls disagree, a three-bay wardrobe whose bay widths and shutter counts are unverified until a broker looks, a ceiling nobody found.
import type { LayoutProposal, Vec2 } from '../../src/types';
import type { ProposalExtras } from '../../src/import/types';
import type { Method, Status, Extracted } from '../../src/understand/types';
import type { UnderstandingDoc } from '../../src/understand/review-model';
import type { BaseOutputs } from '../../src/understand/review-apply';
import { normalizeRoom } from '../../src/core/layout-validate';

export const IN = 0.0254;
let n = 0;
const ex = <T,>(value: T, o: { method?: Method; status?: Status; conf?: number; page?: number; bbox?: [number, number, number, number]; text?: string; alt?: Extracted<T>['alternatives']; unit?: Extracted<T>['unit'] } = {}): Extracted<T> => ({
  id: `x${String(++n).padStart(3, '0')}`, value, unit: o.unit, method: o.method ?? 'vector', status: o.status ?? 'unverified', confidence: o.conf ?? 0.3,
  source: { page: o.page ?? 1, view: `p${o.page ?? 1}`, sheet: '', bbox: o.bbox ?? [10 * n, 10, 10 * n + 30, 40], ...(o.text ? { text: o.text } : {}) }, checks: [], ...(o.alt ? { alternatives: o.alt } : {}),
});
const rect = (x0: number, z0: number, w: number, d: number): Vec2[] => [{ x: x0, z: z0 }, { x: x0 + w, z: z0 }, { x: x0 + w, z: z0 + d }, { x: x0, z: z0 + d }];

export interface Fixture { doc: UnderstandingDoc; base: BaseOutputs; ids: Record<string, string> }
export function makeFixture(): Fixture {
  n = 0;
  const bed = ex(3.0, { unit: 'm' }), bedL = ex(4.0, { unit: 'm' }), bedA = ex(12, { unit: 'm2' });
  const kit = ex(2.5, { method: 'pdf-text', status: 'verified', conf: 0.99, unit: 'm' }), kitL = ex(3.0, { method: 'pdf-text', status: 'verified', conf: 0.99, unit: 'm' }), kitA = ex(7.5, { method: 'pdf-text', status: 'verified', conf: 0.99, unit: 'm2' });
  const src = { page: 1, view: 'p1', sheet: '', bbox: [200, 10, 260, 60] as [number, number, number, number], text: "12'0\" x 9'0\"" };
  const lou = ex(2.7, { status: 'conflict', conf: 0.6, unit: 'm', alt: [{ value: 9 * 0.3048, method: 'pdf-text', source: src }] }), louL = ex(3.5, { status: 'conflict', conf: 0.6, unit: 'm', alt: [{ value: 12 * 0.3048, method: 'pdf-text', source: src }] }), louA = ex(9.45, { status: 'conflict', conf: 0.6, unit: 'm2' });
  const door = ex(0.9, { unit: 'm' }), doorT = ex('door'), win = ex(1.2, { unit: 'm' }), winT = ex('window');
  const wardW = ex(2.4, { unit: 'm' }), wardD = ex(0.6, { unit: 'm' });
  const bays = ex(3, { method: 'pdf-text', unit: 'count' }), bw = [0, 1, 2].map((i) => ex(31 * IN, { method: 'pdf-text', unit: 'm', conf: 0.4, bbox: [300 + i * 40, 200, 330 + i * 40, 230], page: 2 }));
  const shut = [0, 1, 2].map(() => ex(2, { method: 'pdf-text', unit: 'count', conf: 0.4, page: 2 }));
  const hinge = [0, 1, 2].map(() => ex<'left' | 'right' | 'outer-edges' | 'unknown'>('outer-edges', { method: 'vector', conf: 0.4, page: 2 }));
  const wardH = ex(2.13, { method: 'pdf-text', unit: 'm', conf: 0.4, page: 2 });
  const ceil = ex(2.75, { method: 'derived', conf: 0.1, unit: 'm', bbox: [0, 0, 0, 0] });
  const dimA = ex(0.9, { method: 'pdf-text', status: 'conflict', conf: 0.6, unit: 'm', text: "3'0\"", alt: [{ value: 0.8, method: 'vector', source: { page: 1, view: 'p1', sheet: '', bbox: [5, 5, 25, 15] } }] });
  const dimB = ex(3.0, { method: 'pdf-text', status: 'verified', conf: 0.99, unit: 'm', text: "9'10\"" });
  const dimC = ex(1.2, { method: 'glyph', conf: 0.4, unit: 'm', text: "3'11\"" });
  const label = (t: string): Extracted<string> => ex(t, { method: 'pdf-text', conf: 0.4 });
  const doc: UnderstandingDoc = {
    version: 1, input: { kind: 'vector-pdf', pages: 2, sha256: 'f'.repeat(64) },
    views: [{ id: 'p1', page: 1, kind: 'plan', kindConfidence: 0.8, raster: false }, { id: 'p2', page: 2, kind: 'elevation', kindConfidence: 0.8, raster: false }],
    dimensions: [{ id: 'dim-a', view: 'p1', a: [0, 0], b: [1, 0], value: dimA }, { id: 'dim-b', view: 'p1', a: [0, 0], b: [1, 0], value: dimB }, { id: 'dim-c', view: 'p1', a: [0, 0], b: [1, 0], value: dimC }],
    rooms: [
      { id: 'bedroom-a', label: label('Bedroom A'), roomType: ex('bedroom', { method: 'derived' }), polygonM: rect(0, 0, 4, 3).map((p) => [p.x, p.z]), width: bed, length: bedL, area: bedA },
      { id: 'kitchen', label: label('Kitchen'), roomType: ex('kitchen', { method: 'derived' }), polygonM: rect(4.2, 0, 3, 2.5).map((p) => [p.x, p.z]), width: kit, length: kitL, area: kitA },
      { id: 'lounge', label: label('Lounge'), roomType: ex('living', { method: 'derived' }), polygonM: rect(0, 3.2, 2.7, 3.5).map((p) => [p.x, p.z]), width: lou, length: louL, area: louA },
    ],
    openings: [
      { id: 'door-1', roomId: 'bedroom-a', type: doorT, width: door },
      { id: 'window-1', roomId: 'bedroom-a', type: winT, width: win },
    ],
    items: [{
      id: 'wardrobe-1', kind: ex('wardrobe'), label: label('Wardrobe'), box: { cx: 0.3, cz: 1.5, w: wardW, d: wardD, yawDeg: 90 }, height: wardH,
      unit: { bays, bayWidths: bw, shuttersPerBay: shut, hinge },
    }],
    symbols: [], ceiling: ceil,
    conflicts: [{ id: 'c1', field: 'rooms.lounge.size', values: ["12'0\" x 9'0\"", '2.70 x 3.50 m'], message: 'The label says 12\'0" x 9\'0", but the walls measure 2.70 x 3.50 m.' }],
    warnings: [],
  };
  const rooms = doc.rooms.map((r) => normalizeRoom({ id: r.id, roomType: r.roomType.value as 'bedroom', label: r.label.value, polygon: r.polygonM.map(([x, z]) => ({ x, z })), edges: ['wall', 'wall', 'wall', 'wall'] }));
  const proposal: LayoutProposal = {
    version: 1, source: 'drawing-import@1', rooms,
    openings: [
      { id: 'door-1', roomId: 'bedroom-a', edge: 2, type: 'door', centreM: 1.0, widthM: 0.9, sillM: 0, headM: 2.1 },
      { id: 'window-1', roomId: 'bedroom-a', edge: 0, type: 'window', centreM: 2.0, widthM: 1.2, sillM: 0.9, headM: 2.1 },
    ],
    wallHeightM: 2.75, confidence: 0.4, notes: ['Ceiling height not found on the elevation pages. Using 2.75 m. Confirm it.'],
  };
  const extras: ProposalExtras = {
    version: 1, sourceFile: 'drawing set', planPage: 1, scale: { ptPerM: 49, votes: [], agreeing: 3, disagreementPct: 0.4 },
    rooms: [
      { id: 'bedroom-a', label: 'Bedroom A', roomType: 'bedroom', method: 'walls', confidence: 0.7, areaM2: 12 },
      { id: 'kitchen', label: 'Kitchen', roomType: 'kitchen', method: 'walls', confidence: 0.9, areaM2: 7.5, labelDims: { w: 2.5, l: 3 } },
      { id: 'lounge', label: 'Lounge', roomType: 'living', method: 'walls', confidence: 0.5, areaM2: 9.45, labelDims: { w: 2.7, l: 3.5 } },
    ],
    ceiling: { heightM: 2.75, method: 'default', page: null, candidatesM: [], confidence: 0.1 },
    furniture: [{ id: 'wardrobe-1', source: 'real', kind: 'wardrobe', label: 'Wardrobe', heightM: 2.13, surfaceHeightM: 2.13, box: { cx: 0.3, cz: 1.5, w: 2.4, d: 0.6, yawDeg: 90 } }],
    unmapped: [], spawn: null, warnings: ['Ceiling height not found on the elevation pages. Using 2.75 m. Confirm it.', 'Scale rests on one label. Check a door width.'],
  };
  const ids = {
    bedroom: bed.id, kitchen: kit.id, lounge: lou.id, door: door.id, window: win.id, wardrobe: wardW.id, ceiling: ceil.id,
    dimA: dimA.id, dimB: dimB.id, dimC: dimC.id, bay0: bw[0].id, bay1: bw[1].id, bay2: bw[2].id, bays: bays.id, shut0: shut[0].id, shut1: shut[1].id, shut2: shut[2].id,
    hinge0: hinge[0].id, hinge1: hinge[1].id, hinge2: hinge[2].id, wardH: wardH.id,
  };
  return { doc, base: { proposal, extras, designs: { version: 1, source: 'Imported drawing set, 2 pages', items: {} } }, ids };
}
