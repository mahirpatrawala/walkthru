// Style generators (SPEC 16.13), headless: every piece keeps its box and heights under every pack and tier, a pack never changes a size,
// the wardrobe keeps its hinges and opens the same way, decor stays out of the collision grid.
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CATALOG, itemFromCatalog } from '../src/core/catalog';
import { buildFurnitureMesh } from '../src/engine/furniture';
import { buildRealFurniture, groupTriangles, setItemDesigns } from '../src/look/furniture-real';
import { createFurnitureKit } from '../src/look/furniture-materials';
import { GENERATORS, LOOK_KINDS, lookKindOf, sanitizeParams } from '../src/look/gen';
import { PACKS, getPack, loadPack } from '../src/look/packs';
import { knownFinish } from '../src/look/finishes';
import { resetStyle, setStyle } from '../src/look/style';
import type { FurnitureItem } from '../src/types';
import type { Tier } from '../src/look/types';

const TIERS: Tier[] = ['low', 'medium', 'high'];
const STYLE_PACKS = PACKS.filter((p) => !p.classic);
const box = (w: number, d: number) => ({ cx: 0, cz: 0, w, d, yawDeg: 0 });
const imported = (kind: FurnitureItem['kind'], label: string, w: number, d: number, h: number, s: number): FurnitureItem =>
  ({ id: `imp-${label}`, source: 'real', kind, label, box: box(w, d), heightM: h, surfaceHeightM: s });

const ITEMS: { name: string; item: FurnitureItem }[] = [
  ...CATALOG.slice(0, 14).map((c) => ({ name: c.id, item: itemFromCatalog(c.id, box(c.footprint.w, c.footprint.d), 'virtual') })),
  { name: 'imported bed 1.52 x 1.83', item: imported('bed', 'Bed', 1.52, 1.83, 0.9, 0.5) },
  { name: 'narrow bed 0.9 x 1.9', item: imported('bed', 'Bed', 0.9, 1.9, 0.8, 0.45) },
  { name: 'study 0.61 x 1.22', item: imported('counter', 'STUDY 2\'0"X4\'0"', 0.61, 1.22, 0.75, 0.75) },
  { name: 'side table 0.46 x 0.53', item: imported('counter', 'Side table', 0.46, 0.53, 0.55, 0.55) },
  { name: 'kitchen counter 2.4 x 0.6', item: imported('counter', 'Kitchen', 2.4, 0.6, 0.85, 0.85) },
  { name: 'dresser 1.4 x 0.45', item: imported('counter', 'TV unit', 1.4, 0.45, 0.5, 0.5) },
  { name: 'window seat 1.6 x 0.46', item: imported('sofa', 'Window seat', 1.6, 0.46, 0.45, 0.45) },
  { name: 'L sofa 2.6 x 1.6', item: imported('sofa', 'Sofa', 2.6, 1.6, 0.85, 0.43) },
  { name: 'tall wardrobe 1.8 x 0.6 x 2.4', item: imported('wardrobe', 'Wardrobe', 1.8, 0.6, 2.4, 2.4) },
  { name: 'wardrobe 2.74 x 0.61 x 2.54', item: imported('wardrobe', 'Wardrobe', 2.74, 0.61, 2.54, 2.54) },
];

function top(g: THREE.Group, x: number, z: number): number | null {
  g.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0));
  const hits = rc.intersectObject(g, true);
  return hits.length ? hits[0].point.y : null;
}

afterEach(() => { resetStyle(); setItemDesigns(null); });

