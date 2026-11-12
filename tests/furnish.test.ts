// C4: furnish mode, headless. Pure helpers (spawn box, clearance lines, rotation wrap) against the truth flat, and the
// session state machine (spawn, drag, rotate, Place, Cancel, Move, Remove, Clear all, persistence, character nudge)
// against the real FurnitureStore with a fake context. The tray DOM, pointer capture and rendering are browser-only.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTruthProperty, truthGrid } from '../scripts/make-test-room';
import { catalogItem } from '../src/core/catalog';
import { boxAxes } from '../src/core/geometry';
import { rasterizeLayout } from '../src/core/layout-raster';
import { checkPlacement } from '../src/core/placement';
import {
  LINE_MAX_M, SPAWN_DISTANCE_M, cardLabel, clearanceLines, createFurnishSession, grabsBox, rawSpawnBox, rotateYaw, spawnBox,
} from '../src/buyer/furnish';
import type { FurnishView } from '../src/buyer/furnish';
import type { BuyerContext } from '../src/buyer/context';
import { createFurnitureStore, loadPlaced } from '../src/buyer/store';
import type { StorageLike } from '../src/buyer/store';
import { GRID_FREE } from '../src/types';
import type { Box, Side } from '../src/types';

const empty = truthGrid('empty');
const king = catalogItem('bed-king');
const sofa = catalogItem('sofa-3');
const kingBox: Box = { cx: 1.06, cz: 3.415, w: 1.93, d: 2.08, yawDeg: 90 };

describe('rotateYaw', () => {
  it('wraps at 360 in both directions', () => {
    expect(rotateYaw(350, 15)).toBe(5);
    expect(rotateYaw(345, 15)).toBe(0);
    expect(rotateYaw(0, -15)).toBe(345);
    expect(rotateYaw(5, -15)).toBe(350);
    expect(rotateYaw(270, 90)).toBe(0);
    expect(rotateYaw(0, -90)).toBe(270);
    expect(rotateYaw(90, 720)).toBe(90);
    expect(rotateYaw(-30, 0)).toBe(330);
  });
  it('24 steps of 15 degrees is one full turn, 4 of 90 too, with no drift', () => {
    let y = 37.5;
    for (let i = 0; i < 24; i++) y = rotateYaw(y, 15);
    expect(y).toBe(37.5);
    let z = 0;
    for (let i = 0; i < 4; i++) z = rotateYaw(z, -90);
    expect(z).toBe(0);
    for (let i = 0; i < 1000; i++) { y = rotateYaw(y, 15); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(360); }
  });
});

describe('spawn box', () => {
  it('is 1.8 m in front of the character with its front facing back at them', () => {
    const b = rawSpawnBox(sofa, { x: 2, z: 2.5 }, 0);
    expect(SPAWN_DISTANCE_M).toBe(1.8);
    expect(b.cx).toBeCloseTo(2, 9);
    expect(b.cz).toBeCloseTo(4.3, 9);
    expect(b.yawDeg).toBe(180);
    expect(b.w).toBe(2.1);
    expect(b.d).toBe(0.9);
    // the item's front axis points at the character
    const { a } = boxAxes(b);
    expect(a.x).toBeCloseTo(0, 9);
    expect(a.z).toBeCloseTo(-1, 9);
    // any heading: centre is 1.8 m away along the heading, yaw is heading + 180
    for (const yaw of [0, 37, 90, 200, 359]) {
      const r = rawSpawnBox(king, { x: 2, z: 2.5 }, yaw);
      expect(Math.hypot(r.cx - 2, r.cz - 2.5)).toBeCloseTo(1.8, 9);
      expect(r.yawDeg).toBeCloseTo((yaw + 180) % 360, 9);
      expect(Math.atan2(r.cx - 2, r.cz - 2.5) * 180 / Math.PI).toBeCloseTo(((yaw + 540) % 360) - 180, 6);
    }
  });

  it('a sofa spawned at (2, 2.5) facing +z lands at (2, 4.3) facing the character; the doorway behind it stops the snap', () => {
    // the back rays at x = 1.16, 2, 2.84: the last one runs into the door opening (x 2.7..3.6), so not all three hit within 0.40 m
    const b = spawnBox(empty, sofa, { x: 2, z: 2.5 }, 0);
    expect(b.cx).toBeCloseTo(2, 6);
    expect(b.cz).toBeCloseTo(4.3, 6);
    expect(b.yawDeg).toBe(180);
    expect(checkPlacement(empty, sofa, b, 2.6).verdict).not.toBe('blocked');
  });

  it('a sofa spawned facing the west wall squares up to it: back edge about 2 cm off the wall, yaw exactly square', () => {
    const raw = rawSpawnBox(sofa, { x: 2.4, z: 2.5 }, 270);
    const b = spawnBox(empty, sofa, { x: 2.4, z: 2.5 }, 270);
    console.log('sofa west-wall spawn', JSON.stringify(raw), '->', JSON.stringify(b));
    expect(raw.cx).toBeCloseTo(0.6, 6);
    expect(raw.yawDeg).toBeCloseTo(90, 6);
    expect(Math.abs(b.yawDeg - 90)).toBeLessThan(1.5);
    expect(b.cx).toBeLessThan(raw.cx);
    const backEdge = b.cx - b.d / 2;
    expect(backEdge).toBeGreaterThan(0.0);
    expect(backEdge).toBeLessThan(0.12);
    expect(checkPlacement(empty, sofa, b, 2.6).verdict).not.toBe('blocked');
  });

  it('a king bed there does not fit (the room is 5 m deep), it still spawns at the raw spot so the buyer can drag it', () => {
    const b = spawnBox(empty, king, { x: 2, z: 2.5 }, 0);
    expect(b.cx).toBeCloseTo(2, 6);
    expect(b.cz).toBeCloseTo(4.3, 6);
    expect(b.yawDeg).toBe(180);
    expect(checkPlacement(empty, king, b, 2.6).verdict).toBe('blocked');
  });
});

