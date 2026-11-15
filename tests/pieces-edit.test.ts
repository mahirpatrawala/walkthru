// The second catalogue table together with edit-all (move, resize, remove of what came with the home): sizes the viewer may try per family,
// a resized fridge or sofa-bed re-runs its zones at the new size, wall pieces keep their height, and a fixture the drawing reader found (`fx-*`) is an
// original like any other: selectable, movable, resizable, hidden in "My layout" and brought back.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTruthProperty } from '../scripts/make-test-room';
import { catalogItem } from '../src/core/catalog';
import { checkFor } from '../src/core/checks';
import { fixturesToItems } from '../src/core/fixtures';
import { rasterizeLayout } from '../src/core/layout-raster';
import { checkPlacement } from '../src/core/placement';
import { createFurnishSession } from '../src/buyer/furnish';
import type { FurnishView } from '../src/buyer/furnish';
import type { BuyerContext } from '../src/buyer/context';
import { applyEdit, editOf, resizePatch, sizeLimits } from '../src/buyer/resize';
import { createFurnitureStore } from '../src/buyer/store';
import type { StorageLike } from '../src/buyer/store';
import { createFittingRegistry } from '../src/look/fittings';
import { createFittingsApi } from '../src/buyer/fittings-api';
import { sizeModeOf } from '../src/core/pieces';
import { CATALOG } from '../src/core/catalog';
import { createGrid } from '../src/core/grid-codec';
import { GRID_CELL_M } from '../src/types';
import type { FurnitureItem } from '../src/types';

const asItem = (id: string, box = { cx: 2, cz: 2, yawDeg: 0 }): FurnitureItem => {
  const s = catalogItem(id);
  return { id: `o-${id}`, source: 'real', kind: s.kind, catalogId: id, label: s.name, box: { ...box, w: s.footprint.w, d: s.footprint.d }, heightM: s.heightM, surfaceHeightM: s.surfaceHeightM };
};

describe('which sizes a new piece may be tried at', () => {
  it('a swing, a stool, a round table and a shower rail have no steppers; an appliance or a fitting only width and depth; storage also height', () => {
    for (const id of ['swing-2', 'swing-3-frame', 'hang-chair', 'bar-stool', 'coffee-round', 'dining-round-4', 'shower-over', 'bunk-bed']) expect(sizeLimits(asItem(id)), id).toEqual([]);
    expect(sizeLimits(asItem('fridge-1')).map((l) => l.key)).toEqual(['w', 'd']);
    expect(sizeLimits(asItem('wc-western')).map((l) => l.key)).toEqual(['w', 'd']);
    expect(sizeLimits(asItem('basin-wall')).map((l) => l.key)).toEqual(['w', 'd']);
    expect(sizeLimits(asItem('steel-almirah')).map((l) => l.key)).toEqual(['w', 'd', 'h']);
    expect(sizeLimits(asItem('tv-unit-150')).map((l) => l.key)).toEqual(['w', 'd']);
    expect(sizeLimits(asItem('loft-unit')).map((l) => l.key)).toEqual(['w', 'd']); // its height is the ceiling's
    for (const c of CATALOG.slice(14)) expect(sizeModeOf(c.id), c.id).not.toBeNull();
  });
  it('ranges are about the catalogue size, in 5 cm steps, and a size outside them that the drawing has is kept', () => {
    const w = sizeLimits(asItem('fridge-1')).find((l) => l.key === 'w')!;
    expect(w.min).toBeCloseTo(0.45, 6);
    expect(w.max).toBeCloseTo(0.8, 6);
    expect(w.step).toBe(0.05);
    // a drawn commode 0.3 wide (the symbol said so) is kept by an edit that changes only its place
    const drawn: FurnitureItem = { ...asItem('wc-western'), box: { cx: 2, cz: 2, w: 0.3, d: 0.72, yawDeg: 0 } };
    const e = applyEdit(drawn, { ...editOf(drawn), cx: 2.5 });
    expect(e.box.w).toBeCloseTo(0.3, 6);
  });
  it('a height that has no stepper is never changed by an edit: a basin keeps its rim, a geyser its base, a swing its seat', () => {
    for (const id of ['basin-wall', 'geyser-15', 'swing-2', 'fridge-1', 'wc-wallhung']) {
      const d = asItem(id);
      const e = applyEdit(d, { ...editOf(d), heightM: 9, surfaceHeightM: 9, w: 9, d: 9 });
      expect(e.heightM, id).toBe(d.heightM);
      expect(e.surfaceHeightM, id).toBe(d.surfaceHeightM);
    }
    const sw = asItem('swing-2');
    const e = applyEdit(sw, { ...editOf(sw), w: 9, d: 9 });
    expect([e.box.w, e.box.d]).toEqual([sw.box.w, sw.box.d]);
  });
  it('resizing keeps the back edge where it is, so a wall piece stays on its wall', () => {
    const b = asItem('basin-wall', { cx: 2, cz: 1, yawDeg: 0 });
    const patch = resizePatch(b, b, 'd', 0.55);
    expect(patch.d).toBeCloseTo(0.55, 6);
    expect((patch.cz as number) - 0.55 / 2).toBeCloseTo(1 - b.box.d / 2, 6);
  });
});

