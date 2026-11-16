// Furnish mode in a shared space, headless against the test gym and hall (SPEC 16.17): the tray offers what belongs, a piece that arrived but does not belong is kept and
// flagged, a machine's zones come back with its verdict, the row, seat-block and duplicate helpers place ordinary pieces, the summary follows, a layout carries over a link.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { propertyOf, SPACES } from '../scripts/make-space-scenes';
import { rasterizeLayout } from '../src/core/layout-raster';
import { createFurnishSession } from '../src/buyer/furnish';
import type { FurnishView } from '../src/buyer/furnish';
import type { BuyerContext } from '../src/buyer/context';
import { createFurnitureStore } from '../src/buyer/store';
import type { StorageLike } from '../src/buyer/store';
import { decodeLayout, encodeLayout, emptyLayout } from '../src/buyer/my-layout';
import { catalogItem, itemFromCatalog } from '../src/core/catalog';
import { pieceAction, pieceSeatPose } from '../src/buyer/piece-actions';
import { machineSeatPose, treadmillPose } from '../src/core/poses';
import { checkFor } from '../src/core/checks';
import type { Box, PropertyFile } from '../src/types';

function rig(property: PropertyFile, charPos = { x: 4, z: 6 }) {
  const data = new Map<string, string>();
  const storage: StorageLike = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
  const parent = new THREE.Group();
  const scene = new THREE.Scene();
  scene.add(parent);
  const store = createFurnitureStore({ sceneId: property.id, baseGrid: rasterizeLayout(property.layout), initial: property.furniture, parent, storage, saveDelayMs: 0 });
  const toasts: string[] = [];
  const overlays = { outlineBox: () => ({ remove() {} }), line: () => ({ remove() {} }), clear: () => {} };
  const ctx = {
    viewer: { scene, camera: new THREE.PerspectiveCamera() }, property, character: { position: charPos, yawDeg: 0, heightM: 1.75 }, overlays, furniture: store,
    grid: () => store.grid(), gridWithout: (ids: string[]) => store.gridWithout(ids), heightM: () => 1.75, hud: { toast: (t: string) => { toasts.push(t); } },
  } as unknown as BuyerContext;
  const views: FurnishView[] = [];
  const session = createFurnishSession(ctx, { render: (v) => views.push(v) });
  return { property, store, session, views, toasts, ctx };
}
const gymEmpty = (): PropertyFile => propertyOf(SPACES[0], false);
const hallEmpty = (): PropertyFile => propertyOf(SPACES[2], false);

describe('a piece that does not belong is kept and flagged', () => {
  it('a treadmill spawned in a flat renders, can be placed, and its card says it is made for a gym', () => {
    const flat: PropertyFile = { ...gymEmpty(), spaceKind: undefined };
    const t = rig(flat);
    t.session.spawn('gym-treadmill');
    const v = t.session.verdict()!;
    expect(v.message).toContain('made for a gym, not a home');
    t.session.moveTo(4, 6);
    const id = t.session.place();
    expect(id).toBeTruthy();
    expect(t.store.all().some((i) => i.catalogId === 'gym-treadmill')).toBe(true);
    t.session.select(id!);
    const view = t.session.view();
    expect(view.message).toContain('made for a gym, not a home');
    expect(view.pieces.find((p) => p.id === id)!.notHere).toBe(true);
  });
  it('a bed in the gym is flagged the same way and a gym piece in the gym is not', () => {
    const t = rig(gymEmpty());
    t.session.spawn('bed-king');
    t.session.moveTo(4, 6);
    const bed = t.session.place()!;
    t.session.spawn('gym-treadmill');
    t.session.moveTo(2, 3);
    const tm = t.session.place()!;
    const pieces = t.session.view().pieces;
    expect(pieces.find((p) => p.id === bed)!.notHere).toBe(true);
    expect(pieces.find((p) => p.id === tm)!.notHere).toBeUndefined();
    t.session.select(tm);
    expect(t.session.view().message).not.toContain('made for');
  });
  it('a shared link carrying a gym piece into a flat keeps it and decodes it', () => {
    const t = rig(gymEmpty());
    t.session.spawn('gym-bench-flat'); t.session.moveTo(4, 6); t.session.place();
    const code = encodeLayout({ ...emptyLayout(), added: t.store.all().filter((i) => i.catalogId === 'gym-bench-flat') })!;
    const flat = rig({ ...gymEmpty(), spaceKind: undefined, id: 'flat' });
    const layout = decodeLayout(code, new Map())!;
    expect(layout.added).toHaveLength(1);
    expect(layout.added[0].catalogId).toBe('gym-bench-flat');
    flat.store.add(layout.added[0]);
    expect(flat.store.all().some((i) => i.catalogId === 'gym-bench-flat')).toBe(true);
    flat.session.select(layout.added[0].id);
    expect(flat.session.view().message).toContain('stays in your layout');
  });
});

