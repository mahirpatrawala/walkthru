import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { EditorContext } from '../src/editor/context';
import { frameTimes, fitSize } from '../src/editor/frames';
import {
  OPENING_PRESETS, clampOpening, cycleEdgeKind, defaultLabel, makeRoom, moveOpening, nearestEdge, nextId, placeOpening,
  rectInfo, rectPolygon, resizeRect, rescaleDraft, retypeRoom, snapPoint, tentativePxPerM, tileText,
} from '../src/editor/plan-helpers';
import { applyProposal, extrasWarnings, prepareSave, proposalToPatch, replaceDraft, sceneIdValid } from '../src/editor/save';
import { addRoomToDraft, removeRoomFromDraft, resizeRoomInDraft } from '../src/editor/steps/rooms';
import { openingAt, placeOpeningInDraft } from '../src/editor/steps/openings';
import { scaleMessage, setDimensions } from '../src/editor/steps/scale';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { createEmptyProperty, validateProperty } from '../src/core/layout-validate';
import { parseLength } from '../src/core/units';
import { polygonArea } from '../src/core/geometry';
import type { PropertyFile, RoomTag } from '../src/types';

const read = (p: string): unknown => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const flat = (): PropertyFile => validateProperty(read('public/scenes/test-flat-empty/property.json'));

const rect = (id: string, x0: number, z0: number, x1: number, z1: number): RoomTag => ({
  id, roomType: 'bedroom', label: id, polygon: rectPolygon({ x: x0, z: z0 }, { x: x1, z: z1 }), edges: ['wall', 'wall', 'wall', 'wall'],
});

describe('snapping (2.2 E3)', () => {
  const rooms = [rect('a', 0, 0, 4, 5)];
  it('a point 5 px from a corner snaps to the corner', () => {
    const pxPerMetre = 60;
    const near = { x: 4 + 5 / pxPerMetre, z: 5 - 3 / pxPerMetre }; // ~5.8 px away
    const r = snapPoint(near, { rooms, pxPerMetre, hasUnderlay: true });
    expect(r.kind).toBe('corner');
    expect(r.point).toEqual({ x: 4, z: 5 });
    const exact5 = snapPoint({ x: 4 + 5 / pxPerMetre, z: 5 }, { rooms, pxPerMetre, hasUnderlay: false });
    expect(exact5.point).toEqual({ x: 4, z: 5 });
  });
  it('snaps to an edge within 8 px, and not beyond', () => {
    const pxPerMetre = 100;
    const r = snapPoint({ x: 2.017, z: 0.05 }, { rooms, pxPerMetre, hasUnderlay: true });
    expect(r.kind).toBe('edge');
    expect(r.point.x).toBeCloseTo(2.017, 9);
    expect(r.point.z).toBeCloseTo(0, 9);
    const far = snapPoint({ x: 2.017, z: 0.09 }, { rooms, pxPerMetre, hasUnderlay: true });
    expect(far.kind).toBe('none');
  });
  it('otherwise snaps to the 5 cm grid when there is no plan image', () => {
    const r = snapPoint({ x: 7.012, z: 3.234 }, { rooms, pxPerMetre: 60, hasUnderlay: false });
    expect(r.kind).toBe('grid');
    expect(r.point.x).toBeCloseTo(7.0, 9);
    expect(r.point.z).toBeCloseTo(3.25, 9);
  });
  it('with a plan image and nothing near, the point is untouched', () => {
    const p = { x: 7.012, z: 3.234 };
    const r = snapPoint(p, { rooms, pxPerMetre: 60, hasUnderlay: true });
    expect(r).toEqual({ point: p, kind: 'none' });
  });
  it('the corners of the polygon being drawn are snap targets too', () => {
    const r = snapPoint({ x: 10.01, z: 10.01 }, { rooms: [], pxPerMetre: 60, hasUnderlay: true, extraPoints: [{ x: 10, z: 10 }] });
    expect(r.point).toEqual({ x: 10, z: 10 });
  });
});

