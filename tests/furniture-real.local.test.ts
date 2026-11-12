// LOCAL ONLY (opt in with `npm run test:local`): the designs.json of the one real drawing shipped as a scene, applied to its
// property.json. The always-run twin (furniture-real.test.ts) uses a synthetic bedroom with its own ground truth.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildFurnitureMesh } from '../src/engine/furniture';
import { setItemDesigns } from '../src/look/furniture-real';
import { applyDesigns, parseDesigns } from '../src/look/designs';
import type { FurnitureItem } from '../src/types';
import type { Tier } from '../src/look/types';
import designsJson from '../public/scenes/son-bedroom/designs.json';
import sonProperty from '../public/scenes/son-bedroom/property.json';

const TIERS: Tier[] = ['low', 'medium', 'high'];

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