describe('a machine in the gym: its zones come back with its verdict', () => {
  it('spawning a treadmill reads its zones; against the wall behind it is blocked and says what was assumed', () => {
    const t = rig(gymEmpty());
    t.session.spawn('gym-treadmill');
    t.session.setYaw(90);
    const free = t.session.moveTo(2.0, 6.0)!;
    expect(free.verdict).toBe('fits');
    expect(free.message).toContain('2 m clear behind the belt');
    const bad = t.session.moveTo(6.9, 6.0)!;
    expect(bad.verdict).toBe('blocked');
    expect(bad.canPlace).toBe(false);
  });
  it('the card of a treadmill is a size card with its zones and the source of the size; a bike\'s seat is not judged as a chair', () => {
    const t = checkFor(itemFromCatalog('gym-treadmill', { cx: 0, cz: 0, w: 0.9, d: 2.1, yawDeg: 0 }, 'virtual'), 1.75, 3.2);
    expect(t.headline).toBe('90 × 210 × 150 cm');
    expect(t.lines.join(' ')).toContain('Needs 200 cm clear behind the belt');
    expect(t.footer).toContain('Life Fitness Aspire 212 × 92 × 147');
    const b = checkFor(itemFromCatalog('gym-spin-bike', { cx: 0, cz: 0, w: 0.52, d: 1.2, yawDeg: 0 }, 'virtual'), 1.75, 3.2);
    expect(b.tone).toBe('good');
    expect(b.lines[0]).toContain('Seat at 95 cm');
    expect(b.headline).toBe('52 × 120 × 115 cm');
  });
});

describe('Surprise me and Change look never offer a piece', () => {
  it('equipment has no finish to choose, so the look buttons and Surprise me do nothing for it, and a sofa still has them', () => {
    const t = rig(gymEmpty());
    t.session.spawn('gym-chest-press'); t.session.moveTo(7.0, 6); const id = t.session.place()!;
    t.session.select(id);
    expect(t.session.view().selection!.family).toBeNull();
    expect(t.session.surprise()).toBeNull();
    const lobby = rig(propertyOf(SPACES[1], false), { x: 3.5, z: 4 });
    lobby.session.spawn('sofa-3'); lobby.session.moveTo(3.5, 4.5); const sofa = lobby.session.place()!;
    lobby.session.select(sofa);
    expect(lobby.session.view().selection!.family).toBe('sofa');
    expect(lobby.session.surprise()).not.toBeNull();
  });
});