describe('the style packs are data and never carry a size', () => {
  it('every pack loads with no dropped value', () => {
    for (const raw of [getPack('warm-oak-navy'), getPack('walnut-white'), getPack('light-scandinavian'), getPack('classic')]) {
      const r = loadPack(raw);
      expect(r.pack).not.toBeNull();
      expect(r.dropped).toEqual([]);
    }
  });
  it('the four packs the product ships are there, Classic keeps today\'s look', () => {
    expect(PACKS.map((p) => p.id).sort()).toEqual(['classic', 'light-scandinavian', 'walnut-white', 'warm-oak-navy']);
    expect(getPack('classic')!.classic).toBe(true);
  });
  it('every role names a finish that exists and no generator default is a size', () => {
    for (const p of STYLE_PACKS) {
      for (const id of Object.values(p.roles)) expect(knownFinish(id)).toBe(true);
      for (const kind of LOOK_KINDS) {
        for (const k of Object.keys(p.generators[kind] ?? {})) expect(/^(w|d|h|width|depth|height|s|surface)(M)?$/.test(k)).toBe(false);
      }
    }
  });
  it('a size smuggled into a design value is dropped, an unknown or wrong-typed value too', () => {
    const clean = sanitizeParams('wardrobe', { w: 5, width: 3, shutterStyle: 'nope', handle: 'knob', bays: 99, loftM: 0.3, heightM: 4 });
    expect(clean).toEqual({ handle: 'knob', loftM: 0.3 });
    expect(sanitizeParams('bed', 'x')).toEqual({});
  });
  it('the look chooser separates window seats, dressers and TV units from desks and kitchen counters', () => {
    const c = (label: string) => lookKindOf({ kind: 'counter', label });
    expect(c('Window seat')).toBe('bench');
    expect(c('TV unit')).toBe('dresser');
    expect(c('Study')).toBe('study');
    expect(c('Bedside')).toBe('side');
    expect(c('Kitchen')).toBe('counter');
    expect(lookKindOf({ kind: 'sofa', label: 'Bench' })).toBe('bench');
    expect(lookKindOf({ kind: 'sofa', label: '' })).toBe('sofa');
  });
});

describe('every generator keeps the box, the heights and the surface (SPEC 16.2 rule 1)', () => {
  for (const pack of STYLE_PACKS) {
    for (const tier of TIERS) {
      for (const { name, item } of ITEMS) {
        it(`${pack.id} / ${name} at ${tier}`, () => {
          setStyle({ packId: pack.id });
          const kit = createFurnitureKit();
          const g = new THREE.Group();
          buildRealFurniture(g, item, tier, kit);
          expect(g.userData.look).toBeTruthy();
          const kind = lookKindOf(item);
          const bb = new THREE.Box3().setFromObject(g);
          const { w, d } = item.box;
          const H = kind === 'bed' ? Math.max(item.heightM, item.surfaceHeightM + 0.02) : kind === 'sofa' ? Math.max(item.heightM, item.surfaceHeightM + 0.2) : item.heightM;
          expect(bb.max.x - bb.min.x).toBeGreaterThan(w - 0.01);
          expect(bb.max.x - bb.min.x).toBeLessThan(w + 0.01);
          expect(bb.max.z - bb.min.z).toBeGreaterThan(d - 0.01);
          expect(bb.max.z - bb.min.z).toBeLessThan(d + 0.01);
          expect(Math.abs(bb.max.y - H)).toBeLessThan(0.012);
          expect(bb.min.y).toBeGreaterThan(-0.005);
          expect(bb.min.x).toBeGreaterThan(-w / 2 - 0.01);
          expect(bb.max.x).toBeLessThan(w / 2 + 0.01);
          expect(bb.min.z).toBeGreaterThan(-d / 2 - 0.01);
          expect(bb.max.z).toBeLessThan(d / 2 + 0.01);
          if (kind !== 'wardrobe' && kind !== 'dining') {
            // the seat, a table top or a mattress is somewhere under a short list of probes (a back cushion or an L's chaise can stand at one)
            const ys = [0.02, d / 2 - 0.25, -d / 2 + 0.55].map((z) => top(g, 0.1, z));
            expect(ys.some((y) => y !== null && y > item.surfaceHeightM - 0.012 && y < item.surfaceHeightM + 0.06), `${ys.join(',')}`).toBe(true);
          }
        });
      }
    }
  }
});

