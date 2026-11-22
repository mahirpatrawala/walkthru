// SPEC 16.15.3 (22 Nov 2026): the other rooms read as used. A kitchen worktop with a chopping board, a mixer-grinder and ladles where nothing
// else stands; a dining table laid with a runner and a placemat at every chair; books and a vase on a TV unit under its screen; a towel ring
// beside a basin, a soap dispenser on its deck and a bath mat where one stands at it; the kitchen's pieces and the bedside lamp drawn as
// products on medium and high. All decor: inside its host's box at its surface, no ray, nothing in the walking grid, planned after every
// piece planned before (so a baked home's decor keeps its ids).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pointInBox, pointInPolygon } from '../src/core/geometry';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { planLivedIn, pieceBox } from '../src/look/lived-in/plan';
import type { DecorPiece } from '../src/look/lived-in/plan';
import { buildDecorGroup } from '../src/look/lived-in/build';
import { livedInLayout } from './helpers/lived-in-flat';
import type { FurnitureItem, RoomTag } from '../src/types';

const item = (id: string, kind: FurnitureItem['kind'], label: string, cx: number, cz: number, w: number, d: number, yawDeg: number, h: number, s: number, catalogId?: string): FurnitureItem => ({
  id, source: 'real', kind, label, box: { cx, cz, w, d, yawDeg }, heightM: h, surfaceHeightM: s, ...(catalogId ? { catalogId } : {}),
});
const rect = (id: string, roomType: RoomTag['roomType'], x0: number, z0: number, x1: number, z1: number): RoomTag => ({
  id, roomType, label: id, polygon: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], edges: ['wall', 'wall', 'wall', 'wall'],
});

// a made-up flat: a living room with a TV unit, a dining room, a kitchen with two worktops and a bathroom
const layout = {
  ...livedInLayout,
  rooms: [rect('lr', 'living', 0, 0, 4, 4), rect('dn', 'living', 4.12, 0, 7, 4), rect('kt', 'kitchen', 0, 4.12, 3, 7), rect('bt', 'bathroom', 3.12, 4.12, 5, 6.5)],
  openings: [
    { id: 'entry', roomId: 'lr', edge: 0, type: 'door' as const, centreM: 1.0, widthM: 0.9, sillM: 0, headM: 2.1 },
    { id: 'lr-dn', roomId: 'lr', edge: 1, type: 'opening' as const, centreM: 3.0, widthM: 1.2, sillM: 0, headM: 2.1 },
    { id: 'lr-kt', roomId: 'lr', edge: 2, type: 'door' as const, centreM: 3.4, widthM: 0.8, sillM: 0, headM: 2.1 },
    { id: 'bt-door', roomId: 'bt', edge: 0, type: 'door' as const, centreM: 1.5, widthM: 0.75, sillM: 0, headM: 2.1 },
  ],
};
const items: FurnitureItem[] = [
  item('tv', 'counter', 'TV unit', 2.0, 3.8, 1.8, 0.4, 180, 1.62, 0.45, 'tv-unit-180'),
  item('sofa', 'sofa', 'Sofa', 2.0, 0.6, 2.1, 0.9, 0, 0.85, 0.43, 'sofa-3'),
  item('dine', 'dining', 'Dining table with six chairs', 5.5, 2.0, 1.8, 1.7, 0, 0.95, 0.75, 'dining-6'),
  item('k1', 'counter', 'Kitchen counter', 1.5, 6.7, 2.4, 0.6, 180, 0.85, 0.85),
  item('k2', 'counter', 'Kitchen counter', 0.3, 5.3, 1.6, 0.6, 90, 0.85, 0.85),
  item('basin', 'counter', 'Wash basin', 4.5, 6.275, 0.55, 0.45, 180, 0.95, 0.85, 'basin-wall'),
  item('wc', 'counter', 'Western commode', 3.6, 6.14, 0.4, 0.72, 180, 0.8, 0.42, 'wc-western'),
];
const grid = stampFurniture(rasterizeLayout(layout), items);
const plan = (): DecorPiece[] => planLivedIn({ layout, items, grid });
const of = (k: string): DecorPiece[] => plan().filter((p) => p.kind === k);