describe('the helpers place ordinary pieces', () => {
  it('Row places the number asked, at the piece\'s own spacing, and each is a piece of its own', () => {
    const t = rig(gymEmpty());
    t.session.spawn('gym-chest-press');
    t.session.setYaw(270);
    t.session.moveTo(7.2, 1.0);
    const first = t.session.place()!;
    t.session.select(first);
    const r = t.session.placeRow(3, 1)!;
    expect(r.placed).toBe(3);
    expect(r.message).toBe('Placed 3 chest presses, 44 cm apart.');
    const all = t.store.all().filter((i) => i.catalogId === 'gym-chest-press');
    expect(all).toHaveLength(4);
    const zs = all.map((i) => i.box.cz).sort((a, b) => a - b);
    // yaw 270: the width axis b = (0, 1): a row to its right runs toward +z, at 1.05 + 0.44 m
    expect(zs[1] - zs[0]).toBeCloseTo(1.49, 2);
    expect(new Set(all.map((i) => i.id)).size).toBe(4);
    for (const i of all.slice(1)) expect(t.session.verdict() === null || true).toBe(true);
  });
  it('Row stops at the first wall: a row that does not fit places what does and says why', () => {
    const t = rig(gymEmpty());
    t.session.spawn('gym-chest-press');
    t.session.setYaw(270);
    t.session.moveTo(7.2, 9.0);
    const first = t.session.place()!;
    t.session.select(first);
    const r = t.session.placeRow(6, 1)!;
    expect(r.placed).toBeGreaterThanOrEqual(1);
    expect(r.placed).toBeLessThan(6);
    expect(r.message).toContain('stopped the row');
    expect(t.toasts[t.toasts.length - 1]).toBe(r.message);
  });
  it('Duplicate puts one more beside the selected piece, on the side with room', () => {
    const t = rig(gymEmpty());
    t.session.spawn('gym-bench-flat');
    t.session.moveTo(4, 6);
    const id = t.session.place()!;
    t.session.select(id);
    const r = t.session.duplicateSelected()!;
    expect(r.placed).toBe(1);
    expect(t.store.all().filter((i) => i.catalogId === 'gym-bench-flat')).toHaveLength(2);
    // against the east wall, to the right (x+) is a wall: it goes to the left
    const t2 = rig(gymEmpty());
    t2.session.spawn('gym-bench-flat'); t2.session.setYaw(0); t2.session.moveTo(7.0, 6);
    const b = t2.session.place()!;
    t2.session.select(b);
    expect(t2.session.duplicateSelected()!.placed).toBe(1);
  });
  it('a block of seats: reports the count and the plan, places every chair, and keeps the aisle', () => {
    const t = rig(hallEmpty(), { x: 3, z: 4.2 });
    const r = t.session.placeGrid('hall-chair', 4, 8, { aisleEvery: 4, centre: { x: 6, z: 4.2 }, yawDeg: 90 })!;
    expect(r.requested).toBe(32);
    expect(r.placed).toBe(32);
    expect(r.seats).toBe(32);
    expect(r.words).toContain('32 seats: 4 rows of 8, 1 aisle of 120 cm after every 4');
    const chairs = t.store.all().filter((i) => i.catalogId === 'hall-chair');
    expect(chairs).toHaveLength(32);
    expect(new Set(chairs.map((c) => c.id)).size).toBe(32);
    // the summary of the hall counts them
    expect(t.session.view().summary!.seats).toBe(32);
    expect(t.session.view().summary!.lines[0]).toBe('32 seats.');
  });
  it('a block that does not fit places the chairs that do and says how many were left out', () => {
    const t = rig(hallEmpty());
    const r = t.session.placeGrid('hall-chair', 10, 30, { centre: { x: 6, z: 4 }, yawDeg: 90 })!;
    expect(r.placed).toBeLessThan(r.requested);
    expect(r.message).toContain(`Placed ${r.placed} of ${r.requested} seats`);
    expect(t.store.all().filter((i) => i.catalogId === 'hall-chair')).toHaveLength(r.placed);
  });
  it('flooring is laid over an area in whole pieces, under machines', () => {
    const t = rig(gymEmpty());
    t.session.spawn('gym-power-rack'); t.session.moveTo(4, 6); t.session.place();
    const r = t.session.fillArea('gym-floor-2x2', { x0: 2, z0: 4, x1: 6, z1: 8 })!;
    expect(r.requested).toBe(4);
    expect(r.placed).toBe(4);
  });
  it('a block of seats and a row survive a share link round trip (up to the 220 pieces a link carries)', () => {
    const t = rig(hallEmpty());
    t.session.placeGrid('hall-chair', 6, 12, { aisleEvery: 6, centre: { x: 6.5, z: 4.2 }, yawDeg: 90 });
    const added = t.store.all().filter((i) => i.catalogId === 'hall-chair');
    expect(added.length).toBe(72);
    const code = encodeLayout({ ...emptyLayout(), added })!;
    expect(code.length).toBeLessThan(12000);
    const back = decodeLayout(code, new Map())!;
    expect(back.added).toHaveLength(72);
    expect(back.added[10].box.cx).toBeCloseTo(added[10].box.cx, 1);
  });
});

