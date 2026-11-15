// "My layout" (furnish-edit): the per-viewer overlay on a home, the finish palette, Replace / Remove / Undo / Reset in furnish mode,
// the link codec, and the rule that a home as drawn is never edited (SPEC 16.2).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTruthProperty } from '../scripts/make-test-room';
import { CATALOG, catalogItem, itemFromCatalog } from '../src/core/catalog';
import { rasterizeLayout } from '../src/core/layout-raster';
import { buildFurnitureMesh } from '../src/engine/furniture';
import {
  BED_STYLES, FAMILY_SLOTS, PALETTE, finishFamily, finishSchemes, resolveFinish, sameFinish, sanitizeFinish, slotAccepts, surpriseFinish, swatch, swatchesIn, withPick,
} from '../src/look/finishes';
import type { FinishFamily } from '../src/look/finishes';
import { applyFinish } from '../src/look/furniture-finish';
import { createFurnitureKit } from '../src/look/furniture-materials';
import { buildRealFurniture } from '../src/look/furniture-real';
import { createFurnishSession, replacementBox, replacementChoices } from '../src/buyer/furnish';
import type { FurnishView } from '../src/buyer/furnish';
import type { BuyerContext } from '../src/buyer/context';
import {
  BUILT_IN_NOTE, SHARE_PARAM, decodeLayout, emptyLayout, encodeLayout, isBuiltIn, mineKey, parseMine, serializeMine, shareUrl,
} from '../src/buyer/my-layout';
import { syncHosted } from '../src/buyer/layout-chip';
import { createFurnitureStore, loadPlaced } from '../src/buyer/store';
import type { StorageLike } from '../src/buyer/store';
import { mountKit } from '../src/look/kit';
import { createWardrobes } from '../src/buyer/wardrobe';
import type { Box, FurnitureItem } from '../src/types';

// ---------------------------------------------------------------- the palette

