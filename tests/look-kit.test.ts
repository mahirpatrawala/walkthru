// look-kit: placement rules for the typical Indian-flat fittings (fan, tube, switchboards, grills, cove, tiles, skirting) and the
// honesty rules around them: decor only, never in a partial room, never in a measurement, "Plain" removes it all. Synthetic layouts only.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createEmptyProperty } from '../src/core/layout-validate';
import { defaultEdges } from '../src/core/layout-geom';
import { rasterizeLayout } from '../src/core/layout-raster';
import { buildShell, shellStats } from '../src/engine/shell';
import { createLookMaterials } from '../src/look/materials';
import { mountKit } from '../src/look/kit';
import {
  COVE_DROP_M, FAN_MIN_ROOM_M2, KIT_NOTE, bedheadBoards, coveSites, doorBoards, fanSites, floorTileSpec, insetPolygon, kitPlan, masterBedroomId,
  skirtingRuns, tubeSites, windowSites,
} from '../src/look/kit/rules';
import type { FurnitureItem, Layout, Opening, RoomTag, RoomType } from '../src/types';

const rect = (id: string, type: RoomType, x0: number, z0: number, x1: number, z1: number, label = id, partial = false): RoomTag => ({
  id, roomType: type, label, polygon: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], edges: ['wall', 'wall', 'wall', 'wall'],
  ...(partial ? { partial: { reason: 'Only part of it is drawn.' } } : {}),
});
function layoutOf(rooms: RoomTag[], openings: Opening[] = [], wallHeightM = 2.6): Layout {
  const p = createEmptyProperty('synthetic-kit');
  p.layout.rooms = rooms.map((r) => ({ ...r, edges: r.edges.map((e, i) => (e === 'wall' ? defaultEdges(r, rooms)[i] : e)) }));
  p.layout.openings = openings;
  p.layout.wallHeightM = wallHeightM;
  return p.layout;
}
const door = (roomId: string, edge: number, centreM: number, widthM = 0.9): Opening => ({ id: `d-${roomId}-${edge}-${centreM}`, roomId, edge, type: 'door', centreM, widthM, sillM: 0, headM: 2.1 });
const win = (roomId: string, edge: number, centreM: number, widthM = 1.2): Opening => ({ id: `w-${roomId}-${edge}-${centreM}`, roomId, edge, type: 'window', centreM, widthM, sillM: 0.9, headM: 2.1 });
const item = (id: string, kind: FurnitureItem['kind'], cx: number, cz: number, w: number, d: number, yawDeg: number, heightM: number): FurnitureItem => ({
  id, source: 'real', kind, label: id, box: { cx, cz, w, d, yawDeg }, heightM, surfaceHeightM: heightM,
});

/** a flat: living 5 x 4, master 3.88 x 3.5, small bedroom 2.88 x 2.38 (6.9 m2), kitchen, bathroom, a partial bedroom and a balcony */
function flat(wallH = 2.6): Layout {
  return layoutOf([
    rect('living', 'living', 0, 0, 5, 4),
    rect('master', 'bedroom', 5.12, 0, 9, 3.5, 'Master bedroom'),
    rect('small', 'bedroom', 5.12, 3.62, 8, 6),
    rect('kitchen', 'kitchen', 0, 4.12, 3, 7),
    rect('bath', 'bathroom', 3.12, 4.12, 5, 6.5),
    rect('guess', 'bedroom', 9.12, 0, 12, 3.5, 'Guess room', true),
    { id: 'balcony', roomType: 'balcony', label: 'Balcony', polygon: [{ x: 0, z: -1.7 }, { x: 5, z: -1.7 }, { x: 5, z: -0.12 }, { x: 0, z: -0.12 }], edges: ['railing', 'railing', 'wall', 'railing'] },
  ], [door('living', 1, 2.0), door('living', 2, 4.4, 0.9), win('living', 3, 2, 1.8), win('master', 0, 2, 1.2), win('small', 2, 1.4, 1.0), door('kitchen', 1, 1.2, 0.8), door('small', 3, 1.2, 0.9)], wallH);
}

