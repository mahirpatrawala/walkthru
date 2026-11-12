// LOCAL ONLY (opt in with `npm run test:local`): the open-wardrobe arithmetic against the numbers of the one real drawing
// shipped as a scene (page 1 plan, page 4 internal elevation, page 5 elevation 3). The always-run twin is
// wardrobe-swing.test.ts, which uses a synthetic bedroom with its own ground truth.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { catalogItem, itemFromCatalog, specFor } from '../src/core/catalog';
import { boxAxes } from '../src/core/geometry';
import { circleFree, moveCircle } from '../src/core/grid-query';
import { rasterizeLayout } from '../src/core/layout-raster';
import { applyDesigns, parseDesigns, parseOpenable } from '../src/look/designs';
import { setItemDesigns } from '../src/look/furniture-real';
import { buildWardrobeModel } from '../src/buyer/wardrobe-model';
import { interiorLines, interiorText } from '../src/buyer/wardrobe';
import { setSwingProvider, swingNoteFor, withSwingNote } from '../src/buyer/wardrobe-hooks';
import { createFurnitureStore } from '../src/buyer/store';
import {
  OBSTACLE_STRIP_M, freeAngleRad, ftInHalf, intrusionM, lengthLabel, openCard, rayToBox, shutterObstacle, shutterPose,
  specFromCatalogue, specFromDesign, swingArc, swingNeedCm, swingNote, toWorld, walkingSpace,
} from '../src/buyer/wardrobe-swing';
import type { ShutterReading } from '../src/buyer/wardrobe-swing';
import { stampFurniture } from '../src/core/layout-raster';
import type { FurnitureItem, Grid, PropertyFile } from '../src/types';
import designsJson from '../public/scenes/son-bedroom/designs.json';
import sonJson from '../public/scenes/son-bedroom/property.json';

const FT = 0.3048;
const IN = 0.0254;
const property = sonJson as unknown as PropertyFile;
const designs = parseDesigns(designsJson)!;
const items = applyDesigns(property.furniture, designs);
setItemDesigns(null);
const byId = (id: string) => items.find((i) => i.id === id)!;
const wardrobe = byId('wardrobe-1');
const bed = byId('bed-1');
const study = byId('counter-3');
const open = designs.items['wardrobe-1'].openable!;
const room = property.layout.rooms.find((r) => r.id === 'son-room')!;
const wallW = Math.min(...room.polygon.map((p) => p.x));
const wallE = Math.max(...room.polygon.map((p) => p.x));
const baseGrid = rasterizeLayout(property.layout);

const front = (i: FurnitureItem) => i.box.cx + i.box.d / 2; // yaw 90 and 270: depth runs along x (sign per item)