describe('rectangles and typed sizes (2.2 E3)', () => {
  it('rectPolygon always has positive area and keeps the first click as polygon[0]', () => {
    for (const [a, b] of [[{ x: 0, z: 0 }, { x: 4, z: 5 }], [{ x: 4, z: 5 }, { x: 0, z: 0 }], [{ x: 0, z: 5 }, { x: 4, z: 0 }], [{ x: 4, z: 0 }, { x: 0, z: 5 }]]) {
      const p = rectPolygon(a, b);
      expect(polygonArea(p)).toBeCloseTo(20, 9);
      expect(p[0]).toEqual(a);
    }
  });
  it('resizes from a typed size about the first corner', () => {
    const room = rect('a', 1, 2, 5, 7); // first corner (1,2), 4 x 5
    const w = parseLength(`13'1"`)!;
    const l = parseLength(`16'5"`)!;
    const next = resizeRect(room, w, l)!;
    expect(next.polygon[0]).toEqual({ x: 1, z: 2 });
    const info = rectInfo(next)!;
    expect(info.w).toBeCloseTo(w, 9);
    expect(info.l).toBeCloseTo(l, 9);
    expect(polygonArea(next.polygon)).toBeGreaterThan(0);
    expect(next.edges).toEqual(room.edges);
  });
  it('resizing keeps the rectangle growing the same way when it was drawn right to left, bottom to top', () => {
    const room: RoomTag = { ...rect('b', 0, 0, 1, 1), polygon: rectPolygon({ x: 5, z: 7 }, { x: 1, z: 2 }) };
    const next = resizeRect(room, 3, 2)!;
    expect(next.polygon[0]).toEqual({ x: 5, z: 7 });
    const xs = next.polygon.map((p) => p.x);
    const zs = next.polygon.map((p) => p.z);
    expect(Math.min(...xs)).toBeCloseTo(2, 9); expect(Math.max(...xs)).toBeCloseTo(5, 9);
    expect(Math.min(...zs)).toBeCloseTo(5, 9); expect(Math.max(...zs)).toBeCloseTo(7, 9);
    expect(polygonArea(next.polygon)).toBeCloseTo(6, 9);
  });
  it('is null for a room that is not a rectangle', () => {
    const tri: RoomTag = { id: 't', roomType: 'other', label: 't', polygon: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 0, z: 3 }], edges: ['wall', 'wall', 'wall'] };
    expect(resizeRect(tri, 2, 2)).toBeNull();
    expect(rectInfo(tri)).toBeNull();
  });
  it('resizeRoomInDraft keeps an opening on its edge when the edge shrinks', () => {
    const p = createEmptyProperty('x');
    const r = addRoomToDraft(p.layout, rectPolygon({ x: 0, z: 0 }, { x: 4, z: 5 }), 'bedroom');
    const o = placeOpeningInDraft(p.layout, { x: 3.9, z: 0 }, OPENING_PRESETS[0], 0.2)!;
    expect(o.edge).toBe(0);
    expect(o.centreM).toBeCloseTo(3.55, 9);
    resizeRoomInDraft(p.layout, r.id, 2, 5);
    const after = p.layout.openings[0];
    expect(after.centreM + after.widthM / 2).toBeLessThanOrEqual(2 + 1e-9);
  });
  it('tile helper text', () => {
    expect(tileText(6.5, 600)).toBe('6.5 tiles × 600 mm = 3.90 m');
  });
});

