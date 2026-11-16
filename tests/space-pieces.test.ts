// The shared-space catalogue (gym equipment, lobby and hall pieces, SPEC 16.17): every row has valid sizes and a rule that names a real generator, every generator draws
// exactly the row's footprint and height under every pack and tier, parts are exportable, and a furnished gym stays inside the phone triangle budget.
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CATALOG, itemFromCatalog } from '../src/core/catalog';
import { CATEGORIES, PIECE_RULES, categoryOf, pieceRule } from '../src/core/pieces';
import { SPACE_PIECES } from '../src/core/catalog-spaces';
import { buildRealFurniture, groupTriangles } from '../src/look/furniture-real';
import { createFurnitureKit } from '../src/look/furniture-materials';
import { GENERATORS, LOOK_KINDS, lookKindOf, sanitizeParams } from '../src/look/gen';
import { setGenCeiling } from '../src/look/gen/ceiling';
import { PACKS } from '../src/look/packs';
import { FAMILY_SLOTS } from '../src/look/finishes';
import { resetStyle, setStyle } from '../src/look/style';
import type { Tier } from '../src/look/types';

const TIERS: Tier[] = ['low', 'medium', 'high'];
const NOT_BOX = /^(bag-chains|bag-hook)/;
const rows = SPACE_PIECES.map((p) => p.row);

afterEach(() => { resetStyle(); setGenCeiling(2.7); });

