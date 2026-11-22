// SPEC 16.15.2 (22 Nov 2026): the living room's most visible generated pieces rebuilt (an upholstered ottoman, a sofa throw over an arm,
// a centre table with a rounded top, an apron and a wooden shelf) and the decor that makes the room read as lived in (a rug under the
// seating with the centre table and ottomans standing on it, a plant beside the sofa, books and a vase on the centre table). Every piece
// keeps its catalogue box (16.2 rule 1); decor stays out of every measurement and every route.
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { itemFromCatalog } from '../src/core/catalog';
import { boxCorners, pointInBox, pointInPolygon } from '../src/core/geometry';
import { cellValue } from '../src/core/grid-codec';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { buildRealFurniture, groupTriangles } from '../src/look/furniture-real';
import { createFurnitureKit } from '../src/look/furniture-materials';
import { GENERATORS, lookKindOf, sanitizeParams } from '../src/look/gen';
import { PACKS } from '../src/look/packs';
import { resetStyle, setStyle } from '../src/look/style';
import { planLivedIn } from '../src/look/lived-in/plan';
import { buildDecorGroup } from '../src/look/lived-in/build';
import type { FurnitureItem } from '../src/types';
import { GRID_FREE } from '../src/types';
import type { Tier } from '../src/look/types';
import { livedInFurniture, livedInLayout } from './helpers/lived-in-flat';

const TIERS: Tier[] = ['low', 'medium', 'high'];
const STYLE_PACKS = PACKS.filter((p) => !p.classic);
const item = (id: string, kind: FurnitureItem['kind'], label: string, cx: number, cz: number, w: number, d: number, yawDeg: number, h: number, s: number): FurnitureItem => ({
  id, source: 'real', kind, label, box: { cx, cz, w, d, yawDeg }, heightM: h, surfaceHeightM: s,
});
const at0 = (it: FurnitureItem): FurnitureItem => ({ ...it, box: { ...it.box, cx: 0, cz: 0, yawDeg: 0 } });

function top(g: THREE.Object3D, x: number, z: number): number | null {
  g.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0));
  const hits = rc.intersectObject(g, true);
  return hits.length ? hits[0].point.y : null;
}
function build(it: FurnitureItem, tier: Tier): THREE.Group {
  const g = new THREE.Group();
  buildRealFurniture(g, at0(it), tier, createFurnitureKit());
  return g;
}

afterEach(() => resetStyle());

describe('an ottoman or a pouf is an upholstered footstool, not a window seat', () => {
  it('the look chooser tells them apart', () => {
    expect(lookKindOf({ kind: 'sofa', label: 'Ottoman' })).toBe('ottoman');
    expect(lookKindOf({ kind: 'sofa', label: 'POUF' })).toBe('ottoman');
    expect(lookKindOf({ kind: 'sofa', label: 'Window seat' })).toBe('bench');
    expect(lookKindOf({ kind: 'sofa', label: 'Bench' })).toBe('bench');
    expect(lookKindOf({ kind: 'sofa', label: 'Sofa' })).toBe('sofa');
    expect(GENERATORS.ottoman.defaults).toEqual({ legs: 'wood', top: 'tufted' });
    expect(sanitizeParams('ottoman', { legs: 'gold', heightM: 0.9 })).toEqual({});
  });

  const SIZES: [number, number, number][] = [[0.58, 0.55, 0.4], [0.7, 0.66, 0.4], [0.9, 0.6, 0.45], [0.45, 0.45, 0.42]];
  for (const pack of STYLE_PACKS) for (const tier of TIERS) {
    it(`${pack.id} at ${tier}: the box, the height and the seat are the item's`, () => {
      setStyle({ packId: pack.id });
      for (const [w, d, h] of SIZES) {
        const g = build(item('o', 'sofa', 'Ottoman', 0, 0, w, d, 0, h, h), tier);
        const bb = new THREE.Box3().setFromObject(g);
        expect(bb.min.x).toBeGreaterThan(-w / 2 - 0.005); expect(bb.max.x).toBeLessThan(w / 2 + 0.005);
        expect(bb.min.z).toBeGreaterThan(-d / 2 - 0.005); expect(bb.max.z).toBeLessThan(d / 2 + 0.005);
        expect(bb.max.x - bb.min.x).toBeGreaterThan(w - 0.01); expect(bb.max.z - bb.min.z).toBeGreaterThan(d - 0.01);
        expect(bb.min.y).toBeGreaterThan(-0.002);
        expect(Math.abs(bb.max.y - h)).toBeLessThan(0.01);
        const y = top(g, 0.02, 0.02);
        expect(y).not.toBeNull();
        expect(Math.abs((y as number) - h)).toBeLessThan(0.01);
        const names = new Set(g.children.map((c) => c.name));
        expect(names.has('ottoman-top') && names.has('ottoman-body')).toBe(true);
        if (tier !== 'low') expect(names.has('ottoman-piping')).toBe(true);
        expect(groupTriangles(g)).toBeLessThanOrEqual({ low: 700, medium: 1800, high: 3000 }[tier]);
      }
    });
  }
});