describe('rooms: defaults, type changes, edge kinds', () => {
  it('a balcony drawn beside a room gets railings on the edges that face nothing', () => {
    const p = createEmptyProperty('x');
    addRoomToDraft(p.layout, rectPolygon({ x: 0, z: 0 }, { x: 4, z: 5 }), 'bedroom');
    const b = addRoomToDraft(p.layout, rectPolygon({ x: 0.5, z: -1.62 }, { x: 3.5, z: -0.12 }), 'balcony');
    expect(b.label).toBe('Balcony 1');
    expect(b.edges.filter((k) => k === 'railing')).toHaveLength(3);
    expect(b.edges.filter((k) => k === 'wall')).toHaveLength(1);
  });
  it('retypeRoom re-derives edges only when they were still the defaults', () => {
    const p = createEmptyProperty('x');
    addRoomToDraft(p.layout, rectPolygon({ x: 0, z: 0 }, { x: 4, z: 5 }), 'bedroom');
    const r = addRoomToDraft(p.layout, rectPolygon({ x: 0.5, z: -1.62 }, { x: 3.5, z: -0.12 }), 'other', 'Sit-out');
    expect(retypeRoom(p.layout, r, 'balcony').edges.filter((k) => k === 'railing')).toHaveLength(3);
    const custom = { ...r, edges: ['none', 'wall', 'wall', 'wall'] as RoomTag['edges'] };
    expect(retypeRoom(p.layout, custom, 'balcony').edges).toEqual(custom.edges);
  });
  it('ids and labels never clash; edge kinds cycle', () => {
    expect(nextId('room', ['room-1', 'room-4'])).toBe('room-5');
    expect(defaultLabel('bedroom', [{ label: 'Bedroom 1' } as RoomTag])).toBe('Bedroom 2');
    expect([cycleEdgeKind('wall'), cycleEdgeKind('railing'), cycleEdgeKind('none')]).toEqual(['railing', 'none', 'wall']);
  });
  it('delete removes the room and its openings', () => {
    const p = createEmptyProperty('x');
    const r = addRoomToDraft(p.layout, rectPolygon({ x: 0, z: 0 }, { x: 4, z: 5 }), 'bedroom');
    placeOpeningInDraft(p.layout, { x: 2, z: 5 }, OPENING_PRESETS[1], 0.3);
    removeRoomFromDraft(p.layout, r.id);
    expect(p.layout.rooms).toHaveLength(0);
    expect(p.layout.openings).toHaveLength(0);
  });
});

describe('opening placement (2.2 E4)', () => {
  const p = createEmptyProperty('x');
  const room = addRoomToDraft(p.layout, rectPolygon({ x: 0, z: 0 }, { x: 4, z: 5 }), 'bedroom');
  it('goes on the nearest edge, centred on the click', () => {
    const o = placeOpening(p.layout, { x: 1.3, z: 4.96 }, OPENING_PRESETS[1], 0.2)!;
    expect(o.roomId).toBe(room.id);
    expect(o.edge).toBe(2); // z = 5, running from (4,5) to (0,5)
    expect(o.centreM).toBeCloseTo(4 - 1.3, 9);
    expect(o).toMatchObject({ type: 'door', widthM: 0.8, sillM: 0, headM: 2.1 });
  });
  it('centreM is clamped so the opening stays on the edge', () => {
    const o = placeOpening(p.layout, { x: 0.05, z: 5.02 }, OPENING_PRESETS[0], 0.3)!;
    expect(o.centreM).toBeCloseTo(4 - 0.05 > 4 - 0.45 ? 4 - 0.45 : 0, 9); // click 0.05 from the far corner: centre = len - w/2
    expect(o.centreM + o.widthM / 2).toBeLessThanOrEqual(4 + 1e-9);
    const w = placeOpening(p.layout, { x: 4.02, z: 4.99 }, OPENING_PRESETS[4], 0.3)!;
    expect(w.centreM - w.widthM / 2).toBeGreaterThanOrEqual(-1e-9);
    expect(w.type).toBe('window');
    expect(w.sillM).toBe(0.9);
  });
  it('is null when no edge is near, and an edge shorter than the preset narrows it', () => {
    expect(placeOpening(p.layout, { x: 2, z: 2.5 }, OPENING_PRESETS[0], 0.3)).toBeNull();
    const tiny = createEmptyProperty('y');
    addRoomToDraft(tiny.layout, rectPolygon({ x: 0, z: 0 }, { x: 0.5, z: 3 }), 'other');
    const o = placeOpening(tiny.layout, { x: 0.25, z: 0 }, OPENING_PRESETS[3], 0.3)!;
    expect(o.widthM).toBeCloseTo(0.5, 9);
    expect(o.centreM).toBeCloseTo(0.25, 9);
  });
  it('can be found, dragged along its edge, and clamped', () => {
    const q = createEmptyProperty('z');
    addRoomToDraft(q.layout, rectPolygon({ x: 0, z: 0 }, { x: 4, z: 5 }), 'bedroom');
    const o = placeOpeningInDraft(q.layout, { x: 2, z: 0 }, OPENING_PRESETS[1], 0.3)!;
    expect(openingAt(q.layout, { x: 2.1, z: 0.05 }, 0.2)?.id).toBe(o.id);
    expect(openingAt(q.layout, { x: 3.5, z: 0 }, 0.2)).toBeNull();
    const moved = moveOpening(q.layout, o, { x: 3.9, z: 2 });
    expect(moved.centreM).toBeCloseTo(4 - 0.4, 9);
    expect(moved.edge).toBe(o.edge);
    expect(clampOpening(q.layout, { ...o, widthM: 9 }).widthM).toBeCloseTo(4, 9);
  });
  it('nearestEdge prefers the selected room in the gap between two rooms', () => {
    const q = createEmptyProperty('w');
    const a = addRoomToDraft(q.layout, rectPolygon({ x: 0, z: 0 }, { x: 4, z: 5 }), 'bedroom');
    const b = addRoomToDraft(q.layout, rectPolygon({ x: 0, z: 5.12 }, { x: 4, z: 6.32 }), 'other');
    const mid = { x: 2, z: 5.06 };
    expect(nearestEdge(q.layout, mid, 0.2, { preferRoomId: b.id })!.roomId).toBe(b.id);
    expect(nearestEdge(q.layout, mid, 0.2, { preferRoomId: a.id })!.roomId).toBe(a.id);
  });
});

