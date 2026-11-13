// "Lived-in" decor (src/look/lived-in): where it may go, and that it can never change a measurement (SPEC 16.2).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { boxAxes, boxCorners, pointInBox, pointInPolygon } from '../src/core/geometry';
import { cellValue } from '../src/core/grid-codec';
import { circleFree } from '../src/core/grid-query';
import { computeEdgeFrames } from '../src/core/layout-geom';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { buildDecorGroup } from '../src/look/lived-in/build';
import {
  LIVED_IN_KEY, LIVED_IN_LABEL, createLivedIn, initialLivedIn, pieceBox, planLivedIn, readLivedIn, writeLivedIn,
} from '../src/look/lived-in';
import type { DecorPiece } from '../src/look/lived-in';
import { CHARACTER_RADIUS_M, GRID_FREE } from '../src/types';
import type { Grid, Vec2 } from '../src/types';
import { livedInFurniture, livedInLayout } from './helpers/lived-in-flat';

const baseGrid = rasterizeLayout(livedInLayout);
const grid = stampFurniture(baseGrid, livedInFurniture);
const plan = (): DecorPiece[] => planLivedIn({ layout: livedInLayout, items: livedInFurniture, grid });
const pieces = plan();
const kinds = (k: DecorPiece['kind']): DecorPiece[] => pieces.filter((p) => p.kind === k);

function samples(p: DecorPiece): Vec2[] {
  const box = pieceBox(p);
  const { a, b } = boxAxes(box);
  const out: Vec2[] = [];
  for (const u of [-0.5, 0, 0.5]) for (const v of [-0.5, 0, 0.5]) {
    out.push({ x: box.cx + b.x * u * box.w + a.x * v * box.d, z: box.cz + b.z * u * box.w + a.z * v * box.d });
  }
  return out;
}
const roomOf = (id: string) => livedInLayout.rooms.find((r) => r.id === id)!;