describe('ceiling fans', () => {
  it('one at the centre of each bedroom and living room of 7 m2 or more, and nowhere else', () => {
    const l = flat();
    const sites = fanSites(l);
    expect(sites.map((s) => s.roomId).sort()).toEqual(['living', 'master']);
    const living = sites.find((s) => s.roomId === 'living')!;
    expect(living.x).toBeCloseTo(2.5, 6);
    expect(living.z).toBeCloseTo(2, 6);
  });
  it('skips a bedroom under 7 m2, a partial room and a kitchen', () => {
    const l = flat();
    const small = l.rooms.find((r) => r.id === 'small')!;
    expect(Math.abs((small.polygon[1].x - small.polygon[0].x) * (small.polygon[2].z - small.polygon[1].z))).toBeLessThan(FAN_MIN_ROOM_M2);
    const ids = fanSites(l).map((s) => s.roomId);
    for (const skip of ['small', 'guess', 'kitchen', 'bath', 'balcony']) expect(ids).not.toContain(skip);
  });
  it('none under a ceiling too low to hang one', () => {
    expect(fanSites(flat(2.3))).toEqual([]);
  });
  it('the blades stay 0.5 m from every wall', () => {
    const l = flat();
    for (const s of fanSites(l)) {
      const r = l.rooms.find((x) => x.id === s.roomId)!;
      const xs = r.polygon.map((p) => p.x), zs = r.polygon.map((p) => p.z);
      const d = Math.min(s.x - Math.min(...xs), Math.max(...xs) - s.x, s.z - Math.min(...zs), Math.max(...zs) - s.z);
      expect(d - s.radiusM).toBeGreaterThanOrEqual(0.5 - 1e-9);
    }
  });
});

describe('tube lights', () => {
  it('sit on the longest wall of a habitable room or kitchen, clear of its window, and not in a bathroom', () => {
    const l = flat();
    const sites = tubeSites(l);
    expect(sites.map((s) => s.roomId).sort()).toEqual(['kitchen', 'living', 'master', 'small']);
    const living = sites.find((s) => s.roomId === 'living')!;
    // the longest edge is 5 m (edges 0 and 2); edge 2 has a door at 4.4 from the other end, edge 0 is free
    expect([0, 2]).toContain(living.edge);
    expect(living.lengthM).toBeLessThanOrEqual(1.22 + 1e-9);
    expect(living.y).toBeGreaterThan(1.8);
  });
  it('avoid tall furniture standing against the wall', () => {
    const l = layoutOf([rect('r', 'bedroom', 0, 0, 4, 3)]);
    const free = tubeSites(l)[0];
    const wardrobe = item('w', 'wardrobe', 2, 0.3, 4, 0.6, 0, 2.2);
    const blockedBy = tubeSites(l, [wardrobe])[0];
    expect(free.edge).toBe(0);
    expect(blockedBy.edge).not.toBe(0);
  });
});

describe('switchboards', () => {
  const one = (centre: number, extra: Opening[] = []): Layout => layoutOf([rect('r', 'bedroom', 0, 0, 4, 3)], [door('r', 0, centre), ...extra]);
  it('stand on the latch side of the door: the side with more clear wall, ties to the higher side', () => {
    const near = doorBoards(one(0.7))[0]; // door 0.25..1.15 hugs the left corner, so the hinge is left and the latch right
    expect(near.side).toBe('high');
    expect(near.u).toBeCloseTo(1.15 + 0.06 + 0.06, 6);
    expect(doorBoards(one(3.3))[0].side).toBe('low');
    expect(doorBoards(one(2.0))[0].side).toBe('high');
    expect(near.y).toBeCloseTo(1.2, 6);
  });
  it('use the other side when the latch side has no room, and none when neither has', () => {
    const crowded = one(0.9, [win('r', 0, 2.725, 2.55)]); // door 0.45..1.35, a window from 1.45 to the far corner
    expect(doorBoards(crowded)[0].side).toBe('low');
    const boxed = layoutOf([rect('r', 'bedroom', 0, 0, 1.4, 3)], [door('r', 0, 0.7, 0.9)]);
    expect(doorBoards(boxed)).toEqual([]);
  });
  it('a door is a door from both rooms, and bathrooms get no board inside', () => {
    const l = flat();
    const boards = doorBoards(l);
    expect(boards.some((b) => b.roomId === 'living')).toBe(true);
    expect(boards.some((b) => b.roomId === 'master')).toBe(true); // the living/master door cuts master's wall too
    expect(boards.every((b) => b.roomId !== 'bath')).toBe(true);
  });
  it('a board by the bed head, on the wall behind the headboard just past the bed', () => {
    const l = layoutOf([rect('r', 'bedroom', 0, 0, 4, 3)]);
    const bed = item('bed', 'bed', 2, 1.0, 1.5, 2, 0, 0.55); // head (back) on the z = 0 wall
    const b = bedheadBoards(l, [bed]);
    expect(b).toHaveLength(1);
    expect(b[0].kind).toBe('bedhead');
    expect(b[0].edge).toBe(0);
    expect(b[0].y).toBeCloseTo(1.1, 6);
    expect(Math.min(Math.abs(b[0].u - 1.25), Math.abs(b[0].u - 2.75))).toBeLessThan(0.4);
    expect(bedheadBoards(l, [item('bed', 'bed', 2, 1.8, 1.5, 2, 0, 0.55)])).toEqual([]); // not against a wall
    expect(bedheadBoards(l, [])).toEqual([]);
  });
});

