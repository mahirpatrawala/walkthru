// The four flats of the Sample Tower follow a published builder brochure's printed plans (scripts/building/brochure-flats/*, SPEC 18.13): every room is
// built to its printed size, the rooms and the walls between them match the stated carpet area, every room can be walked to, and each flat's main door
// is on the corridor of the typical floor.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTHORED, SPEC_FINISHES, readFlat } from '../scripts/building/flats';
import { checkFlat, SIZE_TOL_M } from '../scripts/building/flat-spec';
import { composeTypicalFloor, plateProblems } from '../scripts/building/plate';
import { parseDesignSheet } from '../src/look/design-sheet';
import { knownFinish } from '../src/look/finishes';
import { ceilingTrustFromExtras, unverifiedRoomsFromExtras } from '../src/core/room-trust';
import { resolveDoors, freePos } from '../src/core/doors';
import { buildDoorModel } from '../src/buyer/doors-model';
import { stampFurniture, rasterizeLayout } from '../src/core/layout-raster';
import { arrivalAtDoor, reachable } from '../src/building/arrival';
import { doorFrame, dirToLevel, toLevel } from '../src/building/geom';
import { sunState } from '../src/look/sun';
import { polygonCentroid } from '../src/core/spawn';
import { nearestFree } from '../src/core/grid-query';
import { pointInPolygon, polygonArea } from '../src/core/geometry';
import { readBuilding, readScene } from './helpers/sample-building';