/** an independent flood fill of the character-sized walkable floor, with extra blocked discs */
function walkableComponents(g: Grid, blocked: { x: number; z: number; r: number }[]): number {
  const ok = new Uint8Array(g.nx * g.nz);
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
    const x = g.originX + (i + 0.5) * g.cellM, z = g.originZ + (j + 0.5) * g.cellM;
    if (g.cells[j * g.nx + i] !== GRID_FREE) continue;
    if (blocked.some((b) => Math.hypot(x - b.x, z - b.z) <= b.r)) continue;
    if (circleFree(g, x, z, CHARACTER_RADIUS_M)) ok[j * g.nx + i] = 1;
  }
  const seen = new Uint8Array(ok.length);
  let comps = 0;
  for (let s = 0; s < ok.length; s++) {
    if (!ok[s] || seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let size = 0;
    while (stack.length) {
      const k = stack.pop()!;
      size++;
      const i = k % g.nx, j = (k - i) / g.nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.nz) continue;
        const q = jj * g.nx + ii;
        if (ok[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (size >= 120) comps++; // slivers under 0.3 m2 are not places
  }
  return comps;
}

describe('lived-in plan: what a home gets', () => {
  it('dresses the usual places of an Indian flat', () => {
    expect(kinds('cushion').some((p) => p.hostId === 'sofa')).toBe(true);
    expect(kinds('cushion').some((p) => p.hostId === 'bed')).toBe(true);
    expect(kinds('throw').length).toBeGreaterThan(0);
    expect(kinds('books').some((p) => p.hostId === 'study')).toBe(true);
    expect(kinds('lamp').some((p) => p.hostId === 'side')).toBe(true);
    expect(kinds('cooker').some((p) => p.hostId === 'platform')).toBe(true);
    expect(kinds('dabbas').some((p) => p.hostId === 'platform')).toBe(true);
    expect(kinds('fruit').some((p) => p.hostId === 'dining')).toBe(true);
    expect(kinds('rug').map((p) => p.roomId)).toEqual(['living']);
    expect(kinds('plant').length).toBeGreaterThan(0);
    expect(kinds('shoes').map((p) => p.roomId)).toEqual(['living']);
    expect(kinds('clock').map((p) => p.roomId)).toEqual(['living']);
    expect(kinds('frame').length).toBeGreaterThan(0);
    expect(kinds('pooja').map((p) => p.roomId)).toEqual(['pooja']);
    expect(kinds('curtain').some((p) => p.roomId === 'bedroom')).toBe(true);
  });

  it('is the same list every time (a buyer sees one home on every visit)', () => {
    expect(JSON.stringify(plan())).toBe(JSON.stringify(pieces));
  });

  it('puts the shoes beside the door that leads outside, not across it', () => {
    const shoes = kinds('shoes')[0];
    const doorX = 0, doorZ = 3.6 - 1.6; // the entry door, in the west wall (that edge runs from south to north)
    expect(Math.abs(shoes.x - doorX)).toBeLessThan(0.45);
    expect(Math.abs(shoes.z - doorZ)).toBeGreaterThan(0.45 + 0.1);
  });
});

describe('lived-in plan: where it must never go', () => {
  it('never in a room that is only partly on the drawing, nor on furniture standing in one', () => {
    const partial = livedInLayout.rooms.filter((r) => r.partial);
    expect(partial.length).toBe(1);
    for (const p of pieces) {
      expect(p.roomId).not.toBe('store');
      expect(p.hostId === 'store-bed' || p.hostId === 'store-counter').toBe(false);
      for (const q of samples(p)) for (const r of partial) expect(pointInPolygon(q, r.polygon)).toBe(false);
    }
  });

  it('floor pieces stand on free cells of the walking grid, inside their own room', () => {
    for (const p of pieces.filter((x) => x.place === 'floor' && x.kind !== 'rug')) {
      const room = roomOf(p.roomId);
      for (const q of samples(p)) {
        expect(pointInPolygon(q, room.polygon)).toBe(true);
        expect(cellValue(grid, q.x, q.z)).toBe(GRID_FREE);
      }
    }
  });

  it('the rug is only ever over free floor or its own sofa, inside its room', () => {
    const rug = kinds('rug')[0];
    const sofa = livedInFurniture.find((i) => i.id === 'sofa')!;
    for (const q of samples(rug)) {
      expect(pointInPolygon(q, roomOf(rug.roomId).polygon)).toBe(true);
      const free = cellValue(grid, q.x, q.z) === GRID_FREE;
      expect(free || pointInBox(q, sofa.box, -0.02)).toBe(true);
    }
    for (const it of livedInFurniture.filter((i) => i.id !== 'sofa')) {
      for (const q of samples(rug)) expect(pointInBox(q, it.box)).toBe(false);
    }
  });

  it('no floor piece (rug included) covers a doorway or an open edge', () => {
    const doors = livedInLayout.openings.filter((o) => o.type !== 'window');
    const frames = computeEdgeFrames(livedInLayout);
    for (const p of pieces.filter((x) => x.place === 'floor')) {
      const box = pieceBox(p);
      for (const o of doors) {
        const f = frames.find((fr) => fr.roomId === o.roomId && fr.edge === o.edge)!;
        const at = { x: f.a.x + f.dir.x * o.centreM, z: f.a.z + f.dir.z * o.centreM };
        // the doorway's own footprint (its width by the wall's depth) is never under a piece
        for (const u of [-0.5, 0, 0.5]) {
          const q = { x: at.x + f.dir.x * u * o.widthM, z: at.z + f.dir.z * u * o.widthM };
          expect(pointInBox(q, { ...box, w: box.w + 0.1, d: box.d + 0.1 })).toBe(false);
        }
      }
    }
  });

  it('floor pieces never cut the walkable floor in two (before and after, by an independent flood fill)', () => {
    const before = walkableComponents(grid, []);
    const discs = pieces.filter((p) => p.place === 'floor' && p.kind !== 'rug').map((p) => ({ x: p.x, z: p.z, r: Math.max(p.w, p.d) / 2 }));
    expect(discs.length).toBeGreaterThan(0);
    expect(walkableComponents(grid, discs)).toBeLessThanOrEqual(before);
  });

  it('surface pieces sit inside the box of a real item, at its surface height', () => {
    const items = new Map(livedInFurniture.map((i) => [i.id, i]));
    for (const p of pieces.filter((x) => x.place === 'surface')) {
      const host = items.get(p.hostId!)!;
      expect(host.source).toBe('real');
      for (const c of boxCorners(pieceBox(p))) expect(pointInBox(c, host.box, -0.06)).toBe(true);
      expect(p.y).toBeGreaterThanOrEqual(host.surfaceHeightM - 1e-9);
      expect(p.y).toBeLessThanOrEqual(host.surfaceHeightM + 0.06);
    }
  });

  it('wall pieces hang on a plain wall, clear of every door and window (a curtain only meets its own window)', () => {
    const frames = computeEdgeFrames(livedInLayout);
    for (const p of pieces.filter((x) => x.place === 'wall')) {
      const f = frames.find((fr) => fr.roomId === p.roomId && fr.kind === 'wall' && Math.abs((p.x - fr.a.x) * fr.out.x + (p.z - fr.a.z) * fr.out.z) < 0.02
        && (p.x - fr.a.x) * fr.dir.x + (p.z - fr.a.z) * fr.dir.z > -0.01 && (p.x - fr.a.x) * fr.dir.x + (p.z - fr.a.z) * fr.dir.z < fr.length + 0.01);
      expect(f, `${p.kind} is on a wall`).toBeTruthy();
      const u = (p.x - f!.a.x) * f!.dir.x + (p.z - f!.a.z) * f!.dir.z;
      for (const o of livedInLayout.openings.filter((x) => x.roomId === f!.roomId && x.edge === f!.edge)) {
        const overlap = u - p.w / 2 < o.centreM + o.widthM / 2 && u + p.w / 2 > o.centreM - o.widthM / 2;
        if (p.kind === 'curtain' && o.type === 'window') continue;
        expect(overlap, `${p.kind} overlaps ${o.id}`).toBe(false);
      }
      // faces into the room
      const into = Math.sin((p.yawDeg * Math.PI) / 180) * -f!.out.x + Math.cos((p.yawDeg * Math.PI) / 180) * -f!.out.z;
      expect(into).toBeGreaterThan(0.99);
    }
  });

  it('no wall piece hangs behind something taller than its bottom edge', () => {
    for (const p of pieces.filter((x) => x.place === 'wall' && x.kind !== 'curtain')) {
      const box = pieceBox({ ...p, d: 0.4, place: 'wall' });
      for (const it of livedInFurniture.filter((i) => i.heightM > p.y)) {
        for (const c of boxCorners(it.box)) expect(pointInBox(c, { ...box, w: p.w - 0.02 })).toBe(false);
      }
    }
  });
});

describe('lived-in decor changes no measurement', () => {
  it('planning leaves the walking grid exactly as it was', () => {
    const copy = new Uint8Array(grid.cells);
    plan();
    expect(Array.from(grid.cells)).toEqual(Array.from(copy));
    // and the grid the decor was planned on is the one without it: nothing of decor is stamped into the base layout
    expect(Array.from(rasterizeLayout(livedInLayout).cells)).toEqual(Array.from(baseGrid.cells));
  });

  it('no decor mesh can be hit by a ray, so the measure tool and the furnish picker never see it', () => {
    const built = buildDecorGroup(pieces, 'medium');
    let meshes = 0;
    built.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes++; });
    expect(meshes).toBeGreaterThan(pieces.length);
    built.group.updateMatrixWorld(true);
    const rc = new THREE.Raycaster();
    for (const p of pieces) {
      const top = p.place === 'wall' ? p.y + p.height / 2 : p.y + p.height * 0.5;
      rc.set(new THREE.Vector3(p.x, top + 2, p.z), new THREE.Vector3(0, -1, 0));
      expect(rc.intersectObject(built.group, true)).toEqual([]);
      const from = pieceBox(p);
      const n = boxAxes(from).a; // from in front of a wall piece, straight at it
      rc.set(new THREE.Vector3(from.cx + n.x * 1.5, top, from.cz + n.z * 1.5), new THREE.Vector3(-n.x, 0, -n.z));
      expect(rc.intersectObject(built.group, true)).toEqual([]);
    }
    built.dispose();
  });

  it('behind decor, a measure ray still lands on the floor of the shell', () => {
    const built = buildDecorGroup(pieces, 'medium');
    const shell = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
    const rug = kinds('rug')[0];
    const scene = new THREE.Group();
    scene.add(shell, built.group);
    scene.updateMatrixWorld(true);
    const rc = new THREE.Raycaster(new THREE.Vector3(rug.x, 3, rug.z), new THREE.Vector3(0, -1, 0));
    const hits = rc.intersectObjects([shell, built.group], true);
    expect(hits[0].object).toBe(shell);
    expect(hits[0].point.y).toBeCloseTo(0, 6);
    built.dispose();
  });
});