describe('cove ceiling', () => {
  it('only where the ceiling minus 0.3 m is still 2.4 m or more', () => {
    expect(coveSites(flat(2.6))).toEqual([]);
    expect(coveSites(flat(2.69))).toEqual([]);
    expect(coveSites(flat(2.7)).length).toBeGreaterThan(0);
    expect(COVE_DROP_M).toBe(0.3);
  });
  it('living rooms and the master bedroom only', () => {
    expect(coveSites(flat(2.75)).map((c) => c.roomId).sort()).toEqual(['living', 'master']);
    expect(masterBedroomId(flat())).toBe('master');
  });
  it('the master is the largest bedroom when nothing is labelled', () => {
    const l = layoutOf([rect('a', 'bedroom', 0, 0, 3, 3), rect('b', 'bedroom', 3.12, 0, 7, 4)]);
    expect(masterBedroomId(l)).toBe('b');
    expect(masterBedroomId(layoutOf([rect('a', 'bedroom', 0, 0, 3, 3)]))).toBeNull();
  });
  it('skips a room with a wardrobe taller than the dropped ceiling', () => {
    const l = flat(2.75);
    expect(coveSites(l, [item('w', 'wardrobe', 7, 0.3, 1.8, 0.6, 0, 2.6)]).map((c) => c.roomId)).toEqual(['living']);
  });
  it('the inner edge is a clean smaller polygon, 0.45 m in', () => {
    const inner = insetPolygon(flat().rooms[0].polygon, 0.45)!;
    expect(inner.map((p) => [p.x, p.z])).toEqual([[0.45, 0.45], [4.55, 0.45], [4.55, 3.55], [0.45, 3.55]]);
    expect(insetPolygon(layoutOf([rect('t', 'living', 0, 0, 0.8, 3)]).rooms[0].polygon, 0.45)).toBeNull();
  });
});

