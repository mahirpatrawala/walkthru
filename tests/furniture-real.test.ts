// SPEC 16.6.6 checks 1 to 4 (headless): size truth, triangle budgets, the look chooser, pillow and cushion counts.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CATALOG, itemFromCatalog } from '../src/core/catalog';
import { buildFurnitureMesh } from '../src/engine/furniture';
import { furnitureLook, groupTriangles, setItemDesigns } from '../src/look/furniture-real';
import { applyDesigns, parseDesigns } from '../src/look/designs';
import { createFurnitureKit } from '../src/look/furniture-materials';
import type { FurnitureItem } from '../src/types';
import type { Tier } from '../src/look/types';
import designsJson from '../public/scenes/son-bedroom/designs.json';
import sonProperty from '../public/scenes/son-bedroom/property.json';

const TIERS: Tier[] = ['low', 'medium', 'high'];
const box = (w: number, d: number) => ({ cx: 0, cz: 0, w, d, yawDeg: 0 });

function imported(kind: FurnitureItem['kind'], label: string, w: number, d: number, h: number, s: number): FurnitureItem {
  return { id: `imp-${label}`, source: 'real', kind, label, box: box(w, d), heightM: h, surfaceHeightM: s };
}

const ITEMS: { name: string; item: FurnitureItem }[] = [
  ...CATALOG.map((c) => ({ name: c.id, item: itemFromCatalog(c.id, box(c.footprint.w, c.footprint.d), 'virtual') })),
  { name: 'imported bed 1.52 x 1.83', item: imported('bed', 'Bed', 1.52, 1.83, 0.55, 0.5) },
  { name: 'imported study 0.61 x 1.22', item: imported('counter', 'STUDY 2\'0"X4\'0"', 0.61, 1.22, 0.75, 0.75) },
  { name: 'imported side table 0.46 x 0.53', item: imported('counter', 'Side table', 0.46, 0.53, 0.55, 0.55) },
  { name: 'kitchen counter 2.4 x 0.6', item: imported('counter', 'Kitchen', 2.4, 0.6, 0.85, 0.85) },
  { name: 'tall wardrobe 1.8 x 0.6 x 2.4 (loft)', item: imported('wardrobe', 'Wardrobe', 1.8, 0.6, 2.4, 2.4) },
];

const BUDGET: Record<string, Record<Tier, number>> = {
  bed: { low: 1500, medium: 6000, high: 14000 },
  sofa: { low: 1500, medium: 5000, high: 10000 },
  wardrobe: { low: 600, medium: 1500, high: 2500 },
  study: { low: 500, medium: 1200, high: 2000 },
  side: { low: 500, medium: 1200, high: 2000 },
  counter: { low: 500, medium: 1200, high: 2000 },
  dining: { low: 2500, medium: 8000, high: 14000 },
};

function top(g: THREE.Group, x: number, z: number): number | null {
  g.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0));
  const hits = rc.intersectObject(g, true);
  return hits.length ? hits[0].point.y : null;
}

describe('real furniture: size truth (16.6.6 check 1 and 16.8 check 4)', () => {
  for (const tier of TIERS) {
    for (const { name, item } of ITEMS) {
      it(`${name} at ${tier}`, () => {
        const kit = createFurnitureKit();
        const g = buildFurnitureMesh(item, { style: 'real', tier });
        void kit;
        const bb = new THREE.Box3().setFromObject(g);
        const { w, d } = item.box;
        const look = furnitureLook(item);
        const H = look === 'bed' ? Math.max(item.heightM, item.surfaceHeightM + 0.02) : item.heightM;
        expect(bb.max.x - bb.min.x).toBeGreaterThan(w - 0.01);
        expect(bb.max.x - bb.min.x).toBeLessThan(w + 0.01);
        expect(bb.max.z - bb.min.z).toBeGreaterThan(d - 0.01);
        expect(bb.max.z - bb.min.z).toBeLessThan(d + 0.01);
        expect(Math.abs(bb.max.y - H)).toBeLessThan(0.01);
        expect(bb.min.y).toBeGreaterThan(-0.005);
        // nothing sticks out of the box
        expect(bb.min.x).toBeGreaterThan(-w / 2 - 0.005);
        expect(bb.max.x).toBeLessThan(w / 2 + 0.005);
        expect(bb.min.z).toBeGreaterThan(-d / 2 - 0.005);
        expect(bb.max.z).toBeLessThan(d / 2 + 0.005);
        if (look !== 'wardrobe') {
          const y = top(g, 0, 0);
          expect(y).not.toBeNull();
          expect(y!).toBeGreaterThan(item.surfaceHeightM - 0.01);
          expect(y!).toBeLessThan(item.surfaceHeightM + 0.04);
        }
        expect(groupTriangles(g)).toBeLessThanOrEqual(BUDGET[look][tier]);
      });
    }
  }
});