describe('finish palette', () => {
  it('every swatch id is unique, a #rrggbb colour, and in exactly one group', () => {
    expect(new Set(PALETTE.map((s) => s.id)).size).toBe(PALETTE.length);
    for (const s of PALETTE) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('holds the woods, laminates, fabrics and metals the brief names', () => {
    expect(swatchesIn('wood').map((s) => s.name)).toEqual(['Oak', 'Walnut', 'Teak', 'White laminate', 'Wenge']);
    expect(swatchesIn('laminate').map((s) => s.name)).toEqual(['Navy', 'Sage', 'Terracotta', 'Charcoal', 'Ivory']);
    expect(swatchesIn('fabric').map((s) => s.name)).toEqual(['Beige linen', 'Grey', 'Navy', 'Mustard', 'Teal', 'Maroon']);
    expect(swatchesIn('metal').length).toBeGreaterThanOrEqual(3);
  });

  const families = Object.keys(FAMILY_SLOTS) as FinishFamily[];
  it('every option of every slot of every family is a real swatch (or a real bed style)', () => {
    for (const fam of families) {
      for (const slot of FAMILY_SLOTS[fam]) {
        expect(slot.options.length).toBeGreaterThan(0);
        for (const id of slot.options) {
          if (slot.key === 'style') expect(BED_STYLES.some((s) => s.id === id)).toBe(true);
          else expect(swatch(id), `${fam}.${slot.key}.${id}`).not.toBeNull();
          expect(slotAccepts(fam, slot.key, id)).toBe(true);
        }
      }
    }
    expect(slotAccepts('bed', 'primary', 'fab-teal')).toBe(false);
    expect(slotAccepts('bed', 'primary', 'nonsense')).toBe(false);
  });

  it('every surprise scheme is legal for its family, and a surprise never repeats the current look', () => {
    for (const fam of families) {
      for (const scheme of finishSchemes(fam)) expect(sanitizeFinish(fam, scheme)).toEqual(scheme);
      let cur = surpriseFinish(fam, undefined, () => 0);
      for (let i = 0; i < 12; i++) {
        const next = surpriseFinish(fam, cur, () => (i * 0.137) % 1);
        expect(sameFinish(next, cur)).toBe(false);
        expect(sanitizeFinish(fam, next)).toEqual(next);
        cur = next;
      }
    }
  });

  it('sanitising drops foreign and unknown ids and leaves nothing for a kitchen counter', () => {
    expect(sanitizeFinish('bed', { primary: 'lam-navy', fabric: 'wood-oak', style: 'sofa', secondary: 'bed-sage' })).toEqual({ primary: 'lam-navy', secondary: 'bed-sage' });
    expect(sanitizeFinish('bed', 'x')).toBeUndefined();
    expect(sanitizeFinish(null, { primary: 'lam-navy' })).toBeUndefined();
    expect(withPick('bed', { primary: 'lam-navy' }, 'fabric', 'fab-teal')).toEqual({ primary: 'lam-navy', fabric: 'fab-teal' });
    expect(withPick('bed', { primary: 'lam-navy' }, 'primary', null)).toBeUndefined();
    expect(resolveFinish({ primary: 'wood-oak', style: 'panel' }).primary?.name).toBe('Oak');
  });

  it('families: beds, sofas (and armchairs as chairs), wardrobes, tables, and no look for a kitchen counter', () => {
    const f = (kind: FurnitureItem['kind'], label: string, catalogId?: string) => finishFamily({ kind, label, catalogId });
    expect(f('bed', '')).toBe('bed');
    expect(f('sofa', 'Sofa')).toBe('sofa');
    expect(f('sofa', 'Armchair', 'armchair')).toBe('chair');
    expect(f('wardrobe', '')).toBe('wardrobe');
    expect(f('dining', '')).toBe('table');
    expect(f('counter', 'Study')).toBe('table');
    expect(f('counter', 'Side table')).toBe('table');
    expect(f('counter', 'Kitchen')).toBeNull();
    expect(f('counter', '')).toBeNull();
    // every catalogue piece has a family, except none: all are loose furniture
    for (const c of CATALOG) expect(finishFamily({ kind: c.kind, label: c.name, catalogId: c.id, box: c.footprint }), c.id).not.toBeNull();
  });
});

// ---------------------------------------------------------------- the finish reaches the mesh

describe('a finish is applied to the furniture mesh', () => {
  const box: Box = { cx: 0, cz: 0, w: 1.62, d: 2.08, yawDeg: 0 };
  const bedItem = (finish?: FurnitureItem['finish']): FurnitureItem => ({ ...itemFromCatalog('bed-queen', box, 'virtual'), ...(finish ? { finish } : {}) });
  const colourOf = (g: THREE.Object3D, name: string): string => {
    let hex = '';
    g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.name === name) hex = `#${(m.material as THREE.MeshStandardMaterial).color.getHexString()}`; });
    return hex;
  };

  it('recolours the named parts of a bed and nothing else; no finish leaves the build as it was', () => {
    const plain = buildFurnitureMesh(bedItem(), { style: 'real', tier: 'medium' });
    const dressed = buildFurnitureMesh(bedItem({ primary: 'lam-navy', fabric: 'fab-teal', secondary: 'bed-sage', style: 'storage' }), { style: 'real', tier: 'medium' });
    expect(colourOf(dressed, 'frame-lower')).toBe(swatch('lam-navy')!.hex.toLowerCase());
    expect(colourOf(dressed, 'headboard')).toBe(swatch('fab-teal')!.hex.toLowerCase());
    expect(colourOf(dressed, 'bedcover')).toBe(swatch('bed-sage')!.hex.toLowerCase());
    expect(colourOf(dressed, 'mattress')).toBe(colourOf(plain, 'mattress'));
    expect(colourOf(plain, 'frame-lower')).not.toBe(colourOf(dressed, 'frame-lower'));
    // a finish never changes a size: same bounding box
    const a = new THREE.Box3().setFromObject(plain), b = new THREE.Box3().setFromObject(dressed);
    expect(b.min.toArray()).toEqual(a.min.toArray());
    expect(b.max.toArray()).toEqual(a.max.toArray());
  });

  it('styles: upholstered wraps the frame in the headboard fabric, panel carries the wood across the headboard', () => {
    const up = buildFurnitureMesh(bedItem({ primary: 'wood-oak', fabric: 'fab-grey', style: 'upholstered' }), { style: 'real', tier: 'low' });
    expect(colourOf(up, 'frame-lower')).toBe(swatch('fab-grey')!.hex.toLowerCase());
    const panel = buildFurnitureMesh(bedItem({ primary: 'wood-oak', fabric: 'fab-grey', style: 'panel' }), { style: 'real', tier: 'low' });
    expect(colourOf(panel, 'headboard')).toBe(swatch('wood-oak')!.hex.toLowerCase());
  });

  it('a solid laminate or metal loses the wood grain; a wood keeps it', () => {
    const kit = createFurnitureKit();
    const item = { ...itemFromCatalog('wardrobe-3', { cx: 0, cz: 0, w: 1.8, d: 0.6, yawDeg: 0 }, 'virtual') };
    const make = (finish: FurnitureItem['finish']): THREE.Group => {
      const g = new THREE.Group();
      buildRealFurniture(g, { ...item, finish }, 'medium', kit);
      applyFinish(g, { ...item, finish });
      return g;
    };
    const flat = (g: THREE.Group, name: string): boolean | undefined => { let v: boolean | undefined; g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.name === name) v = (m.material as THREE.Material).userData.flatFinish as boolean; }); return v; };
    expect(flat(make({ primary: 'lam-sage', secondary: 'metal-brass' }), 'shutter-wood')).toBe(true);
    expect(flat(make({ primary: 'lam-sage', secondary: 'metal-brass' }), 'shutter-handles')).toBe(true);
    expect(flat(make({ primary: 'wood-teak' }), 'shutter-wood')).toBe(false);
  });

  it('the dining set and the study table take a top and legs colour', () => {
    const dining = buildFurnitureMesh({ ...itemFromCatalog('dining-6', { cx: 0, cz: 0, w: 1.8, d: 1.7, yawDeg: 0 }, 'virtual'), finish: { primary: 'wood-wenge', secondary: 'metal-brass' } }, { style: 'real', tier: 'medium' });
    expect(colourOf(dining, 'top')).toBe(swatch('wood-wenge')!.hex.toLowerCase());
    expect(colourOf(dining, 'legs')).toBe(swatch('metal-brass')!.hex.toLowerCase());
    const study = buildFurnitureMesh({ ...itemFromCatalog('study-table', { cx: 0, cz: 0, w: 1.2, d: 0.6, yawDeg: 0 }, 'virtual'), finish: { primary: 'lam-ivory' } }, { style: 'real', tier: 'medium' });
    expect(colourOf(study, 'top')).toBe(swatch('lam-ivory')!.hex.toLowerCase());
  });
});

// ---------------------------------------------------------------- the store overlay

function fakeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => (data.has(k) ? data.get(k)! : null), setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

function rig(opts: { storage?: StorageLike; shareCode?: string | null; builtIn?: (i: FurnitureItem) => boolean } = {}) {
  const property = buildTruthProperty('furnished');
  const storage = (opts.storage ?? fakeStorage()) as ReturnType<typeof fakeStorage>;
  const parent = new THREE.Group();
  const scene = new THREE.Scene();
  scene.add(parent);
  const initial = property.furniture;
  const store = createFurnitureStore({ sceneId: 'test', baseGrid: rasterizeLayout(property.layout), initial, parent, storage, saveDelayMs: 0, shareCode: opts.shareCode });
  const character = { position: { x: 2, z: 2.5 }, yawDeg: 0, heightM: 1.75 };
  const overlays = { outlineBox: () => ({ remove() {} }), line: () => ({ remove() {} }), clear: () => {} };
  const toasts: string[] = [];
  const ctx = {
    viewer: { scene, camera: new THREE.PerspectiveCamera() }, property, character, overlays, furniture: store,
    grid: () => store.grid(), gridWithout: (ids: string[]) => store.gridWithout(ids), heightM: () => 1.75, hud: { toast: (t: string) => { toasts.push(t); } },
  } as unknown as BuyerContext;
  const views: FurnishView[] = [];
  const session = createFurnishSession(ctx, { render: (v) => views.push(v) }, { builtIn: opts.builtIn });
  return { property, storage, parent, scene, store, character, ctx, views, session, toasts, initial };
}

const snapshot = (store: ReturnType<typeof rig>['store']) => ({ items: JSON.stringify(store.all()), grid: Array.from(store.grid().cells).join(',') });
const cellSum = (g: { cells: Uint8Array }): number => g.cells.reduce((n, c) => n + (c > 0 && c < 255 ? 1 : 0), 0);

