import { describe, expect, it } from 'vitest';
import { CHARACTER_RADIUS_M } from '../src/types';
import { inDoorSweep, resolveDoors } from '../src/core/doors';
import { circleFree } from '../src/core/grid-query';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { roomAt } from '../src/core/layout-geom';
import { ARRIVAL_CLEAR_M, ARRIVAL_FROM_M, ARRIVAL_LEAF_CLEAR_M, arrivalAtDoor, reachable } from '../src/building/arrival';
import { doorFrame } from '../src/building/geom';
import { readBuilding, readScene } from './helpers/sample-building';

describe('arriving through a portal', () => {
  for (const id of ['sample-tower', 'sample-tower-empty']) {
    const b = readBuilding(id);
    for (const l of b.levels) for (const s of l.spaces) {
      const p = readScene(s.sceneId)!;
      const grid = stampFurniture(rasterizeLayout(p.layout), p.furniture);
      const doors = resolveDoors(p.layout);
      for (const portal of s.portals) {
        it(`${id}/${s.id}/${portal.id}: just inside the matching door, facing in, clear of the leaf and its sweep`, () => {
          const f = doorFrame(p.layout, portal.opening)!;
          const a = arrivalAtDoor(p.layout, grid, portal.opening);
          expect(a, 'a landing exists').not.toBeNull();
          const at = { x: a!.x, z: a!.z };
          // inside the door's own room, on the room's side of the wall
          expect(roomAt(p.layout, at)?.id).toBe(f.roomId);
          const along = (at.x - f.centre.x) * f.out.x + (at.z - f.centre.z) * f.out.z;
          expect(along).toBeLessThan(-0.8);
          // not far from the door either: within the room a few metres of it
          expect(Math.hypot(at.x - f.centre.x, at.z - f.centre.z)).toBeLessThan(3.4);
          // facing in: along the inward normal
          const yaw = (a!.yawDeg * Math.PI) / 180;
          expect(Math.sin(yaw) * -f.out.x + Math.cos(yaw) * -f.out.z).toBeCloseTo(1, 5);
          // clear floor, and clear of every leaf at every angle it can take
          expect(circleFree(grid, at.x, at.z, ARRIVAL_CLEAR_M)).toBe(true);
          expect(circleFree(grid, at.x, at.z, CHARACTER_RADIUS_M)).toBe(true);
          expect(inDoorSweep(doors, at, ARRIVAL_LEAF_CLEAR_M)).toBe(false);
        });
      }
    }
  }

  it('a lobby wide enough lands the walker as far in as asked; a narrow corridor lands them as near as it can', () => {
    const lobby = readScene('test-tower-lobby')!;
    const lg = stampFurniture(rasterizeLayout(lobby.layout), lobby.furniture);
    const a = arrivalAtDoor(lobby.layout, lg, 'door-street')!;
    const f = doorFrame(lobby.layout, 'door-street')!;
    expect(Math.hypot(a.x - f.centre.x, a.z - f.centre.z)).toBeGreaterThanOrEqual(ARRIVAL_FROM_M - 0.01);
    const cor = readScene('test-tower-corridor')!;
    const cg = rasterizeLayout(cor.layout);
    const c = arrivalAtDoor(cor.layout, cg, 'door-ne')!;
    const cf = doorFrame(cor.layout, 'door-ne')!;
    expect(Math.hypot(c.x - cf.centre.x, c.z - cf.centre.z)).toBeLessThan(1.8);
  });

  it('an opening that is not a door has no landing', () => {
    const p = readScene('test-tower-lobby')!;
    expect(arrivalAtDoor(p.layout, rasterizeLayout(p.layout), 'no-such-opening')).toBeNull();
  });

  it('reachable: a corridor reaches its doors, and a wall between does not', () => {
    const p = readScene('test-tower-corridor')!;
    const g = rasterizeLayout(p.layout);
    const a = arrivalAtDoor(p.layout, g, 'lift-a')!;
    const doors = ['door-ne', 'door-se', 'door-nw', 'door-n'].map((id) => arrivalAtDoor(p.layout, g, id)!);
    expect(reachable(g, a, doors)).toEqual([true, true, true, true]);
    // somewhere outside the rooms is not reachable
    expect(reachable(g, a, [{ x: 30, z: 30 }])).toEqual([false]);
  });
});
