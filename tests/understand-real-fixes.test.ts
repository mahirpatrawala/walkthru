// Fixes from the evaluation on real builder plans, each tested on synthetic input (no real file, no network): the room lexicon,
// sizes split over lines, pictures inside PDFs, wall colour choice, flats on one sheet, label-against-wall statuses.
import { describe, expect, it } from 'vitest';
import { groupTextBlocks, parseBlock } from '../src/import/labels';
import type { RoomLabel } from '../src/import/labels';
import { isPictureOfPlan } from '../src/import/vector-page';
import { selectWalls } from '../src/import/walls';
import type { ImportResult, VectorPage, VFill } from '../src/import/types';
import type { VText } from '../src/import/types';
import { isRoomLabel, roomTypeOf } from '../src/understand/lexicon';
import { parseSizeLoose } from '../src/understand/units';
import { findUnits, applyUnits } from '../src/understand/flat-units';
import { applyLabelGeometry, needsRescale } from '../src/understand/label-apply';
import type { LabelGeometry } from '../src/understand/label-geometry';
import type { Analysis } from '../src/understand/text-dims';
import type { Status } from '../src/understand/types';

const T = (str: string, x: number, y: number, size = 7): VText => ({ str, x, y, size, angle: 0, width: str.length * size * 0.55 });
const room = (texts: VText[]): RoomLabel => { const b = groupTextBlocks(texts); expect(b.length).toBe(1); return parseBlock(b[0]) as RoomLabel; };

describe('room lexicon: the words real brochures use', () => {
  it('types them', () => {
    const want: Record<string, string> = {
      'M.BEDROOM': 'bedroom', 'M BED ROOM': 'bedroom', 'M.BED ROOM': 'bedroom', MBEDROOM: 'bedroom', 'MASTER BEDROOM': 'bedroom',
      'WALK IN WARDROBE': 'other', 'WALK-IN WARDROBE': 'other', STUDY: 'other', 'STUDY ROOM': 'other',
      'DRY TERR.': 'balcony', 'DRY TERRACE': 'balcony', 'DRY BAL.': 'balcony', 'DRY BALCONY': 'balcony', 'ENC. BALCONY': 'balcony', UTILITY: 'balcony',
      'TOILET & DRESSING': 'bathroom', 'TOILET &DRESSING': 'bathroom', 'TOILET/DRESSING': 'bathroom', ANGAN: 'other', COURTYARD: 'other', CHOWK: 'other', 'SERVANT TOILET': 'bathroom',
      'SERVANT ROOM': 'bedroom', POOJA: 'other', PUJA: 'other', FOYER: 'other', 'LIVING / DINING': 'living', 'DRAWING/DINING': 'living',
    };
    for (const [s, t] of Object.entries(want)) {
      expect(roomTypeOf(s), s).toBe(t);
    }
  });
  it('a bedroom that includes an enclosed balcony is a bedroom, not a balcony', () => {
    expect(roomTypeOf('MASTER BED ROOM INCLUSIVE OF ENCLOSED BALCONY')).toBe('bedroom');
    expect(roomTypeOf('BEDROOM WITH ATTACHED TOILET')).toBe('bedroom');
    expect(roomTypeOf('BEDROOM 2 BALCONY')).toBe('balcony');
    expect(roomTypeOf('ATT. TOILET')).toBe('bathroom');
  });
  it('notes, page titles and services are not flat rooms', () => {
    for (const s of ['SOLAR PANEL', 'ELECTRICAL TRANSFORMER ROOM', 'TYPICAL UNIT PLAN NOTES', 'LIFT1', 'LIFT 2', 'ELEVATOR LOBBY', 'DISCLAIMER', 'SHAFT']) expect(isRoomLabel(s), s).toBe(false);
    expect(roomTypeOf('LIFT1')).toBe('other');
    expect(roomTypeOf('TRANSFORMER ROOM')).not.toBe('bedroom');
  });
});