describe('scale change keeps the layout glued to the plan image', () => {
  it('rescaleDraft multiplies coordinates and edge distances, not typed sizes', () => {
    const p = flat();
    p.furniture = [{ id: 'f', source: 'real', kind: 'wardrobe', label: 'w', box: { cx: 1, cz: 2, w: 1.2, d: 0.6, yawDeg: 0 }, heightM: 2.1, surfaceHeightM: 2.1 }];
    const before = JSON.parse(JSON.stringify(p)) as PropertyFile;
    rescaleDraft(p, 1.1);
    expect(p.layout.rooms[0].polygon[1].x).toBeCloseTo(before.layout.rooms[0].polygon[1].x * 1.1, 9);
    expect(p.layout.openings[0].centreM).toBeCloseTo(before.layout.openings[0].centreM * 1.1, 9);
    expect(p.layout.openings[0].widthM).toBe(before.layout.openings[0].widthM);
    expect(p.furniture[0].box.cx).toBeCloseTo(1.1, 9);
    expect(p.furniture[0].box.w).toBe(1.2);
  });
  it('setDimensions derives the scale, rescales rooms, and reports the disagreement', () => {
    const p = createEmptyProperty('s');
    p.layout.underlay = { file: 'plan.png', pxPerM: 50, originPx: { x: 100, y: 100 }, dimensions: [], disagreementPct: 0 };
    addRoomToDraft(p.layout, rectPolygon({ x: 0, z: 0 }, { x: 4, z: 5 }), 'bedroom'); // drawn at 50 px/m: 200 x 250 px
    const ctx = { draft: p, commit() {}, applyUnderlay() {}, loadScene: async () => ({ found: false }) } as unknown as EditorContext;
    const r = setDimensions(ctx, [
      { a: { x: 0, y: 0 }, b: { x: 212, y: 0 }, lengthM: 4 },
      { a: { x: 0, y: 0 }, b: { x: 0, y: 265 }, lengthM: 5 },
    ])!;
    expect(r.pxPerM).toBeCloseTo(53, 9);
    expect(r.disagreementPct).toBeCloseTo(0, 9);
    expect(p.layout.underlay!.pxPerM).toBeCloseTo(53, 9);
    expect(polygonArea(p.layout.rooms[0].polygon)).toBeCloseTo(20 * (50 / 53) ** 2, 6);
    expect(p.layout.scaleSource).toBe('plan-dimensions');
    expect(scaleMessage(2, 53.06, 0.4).text).toBe('53.1 px per metre. The two dimensions agree within 0.4%.');
    expect(scaleMessage(2, 53, 4.2).text).toBe('These two disagree by 4.2%. Check what you typed, or the plan image may be stretched.');
    expect(tentativePxPerM(364, 571)).toBeCloseTo(571 / 12, 9);
  });
});

