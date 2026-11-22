// SPEC 16.14 geometry parity, guarded headless: the bake refuses a scene whose furniture sticks out of its drawn box by more than 1 mm
// (src/look/baked/parity.ts, PARITY_TOLERANCE_M), and it dumps the scene at the medium tier. This builds every piece of every baked home the way
// the buyer page does (the scene's designs.json applied, its design sheet or the default pack, and each other style pack a viewer can pick) and
// checks every generated part against the item's box and height to the same 1 mm. A model swapped in later is checked by the fit rule
// (tests/home-models.test.ts); this is the generated piece, which is what is on screen first and what a phone without the model keeps.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PARITY_TOLERANCE_M } from '../src/look/baked/parity';
import { buildRealFurniture } from '../src/look/furniture-real';
import { createFurnitureKit } from '../src/look/furniture-materials';
import { applyDesigns, parseDesigns } from '../src/look/designs';
import { parseDesignSheet } from '../src/look/design-sheet';
import { PACKS } from '../src/look/packs';
import { resetStyle, setStyle } from '../src/look/style';
import { setModelsEnabled } from '../src/look/models/library';
import type { FurnitureItem } from '../src/types';
import type { Tier } from '../src/look/types';

const SCENES_DIR = path.join(__dirname, '..', 'public', 'scenes');
const BAKED = fs.readdirSync(SCENES_DIR).filter((d) => fs.existsSync(path.join(SCENES_DIR, d, 'baked', 'manifest.json'))).sort();
const readJson = (scene: string, f: string): unknown => {
  const p = path.join(SCENES_DIR, scene, f);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
};
const kit = createFurnitureKit();

/** how far (m) any part of the piece, built in its own frame, reaches past its drawn box or above its height; and which part does */
function overhang(item: FurnitureItem, tier: Tier): { over: number; part: string } {
  const g = new THREE.Group();
  buildRealFurniture(g, { ...item, box: { ...item.box, cx: 0, cz: 0, yawDeg: 0 } }, tier, kit);
  g.updateMatrixWorld(true);
  const { w, d } = item.box;
  const top = Math.max(item.heightM, item.surfaceHeightM);
  let worst = { over: 0, part: '' };
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const b = new THREE.Box3().setFromObject(m);
    if (b.isEmpty()) return;
    const over = Math.max(-w / 2 - b.min.x, b.max.x - w / 2, -d / 2 - b.min.z, b.max.z - d / 2, b.max.y - top);
    if (over > worst.over) worst = { over, part: m.name || m.parent?.name || '?' };
  });
  return worst;
}

afterAll(() => { resetStyle(); setModelsEnabled(true); });

describe('every generated piece of every baked home stays inside its drawn box to 1 mm (SPEC 16.14 parity)', () => {
  it('there are baked homes to check', () => { expect(BAKED.length).toBeGreaterThanOrEqual(10); });
  for (const scene of BAKED) {
    it(scene, () => {
      setModelsEnabled(false);
      const prop = readJson(scene, 'property.json') as { furniture: FurnitureItem[] };
      const items = applyDesigns(prop.furniture, parseDesigns(readJson(scene, 'designs.json')));
      const sheet = parseDesignSheet(readJson(scene, 'design.json'));
      // the look the bake sees (the sheet, else the default pack) at medium and high, then every other pack a viewer can pick, at medium
      const runs: { packId?: string; tier: Tier }[] = [{ tier: 'medium' }, { tier: 'high' }, ...PACKS.filter((p) => !p.classic).map((p) => ({ packId: p.id, tier: 'medium' as Tier }))];
      const bad: string[] = [];
      for (const r of runs) {
        setStyle({ packId: r.packId, sheet });
        for (const it of items) {
          const o = overhang(it, r.tier);
          if (o.over > PARITY_TOLERANCE_M) bad.push(`${r.packId ?? 'default'}/${r.tier} ${it.id} ${o.part} ${(o.over * 1000).toFixed(1)} mm`);
        }
      }
      expect(bad).toEqual([]);
    }, 120_000);
  }
});
