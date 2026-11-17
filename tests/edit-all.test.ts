// edit-all: everything a buyer sees in a home is tappable and editable in "My layout": furniture that came with the home can be moved and
// resized, fittings (AC, fan, tube, downlights, wall lights, curtains, rug, switchboards, plants, clock, picture, the drawing's chairs ...) can be
// moved, resized and removed. The overlay is stored, carried in the link, cleared by Reset, and never touches the home as drawn (SPEC 16.2).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTruthProperty } from '../scripts/make-test-room';
import { rasterizeLayout } from '../src/core/layout-raster';
import { computeEdgeFrames } from '../src/core/layout-geom';
import { checkFor } from '../src/core/checks';
import { liePose } from '../src/core/poses';
import { createFurnitureStore } from '../src/buyer/store';
import { createWardrobes } from '../src/buyer/wardrobe';
import type { StorageLike } from '../src/buyer/store';
import { createFurnishSession } from '../src/buyer/furnish';
import type { BuyerContext } from '../src/buyer/context';
import { createBuyerContext } from '../src/buyer/context';
import { createFittingsApi } from '../src/buyer/fittings-api';
import { SHARE_PARAM, decodeLayout, emptyLayout, encodeLayout, mineKey, parseMine, serializeMine, shareUrl } from '../src/buyer/my-layout';
import { MOVED_NOTE, applyEdit, editNote, editOf, isNoEdit, resizePatch, sizeLimits } from '../src/buyer/resize';
import { buildSeats } from '../src/buyer/seats';
import { syncHosted } from '../src/buyer/layout-chip';
import {
  allowedCentres, checkFloorSpot, createFittingRegistry, emptyFittings, fittingsClear, fittingsFromWire, fittingsMove, fittingsRemove, fittingsRestore, fittingsSize,
  fittingsToWire, hitSlack, isEmptyFittings, pickFitting, rayHitsObb, resolveCeilingMove, resolveWallMove, sanitizeFittings,
} from '../src/look/fittings';
import type { FittingRecord, FittingsOverlay } from '../src/look/fittings';
import { buildDecorGroup as buildDesign, activeFixtures } from '../src/look/design-mount';
import { kitFittings, wallInfosOf } from '../src/look/kit/fittings';
import { mountKit } from '../src/look/kit';
import { planLivedIn } from '../src/look/lived-in/plan';
import { livedInFittings } from '../src/look/lived-in/fittings';
import { createLivedIn } from '../src/look/lived-in';
import { createLookMaterials } from '../src/look/materials';
import { setStyle, getStyle } from '../src/look/style';
import { PACKS } from '../src/look/packs';
import { livedInFurniture, livedInLayout } from './helpers/lived-in-flat';
import { PRISTINE_CHECKSUM_KEY } from '../src/look/baked/assign';
import type { Box, FurnitureItem, Layout } from '../src/types';

// ---------------------------------------------------------------- helpers

function fakeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}

function rig(opts: { shareCode?: string | null; storage?: StorageLike & { data: Map<string, string> } } = {}) {
  const property = buildTruthProperty('furnished');
  const storage = opts.storage ?? fakeStorage();
  const parent = new THREE.Group();
  const scene = new THREE.Scene();
  scene.add(parent);
  const initial = property.furniture;
  const store = createFurnitureStore({ sceneId: 'ea', baseGrid: rasterizeLayout(property.layout), initial, parent, storage, saveDelayMs: 0, shareCode: opts.shareCode, ceilingM: property.layout.wallHeightM });
  return { property, storage, parent, scene, store, initial };
}

/** a real-ish context around a store, with the fittings api and a registry */
function sessionRig() {
  const t = rig();
  const registry = createFittingRegistry();
  const fittings = createFittingsApi({ registry, store: t.store, layout: t.property.layout });
  const toasts: string[] = [];
  const views: import('../src/buyer/furnish').FurnishView[] = [];
  const ctx = {
    viewer: { scene: t.scene, camera: new THREE.PerspectiveCamera() }, property: t.property, character: { position: { x: 2, z: 2.5 }, yawDeg: 0, heightM: 1.75 },
    overlays: { outlineBox: () => ({ remove() {} }), line: () => ({ remove() {} }), clear: () => {} }, furniture: t.store, fittings,
    grid: () => t.store.grid(), gridWithout: (ids: string[]) => t.store.gridWithout(ids), heightM: () => 1.75, hud: { toast: (m: string) => { toasts.push(m); } },
  } as unknown as BuyerContext;
  const session = createFurnishSession(ctx, { render: (v) => views.push(v) });
  return { ...t, registry, fittings, session, ctx, toasts, views };
}

const stubViewer = (): { scene: THREE.Scene; onFrame: (cb: (dt: number) => void) => () => void } => ({ scene: new THREE.Scene(), onFrame: () => () => {} });
const lookWith = (l: Layout) => {
  const mats = createLookMaterials({ wallHeightM: l.wallHeightM });
  return { materials: () => mats, trueColours: false, onChange: () => () => {} } as unknown as import('../src/look/look').Look;
};

// ---------------------------------------------------------------- the overlay value