describe('the drawing numbers (page + dimension string)', () => {
  it('shutter width = 2\'-11" / 2 = 1\'-5½" = 0.4445 m (page 5, elevation 3)', () => {
    expect(open.bayPitchM).toBeCloseTo(35 * IN, 9);
    expect(open.shutterWidthM).toBeCloseTo(open.bayPitchM / 2, 9);
    expect(open.shutterWidthM).toBeCloseTo(0.4445, 9);
    expect(ftInHalf(open.shutterWidthM)).toBe('1\'-5½"');
  });
  it('three bays of two shutters, hinged at the bay\'s outer edges, as the drawing says', () => {
    expect(designs.items['wardrobe-1'].wardrobe!.bays).toBe(3);
    expect(designs.items['wardrobe-1'].wardrobe!.shuttersPerBay).toBe(2);
    const spec = specFromDesign(wardrobe, open);
    expect(spec.bays).toBe(3);
    expect(spec.shutters).toHaveLength(6);
    for (const bay of [0, 1, 2]) {
      const l = spec.shutters.find((s) => s.bay === bay && s.side === 'left')!;
      const r = spec.shutters.find((s) => s.bay === bay && s.side === 'right')!;
      expect(l.dir).toBe(1);
      expect(r.dir).toBe(-1);
      // the two free edges meet at the bay centre
      expect(l.hingeU + l.widthM).toBeCloseTo(r.hingeU - r.widthM, 9);
      expect(r.hingeU - l.hingeU).toBeCloseTo(open.bayPitchM, 9);
    }
  });
  it('page 4: bay centres 1\'-7", 4\'-6", 7\'-5" from the left end; 2" + 3 x 2\'-10" + 2 x 1" + 2" = 9\' = the box width', () => {
    expect(open.bayCentresFromLeftM.map((c) => Math.round(c / IN))).toEqual([19, 54, 89]);
    const inn = open.interior!;
    expect(2 * inn.sidePanelM + 3 * inn.bayClearM + 2 * inn.partitionM).toBeCloseTo(9 * FT, 9);
    expect(wardrobe.box.w).toBeCloseTo(9 * FT, 9);
    expect(inn.bayClearM).toBeCloseTo(34 * IN, 9);
  });
  it('page 4 zones add up: every bay stacks to 8\'-4" (100") above the base gap', () => {
    for (const zones of open.interior!.zonesBottomUp) expect(zones.reduce((s, z) => s + z.heightM, 0)).toBeCloseTo(100 * IN, 6);
    expect(open.interior!.zonesBottomUp[2].filter((z) => z.kind === 'glass-drawer')).toHaveLength(3);
    expect(open.interior!.zonesBottomUp[2].find((z) => z.kind === 'lockable-drawer')!.heightM).toBeCloseTo(6 * IN, 9);
  });
  it('anything the drawing does not give is listed as not in the drawing, and bays 1 and 2 split is marked derived', () => {
    expect(open.notInDrawing).toEqual(expect.arrayContaining(['shutter thickness', 'handle projection', 'hinge opening angle']));
    expect(open.interior!.zonesBottomUp[0].filter((z) => z.derived).length).toBeGreaterThan(0);
    expect(open.interior!.zonesBottomUp[2].filter((z) => z.derived)).toHaveLength(0);
  });
  it('rejects a malformed openable', () => {
    expect(parseOpenable({ bayPitchM: 0.889 })).toBeUndefined();
    expect(parseOpenable(null)).toBeUndefined();
  });
});

describe('the son room along its 11\'0" side (page 1 chain: 2\' + 2\'-10" + 6\' + 2")', () => {
  it('the room is 11\'0" wide in x', () => {
    expect(wallE - wallW).toBeCloseTo(11 * FT, 6);
  });
  it('wardrobe 2\' deep, back on the wall face', () => {
    expect(wardrobe.box.d).toBeCloseTo(2 * FT, 9);
    expect(wardrobe.box.cx - wardrobe.box.d / 2).toBeCloseTo(wallW, 9);
  });
  it('2\'-10" clear from the wardrobe front to the bed side', () => {
    const bedSide = bed.box.cx - bed.box.d / 2;
    expect(bedSide - front(wardrobe)).toBeCloseTo(34 * IN, 9);
    expect(bedSide - front(wardrobe)).toBeCloseTo(0.8636, 9);
  });
  it('bed 6\' long, 2" to the wall', () => {
    expect(bed.box.d).toBeCloseTo(6 * FT, 9);
    expect(wallE - (bed.box.cx + bed.box.d / 2)).toBeCloseTo(2 * IN, 6);
  });
  it('the other axis and the yaws are as imported (z, w, yaw unchanged)', () => {
    expect(wardrobe.box).toMatchObject({ cz: -0.42962055084745765, w: 2.7432, yawDeg: 90 });
    expect(bed.box).toMatchObject({ cz: 0.186087288135593, w: 1.499999152542373, yawDeg: 270 });
  });
});

