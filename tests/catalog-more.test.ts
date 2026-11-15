// The second catalogue table (src/core/catalog-more.ts): every row has valid sizes and a rule that names a real generator, finish family and pose;
// every generator draws exactly the row's footprint and height under every pack and tier, with exportable parts, inside its triangle budget.
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CATALOG, itemFromCatalog } from '../src/core/catalog';
import { CATEGORIES, PIECE_RULES, categoryOf, pieceRule } from '../src/core/pieces';
import { MORE_PIECES } from '../src/core/catalog-more';
import { buildRealFurniture, groupTriangles } from '../src/look/furniture-real';
import { createFurnitureKit } from '../src/look/furniture-materials';
import { GENERATORS, LOOK_KINDS, lookKindOf, sanitizeParams } from '../src/look/gen';
import { setGenCeiling } from '../src/look/gen/ceiling';
import { PACKS } from '../src/look/packs';
import { FAMILY_SLOTS } from '../src/look/finishes';
import { resetStyle, resolveLook, setStyle } from '../src/look/style';
import type { Tier } from '../src/look/types';

const TIERS: Tier[] = ['low', 'medium', 'high'];
const STYLE_PACKS = PACKS.filter((p) => !p.classic);
const rows = MORE_PIECES.map((p) => p.row);
const NOT_BOX = /^(swing-chains|swing-hooks|swing-eyes)/;

afterEach(() => { resetStyle(); setGenCeiling(2.7); });

describe('the second catalogue table', () => {
  it('has 40 or more rows with unique ids that are in CATALOG after the original fourteen', () => {
    expect(rows.length).toBeGreaterThanOrEqual(40);
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
    expect(CATALOG.slice(14).map((c) => c.id)).toEqual(rows.map((r) => r.id));
  });
  it('every row has positive sizes, a surface within its height, and a rule with a known category, generator, family and pose', () => {
    const cats = new Set(CATEGORIES.map((c) => c.id));
    for (const { row, rule } of MORE_PIECES) {
      expect(row.footprint.w, row.id).toBeGreaterThan(0.05);
      expect(row.footprint.d, row.id).toBeGreaterThan(0.05);
      expect(row.heightM, row.id).toBeGreaterThan(0);
      expect(row.surfaceHeightM, row.id).toBeLessThanOrEqual(row.heightM + 1e-9);
      expect(cats.has(rule.category), row.id).toBe(true);
      expect(LOOK_KINDS as string[]).toContain(rule.look.kind);
      const clean = sanitizeParams(rule.look.kind as never, rule.look.params);
      expect(Object.keys(clean).sort(), row.id).toEqual(Object.keys(rule.look.params ?? {}).sort());
      if (rule.family) expect(FAMILY_SLOTS[rule.family], row.id).toBeDefined();
      expect(['lie', 'sit', 'chair', 'swing', 'stand', 'dims']).toContain(rule.pose);
      expect(categoryOf(row.id)).toBe(rule.category);
      expect(rule.keywords.length, row.id).toBeGreaterThan(1);
      if (rule.mountY !== undefined) expect(rule.mountY, row.id).toBeLessThan(row.heightM);
    }
  });
  it('covers every tray category', () => {
    for (const c of CATEGORIES) expect(CATALOG.some((r) => categoryOf(r.id) === c.id), c.id).toBe(true);
  });
  it('a row with a rule chooses its generator through lookKindOf', () => {
    for (const { row, rule } of MORE_PIECES) expect(lookKindOf({ kind: row.kind, label: row.name, catalogId: row.id }), row.id).toBe(rule.look.kind);
  });
  it('pieces of the original table have no rule', () => {
    for (const c of CATALOG.slice(0, 14)) expect(pieceRule(c.id)).toBeNull();
    expect(Object.keys(PIECE_RULES).length).toBe(rows.length);
  });
});