describe('clearance lines', () => {
  const r = checkPlacement(empty, king, kingBox, 2.6);
  const lines = clearanceLines(kingBox, r.clearanceM);

  it('the king bed head on the west wall gets exactly one line: 62 cm on the left', () => {
    // right 2.45, front 1.90 are over 1.5 m, back is pressed against the wall
    expect(lines).toHaveLength(1);
    const l = lines[0];
    expect(l.side).toBe('left');
    expect(l.label).toBe('62 cm');
    const len = Math.hypot(l.to.x - l.from.x, l.to.z - l.from.z);
    expect(Math.abs(len - 0.62)).toBeLessThan(0.06);
    // from the middle of the left side (z = 3.415 + 0.965) to the passage wall at z ~ 5.0
    expect(l.from.x).toBeCloseTo(1.06, 6);
    expect(l.from.z).toBeCloseTo(3.415 + 1.93 / 2, 6);
    expect(Math.abs(l.to.z - 5.0)).toBeLessThan(0.07);
    expect(l.to.x).toBeCloseTo(l.from.x, 6);
  });

  it('draws every side under 1.5 m, skips 1.5 m and over, skips a side flush against a wall', () => {
    const all = clearanceLines(kingBox, { front: 1.2, back: 0.6, left: 0.62, right: 1.49 });
    expect(all.map((l) => l.side).sort()).toEqual(['back', 'front', 'left', 'right']);
    const cut = clearanceLines(kingBox, { front: LINE_MAX_M, back: 0.02, left: 0.62, right: 3 } as Record<Side, number>);
    expect(cut.map((l) => l.side)).toEqual(['left']);
  });

  it('lines run along the outward normal and their length is the clearance', () => {
    const b: Box = { cx: 2, cz: 2, w: 1, d: 2, yawDeg: 0 };
    const out = clearanceLines(b, { front: 0.5, back: 0.4, left: 0.3, right: 0.2 });
    const get = (s: Side) => out.find((l) => l.side === s)!;
    expect(get('front').to.z - get('front').from.z).toBeCloseTo(0.5, 9);
    expect(get('back').to.z - get('back').from.z).toBeCloseTo(-0.4, 9);
    // yaw 0: right = +x, left = -x
    expect(get('right').to.x - get('right').from.x).toBeCloseTo(0.2, 9);
    expect(get('left').to.x - get('left').from.x).toBeCloseTo(-0.3, 9);
  });
});

describe('small helpers', () => {
  it('card label is name and size, as in the catalogue', () => {
    expect(cardLabel(king)).toBe('King bed · 183 × 198 cm (72 × 78 in)');
  });
  it('a press within 15 cm of the footprint grabs the box', () => {
    const b: Box = { cx: 2, cz: 2, w: 1, d: 2, yawDeg: 0 };
    expect(grabsBox(b, { x: 2, z: 2 })).toBe(true);
    expect(grabsBox(b, { x: 2.6, z: 2 })).toBe(true);
    expect(grabsBox(b, { x: 2.8, z: 2 })).toBe(false);
  });
});