describe('sizes written over several lines, and names that stay clean', () => {
  it('3800 over x4125 under a name is one size in millimetres, and the name has no numbers', () => {
    const l = room([T('MASTER BEDROOM', 100, 100), T('3800', 100, 110), T('x4125', 100, 120)]);
    expect(l.name).toBe('Master Bedroom'); expect(l.roomType).toBe('bedroom');
    expect(l.dims!.w).toBeCloseTo(3.8, 3); expect(l.dims!.l).toBeCloseTo(4.125, 3);
  });
  it('3800 x on one line and 4125 under it also joins', () => {
    const l = room([T('KITCHEN', 100, 100), T('2400 x', 100, 110), T('3100', 100, 120)]);
    expect(l.dims!.w).toBeCloseTo(2.4, 3); expect(l.dims!.l).toBeCloseTo(3.1, 3);
  });
  it('a lone dimension-line number near a label is not pulled in', () => {
    const blocks = groupTextBlocks([T('BEDROOM', 100, 100), T("11'0\"X12'0\"", 100, 110), T('3600', 100, 124)]);
    const labels = blocks.map((b) => parseBlock(b)).filter(Boolean);
    expect(labels.length).toBeGreaterThanOrEqual(1);
    const l = labels.find((x) => x!.kind === 'room') as RoomLabel;
    expect(l.name).toBe('Bedroom'); expect(l.dims!.w).toBeCloseTo(3.353, 2);
  });
  it('a name that carries its size twice (metres and feet) keeps neither in the name', () => {
    const l = room([T('TOILET', 100, 100), T("1.59X2.40 5'3\"X7'11\"", 100, 110)]);
    expect(l.name).toBe('Toilet'); expect(l.dims!.w).toBeCloseTo(1.59, 2);
  });
  it('a bed label with a room-sized size is the bedroom', () => {
    const l = room([T('BED', 100, 100), T("12'0\"X10'0\"", 100, 110)]);
    expect(l.kind).toBe('room'); expect(l.roomType).toBe('bedroom');
  });
  it('two bare numbers over 8 are feet, not a 12 m room', () => {
    expect(parseSizeLoose('12 x 10')!.w).toBeCloseTo(3.658, 3);
    expect(parseSizeLoose('3.6 x 2.4')!.w).toBeCloseTo(3.6, 3);
    expect(parseSizeLoose('3600 x 2400')!.l).toBeCloseTo(2.4, 3);
  });
});