function bounds(g: THREE.Group, skip = false): THREE.Box3 {
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (skip && NOT_BOX.test(m.name)) return;
    bb.union(new THREE.Box3().setFromObject(m));
  });
  return bb;
}
function top(g: THREE.Group, x: number, z: number): number | null {
  g.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(new THREE.Vector3(x, 6, z), new THREE.Vector3(0, -1, 0));
  const hits = rc.intersectObject(g, true).filter((h) => !NOT_BOX.test(h.object.name));
  return hits.length ? hits[0].point.y : null;
}

describe('every generator draws the row exactly (SPEC 16.2 rule 1)', () => {
  for (const pack of [...STYLE_PACKS, PACKS.find((p) => p.classic)!]) {
    for (const tier of TIERS) {
      for (const { row, rule } of MORE_PIECES) {
        it(`${pack.id} / ${row.id} at ${tier}`, () => {
          setStyle({ packId: pack.id });
          const item = itemFromCatalog(row.id, { cx: 0, cz: 0, w: row.footprint.w, d: row.footprint.d, yawDeg: 0 }, 'virtual');
          const g = new THREE.Group();
          buildRealFurniture(g, item, tier, createFurnitureKit());
          expect(g.userData.look, 'built by a generator').toBeTruthy();
          const bb = bounds(g, rule.look.kind === 'swing');
          const { w, d } = item.box;
          const lift = rule.mountY ?? 0;
          expect(bb.max.x - bb.min.x, 'width').toBeGreaterThan(w - 0.012);
          expect(bb.max.x - bb.min.x, 'width').toBeLessThan(w + 0.012);
          expect(bb.max.z - bb.min.z, 'depth').toBeGreaterThan(d - 0.012);
          expect(bb.max.z - bb.min.z, 'depth').toBeLessThan(d + 0.012);
          expect(Math.abs(bb.max.y - item.heightM), `height ${bb.max.y} vs ${item.heightM}`).toBeLessThan(0.012);
          if (lift > 0) expect(Math.abs(bb.min.y - lift), `underside ${bb.min.y} vs ${lift}`).toBeLessThan(0.03);
          else expect(bb.min.y).toBeGreaterThan(-0.005);
          expect(bb.min.x).toBeGreaterThan(-w / 2 - 0.012);
          expect(bb.max.x).toBeLessThan(w / 2 + 0.012);
          expect(bb.min.z).toBeGreaterThan(-d / 2 - 0.012);
          expect(bb.max.z).toBeLessThan(d / 2 + 0.012);
          if (rule.probe) {
            const y = top(g, rule.probe[0], rule.probe[1]);
            expect(y, `surface probe at ${rule.probe}`).not.toBeNull();
            expect(y!, `surface ${y} vs ${item.surfaceHeightM}`).toBeGreaterThan(item.surfaceHeightM - 0.015);
            expect(y!).toBeLessThan(item.surfaceHeightM + 0.06);
          }
        });
      }
    }
  }
});

describe('parts are plain exportable geometry with stable names', () => {
  it('every mesh has a walkthruPart tag, positions, normals and UVs, finite numbers, and no part name is used twice in one piece', () => {
    for (const { row } of MORE_PIECES) {
      setStyle({ packId: 'warm-oak-navy' });
      const item = itemFromCatalog(row.id, { cx: 0, cz: 0, w: row.footprint.w, d: row.footprint.d, yawDeg: 0 }, 'virtual');
      const g = new THREE.Group();
      buildRealFurniture(g, item, 'high', createFurnitureKit());
      const seen = new Set<string>();
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        expect(typeof m.userData.walkthruPart, row.id).toBe('string');
        expect(m.name).toBe(m.userData.walkthruPart);
        const key = `${m.name}|${(m.material as THREE.Material).uuid}`;
        expect(seen.has(key), `${row.id} ${m.name}`).toBe(false);
        seen.add(key);
        expect(m.geometry.attributes.position).toBeDefined();
        expect(m.geometry.attributes.normal).toBeDefined();
        expect(m.geometry.attributes.uv, `${row.id} ${m.name} has UVs`).toBeDefined();
        const p = m.geometry.attributes.position;
        for (let i = 0; i < Math.min(p.count, 300); i++) expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
      });
    }
  });
});