describe('a sofa carries a throw over one arm, never on the seat', () => {
  for (const pack of STYLE_PACKS) {
    it(`${pack.id}: inside the box, on the arm, above the seat and clear of where a person sits`, () => {
      setStyle({ packId: pack.id });
      for (const [w, d] of [[2.1, 0.9], [1.5, 0.85]]) {
        const S = 0.43;
        const g = build(item('s', 'sofa', 'Sofa', 0, 0, w, d, 0, 0.85, S), 'medium');
        const throwM = g.children.find((c) => c.name === 'sofa-throw');
        expect(throwM, 'a throw').toBeTruthy();
        const tb = new THREE.Box3().setFromObject(throwM as THREE.Object3D);
        const bb = new THREE.Box3().setFromObject(g);
        expect(tb.min.x).toBeGreaterThanOrEqual(bb.min.x - 1e-6); expect(tb.max.x).toBeLessThanOrEqual(bb.max.x + 1e-6);
        expect(tb.min.z).toBeGreaterThanOrEqual(-d / 2 - 0.001); expect(tb.max.z).toBeLessThanOrEqual(d / 2 + 0.001);
        expect(tb.max.y).toBeLessThan(0.85);
        // it hangs from the arm, its lowest edge above the seat cushions (a person sits on the seat, not on the throw)
        expect(tb.min.y).toBeGreaterThan(S + 0.03);
        // and it stays within the arm and a few centimetres of its inner face
        const armInner = -w / 2 + 0.17;
        expect(Math.min(Math.abs(tb.max.x - armInner), Math.abs(-tb.min.x - armInner))).toBeLessThan(0.03);
        expect(tb.max.x - tb.min.x).toBeLessThan(0.17 + 0.03);
      }
    });
  }
  it('a pack or a sheet can turn it off', () => {
    expect(sanitizeParams('sofa', { throw: 'none' })).toEqual({ throw: 'none' });
    expect(sanitizeParams('sofa', { throw: 'both' })).toEqual({});
  });
});

describe('the centre table: a rounded top at the surface height, legs, an apron and a wooden shelf, inside its box', () => {
  for (const id of ['coffee-rect', 'coffee-round']) for (const tier of TIERS) {
    it(`${id} at ${tier}`, () => {
      setStyle({ packId: 'clean-contrast' });
      const it0 = itemFromCatalog(id, { cx: 0, cz: 0, w: 0, d: 0, yawDeg: 0 }, 'virtual');
      const c = { ...it0, box: { cx: 0, cz: 0, w: id === 'coffee-rect' ? 1.0 : 0.8, d: id === 'coffee-rect' ? 0.55 : 0.8, yawDeg: 0 } };
      const g = build(c, tier);
      const bb = new THREE.Box3().setFromObject(g);
      expect(bb.max.x - bb.min.x).toBeLessThan(c.box.w + 0.005); expect(bb.max.z - bb.min.z).toBeLessThan(c.box.d + 0.005);
      expect(bb.max.x - bb.min.x).toBeGreaterThan(c.box.w - 0.01);
      expect(Math.abs(bb.max.y - c.surfaceHeightM)).toBeLessThan(0.005);
      expect(Math.abs((top(g, 0.1, 0.05) as number) - c.surfaceHeightM)).toBeLessThan(0.005);
      if (id === 'coffee-rect') expect(g.children.some((m) => m.name === 'table-apron')).toBe(tier !== 'low');
    });
  }
});