describe('fittings overlay: value, storage and link', () => {
  const sample: FittingsOverlay = {
    removed: ['fan:bed-room', 'li:plant-19'],
    moved: { 'ac:son-room:0': { m: 'w', edge: 3, u: 1.25, y: 2.1 }, 'fan:living': { m: 'c', x: 2.5, z: 2 }, 'rug:a:0': { m: 'f', x: 1.5, z: 2.25, yawDeg: 90 } },
    sized: { 'ac:son-room:0': [1.2], 'rug:a:0': [2.1, 1.5] },
  };

  it('round trips through the wire form in centimetres, and the wire is compact', () => {
    const w = fittingsToWire(sample)!;
    expect(JSON.stringify(w).length).toBeLessThan(400);
    expect(fittingsFromWire(JSON.parse(JSON.stringify(w)))).toEqual(sample);
    expect(fittingsToWire(emptyFittings())).toBeUndefined();
  });

  it('sanitises rubbish: wrong shapes, absurd numbers, strange ids and too many rows are dropped, never thrown', () => {
    const bad = sanitizeFittings({ removed: ['ok:1', 5, 'bad id with spaces', '<script>'], moved: { 'a': { m: 'w', edge: 1.5, u: 1, y: 1 }, 'b': { m: 'c', x: 1e9, z: 0 }, 'c': { m: 'x' }, 'd': { m: 'c', x: 1, z: 2 } }, sized: { 'e': [0, 1], 'f': [1, 2, 3, 4], 'g': [1.5] } });
    expect(bad.removed).toEqual(['ok:1']);
    expect(Object.keys(bad.moved)).toEqual(['d']);
    expect(Object.keys(bad.sized)).toEqual(['g']);
    expect(sanitizeFittings(null)).toEqual(emptyFittings());
    expect(sanitizeFittings('x')).toEqual(emptyFittings());
  });

  it('edits are pure: remove, undo, move, size and clear return a new overlay and never change the old one', () => {
    const base = emptyFittings();
    const a = fittingsRemove(base, 'x');
    expect(base.removed).toEqual([]);
    expect(a.removed).toEqual(['x']);
    const b = fittingsMove(a, 'x', { m: 'c', x: 1, z: 2 });
    expect(b.removed).toEqual([]); // moving a removed fitting brings it back
    expect(fittingsRestore(a, 'x').removed).toEqual([]);
    expect(isEmptyFittings(fittingsClear(fittingsSize(b, 'x', [1]), 'x'))).toBe(true);
  });

  it('a layout with fittings or moved originals travels as a version 2 link; one with neither is still version 1; a version 1 link still opens', () => {
    const t = rig();
    t.store.hideOriginal('sofa-1');
    expect(encodeLayout(t.store.layout())!.startsWith('1.')).toBe(true);
    const old = encodeLayout(t.store.layout())!;
    t.store.editOriginal('bed-1', { w: 1.6 });
    t.store.setFittings(fittingsRemove(fittingsMove(emptyFittings(), 'fan:r', { m: 'c', x: 2, z: 2 }), 'ac:r:0'));
    const code = encodeLayout(t.store.layout())!;
    expect(code.startsWith('2.')).toBe(true);
    expect(code.length).toBeLessThan(500);
    const originals = new Map(t.initial.map((i) => [i.id, i]));
    const back = decodeLayout(code, originals)!;
    expect(back.removed).toEqual(['sofa-1']);
    expect(back.moved['bed-1'].w).toBeCloseTo(1.6, 2);
    expect(back.fittings.removed).toEqual(['ac:r:0']);
    expect(back.fittings.moved['fan:r']).toEqual({ m: 'c', x: 2, z: 2 });
    // the old link still decodes to the same removed piece, with nothing moved or fitted
    const o = decodeLayout(old, originals)!;
    expect(o.removed).toEqual(['sofa-1']);
    expect(o.moved).toEqual({});
    expect(isEmptyFittings(o.fittings)).toBe(true);
    // opening the new link on a fresh device gives the same layout
    const other = rig({ shareCode: code });
    expect(other.store.fromLink()).toBe(true);
    expect(other.store.get('bed-1')!.box.w).toBeCloseTo(1.6, 2);
    expect(other.store.fittings().removed).toEqual(['ac:r:0']);
    expect(other.store.has('sofa-1')).toBe(false);
  });

  it('a link cannot make a 20 m bed or move a piece that is not in this home', () => {
    const originals = new Map(buildTruthProperty('furnished').furniture.map((i) => [i.id, i]));
    const wire = (o: unknown): string => '2.' + btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const l = decodeLayout(wire({ p: [['bed-1', 100, 100, 0, 2000, 150, 90, 50], ['ghost', 0, 0, 0, 100, 100, 100, 50], ['sofa-1', 1e12, 0, 0, 100, 100, 100, 50]] }), originals);
    expect(l).toBeNull(); // 20 m is rejected outright, a ghost id and a position at infinity too: nothing is left of the link
    const t = rig();
    t.store.editOriginal('bed-1', { w: 99, d: 99 });
    const bed = t.store.get('bed-1')!;
    const lim = Object.fromEntries(sizeLimits(bed).map((x) => [x.key, x]));
    expect(bed.box.w).toBeLessThanOrEqual(lim.w.max + 1e-9);
    expect(bed.box.d).toBeLessThanOrEqual(lim.d.max + 1e-9);
  });

  it('storage: version 2 holds moved and fittings, version 1 still parses, and an overlay that changes nothing stores nothing', () => {
    const originals = new Map(buildTruthProperty('furnished').furniture.map((i) => [i.id, i]));
    expect(serializeMine([], {}, {}, emptyFittings())).toBeNull();
    const raw = serializeMine([], {}, {}, fittingsRemove(emptyFittings(), 'fan:x'))!;
    expect(JSON.parse(raw).version).toBe(2);
    expect(parseMine(raw, originals).fittings.removed).toEqual(['fan:x']);
    expect(parseMine('{"version":1,"removed":["bed-1"],"finishes":{}}', originals).removed).toEqual(['bed-1']);
    expect(shareUrl('http://x.test/?scene=a', { ...emptyLayout(), fittings: fittingsRemove(emptyFittings(), 'a:1') })).toContain(`${SHARE_PARAM}=2.`);
  });
});

// ---------------------------------------------------------------- pieces that came with the home: move and resize

