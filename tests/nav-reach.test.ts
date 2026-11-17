// Every room of every committed home and every tower flat can be walked to with tap-to-go (the room bar, the plan, the Tour), toilets, balconies and decks
// included: a doorway is a gate the planner crosses square-on at the body's own radius (grid-path.ts `Gate`), so a 0.62 to 0.68 m brochure door is no
// longer lost between the nodes of the 10 cm lattice. The walker is simulated frame by frame (tests/helpers/nav-sim.ts): shut doors are opened on the
// way, the body is never inside a wall or a piece, and the walk ends in the room.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHARACTER_RADIUS_M } from '../src/types';
import { circleFree } from '../src/core/grid-query';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { freePos, resolveDoors } from '../src/core/doors';
import { roomAt } from '../src/core/layout-geom';
import { gatesOf, gateOf, planGridOf } from '../src/buyer/nav/door-route';
import { findRoute, PLAN_RADIUS_M } from '../src/buyer/nav/grid-path';
import { tourStops } from '../src/buyer/nav/tour-plan';
import { entryOf, reachableFast } from '../src/building/clear-routes';
import { makeSim } from './helpers/nav-sim';
import { readScene } from './helpers/sample-building';

const ROOT = path.resolve(import.meta.dirname, '..');
const homes = fs.readdirSync(path.join(ROOT, 'public/scenes')).filter((d) => fs.existsSync(path.join(ROOT, 'public/scenes', d, 'property.json')))
  .filter((id) => { const s = readScene(id); return !!s && (!s.spaceKind || s.spaceKind === 'home'); });

/**
 * Rooms a body of the walker's own radius cannot get into once the doors it has to open stand open as far as they go (a flood fill at 10 cm, every
 * leaf stamped at the furthest it opens, from the entrance, to the room's standing spot): the drawing's doors swing into a 1.06 m corridor or leave a
 * pocket behind them, and a sliding leaf stays in front of what is left. Nothing else may be listed (the test below fails for a listed room that IS
 * reachable, so a fix removes its entry). A tap on such a room falls back to the fade and the Tour names it ("Left out: ...").
 */
export const LEAF_SHUT: Record<string, Record<string, string>> = {
  'test-sample-3': { 'm-bed-room': 'door-5 stands open into the room and cuts the part with the standing spot off from the doorway' },
  'test-sample-4': { bedroom: 'door-4 stands open across a 1.06 m corridor (0.9 m of leaf) and shuts the way east', utility: 'door-4 stands open across a 1.06 m corridor and shuts the way east' },
  'test-tower-flat-2bhk-b2': { deck: 'the sliding leaf at its furthest and the deck armchairs leave no 0.44 m opening' },
  'test-tower-flat-2bhk-b4': { utility: 'the sliding leaf at its furthest leaves no 0.44 m opening to the utility' },
  'test-tower-flat-3bhk-b': { balcony: 'the sliding leaf at its furthest and the balcony armchairs leave no 0.44 m opening' },
};

describe('the doorway gate', () => {
  it('is the doorway as a line square through the wall, jamb to jamb', () => {
    const s = readScene('test-tower-flat-2bhk-b4')!;
    const d = resolveDoors(s.layout).find((x) => x.id === 'door-toilet-1')!;
    const g = gateOf(d);
    expect(g.width).toBeCloseTo(0.68, 2);
    expect(Math.hypot(g.n.x, g.n.z)).toBeCloseTo(1, 6);
    expect(Math.abs(g.n.x * g.along.x + g.n.z * g.along.z)).toBeLessThan(1e-6);
  });
  it('plans through a 0.68 m toilet door once its own leaf stands open, and crosses it square-on on the centre line', () => {
    const s = readScene('test-tower-flat-2bhk-b4')!;
    const statics = stampFurniture(rasterizeLayout(s.layout), s.furniture);
    const doors = resolveDoors(s.layout);
    const d = doors.find((x) => x.id === 'door-toilet-1')!;
    const g = gateOf(d);
    const leaves = [{ door: d, pos: freePos(statics, d, 0).pos }];
    const grid = planGridOf(statics, leaves);
    const inside = makeSim(s, 'living').driver.spotIn('toilet-1')!;
    const outside = { x: g.c.x + g.n.x * 1.2, z: g.c.z + g.n.z * 1.2 };
    const r = findRoute(grid, outside, inside, Infinity, gatesOf(leaves));
    expect(r).not.toBeNull();
    // the leg that crosses the wall goes through along its normal, within 12 cm of the middle of the doorway
    const at = (p: { x: number; z: number }) => ({ along: (p.x - g.c.x) * g.along.x + (p.z - g.c.z) * g.along.z, through: (p.x - g.c.x) * g.n.x + (p.z - g.c.z) * g.n.z });
    let crossings = 0;
    for (let i = 1; i < r!.points.length; i++) {
      const a = at(r!.points[i - 1]), b = at(r!.points[i]);
      if (a.through * b.through >= 0 || Math.abs(a.through - b.through) < 0.3) continue;
      crossings++;
      expect(Math.abs(a.along - b.along)).toBeLessThan(0.02);
      expect(Math.abs(a.along)).toBeLessThan(0.12);
    }
    expect(crossings).toBe(1);
    expect(PLAN_RADIUS_M).toBeGreaterThan(0.25);
  });
});