// ---------------------------------------------------------------- the session against a real store

function fakeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => (data.has(k) ? data.get(k)! : null), setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

function rig(opts: { variant?: 'empty' | 'furnished'; charPos?: { x: number; z: number }; charYaw?: number; storage?: StorageLike } = {}) {
  const property = buildTruthProperty(opts.variant ?? 'empty');
  const storage = opts.storage ?? fakeStorage();
  const parent = new THREE.Group();
  const scene = new THREE.Scene();
  scene.add(parent);
  const store = createFurnitureStore({ sceneId: 'test', baseGrid: rasterizeLayout(property.layout), initial: property.furniture, parent, storage, saveDelayMs: 0 });
  const character = { position: opts.charPos ?? { x: 2, z: 2.5 }, yawDeg: opts.charYaw ?? 0, heightM: 1.75 };
  const calls = { outlines: [] as Array<{ tag?: string; color: string }>, lines: [] as Array<{ label: string; tag?: string }>, cleared: [] as Array<string | undefined> };
  const overlays = {
    outlineBox: (_b: Box, _y: number, color: string, tag?: string) => { calls.outlines.push({ tag, color }); return { remove() {} }; },
    line: (_a: unknown, _b: unknown, label: string, _c: string, tag?: string) => { calls.lines.push({ label, tag }); return { remove() {} }; },
    clear: (tag?: string) => { calls.cleared.push(tag); },
  };
  const ctx = {
    viewer: { scene, camera: new THREE.PerspectiveCamera() }, property, character, overlays, furniture: store,
    grid: () => store.grid(), gridWithout: (ids: string[]) => store.gridWithout(ids), heightM: () => 1.75,
  } as unknown as BuyerContext;
  const views: FurnishView[] = [];
  const session = createFurnishSession(ctx, { render: (v) => views.push(v) });
  return { property, storage, parent, scene, store, character, calls, ctx, views, session };
}