describe('furniture that came with the home can be moved and resized in My layout', () => {
  it('resize puts the edit on the drawn piece: the property is never mutated, the grid, the mesh and the card follow', () => {
    const t = rig();
    const before = JSON.stringify(t.initial);
    const drawn = t.store.drawnItem('bed-1')!;
    const gridBefore = Uint8Array.from(t.store.grid().cells);
    expect(t.store.editOriginal('bed-1', { w: 1.8, d: 1.8, surfaceHeightM: 0.6 })).toBe(true);
    const bed = t.store.get('bed-1')!;
    expect(bed.box.w).toBe(1.8);
    expect(bed.box.d).toBe(1.8);
    expect(bed.surfaceHeightM).toBe(0.6);
    expect(Array.from(t.store.grid().cells)).not.toEqual(Array.from(gridBefore));
    expect(JSON.stringify(t.initial)).toBe(before);
    expect(JSON.stringify(t.store.drawnItem('bed-1'))).toBe(JSON.stringify(drawn));
    // the mesh was rebuilt at the new size
    const mesh = t.store.mesh('bed-1')!;
    const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.z)).toBeGreaterThan(1.75);
    // the card says so plainly
    expect(editNote(drawn, bed)).toContain('Your size: 180 × 180 cm');
    expect(editNote(drawn, bed)).toContain('On the drawing: 150 × 200 cm');
    expect(checkFor(bed, 1.75).title).toBeTruthy();
  });

  it('a move says "Moved in your layout"; growing toward the front is not a move; going back to the drawn piece drops the edit', () => {
    const t = rig();
    const drawn = t.store.drawnItem('bed-1')!;
    t.store.editOriginal('bed-1', resizePatch(t.store.get('bed-1')!, drawn, 'd', 1.65));
    expect(t.store.get('bed-1')!.box.d).toBe(1.65);
    expect(editNote(drawn, t.store.get('bed-1')!)).not.toContain(MOVED_NOTE);
    expect(editNote(drawn, t.store.get('bed-1')!)).toContain('Your size');
    t.store.editOriginal('bed-1', { cx: drawn.box.cx + 0.5 });
    expect(editNote(drawn, t.store.get('bed-1')!)).toContain(MOVED_NOTE);
    expect(t.store.isOriginalEdited('bed-1')).toBe(true);
    t.store.restoreDrawn('bed-1');
    expect(t.store.isOriginalEdited('bed-1')).toBe(false);
    expect(t.store.get('bed-1')!.box).toEqual(drawn.box);
    expect(t.store.isEdited()).toBe(false);
  });

  it('the verdict, the pose and the sleeping area follow the moved and resized bed', () => {
    const t = rig();
    const drawn = t.store.drawnItem('bed-1')!;
    const longBefore = checkFor(drawn, 1.9);
    t.store.editOriginal('bed-1', { d: 1.6, w: 1.2, cx: drawn.box.cx, cz: drawn.box.cz });
    const bed = t.store.get('bed-1')!;
    const card = checkFor(bed, 1.9);
    expect(card.headline).not.toBe(longBefore.headline);
    expect(card.headline.toLowerCase()).toContain('short');
    const approach = { x: bed.box.cx, z: bed.box.cz + 2 };
    expect(JSON.stringify(liePose(bed, 1.75, approach))).not.toBe(JSON.stringify(liePose(drawn, 1.75, approach)));
  });

  it('Reset is byte-identical to the home as drawn, and it clears the fittings too', () => {
    const t = rig();
    const pristine = JSON.stringify(t.store.pristine());
    const ids = t.store.all().map((i) => i.id);
    t.store.editOriginal('bed-1', { w: 1.9, cx: 3 });
    t.store.editOriginal('sofa-1', { yawDeg: 45 });
    t.store.setFittings(fittingsRemove(emptyFittings(), 'ac:x:0'));
    expect(t.store.isEdited()).toBe(true);
    t.store.reset();
    expect(JSON.stringify(t.store.all())).toBe(JSON.stringify(JSON.parse(pristine)));
    expect(t.store.all().map((i) => i.id)).toEqual(ids);
    expect(t.store.isEdited()).toBe(false);
    expect(isEmptyFittings(t.store.fittings())).toBe(true);
    expect(t.storage.data.has(mineKey('ea'))).toBe(false);
  });

  it('edits are saved and come back on a reload; hiding a moved piece and undoing brings the drawn piece back', () => {
    const t = rig();
    t.store.editOriginal('bed-1', { w: 1.7 });
    const again = rig({ storage: t.storage });
    expect(again.store.get('bed-1')!.box.w).toBeCloseTo(1.7, 3);
    t.store.hideOriginal('bed-1');
    t.store.restoreOriginal('bed-1');
    expect(t.store.get('bed-1')!.box.w).toBe(t.store.drawnItem('bed-1')!.box.w);
  });

  it('a piece moved onto another blocks the grid where it now stands and frees where it was', () => {
    const t = rig();
    const drawn = t.store.drawnItem('bed-1')!;
    const cell = (x: number, z: number): number => { const g = t.store.grid(); return g.cells[Math.floor((z - g.originZ) / g.cellM) * g.nx + Math.floor((x - g.originX) / g.cellM)]; };
    expect(cell(drawn.box.cx, drawn.box.cz)).not.toBe(0);
    t.store.editOriginal('bed-1', { cx: drawn.box.cx + 1.5 });
    expect(cell(drawn.box.cx + 1.5, drawn.box.cz)).not.toBe(0);
    expect(cell(drawn.box.cx - 0.5, drawn.box.cz)).toBe(0);
  });

  it('the furnish session: Resize steppers keep the back edge, the card note is plain, Back to drawn size works, and Reset clears all', () => {
    const t = sessionRig();
    t.session.select('bed-1');
    const drawn = t.store.drawnItem('bed-1')!;
    expect(t.session.view().selection!.edit).toBeNull();
    expect(t.session.stepSelected('d', -1)).toBe(true);
    const v = t.session.view();
    expect(v.selection!.edit).toContain('Your size');
    expect(v.selection!.edit).not.toContain(MOVED_NOTE);
    const bed = t.store.get('bed-1')!;
    const a = { x: Math.sin((bed.box.yawDeg * Math.PI) / 180), z: Math.cos((bed.box.yawDeg * Math.PI) / 180) };
    const back = { x: bed.box.cx - a.x * bed.box.d / 2, z: bed.box.cz - a.z * bed.box.d / 2 };
    const dA = { x: Math.sin((drawn.box.yawDeg * Math.PI) / 180), z: Math.cos((drawn.box.yawDeg * Math.PI) / 180) };
    expect(back.x).toBeCloseTo(drawn.box.cx - dA.x * drawn.box.d / 2, 3);
    expect(back.z).toBeCloseTo(drawn.box.cz - dA.z * drawn.box.d / 2, 3);
    expect(v.selection!.canBackSize).toBe(true);
    expect(t.session.backToDrawn('size')).toBe(true);
    expect(t.store.get('bed-1')!.box).toEqual(drawn.box);
    t.session.stepSelected('w', 1);
    t.session.resetLayout();
    expect(t.store.isEdited()).toBe(false);
  });

  it('Move on a home piece is the same ghost, verdict and Place as a placed piece, and the home piece is edited, not replaced', () => {
    const t = sessionRig();
    t.session.select('sofa-1');
    expect(t.session.beginMove()).toBe(true);
    expect(t.session.view().phase).toBe('edit');
    const w = t.session.working()!;
    t.session.moveTo(w.box.cx, w.box.cz - 0.4);
    expect(t.session.verdict()!.canPlace).toBe(true);
    expect(t.session.place()).toBe('sofa-1');
    expect(t.store.get('sofa-1')!.box.cz).toBeCloseTo(w.box.cz - 0.4, 6);
    expect(t.store.get('sofa-1')!.source).toBe('real');
    expect(t.store.buyerIds()).toEqual([]);
    expect(t.store.drawnItem('sofa-1')!.box.cz).toBeCloseTo(w.box.cz, 6);
  });

  it('applyEdit enforces the family limits but never corrects a size the drawing already has', () => {
    const wardrobe = livedInFurniture.find((i) => i.kind === 'wardrobe')!;
    const huge = applyEdit(wardrobe, { ...editOf(wardrobe), heightM: 9, w: 40 }, 2.6);
    expect(huge.heightM).toBeLessThanOrEqual(2.55);
    expect(huge.box.w).toBeLessThanOrEqual(4.2);
    const thin: FurnitureItem = { ...wardrobe, box: { ...wardrobe.box, w: 0.12 } };
    expect(applyEdit(thin, editOf(thin)).box.w).toBe(0.12);
    expect(isNoEdit(thin, editOf(thin))).toBe(true);
  });
});

// ---------------------------------------------------------------- the rules by mount