describe('floor tiles', () => {
  const l = layoutOf([rect('big', 'living', 0, 0, 5, 4), rect('mid', 'bedroom', 5.12, 0, 8.5, 3.5), rect('bath', 'bathroom', 0, 4.12, 1.8, 6.5), rect('bal', 'balcony', 0, -1.7, 3, -0.12)]);
  const rot = (cx: number, cz: number, w: number, d: number): RoomTag => ({
    id: 'rot', roomType: 'living', label: 'rot', edges: ['wall', 'wall', 'wall', 'wall'],
    polygon: [[0, 0], [w, 0], [w, d], [0, d]].map(([u, v]) => ({ x: cx + u * Math.cos(0.5) - v * Math.sin(0.5), z: cz + u * Math.sin(0.5) + v * Math.cos(0.5) })),
  });
  it('are square, 800 in big rooms, 600 in ordinary ones, 300 anti-skid in bathrooms, 600 matt on balconies', () => {
    const by = (id: string) => floorTileSpec(l.rooms.find((r) => r.id === id)!, l)!;
    expect(by('big').tileU).toBe(0.8);
    expect(by('mid').tileU).toBe(0.6);
    expect(by('bath')).toMatchObject({ tileU: 0.3, tileV: 0.3, antiSkid: true });
    expect(by('bal')).toMatchObject({ tileU: 0.6, matt: true });
    for (const r of l.rooms) { const s = floorTileSpec(r, l)!; expect(s.tileU).toBe(s.tileV); }
  });
  it('follow the longest wall and start whole at a corner, never stretched, in any orientation', () => {
    const r = rot(3, 1, 4.2, 3.1);
    const s = floorTileSpec(r, layoutOf([r]))!;
    expect(Math.hypot(s.axisX, s.axisZ)).toBeCloseTo(1, 9);
    // the long wall (4.2 m) runs along the grid's u axis
    const a = r.polygon[0], b = r.polygon[1];
    expect(Math.abs((b.x - a.x) * s.axisX + (b.z - a.z) * s.axisZ)).toBeCloseTo(4.2, 6);
    expect(Math.abs(-(b.x - a.x) * s.axisZ + (b.z - a.z) * s.axisX)).toBeLessThan(1e-9);
    // every corner is in the grid's first quadrant, the nearest one exactly at the origin
    const uv = r.polygon.map((p) => [(p.x - s.originX) * s.axisX + (p.z - s.originZ) * s.axisZ, -(p.x - s.originX) * s.axisZ + (p.z - s.originZ) * s.axisX]);
    for (const [u, v] of uv) { expect(u).toBeGreaterThan(-1e-9); expect(v).toBeGreaterThan(-1e-9); }
    expect(Math.min(...uv.map((q) => q[0]))).toBeCloseTo(0, 9);
    expect(Math.min(...uv.map((q) => q[1]))).toBeCloseTo(0, 9);
  });
  it('the drawing wins: a drawn tile is used as is, a drawn plain floor has no grid', () => {
    const drawn = { ...l, finishes: { ...l.finishes, tile: { wM: 0.45, lM: 0.9 } } };
    const s = floorTileSpec(drawn.rooms[0], drawn)!;
    expect([s.tileU, s.tileV, s.drawn]).toEqual([0.45, 0.9, true]);
    expect(floorTileSpec(drawn.rooms[2], drawn)!.tileU).toBe(0.45);
    const plain = { ...l, finishes: { ...l.finishes, tile: null } };
    expect(floorTileSpec(plain.rooms[0], plain)).toBeNull();
    expect(kitPlan(plain).floors).toEqual([]);
  });
});

describe('skirting, windows, railings', () => {
  it('skirting runs along walls and stops at doors', () => {
    const l = layoutOf([rect('r', 'bedroom', 0, 0, 4, 3)], [door('r', 0, 2.0, 0.9)]);
    const e0 = skirtingRuns(l).filter((s) => s.edge === 0);
    expect(e0.length).toBe(2);
    expect(Math.max(...e0.map((s) => s.u0))).toBeGreaterThanOrEqual(2.45 - 1e-9);
    expect(Math.min(...e0.map((s) => s.u1))).toBeLessThanOrEqual(1.55 + 1e-9);
  });
  it('every window of a whole room gets a grill site; none in a partial room', () => {
    const l = layoutOf([rect('r', 'bedroom', 0, 0, 4, 3), rect('p', 'bedroom', 4.12, 0, 7, 3, 'p', true)], [win('r', 0, 2), win('p', 0, 1.5)]);
    expect(windowSites(l).map((w) => w.roomId)).toEqual(['r']);
  });
  it('a balcony railing is replaced by an MS one over the same pieces', () => {
    const l = flat();
    expect(kitPlan(l).railings.length).toBeGreaterThan(0);
    expect(kitPlan(l).railings.every((p) => p.kind === 'railing' && p.roomId === 'balcony')).toBe(true);
  });
});

describe('never in a partial room', () => {
  it('no site of any kind belongs to a partial room, not even by a door or window of its neighbour', () => {
    const l = flat(2.75);
    l.openings.push(door('guess', 3, 1.7), win('guess', 1, 1.5, 1.2));
    const furniture = [item('bed', 'bed', 10.5, 1.2, 1.5, 2, 0, 0.55)];
    const p = kitPlan(l, furniture);
    const ids = [...p.fans, ...p.tubes, ...p.boards, ...p.bedheads, ...p.windows, ...p.skirting, ...p.floors, ...p.coves].map((s) => s.roomId);
    expect(ids).not.toContain('guess');
    expect(p.railings.some((r) => r.roomId === 'guess')).toBe(false);
  });
  it('a railing in a partial room keeps the shell\'s solid railing: the kit adds none', () => {
    const l = layoutOf([rect('r', 'living', 0, 0, 4, 3), { ...rect('p', 'balcony', 0, -1.7, 4, -0.12, 'p', true), edges: ['railing', 'railing', 'wall', 'railing'] }]);
    expect(kitPlan(l).railings).toEqual([]);
  });
});