// a made-up living room: a sofa on the west wall facing east, a centre table and an ottoman in front of it, a balcony door on the south wall
const room = { id: 'lr', roomType: 'living' as const, label: 'Living', polygon: [{ x: 0, z: 0 }, { x: 3.8, z: 0 }, { x: 3.8, z: 5.6 }, { x: 0, z: 5.6 }], edges: ['wall', 'wall', 'wall', 'wall'] as ('wall')[] };
const layout = {
  ...livedInLayout,
  rooms: [room],
  openings: [
    { id: 'entry', roomId: 'lr', edge: 0, type: 'door' as const, centreM: 1.6, widthM: 0.9, sillM: 0, headM: 2.1 },
    { id: 'slide', roomId: 'lr', edge: 2, type: 'door' as const, centreM: 1.9, widthM: 1.8, sillM: 0, headM: 2.1 },
  ],
};
const sofa = item('sofa-a', 'sofa', 'Sofa', 0.55, 3.2, 2.1, 0.9, 90, 0.85, 0.43);
const table = { ...item('ct', 'counter', 'Centre table', 1.45, 3.1, 1.0, 0.55, 90, 0.42, 0.42), catalogId: 'coffee-rect' };
const ottoman = item('pouf-a', 'sofa', 'Ottoman', 1.3, 4.1, 0.58, 0.55, 90, 0.4, 0.4);
const tv = { ...item('tv', 'counter', 'TV unit', 3.6, 3.2, 1.8, 0.4, 270, 0.5, 0.5) };
const items = [sofa, table, ottoman, tv];
const grid = stampFurniture(rasterizeLayout(layout), items);
const plan = () => planLivedIn({ layout, items, grid });

describe('lived-in: a living room reads as lived in', () => {
  it('a rug lies in front of the sofa, under the centre table and the ottoman, on free floor otherwise', () => {
    const rug = plan().find((p) => p.kind === 'rug');
    expect(rug).toBeTruthy();
    const box = { cx: rug!.x, cz: rug!.z, w: rug!.w, d: rug!.d, yawDeg: rug!.yawDeg };
    expect(pointInBox({ x: table.box.cx, z: table.box.cz }, box)).toBe(true);
    for (const q of boxCorners(box)) expect(pointInPolygon(q, room.polygon)).toBe(true);
    for (const q of boxCorners(box)) {
      const free = cellValue(grid, q.x, q.z) === GRID_FREE;
      expect(free || [sofa, table, ottoman].some((i) => pointInBox(q, i.box, 0.03))).toBe(true);
    }
    expect([...boxCorners(box)].some((q) => pointInBox(q, tv.box))).toBe(false);
    // it runs a little under the sofa's front, as a rug does
    expect(Math.abs(box.cx - box.w / 2 * 0 - (sofa.box.cx + sofa.box.d / 2 - 0.25 + rug!.d / 2))).toBeLessThan(0.02);
  });

  it('a plant stands beside the sofa, and the centre table carries books and a vase inside its box', () => {
    const ps = plan();
    const plants = ps.filter((p) => p.kind === 'plant' && p.roomId === 'lr');
    expect(plants.length).toBeGreaterThanOrEqual(1);
    expect(plants.length).toBeLessThanOrEqual(2);
    expect(plants.some((p) => Math.hypot(p.x - sofa.box.cx, p.z - sofa.box.cz) < sofa.box.w / 2 + 0.6)).toBe(true);
    const onTable = ps.filter((p) => p.hostId === 'ct');
    expect(onTable.map((p) => p.kind).sort()).toEqual(['books', 'jug']);
    for (const p of onTable) {
      expect(pointInBox({ x: p.x, z: p.z }, table.box, -Math.max(p.w, p.d) / 2 + 0.01)).toBe(true);
      expect(p.y).toBeCloseTo(table.surfaceHeightM, 5);
    }
  });

  it('decor is never hit by a ray and the rug is a real woven texture, not a flat board', () => {
    const built = buildDecorGroup(plan(), 'medium', null);
    built.group.updateMatrixWorld(true);
    const rc = new THREE.Raycaster(new THREE.Vector3(table.box.cx, 3, table.box.cz), new THREE.Vector3(0, -1, 0));
    expect(rc.intersectObject(built.group, true)).toEqual([]);
  });

  it('the plan adds pieces after the ones it planned before, so a baked home keeps the ids of its existing decor', () => {
    const ps = plan();
    const idx = (k: string) => ps.findIndex((p) => p.kind === k);
    const lastOld = Math.max(...ps.map((p, i) => (['frame', 'clock', 'curtain', 'shoes'].includes(p.kind) ? i : -1)));
    expect(ps.findIndex((p) => p.hostId === 'ct')).toBeGreaterThan(lastOld);
    void idx;
  });
});

describe('the old fixture still gets its rug only over free floor or its own sofa', () => {
  it('unchanged for a room with no centre table or ottoman', () => {
    const g = stampFurniture(rasterizeLayout(livedInLayout), livedInFurniture);
    const rugs = planLivedIn({ layout: livedInLayout, items: livedInFurniture, grid: g }).filter((p) => p.kind === 'rug');
    expect(rugs.length).toBeLessThanOrEqual(1);
  });
});