describe('furnitureLook (check 3)', () => {
  const c = (label: string) => furnitureLook({ kind: 'counter', label });
  it('chooses by kind and counter label', () => {
    expect(c('Study')).toBe('study');
    expect(c('STUDY 2\'0"X4\'0"')).toBe('study');
    expect(c('Desk')).toBe('study');
    expect(c('Side Table')).toBe('side');
    expect(c('Bedside')).toBe('side');
    expect(c('Kitchen platform')).toBe('counter');
    expect(c('')).toBe('counter');
    expect(furnitureLook({ kind: 'bed', label: 'x' })).toBe('bed');
    expect(furnitureLook({ kind: 'dining', label: 'x' })).toBe('dining');
  });
});

describe('counts (check 4)', () => {
  const count = (g: THREE.Group, re: RegExp) => g.children.filter((o) => re.test(o.name)).length;
  it('pillows: one for the single bed, two for double, queen and king', () => {
    for (const [id, n] of [['bed-single', 1], ['bed-double', 2], ['bed-queen', 2], ['bed-king', 2]] as const) {
      const c = CATALOG.find((x) => x.id === id)!;
      const g = buildFurnitureMesh(itemFromCatalog(id, box(c.footprint.w, c.footprint.d), 'virtual'), { style: 'real', tier: 'medium' });
      expect(count(g, /^pillow/)).toBe(n);
    }
  });
  it('sofa seat cushions: 3 for 2.10 m, 2 for 1.5 m', () => {
    const mk = (w: number) => buildFurnitureMesh(itemFromCatalog('sofa-3', box(w, 0.9), 'virtual'), { style: 'real', tier: 'medium' });
    expect(count(mk(2.1), /^seat-cushion/)).toBe(3);
    expect(count(mk(1.5), /^seat-cushion/)).toBe(2);
  });
  it('a bed has a headboard, pillows and a folded cover', () => {
    const g = buildFurnitureMesh(itemFromCatalog('bed-queen', box(1.62, 2.08), 'virtual'), { style: 'real', tier: 'medium' });
    expect(count(g, /^headboard$/)).toBe(1);
    expect(count(g, /^pillow/)).toBe(2);
    expect(count(g, /^bedcover-fold$/)).toBe(1);
  });
});

describe('the son-bedroom drawing (designs.json)', () => {
  const d = parseDesigns(designsJson);
  const items = applyDesigns(sonProperty.furniture as unknown as FurnitureItem[], d);
  const byId = (id: string) => items.find((i) => i.id === id)!;
  it('applies the drawn heights and leaves every box alone', () => {
    expect(byId('wardrobe-1').heightM).toBeCloseTo(2.54, 3);
    expect(byId('bed-1').surfaceHeightM).toBeCloseTo(0.508, 3);
    expect(byId('bed-1').heightM).toBeCloseTo(1.0668, 3);
    for (const it of items) {
      const src = (sonProperty.furniture as unknown as FurnitureItem[]).find((x) => x.id === it.id)!;
      expect(it.box).toEqual(src.box);
    }
  });
  for (const tier of TIERS) {
    for (const id of ['wardrobe-1', 'bed-1', 'counter-1', 'counter-3']) {
      it(`${id} keeps its box at ${tier}`, () => {
        const it = { ...byId(id), box: { ...byId(id).box, cx: 0, cz: 0, yawDeg: 0 } };
        const g = buildFurnitureMesh(it, { style: 'real', tier });
        const bb = new THREE.Box3().setFromObject(g);
        expect(Math.abs(bb.max.x - bb.min.x - it.box.w)).toBeLessThan(0.01);
        expect(Math.abs(bb.max.z - bb.min.z - it.box.d)).toBeLessThan(0.01);
        expect(Math.abs(bb.max.y - it.heightM)).toBeLessThan(0.01);
        expect(bb.min.x).toBeGreaterThan(-it.box.w / 2 - 0.005);
        expect(bb.max.z).toBeLessThan(it.box.d / 2 + 0.005);
      });
    }
  }
  it('builds the wardrobe with 3 bays of 2 shutters and 3 drawer strips', () => {
    const g = buildFurnitureMesh(byId('wardrobe-1'), { style: 'real', tier: 'medium' });
    const shutters = g.getObjectByName('shutters') as THREE.Mesh;
    expect((shutters.geometry.index!.count / 3)).toBeGreaterThan(6 * 12);
    setItemDesigns(null);
  });
});