describe('My layout in the store', () => {
  it('hiding an original frees its cells, restoring puts them back, the property is never touched', () => {
    const t = rig();
    const before = JSON.stringify(t.property.furniture);
    const gridBefore = cellSum(t.store.grid());
    expect(t.store.hideOriginal('bed-1')).toBe(true);
    expect(t.store.has('bed-1')).toBe(false);
    expect(t.store.mesh('bed-1')).toBeUndefined();
    expect(cellSum(t.store.grid())).toBeLessThan(gridBefore);
    expect(t.store.hiddenOriginals().map((i) => i.id)).toEqual(['bed-1']);
    expect(t.store.isEdited()).toBe(true);
    expect(JSON.stringify(t.property.furniture)).toBe(before);
    expect(t.store.restoreOriginal('bed-1')).toBe(true);
    expect(cellSum(t.store.grid())).toBe(gridBefore);
    expect(t.store.isEdited()).toBe(false);
    expect(JSON.stringify(t.property.furniture)).toBe(before);
    // an unknown or a placed piece cannot be hidden as an original
    expect(t.store.hideOriginal('nope')).toBe(false);
  });

  it('a real piece still refuses plain remove; update moves it in My layout only (the drawn piece is the record)', () => {
    const t = rig();
    t.store.remove('bed-1');
    expect(t.store.has('bed-1')).toBe(true);
    t.store.update('bed-1', { cx: 0, cz: 0, w: 1, d: 1, yawDeg: 0 });
    expect(t.store.get('bed-1')!.box.cx).toBe(0);
    expect(t.store.drawnItem('bed-1')!.box.cx).toBe(1.0);
  });

  it('replace: the original is hidden, the new piece shows its own catalogue size, one change event', () => {
    const t = rig();
    let events = 0;
    t.store.onChange(() => { events += 1; });
    const spec = catalogItem('bed-king');
    const next = itemFromCatalog('bed-king', { cx: 1.0, cz: 2.25, w: spec.footprint.w, d: spec.footprint.d, yawDeg: 90 }, 'virtual');
    expect(t.store.replace('bed-1', next)).toBe(true);
    expect(events).toBe(1);
    expect(t.store.has('bed-1')).toBe(false);
    expect(t.store.get(next.id)!.box.w).toBe(1.93);
    expect(t.store.get(next.id)!.box.w).not.toBe(t.initial.find((i) => i.id === 'bed-1')!.box.w);
    expect(t.store.hiddenOriginals().map((i) => i.id)).toEqual(['bed-1']);
    // the hidden original keeps the size it was drawn with
    expect(t.store.hiddenOriginals()[0].box.w).toBe(1.5);
    expect(() => t.store.replace('bed-1', { ...next, source: 'real' })).toThrow();
  });

  it('a finish on an original is stored in the overlay, rebuilds that mesh, and never reaches the property', () => {
    const t = rig();
    const before = JSON.stringify(t.property.furniture);
    expect(t.store.setFinish('bed-1', { primary: 'lam-navy', fabric: 'fab-maroon', style: 'panel' })).toBe(true);
    expect(t.store.get('bed-1')!.finish).toEqual({ primary: 'lam-navy', fabric: 'fab-maroon', style: 'panel' });
    expect(t.store.get('bed-1')!.box).toEqual(t.initial.find((i) => i.id === 'bed-1')!.box);
    expect(JSON.stringify(t.property.furniture)).toBe(before);
    expect(t.store.layout().finishes['bed-1']).toEqual({ primary: 'lam-navy', fabric: 'fab-maroon', style: 'panel' });
    expect(t.store.isEdited()).toBe(true);
    // illegal picks are dropped, not stored
    t.store.setFinish('sofa-1', { primary: 'lam-navy', fabric: 'fab-teal' });
    expect(t.store.get('sofa-1')!.finish).toEqual({ fabric: 'fab-teal' });
    t.store.setFinish('sofa-1', null);
    expect(t.store.get('sofa-1')!.finish).toBeUndefined();
  });

  it('reset restores a byte-identical store: items, order, grid, storage', () => {
    const t = rig();
    const start = snapshot(t.store);
    t.store.hideOriginal('bed-1');
    t.store.setFinish('sofa-1', { fabric: 'fab-teal' });
    t.store.add(itemFromCatalog('sofa-3', { cx: 2, cz: 0.8, w: 2.1, d: 0.9, yawDeg: 180 }, 'virtual'));
    t.store.replace('sofa-1', itemFromCatalog('armchair', { cx: 3.5, cz: 3.5, w: 0.8, d: 0.85, yawDeg: 270 }, 'virtual'));
    expect(snapshot(t.store)).not.toEqual(start);
    expect(t.storage.data.size).toBeGreaterThan(0);
    t.store.reset();
    expect(snapshot(t.store)).toEqual(start);
    expect(t.store.isEdited()).toBe(false);
    expect(t.store.hiddenOriginals()).toEqual([]);
    expect(t.storage.data.size).toBe(0);
    expect(t.store.all().map((i) => i.id)).toEqual(t.initial.map((i) => i.id));
  });

  it('persists: a fresh load shows the same layout (removals, looks, placed pieces)', () => {
    const t = rig();
    t.store.hideOriginal('bed-1');
    t.store.setFinish('sofa-1', { fabric: 'fab-navy' });
    t.store.add({ ...itemFromCatalog('wardrobe-3', { cx: 2, cz: 0.4, w: 1.8, d: 0.6, yawDeg: 0 }, 'virtual'), finish: { primary: 'lam-sage', secondary: 'metal-brass' } });
    const again = rig({ storage: t.storage });
    expect(again.store.has('bed-1')).toBe(false);
    expect(again.store.hiddenOriginals().map((i) => i.id)).toEqual(['bed-1']);
    expect(again.store.get('sofa-1')!.finish).toEqual({ fabric: 'fab-navy' });
    const placed = again.store.all().find((i) => i.catalogId === 'wardrobe-3')!;
    expect(placed.finish).toEqual({ primary: 'lam-sage', secondary: 'metal-brass' });
    expect(loadPlaced(t.storage, 'test')[0].finish).toEqual({ primary: 'lam-sage', secondary: 'metal-brass' });
    expect(again.store.all()).toEqual(t.store.all()); // same pieces (key order aside)
  });

  it('storage that throws or holds rubbish gives the home as drawn, never an error', () => {
    const broken: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    const t = rig({ storage: broken });
    expect(t.store.hideOriginal('bed-1')).toBe(true); // save fails quietly
    const junk = fakeStorage();
    junk.setItem(mineKey('test'), '{"removed":[7,"ghost","bed-1"],"finishes":{"sofa-1":{"fabric":"lam-navy"},"ghost":{"primary":"wood-oak"}}}');
    const u = rig({ storage: junk });
    expect(u.store.hiddenOriginals().map((i) => i.id)).toEqual(['bed-1']);
    expect(u.store.get('sofa-1')!.finish).toBeUndefined();
    const garbage = fakeStorage();
    garbage.setItem(mineKey('test'), 'not json');
    expect(rig({ storage: garbage }).store.all()).toHaveLength(2);
  });

  it('parseMine and serializeMine round trip and an empty overlay stores nothing', () => {
    const originals = new Map(buildTruthProperty('furnished').furniture.map((i) => [i.id, i]));
    expect(serializeMine([], {})).toBeNull();
    const raw = serializeMine(['bed-1'], { 'sofa-1': { fabric: 'fab-grey' } })!;
    expect(JSON.parse(raw).version).toBe(1); // nothing moved or fitted: still the original format
    expect(parseMine(raw, originals)).toEqual({ removed: ['bed-1'], finishes: { 'sofa-1': { fabric: 'fab-grey' } }, moved: {}, fittings: { removed: [], moved: {}, sized: {} } });
    expect(parseMine(null, originals)).toEqual({ removed: [], finishes: {}, moved: {}, fittings: { removed: [], moved: {}, sized: {} } });
  });
});

// ---------------------------------------------------------------- the link