describe('shutter geometry', () => {
  const spec = specFromDesign(wardrobe, open);
  const a = boxAxes(wardrobe.box).a;
  const W = open.shutterWidthM;

  it('a shutter at 90 degrees sticks out its width and no more (the angle is not needed beyond that)', () => {
    for (const s of spec.shutters) {
      const p = shutterPose(wardrobe.box, s, Math.PI / 2);
      const out = (p.tip.x - p.hinge.x) * a.x + (p.tip.z - p.hinge.z) * a.z;
      const along = Math.hypot(p.tip.x - p.hinge.x - a.x * out, p.tip.z - p.hinge.z - a.z * out);
      expect(out).toBeCloseTo(W, 9);
      expect(along).toBeCloseTo(0, 9);
      expect(intrusionM(s)).toBeCloseTo(W, 9);
      // beyond a quarter turn it comes back toward the wall
      const past = shutterPose(wardrobe.box, s, (120 * Math.PI) / 180).tip;
      expect((past.x - p.hinge.x) * a.x + (past.z - p.hinge.z) * a.z).toBeLessThan(W);
    }
  });
  it('the arc has radius = the shutter width, from the closed free edge to the open one', () => {
    const s = spec.shutters[0];
    const pts = swingArc(wardrobe.box, s, Math.PI / 2, 24);
    const h = shutterPose(wardrobe.box, s, 0).hinge;
    for (const p of pts) expect(Math.hypot(p.x - h.x, p.z - h.z)).toBeCloseTo(W, 9);
    const closed = shutterPose(wardrobe.box, s, 0).tip;
    expect(pts[0].x).toBeCloseTo(closed.x, 9);
    expect(pts[0].z).toBeCloseTo(closed.z, 9);
  });
  it('hinges sit at the bay\'s outer edges (world z, 1.5" in from the box ends)', () => {
    const zs = spec.shutters.map((s) => shutterPose(wardrobe.box, s, 0).hinge.z).sort((x, y) => x - y);
    const top = wardrobe.box.cz + wardrobe.box.w / 2 - 1.5 * IN, bottom = wardrobe.box.cz - wardrobe.box.w / 2 + 1.5 * IN;
    expect(zs[0]).toBeCloseTo(bottom, 6);
    expect(zs[zs.length - 1]).toBeCloseTo(top, 6);
  });
  it('toWorld puts the front plane at the wardrobe front', () => {
    expect(toWorld(wardrobe.box, 0, wardrobe.box.d / 2).x).toBeCloseTo(front(wardrobe), 9);
  });
});

describe('walking space from each shutter tip (the exact drawing values)', () => {
  const spec = specFromDesign(wardrobe, open);
  const others = items.filter((i) => i.id !== wardrobe.id);
  const grid = stampFurniture(baseGrid, others);
  const a = boxAxes(wardrobe.box).a;
  const readings: ShutterReading[] = spec.shutters.map((s) => {
    const tip = shutterPose(wardrobe.box, s, Math.PI / 2).tip;
    return { shutter: s, angleRad: Math.PI / 2, space: walkingSpace(grid, others, tip, a) };
  });
  const r = (id: string) => readings.find((x) => x.shutter.id === id)!;

  it('0.8636 - 0.4445 = 0.4191 m: "42 cm" and 1\'-4½" to the bed', () => {
    for (const id of ['b1-l', 'b1-r', 'b2-l']) {
      expect(r(id).space.kind).toBe('item');
      expect(r(id).space.itemId).toBe('bed-1');
      expect(r(id).space.what).toBe('bed');
      expect(r(id).space.distM).toBeCloseTo(0.8636 - 0.4445, 9);
      expect(r(id).space.distM).toBeCloseTo(0.4191, 9);
    }
    expect(Math.round(r('b1-l').space.distM * 100)).toBe(42);
    expect(ftInHalf(r('b1-l').space.distM)).toBe('1\'-4½"');
    expect(lengthLabel(r('b1-l').space.distM)).toBe('42 cm · 1\'-4½"');
  });
  it('the shutters beside the study table (bay 3 and the right shutter of bay 2) have the room in front, up to the table', () => {
    for (const id of ['b2-r', 'b3-l', 'b3-r']) {
      expect(r(id).space.itemId).toBe('counter-3');
      const tip = shutterPose(wardrobe.box, r(id).shutter, Math.PI / 2).tip;
      expect(r(id).space.distM).toBeCloseTo(study.box.cx - study.box.d / 2 - tip.x, 6);
      expect(r(id).space.distM).toBeGreaterThan(1.5);
    }
  });
  it('the card for all bays open: "42 cm walking space to the bed", the drawing arithmetic, thickness not included, tone warn', () => {
    const { card, tone, blocked, minSpaceM } = openCard(spec, wardrobe, readings);
    expect(blocked).toBe(false);
    expect(minSpaceM).toBeCloseTo(0.4191, 9);
    expect(card.headline).toBe('Shutters open: 42 cm walking space to the bed.');
    expect(card.lines).toContain('From the drawing: 2\'-10" gap − 1\'-5½" shutter = 1\'-4½" (42 cm).');
    expect(card.lines.join('\n')).toMatch(/Bay 1: 42 cm to the bed\./);
    expect(card.lines.join('\n')).toMatch(/Bay 2: 42 cm to the bed, \d+ cm to the study\./);
    expect(card.lines.join('\n')).toMatch(/Bay 3: \d+ cm to the study\./);
    expect(card.footer).toContain('Shutter thickness and handles are not in the drawing, not included.');
    expect(card.lines.join('\n')).toContain('Drawing conflict:');
    // the tiers are the placement ones: the wardrobe's access rule (front >= 0.90), so 0.42 is "tight" (warn)
    expect(specFor(wardrobe).access[0]).toEqual({ sides: ['front'], minM: 0.9, mode: 'all' });
    expect(tone).toBe('warn');
    expect(card.tone).toBe('warn');
    expect(card.lines.join('\n')).toContain('Tight: a wardrobe needs 90 cm in front (the catalogue access rule), and 42 cm is left with the shutters open.');
  });
  it('one bay open reads "Bay 3 open", with plenty of room', () => {
    const only3 = readings.filter((x) => x.shutter.bay === 2);
    const { card, tone } = openCard(spec, wardrobe, only3);
    expect(card.headline).toMatch(/^Bay 3 open: \d+ cm walking space to the study\.$/);
    expect(tone).toBe('good');
  });
});