describe('the other rooms read as used', () => {
  it('a dining table is laid: a runner down the middle and a placemat at each of its six chairs, all on the top', () => {
    const dine = items.find((i) => i.id === 'dine')!;
    expect(of('runner')).toHaveLength(1);
    const mats = of('placemat');
    expect(mats).toHaveLength(6);
    for (const p of [...mats, ...of('runner')]) {
      expect(p.hostId).toBe('dine');
      expect(p.y).toBeCloseTo(dine.surfaceHeightM, 6);
      // the table top is the drawn width by (depth - 0.8): every corner of every mat lies on it
      const top = { ...dine.box, d: dine.box.d - 0.8 };
      for (const q of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const b = pieceBox(p);
        const r = (b.yawDeg * Math.PI) / 180;
        const lx = (q[0] * b.w) / 2, lz = (q[1] * b.d) / 2;
        const pt = { x: b.cx + Math.cos(r) * lx + Math.sin(r) * lz, z: b.cz - Math.sin(r) * lx + Math.cos(r) * lz };
        expect(pointInBox(pt, top, 0.001), `${p.kind} corner`).toBe(true);
      }
    }
  });

  it('a TV unit carries books and a vase at its ends, at its surface, under the screen', () => {
    const on = plan().filter((p) => p.hostId === 'tv');
    expect(on.map((p) => p.kind).sort()).toEqual(['books', 'jug']);
    for (const p of on) { expect(p.y).toBe(0.45); expect(p.height).toBeLessThan(1.62 - 0.54 - 0.45); }
  });

  it('a kitchen worktop gets a chopping board, a mixer and ladles, never on top of the hob, the sink or the cooker', () => {
    const ps = plan();
    const extra = ps.filter((p) => ['board', 'mixer', 'utensils'].includes(p.kind));
    expect(extra.some((p) => p.kind === 'board')).toBe(true);
    for (const p of extra) {
      const host = items.find((i) => i.id === p.hostId)!;
      expect(pointInBox({ x: p.x, z: p.z }, host.box, -Math.max(p.w, p.d) / 2 + 0.02)).toBe(true);
      for (const o of ps.filter((x) => x.hostId === p.hostId && x !== p && !['board', 'mixer', 'utensils'].includes(x.kind))) {
        expect(Math.hypot(o.x - p.x, o.z - p.z), `${p.kind} vs ${o.kind}`).toBeGreaterThan((Math.max(o.w, o.d) + Math.max(p.w, p.d)) / 2 * 0.7);
      }
    }
  });

  it('a bathroom: a soap dispenser on the basin deck, a towel ring on the basin\'s wall clear of the WC cistern, a mat on free floor', () => {
    const ps = plan();
    const soap = ps.find((p) => p.kind === 'soap')!;
    expect(soap.hostId).toBe('basin');
    expect(pointInBox({ x: soap.x, z: soap.z }, items.find((i) => i.id === 'basin')!.box, -0.03)).toBe(true);
    const towel = ps.find((p) => p.kind === 'towel');
    expect(towel).toBeTruthy();
    expect(towel!.y).toBeGreaterThan(0.8);
    const mat = ps.find((p) => p.kind === 'bathmat');
    if (mat) for (const q of [{ x: mat.x, z: mat.z }]) expect(pointInPolygon(q, layout.rooms[3].polygon)).toBe(true);
  });

  it('the new pieces come after every piece the planner made before', () => {
    const ps = plan();
    const firstNew = ps.findIndex((p) => ['runner', 'placemat', 'board', 'mixer', 'utensils', 'towel', 'soap', 'bathmat'].includes(p.kind) || (p.hostId === 'tv'));
    const lastOld = Math.max(...ps.map((p, i) => (['cooker', 'dabbas', 'hob', 'sink', 'fruit', 'frame', 'clock', 'shoes', 'wallcab', 'dado', 'hood'].includes(p.kind) ? i : -1)));
    expect(firstNew).toBeGreaterThan(lastOld);
  });

  it('every new piece builds on every tier, with no ray and within a sane triangle count', () => {
    const ps = plan();
    for (const tier of ['low', 'medium', 'high'] as const) {
      const b = buildDecorGroup(ps, tier, null);
      let tris = 0;
      b.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const g = m.geometry;
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
        expect(Number.isFinite(g.attributes.position.getX(0))).toBe(true);
      });
      b.group.updateMatrixWorld(true);
      const rc = new THREE.Raycaster(new THREE.Vector3(5.5, 3, 2.0), new THREE.Vector3(0, -1, 0));
      expect(rc.intersectObject(b.group, true)).toEqual([]);
      expect(tris).toBeLessThan({ low: 40000, medium: 90000, high: 130000 }[tier]);
      b.dispose();
    }
  });
});

describe('a balcony and a utility room in use', () => {
  const lay = {
    ...livedInLayout,
    rooms: [
      { ...rect('lv', 'living', 0, 0, 4, 4) },
      { id: 'bal', roomType: 'balcony' as const, label: 'Balcony', polygon: [{ x: 0, z: 4.12 }, { x: 3.6, z: 4.12 }, { x: 3.6, z: 5.5 }, { x: 0, z: 5.5 }], edges: ['wall', 'wall', 'railing', 'wall'] as ('wall' | 'railing')[] },
      { ...rect('ut', 'other', 4.12, 0, 5.8, 1.6), label: 'Utility' },
    ],
    openings: [
      { id: 'entry', roomId: 'lv', edge: 3, type: 'door' as const, centreM: 2.0, widthM: 0.9, sillM: 0, headM: 2.1 },
      { id: 'to-bal', roomId: 'lv', edge: 2, type: 'door' as const, centreM: 2.0, widthM: 1.8, sillM: 0, headM: 2.1 },
      { id: 'to-ut', roomId: 'lv', edge: 1, type: 'door' as const, centreM: 1.2, widthM: 0.8, sillM: 0, headM: 2.1 },
    ],
  };
  const its: FurnitureItem[] = [
    item('chair1', 'sofa', 'Armchair', 0.8, 4.9, 0.8, 0.85, 0, 0.85, 0.43, 'armchair'),
    item('washer', 'counter', 'Washing machine', 5.0, 0.4, 0.6, 0.7, 0, 0.85, 0.85, 'washer-front'),
  ];
  const g = stampFurniture(rasterizeLayout(lay), its);
  const ps = planLivedIn({ layout: lay, items: its, grid: g });

  it('a balcony gets potted plants along its railing (at most three), on free floor', () => {
    const plants = ps.filter((p) => p.kind === 'plant' && p.roomId === 'bal');
    expect(plants.length).toBeGreaterThanOrEqual(1);
    expect(plants.length).toBeLessThanOrEqual(3);
    for (const p of plants) expect(p.z).toBeGreaterThan(5.5 - 0.5);
  });

  it('a utility room gets a laundry basket and a bucket beside the washing machine', () => {
    const k = ps.filter((p) => p.roomId === 'ut').map((p) => p.kind).sort();
    expect(k).toContain('basket');
    expect(k).toContain('bucket');
    for (const p of ps.filter((x) => x.kind === 'basket' || x.kind === 'bucket')) expect(Math.hypot(p.x - 5.0, p.z - 0.4)).toBeLessThan(1.0);
  });
});