describe('a layout in a link', () => {
  const originals = new Map(buildTruthProperty('furnished').furniture.map((i) => [i.id, i]));

  it('round trips: removed originals, added pieces with their looks, looks on originals', () => {
    const t = rig();
    t.store.hideOriginal('bed-1');
    t.store.add({ ...itemFromCatalog('bed-queen', { cx: 1.0, cz: 2.25, w: 1.62, d: 2.08, yawDeg: 90 }, 'virtual'), finish: { primary: 'wood-oak', style: 'upholstered' } });
    t.store.setFinish('sofa-1', { fabric: 'fab-mustard' });
    const code = encodeLayout(t.store.layout())!;
    expect(code.startsWith('1.')).toBe(true);
    expect(code.length).toBeLessThan(400); // compact
    const back = decodeLayout(code, originals)!;
    expect(back.removed).toEqual(['bed-1']);
    expect(back.finishes).toEqual({ 'sofa-1': { fabric: 'fab-mustard' } });
    expect(back.added).toHaveLength(1);
    expect(back.added[0].catalogId).toBe('bed-queen');
    expect(back.added[0].box).toEqual({ cx: 1.0, cz: 2.25, w: 1.62, d: 2.08, yawDeg: 90 });
    expect(back.added[0].finish).toEqual({ primary: 'wood-oak', style: 'upholstered' });
    // opening it on a fresh device gives the same arrangement
    const other = rig({ shareCode: code });
    expect(other.store.fromLink()).toBe(true);
    expect(other.store.has('bed-1')).toBe(false);
    expect(other.store.all().find((i) => i.catalogId === 'bed-queen')!.box.cx).toBe(1.0);
    expect(other.store.get('sofa-1')!.finish).toEqual({ fabric: 'fab-mustard' });
    // ... and it is kept as this viewer's own, so a reload shows it too
    expect(rig({ storage: other.storage }).store.has('bed-1')).toBe(false);
  });

  it('an empty layout has no code, and shareUrl adds, replaces and removes the parameter', () => {
    expect(encodeLayout(emptyLayout())).toBeNull();
    const l = { ...emptyLayout(), removed: ['bed-1'] };
    const url = shareUrl('http://x.test/?scene=a&my=old&room=r', l);
    const u = new URL(url);
    expect(u.searchParams.get('scene')).toBe('a');
    expect(u.searchParams.get('room')).toBe('r');
    expect(u.searchParams.get(SHARE_PARAM)).toBe(encodeLayout(l));
    expect(new URL(shareUrl(url, emptyLayout())).searchParams.has(SHARE_PARAM)).toBe(false);
  });

  it('is checked against the home it opens on: wrong version, rubbish, foreign ids, illegal looks, absurd positions', () => {
    const good = encodeLayout({ ...emptyLayout(), removed: ['bed-1'] })!;
    expect(decodeLayout(good.replace(/^1\./, '3.'), originals)).toBeNull();
    expect(decodeLayout('1.%%%%', originals)).toBeNull();
    expect(decodeLayout('', originals)).toBeNull();
    expect(decodeLayout(null, originals)).toBeNull();
    expect(decodeLayout('1.' + btoa('[]').replace(/=/g, ''), originals)).toBeNull();
    const wire = (o: unknown): string => '1.' + btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const l = decodeLayout(wire({ r: ['ghost', 'sofa-1', 5], a: [['nope', 1, 1, 0], ['bed-king', 1e9, 0, 0], ['bed-king', 100, 200, 450]], f: { 'bed-1': { p: 'fab-teal', t: 'panel' }, ghost: { p: 'wood-oak' } } }), originals)!;
    expect(l.removed).toEqual(['sofa-1']);
    expect(l.added).toHaveLength(1);
    expect(l.added[0].box.yawDeg).toBeCloseTo(45, 9);
    expect(l.finishes).toEqual({ 'bed-1': { style: 'panel' } });
    // a link that decodes to nothing for this home is ignored
    expect(decodeLayout(wire({ r: ['ghost'] }), originals)).toBeNull();
    // a link opened on a home it does not belong to changes nothing
    expect(rig({ shareCode: wire({ r: ['ghost'] }) }).store.fromLink()).toBe(false);
  });
});

// ---------------------------------------------------------------- the built-in rule

describe('built-ins of a real drawing', () => {
  const item = (id: string, kind: FurnitureItem['kind'], source: FurnitureItem['source'] = 'real') => ({ id, kind, source });
  const real = { origin: 'real' as const, designed: new Set(['bed-1']) };
  it('wardrobes, counters and anything with a designs.json entry are built-ins; a plain bed or sofa is not', () => {
    expect(isBuiltIn(item('w', 'wardrobe'), real)).toBe(true);
    expect(isBuiltIn(item('c', 'counter'), real)).toBe(true);
    expect(isBuiltIn(item('bed-1', 'bed'), real)).toBe(true);
    expect(isBuiltIn(item('bed-2', 'bed'), real)).toBe(false);
    expect(isBuiltIn(item('s', 'sofa'), real)).toBe(false);
  });
  it('a made-up sample, a phone-video home and a piece the buyer placed have none', () => {
    expect(isBuiltIn(item('w', 'wardrobe'), { origin: 'sample', designed: new Set() })).toBe(false);
    expect(isBuiltIn(item('w', 'wardrobe'), { origin: 'video', designed: new Set() })).toBe(false);
    expect(isBuiltIn(item('w', 'wardrobe', 'virtual'), real)).toBe(false);
  });
});

// ---------------------------------------------------------------- the session: select, replace, remove, undo, reset