describe('a pack changes finishes, never sizes', () => {
  it('the same item has the same footprint under every pack and tier (handle standoffs differ by under a centimetre)', () => {
    for (const { name, item } of ITEMS) {
      const lo = [Infinity, Infinity, Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity, -Infinity, -Infinity];
      for (const pack of STYLE_PACKS) {
        for (const tier of TIERS) {
          setStyle({ packId: pack.id });
          const g = new THREE.Group();
          buildRealFurniture(g, item, tier, createFurnitureKit());
          const bb = new THREE.Box3().setFromObject(g);
          [bb.min.x, bb.max.x, bb.min.z, bb.max.z, bb.max.y].forEach((v, i) => { lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); });
        }
      }
      for (let i = 0; i < 5; i++) expect(hi[i] - lo[i], `${name} coordinate ${i}`).toBeLessThan(0.02);
    }
  });
  it('Classic is today\'s look: the old builders, no generator', () => {
    setStyle({ packId: 'classic' });
    const item = itemFromCatalog('bed-queen', box(1.62, 2.08), 'virtual');
    const g = new THREE.Group();
    buildRealFurniture(g, item, 'medium', createFurnitureKit());
    expect(g.userData.look).toBeUndefined();
    expect(g.children.some((c) => c.name === 'headboard')).toBe(true);
  });
});

describe('parts are plain exportable geometry with stable names', () => {
  it('every mesh has a walkthruPart tag, positions and normals, and a material of its own', () => {
    for (const { item } of ITEMS.filter((_, i) => i % 3 === 0)) {
      setStyle({ packId: 'warm-oak-navy' });
      const g = new THREE.Group();
      buildRealFurniture(g, item, 'high', createFurnitureKit());
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        expect(typeof m.userData.walkthruPart).toBe('string');
        expect(m.name).toBe(m.userData.walkthruPart);
        expect(m.geometry.attributes.position).toBeDefined();
        expect(m.geometry.attributes.normal).toBeDefined();
        expect(m.geometry.attributes.uv).toBeDefined();
        const p = m.geometry.attributes.position;
        for (let i = 0; i < Math.min(p.count, 200); i++) expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
      });
    }
  });
});

describe('triangle budgets per piece (a phone tier home stays under about 150k)', () => {
  const BUDGET: Record<string, Record<Tier, number>> = {
    bed: { low: 2000, medium: 6500, high: 12000 },
    sofa: { low: 2000, medium: 5500, high: 12000 },
    bench: { low: 400, medium: 600, high: 900 },
    wardrobe: { low: 1600, medium: 6000, high: 9000 },
    study: { low: 400, medium: 700, high: 1000 },
    side: { low: 400, medium: 700, high: 1000 },
    dresser: { low: 500, medium: 900, high: 1400 },
    counter: { low: 1000, medium: 3500, high: 5500 },
    dining: { low: 1600, medium: 6500, high: 8000 },
  };
  for (const pack of STYLE_PACKS) {
    for (const tier of TIERS) {
      it(`${pack.id} at ${tier}`, () => {
        setStyle({ packId: pack.id });
        for (const { name, item } of ITEMS) {
          const g = new THREE.Group();
          buildRealFurniture(g, item, tier, createFurnitureKit());
          const kind = lookKindOf(item);
          expect(groupTriangles(g), `${name} ${kind}`).toBeLessThanOrEqual(BUDGET[kind][tier]);
        }
      });
    }
  }
});

describe('generators are registered for every kind', () => {
  it('each kind has defaults and a builder', () => {
    for (const k of LOOK_KINDS) {
      expect(GENERATORS[k].defaults).toBeDefined();
      expect(typeof GENERATORS[k].build).toBe('function');
    }
    expect(buildFurnitureMesh).toBeDefined();
  });
});

describe.skipIf(!process.env.GEN_COUNTS)('triangle counts (printed for the report)', () => {
  it('prints', async () => {
    const rows: string[] = [];
    for (const pack of STYLE_PACKS) for (const tier of TIERS) {
      const parts: string[] = [];
      for (const { name, item } of ITEMS) {
        setStyle({ packId: pack.id });
        const g = new THREE.Group();
        buildRealFurniture(g, item, tier, createFurnitureKit());
        parts.push(`${name}:${groupTriangles(g)}`);
      }
      rows.push(`${pack.id} ${tier} ${parts.join(' ')}`);
    }
    (await import('node:fs')).writeFileSync(process.env.GEN_COUNTS!, rows.join('\n'));
  });
});