function emptyRoom() {
  const n = Math.round(8 / GRID_CELL_M);
  const g = createGrid(0, 0, n, n, 250);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = (i + 0.5) * GRID_CELL_M, z = (j + 0.5) * GRID_CELL_M; if (x > 0.5 && x < 7.5 && z > 0.5 && z < 7.5) g.cells[j * n + i] = 0; }
  return g;
}

describe('a resized piece reads its zones at its new size', () => {
  const withFront = (id: string, w: number, d: number, front: number) => ({ cx: 4, cz: 7.5 - front - d / 2, w, d, yawDeg: 0 });
  it('a fridge widened to 70 cm has a 70 cm door and needs 72 cm in front', () => {
    const r = checkPlacement(emptyRoom(), catalogItem('fridge-1'), withFront('fridge-1', 0.7, 0.67, 1.2), 2.7);
    expect(r.zones![0].needM).toBeCloseTo(0.72, 6);
    expect(r.message).toContain('the door is 70 cm wide');
    const tight = checkPlacement(emptyRoom(), catalogItem('fridge-1'), withFront('fridge-1', 0.7, 0.67, 0.6), 2.7);
    expect(tight.verdict).toBe('tight');
    // the same 60 cm in front is enough for the standard 58 cm fridge
    expect(checkPlacement(emptyRoom(), catalogItem('fridge-1'), withFront('fridge-1', 0.58, 0.67, 0.65), 2.7).verdict).toBe('fits');
  });
  it('a sofa-bed made 2.2 m wide opens to 220 × 220: 130 cm in front', () => {
    const r = checkPlacement(emptyRoom(), catalogItem('sofa-bed'), withFront('sofa-bed', 2.2, 0.9, 1.5), 2.7);
    expect(r.zones![0].needM).toBeCloseTo(1.3, 6);
    expect(r.message).toContain('opened bed 220 × 220 cm');
    expect(r.verdict).toBe('fits');
    expect(checkPlacement(emptyRoom(), catalogItem('sofa-bed'), withFront('sofa-bed', 2.2, 0.9, 1.1), 2.7).verdict).toBe('blocked');
  });
  it('the card of a resized fridge says its new door', () => {
    const f = { ...asItem('fridge-1'), box: { cx: 2, cz: 2, w: 0.7, d: 0.67, yawDeg: 0 } };
    expect(checkFor(f, 1.75, 2.6).lines.join(' ')).toContain('Needs 72 cm clear in front (the door is 70 cm wide');
  });
  it('a wall piece moved off its wall is told so, whatever its size', () => {
    const r = checkPlacement(emptyRoom(), catalogItem('basin-wall'), { cx: 4, cz: 4, w: 0.65, d: 0.5, yawDeg: 0 }, 2.7, true, 'bathroom');
    expect(r.verdict).toBe('tight');
    expect(r.message).toContain('is fixed to a wall');
  });
});