describe('furnish: edit a piece that came with the home', () => {
  it('Replace puts the new piece at the same spot (back edge kept), snapped, with its own verdict; Place commits it', () => {
    const t = rig();
    const old = t.store.get('bed-1')!.box; // head on the west wall, yaw 90
    t.session.select('bed-1');
    expect(t.session.view().selection).toMatchObject({ id: 'bed-1', home: true, builtIn: false, family: 'bed' });
    const v = t.session.replaceSelected('bed-queen')!;
    expect(v.catalogId).toBe('bed-queen');
    expect(v.box.w).toBe(1.62); // the replacement's own catalogue size
    expect(v.box.d).toBe(2.08);
    expect(v.box.yawDeg).toBeCloseTo(old.yawDeg, 0);
    // the head end (back edge) is where the old head was, within the wall snap
    expect(Math.abs((v.box.cx - v.box.d / 2) - (old.cx - old.d / 2))).toBeLessThan(0.12);
    expect(['fits', 'tight', 'blocked']).toContain(v.verdict);
    expect(t.session.view().phase).toBe('edit');
    expect(t.session.view().workKind).toBe('replace');
    // while it is only a preview the home is untouched
    expect(t.store.has('bed-1')).toBe(true);
    expect(t.store.hiddenOriginals()).toEqual([]);
    expect(t.session.place()).not.toBeNull();
    expect(t.store.has('bed-1')).toBe(false);
    expect(t.store.all().some((i) => i.catalogId === 'bed-queen')).toBe(true);
    expect(t.session.view().removed.map((r) => r.label)).toEqual(['Bed']);
    expect(t.session.view().edited).toBe(true);
    // the grid follows: the old footprint is free ground for the verdict of the next piece
    expect(t.store.grid().cells.length).toBeGreaterThan(0);
  });

  it('the verdict of a replacement ignores the piece it replaces, and a replacement that does not fit cannot be placed', () => {
    const t = rig();
    t.session.select('bed-1');
    const same = t.session.replaceSelected('bed-double')!;
    expect(same.verdict).not.toBe('blocked'); // it sits where the old bed stood; the old bed is not an obstacle
    t.session.cancel();
    expect(t.session.selected()).toBe('bed-1'); // cancelling brings the selection back
    expect(t.store.mesh('bed-1')!.visible).toBe(true);
    // a 4-door wardrobe at the spot of the bed collides with the bed's neighbours or the wall
    const big = t.session.replaceSelected('sofa-l')!;
    if (big.verdict === 'blocked') expect(t.session.place()).toBeNull();
    t.session.cancel();
    expect(t.store.has('bed-1')).toBe(true);
  });

  it('Remove hides a home piece (Undo brings it back as drawn); the property is untouched', () => {
    const t = rig();
    const before = JSON.stringify(t.property.furniture);
    t.session.select('sofa-1');
    expect(t.session.removeSelected()).toBe(true);
    expect(t.store.has('sofa-1')).toBe(false);
    const view = t.session.view();
    expect(view.removed).toEqual([{ id: 'sofa-1', label: 'Sofa', builtIn: false }]);
    expect(view.edited).toBe(true);
    expect(t.session.restore('sofa-1')).toBe(true);
    expect(t.store.get('sofa-1')!.box.w).toBe(2.0);
    expect(t.session.view().removed).toEqual([]);
    expect(t.session.view().edited).toBe(false);
    expect(JSON.stringify(t.property.furniture)).toBe(before);
  });

  it('Reset to the home as drawn undoes everything and the chip goes', () => {
    const t = rig();
    const start = snapshot(t.store);
    t.session.select('sofa-1'); t.session.removeSelected();
    t.session.select('bed-1'); t.session.pick('primary', 'lam-charcoal');
    t.session.spawn('sofa-3'); t.session.setYaw(0); t.session.moveTo(2, 0.8); t.session.place();
    expect(t.session.view().edited).toBe(true);
    t.session.resetLayout();
    expect(snapshot(t.store)).toEqual(start);
    expect(t.session.view().edited).toBe(false);
    expect(t.session.view().removed).toEqual([]);
    expect(t.session.view().buyerCount).toBe(0);
    expect(t.storage.getItem('walkthru:test:placed')).toBeNull();
    expect(t.storage.getItem(mineKey('test'))).toBeNull();
  });

  it('Change look: a pick is stored on the item, Surprise me gives a legal combination, As it was clears it; sizes never change', () => {
    const t = rig();
    const box = t.store.get('bed-1')!.box;
    t.session.select('bed-1');
    expect(t.session.pick('fabric', 'fab-teal')).toBe(true);
    expect(t.store.get('bed-1')!.finish).toEqual({ fabric: 'fab-teal' });
    expect(t.session.view().selection!.finishText).toContain('headboard teal');
    expect(t.session.pick('fabric', 'lam-navy')).toBe(true); // an illegal pick for the slot is ignored by the store's sanitising
    expect(t.store.get('bed-1')!.finish).toBeUndefined();
    const s = t.session.surprise()!;
    expect(sanitizeFinish('bed', s)).toEqual(s);
    expect(t.store.get('bed-1')!.finish).toEqual(s);
    expect(t.store.get('bed-1')!.box).toEqual(box);
    expect(t.session.clearLook()).toBe(true);
    expect(t.store.get('bed-1')!.finish).toBeUndefined();
    expect(t.store.isEdited()).toBe(false);
  });

  it('a placed piece can be recoloured too, and the look survives a reload', () => {
    const t = rig();
    t.session.spawn('sofa-3'); t.session.setYaw(0); t.session.moveTo(2, 0.8);
    const id = t.session.place()!;
    expect(t.session.pick('fabric', 'fab-maroon')).toBe(true);
    expect(t.store.get(id)!.finish).toEqual({ fabric: 'fab-maroon' });
    const again = rig({ storage: t.storage });
    expect(again.store.get(id)!.finish).toEqual({ fabric: 'fab-maroon' });
  });

  it('a replacement keeps the look only where it is legal for the new family', () => {
    const t = rig();
    t.session.select('sofa-1');
    t.session.pick('fabric', 'fab-teal');
    t.session.pick('primary', 'wood-walnut');
    const v = t.session.replaceSelected('sofa-2')!;
    expect(v.catalogId).toBe('sofa-2');
    t.session.place();
    const placed = t.store.all().find((i) => i.catalogId === 'sofa-2')!;
    expect(placed.finish).toEqual({ fabric: 'fab-teal', primary: 'wood-walnut' });
    // a bed replaced by a wardrobe keeps nothing of its bedding
    t.session.select('bed-1');
    t.session.pick('secondary', 'bed-sage');
    t.session.replaceSelected('wardrobe-3');
    t.session.place();
    expect(t.store.all().find((i) => i.catalogId === 'wardrobe-3')!.finish).toBeUndefined();
  });

  it('a built-in of a real drawing is hidden only with its note: in the bar, in the removed list, and on placing a replacement', () => {
    const t = rig({ builtIn: (i) => i.kind === 'sofa' });
    t.session.select('sofa-1');
    const v = t.session.view();
    expect(v.selection!.builtIn).toBe(true);
    expect(v.message).toContain(BUILT_IN_NOTE);
    expect(t.session.view().canMove).toBe(true); // in the viewer's layout only, with the note
    t.session.replaceSelected('sofa-3');
    expect(t.session.view().message).toContain(BUILT_IN_NOTE);
    t.session.place();
    expect(t.toasts.some((x) => x.includes(BUILT_IN_NOTE))).toBe(true);
    expect(t.session.view().removed).toEqual([{ id: 'sofa-1', label: 'Sofa', builtIn: true }]);
    // a piece that is not a built-in carries no note
    const u = rig({ builtIn: (i) => i.kind === 'sofa' });
    u.session.select('bed-1');
    expect(u.session.view().message).not.toContain(BUILT_IN_NOTE);
  });

  it('a home piece can be moved or rotated in the viewer layout (and cancelled), like a placed one', () => {
    const t = rig();
    t.session.select('bed-1');
    expect(t.session.view().canMove).toBe(true);
    expect(t.session.view().canRotate).toBe(true);
    expect(t.session.rotateSelected()).toBe(true);
    t.session.cancel();
    expect(t.store.get('bed-1')!.box.yawDeg).toBe(t.store.drawnItem('bed-1')!.box.yawDeg);
    t.session.select(null);
    t.session.spawn('sofa-3'); t.session.setYaw(0); t.session.moveTo(2, 0.8);
    const id = t.session.place()!;
    expect(t.session.view().canMove).toBe(true);
    expect(t.session.view().canRotate).toBe(true);
    const yaw0 = t.store.get(id)!.box.yawDeg;
    expect(t.session.rotateSelected()).toBe(true);
    expect(t.session.view().phase).toBe('edit');
    expect(t.session.working()!.box.yawDeg).not.toBe(yaw0);
    t.session.cancel();
    expect(t.store.get(id)!.box.yawDeg).toBe(yaw0);
  });

  it('the tray list names every piece, numbering duplicates, and gives a label to unnamed pieces', () => {
    const t = rig();
    const v = t.session.view();
    expect(v.pieces.map((p) => p.label)).toEqual(['Bed', 'Sofa']);
    t.session.spawn('sofa-3'); t.session.setYaw(0); t.session.moveTo(2, 0.8); t.session.place();
    expect(t.session.view().pieces.map((p) => p.label)).toEqual(['Bed', 'Sofa', '3-seat sofa']);
    expect(t.session.view().pieces.map((p) => p.home)).toEqual([true, true, false]);
  });
});

