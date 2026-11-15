// Furnish mode with the second catalogue table, headless against the truth flat: a swing's zones come back with its verdict and are drawn, the
// room's kind reaches the fit check, a loft unit takes the home's ceiling, and a placed swing is solid at rest.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTruthProperty } from '../scripts/make-test-room';
import { cellValue } from '../src/core/grid-codec';
import { rasterizeLayout } from '../src/core/layout-raster';
import { createFurnishSession } from '../src/buyer/furnish';
import type { FurnishView } from '../src/buyer/furnish';
import type { BuyerContext } from '../src/buyer/context';
import { createFurnitureStore } from '../src/buyer/store';
import type { StorageLike } from '../src/buyer/store';
import type { Box } from '../src/types';

function rig(charPos = { x: 2, z: 2.5 }) {
  const property = buildTruthProperty('empty');
  const data = new Map<string, string>();
  const storage: StorageLike = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
  const parent = new THREE.Group();
  const scene = new THREE.Scene();
  scene.add(parent);
  const store = createFurnitureStore({ sceneId: 'test', baseGrid: rasterizeLayout(property.layout), initial: property.furniture, parent, storage, saveDelayMs: 0 });
  const drawn = { outlines: [] as Box[], lines: [] as string[] };
  const overlays = {
    outlineBox: (b: Box) => { drawn.outlines.push(b); return { remove() {} }; },
    line: (_a: unknown, _b: unknown, label: string) => { drawn.lines.push(label); return { remove() {} }; },
    clear: () => { drawn.outlines = []; drawn.lines = []; },
  };
  const ctx = {
    viewer: { scene, camera: new THREE.PerspectiveCamera() }, property, character: { position: charPos, yawDeg: 0, heightM: 1.75 }, overlays, furniture: store,
    grid: () => store.grid(), gridWithout: (ids: string[]) => store.gridWithout(ids), heightM: () => 1.75,
  } as unknown as BuyerContext;
  const views: FurnishView[] = [];
  const session = createFurnishSession(ctx, { render: (v) => views.push(v) });
  return { property, store, drawn, session, views };
}

describe('furnish mode with pieces that have zones', () => {
  it('a swing spawns with its arc read: the zones come back, are drawn as outlines with a line each, and the plain side lines are not doubled', () => {
    const t = rig();
    t.session.spawn('swing-2');
    t.session.setYaw(0);
    const v = t.session.moveTo(2, 2.5)!;
    expect(v.message).toContain('Swing needs');
    expect(v.message).toContain('Hanging needs a structural hook: check with your builder.');
    // two zone outlines (front and behind) beside the piece's own outline, and a labelled line each
    expect(t.drawn.outlines.length).toBe(3);
    expect(t.drawn.lines.filter((l) => /cm clear|of \d+ cm/.test(l)).length).toBe(2);
    expect(v.lines.map((l) => l.side)).not.toContain('front'); // the verdict still reports the numbers it measured
  });

  it('a swing with its back near a wall is blocked and cannot be placed; moved clear it can, and it then blocks the grid at rest', () => {
    const t = rig();
    t.session.spawn('swing-2');
    t.session.setYaw(270);
    // the west wall of the truth flat is near x = 0.06: put the swing's back (+x side after the turn is the front; its back faces -x) 40 cm off it
    const hit = t.session.moveTo(0.06 + 0.4 + 0.29, 2.5)!;
    expect(hit.verdict).toBe('blocked');
    expect(hit.canPlace).toBe(false);
    expect(t.session.place()).toBeNull();
    const ok = t.session.moveTo(1.5, 2.5)!;
    expect(ok.verdict).toBe('fits');
    const id = t.session.place()!;
    expect(id).toBeTruthy();
    const g = t.store.grid();
    expect(cellValue(g, 1.5, 2.5)).toBe(95);
  });

  it('the kind of room reaches the check: a WC in the bedroom is allowed with a note, a fridge in a bedroom too', () => {
    const t = rig();
    const bedroom = t.property.layout.rooms.find((r) => r.roomType === 'bedroom')!;
    const xs = bedroom.polygon.map((p) => p.x), zs = bedroom.polygon.map((p) => p.z);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    t.session.spawn('wc-western');
    t.session.setYaw(0);
    const v = t.session.moveTo(cx, cz)!;
    expect(v.canPlace, v.message).toBe(true);
    expect(v.verdict).toBe('tight');
    expect(v.message).toContain('is for a bathroom');
    t.session.spawn('fridge-1');
    expect(t.session.moveTo(cx, cz)!.message).toContain('usually in the kitchen');
  });

  it('a ceiling-height loft unit is as tall as the home\'s ceiling allows, less 4 cm', () => {
    const t = rig();
    t.session.spawn('loft-unit');
    t.session.moveTo(2, 2.5);
    const id = t.session.place();
    expect(id).toBeTruthy();
    const item = t.store.all().find((i) => i.id === id)!;
    expect(item.heightM).toBeCloseTo(t.property.layout.wallHeightM - 0.04, 6);
  });

  it('every new piece can be spawned (nothing throws and a verdict comes back)', () => {
    const t = rig();
    const ids = ['swing-2', 'swing-3', 'swing-2-frame', 'swing-3-frame', 'hang-chair', 'hang-chair-stand', 'recliner', 'bean-bag', 'sofa-bed', 'bunk-bed', 'diwan', 'tv-unit-150', 'mandir-wall', 'fridge-sbs', 'washer-front', 'wc-wallhung', 'shower-enclosure', 'bathtub', 'yoga-mat', 'treadmill', 'planter-pot', 'cot'];
    for (const id of ids) {
      const v = t.session.spawn(id);
      expect(v, id).not.toBeNull();
      expect(['fits', 'tight', 'blocked']).toContain(v!.verdict);
      t.session.cancel();
    }
  });
});