describe('a fixture from the drawing is an original like any other', () => {
  function sessionRig() {
    const property = buildTruthProperty('empty');
    const fixtures = fixturesToItems([
      { id: 'wc-1', cls: 'wc', at: { x: 2, z: 0.4 }, sizeM: { w: 0.38, d: 0.7 }, yawDeg: 0 },
      { id: 'basin-1', cls: 'basin', at: { x: 3.2, z: 0.3 }, yawDeg: 0 },
    ], property.layout);
    const data = new Map<string, string>();
    const storage: StorageLike = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
    const parent = new THREE.Group();
    const scene = new THREE.Scene();
    scene.add(parent);
    const store = createFurnitureStore({ sceneId: 'fx', baseGrid: rasterizeLayout(property.layout), initial: [...property.furniture, ...fixtures], parent, storage, saveDelayMs: 0, ceilingM: property.layout.wallHeightM });
    const fittings = createFittingsApi({ registry: createFittingRegistry(), store, layout: property.layout });
    const views: FurnishView[] = [];
    const ctx = {
      viewer: { scene, camera: new THREE.PerspectiveCamera() }, property, character: { position: { x: 2, z: 2.5 }, yawDeg: 0, heightM: 1.75 },
      overlays: { outlineBox: () => ({ remove() {} }), line: () => ({ remove() {} }), clear: () => {} }, furniture: store, fittings,
      grid: () => store.grid(), gridWithout: (ids: string[]) => store.gridWithout(ids), heightM: () => 1.75, hud: { toast: () => {} },
    } as unknown as BuyerContext;
    const session = createFurnishSession(ctx, { render: (v) => views.push(v) });
    return { store, session, property, views };
  }
  it('is an original of the store, selectable, with a card that says the size came from the drawing, and steppers for width and depth', () => {
    const t = sessionRig();
    expect(t.store.isOriginal('fx-wc-1')).toBe(true);
    t.session.select('fx-wc-1');
    const v = t.session.view();
    expect(v.selection!.home).toBe(true);
    expect(v.selection!.name).toBe('Western commode, floor-mounted');
    expect(v.selection!.sizes!.map((s) => s.key)).toEqual(['w', 'd']);
    expect(v.canMove).toBe(true);
    expect(v.canRemove).toBe(true);
  });
  it('resizes in place (the back edge stays), and is then checked like any piece with its WC space', () => {
    const t = sessionRig();
    t.session.select('fx-wc-1');
    const back = t.store.get('fx-wc-1')!.box.cz - t.store.get('fx-wc-1')!.box.d / 2;
    expect(t.session.resizeSelected('d', 0.8)).toBe(true);
    const it2 = t.store.get('fx-wc-1')!;
    expect(it2.box.d).toBeCloseTo(0.8, 6);
    expect(it2.box.cz - it2.box.d / 2).toBeCloseTo(back, 6);
    expect(it2.heightM).toBeCloseTo(0.8, 6);
    expect(t.session.view().selection!.edit).toContain('Your size');
    expect(t.session.view().message).toContain('Western commode');
    expect(t.session.backToDrawn('both')).toBe(true);
    expect(t.store.get('fx-wc-1')!.box.d).toBeCloseTo(0.7, 6);
  });
  it('moves (a preview with a verdict, then Place), and a basin keeps its mount height rule when moved off a wall', () => {
    const t = sessionRig();
    t.session.select('fx-basin-1');
    expect(t.session.beginMove()).toBe(true);
    const v = t.session.moveTo(2, 2.5)!;
    expect(v.message).toContain('fixed to a wall');
    expect(v.canPlace).toBe(true);
    t.session.place();
    expect(t.store.get('fx-basin-1')!.box.cx).toBeCloseTo(2, 6);
    expect(t.store.get('fx-basin-1')!.heightM).toBeCloseTo(0.95, 6);
  });
  it('is hidden in "My layout" and comes back with Undo, the home as drawn unchanged', () => {
    const t = sessionRig();
    t.session.select('fx-wc-1');
    expect(t.session.removeSelected()).toBe(true);
    expect(t.store.all().some((i) => i.id === 'fx-wc-1')).toBe(false);
    expect(t.store.hiddenOriginals().map((i) => i.id)).toContain('fx-wc-1');
    expect(t.session.restore('fx-wc-1')).toBe(true);
    expect(t.store.all().some((i) => i.id === 'fx-wc-1')).toBe(true);
  });
});