describe('replacement geometry and choices', () => {
  it('the new piece grows out of the old back edge on the same centre line', () => {
    const old: Box = { cx: 1.0, cz: 2.25, w: 1.5, d: 2.0, yawDeg: 90 };
    const b = replacementBox(old, catalogItem('bed-king'));
    expect(b.w).toBe(1.93);
    expect(b.d).toBe(2.08);
    expect(b.yawDeg).toBe(90);
    expect(b.cx - b.d / 2).toBeCloseTo(old.cx - old.d / 2, 9); // yaw 90: the back is on -x
    expect(b.cz).toBeCloseTo(old.cz, 9);
  });

  it('same-family choices come first: a bed offers the four beds, a sofa the sofas, a table all the tables', () => {
    const ids = (l: { id: string }[]) => l.map((c) => c.id);
    expect(ids(replacementChoices({ kind: 'bed', label: 'Bed' }).same)).toEqual(['bed-single', 'bed-double', 'bed-queen', 'bed-king']);
    expect(ids(replacementChoices({ kind: 'sofa', label: 'Sofa' }).same)).toEqual(['sofa-3', 'sofa-2', 'sofa-l']);
    expect(ids(replacementChoices({ kind: 'wardrobe', label: 'Wardrobe' }).same)).toEqual(['wardrobe-2', 'wardrobe-3', 'wardrobe-4']);
    expect(ids(replacementChoices({ kind: 'counter', label: 'Study' }).same).sort()).toEqual(['dining-6', 'side-table', 'study-table']);
    const kitchen = replacementChoices({ kind: 'counter', label: 'Kitchen' });
    expect(kitchen.same).toEqual([]);
    expect(kitchen.other).toHaveLength(CATALOG.length); // anything else from the catalogue
    for (const kind of ['bed', 'sofa', 'wardrobe'] as const) {
      const c = replacementChoices({ kind, label: '' });
      expect(c.same.length + c.other.length).toBe(CATALOG.length);
    }
  });
});

// ---------------------------------------------------------------- everything that hangs off the store follows the change