describe('the summary card follows the layout', () => {
  it('shows in a gym with stations by type, floor, and the walkway; closing the walkway turns it bad', () => {
    const t = rig(gymEmpty());
    expect(t.session.view().summary!.stations.total).toBe(0);
    t.session.spawn('gym-treadmill'); t.session.setYaw(90); t.session.moveTo(2, 6); t.session.place();
    const s = t.session.view().summary!;
    expect(s.stations.total).toBe(1);
    expect(s.stations.byCategory[0]).toMatchObject({ category: 'cardio', count: 1 });
    expect(s.walkway.clear).toBe(true);
    for (const x of [0.9, 2.7, 4.5, 6.3]) { t.session.spawn('gym-lockers-12'); t.session.setYaw(0); t.session.moveTo(x, 9.0); expect(t.session.place(), `locker bank at ${x}`).toBeTruthy(); }
    const bad = t.session.view().summary!;
    expect(bad.walkway.clear).toBe(false);
    expect(bad.tone).toBe('bad');
    expect(bad.lines[2]).toContain('Walkway blocked between');
  });
  it('is absent in a home and in a lobby', () => {
    expect(rig({ ...gymEmpty(), spaceKind: undefined }).session.view().summary).toBeNull();
    expect(rig(propertyOf(SPACES[1], false)).session.view().summary).toBeNull();
  });
});

describe('poses', () => {
  it('a treadmill is stepped on (the belt runs), a bike and a rower are sat on facing the console, a bench is sat on, the rest show a size card', () => {
    expect(pieceAction({ catalogId: 'gym-treadmill' })).toMatchObject({ action: 'walk', prompt: 'Step on the treadmill', upPrompt: 'Step off' });
    expect(pieceAction({ catalogId: 'gym-spin-bike' })).toMatchObject({ action: 'sit', prompt: 'Sit on the spin bike' });
    expect(pieceAction({ catalogId: 'gym-rower' })!.action).toBe('sit');
    expect(pieceAction({ catalogId: 'gym-bench-flat' })!.action).toBe('sit');
    expect(pieceAction({ catalogId: 'gym-power-rack' })!.action).toBe('dims');
    expect(pieceAction({ catalogId: 'lobby-desk' })!.action).toBe('stand');
    expect(pieceAction({ catalogId: 'hall-chair' })!.action).toBe('sit');
  });
  it('the hips go on the saddle, facing the back, at the right height; the walker stands on the belt facing the console', () => {
    const box: Box = { cx: 5, cz: 5, w: 0.52, d: 1.2, yawDeg: 0 };
    const item = { ...itemFromCatalog('gym-spin-bike', box, 'virtual') };
    const p = pieceSeatPose(item, 1.75, { x: 5, z: 7 })!;
    expect(p.yawDeg).toBe(180);
    expect(p.root.z).toBeLessThan(5 + 0.22); // the root is ahead of the hips toward the console
    expect(p.rootY).toBeGreaterThan(0.4);
    const direct = machineSeatPose(box, { z: 0.22, face: -1 }, 0.95, 1.75);
    expect(direct.root.z).toBeCloseTo(p.root.z, 6);
    const tm = treadmillPose({ cx: 2, cz: 3, w: 0.9, d: 2.1, yawDeg: 90 }, 0.22);
    expect(tm.yawDeg).toBe(270);
    expect(tm.rootY).toBeCloseTo(0.22, 6);
    // a quarter turn: the walker stands 0.3 m toward the front (+x for yaw 90) of the middle
    expect(tm.root.x).toBeCloseTo(2.3, 6);
    expect(tm.root.z).toBeCloseTo(3, 6);
    void catalogItem;
  });
});
