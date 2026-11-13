// C3: the pure parts of the buyer page (no WebGL, no DOM): nearest interactable, room chip text, rooms sheet text,
// height + placed-items persistence with an injected storage object, the furniture store, measure labels.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTruthProperty } from '../scripts/make-test-room';
import { itemFromCatalog } from '../src/core/catalog';
import { rasterizeLayout } from '../src/core/layout-raster';
import { cellValue } from '../src/core/grid-codec';
import { createGrid } from '../src/core/grid-codec';
import { ModeManager } from '../src/buyer/context';
import type { BuyerMode } from '../src/buyer/context';
import { cellColor } from '../src/buyer/debug';
import { measureResult } from '../src/buyer/measure';
import { outlineGeometry } from '../src/buyer/overlays';
import { roomsSummary } from '../src/buyer/rooms';
import {
  HEIGHT_KEY, actionFor, clampHeightCm, createFurnitureStore, distanceToBox, loadHeightCm, loadPlaced, nearestInteractable,
  nearestPresetIndex, parsePlaced, placedKey, roomChipText, saveHeightCm, savePlaced, tintForHeightCm, wallBetween,
} from '../src/buyer/store';
import type { StorageLike } from '../src/buyer/store';
import { GRID_VOID } from '../src/types';
import type { FurnitureItem } from '../src/types';