describe('what follows a hidden or replaced piece', () => {
  it('decor and chairs tied to a hidden piece go with it, and come back with it', () => {
    const present = new Set(['counter-3']);
    let cb: () => void = () => {};
    const temp: Record<string, number> = {};
    const store = {
      all: () => [...present].map((id) => ({ id })),
      onChange: (f: () => void) => { cb = f; return () => {}; },
      setTemporary: (key: string, o: unknown[]) => { temp[key] = o.length; cb(); },
    };
    const decor = [{ hostId: 'counter-3', group: new THREE.Group() }, { hostId: 'other', group: new THREE.Group() }];
    let gone = new Set<string>();
    const seatsList = [{ tiedTo: 'counter-3', id: 'seat:a' }];
    const seats = {
      setHostsPresent: (p: ReadonlySet<string>) => { gone = new Set(seatsList.filter((s) => !p.has(s.tiedTo)).map((s) => s.tiedTo)); },
      liveIds: () => seatsList.filter((s) => !gone.has(s.tiedTo)).map((s) => s.id),
      obstacles: () => seatsList.filter((s) => !gone.has(s.tiedTo)).map(() => ({ box: { cx: 0, cz: 0, w: 1, d: 1, yawDeg: 0 }, heightM: 0.9 })),
    };
    syncHosted(store, decor, seats);
    expect(decor.map((d) => d.group.visible)).toEqual([true, false]); // 'other' has no host in this home
    expect(seats.liveIds()).toEqual(['seat:a']);
    present.delete('counter-3');
    cb();
    expect(decor[0].group.visible).toBe(false);
    expect(seats.liveIds()).toEqual([]);
    expect(temp.seats).toBe(0); // the chair no longer blocks the walking grid
    present.add('counter-3');
    cb();
    expect(decor[0].group.visible).toBe(true);
    expect(seats.liveIds()).toEqual(['seat:a']);
    expect(temp.seats).toBe(1);
  });

  it('an openable wardrobe follows: its shutters take the new finish, the store mesh keeps its own shutters hidden after a rebuild, and removal takes the model away', () => {
    const t = rig();
    const parent = new THREE.Group();
    // createWardrobes mounts a small chip bar: a permissive element stand-in is enough (no DOM under Node)
    const el = (): unknown => new Proxy(function () {} as unknown as Record<string, unknown>, {
      get: (_t, k) => (k === 'dataset' || k === 'style' ? {} : k === 'classList' ? { toggle() {}, add() {}, remove() {} } : (): unknown => el()),
      set: () => true,
    });
    (globalThis as { document?: unknown }).document = { createElement: () => el() };
    (t.ctx.hud as unknown as { mount: () => () => void }).mount = () => () => {};
    const w = createWardrobes({ ctx: t.ctx, store: t.store, designs: null, parent });
    const id = (() => { t.store.add(itemFromCatalog('wardrobe-2', { cx: 2, cz: 0.4, w: 1.2, d: 0.6, yawDeg: 0 }, 'virtual')); return t.store.all().find((i) => i.catalogId === 'wardrobe-2')!.id; })();
    const models = (): THREE.Object3D[] => parent.children.filter((c) => c.userData.openableFor === id);
    expect(models()).toHaveLength(1);
    const hiddenShutters = (): boolean => (t.store.mesh(id)!.children.filter((c) => /^shutter-(wood|white)$/.test(c.name)).every((c) => !c.visible));
    expect(hiddenShutters()).toBe(true);
    t.store.setFinish(id, { primary: 'lam-terracotta', secondary: 'metal-brass' });
    expect(models()).toHaveLength(1);
    const slab = models()[0].getObjectByProperty('isMesh', true) as THREE.Mesh | undefined;
    const slabs: THREE.Mesh[] = [];
    models()[0].traverse((o) => { if ((o as THREE.Mesh).isMesh && /^shutter-slab/.test(o.name)) slabs.push(o as THREE.Mesh); });
    expect(slab).toBeDefined();
    expect(slabs.length).toBe(2);
    for (const m of slabs) expect(`#${(m.material as THREE.MeshStandardMaterial).color.getHexString()}`).toBe(swatch('lam-terracotta')!.hex.toLowerCase());
    expect(hiddenShutters()).toBe(true); // the rebuilt store mesh got its own shutters hidden again
    t.store.remove(id);
    expect(models()).toHaveLength(0);
    (w as unknown as { dispose?: () => void }).dispose?.();
    delete (globalThis as { document?: unknown }).document;
  });

  it('the kit bed-head board follows the bed: gone when the bed is hidden, back when it is restored or replaced by another bed', () => {
    const t = rig();
    const layout = t.property.layout;
    const viewer = { scene: new THREE.Scene(), onFrame: () => () => {} } as unknown as Parameters<typeof mountKit>[0]['viewer'];
    const shell = new THREE.Group();
    const kit = mountKit({ viewer, layout, shell, look: null, store: t.store });
    const boards = (): number => {
      let n = 0;
      viewer.scene.traverse((o) => { if (o.name === 'kit:bedhead-boards') n += 1; });
      return n;
    };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    return (async () => {
      const startBoards = boards();
      t.store.hideOriginal('bed-1');
      await wait(200);
      expect(boards()).toBeLessThanOrEqual(startBoards);
      t.store.restoreOriginal('bed-1');
      await wait(200);
      expect(boards()).toBe(startBoards);
      kit.dispose();
    })();
  });
});