describe('decor only', () => {
  const stubViewer = (): { scene: THREE.Scene; onFrame: (cb: (dt: number) => void) => () => void } => ({ scene: new THREE.Scene(), onFrame: () => () => {} });
  const lookWith = (l: Layout) => {
    const mats = createLookMaterials({ wallHeightM: l.wallHeightM });
    return { materials: () => mats, trueColours: false, onChange: () => () => {} } as unknown as import('../src/look/look').Look;
  };

  it('does not change a layout, a measurement, the collision grid or any floor area', () => {
    const l = flat(2.75);
    const before = JSON.stringify(l);
    const grid = rasterizeLayout(l);
    const cells = Uint8Array.from(grid.cells);
    const shell = buildShell(l);
    const stats = JSON.stringify(shellStats(shell));
    const box = new THREE.Box3().setFromObject(shell);
    const v = stubViewer();
    v.scene.add(shell);
    const kit = mountKit({ viewer: v, layout: l, shell, look: lookWith(l) });
    expect(JSON.stringify(l)).toBe(before);
    expect(Array.from(rasterizeLayout(l).cells)).toEqual(Array.from(cells));
    expect(JSON.stringify(shellStats(shell))).toBe(stats);
    expect(new THREE.Box3().setFromObject(shell).equals(box)).toBe(true);
    // the kit is not part of the shell, and no ray can hit it
    let inShell = false;
    shell.traverse((o) => { if (o === kit.group || o.userData.kit) inShell = true; });
    expect(inShell).toBe(false);
    const rc = new THREE.Raycaster(new THREE.Vector3(2.5, 1.2, 2), new THREE.Vector3(0, 1, 0));
    expect(rc.intersectObject(kit.group, true)).toEqual([]);
    kit.dispose();
  });

  it('tags every lit part for time of day, off by default, and Plain removes the whole kit and restores the floors', () => {
    const l = flat(2.75);
    const shell = buildShell(l);
    const v = stubViewer();
    v.scene.add(shell);
    const floorOf = (id: string): THREE.Mesh => shell.getObjectByName(`floor:${id}`) as THREE.Mesh;
    const original = floorOf('living').material;
    const railingOriginal = (shell.getObjectByName('railings') as THREE.Mesh).material;
    const kit = mountKit({ viewer: v, layout: l, shell, look: lookWith(l), plain: false });
    const tags = new Map<string, THREE.Mesh>();
    kit.group.traverse((o) => { const t = o.userData.walkthruLight as string | undefined; if (t) tags.set(t, o as THREE.Mesh); });
    expect([...tags.keys()].sort()).toEqual(['cove', 'fan', 'tube']);
    for (const m of tags.values()) expect((m.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0);
    kit.setLit('tube', true);
    expect((tags.get('tube')!.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(1);
    // floors carry the room's tile grid, partial rooms keep their hatch
    expect(floorOf('living').material).not.toBe(original);
    expect((floorOf('guess').material as THREE.Material).userData.partialLook).toBe(true);
    expect((shell.getObjectByName('railings') as THREE.Mesh).material).not.toBe(railingOriginal);
    expect((shell.getObjectByName('railings') as THREE.Mesh).visible).toBe(true);
    kit.setPlain(true);
    expect(kit.group.visible).toBe(false);
    expect(floorOf('living').material).toBe(original);
    expect((shell.getObjectByName('railings') as THREE.Mesh).material).toBe(railingOriginal);
    kit.setPlain(false);
    expect(kit.group.visible).toBe(true);
    kit.dispose();
    expect(v.scene.children).not.toContain(kit.group);
  });

  it('the kit is a dozen-odd merged meshes, not one mesh per fixture', () => {
    const l = flat(2.75);
    const shell = buildShell(l);
    const v = stubViewer();
    const kit = mountKit({ viewer: v, layout: l, shell, look: null });
    expect(kit.stats().meshes).toBeLessThanOrEqual(20);
    expect(kit.stats().triangles).toBeGreaterThan(1000);
    kit.dispose();
  });

  it('the label is the one line the spec asks for', () => {
    expect(KIT_NOTE).toBe('Fan, lights, switches, grills and tiles are typical fittings, not from your drawing.');
    expect(KIT_NOTE).not.toMatch(/[:;—]/);
  });
});