describe('furnish session', () => {
  it('spawn: a sofa lands in front of the character, verdict is live, the preview is not in the store yet', () => {
    const t = rig({ charPos: { x: 2, z: 2.5 }, charYaw: 0 });
    const v = t.session.spawn('sofa-3')!;
    expect(v.verdict).not.toBe('blocked');
    expect(v.message.startsWith('3-seat sofa fits')).toBe(true);
    expect(t.store.all()).toHaveLength(0);
    expect(t.scene.children.some((c) => c.name.startsWith('furniture:sofa-3'))).toBe(true);
    expect(t.session.view().phase).toBe('edit');
    expect(t.session.view().canPlace).toBe(true);
    // outline and clearance lines were drawn under the edit tag
    expect(t.calls.outlines.at(-1)).toEqual({ tag: 'furnish-edit', color: '#1E9E5A' });
  });

  it('king bed that is too big for where it lands is red and cannot be placed; dragging it into the corner fixes it', () => {
    const t = rig();
    const v = t.session.spawn('bed-king')!;
    expect(v.verdict).toBe('blocked');
    expect(v.message).toBe('King bed does not fit here.');
    expect(v.canPlace).toBe(false);
    expect(t.session.place()).toBeNull();
    expect(t.store.all()).toHaveLength(0);
    // drag it into the room, yaw 90, head on the west wall, then let go: it squares to the wall
    t.session.setYaw(90);
    t.session.moveTo(1.3, 2.5);
    const r = t.session.release()!;
    expect(r.verdict).toBe('fits');
    expect(r.canPlace).toBe(true);
    expect(r.box.cx - r.box.d / 2).toBeLessThan(0.1); // back against x ~ 0.06
    expect(r.box.cx - r.box.d / 2).toBeGreaterThan(0.0);
  });

  it('the acceptance bed: head on the west wall, 62 cm on the left, exact message and a "62 cm" line', () => {
    const t = rig();
    t.session.spawn('bed-king');
    t.session.setYaw(90);
    t.session.moveTo(1.06, 3.415);
    const v = t.session.verdict()!;
    expect(v.message).toBe('King bed fits. 62 cm walking space on the left.');
    expect(v.tone).toBe('good');
    expect(v.lines.map((l) => `${l.side} ${l.cm}`)).toEqual(['left 62']);
    expect(t.calls.lines.at(-1)).toEqual({ label: '62 cm', tag: 'furnish-edit' });
  });

  it('drag with a grab offset keeps the item under the pointer, and letting go snaps it to the wall', () => {
    const t = rig();
    t.session.spawn('sofa-3');
    t.session.setYaw(0);
    t.session.moveTo(2, 2);
    expect(t.session.startDrag({ x: 2.3, z: 2.1 })).toBe(true);
    t.session.dragTo({ x: 2.9, z: 3.1 });
    expect(t.session.working()!.box.cx).toBeCloseTo(2.6, 9);
    expect(t.session.working()!.box.cz).toBeCloseTo(3.0, 9);
    expect(t.session.dragging()).toBe(true);
    t.session.endDrag();
    expect(t.session.dragging()).toBe(false);
  });

  it('rotate: 90 degrees swaps which sides are which, and wraps', () => {
    const t = rig();
    t.session.spawn('sofa-3');
    t.session.setYaw(350);
    t.session.rotate(15);
    expect(t.session.working()!.box.yawDeg).toBe(5);
    t.session.rotate(-90);
    expect(t.session.working()!.box.yawDeg).toBe(275);
    t.session.rotate(-90);
    t.session.rotate(-90);
    t.session.rotate(-90);
    expect(t.session.working()!.box.yawDeg).toBe(5);
  });

  it('Place: adds a solid, persisted item, selects it, keeps the verdict; the grid now blocks it', () => {
    const t = rig();
    t.session.spawn('bed-queen');
    t.session.setYaw(90);
    t.session.moveTo(1.1, 2.5);
    t.session.release();
    const id = t.session.place()!;
    expect(id).toBeTruthy();
    expect(t.store.all().map((i) => i.id)).toEqual([id]);
    expect(t.store.get(id)!.source).toBe('virtual');
    expect(t.store.get(id)!.catalogId).toBe('bed-queen');
    expect(t.session.working()).toBeNull();
    expect(t.session.selected()).toBe(id);
    expect(t.session.view().phase).toBe('selected');
    expect(t.session.view().canMove).toBe(true);
    // solid: the cell at the bed centre is no longer free
    const b = t.store.get(id)!.box;
    const g = t.store.grid();
    expect(g.cells[Math.floor((b.cz - g.originZ) / g.cellM) * g.nx + Math.floor((b.cx - g.originX) / g.cellM)]).not.toBe(GRID_FREE);
    // persisted straight away (flush), and it comes back after a reload
    const stored = loadPlaced(t.storage, 'test');
    expect(stored.map((i) => i.id)).toEqual([id]);
    expect(stored[0].box.cx).toBeCloseTo(b.cx, 9);
    // the preview mesh is gone, the store's mesh is the only one
    expect(t.scene.children.filter((c) => c !== t.parent)).toHaveLength(0);
    expect(t.parent.children).toHaveLength(1);
  });

  it('Place nudges the character out of the item with nearestFree', () => {
    const t = rig({ charPos: { x: 2, z: 2.5 } });
    t.session.spawn('sofa-3');
    t.session.setYaw(0);
    t.session.moveTo(2, 2.5); // right on top of the character
    const id = t.session.place()!;
    expect(id).toBeTruthy();
    const p = t.character.position;
    expect(p.x !== 2 || p.z !== 2.5).toBe(true);
    const b = t.store.get(id)!.box;
    // no longer inside the footprint
    expect(Math.abs(p.z - b.cz) > b.d / 2 || Math.abs(p.x - b.cx) > b.w / 2).toBe(true);
  });

  it('Cancel drops the preview and leaves nothing behind', () => {
    const t = rig();
    t.session.spawn('sofa-3');
    t.session.cancel();
    expect(t.session.working()).toBeNull();
    expect(t.session.view().phase).toBe('browse');
    expect(t.store.all()).toHaveLength(0);
    expect(t.scene.children.filter((c) => c !== t.parent)).toHaveLength(0);
    expect(t.storage.getItem('walkthru:test:placed')).toBeNull();
  });

  it('spawning a second item replaces the first one being placed', () => {
    const t = rig();
    t.session.spawn('sofa-3');
    t.session.spawn('wardrobe-2');
    expect(t.session.working()!.id.startsWith('wardrobe-2')).toBe(true);
    expect(t.scene.children.filter((c) => c !== t.parent)).toHaveLength(1);
  });

  it('Move: the placed item can be picked up, dragged, Cancel puts it back, Place commits the new spot', () => {
    const t = rig();
    t.session.spawn('sofa-3');
    t.session.setYaw(0);
    t.session.moveTo(2, 2);
    const id = t.session.place()!;
    const before = t.store.get(id)!.box;
    expect(t.session.beginMove()).toBe(true);
    expect(t.store.mesh(id)!.visible).toBe(false);
    expect(t.session.working()!.kind).toBe('move');
    t.session.moveTo(1.5, 3);
    expect(t.store.get(id)!.box.cx).toBeCloseTo(before.cx, 9); // the store is untouched until Place
    t.session.cancel();
    expect(t.store.mesh(id)!.visible).toBe(true);
    expect(t.store.get(id)!.box).toEqual(before);
    // again, this time commit
    t.session.select(id);
    t.session.beginMove();
    t.session.moveTo(1.5, 3);
    expect(t.session.place()).toBe(id);
    expect(t.store.get(id)!.box.cx).toBeCloseTo(1.5, 9);
    expect(t.store.all()).toHaveLength(1);
    expect(loadPlaced(t.storage, 'test')[0].box.cz).toBeCloseTo(3, 9);
  });

  it('while moving, the verdict ignores the item itself (no "collides" with its old spot)', () => {
    const t = rig();
    t.session.spawn('sofa-3');
    t.session.setYaw(0);
    t.session.moveTo(2, 2);
    t.session.place();
    t.session.beginMove();
    t.session.moveTo(2.2, 2.1); // overlaps where it used to be
    expect(t.session.verdict()!.verdict).not.toBe('blocked');
  });

  it('Remove deletes a placed item and its saved copy', () => {
    const t = rig();
    t.session.spawn('sofa-3');
    const id = t.session.place()!;
    expect(t.session.removeSelected()).toBe(true);
    expect(t.store.all()).toHaveLength(0);
    expect(t.session.selected()).toBeNull();
    expect(t.storage.getItem('walkthru:test:placed')).toBeNull();
    expect(t.session.remove(id)).toBe(false);
  });

  it('real items can be selected (info only) but not moved or removed; the buyer count ignores them', () => {
    const t = rig({ variant: 'furnished' });
    const real = t.store.all().find((i) => i.source === 'real')!;
    t.session.select(real.id);
    const v = t.session.view();
    expect(v.phase).toBe('selected');
    expect(v.canMove).toBe(false);
    expect(v.canRemove).toBe(false);
    expect(v.message).toContain('cannot be moved');
    expect(t.session.beginMove()).toBe(false);
    expect(t.session.removeSelected()).toBe(false);
    expect(t.store.has(real.id)).toBe(true);
    expect(v.buyerCount).toBe(0);
  });

  it('Clear all removes the buyer items and nothing else', () => {
    const t = rig({ variant: 'furnished' });
    const realCount = t.store.all().length;
    expect(realCount).toBeGreaterThan(0);
    t.session.spawn('sofa-3'); t.session.setYaw(0); t.session.moveTo(2, 0.6); expect(t.session.place()).toBeTruthy();
    t.session.spawn('wardrobe-2'); t.session.setYaw(0); t.session.moveTo(1.2, 3.8); expect(t.session.place()).toBeTruthy();
    expect(t.session.view().buyerCount).toBe(2);
    expect(t.session.clearAll()).toBe(2);
    expect(t.store.all()).toHaveLength(realCount);
    expect(t.session.view().buyerCount).toBe(0);
    expect(t.storage.getItem('walkthru:test:placed')).toBeNull();
    expect(t.session.clearAll()).toBe(0);
  });

  it('a wardrobe under a low ceiling is red with the ceiling copy', () => {
    const t = rig();
    t.property.layout.wallHeightM = 2.0;
    const v = t.session.spawn('wardrobe-2')!;
    expect(v.verdict).toBe('blocked');
    expect(v.reason).toBe('too-tall');
    expect(v.message).toBe('2-door wardrobe is too tall for this ceiling (2.0 m).');
  });

  it('view updates are pushed to the UI only when they change', () => {
    const t = rig();
    const n0 = t.views.length;
    t.session.update();
    t.session.update();
    expect(t.views.length).toBe(n0);
    t.session.spawn('sofa-3');
    expect(t.views.length).toBe(n0 + 1);
    expect(t.views.at(-1)!.phase).toBe('edit');
  });

  it('a placed item appears in the store for a fresh load (reload round trip)', () => {
    const t = rig();
    t.session.spawn('sofa-3'); t.session.moveTo(2, 1.2);
    const id = t.session.place()!;
    const again = rig({ storage: t.storage });
    expect(again.store.has(id)).toBe(true);
    expect(again.session.view().buyerCount).toBe(1);
  });
});