describe('the temporary obstacles: open shutters block walking', () => {
  const spec = specFromDesign(wardrobe, open);
  const mk = () => {
    const parent = new THREE.Group();
    return createFurnitureStore({ sceneId: 'son', baseGrid, initial: items, parent, storage: null, saveDelayMs: 0 });
  };
  it('a shutter at 90 degrees stamps a thin full-height strip the walker cannot cross; closing restores the grid', () => {
    const store = mk();
    const s = spec.shutters.find((x) => x.id === 'b1-l')!;
    const before = store.grid();
    const p = shutterPose(wardrobe.box, s, Math.PI / 2);
    const mid = { x: p.hinge.x + p.dir.x * 0.22, z: p.hinge.z + p.dir.z * 0.22 };
    expect(circleFree(before, mid.x, mid.z, 0.05)).toBe(true);
    let changes = 0;
    store.onChange(() => { changes += 1; });
    store.setTemporary(wardrobe.id, spec.shutters.map((x) => shutterObstacle(wardrobe.box, x, Math.PI / 2, wardrobe.heightM)));
    expect(changes).toBe(1);
    expect(circleFree(store.grid(), mid.x, mid.z, 0.05)).toBe(false);
    // walking across the open shutter is stopped, with the walker sliding along it
    const from = { x: mid.x, z: mid.z + 0.4 };
    expect(circleFree(store.grid(), from.x, from.z, 0.22)).toBe(true);
    const end = moveCircle(store.grid(), from, { x: 0, z: -0.8 }, 0.22);
    expect(end.z).toBeGreaterThan(mid.z + 0.1);
    expect(moveCircle(before, from, { x: 0, z: -0.8 }, 0.22).z).toBeLessThan(mid.z);
    // the temporary obstacles are not items and are not saved
    expect(store.all().map((i) => i.id)).toEqual(items.map((i) => i.id));
    expect(store.gridWithout([wardrobe.id], false).cells).toEqual(stampFurniture(baseGrid, items.filter((i) => i.id !== wardrobe.id)).cells);
    store.setTemporary(wardrobe.id, []);
    expect(circleFree(store.grid(), mid.x, mid.z, 0.05)).toBe(true);
    expect(store.grid().cells).toEqual(before.cells);
    store.dispose();
  });
  it('the strip is the grid resolution, not a shutter thickness', () => {
    expect(OBSTACLE_STRIP_M).toBeCloseTo(0.06, 9);
    const o = shutterObstacle(wardrobe.box, spec.shutters[0], Math.PI / 2, 2.54);
    expect(o.box.d).toBeCloseTo(open.shutterWidthM, 9);
    expect(o.box.w).toBe(OBSTACLE_STRIP_M);
  });
});