describe('save (2.2 E8, 8.2)', () => {
  const now = new Date('2026-11-12T10:00:00.000Z');
  it('the dev-API body is exactly the validateProperty round trip of the draft', () => {
    const p = flat();
    const out = prepareSave(p, stampFurniture(rasterizeLayout(p.layout), p.furniture), now);
    expect(out.errors).toEqual([]);
    const body = JSON.parse(out.body!) as PropertyFile;
    const expected = validateProperty(JSON.parse(JSON.stringify({ ...p, updatedAt: now.toISOString() })));
    expect(body).toEqual(expected);
    expect(validateProperty(body)).toEqual(body);
    expect(out.body!.endsWith('\n')).toBe(true);
  });
  it('a clockwise room in the draft blocks the save (the tools never make one; proposals are normalised on load)', () => {
    const p = flat();
    p.layout.rooms[2] = { ...p.layout.rooms[2], polygon: [...p.layout.rooms[2].polygon].reverse() };
    p.layout.openings = [];
    const out = prepareSave(p, rasterizeLayout(p.layout), now);
    expect(out.property).toBeNull();
    expect(out.errors.join(' ')).toMatch(/wrong way round/);
  });
  it('blocks without rooms, on layout errors, and when the spawn is not walkable', () => {
    const empty = createEmptyProperty('empty-one');
    expect(prepareSave(empty, rasterizeLayout(empty.layout), now).errors.join(' ')).toMatch(/at least one room/);
    const p = flat();
    p.spawn = { x: -5, z: -5, yawDeg: 0 };
    const out = prepareSave(p, rasterizeLayout(p.layout), now);
    expect(out.property).toBeNull();
    expect(out.errors.join(' ')).toMatch(/Pick a spot on the floor, away from walls/);
    const q = flat();
    q.layout.rooms.push({ ...q.layout.rooms[0], id: 'dup' });
    expect(prepareSave(q, rasterizeLayout(q.layout), now).errors.join(' ')).toMatch(/overlap/);
    const bad = flat();
    bad.id = 'Not Valid';
    expect(prepareSave(bad, rasterizeLayout(bad.layout), now).errors.join(' ')).toMatch(/not valid/);
    expect(sceneIdValid('test-flat')).toBe(true);
    expect(sceneIdValid('Test Flat')).toBe(false);
  });
});