describe('triangle budgets (a phone-tier home stays under about 150k)', () => {
  const BUDGET: Record<string, Record<Tier, number>> = {
    swing: { low: 2800, medium: 5000, high: 7500 },
    tvunit: { low: 700, medium: 1100, high: 1600 },
    cabinet: { low: 1600, medium: 3200, high: 4500 },
    tablex: { low: 1400, medium: 2600, high: 4200 },
    seatx: { low: 2500, medium: 6500, high: 9000 },
    bedx: { low: 2800, medium: 6000, high: 8500 },
    appliance: { low: 1200, medium: 3200, high: 5200 },
    fit: { low: 1200, medium: 2500, high: 4000 },
    outdoor: { low: 700, medium: 1200, high: 1800 },
    bath: { low: 1600, medium: 3200, high: 5200 },
    bed: { low: 2000, medium: 6500, high: 12000 },
    dining: { low: 1600, medium: 6500, high: 8000 },
  };
  for (const tier of TIERS) {
    it(`at ${tier}`, () => {
      setStyle({ packId: 'light-scandinavian' });
      for (const { row } of MORE_PIECES) {
        const item = itemFromCatalog(row.id, { cx: 0, cz: 0, w: row.footprint.w, d: row.footprint.d, yawDeg: 0 }, 'virtual');
        const g = new THREE.Group();
        buildRealFurniture(g, item, tier, createFurnitureKit());
        const kind = lookKindOf(item);
        // eight chairs are twice a six-seat table's chairs
        const cap = row.id === 'dining-8' ? { low: 2200, medium: 8200, high: 10000 }[tier] : BUDGET[kind][tier];
        expect(groupTriangles(g), `${row.id} (${kind})`).toBeLessThanOrEqual(cap);
      }
    });
  }
});

describe('generators are registered for every kind and resolve', () => {
  it('each new kind has defaults and a builder, and a row resolves a look with its catalogue params', () => {
    for (const k of LOOK_KINDS) { expect(GENERATORS[k].defaults).toBeDefined(); expect(typeof GENERATORS[k].build).toBe('function'); }
    setStyle({ packId: 'walnut-white' });
    for (const { row, rule } of MORE_PIECES) {
      const item = itemFromCatalog(row.id, { cx: 0, cz: 0, w: row.footprint.w, d: row.footprint.d, yawDeg: 0 }, 'virtual');
      const look = resolveLook(item);
      expect(look?.kind, row.id).toBe(rule.look.kind);
      for (const [k, v] of Object.entries(rule.look.params ?? {})) expect(look?.params[k], `${row.id} ${k}`).toEqual(v);
    }
  });
});

describe('dining sets keep the table the label says (not turned a quarter)', () => {
  for (const [id, tw, td] of [['dining-4', 1.2, 0.68], ['dining-8', 2.4, 1.0]] as const) {
    it(`${id}: a ${tw * 100} x ${Math.round(td * 100)} cm top with the chairs round it`, () => {
      setStyle({ packId: 'light-scandinavian' });
      const row = CATALOG.find((c) => c.id === id)!;
      const g = new THREE.Group();
      buildRealFurniture(g, itemFromCatalog(id, { cx: 0, cz: 0, w: row.footprint.w, d: row.footprint.d, yawDeg: 0 }, 'virtual'), 'medium', createFurnitureKit());
      const top = g.getObjectByName('table-top') as THREE.Mesh;
      const bb = new THREE.Box3().setFromObject(top);
      expect(bb.max.x - bb.min.x).toBeCloseTo(tw, 2);
      expect(bb.max.z - bb.min.z).toBeCloseTo(td, 2);
    });
  }
});