const ROOT = path.resolve(import.meta.dirname, '..');
const json = (id: string, f: string): unknown => { const p = path.join(ROOT, 'public/scenes', id, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const bbox = (poly: { x: number; z: number }[]): { w: number; d: number } => ({
  w: Math.max(...poly.map((p) => p.x)) - Math.min(...poly.map((p) => p.x)), d: Math.max(...poly.map((p) => p.z)) - Math.min(...poly.map((p) => p.z)),
});

describe('the four brochure flats', () => {
  it('are two 3 BHKs and two 2 BHKs, named by the stated RERA carpet area', () => {
    const t = readBuilding('sample-tower').flatTypes;
    expect(Object.keys(t).sort()).toEqual(['2bhk-b2', '2bhk-b4', '3bhk-a', '3bhk-b']);
    expect(Object.values(t).map((x) => x.name).sort()).toEqual(['2 BHK · 589 sq ft', '2 BHK · 644 sq ft', '3 BHK · 1,117 sq ft', '3 BHK · 930 sq ft']);
    for (const a of AUTHORED) expect(a.name).toContain(Math.round(a.carpetAreaM2 * 10.764).toLocaleString('en-IN'));
    expect(AUTHORED.filter((a) => /^3 BHK/.test(a.name)).length).toBe(2);
    expect(AUTHORED.filter((a) => /^2 BHK/.test(a.name)).length).toBe(2);
  });

  for (const a of AUTHORED) {
    describe(a.typeId, () => {
      const rep = checkFlat(a);
      const scene = readScene(a.sceneId)!;

      it('keeps every printed size: each rectangle of each room is built to the printed size within 2 cm', () => {
        expect(rep.errors).toEqual([]);
        expect(rep.warnings).toEqual([]); // no wall thinner than 6 cm, every piece inside the rooms
        for (const r of rep.rooms) for (const p of r.parts) {
          expect(Math.abs(p.printed[0] - p.built[0]), `${a.typeId} ${r.label}`).toBeLessThanOrEqual(SIZE_TOL_M + 1e-9);
          expect(Math.abs(p.printed[1] - p.built[1]), `${a.typeId} ${r.label}`).toBeLessThanOrEqual(SIZE_TOL_M + 1e-9);
        }
        // and what is committed is what the spec builds: each single-rectangle room is the printed size
        for (const r of rep.rooms.filter((x) => x.parts.length === 1)) {
          const b = bbox(scene.layout.rooms.find((q) => q.id === r.id)!.polygon);
          const got = [b.w, b.d].sort((x, y) => x - y);
          expect(Math.abs(got[0] - r.parts[0].printed[0])).toBeLessThanOrEqual(SIZE_TOL_M + 1e-9);
          expect(Math.abs(got[1] - r.parts[0].printed[1])).toBeLessThanOrEqual(SIZE_TOL_M + 1e-9);
        }
      });

      it('has the rooms of its table and plan, none more', () => {
        expect(scene.layout.rooms.map((r) => r.id).sort()).toEqual(a.rooms.map((r) => r.id).sort());
        for (const r of scene.layout.rooms) expect(Math.abs(polygonArea(r.polygon))).toBeCloseTo(rep.rooms.find((x) => x.id === r.id)!.areaM2, 2);
      });

      it('adds up to the stated carpet area within the stated 3 %: the rooms the brochure counts plus the walls between them', () => {
        expect(rep.area.statedM2).toBe(a.carpetAreaM2);
        expect(rep.area.toleranceFrac).toBe(0.03);
        expect(Math.abs(rep.area.deviationFrac)).toBeLessThanOrEqual(0.03);
        expect(rep.area.roomsM2).toBeLessThan(a.carpetAreaM2); // the rooms alone are short of it: the walls make up the rest
        expect(rep.area.roomsM2 + rep.area.partitionsM2).toBeCloseTo(rep.area.totalM2, 6);
        // the usable area (adds the balcony and the utility) is within the same tolerance too
        expect(Math.abs(rep.area.usableCheck!.deviationFrac)).toBeLessThanOrEqual(0.03);
      });

      for (const furn of [true, false]) {
        it(`every room can be walked to from the main door (${furn ? 'furnished' : 'bare'}), and the door has a landing`, () => {
          const grid = stampFurniture(rasterizeLayout(scene.layout), furn ? scene.furniture : []);
          const at = arrivalAtDoor(scene.layout, grid, a.mainDoor);
          expect(at).not.toBeNull();
          const rooms = scene.layout.rooms.filter((r) => r.roomType !== 'balcony');
          const spots = rooms.map((r) => { const c0 = polygonCentroid(r.polygon); const c = pointInPolygon(c0, r.polygon) ? c0 : r.polygon[0]; return nearestFree(grid, c.x, c.z, 0.25, 1.2) ?? c; });
          const ok = reachable(grid, at!, spots);
          expect(rooms.filter((_, i) => !ok[i]).map((r) => r.id)).toEqual([]);
        });
      }

      it('has doors that open: a hinged leaf at least 60 % of its swing before it meets a wall or a piece, a sliding leaf all the way, and a sliding leaf is built as glass', () => {
        const grid = stampFurniture(rasterizeLayout(scene.layout), scene.furniture);
        const doors = resolveDoors(scene.layout);
        for (const d of doors) {
          if (d.kind === 'sliding') {
            expect(d.maxPos, `${a.typeId} ${d.id} has a wall to slide along`).toBeGreaterThan(0.4);
            expect(freePos(grid, d).pos, `${a.typeId} ${d.id} slides open`).toBeGreaterThanOrEqual(d.maxPos - 1e-6);
            const names: string[] = [];
            buildDoorModel(d, '#4A3528').group.traverse((o) => { names.push(o.name); });
            expect(names, `${a.typeId} ${d.id}`).toContain('door-glass');
            expect(names, `${a.typeId} ${d.id}`).not.toContain('door-panel');
          } else expect(freePos(grid, d).pos, `${a.typeId} ${d.id}`).toBeGreaterThanOrEqual(0.6 * d.maxPos);
        }
        expect(doors.some((d) => d.kind === 'sliding')).toBe(true);
      });

      it('has its main door on an outside wall, 1.0 m class, and the check proves no door opens into another room', () => {
        const d = scene.layout.openings.find((o) => o.id === a.mainDoor)!;
        expect(d.type).toBe('door');
        expect(d.widthM).toBeGreaterThanOrEqual(0.9);
        expect(d.widthM).toBeLessThanOrEqual(1.1);
        const door = resolveDoors(scene.layout).find((x) => x.id === a.mainDoor)!;
        expect(door.rooms[1]).toBeNull();
      });

      it('says what it did not measure: the ceiling is not confirmed, door and window sizes are listed as assumptions, the sizes of the rooms are confirmed', () => {
        const extras = json(a.sceneId, 'proposal-extras.json') as { assumptions: string[]; carpet: { statedM2: number } };
        expect(ceilingTrustFromExtras(extras).known).toBe(false);
        expect(unverifiedRoomsFromExtras(extras)).toEqual({});
        expect(extras.assumptions.join(' ')).toMatch(/Door and window widths.*not printed/);
        expect(extras.assumptions.join(' ')).toMatch(/artist's conception/);
        expect(extras.carpet.statedM2).toBe(a.carpetAreaM2);
        expect(a.notes.length).toBeGreaterThan(0);
      });

      it('carries the specification as finishes of the look\'s own table, and a look.json', () => {
        const sheet = parseDesignSheet(json(a.sceneId, 'design.json'))!;
        expect(sheet.pack).toBe('light-scandinavian');
        expect(sheet.source).toBe('typical');
        for (const r of a.rooms) {
          const want = SPEC_FINISHES[r.finish];
          expect(sheet.rooms[r.id], r.id).toEqual(want);
          for (const id of Object.values(want)) expect(knownFinish(id)).toBe(true);
        }
        expect(sheet.fixtures.length).toBeGreaterThanOrEqual(3); // an AC point for the living room and every bedroom
        expect(sheet.fixtures.every((f) => f.kind === 'ac')).toBe(true);
        expect(sheet.items.decor?.roles?.door).toBe('white-laminate');
        expect(json(a.sceneId, 'look.json')).toMatchObject({ version: 1 });
      });

      it('is the same flat unfurnished in the empty twin, with the specification but none of the decor', () => {
        const id = a.sceneId.replace('test-tower-', 'test-tower-empty-');
        const e = readScene(id)!;
        expect(e.furniture).toEqual([]);
        expect(e.layout.rooms).toEqual(scene.layout.rooms);
        expect(e.layout.openings).toEqual(scene.layout.openings);
        const sheet = parseDesignSheet(json(id, 'design.json'))!;
        expect(sheet.fixtures).toEqual([]);
        expect(sheet.rooms).toEqual(parseDesignSheet(json(a.sceneId, 'design.json'))!.rooms);
        expect(json(id, 'designs.json')).toBeNull();
      });

      it('furniture is sample furniture: real items from the catalogue or the plan, none of it a measured fact', () => {
        expect(scene.furniture.length).toBeGreaterThan(10);
        expect(scene.subtitle).toMatch(/furniture illustrative/);
        expect(scene.subtitle).toMatch(/brochure/);
        for (const f of scene.furniture) expect(f.source).toBe('real');
      });
    });
  }
});

const bearingOf = (v: { x: number; z: number }): number => (((Math.atan2(v.x, -v.z) * 180) / Math.PI) % 360 + 360) % 360;
const WORD: Record<string, number> = { N: 0, E: 90, S: 180, W: 270 };

describe('north', () => {
  it("reads each page's compass: the letter N sits on one side of the rose and that side is north, which agrees with the page's FACING label", () => {
    const want: Record<string, { northDeg: number; facing: 'E' | 'W' }> = { '3bhk-a': { northDeg: 90, facing: 'W' }, '3bhk-b': { northDeg: 90, facing: 'W' }, '2bhk-b2': { northDeg: 270, facing: 'E' }, '2bhk-b4': { northDeg: 270, facing: 'E' } };
    for (const a of AUTHORED) {
      expect(a.northDeg, a.typeId).toBe(want[a.typeId].northDeg);
      expect(a.brochureFacing, a.typeId).toBe(want[a.typeId].facing);
      // the bottom of the page (the plan's +z, the balcony side) looks to the side the page says the plan faces
      expect((a.northDeg + 180) % 360, a.typeId).toBe(WORD[a.brochureFacing]);
    }
  });

  it('in the building the sun follows OUR plate: each flat scene\'s north is its plan turned with the flat on the floor, north up the plan', () => {
    const b = readBuilding('sample-tower');
    for (const id of ['sample-tower', 'sample-tower-empty']) for (const lv of readBuilding(id).levels) for (const sp of lv.spaces.filter((x) => x.kind === 'home')) {
      const look = json(sp.sceneId, 'look.json') as { version: number; northDeg: number };
      // the plan's -z direction, turned by the placement, as a bearing on a plate whose north is up
      expect(look.northDeg, `${id}/${sp.id}`).toBeCloseTo(bearingOf(dirToLevel({ x: 0, z: -1 }, sp.placement)), 6);
      const flat = readScene(sp.sceneId)!;
      // so the sun of the walk (src/look/sun.ts) comes from the same side on the plate for every flat: turn its direction by the placement and read the bearing
      const st = sunState(flat.layout, { northDeg: look.northDeg }, 16.5);
      expect(st.known).toBe(true);
      expect(bearingOf(dirToLevel({ x: st.toSun[0], z: st.toSun[2] }, sp.placement)), `${id}/${sp.id} sun`).toBeCloseTo(st.bearingDeg!, 3);
    }
    // all four brochure orientations (two face west, two east on their own pages) are placed as the plate puts them: each card says the brochure's facing and the plate's
    for (const sp of b.levels.find((l) => l.id === 'l2')!.spaces.filter((x) => x.kind === 'home')) {
      const note = sp.notes!.join(' ');
      expect(note, sp.id).toMatch(/The brochure's own plan faces (east|west) \(information only\)\. In this tower the sun follows the floor plan, which is ours: this flat's balcony side faces (north|east|south|west)\./);
      const side = (note.match(/balcony side faces (\w+)/) ?? [])[1];
      const bearing = bearingOf(dirToLevel({ x: 0, z: 1 }, sp.placement));
      expect(['north', 'east', 'south', 'west'].indexOf(side) * 90, sp.id).toBe(bearing);
    }
  });
});

describe('the typical floor of the brochure flats', () => {
  const b = readBuilding('sample-tower');
  const level = b.levels.find((l) => l.id === 'l2')!;
  const corridorSpace = level.spaces.find((s) => s.kind === 'corridor')!;
  const corridor = readScene(corridorSpace.sceneId)!;

  it('has the four flats on every typical floor, each on the corridor, none mirrored, and says the arrangement is ours', () => {
    for (const lv of ['l2', 'l3']) {
      const flats = b.levels.find((l) => l.id === lv)!.spaces.filter((s) => s.kind === 'home');
      expect(flats.map((s) => s.type).sort()).toEqual(['2bhk-b2', '2bhk-b4', '3bhk-a', '3bhk-b']);
      for (const f of flats) expect(f.mirrored).toBeUndefined();
    }
    for (const id of ['sample-tower', 'sample-tower-empty']) {
      const sub = readBuilding(id).subtitle!;
      expect(sub, id).toContain('The flats and the clubhouse level follow a published builder brochure');
      expect(sub, id).toContain('the floor arrangement around the lift lobby is ours');
    }
    expect(b.name).toBe('Sample Tower');
    expect(readBuilding('sample-tower-empty').name).toBe('Sample Tower, empty');
    expect(corridorSpace.notes!.join(' ')).toContain('The floor arrangement around the lift lobby is ours.');
  });

  it('puts every main door on the corridor: the two doors meet, face each other, and the corridor door is on the corridor room', () => {
    for (const f of level.spaces.filter((s) => s.kind === 'home')) {
      const flat = readScene(f.sceneId)!;
      const portal = f.portals[0];
      if (portal.kind !== 'door') throw new Error('a flat opens by a door');
      const far = corridorSpace.portals.find((p) => p.id === portal.to.portal)!;
      const fa = doorFrame(flat.layout, portal.opening)!, fc = doorFrame(corridor.layout, far.opening)!;
      const ca = toLevel(fa.centre, f.placement), cc = toLevel(fc.centre, corridorSpace.placement);
      expect(Math.hypot(ca.x - cc.x, ca.z - cc.z), f.id).toBeLessThan(0.36);
      const oa = dirToLevel(fa.out, f.placement), oc = dirToLevel(fc.out, corridorSpace.placement);
      expect(oa.x * oc.x + oa.z * oc.z, f.id).toBeLessThan(-0.95);
      expect(corridor.layout.rooms.find((r) => r.id === fc.roomId)!.label, f.id).toBe('Corridor');
    }
  });

  it('has no flat on another, no balcony railing facing a neighbour, no window looking at the corridor wall', async () => {
    const designs: Record<string, Awaited<ReturnType<typeof readFlat>>> = {};
    for (const a of AUTHORED) designs[a.typeId] = await readFlat({ typeId: a.typeId, name: a.name, sceneId: a.sceneId });
    const order = [['01', 'E', '2bhk-b4'], ['02', 'E', '2bhk-b2'], ['03', 'W', '3bhk-b'], ['04', 'N', '3bhk-a']] as const;
    const plate = composeTypicalFloor([...order].sort((x, y) => Number(y[1] === 'N') - Number(x[1] === 'N')).map(([key, side, type]) => ({ key, side, design: designs[type] })));
    expect(plateProblems(plate)).toEqual([]);
    expect(plate.flats.every((f) => !f.mirrored)).toBe(true);
    // the check is not vacuous: push a flat 1.5 m along the corridor and it sees a problem
    const moved = { ...plate, flats: plate.flats.map((f) => (f.key === '03' ? { ...f, rooms: f.rooms.map((r) => ({ ...r, polygon: r.polygon.map((p) => ({ x: p.x + 1.4, z: p.z })) })) } : f)) };
    expect(plateProblems(moved).length).toBeGreaterThan(0);
  });

  it('keeps one lift lobby and one corridor 1.8 m wide, about 23 m long', () => {
    const rooms = corridor.layout.rooms;
    expect(rooms.filter((r) => r.label === 'Lift lobby').length).toBe(1);
    expect(rooms.filter((r) => r.label === 'Corridor').length).toBe(1);
    const c = rooms.find((r) => r.label === 'Corridor')!;
    const zs = c.polygon.map((p) => p.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(20);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(26);
  });
});