describe('the shutter meshes open into the room, hinged at the outer edge', () => {
  const spec = specFromDesign(wardrobe, open);
  const model = buildWardrobeModel(wardrobe, spec, designs.items['wardrobe-1'].wardrobe!);
  const a = boxAxes(wardrobe.box).a;
  it('builds six pivots and the inside from page 4', () => {
    expect(spec.shutters.every((s) => !!model.pivot(s.id))).toBe(true);
    expect(model.hasInterior).toBe(true);
    expect(model.group.getObjectByName('interior')!.visible).toBe(false);
    model.setInteriorVisible(true);
    expect(model.group.getObjectByName('interior')!.visible).toBe(true);
  });
  it('at 90 degrees every slab reaches out to its width and stays at its hinge (no swing into the wardrobe)', () => {
    for (const s of spec.shutters) {
      model.setAngle(s.id, Math.PI / 2);
      const slab = model.pivot(s.id)!.getObjectByName(`shutter-slab:${s.id}`) as THREE.Mesh;
      model.group.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(slab);
      const h = shutterPose(wardrobe.box, s, 0).hinge;
      const corners = [bb.min, bb.max];
      const outs = corners.map((c) => (c.x - h.x) * a.x + (c.z - h.z) * a.z);
      expect(Math.max(...outs)).toBeCloseTo(s.widthM - 0.0015, 4);
      expect(Math.min(...outs)).toBeCloseTo(0.0015, 3);
    }
  });
  it('closed again, the slab lies flush with the front plane', () => {
    const s = spec.shutters[0];
    model.setAngle(s.id, 0);
    model.group.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(model.pivot(s.id)!.getObjectByName(`shutter-slab:${s.id}`)!);
    const outs = [bb.min, bb.max].map((c) => (c.x - front(wardrobe)) * a.x + (c.z - wardrobe.box.cz) * a.z);
    expect(Math.max(...outs)).toBeCloseTo(0, 3);
  });
  it('describes the inside with the drawing\'s own dimension strings, bays with the same inside on one line', () => {
    const z = open.interior!.zonesBottomUp;
    expect(interiorText(z[2])).toBe('Footwear drawer 7", 3 \u00d7 glass drawer 8", Lockable drawers 6", Open shelf 9", Folded shirts and hanging 1\'-11", Open shelf 2\'');
    expect(interiorText(z[0])).toContain('Hanging space (not dimensioned)');
    const lines = interiorLines([0, 1, 2], z, 'page 4');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Inside bays 1, 2 \(page 4, bottom to top\): Footwear drawer 7"/);
    expect(lines[1]).toMatch(/^Inside bay 3 \(page 4, bottom to top\)/);
    model.dispose();
  });
});