describe('lived-in mode: switch, label and memory', () => {
  const makeStore = () => ({
    all: () => livedInFurniture,
    gridWithout: (ids: string[]) => stampFurniture(baseGrid, livedInFurniture.filter((i) => !ids.includes(i.id))),
    onChange: () => () => {},
  });
  const memory = (): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Record<string, string> } => {
    const data: Record<string, string> = {};
    return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
  };

  it('says what the decor is, in the fixed words', () => {
    expect(LIVED_IN_LABEL).toBe('Decor added to show a lived-in home. Not from your drawing.');
  });

  it('remembers the viewer\'s choice, falls back to the home\'s default, and survives storage that throws', () => {
    const m = memory();
    expect(initialLivedIn(m, true)).toBe(true);
    expect(initialLivedIn(m, false)).toBe(false);
    writeLivedIn(m, false);
    expect(m.data[LIVED_IN_KEY]).toBe('0');
    expect(initialLivedIn(m, true)).toBe(false);
    writeLivedIn(m, true);
    expect(readLivedIn(m)).toBe(true);
    const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    expect(readLivedIn(broken)).toBeNull();
    expect(() => writeLivedIn(broken, true)).not.toThrow();
    expect(initialLivedIn(broken, true)).toBe(true);
    expect(readLivedIn(null)).toBeNull();
  });

  it('builds nothing until it is switched on, then adds one group, and hides it when suppressed', () => {
    const parent = new THREE.Group();
    const m = memory();
    const li = createLivedIn({ parent, layout: livedInLayout, store: makeStore(), storage: m, defaultOn: false });
    expect(li.enabled).toBe(false);
    expect(li.group()).toBeNull();
    expect(parent.children.length).toBe(0);
    let heard: boolean | null = null;
    li.onChange((on) => { heard = on; });
    li.setEnabled(true);
    expect(heard).toBe(true);
    expect(m.data[LIVED_IN_KEY]).toBe('1');
    expect(li.group()).not.toBeNull();
    expect(parent.children.length).toBe(1);
    expect(li.group()!.visible).toBe(true);
    li.setSuppressed(true);
    expect(li.group()!.visible).toBe(false);
    li.setSuppressed(false);
    li.setEnabled(false);
    expect(li.group()!.visible).toBe(false);
    expect(m.data[LIVED_IN_KEY]).toBe('0');
    li.dispose();
    expect(parent.children.length).toBe(0);
  });

  it('is on at once for a sample home (default on) unless the viewer said no', () => {
    const on = createLivedIn({ parent: new THREE.Group(), layout: livedInLayout, store: makeStore(), storage: memory(), defaultOn: true });
    expect(on.enabled).toBe(true);
    expect(on.group()).not.toBeNull();
    const said = memory();
    writeLivedIn(said, false);
    const off = createLivedIn({ parent: new THREE.Group(), layout: livedInLayout, store: makeStore(), storage: said, defaultOn: true });
    expect(off.enabled).toBe(false);
  });

  it('hides floor decor under a piece of furniture the buyer places, never moves it', () => {
    const parent = new THREE.Group();
    let cb: () => void = () => {};
    let placed: typeof livedInFurniture = [];
    const store = {
      all: () => [...livedInFurniture, ...placed],
      gridWithout: (ids: string[]) => stampFurniture(baseGrid, livedInFurniture.filter((i) => !ids.includes(i.id))),
      onChange: (f: () => void) => { cb = f; return () => {}; },
    };
    const li = createLivedIn({ parent, layout: livedInLayout, store, storage: memory(), defaultOn: true });
    const plant = li.pieces().find((p) => p.kind === 'plant')!;
    const obj = li.group()!.getObjectByName(`decor:${plant.id}`)!;
    expect(obj.visible).toBe(true);
    placed = [{ id: 'trial-bed', source: 'virtual', kind: 'bed', label: 'Bed', box: { cx: plant.x, cz: plant.z, w: 1.5, d: 1.9, yawDeg: 0 }, heightM: 0.5, surfaceHeightM: 0.5 }];
    cb();
    expect(obj.visible).toBe(false);
    expect(obj.position.x).toBeCloseTo(plant.x, 9);
    placed = [];
    cb();
    expect(obj.visible).toBe(true);
  });
});