describe('every room of every home is reachable by tap-to-go', () => {
  for (const id of homes) {
    it(id, async () => {
      const prop = readScene(id)!;
      const whole = prop.layout.rooms.filter((r) => !r.partial);
      const shut = LEAF_SHUT[id] ?? {};
      const failed: string[] = [];
      // every leaf at the furthest it opens, a body's own radius, from the entrance: the physical possibility of getting in
      const statics = stampFurniture(rasterizeLayout(prop.layout), prop.furniture);
      const doors = resolveDoors(prop.layout);
      const openAll = planGridOf(statics, doors.map((door) => ({ door, pos: freePos(statics, door, 0).pos })));
      const entry = entryOf(prop.layout, openAll, prop.spawn)!;
      for (const r of whole) {
        const sim = makeSim(prop, whole[0].id);
        const spot = sim.driver.spotIn(r.id);
        if (spot && shut[r.id]) {
          expect(reachableFast(openAll, entry, [spot], CHARACTER_RADIUS_M + 0.005)[0], `${r.id} is listed shut (${shut[r.id]}) but a body can reach it`).toBe(false);
          continue;
        }
        let bad = 0;
        const p = sim.driver.goTo(r.id);
        await sim.run(() => !sim.driver.busy, 90, (live) => {
          // a leaf that is swinging is not counted: the real door system refuses to touch the body, the stand-in here does not
          if (sim.ch.moving > 0 && (sim.doors as unknown as { target: Map<string, number> }).target.size === 0 && !circleFree(live, sim.ch.position.x, sim.ch.position.z, CHARACTER_RADIUS_M - 0.03)) bad++;
        });
        const res = await p;
        if (res !== 'walked' && res !== 'no-spot') failed.push(`${r.id}: ${res} (${(sim.driver as unknown as { lastFail: string | null }).lastFail})`);
        else if (res === 'walked') {
          // one frame is allowed: the frame the leaf's last degrees are drawn in, at a standing spot beside a doorway
          if (bad > 1) failed.push(`${r.id}: the body was inside something for ${bad} frames of the walk`);
          if (roomAt(prop.layout, sim.ch.position)?.id !== r.id) failed.push(`${r.id}: ended in ${roomAt(prop.layout, sim.ch.position)?.id}`);
        }
      }
      expect(failed).toEqual([]);
    }, 120000);
  }
});

describe('the Tour visits every room or leaves it out with a reason', () => {
  for (const id of homes) {
    it(id, () => {
      const prop = readScene(id)!;
      const statics = stampFurniture(rasterizeLayout(prop.layout), prop.furniture);
      const { stops, skipped } = tourStops(prop.layout, statics);
      // every room is a stop or is skipped with one of the three stated reasons
      for (const r of prop.layout.rooms) expect(stops.some((s) => s.room.id === r.id) || skipped.some((s) => s.roomId === r.id), r.id).toBe(true);
      for (const s of skipped) expect(['not on the drawing', 'no place to stand', 'not reachable']).toContain(s.why);
      // every stop is routable from the entrance through its doors as gates (the shut leaves are opened on the way, so none stands in the plan yet)
      const doors = resolveDoors(prop.layout);
      const gates = gatesOf(doors.map((door) => ({ door, pos: 0 })));
      const from = entryOf(prop.layout, statics, prop.spawn);
      expect(from).not.toBeNull();
      const unrouted = stops.filter((s) => !findRoute(statics, from!, s.spot, Infinity, gates)).map((s) => s.room.id);
      expect(unrouted).toEqual([]);
    });
  }
});