const fill = (color: string, x: number, y: number, w: number, h: number): VFill => ({ color, rings: [[{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]], area: w * h, bbox: [x, y, x + w, y + h] });
const page = (fills: VFill[], over: Partial<VectorPage> = {}): VectorPage => ({ index: 0, width: 600, height: 400, fills, strokes: [], texts: [], imageCoverage: 0, ...over });

describe('a picture placed in a PDF', () => {
  it('is told by picture area against line work, not by covering half the page', () => {
    expect(isPictureOfPlan(page([], { imageCoverage: 0.41 }))).toBe(true);
    expect(isPictureOfPlan(page(Array.from({ length: 96 }, (_, i) => fill('#fff', i, 0, 3, 3)), { imageCoverage: 0.23 }))).toBe(true);
    expect(isPictureOfPlan(page([], { imageCoverage: 0.6 }))).toBe(true);
    // a vector plan with a logo, or with a rendered image under it, is not
    const strokes = Array.from({ length: 400 }, () => ({ color: '#000', width: 1, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false, hasCurve: false }));
    expect(isPictureOfPlan(page([], { imageCoverage: 0.2, strokes }))).toBe(false);
    expect(isPictureOfPlan(page([], { imageCoverage: 0.03 }))).toBe(false);
  });
});

describe('which fill colour is the walls', () => {
  it('a dark thin frame is the wall; the big light floor fills and the white paper are not', () => {
    const fills: VFill[] = [fill('#e0dbce', 20, 20, 560, 360), fill('#ffffff', 0, 0, 600, 400), fill('#eae3ca', 30, 30, 200, 150)];
    const t = 8;
    fills.push(fill('#282828', 20, 20, 560, t), fill('#282828', 20, 372, 560, t), fill('#282828', 20, 20, t, 360), fill('#282828', 572, 20, t, 360), fill('#282828', 300, 20, t, 360), fill('#282828', 20, 200, 560, t));
    const w = selectWalls(page(fills));
    expect(w.colors).toEqual(['#282828']);
    expect(w.rejectedColors.some((r) => r.color === '#ffffff')).toBe(true);
  });
});

const roomsAt = (spec: [string, number, number, number, number][]): ImportResult => ({
  proposal: { version: 1, source: 't', rooms: spec.map(([id, x, z, w, l]) => ({ id, roomType: 'other', label: id.replace(/\d+$/, ''), polygon: [{ x, z }, { x: x + w, z }, { x: x + w, z: z + l }, { x, z: z + l }], edges: [] })) as never, openings: [], wallHeightM: 2.75, confidence: 1, notes: [] },
  extras: { version: 1, sourceFile: 't', planPage: 1, scale: { ptPerM: 1, votes: [], agreeing: 0, disagreementPct: 0 }, rooms: [], ceiling: { heightM: 2.75, method: 'default', page: null, candidatesM: [], confidence: 0.1 }, furniture: [], unmapped: [], spawn: null, warnings: [] },
});
const flatRooms = (dx: number, dz: number, tag: string): [string, number, number, number, number][] => [[`bedroom${tag}`, dx, dz, 3.5, 3.4], [`kitchen${tag}`, dx + 3.7, dz, 2.8, 2.4], [`toilet${tag}`, dx + 3.7, dz + 2.6, 1.6, 2.4], [`living${tag}`, dx, dz + 3.6, 3.5, 4]];

describe('several flats on one sheet', () => {
  it('a floor plate is split into flats, shared lobbies are left out, and the import says so', () => {
    const r = roomsAt([...flatRooms(0, 0, '1'), ...flatRooms(12, 0, '2'), ...flatRooms(0, 14, '3'), ['lobby1', 8.2, 5, 2, 2]]);
    const u = findUnits(r);
    expect(u.length).toBe(3);
    expect(u.every((x) => x.roomIds.length === 4)).toBe(true);
    expect(u.flatMap((x) => x.roomIds)).not.toContain('lobby1');
    applyUnits(r);
    expect(r.extras.units!.length).toBe(3);
    expect(r.extras.warnings[0]).toMatch(/3 flats/);
  });
  it('one flat stays one flat, and a stray balcony joins the flat beside it', () => {
    expect(findUnits(roomsAt(flatRooms(0, 0, '1')))).toEqual([]);
    const u = findUnits(roomsAt([...flatRooms(0, 0, '1'), ...flatRooms(14, 0, '2'), ['balcony1', 3.5, 8, 1.4, 2]]));
    expect(u.length).toBe(2);
    expect(u.find((x) => x.roomIds.includes('balcony1'))!.roomIds.length).toBe(5);
  });
});

describe('label against walls: statuses and scale', () => {
  const lg = (over: Partial<LabelGeometry> = {}): LabelGeometry => ({ fit: { sx: 40, sy: 40, mode: 'iso', inliers: 5, total: 6, dimInliers: 0, spread: 0.01, ok: true, notToScale: false, aniso: false }, measures: [], status: new Map(), notes: new Map(), ptPerM: 40, ...over });
  const analysis = (m: [string, Status][] = []): Analysis => ({ dims: [], pages: [], planFit: null, roomStatus: new Map(m), warnings: [] });
  it('the importer keeps its scale when its own votes agree; a guess is replaced by the fitted one', () => {
    const r = roomsAt([]); r.extras.scale = { ptPerM: 127, votes: [], agreeing: 0, disagreementPct: 0 };
    expect(needsRescale(r, lg())).toBe(true);
    r.extras.scale = { ptPerM: 42, votes: [{ source: 'dimension lines', ptPerM: 42 }], agreeing: 4, disagreementPct: 1 };
    expect(needsRescale(r, lg())).toBe(false);
    r.extras.scale = { ptPerM: 40.5, votes: [], agreeing: 0, disagreementPct: 0 };
    expect(needsRescale(r, lg())).toBe(false);
    expect(needsRescale(r, lg({ ptPerM: null, fit: null }))).toBe(false);
  });
  it('verified fills in only where nothing was said, a conflict always wins, a traced room that disagrees is a conflict', () => {
    const r = roomsAt([]);
    r.extras.rooms = [
      { id: 'a', label: 'A', roomType: 'bedroom', method: 'label-rect', confidence: 1, areaM2: 1 },
      { id: 'b', label: 'B', roomType: 'bedroom', method: 'label-rect', confidence: 1, areaM2: 1 },
      { id: 'c', label: 'C', roomType: 'bedroom', method: 'walls', confidence: 1, areaM2: 1, labelDims: { w: 3, l: 4 }, drawnDims: { w: 3.5, l: 4 } },
      { id: 'd', label: 'D', roomType: 'bedroom', method: 'walls', confidence: 1, areaM2: 1 },
    ];
    const a = analysis([['b', 'verified']]);
    applyLabelGeometry(r, a, lg({ status: new Map<string, Status>([['a', 'verified'], ['b', 'conflict'], ['d', 'verified']]), notes: new Map([['b', 'label says 3 x 4 m, the walls measure 3.5 x 4 m']]) }));
    expect(a.roomStatus.get('a')).toBe('verified');
    expect(a.roomStatus.get('b')).toBe('conflict');
    expect(a.roomStatus.get('c')).toBe('conflict');
    expect(a.roomStatus.get('d')).toBe('verified');
    expect(r.extras.warnings.join(' ')).toMatch(/walls measure/);
  });
  it('with no fit nothing is verified', () => {
    const a = analysis(); applyLabelGeometry(roomsAt([]), a, lg({ fit: null, ptPerM: null, status: new Map<string, Status>([['a', 'verified']]) }));
    expect(a.roomStatus.size).toBe(0);
  });
});