function fakeStorage(seed: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

const furnished = buildTruthProperty('furnished');
const empty = buildTruthProperty('empty');
const layout = empty.layout;
const bed = furnished.furniture.find((f) => f.kind === 'bed')!;
const sofa = furnished.furniture.find((f) => f.kind === 'sofa')!;

describe('items behind a wall are not offered', () => {
  const g = createGrid(0, 0, 40, 40);
  // a full-height wall along x = 1.0, 10 cm thick, over z 0..2
  for (let j = 0; j < 40; j++) for (let i = 20; i < 22; i++) g.cells[j * g.nx + i] = 250;
  const box = { cx: 1.4, cz: 1.0, w: 0.5, d: 0.5, yawDeg: 0 };
  const side: FurnitureItem = { ...bed, id: 'side', box };
  it('wallBetween sees the wall, and not an open line', () => {
    expect(wallBetween(g, { x: 0.7, z: 1.0 }, box)).toBe(true);
    expect(wallBetween(g, { x: 1.7, z: 1.0 }, box)).toBe(false);
    expect(wallBetween(g, { x: 1.4, z: 1.0 }, box)).toBe(false); // inside
  });
  it('nearestInteractable skips it only when given the grid', () => {
    expect(nearestInteractable([side], { x: 0.7, z: 1.0 }, 1.0)?.item.id).toBe('side');
    expect(nearestInteractable([side], { x: 0.7, z: 1.0 }, 1.0, g)).toBeNull();
    expect(nearestInteractable([side], { x: 1.7, z: 1.0 }, 1.0, g)?.item.id).toBe('side');
  });
});

describe('nearest interactable (within 1.0 m of the footprint)', () => {
  it('picks the bed when standing 0.6 m from its side, the sofa near the east wall', () => {
    // bed box: centre (1.0, 2.25), 1.5 wide (z) x 2.0 deep (x), yaw 90: occupies x 0..2, z 1.5..3.0
    const nb = nearestInteractable(furnished.furniture, { x: 1.0, z: 3.6 });
    expect(nb?.item.id).toBe(bed.id);
    expect(nb!.distM).toBeCloseTo(0.6, 6);
    const ns = nearestInteractable(furnished.furniture, { x: 2.9, z: 3.5 });
    expect(ns?.item.id).toBe(sofa.id);
  });
  it('is 0 inside the footprint', () => {
    const n = nearestInteractable(furnished.furniture, { x: 1.0, z: 2.25 });
    expect(n?.item.id).toBe(bed.id);
    expect(n!.distM).toBe(0);
  });
  it('returns null beyond 1.0 m, and the limit is inclusive', () => {
    expect(nearestInteractable(furnished.furniture, { x: 1.0, z: 4.1 })).toBeNull(); // 1.1 m from the bed
    expect(nearestInteractable(furnished.furniture, { x: 1.0, z: 4.0 })?.item.id).toBe(bed.id); // exactly 1.0
    expect(nearestInteractable([], { x: 0, z: 0 })).toBeNull();
  });
  it('picks the nearer of two items, and the nearer centre on a tie', () => {
    const a: FurnitureItem = { ...bed, id: 'a', box: { cx: 0, cz: 0, w: 1, d: 1, yawDeg: 0 } };
    const b: FurnitureItem = { ...sofa, id: 'b', box: { cx: 2, cz: 0, w: 1, d: 1, yawDeg: 0 } };
    expect(nearestInteractable([a, b], { x: 0.9, z: 0 })?.item.id).toBe('a');
    expect(nearestInteractable([a, b], { x: 1.6, z: 0 })?.item.id).toBe('b');
    // overlapping boxes, the point inside both: the nearer centre wins
    const c: FurnitureItem = { ...sofa, id: 'c', box: { cx: 0.3, cz: 0, w: 1, d: 1, yawDeg: 0 } };
    expect(nearestInteractable([a, c], { x: 0.1, z: 0 })?.item.id).toBe('a');
    expect(nearestInteractable([a, c], { x: 0.2, z: 0 })?.item.id).toBe('c');
  });
  it('respects the box rotation', () => {
    const wide: FurnitureItem = { ...bed, id: 'w', box: { cx: 0, cz: 0, w: 2, d: 0.5, yawDeg: 0 } };
    const turned: FurnitureItem = { ...wide, id: 't', box: { ...wide.box, yawDeg: 90 } };
    expect(distanceToBox({ x: 1.5, z: 0 }, wide.box)).toBeCloseTo(0.5, 9);
    expect(distanceToBox({ x: 1.5, z: 0 }, turned.box)).toBeCloseTo(1.25, 9);
  });
  it('maps every kind to its prompt', () => {
    expect(actionFor('bed')).toMatchObject({ action: 'lie', prompt: 'Lie on the bed', upPrompt: 'Get up' });
    expect(actionFor('sofa')).toMatchObject({ action: 'sit', prompt: 'Sit on the sofa', upPrompt: 'Get up' });
    expect(actionFor('counter')).toMatchObject({ action: 'stand', prompt: 'Stand at the counter', upPrompt: 'Step back' });
    expect(actionFor('dining')).toMatchObject({ action: 'dims', prompt: 'See dimensions' });
    expect(actionFor('wardrobe')).toMatchObject({ action: 'dims', prompt: 'See dimensions' });
  });
});

describe('room chip text', () => {
  it('reads the three rooms exactly', () => {
    expect(roomChipText(layout, { x: 2, z: 2.5 })).toBe('Bedroom 1 · 215 sq ft · 20.0 m²');
    expect(roomChipText(layout, { x: 2, z: -1 })).toBe('Balcony · 48 sq ft · 4.5 m²');
    expect(roomChipText(layout, { x: 2, z: 5.7 })).toBe('Passage · 52 sq ft · 4.8 m²');
  });
  it('is null in a doorway, in a wall and outside', () => {
    expect(roomChipText(layout, { x: 0.85, z: 5.06 })).toBeNull();
    expect(roomChipText(layout, { x: 2.0, z: -0.06 })).toBeNull();
    expect(roomChipText(layout, { x: 40, z: 40 })).toBeNull();
  });
});

describe('rooms sheet', () => {
  it('lists the rooms and the carpet area', () => {
    const s = roomsSummary(layout);
    expect(s.rows.map((r) => `${r.label}|${r.sqft}|${r.m2}`)).toEqual(['Bedroom 1|215|20.0', 'Balcony|48|4.5', 'Passage|52|4.8']);
    expect(s.carpetLine).toBe('Carpet area (rooms, excluding balcony): 267 sq ft · 24.8 m²');
    expect(s.footer).toBe('Sizes from the floor plan. Colours approximate (from phone video).');
  });
});

describe('height', () => {
  it('clamps to 140..200 whole cm and falls back to 175 for junk', () => {
    expect(clampHeightCm(120)).toBe(140);
    expect(clampHeightCm(230)).toBe(200);
    expect(clampHeightCm(175.4)).toBe(175);
    expect(clampHeightCm(Number.NaN)).toBe(175);
  });
  it('a custom height takes the tint of the nearest preset', () => {
    expect(tintForHeightCm(160)).toBe('#1FA3A3');
    expect(tintForHeightCm(167)).toBe('#1FA3A3');
    expect(tintForHeightCm(168)).toBe('#E8823A');
    expect(tintForHeightCm(182)).toBe('#E8823A');
    expect(tintForHeightCm(183)).toBe('#7A5AF0');
    expect(tintForHeightCm(200)).toBe('#7A5AF0');
    expect(nearestPresetIndex(140)).toBe(0);
  });
  it('round-trips through an injected storage, and ignores junk', () => {
    const st = fakeStorage();
    expect(loadHeightCm(st)).toBeNull();
    saveHeightCm(st, 183);
    expect(st.data.get(HEIGHT_KEY)).toBe('183');
    expect(loadHeightCm(st)).toBe(183);
    st.setItem(HEIGHT_KEY, 'tall');
    expect(loadHeightCm(st)).toBeNull();
    st.setItem(HEIGHT_KEY, '500');
    expect(loadHeightCm(st)).toBeNull();
    expect(loadHeightCm(null)).toBeNull();
  });
  it('survives a storage that throws', () => {
    const bad: StorageLike = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    expect(loadHeightCm(bad)).toBeNull();
    expect(() => saveHeightCm(bad, 170)).not.toThrow();
    expect(loadPlaced(bad, 'x')).toEqual([]);
    expect(() => savePlaced(bad, 'x', [])).not.toThrow();
  });
});

describe('placed items persistence', () => {
  const king = itemFromCatalog('bed-king', { cx: 1.06, cz: 3.415, w: 1.93, d: 2.08, yawDeg: 90 }, 'virtual');
  const sofa3 = itemFromCatalog('sofa-3', { cx: 3.5, cz: 2, w: 2.1, d: 0.9, yawDeg: 270 }, 'virtual');

  it('uses the key walkthru:<sceneId>:placed and round-trips', () => {
    const st = fakeStorage();
    savePlaced(st, 'test-flat-empty', [king, sofa3]);
    expect(st.data.has('walkthru:test-flat-empty:placed')).toBe(true);
    expect(placedKey('abc')).toBe('walkthru:abc:placed');
    const back = loadPlaced(st, 'test-flat-empty');
    expect(back).toEqual([king, sofa3]);
    expect(loadPlaced(st, 'other-scene')).toEqual([]);
  });
  it('an empty list removes the key', () => {
    const st = fakeStorage();
    savePlaced(st, 's', [king]);
    savePlaced(st, 's', []);
    expect(st.data.has(placedKey('s'))).toBe(false);
  });
  it('drops malformed entries and forces source virtual', () => {
    const raw = JSON.stringify({
      version: 1,
      items: [
        { ...king, source: 'real' },
        { id: 'bad1', kind: 'chair', box: king.box, heightM: 1, surfaceHeightM: 1 },
        { id: 'bad2', kind: 'bed', box: { cx: 'x' }, heightM: 1, surfaceHeightM: 1 },
        { id: 'bad3', kind: 'bed', box: { cx: 0, cz: 0, w: 0, d: 1, yawDeg: 0 }, heightM: 1, surfaceHeightM: 1 },
        null, 7,
        { ...king },
      ],
    });
    const items = parsePlaced(raw);
    expect(items.length).toBe(1);
    expect(items[0].source).toBe('virtual');
    expect(parsePlaced('not json')).toEqual([]);
    expect(parsePlaced(null)).toEqual([]);
    expect(parsePlaced(JSON.stringify([king]))).toEqual([king]);
  });
});

describe('FurnitureStore', () => {
  const baseGrid = rasterizeLayout(layout);
  const make = (st: StorageLike, initial: FurnitureItem[] = furnished.furniture) => {
    const parent = new THREE.Group();
    const store = createFurnitureStore({ sceneId: 'sc', baseGrid, initial, parent, storage: st, saveDelayMs: 0 });
    return { store, parent };
  };

  it('starts with the real items, builds a mesh each, and stamps them into the grid', () => {
    const { store, parent } = make(fakeStorage());
    expect(store.all().map((i) => i.id)).toEqual(furnished.furniture.map((i) => i.id));
    expect(parent.children.length).toBe(2);
    expect(store.mesh(bed.id)).toBeDefined();
    expect(cellValue(store.grid(), 1.0, 2.25)).toBe(55);
    expect(cellValue(baseGrid, 1.0, 2.25)).toBe(0); // the layout grid itself is untouched
  });

  it('add / update / remove change the grid, notify, and persist only buyer items', () => {
    const st = fakeStorage();
    const { store, parent } = make(st);
    let n = 0;
    const off = store.onChange(() => { n += 1; });
    const king = itemFromCatalog('bed-king', { cx: 2.5, cz: 1.0, w: 1.93, d: 2.08, yawDeg: 0 }, 'virtual');
    store.add(king);
    expect(n).toBe(1);
    expect(parent.children.length).toBe(3);
    expect(cellValue(store.grid(), 2.5, 1.0)).toBe(90);
    expect(loadPlaced(st, 'sc').map((i) => i.id)).toEqual([king.id]);

    store.update(king.id, { ...king.box, cx: 3.0 });
    expect(n).toBe(2);
    expect(cellValue(store.grid(), 1.7, 1.0)).toBe(0);
    expect(cellValue(store.grid(), 3.5, 1.0)).toBe(90);
    expect(store.mesh(king.id)!.position.x).toBeCloseTo(3.0, 9);
    expect(loadPlaced(st, 'sc')[0].box.cx).toBe(3.0);

    // gridWithout leaves the named item out
    expect(cellValue(store.gridWithout([king.id]), 3.5, 1.0)).toBe(0);
    expect(cellValue(store.gridWithout([]), 3.5, 1.0)).toBe(90);

    store.remove(king.id);
    expect(parent.children.length).toBe(2);
    expect(cellValue(store.grid(), 3.5, 1.0)).toBe(0);
    expect(st.data.has(placedKey('sc'))).toBe(false);
    off();
    store.add(itemFromCatalog('sofa-3', { cx: 2, cz: 4, w: 2.1, d: 0.9, yawDeg: 0 }, 'virtual'));
    expect(n).toBe(3); // unsubscribed
  });

  it('real items cannot be moved or removed, and add refuses real items', () => {
    const { store } = make(fakeStorage());
    const before = store.all().find((i) => i.id === bed.id)!;
    store.update(bed.id, { ...before.box, cx: 3 });
    store.remove(bed.id);
    expect(store.all().find((i) => i.id === bed.id)!.box).toEqual(before.box);
    expect(() => store.add({ ...before, id: 'x' })).toThrow(/only virtual/);
  });

  it('a buyer may move or remove a broker-staged virtual item, for the session only', () => {
    const st = fakeStorage();
    const staged = itemFromCatalog('bed-queen', { cx: 2, cz: 2, w: 1.62, d: 2.08, yawDeg: 0 }, 'virtual');
    const { store } = make(st, [...furnished.furniture, staged]);
    store.update(staged.id, { ...staged.box, cx: 2.5 });
    expect(store.get(staged.id)!.box.cx).toBe(2.5);
    expect(st.data.has(placedKey('sc'))).toBe(false); // staged items are not saved as the buyer's
    store.remove(staged.id);
    expect(store.has(staged.id)).toBe(false);
  });

  it('reloads the buyer items from storage and clearBuyerItems keeps real and staged ones', () => {
    const st = fakeStorage();
    const staged = itemFromCatalog('bed-queen', { cx: 2, cz: 2, w: 1.62, d: 2.08, yawDeg: 0 }, 'virtual');
    const first = make(st, [...furnished.furniture, staged]);
    const mine = itemFromCatalog('dining-6', { cx: 2.5, cz: 4, w: 1.8, d: 1.7, yawDeg: 0 }, 'virtual');
    first.store.add(mine);
    first.store.dispose();

    const second = make(st, [...furnished.furniture, staged]);
    expect(second.store.has(mine.id)).toBe(true);
    expect(second.store.buyerIds()).toEqual([mine.id]);
    expect(second.store.all().length).toBe(4);
    second.store.clearBuyerItems();
    expect(second.store.all().map((i) => i.id)).toEqual([...furnished.furniture.map((i) => i.id), staged.id]);
    expect(st.data.has(placedKey('sc'))).toBe(false);
    expect(second.parent.children.length).toBe(3);
  });

  it('keeps the mesh when only the position changes, rebuilds when the size does', () => {
    const { store } = make(fakeStorage());
    const it = itemFromCatalog('sofa-3', { cx: 2, cz: 4, w: 2.1, d: 0.9, yawDeg: 0 }, 'virtual');
    store.add(it);
    const m = store.mesh(it.id)!;
    store.update(it.id, { ...it.box, cx: 2.2, yawDeg: 15 });
    expect(store.mesh(it.id)).toBe(m);
    expect(m.rotation.y).toBeCloseTo((15 * Math.PI) / 180, 9);
    store.update(it.id, { ...it.box, w: 1.8 });
    expect(store.mesh(it.id)).not.toBe(m);
  });

  it('all() hands out copies', () => {
    const { store } = make(fakeStorage());
    const a = store.all();
    a[0].box.cx = 99;
    expect(store.all()[0].box.cx).not.toBe(99);
  });
});

describe('modes', () => {
  const mk = (id: BuyerMode['id'], log: string[]): BuyerMode => ({
    id, enter: () => { log.push(`+${id}`); }, exit: () => { log.push(`-${id}`); }, update: () => { log.push(`~${id}`); },
  });
  it('exits the old mode before entering the new one', () => {
    const log: string[] = [];
    const m = new ModeManager();
    m.register(mk('walk', log));
    m.register(mk('measure', log));
    expect(m.set('measure')).toBe(true);
    expect(m.id).toBe('measure');
    m.update(0.01);
    m.set('walk');
    expect(log).toEqual(['-walk', '+measure', '~measure', '-measure', '+walk']);
  });
  it('a lazy mode that cannot be built leaves the mode unchanged and reports it', () => {
    const m = new ModeManager();
    m.register(mk('walk', []));
    const errs: string[] = [];
    m.onError = (id) => errs.push(id);
    m.registerLazy('furnish', () => { throw new Error('not implemented: C4'); });
    expect(m.set('furnish')).toBe(false);
    expect(m.id).toBe('walk');
    expect(errs).toEqual(['furnish']);
  });
  it('a lazy mode is built once', () => {
    const m = new ModeManager();
    m.register(mk('walk', []));
    let built = 0;
    m.registerLazy('furnish', () => { built += 1; return mk('furnish', []); });
    m.set('furnish'); m.set('walk'); m.set('furnish');
    expect(built).toBe(1);
  });
  it('a mode whose enter throws falls back to walk', () => {
    const m = new ModeManager();
    const log: string[] = [];
    m.register(mk('walk', log));
    m.register({ id: 'measure', enter() { throw new Error('boom'); }, exit() { log.push('-measure'); }, update() {} });
    m.onError = () => {};
    m.set('measure');
    expect(m.id).toBe('walk');
  });
});

describe('measure labels and overlay geometry', () => {
  it('formats like the spec', () => {
    expect(measureResult({ x: 0, y: 1, z: 5 }, { x: 0.9, y: 1, z: 5 }).label).toBe('90 cm · 2 ft 11 in');
    expect(measureResult({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }).label).toBe('4.00 m · 13 ft 1 in');
    expect(measureResult({ x: 0, y: 0, z: 0 }, { x: 0.62, y: 0, z: 0 }).label).toBe('62 cm · 2 ft 0 in');
    expect(measureResult({ x: 0, y: 0, z: 0 }, { x: 2, y: 1.5, z: 0 }).meters).toBeCloseTo(2.5, 9);
  });
  it('the outline ribbon is a flat ring of 8 triangles at the given height', () => {
    const g = outlineGeometry({ cx: 1, cz: 2, w: 1.5, d: 2, yawDeg: 90 }, 0.55);
    const pos = g.getAttribute('position');
    expect(pos.count).toBe(24);
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(0.55, 6);
    g.computeBoundingBox();
    // yaw 90: depth runs along x, so x spans 2.0 and z spans 1.5
    expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeCloseTo(2, 6);
    expect(g.boundingBox!.max.z - g.boundingBox!.min.z).toBeCloseTo(1.5, 6);
  });
  it('debug cell colours differ for free, void and obstacles', () => {
    const g = createGrid(0, 0, 2, 1, GRID_VOID);
    expect(g.cells[0]).toBe(GRID_VOID);
    expect(cellColor(0)).not.toEqual(cellColor(GRID_VOID));
    expect(cellColor(250)[3]).toBeGreaterThan(cellColor(0)[3]);
  });
});

import { unverifiedRoomsFromExtras, roomChipText as chipText } from '../src/buyer/store';
describe('unverified room sizes (integrator)', () => {
  it('flags label-rect rooms unless verified, and the chip shows no area for them', () => {
    const u = unverifiedRoomsFromExtras({ rooms: [
      { id: 'a', method: 'label-rect' }, { id: 'b', method: 'label-rect', verified: true }, { id: 'c', method: 'walls' }, { id: 'd', method: 'walls', verified: false },
    ] });
    expect(Object.keys(u)).toEqual(['a', 'd']);
    expect(unverifiedRoomsFromExtras(null)).toEqual({});
    const layout = { rooms: [{ id: 'a', label: 'Master Room', roomType: 'bedroom', polygon: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }, { x: 0, z: 3 }] }] } as never;
    expect(chipText(layout, { x: 1, z: 1 }, u)).toBe('Master Room · not measured (label size only)');
    expect(chipText(layout, { x: 1, z: 1 })).toMatch(/^Master Room · \d+ sq ft/);
  });
});