describe('movement rules: wall, ceiling, floor', () => {
  const l = livedInLayout;
  const infos = wallInfosOf(l);
  const living = l.rooms.find((r) => r.id === 'living')!;

  it('a wall fitting slides along its wall and never overlaps a door, an opening or a window it must not cross, nor a corner', () => {
    const shape = { w: 0.9, yRange: (y: number) => [y - 0.15, y + 0.15] as [number, number], yMin: 1.7, yMax: 2.5 };
    for (const f of computeEdgeFrames(l).filter((x) => x.roomId === 'living' && x.kind === 'wall')) {
      const info = infos.find((w) => w.room.id === 'living' && w.frame.edge === f.edge)!;
      for (let u = 0; u <= f.length; u += 0.1) {
        const t = resolveWallMove(infos, 'living', { edge: f.edge, u, y: 2.1 }, shape);
        if (!t) continue;
        expect(t.u - 0.45).toBeGreaterThanOrEqual(0.08 - 1e-9);
        expect(t.u + 0.45).toBeLessThanOrEqual(f.length - 0.08 + 1e-9);
        for (const s of info.spans) {
          // the AC (y 1.95..2.25) is above a door's head only when it clears it: otherwise no overlap in u
          if (s.type !== 'window' && 1.95 >= s.headM) continue;
          expect(t.u + 0.45 <= s.u0 + 1e-6 || t.u - 0.45 >= s.u1 - 1e-6, `edge ${f.edge} u ${t.u} vs ${s.type} ${s.u0}-${s.u1}`).toBe(true);
        }
      }
    }
  });

  it('the height stays in the kind range, and a curtain (hung over a window) is not blocked by it but is by a door', () => {
    const t = resolveWallMove(infos, 'living', { edge: 0, u: 1, y: 9 }, { w: 0.5, yRange: (y) => [y - 0.1, y + 0.1], yMin: 1.0, yMax: 2.0 })!;
    expect(t.y).toBe(2.0);
    const winEdge = l.openings.find((o) => o.type === 'window' && o.roomId === 'living')!;
    const frame = infos.find((w) => w.room.id === 'living' && w.frame.edge === winEdge.edge)!;
    const curtain = { w: 0.9, yRange: () => [0.02, 2.55] as [number, number], yMin: 1.3, yMax: 1.3, overWindows: true };
    const runs = allowedCentres(frame, curtain, 1.3);
    // a curtain can be centred on the window itself
    expect(runs.some(([a, b]) => winEdge.centreM >= a && winEdge.centreM <= b)).toBe(true);
    // a tube light at the same place is kept off the window
    const tube = { w: 0.9, yRange: (y: number): [number, number] => [y - 0.03, y + 0.03], yMin: 1.0, yMax: 2.5 };
    expect(allowedCentres(frame, tube, 1.5).some(([a, b]) => winEdge.centreM >= a && winEdge.centreM <= b)).toBe(false);
    // ... and a door or an opening of that wall is never covered, curtain or not
    const holes = frame.spans.filter((s) => s.type === 'door' || s.type === 'opening');
    expect(holes.length).toBeGreaterThan(0);
    for (const [a, b] of runs) for (const d of holes) {
      for (const c of [a, b]) expect(c + 0.45 <= d.u0 + 1e-6 || c - 0.45 >= d.u1 - 1e-6).toBe(true);
    }
  });

  it('a wall with no room for the fitting gives null (never a spot outside the room)', () => {
    expect(resolveWallMove(infos, 'living', { edge: 0, u: 1, y: 2 }, { w: 30, yRange: () => [1, 2], yMin: 1, yMax: 2 })).toBeNull();
    expect(resolveWallMove(infos, 'living', { edge: 99, u: 1, y: 2 }, { w: 0.3, yRange: () => [1, 2], yMin: 1, yMax: 2 })).toBeNull();
    expect(resolveWallMove(infos, 'nowhere', { edge: 0, u: 1, y: 2 }, { w: 0.3, yRange: () => [1, 2], yMin: 1, yMax: 2 })).toBeNull();
  });

  it('a ceiling fitting stays inside its room, away from the walls', () => {
    const c = { x: 2.2, z: 1.8 };
    const out = resolveCeilingMove(living, { x: 99, z: -99 }, 0.9, c)!;
    expect(out.x).toBeLessThanOrEqual(4.4 - 0.9 + 1e-6);
    expect(out.z).toBeGreaterThanOrEqual(0.9 - 1e-6);
    expect(resolveCeilingMove(living, { x: 2, z: 1.5 }, 0.9, c)).toEqual({ x: 2, z: 1.5 });
  });

  it('a floor fitting stays in its room, on free floor, off the doorways; a rug is allowed under furniture', () => {
    const grid = rasterizeLayout(l);
    const doors = l.openings.filter((o) => o.type === 'door').map((o) => {
      const f = computeEdgeFrames(l).find((x) => x.roomId === o.roomId && x.edge === o.edge)!;
      return { at: { x: f.a.x + f.dir.x * o.centreM, z: f.a.z + f.dir.z * o.centreM }, widthM: o.widthM, frame: f };
    });
    const ok = checkFloorSpot({ cx: 2.2, cz: 1.8, w: 0.4, d: 0.4, yawDeg: 0 }, living, grid, doors, { needFree: true, doorKeepM: 0.5 });
    expect(ok.ok).toBe(true);
    expect(checkFloorSpot({ cx: 4.3, cz: 1.8, w: 0.6, d: 0.6, yawDeg: 0 }, living, grid, doors, { needFree: true, doorKeepM: 0.5 })).toEqual({ ok: false, reason: 'outside' });
    const entry = doors.find((d) => d.widthM === 0.9)!;
    expect(checkFloorSpot({ cx: entry.at.x, cz: entry.at.z + 0.4, w: 0.4, d: 0.4, yawDeg: 0 }, living, grid, doors, { needFree: false, doorKeepM: 0.5 }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------- hit test

describe('tapping: one hit test, generous for small things', () => {
  const rec = (id: string, x: number, y: number, z: number, hx: number, hy: number, hz: number): FittingRecord => ({
    id, kind: 'switchboard', name: id, mount: 'wall', roomId: 'r', removed: false, moved: false, sized: false, centre: { x, y, z }, half: { x: hx, y: hy, z: hz }, yawDeg: 0,
    size: { w: hx * 2, d: hz * 2, h: hy * 2 }, heightM: 0, provenance: 'typical', movable: false, resize: null, defaultSize: null, currentSize: null,
  });

  it('a ray meets an oriented box, turned boxes included, and misses what it should', () => {
    const box = { cx: 0, cy: 1, cz: 0, hx: 0.5, hy: 0.1, hz: 0.1, yawDeg: 90 };
    // turned a quarter: the long side lies along z
    expect(rayHitsObb({ x: 0, y: 1, z: -5 }, { x: 0, y: 0, z: 1 }, box)).toBeCloseTo(4.5, 6);
    expect(rayHitsObb({ x: -5, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, box)).toBeCloseTo(4.9, 6);
    expect(rayHitsObb({ x: 0.8, y: 1, z: -5 }, { x: 0, y: 0, z: 1 }, box)).toBeNull();
    expect(rayHitsObb({ x: 0, y: 1, z: -5 }, { x: 0, y: 0, z: 1 }, { ...box, cy: 3 })).toBeNull();
  });

  it('the nearest fitting under the ray wins, removed and hidden ones never, a small one gets a larger reach (more on a phone)', () => {
    const near = rec('near', 0, 1, 2, 0.1, 0.1, 0.05), far = rec('far', 0, 1, 4, 0.1, 0.1, 0.05);
    const ray = { origin: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: 1 } };
    expect(pickFitting([far, near], ray.origin, ray.dir)!.id).toBe('near');
    expect(pickFitting([{ ...near, removed: true }, far], ray.origin, ray.dir)!.id).toBe('far');
    expect(pickFitting([{ ...near, hidden: true }, far], ray.origin, ray.dir)!.id).toBe('far');
    // a switchboard 12 cm wide: a ray 12 cm off misses without slack and hits with a phone's
    const off = { origin: { x: 0.2, y: 1, z: 0 }, dir: { x: 0, y: 0, z: 1 } };
    expect(pickFitting([near], off.origin, off.dir, 0)).toBeNull();
    expect(pickFitting([near], off.origin, off.dir, (r) => hitSlack(r, true))!.id).toBe('near');
    expect(hitSlack(near, true)).toBeGreaterThan(hitSlack(near, false));
    // a big thing needs no extra reach
    expect(hitSlack(rec('big', 0, 1, 1, 1, 1, 1), true)).toBeLessThan(hitSlack(near, true));
  });
});

// ---------------------------------------------------------------- the planners honour the overlay

describe('the planners apply the overlay deterministically', () => {
  const l = livedInLayout;

  it('kit: a fan moved across the ceiling, a tube resized and a board removed; the same overlay always gives the same plan', () => {
    const none = kitFittings(l, livedInFurniture, livedInFurniture, null);
    const fan = none.drawn.fans[0];
    const tube = none.drawn.tubes[0];
    const board = none.drawn.boards[0];
    const ov: FittingsOverlay = {
      removed: [board.id],
      moved: { [fan.id]: { m: 'c', x: fan.x - 0.4, z: fan.z + 0.2 } },
      sized: { [tube.id]: [0.6] },
    };
    const a = kitFittings(l, livedInFurniture, livedInFurniture, ov);
    const b = kitFittings(l, livedInFurniture, livedInFurniture, ov);
    expect(JSON.stringify(a.live)).toBe(JSON.stringify(b.live));
    expect(JSON.stringify(a.records.map((r) => [r.id, r.centre, r.size]))).toBe(JSON.stringify(b.records.map((r) => [r.id, r.centre, r.size])));
    expect(a.live.fans.find((f) => f.id === fan.id)!.x).toBeCloseTo(fan.x - 0.4, 6);
    expect(a.live.tubes.find((x) => x.id === tube.id)!.lengthM).toBe(0.6);
    expect(a.live.boards.some((x) => x.id === board.id)).toBe(false);
    expect(a.records.find((r) => r.id === board.id)!.removed).toBe(true);
    expect(a.editedStatic.has(fan.id) && a.editedStatic.has(tube.id) && a.editedStatic.has(board.id)).toBe(true);
    // the drawn plan underneath is unchanged
    expect(JSON.stringify(a.drawn)).toBe(JSON.stringify(none.drawn));
    // no overlay: nothing is edited
    expect(none.editedStatic.size).toBe(0);
    expect(none.dynamic.fans.length + none.dynamic.tubes.length + none.dynamic.boards.length).toBe(0);
  });

  it('kit: a bed-head board follows the bed the viewer moved', () => {
    const bed = livedInFurniture.find((i) => i.kind === 'bed')!;
    const before = kitFittings(l, livedInFurniture, livedInFurniture, null).live.bedheads;
    const moved = livedInFurniture.map((i) => (i.id === bed.id ? { ...i, box: { ...i.box, cz: i.box.cz - 0.3 } } : i));
    const after = kitFittings(l, livedInFurniture, moved, null).live.bedheads;
    expect(before.length).toBeGreaterThan(0);
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
  });

  it('kit mount: the drawn static meshes are built from the home as drawn, edited fixtures leave them in place and are lit by probes', () => {
    const shell = new THREE.Group();
    const v = stubViewer();
    const registry = createFittingRegistry();
    let overlay = emptyFittings();
    const listeners = new Set<() => void>();
    const store = { all: () => livedInFurniture, pristine: () => livedInFurniture, fittings: () => overlay, onChange: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; } };
    const kit = mountKit({ viewer: v, layout: l, shell, look: lookWith(l), store, registry });
    const staticMesh = kit.group.children.find((c) => c.name === 'kit:fixtures') as THREE.Mesh;
    const before = Float32Array.from((staticMesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array);
    const fan = registry.all().find((r) => r.kind === 'fan')!;
    const tube = registry.all().find((r) => r.kind === 'tube')!;
    expect(registry.all().some((r) => r.kind === 'switchboard')).toBe(true);
    overlay = fittingsRemove(fittingsMove(emptyFittings(), fan.id, { m: 'c', x: fan.centre.x - 0.5, z: fan.centre.z }), tube.id);
    return new Promise<void>((resolve) => {
      for (const cb of listeners) cb();
      setTimeout(() => {
        const after = (staticMesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
        expect(Array.from(after)).not.toEqual(Array.from(before)); // the edited fixtures left the static mesh
        expect(after.length).toBe(before.length);
        // the bake still knows the mesh by its drawn checksum
        expect(staticMesh.geometry.userData[PRISTINE_CHECKSUM_KEY]).toBeTruthy();
        const edited = kit.group.getObjectByName('kit:edited');
        expect(edited).toBeTruthy();
        const movedFan = registry.all().find((r) => r.id === fan.id)!;
        expect(movedFan.moved).toBe(true);
        expect(movedFan.centre.x).toBeCloseTo(fan.centre.x - 0.5, 6);
        expect(registry.all().find((r) => r.id === tube.id)!.removed).toBe(true);
        // putting it all back leaves the static mesh exactly as built
        overlay = emptyFittings();
        for (const cb of listeners) cb();
        setTimeout(() => {
          expect(Array.from((staticMesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array)).toEqual(Array.from(before));
          expect(kit.group.getObjectByName('kit:edited')).toBeUndefined();
          kit.dispose();
          resolve();
        }, 300);
      }, 300);
    });
  });

  it('design decor: AC moved to another wall and sized, curtains narrowed, rug sized, a downlight and a wall light removed', () => {
    const prop = buildTruthProperty('furnished');
    const layout = prop.layout;
    const st = { ...getStyle(), pack: PACKS.find((p) => !p.classic)! };
    const fixtures = activeFixtures(layout, prop.furniture, st);
    expect(fixtures.length).toBeGreaterThan(0);
    const base = buildDesign(layout, prop.furniture, 'medium', st);
    const ids = base.records.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    // ids are stable: the same home and style give the same ids
    expect(buildDesign(layout, prop.furniture, 'medium', st).records.map((r) => r.id)).toEqual(ids);
    const rug = base.records.find((r) => r.kind === 'rug');
    const curtain = base.records.find((r) => r.kind === 'curtain');
    if (rug) {
      const ov = buildDesign(layout, prop.furniture, 'medium', st, undefined, { overlay: fittingsSize(fittingsMove(emptyFittings(), rug.id, { m: 'f', x: rug.centre.x + 0.2, z: rug.centre.z }), rug.id, [1.5, 1.2]) });
      const r2 = ov.records.find((r) => r.id === rug.id)!;
      expect(r2.size.w).toBeCloseTo(1.5, 6);
      expect(r2.size.d).toBeCloseTo(1.2, 6);
      expect(r2.centre.x).toBeCloseTo(rug.centre.x + 0.2, 6);
      expect(r2.moved && r2.sized).toBe(true);
    }
    if (curtain) {
      const ov = buildDesign(layout, prop.furniture, 'medium', st, undefined, { overlay: fittingsSize(emptyFittings(), curtain.id, [curtain.size.w - 0.4]) });
      expect(ov.records.find((r) => r.id === curtain.id)!.size.w).toBeCloseTo(curtain.size.w - 0.4, 6);
    }
    // removing a rug or a curtain takes its mesh out and keeps its record (with removed set) for the tray's Undo
    const victim = base.records[0];
    const gone = buildDesign(layout, prop.furniture, 'medium', st, undefined, { overlay: fittingsRemove(emptyFittings(), victim.id) });
    expect(gone.records.find((r) => r.id === victim.id)!.removed).toBe(true);
    expect(Object.values(gone.counts).reduce((a, b) => a + b, 0)).toBeLessThan(Object.values(base.counts).reduce((a, b) => a + b, 0) + 1);
  });

  it('design decor: nothing it builds can be hit by a ray, and nothing about it is in the collision grid', () => {
    const prop = buildTruthProperty('furnished');
    const st = { ...getStyle(), pack: PACKS.find((p) => !p.classic)! };
    const built = buildDesign(prop.layout, prop.furniture, 'medium', st);
    const rc = new THREE.Raycaster(new THREE.Vector3(2.5, 1.2, 2), new THREE.Vector3(0, 1, 0));
    expect(rc.intersectObject(built.group, true)).toEqual([]);
    built.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) expect(new THREE.Raycaster(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, -1, 0)).intersectObject(o, false)).toEqual([]); });
  });

  it('lived-in: a plant moves on free floor, a clock is moved and resized on its wall, cushions follow a moved sofa, a removed piece keeps its record', () => {
    const grid = rasterizeLayout(l);
    const planned = planLivedIn({ layout: l, items: livedInFurniture, grid });
    const base = livedInFittings(l, planned, null, livedInFurniture, livedInFurniture);
    expect(base.records.length).toBe(planned.length);
    expect(new Set(base.records.map((r) => r.id)).size).toBe(planned.length);
    const plant = base.records.find((r) => r.kind === 'plant');
    const clock = base.records.find((r) => r.kind === 'clock');
    const cushion = base.records.find((r) => r.kind === 'cushion');
    expect(plant && cushion).toBeTruthy();
    const ov: FittingsOverlay = { removed: [], moved: {}, sized: {} };
    if (plant) ov.moved[plant.id] = { m: 'f', x: plant.centre.x + 0.3, z: plant.centre.z, yawDeg: 0 };
    if (clock) { ov.sized[clock.id] = [0.45]; }
    const sofa = livedInFurniture.find((i) => i.kind === 'sofa')!;
    const moved = livedInFurniture.map((i) => (i.id === sofa.id ? { ...i, box: { ...i.box, cx: i.box.cx + 0.6 } } : i));
    const edited = livedInFittings(l, planned, ov, moved, livedInFurniture);
    expect(edited.records.find((r) => r.id === plant!.id)!.centre.x).toBeCloseTo(plant!.centre.x + 0.3, 6);
    if (clock) expect(edited.records.find((r) => r.id === clock.id)!.size.w).toBeCloseTo(0.45, 6);
    const sofaCushion = base.records.find((r) => r.kind === 'cushion' && r.hostLabel?.toLowerCase().includes('sofa'))!;
    const bc2 = edited.records.find((r) => r.id === sofaCushion.id)!;
    expect(bc2.centre.x).toBeCloseTo(sofaCushion.centre.x + 0.6, 6);
    const rem = livedInFittings(l, planned, { removed: [cushion!.id], moved: {}, sized: {} }, livedInFurniture, livedInFurniture);
    expect(rem.records.find((r) => r.id === cushion!.id)!.removed).toBe(true);
    expect(rem.pieces.length).toBe(planned.length - 1);
    // deterministic
    expect(JSON.stringify(livedInFittings(l, planned, ov, moved, livedInFurniture).records)).toBe(JSON.stringify(edited.records));
  });

  it('lived-in mount: the group follows the overlay and the registry, and decor never enters the walking grid', () => {
    const parent = new THREE.Group();
    const registry = createFittingRegistry();
    const grid = rasterizeLayout(l);
    let overlay = emptyFittings();
    const listeners = new Set<() => void>();
    const store = {
      all: () => livedInFurniture, gridWithout: () => grid, pristine: () => livedInFurniture, drawnGrid: () => grid, fittings: () => overlay,
      onChange: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    };
    const lived = createLivedIn({ parent, layout: l, store, storage: null, defaultOn: true, registry });
    const cells = Uint8Array.from(grid.cells);
    const plant = registry.all().find((r) => r.kind === 'plant')!;
    const meshesBefore = lived.group()!.children.length;
    overlay = fittingsRemove(emptyFittings(), plant.id);
    for (const cb of listeners) cb();
    expect(lived.group()!.children.length).toBe(meshesBefore - 1);
    expect(registry.all().find((r) => r.id === plant.id)!.removed).toBe(true);
    overlay = fittingsMove(emptyFittings(), plant.id, { m: 'f', x: plant.centre.x + 0.25, z: plant.centre.z, yawDeg: 0 });
    for (const cb of listeners) cb();
    expect(registry.all().find((r) => r.id === plant.id)!.moved).toBe(true);
    expect(Array.from(grid.cells)).toEqual(Array.from(cells));
    lived.dispose();
  });
});

// ---------------------------------------------------------------- the drawing's chairs

describe("the drawing's chairs are fittings: moved, removed, and they follow the desk", () => {
  const desk: FurnitureItem = { id: 'desk', source: 'real', kind: 'counter', label: 'Study', box: { cx: 2, cz: 1, w: 1.2, d: 0.6, yawDeg: 0 }, heightM: 0.75, surfaceHeightM: 0.75 };
  const designs = { version: 1 as const, source: 't', items: {}, decor: [{ id: 'chair-a', look: 'chair' as const, tiedTo: 'desk', offset: { x: 0, z: 0.35 }, faceItem: true }] };

  it('follows its desk, goes where the viewer put it, is gone when removed or when the desk is hidden', () => {
    const seats = buildSeats(designs, [desk]);
    seats.syncHosts([desk]);
    const home = seats.poseOf('chair-a')!;
    seats.syncHosts([{ ...desk, box: { ...desk.box, cx: desk.box.cx + 1 } }]);
    expect(seats.poseOf('chair-a')!.x).toBeCloseTo(home.x + 1, 6);
    seats.setOverlay({ removed: [], moved: { 'chair:chair-a': { m: 'f', x: 3, z: 3, yawDeg: 90 } }, sized: {} });
    expect(seats.poseOf('chair-a')).toEqual({ x: 3, z: 3, yawDeg: 90 });
    expect(seats.records()[0].moved).toBe(true);
    seats.setOverlay({ removed: ['chair:chair-a'], moved: {}, sized: {} });
    expect(seats.liveIds()).toEqual([]);
    expect(seats.obstacles()).toEqual([]);
    expect(seats.records()[0].removed).toBe(true);
    seats.setOverlay(null);
    expect(seats.liveIds().length).toBe(1);
    seats.syncHosts([]);
    expect(seats.liveIds()).toEqual([]);
    expect(seats.records()).toEqual([]);
  });

  it('syncHosted puts the decor chair, the walking grid and the registry in step with the overlay', () => {
    const t = rig();
    const seats = buildSeats(designs, [desk]);
    const group = new THREE.Group();
    const decor = [{ id: 'chair-a', hostId: 'desk', group, place: (p: { x: number; z: number; yawDeg: number }) => group.position.set(p.x, 0, p.z) }];
    const temp: unknown[][] = [];
    const store = {
      all: () => [desk], onChange: t.store.onChange, fittings: () => ({ removed: [] as string[], moved: { 'chair:chair-a': { m: 'f' as const, x: 4, z: 4 } }, sized: {} }),
      setTemporary: (_k: string, o: unknown[]) => { temp.push(o); },
    };
    let records: FittingRecord[] = [];
    seats.syncHosts([desk]);
    syncHosted(store, decor, seats, (r) => { records = r; });
    expect(group.position.x).toBe(4);
    expect(records[0].centre.x).toBe(4);
    expect(temp.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- tapping and the api

describe('the fittings api and the buyer context', () => {
  it('a tap picks a fitting in front of its wall and furniture in front of a fitting; the measure ray never sees a fitting', () => {
    const t = rig();
    const registry = createFittingRegistry();
    const fittings = createFittingsApi({ registry, store: t.store, layout: t.property.layout });
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 50);
    camera.position.set(2.5, 1.5, 0.5);
    camera.lookAt(2.5, 1.5, 4);
    camera.updateMatrixWorld(true);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(10, 5), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    wall.position.set(2.5, 1.5, 4);
    const shell = new THREE.Group();
    shell.add(wall);
    wall.updateMatrixWorld(true);
    const furnitureRoot = new THREE.Group();
    const ctx = createBuyerContext({
      viewer: { camera } as never, property: t.property, character: { heightM: 1.75 } as never, input: {} as never, camera: {} as never, hud: {} as never, overlays: {} as never,
      furniture: t.store as never, shell, furnitureRoot, modes: {} as never, fittings,
    });
    const record = (id: string, z: number): FittingRecord => ({
      id, kind: 'ac', name: 'Split AC', mount: 'wall', roomId: 'r', removed: false, moved: false, sized: false, centre: { x: 2.5, y: 1.5, z }, half: { x: 0.45, y: 0.15, z: 0.1 }, yawDeg: 0,
      size: { w: 0.9, d: 0.2, h: 0.3 }, heightM: 1.35, provenance: 'typical', movable: true, resize: null, defaultSize: null, currentSize: null,
    });
    registry.set('test', [record('ac', 3.85)]);
    const e = { type: 'down' as const, ndcX: 0, ndcY: 0, clientX: 0, clientY: 0 };
    expect(ctx.pickAt!(e)).toMatchObject({ kind: 'fitting', id: 'ac' });
    // the plain scene raycast (what the measure tool and placement use) still sees only the wall
    expect(ctx.raycast(e)!.object).toBe(wall);
    // a tap on empty wall clears: a ray that misses the box returns null
    expect(ctx.pickAt!({ ...e, ndcX: 0.9 })).toBeNull();
    // furniture in front of the fitting wins
    const sofa = t.store.get('sofa-1')!;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.3), new THREE.MeshBasicMaterial());
    mesh.position.set(2.5, 1.5, 2);
    mesh.userData.itemId = sofa.id;
    furnitureRoot.add(mesh);
    mesh.updateMatrixWorld(true);
    expect(ctx.pickAt!(e)).toMatchObject({ kind: 'item', id: sofa.id });
  });

  it('the api edits the overlay in the store, targets a wall only where the fitting can stand, and keeps it out of collision', () => {
    const t = rig();
    const registry = createFittingRegistry();
    const fittings = createFittingsApi({ registry, store: t.store, layout: livedInLayout });
    void fittings;
    const gridBefore = Uint8Array.from(t.store.grid().cells);
    const api = createFittingsApi({ registry, store: t.store, layout: t.property.layout });
    registry.set('x', []);
    api.move('fan:x', { m: 'c', x: 1, z: 1 });
    api.remove('ac:x:0');
    api.size('fan:x', [1.2]);
    expect(t.store.fittings().moved['fan:x']).toEqual({ m: 'c', x: 1, z: 1 });
    expect(t.store.fittings().removed).toEqual(['ac:x:0']);
    expect(t.store.isEdited()).toBe(true);
    api.reset('fan:x');
    api.restore('ac:x:0');
    expect(isEmptyFittings(t.store.fittings())).toBe(true);
    // a fitting never enters the walking grid
    expect(Array.from(t.store.grid().cells)).toEqual(Array.from(gridBefore));
  });

  it('a wall target is null off a wall, red when the wall has no room, and lands on the pointed wall of the fitting room', () => {
    const l = livedInLayout;
    const t = rig();
    const registry = createFittingRegistry();
    const api = createFittingsApi({ registry, store: { ...t.store, fittings: () => emptyFittings(), setFittings: () => {} } as never, layout: l });
    const frames = computeEdgeFrames(l).filter((f) => f.roomId === 'living' && f.kind === 'wall');
    const f = frames.sort((a, b) => b.length - a.length)[0];
    const mid = { x: (f.a.x + f.b.x) / 2 - f.out.x * 0.01, y: 2.1, z: (f.a.z + f.b.z) / 2 - f.out.z * 0.01 };
    const rec: FittingRecord = {
      id: 'ac:living:0', kind: 'ac', name: 'Split AC', mount: 'wall', roomId: 'living', removed: false, moved: false, sized: false, centre: { x: 0, y: 2.1, z: 0 }, half: { x: 0.45, y: 0.15, z: 0.1 }, yawDeg: 0,
      size: { w: 0.9, d: 0.2, h: 0.3 }, heightM: 1.95, provenance: 'typical', movable: true, resize: null, defaultSize: null, currentSize: null,
      moveRule: { mount: 'wall', shape: { w: 0.9, yRange: (y) => [y - 0.15, y + 0.15], yMin: 1.8, yMax: 2.45 } },
    };
    const none = api.target(rec, { wallPoint: null, floor: null, ceiling: null, rayDirXZ: null });
    expect(none).toBeNull();
    const dir = { x: -f.out.x, z: -f.out.z };
    const t1 = api.target(rec, { wallPoint: mid, floor: null, ceiling: null, rayDirXZ: dir })!;
    expect(t1.spec.m).toBe('w');
    if (t1.spec.m === 'w') expect(t1.spec.edge).toBe(f.edge);
    expect(t1.ghost.hx).toBeCloseTo(0.45, 6);
    // a wall point far from every wall of the room is no wall
    expect(api.target(rec, { wallPoint: { x: 2.2, y: 2, z: 1.8 }, floor: null, ceiling: null, rayDirXZ: null })).toBeNull();
  });
});

// ---------------------------------------------------------------- the furnish session on fittings

describe('furnish: selecting, moving, sizing and removing a fitting', () => {
  const fanRecord = (over: Partial<FittingRecord> = {}): FittingRecord => ({
    id: 'fan:room', kind: 'fan', name: 'Ceiling fan', mount: 'ceiling', roomId: '', removed: false, moved: false, sized: false, centre: { x: 2.2, y: 2.4, z: 2.3 }, half: { x: 0.6, y: 0.14, z: 0.6 }, yawDeg: 0,
    size: { w: 1.2, d: 1.2, h: 0.265, round: true }, heightM: 2.3, provenance: 'typical', movable: true, moveRule: { mount: 'ceiling', margin: 0.9 },
    resize: { kind: 'classes', label: 'Sweep', options: [{ value: 0.9, label: '900 mm' }, { value: 1.2, label: '1200 mm' }] }, defaultSize: [1.2], currentSize: [1.2], ...over,
  });

  it('a tap card names it, says where it is and that it is typical, moves it with a ghost, sizes it, removes it, and Undo and Reset bring it back', () => {
    const t = sessionRig();
    t.registry.set('t', [fanRecord()]);
    t.session.selectFitting('fan:room');
    let v = t.session.view();
    expect(v.phase).toBe('fitting');
    expect(v.fitting!.name).toBe('Ceiling fan');
    expect(v.fitting!.sizeText).toBe('120 cm across · 27 cm high');
    expect(v.fitting!.label).toBe('Typical fitting, not from your drawing');
    expect(v.fitting!.mountText).toBe('On the ceiling');
    expect(v.fitting!.canMove).toBe(true);
    expect(v.fitting!.resize!.kind).toBe('classes');
    // move: a ghost follows the pointer, Place commits
    expect(t.session.beginFittingMove()).toBe(true);
    expect(t.session.view().fitting!.moving).toBe(true);
    t.session.aimFitting({ wallPoint: null, floor: null, ceiling: { x: 2.4, z: 2.3 }, rayDirXZ: null });
    expect(t.session.placeFitting()).toBe(true);
    expect(t.store.fittings().moved['fan:room']).toEqual({ m: 'c', x: 2.4, z: 2.3 });
    // size
    expect(t.session.sizeFitting([0.9])).toBe(true);
    expect(t.store.fittings().sized['fan:room']).toEqual([0.9]);
    expect(t.store.isEdited()).toBe(true);
    // remove and undo
    expect(t.session.removeFitting()).toBe(true);
    expect(t.store.fittings().removed).toEqual(['fan:room']);
    t.registry.set('t', [fanRecord({ removed: true })]);
    expect(t.session.view().removed.some((r) => r.fitting && r.id === 'fan:room')).toBe(true);
    expect(t.session.restoreFitting('fan:room')).toBe(true);
    expect(t.store.fittings().removed).toEqual([]);
    t.session.resetLayout();
    expect(isEmptyFittings(t.store.fittings())).toBe(true);
    expect(t.session.selectedFitting()).toBeNull();
  });

  it('tapping empty space or a piece of furniture clears the fitting; Move cancelled leaves no edit', () => {
    const t = sessionRig();
    t.registry.set('t', [fanRecord()]);
    t.session.selectFitting('fan:room');
    t.session.beginFittingMove();
    t.session.cancelFittingMove();
    expect(isEmptyFittings(t.store.fittings())).toBe(true);
    t.session.select('bed-1');
    expect(t.session.selectedFitting()).toBeNull();
    expect(t.session.view().phase).toBe('selected');
    t.session.selectFitting('fan:room');
    expect(t.session.selected()).toBeNull();
    t.session.select(null);
    expect(t.session.view().phase).toBe('browse');
  });
});

describe('wardrobe opening, door swings and lived-in decor follow an edited original', () => {
  it('a home wardrobe that is resized is built again at the new width, its shutters follow, and moving it shuts it where it stood', () => {
    const property = buildTruthProperty('furnished');
    const wardrobe: FurnitureItem = { id: 'wardrobe-r', source: 'real', kind: 'wardrobe', catalogId: 'wardrobe-2', label: 'Wardrobe', box: { cx: 2, cz: 0.4, w: 1.2, d: 0.6, yawDeg: 0 }, heightM: 2.1, surfaceHeightM: 2.1 };
    const parent = new THREE.Group();
    const store = createFurnitureStore({ sceneId: 'ea-w', baseGrid: rasterizeLayout(property.layout), initial: [wardrobe], parent, storage: null, saveDelayMs: 0, ceilingM: 2.6 });
    const el = (): unknown => new Proxy(function () {} as unknown as Record<string, unknown>, {
      get: (_t, k) => (k === 'dataset' || k === 'style' ? {} : k === 'classList' ? { toggle() {}, add() {}, remove() {} } : (): unknown => el()),
      set: () => true,
    });
    (globalThis as { document?: unknown }).document = { createElement: () => el() };
    const ctx = { viewer: { scene: new THREE.Scene() }, property, character: { position: { x: 3, z: 3 } }, overlays: { clear() {}, line: () => ({ remove() {} }) }, hud: { mount: () => () => {}, hideCard() {}, showCard() {}, toast() {} }, furniture: store, grid: () => store.grid() } as unknown as BuyerContext;
    const models = new THREE.Group();
    const w = createWardrobes({ ctx, store, designs: null, parent: models });
    const widthOf = (): number => new THREE.Box3().setFromObject(models.children.find((c) => c.userData.openableFor === 'wardrobe-r')!).getSize(new THREE.Vector3()).x;
    const before = widthOf();
    store.editOriginal('wardrobe-r', { w: 1.8 });
    expect(widthOf()).toBeGreaterThan(before + 0.4);
    expect(w.debug.spec('wardrobe-r')!.shutters.every((s) => Math.abs(s.widthM - 0.9) < 1e-6)).toBe(true);
    store.editOriginal('wardrobe-r', { cx: 3 });
    w.update(0.05); // the model follows the box each frame
    expect(w.debug.model('wardrobe-r')!.group.position.x).toBeCloseTo(3, 3);
    w.dispose();
    delete (globalThis as { document?: unknown }).document;
  });

  it('the fit verdict of a moved original carries the door-swing sentence, and a piece as drawn does not claim a verdict', async () => {
    const hooks = await import('../src/buyer/wardrobe-hooks');
    hooks.setDoorSwingProvider((box) => (box.cx > 3 ? 'Blocks the Bedroom door from opening.' : null));
    try {
      const t = sessionRig();
      t.session.select('sofa-1');
      expect(t.session.view().message).not.toContain('Blocks');
      t.session.beginMove();
      t.session.moveTo(3.55, 3.5);
      t.session.place();
      expect(t.store.get('sofa-1')).toBeTruthy();
      t.store.editOriginal('sofa-1', { cx: 3.4 });
      t.session.select(null);
      t.session.select('sofa-1');
      expect(t.session.view().message).toContain('Blocks the Bedroom door from opening.');
    } finally { hooks.setDoorSwingProvider(null); }
  });

  it('a decor chair, a rug and lived-in decor on a moved original are not hit by any ray and stay out of the walking grid', () => {
    const t = rig();
    const g0 = Uint8Array.from(t.store.grid().cells);
    t.store.editOriginal('sofa-1', { cx: 3.4 });
    const g1 = Uint8Array.from(t.store.grid().cells);
    expect(Array.from(g1)).not.toEqual(Array.from(g0));
    t.store.reset();
    expect(Array.from(t.store.grid().cells)).toEqual(Array.from(g0));
  });
});

describe('the home as drawn is never mutated', () => {
  it('moving, sizing and removing everything leaves property.furniture and the layout byte-identical', () => {
    const t = sessionRig();
    const before = JSON.stringify([t.property.furniture, t.property.layout]);
    for (const i of t.store.all()) t.store.editOriginal(i.id, { w: i.box.w + 0.1, cx: i.box.cx + 0.2 });
    t.store.setFittings(fittingsRemove(emptyFittings(), 'fan:r'));
    t.store.hideOriginal('sofa-1');
    expect(JSON.stringify([t.property.furniture, t.property.layout])).toBe(before);
    t.store.reset();
    expect(JSON.stringify([t.property.furniture, t.property.layout])).toBe(before);
  });
});

// keep a reference so a refactor that drops the helper fails loudly
void (null as unknown as Box);
