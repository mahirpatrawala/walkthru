import { describe, expect, it } from 'vitest';
import { polygonArea } from '../src/core/geometry';
import { resolveDoors } from '../src/core/doors';
import { validateLayout } from '../src/core/layout-validate';
import { carpetAreaM2 } from '../src/core/layout-geom';
import { doorFrame, mirrorDesigns, mirrorLayout, mirrorProperty } from '../src/building/geom';
import { readBuilding, readScene } from './helpers/sample-building';

const types = readBuilding('sample-tower').flatTypes;
const mirrored = Object.entries(types).filter(([, t]) => t.mirrorSceneId);

describe('mirrored flat instances', () => {
  it('the tower uses mirror images, and each is stored once next to its design', () => {
    expect(mirrored.length).toBeGreaterThanOrEqual(2);
    for (const [, t] of mirrored) { expect(readScene(t.sceneId)).toBeTruthy(); expect(readScene(t.mirrorSceneId!)).toBeTruthy(); }
  });

  for (const [type, t] of mirrored) {
    describe(type, () => {
      const a = readScene(t.sceneId)!, m = readScene(t.mirrorSceneId!)!;
      it('every room keeps its area and the carpet area is equal', () => {
        for (const r of a.layout.rooms) {
          const q = m.layout.rooms.find((x) => x.id === r.id)!;
          expect(Math.abs(polygonArea(q.polygon))).toBeCloseTo(Math.abs(polygonArea(r.polygon)), 6);
        }
        expect(carpetAreaM2(m.layout)).toBeCloseTo(carpetAreaM2(a.layout), 6);
      });
      it('validateLayout is clean and the winding is right', () => {
        expect(validateLayout(m.layout).errors).toEqual([]);
        for (const r of m.layout.rooms) expect(polygonArea(r.polygon)).toBeGreaterThan(0);
      });
      it('every opening keeps its width and type', () => {
        expect(m.layout.openings.length).toBe(a.layout.openings.length);
        for (const o of a.layout.openings) {
          const q = m.layout.openings.find((x) => x.id === o.id)!;
          expect([q.type, q.widthM, q.sillM, q.headM, q.roomId]).toEqual([o.type, o.widthM, o.sillM, o.headM, o.roomId]);
        }
      });
      it('hinges and swings flip: each leaf hangs on the mirror image of its post and swings to the mirror image of its side', () => {
        const da = resolveDoors(a.layout), dm = resolveDoors(m.layout);
        expect(dm.length).toBe(da.length);
        for (const d of da) {
          const e = dm.find((x) => x.id === d.id)!;
          expect(e.swing, d.id).toBe(d.swing); // into the same room
          expect(e.hingeAt.x, d.id).toBeCloseTo(-d.hingeAt.x, 5);
          expect(e.hingeAt.z, d.id).toBeCloseTo(d.hingeAt.z, 5);
          expect(e.swingNormal.x, d.id).toBeCloseTo(-d.swingNormal.x, 5);
          expect(e.swingNormal.z, d.id).toBeCloseTo(d.swingNormal.z, 5);
          expect(e.hinge, d.id).not.toBe(d.hinge);
        }
      });
      it('the main door is where the mirror puts it', () => {
        const id = readBuilding('sample-tower').levels.flatMap((l) => l.spaces).find((s) => s.type === type)!.portals[0].opening;
        const fa = doorFrame(a.layout, id)!, fm = doorFrame(m.layout, id)!;
        expect(fm.centre.x).toBeCloseTo(-fa.centre.x, 5);
        expect(fm.out.x).toBeCloseTo(-fa.out.x, 5);
        expect(fm.hinge!.x).toBeCloseTo(-fa.hinge!.x, 5);
      });
      it('furniture is mirrored with its heading', () => {
        for (const i of a.furniture) {
          const q = m.furniture.find((x) => x.id === i.id)!;
          expect(q.box.cx).toBeCloseTo(-i.box.cx, 6);
          expect(q.box.yawDeg).toBeCloseTo(-i.box.yawDeg, 6);
          expect([q.box.w, q.box.d, q.heightM]).toEqual([i.box.w, i.box.d, i.heightM]);
        }
      });
    });
  }

  it('mirroring twice gives the layout back', () => {
    const a = readScene(mirrored[0][1].sceneId)!;
    const back = mirrorLayout(mirrorLayout(a.layout));
    for (const r of a.layout.rooms) {
      const q = back.rooms.find((x) => x.id === r.id)!;
      expect(Math.abs(polygonArea(q.polygon))).toBeCloseTo(Math.abs(polygonArea(r.polygon)), 6);
      const k = r.polygon.reduce((s, p) => s + p.x + p.z, 0), kq = q.polygon.reduce((s, p) => s + p.x + p.z, 0);
      expect(kq).toBeCloseTo(k, 6);
    }
    for (const o of a.layout.openings) {
      const q = back.openings.find((x) => x.id === o.id)!;
      expect([q.edge, q.leaf?.hinge]).toEqual([o.edge, o.leaf?.hinge]);
      expect(q.centreM).toBeCloseTo(o.centreM, 6);
    }
  });

  it('designs: sizes pass through, a decor offset turns round, an openable wardrobe is refused', () => {
    expect(mirrorDesigns({ version: 1, source: 's', items: { 'bed-1': { surfaceHeightM: 0.55 } }, decor: [{ id: 'c', offset: { x: 0.3, z: 0.4 } }] })).toEqual({ version: 1, source: 's', items: { 'bed-1': { surfaceHeightM: 0.55 } }, decor: [{ id: 'c', offset: { x: -0.3, z: 0.4 } }] });
    expect(() => mirrorDesigns({ items: { 'wardrobe-1': { openable: { bayCentresFromLeftM: [0.3] } } } })).toThrow(/openable/);
  });

  it('a property mirrors with its spawn and loses a splat', () => {
    const a = readScene(mirrored[0][1].sceneId)!;
    const p = mirrorProperty(a, 'x-m', 'T', 'sample');
    expect(p.spawn.x).toBeCloseTo(-a.spawn.x, 6);
    expect(p.id).toBe('x-m');
  });
});