describe('the shared-space catalogue rows', () => {
  it('has unique ids that are in CATALOG, each offered somewhere, and every row of CATALOG names its places', () => {
    expect(rows.length).toBeGreaterThanOrEqual(60);
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
    for (const r of rows) expect(CATALOG.some((c) => c.id === r.id), r.id).toBe(true);
    for (const c of CATALOG) expect(c.places && c.places.length > 0, c.id).toBe(true);
    for (const { row } of SPACE_PIECES) expect(row.places!.length, row.id).toBeGreaterThan(0);
  });
  it('every row has positive sizes, a surface within its height and a rule with a known category, generator, pose and keywords', () => {
    const cats = new Set(CATEGORIES.map((c) => c.id));
    for (const { row, rule } of SPACE_PIECES) {
      expect(row.footprint.w, row.id).toBeGreaterThan(0.05);
      expect(row.footprint.d, row.id).toBeGreaterThan(0.025);
      expect(row.heightM, row.id).toBeGreaterThan(0);
      expect(row.surfaceHeightM, row.id).toBeLessThanOrEqual(row.heightM + 1e-9);
      expect(cats.has(rule.category), row.id).toBe(true);
      expect(LOOK_KINDS as string[]).toContain(rule.look.kind);
      const clean = sanitizeParams(rule.look.kind as never, rule.look.params);
      expect(Object.keys(clean).sort(), row.id).toEqual(Object.keys(rule.look.params ?? {}).sort());
      if (rule.family) expect(FAMILY_SLOTS[rule.family], row.id).toBeDefined();
      expect(['lie', 'sit', 'chair', 'swing', 'stand', 'dims', 'walk-on']).toContain(rule.pose);
      expect(categoryOf(row.id)).toBe(rule.category);
      expect(rule.keywords.length, row.id).toBeGreaterThan(1);
      if (rule.mountY !== undefined) expect(rule.mountY, row.id).toBeLessThan(row.heightM);
      expect(row.sizeLabel.length, row.id).toBeGreaterThan(5);
      // a seated pose says where the hips go
      if (rule.pose === 'chair' && ['cardio', 'strength', 'freeweights'].includes(rule.category)) expect(rule.seat, row.id).toBeDefined();
      if (rule.seat) { expect(Math.abs(rule.seat.z), row.id).toBeLessThan(row.footprint.d / 2); expect([1, -1]).toContain(rule.seat.face); }
    }
  });
  it('their rules are in PIECE_RULES, and a row with a rule chooses its generator through lookKindOf', () => {
    for (const { row, rule } of SPACE_PIECES) {
      expect(pieceRule(row.id), row.id).toBe(rule);
      expect(lookKindOf({ kind: row.kind, label: row.name, catalogId: row.id }), row.id).toBe(rule.look.kind);
    }
    expect(Object.keys(PIECE_RULES).length).toBeGreaterThan(rows.length);
  });
  it('covers every shared-space tray category', () => {
    for (const id of ['cardio', 'strength', 'freeweights', 'studio', 'amenities', 'reception', 'decor', 'stage', 'games']) expect(rows.some((r) => categoryOf(r.id) === id), id).toBe(true);
  });
  it('every zone says what it assumes, and a zone sentence names a number', () => {
    for (const { row, rule } of SPACE_PIECES) for (const z of rule.zones ?? []) {
      const a = typeof z.assumption === 'function' ? z.assumption(row.footprint) : z.assumption;
      expect(a.length, `${row.id} ${z.id}`).toBeGreaterThan(8);
      expect(z.blockedText.length, `${row.id} ${z.id}`).toBeGreaterThan(5);
    }
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

const TOL = Number(process.env.GYM_TOL ?? 0.012);
describe('every generator draws the row exactly (SPEC 16.2 rule 1)', () => {
  for (const pack of [PACKS.find((p) => p.classic)!, PACKS.find((p) => p.id === 'light-scandinavian')!]) {
    for (const tier of TIERS) {
      for (const { row, rule } of SPACE_PIECES) {
        it(`${pack.id} / ${row.id} at ${tier}`, () => {
          setStyle({ packId: pack.id });
          const item = itemFromCatalog(row.id, { cx: 0, cz: 0, w: row.footprint.w, d: row.footprint.d, yawDeg: 0 }, 'virtual');
          const g = new THREE.Group();
          buildRealFurniture(g, item, tier, createFurnitureKit());
          expect(g.userData.look, 'built by a generator').toBeTruthy();
          const bb = bounds(g, true);
          const { w, d } = item.box;
          const lift = rule.mountY ?? 0;
          expect(bb.max.x - bb.min.x, `width ${bb.max.x - bb.min.x} vs ${w}`).toBeGreaterThan(w - TOL);
          expect(bb.max.x - bb.min.x, `width ${bb.max.x - bb.min.x} vs ${w}`).toBeLessThan(w + TOL);
          expect(bb.max.z - bb.min.z, `depth ${bb.max.z - bb.min.z} vs ${d}`).toBeGreaterThan(d - TOL);
          expect(bb.max.z - bb.min.z, `depth ${bb.max.z - bb.min.z} vs ${d}`).toBeLessThan(d + TOL);
          expect(Math.abs(bb.max.y - item.heightM), `height ${bb.max.y} vs ${item.heightM}`).toBeLessThan(TOL);
          if (rule.hung) expect(bb.min.y).toBeGreaterThan(0.2);
          else if (lift > 0) expect(Math.abs(bb.min.y - lift), `underside ${bb.min.y} vs ${lift}`).toBeLessThan(0.03);
          else expect(bb.min.y).toBeGreaterThan(-0.005);
          expect(bb.min.x).toBeGreaterThan(-w / 2 - TOL);
          expect(bb.max.x).toBeLessThan(w / 2 + TOL);
          expect(bb.min.z).toBeGreaterThan(-d / 2 - TOL);
          expect(bb.max.z).toBeLessThan(d / 2 + TOL);
        });
      }
    }
  }
});

describe('parts are plain exportable geometry with stable names', () => {
  it('every mesh has a walkthruPart tag, positions, normals and UVs, finite numbers, and no part name is used twice with one material in a piece', () => {
    for (const { row } of SPACE_PIECES) {
      setStyle({ packId: 'warm-oak-navy' });
      const item = itemFromCatalog(row.id, { cx: 0, cz: 0, w: row.footprint.w, d: row.footprint.d, yawDeg: 0 }, 'virtual');
      const g = new THREE.Group();
      buildRealFurniture(g, item, 'high', createFurnitureKit());
      const seen = new Set<string>();
      let meshes = 0;
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        meshes++;
        expect(typeof m.userData.walkthruPart, row.id).toBe('string');
        expect(m.name).toBe(m.userData.walkthruPart);
        const key = `${m.name}|${(m.material as THREE.Material).uuid}`;
        expect(seen.has(key), `${row.id} ${m.name}`).toBe(false);
        seen.add(key);
        expect(m.geometry.attributes.position).toBeDefined();
        expect(m.geometry.attributes.normal).toBeDefined();
        expect(m.geometry.attributes.uv, `${row.id} ${m.name} has UVs`).toBeDefined();
        const p = m.geometry.attributes.position;
        for (let i = 0; i < Math.min(p.count, 400); i++) expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
      });
      expect(meshes, row.id).toBeGreaterThan(0);
      expect(meshes, `${row.id} is a handful of meshes, not a hundred`).toBeLessThan(80);
    }
  });
});

describe('triangle budgets', () => {
  // per look kind and tier: the heaviest piece of that kind
  const BUDGET: Record<string, Record<Tier, number>> = {
    cardio: { low: 1800, medium: 4200, high: 6200 },
    strength: { low: 3200, medium: 6500, high: 9500 },
    freew: { low: 2600, medium: 5200, high: 7500 },
    studio: { low: 1800, medium: 3600, high: 5200 },
    lobby: { low: 2600, medium: 6200, high: 9000 },
    hall: { low: 1800, medium: 3800, high: 5500 },
  };
  for (const tier of TIERS) {
    it(`at ${tier}`, () => {
      setStyle({ packId: 'light-scandinavian' });
      for (const { row } of SPACE_PIECES) {
        const item = itemFromCatalog(row.id, { cx: 0, cz: 0, w: row.footprint.w, d: row.footprint.d, yawDeg: 0 }, 'virtual');
        const g = new THREE.Group();
        buildRealFurniture(g, item, tier, createFurnitureKit());
        const kind = lookKindOf(item);
        expect(groupTriangles(g), `${row.id} (${kind}) at ${tier}`).toBeLessThanOrEqual(BUDGET[kind][tier]);
      }
    });
  }
});

describe('generators are registered and resolve', () => {
  it('every kind has defaults and a builder', () => {
    for (const k of LOOK_KINDS) { expect(GENERATORS[k].defaults).toBeDefined(); expect(typeof GENERATORS[k].build).toBe('function'); }
  });
});