describe('a catalogue wardrobe (not from a drawing) uses its own shutter widths', () => {
  const cat = itemFromCatalog('wardrobe-2', { cx: -0.5757481971406753, cz: 0, w: 1.2, d: 0.6, yawDeg: 90 }, 'virtual');
  const spec = specFromCatalogue(cat)!;
  it('"2-door wardrobe" 120 cm wide: two shutters of 60 cm hinged at the outer edges', () => {
    expect(catalogItem('wardrobe-2').name).toBe('2-door wardrobe');
    expect(spec.origin).toBe('catalogue');
    expect(spec.shutters.map((s) => [s.side, s.hingeU, s.dir, s.widthM])).toEqual([['left', -0.6, 1, 0.6], ['right', 0.6, -1, 0.6]]);
  });
  it('the card says catalogue size and still gives the walking space', () => {
    const { card } = (() => {
      const grid = baseGrid;
      const a = boxAxes(cat.box).a;
      const rs: ShutterReading[] = spec.shutters.map((s) => {
        const tip = shutterPose(cat.box, s, Math.PI / 2).tip;
        return { shutter: s, angleRad: Math.PI / 2, space: walkingSpace(grid, [], tip, a) };
      });
      return openCard(spec, cat, rs);
    })();
    expect(card.title).toContain('catalogue size');
    expect(card.lines.join('\n')).toContain('Catalogue size: 120 cm wide, 2 doors, so each shutter is 60 cm · 1\'-11½".');
    expect(card.footer).toContain('Catalogue size, not from a drawing.');
  });
  it('a shutter that meets something says where it stops, in the placement\'s "blocked" tone', () => {
    const a = boxAxes(cat.box).a;
    const rs: ShutterReading[] = spec.shutters.map((s) => ({
      shutter: s, angleRad: (36 * Math.PI) / 180, space: walkingSpace(baseGrid, [], shutterPose(cat.box, s, (36 * Math.PI) / 180).tip, a),
    }));
    const r = openCard(spec, cat, rs);
    expect(r.blocked).toBe(true);
    expect(r.tone).toBe('bad');
    expect(r.card.lines).toContain('Left door: stops at 36\u00b0.');
    expect(r.card.lines.join('\n')).toContain('stops at 36\u00b0 of 90\u00b0. Each shutter needs 60 cm in front.');
  });
  it('a non-wardrobe, or a wardrobe with another door count, does not open', () => {
    expect(specFromCatalogue(itemFromCatalog('bed-queen', { cx: 0, cz: 0, w: 1.62, d: 2.08, yawDeg: 0 }, 'virtual'))).toBeNull();
    expect(specFromCatalogue({ ...cat, catalogId: undefined })).toBeNull();
  });
  it('freeAngleRad: nothing near gives 90 degrees, a wall 40 cm out stops a 60 cm shutter early', () => {
    const open90 = freeAngleRad(baseGrid, cat.box, spec.shutters[0], Math.PI / 2);
    expect(open90).toBeCloseTo(Math.PI / 2, 9);
    const wall: FurnitureItem = { id: 'w', source: 'virtual', kind: 'wardrobe', label: 'wall', heightM: 2, surfaceHeightM: 2,
      box: { cx: cat.box.cx + cat.box.d / 2 + 0.4 + 0.05, cz: cat.box.cz, w: 3, d: 0.1, yawDeg: 90 } };
    const g: Grid = stampFurniture(baseGrid, [wall]);
    const stopped = freeAngleRad(g, cat.box, spec.shutters[0], Math.PI / 2);
    expect(stopped).toBeLessThan(Math.PI / 2);
    expect(stopped).toBeGreaterThan(0);
    // sin(angle) * 0.6 stays under 0.4 m
    expect(Math.sin(stopped) * 0.6).toBeLessThan(0.4 + 0.03);
  });
});

describe('furnish: "Wardrobe shutters need N cm to open here"', () => {
  const spec = specFromDesign(wardrobe, open);
  const bedBox = (xFront: number) => ({ cx: xFront + 0.9144, cz: -0.4, w: 1.5, d: 1.8288, yawDeg: 270 });
  it('an item whose box reaches into a shutter swing needs the shutter width; one beyond it needs none', () => {
    const f = front(wardrobe);
    expect(swingNeedCm(spec, wardrobe.box, bedBox(f + 0.3))).toBe(Math.round(0.4445 * 100));
    expect(swingNeedCm(spec, wardrobe.box, bedBox(f + 0.8636))).toBeNull();
    expect(swingNeedCm(spec, wardrobe.box, bedBox(f + 0.4445 + 0.02))).toBeNull();
    expect(swingNote(44)).toBe('Wardrobe shutters need 44 cm to open here.');
  });
  it('the hook adds the sentence only when a provider is registered', () => {
    const b = { cx: 0, cz: 0, w: 1, d: 1, yawDeg: 0 };
    expect(swingNoteFor(b)).toBeNull();
    expect(withSwingNote('King bed fits.', b)).toBe('King bed fits.');
    setSwingProvider((_box, self) => (self === 'skip' ? null : swingNote(44)));
    expect(withSwingNote('King bed fits.', b, 'x')).toBe('King bed fits. Wardrobe shutters need 44 cm to open here.');
    expect(withSwingNote('King bed fits.', b, 'skip')).toBe('King bed fits.');
    setSwingProvider(null);
  });
  it('the item on the drawing\'s own bed position is clear of the swing (2\'-10" is more than a shutter)', () => {
    expect(swingNeedCm(spec, wardrobe.box, bed.box)).toBeNull();
  });
});

describe('ray against a box', () => {
  it('hits the near face, 0 inside, null on a miss', () => {
    const b = { cx: 5, cz: 0, w: 2, d: 2, yawDeg: 90 };
    expect(rayToBox({ x: 0, z: 0 }, { x: 1, z: 0 }, b)).toBeCloseTo(4, 9);
    expect(rayToBox({ x: 5, z: 0 }, { x: 1, z: 0 }, b)).toBe(0);
    expect(rayToBox({ x: 0, z: 3 }, { x: 1, z: 0 }, b)).toBeNull();
  });
});