describe('Load proposal (the C8 and Phase 2 plug)', () => {
  const proposal = (): Record<string, unknown> => ({
    version: 1, source: 'drawing-import', confidence: 0.7, notes: ['ceiling from elevation'], wallHeightM: 2.9,
    rooms: [
      { id: 'r1', roomType: 'bedroom', label: 'Guest room', polygon: [{ x: 0, z: 0 }, { x: 3.4, z: 0 }, { x: 3.4, z: 4.5 }, { x: 0, z: 4.5 }], edges: ['wall', 'wall', 'wall', 'wall'], futureField: 1 },
    ],
    openings: [{ id: 'o1', roomId: 'r1', edge: 2, type: 'door', centreM: 1, widthM: 0.8, sillM: 0, headM: 2.1 }],
    somethingNew: { a: 1 },
  });
  it('reads rooms, openings and the ceiling, ignores unknown fields', () => {
    const patch = proposalToPatch(proposal());
    expect(patch.rooms).toHaveLength(1);
    expect(patch.openings).toHaveLength(1);
    expect(patch.wallHeightM).toBe(2.9);
    expect(patch.notes).toEqual(['ceiling from elevation']);
    expect(patch.furniture).toEqual([]);
    expect(patch.spawn).toBeNull();
  });
  it('shows the sidecar warnings, tolerates a damaged sidecar, takes furniture and spawn only for a fresh draft', () => {
    const extras = {
      version: 1, warnings: ['Scale votes disagree by 9%', 42, '', 'Spawn not found'], spawn: { x: 1.5, z: 2, yawDeg: 90 },
      furniture: [{ id: 'bed-1', source: 'real', kind: 'bed', label: 'Bed', box: { cx: 1, cz: 1, w: 1.5, d: 2, yawDeg: 0 }, heightM: 0.55, surfaceHeightM: 0.5, inner: { w: 1.5, d: 1.8 } }],
      rooms: [{ weird: true }],
    };
    expect(extrasWarnings(extras)).toEqual(['Scale votes disagree by 9%', 'Spawn not found']);
    expect(extrasWarnings({ warnings: 'nope' })).toEqual([]);
    expect(extrasWarnings(null)).toEqual([]);
    const patch = proposalToPatch(proposal(), extras);
    expect(patch.notes).toEqual(['ceiling from elevation', 'Scale votes disagree by 9%', 'Spawn not found']);
    const fresh = createEmptyProperty('f');
    applyProposal(fresh, patch);
    expect(fresh.layout.rooms[0].label).toBe('Guest room');
    expect(fresh.layout.wallHeightM).toBe(2.9);
    expect(fresh.furniture).toHaveLength(1);
    expect(fresh.spawn).toEqual({ x: 1.5, z: 2, yawDeg: 90 });
    const own = flat();
    const spawnBefore = { ...own.spawn };
    applyProposal(own, patch);
    expect(own.layout.rooms).toHaveLength(1);
    expect(own.spawn).toEqual(spawnBefore);
    const bad = proposalToPatch(proposal(), { furniture: [{ nope: 1 }], spawn: 'x' });
    expect(bad.furniture).toEqual([]);
    expect(bad.notes.join(' ')).toMatch(/could not be read/);
  });
  it('a clockwise room in the proposal is normalised and its opening follows', () => {
    const pr = proposal();
    (pr.rooms as RoomTag[])[0].polygon.reverse();
    const patch = proposalToPatch(pr);
    expect(polygonArea(patch.rooms[0].polygon)).toBeGreaterThan(0);
    expect(patch.openings[0].centreM).toBeGreaterThan(0);
  });
  it('rejects what is not a proposal, with a readable message', () => {
    expect(() => proposalToPatch(null)).toThrow(/JSON object/);
    expect(() => proposalToPatch({ version: 1 })).toThrow(/no list of rooms/);
    expect(() => proposalToPatch({ rooms: [{ id: 'x' }] })).toThrow(/proposal\.json/);
  });
  it('replaceDraft keeps the object identity', () => {
    const a = createEmptyProperty('a');
    const ref = a;
    replaceDraft(a, flat());
    expect(ref).toBe(a);
    expect(a.layout.rooms.length).toBe(3);
    expect(a.splat).toBeUndefined();
  });
});

describe('frame grabbing helpers (2.2 E1)', () => {
  it('one frame per second in the middle of the second, never more than 60', () => {
    const t = frameTimes(35);
    expect(t).toHaveLength(35);
    expect(t[0]).toBeCloseTo(0.5, 9);
    expect(t[34]).toBeCloseTo(34.5, 9);
    expect(Math.max(...t)).toBeLessThan(35);
    expect(frameTimes(200)).toHaveLength(60);
    expect(Math.max(...frameTimes(200))).toBeLessThan(200);
    expect(frameTimes(0.4)).toEqual([0.2]);
    expect(frameTimes(NaN)).toEqual([0]);
  });
  it('downscales to the long side and never upscales', () => {
    expect(fitSize(720, 1280, 720)).toEqual({ w: 405, h: 720 });
    expect(fitSize(300, 200, 720)).toEqual({ w: 300, h: 200 });
  });
});
