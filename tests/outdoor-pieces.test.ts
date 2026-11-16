// The pool-side and garden catalogue rows (SPEC 19.3, 19.4): each row is valid, has a generator that builds it at its own size on every tier, and
// stays inside its footprint and height (the parasol's canopy is the one declared exception). Clearance sentences say they are assumptions.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CATALOG, itemFromCatalog } from '../src/core/catalog';
import { OUTDOOR_PIECES } from '../src/core/catalog-outdoor';
import { PIECE_RULES, pieceRule } from '../src/core/pieces';
import { checkPlacement } from '../src/core/placement';
import { createGrid } from '../src/core/grid-codec';
import { buildRealFurniture, groupTriangles } from '../src/look/furniture-real';
import { createFurnitureKit } from '../src/look/furniture-materials';
import { LOOK_KINDS } from '../src/look/gen';
import { resetStyle, setStyle } from '../src/look/style';
import type { Tier } from '../src/look/types';
import type { Box } from '../src/types';

const TIERS: Tier[] = ['low', 'medium', 'high'];

describe('the pool and garden rows', () => {
  it('there are pool-side and garden pieces, each with a rule, ids unique, places set', () => {
    const pool = OUTDOOR_PIECES.filter((p) => p.row.places?.includes('pool'));
    const garden = OUTDOOR_PIECES.filter((p) => p.row.places?.includes('garden'));
    expect(pool.length).toBeGreaterThanOrEqual(10);
    expect(garden.length).toBeGreaterThanOrEqual(12);
    const ids = OUTDOOR_PIECES.map((p) => p.row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of OUTDOOR_PIECES) {
      expect(CATALOG.find((c) => c.id === p.row.id), p.row.id).toBeDefined();
      expect(PIECE_RULES[p.row.id], p.row.id).toBeDefined();
      expect(LOOK_KINDS).toContain(p.rule.look.kind);
      expect(p.row.footprint.w).toBeGreaterThan(0);
      expect(p.row.footprint.d).toBeGreaterThan(0);
      expect(p.row.surfaceHeightM).toBeLessThanOrEqual(p.row.heightM + 1e-9);
      expect(p.row.places?.length, p.row.id).toBeGreaterThan(0);
    }
  });

  it('the pool list has the pieces the brief names', () => {
    const ids = new Set(OUTDOOR_PIECES.map((p) => p.row.id));
    for (const id of ['pool-lounger', 'pool-umbrella', 'pool-chair', 'pool-table', 'pool-shower', 'pool-towel-rack', 'pool-lifeguard-chair', 'pool-life-ring', 'pool-depth-sign', 'pool-changing-sign', 'pool-deck-planter']) expect(ids.has(id), id).toBe(true);
    for (const id of ['garden-bench', 'garden-bench-senior', 'garden-pergola', 'garden-lamp-post', 'garden-bollard', 'garden-slide', 'garden-swingset', 'garden-seesaw', 'garden-climber', 'garden-rubber-mat', 'garden-track', 'garden-yoga-deck', 'garden-fountain']) expect(ids.has(id), id).toBe(true);
  });

  it('every clearance zone says it is typical guidance or an assumption', () => {
    for (const p of OUTDOOR_PIECES) for (const z of p.rule.zones ?? []) {
      const text = typeof z.assumption === 'string' ? z.assumption : z.assumption({ w: p.row.footprint.w, d: p.row.footprint.d });
      expect(text, `${p.row.id} ${z.id}`).toMatch(/typical guidance|assumed|a \d+ degrees? swing|swing each way/i);
    }
  });

  it('the swing set reuses the arc clearance of a jhoola (a swing zone), with a 1.75 m floor in front and behind', () => {
    const rule = pieceRule('garden-swingset')!;
    const arcZone = rule.zones!.find((z) => z.swing)!;
    expect(arcZone.swing!.angleDeg).toBe(30);
    expect(arcZone.sides).toEqual(['front', 'back']);
    expect(arcZone.minNeedM).toBe(1.75);
  });

  it('a swing set in the middle of a big empty space has room; one near a wall is blocked in front', () => {
    const g = createGrid(0, 0, 200, 200, 0);
    const spec = CATALOG.find((c) => c.id === 'garden-swingset')!;
    const free: Box = { cx: 5, cz: 5, w: spec.footprint.w, d: spec.footprint.d, yawDeg: 0 };
    const r = checkPlacement(g, spec, free, 8, true, null);
    expect(r.verdict).toBe('fits');
    // a wall of cells 1.0 m in front of the frame
    for (let i = 0; i < 200; i++) for (let j = 0; j < 4; j++) g.cells[(Math.round((5 + 0.9 + 1.0) / 0.05) + j) * 200 + i] = 250;
    const near = checkPlacement(g, spec, free, 8, true, null);
    expect(near.verdict).toBe('blocked');
    expect(near.zones?.find((z) => z.zoneId === 'arc' && z.side === 'front')?.status).toBe('blocked');
  });
});

describe('the generators build every piece, at its own size, on every tier', () => {
  const kit = createFurnitureKit();
  for (const tier of TIERS) {
    it(`tier ${tier}: inside the footprint and the height, triangles bounded`, () => {
      setStyle({});
      const problems: string[] = [];
      for (const p of OUTDOOR_PIECES) {
        const spec = p.row;
        const item = itemFromCatalog(spec.id, { cx: 0, cz: 0, w: spec.footprint.w, d: spec.footprint.d, yawDeg: 0 }, 'virtual');
        const g = new THREE.Group();
        buildRealFurniture(g, item, tier, kit);
        if (g.children.length === 0) problems.push(`${spec.id}: nothing built`);
        const b = new THREE.Box3().setFromObject(g);
        const tol = 0.012;
        const dw = b.max.x - b.min.x - spec.footprint.w, dd = b.max.z - b.min.z - spec.footprint.d;
        // the parasol's canopy reaches beyond its base on purpose (its card says so)
        if (spec.id !== 'pool-umbrella' && (dw > tol || dd > tol)) problems.push(`${spec.id}: ${dw > tol ? `${dw.toFixed(3)} too wide ` : ''}${dd > tol ? `${dd.toFixed(3)} too deep` : ''}`);
        if (b.min.y < -tol) problems.push(`${spec.id}: ${b.min.y.toFixed(3)} below the floor`);
        if (b.max.y > spec.heightM + 0.03) problems.push(`${spec.id}: ${(b.max.y - spec.heightM).toFixed(3)} too tall`);
        if (groupTriangles(g) >= (tier === 'low' ? 4000 : 9000)) problems.push(`${spec.id}: ${groupTriangles(g)} triangles`);
      }
      expect(problems).toEqual([]);
      resetStyle();
    });
  }
  it('a lamp post and a bollard carry a part that the time of day lights', () => {
    setStyle({});
    for (const id of ['garden-lamp-post', 'garden-bollard']) {
      const spec = CATALOG.find((c) => c.id === id)!;
      const g = new THREE.Group();
      buildRealFurniture(g, itemFromCatalog(id, { cx: 0, cz: 0, w: spec.footprint.w, d: spec.footprint.d, yawDeg: 0 }, 'virtual'), 'medium', kit);
      let lit = 0;
      g.traverse((o) => { if (o.userData.walkthruLight === 'lamp') lit++; });
      expect(lit, id).toBeGreaterThan(0);
    }
    resetStyle();
  });
});
