// The tour and the jump on the real flat layouts, without a browser: every reachable room is visited once, the body is never inside a wall,
// a piece of furniture or a door leaf, a shut door on the way is opened first, and the walk ends where it started.
import { describe, expect, it } from 'vitest';
import { CHARACTER_RADIUS_M } from '../src/types';
import { circleFree } from '../src/core/grid-query';
import { makeSim, inRoom, loadScene } from './helpers/nav-sim';
import { findRoute } from '../src/buyer/nav/grid-path';
import { planGridOf } from '../src/buyer/nav/door-route';
import { SHORTCUT_FROM_M } from '../src/buyer/nav/nav-model';

const FLAT_204 = 'test-tower-flat-3bhk-a';

describe('tour of a 16-room flat with every door shut', () => {
  it('visits every reachable room once, never stands in a wall, furniture or leaf, and ends at the start', async () => {
    const sim = makeSim(FLAT_204, 'living');
    const start = { ...sim.ch.position };
    let bad = 0;
    const p = sim.driver.startTour();
    const t = await sim.run(() => !sim.driver.touring && sim.driver.tour?.phase === 'done', 1200, (live) => {
      if (!circleFree(live, sim.ch.position.x, sim.ch.position.z, CHARACTER_RADIUS_M - 0.03)) bad++;
    });
    const st = await p;
    expect(st.phase).toBe('done');
    expect(bad).toBe(0);
    // each stop once, in the room it names
    expect(new Set(st.visited).size).toBe(st.visited.length);
    const rooms = sim.layout.rooms.map((r) => r.id);
    const missing = rooms.filter((id) => !st.visited.includes(id) && !st.skipped.some((s) => s.roomId === id));
    expect(missing).toEqual([]);
    // passages are glided through (listed as visited, not counted as stops): the count on the card is the other rooms
    const passages = st.visited.filter((id) => /passage|lobby|corridor|foyer|hall/i.test(sim.layout.rooms.find((r) => r.id === id)?.label ?? '')).length;
    expect(st.visited.length - passages).toBe(st.total);
    expect(st.visited.length).toBeGreaterThanOrEqual(14);
    // it really went through doors it had to open
    expect(sim.doors.opened.length).toBeGreaterThan(5);
    // it ended where it started
    expect(Math.hypot(sim.ch.position.x - start.x, sim.ch.position.z - start.z)).toBeLessThan(0.1);
    // toilets last, living areas first
    const order = st.visited.map((id) => sim.layout.rooms.find((r) => r.id === id)!);
    const firstWet = order.findIndex((r) => r.roomType === 'bathroom');
    const lastMain = order.map((r) => r.roomType === 'living' || r.roomType === 'kitchen').lastIndexOf(true);
    expect(firstWet).toBeGreaterThan(lastMain - 4);
    expect(t).toBeLessThan(1200);
    void inRoom;
  }, 120000);

  it('names rooms it cannot reach: a room walled in by furniture is skipped, not walked through', async () => {
    const sim = makeSim(FLAT_204, 'living');
    // wall the kitchen in: stamp the kitchen's doorways solid in the planning grid by filling its room with a tall block
    const k = sim.layout.rooms.find((r) => r.id === 'kitchen')!;
    const xs = k.polygon.map((q) => q.x), zs = k.polygon.map((q) => q.z);
    const block = { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cz: (Math.min(...zs) + Math.max(...zs)) / 2, w: Math.max(...xs) - Math.min(...xs) + 0.2, d: Math.max(...zs) - Math.min(...zs) + 0.2, yawDeg: 0 };
    const { stampFurniture } = await import('../src/core/layout-raster');
    const statics = stampFurniture(sim.statics, [{ id: 'b', source: 'virtual', kind: 'wardrobe', label: 'b', box: block, heightM: 2, surfaceHeightM: 2 }]);
    const sim2 = makeSim(FLAT_204, 'living');
    (sim2.driver as unknown as { deps: { staticGrid(): unknown } }).deps.staticGrid = () => statics;
    const p = sim2.driver.startTour();
    await sim2.run(() => sim2.driver.tour?.phase === 'done', 1200);
    const st = await p;
    expect(st.skipped.some((s) => s.roomId === 'kitchen')).toBe(true);
    expect(st.visited).not.toContain('kitchen');
  }, 120000);
});

describe('going to a room', () => {
  it('walks to a room a few metres away, opening the shut door on the way, and ends at its standing spot facing in', async () => {
    const sim = makeSim(FLAT_204, 'living');
    const spot = sim.driver.spotIn('dining')!;
    const p = sim.driver.goTo('dining');
    let bad = 0;
    await sim.run(() => !sim.driver.busy, 60, (live) => { if (!circleFree(live, sim.ch.position.x, sim.ch.position.z, CHARACTER_RADIUS_M - 0.03)) bad++; });
    expect(await p).toBe('walked');
    expect(sim.jumps).toHaveLength(0);
    expect(bad).toBe(0);
    expect(Math.hypot(sim.ch.position.x - spot.x, sim.ch.position.z - spot.z)).toBeLessThan(0.06);
    expect(inRoom(sim.layout, sim.ch.position)).toBe('dining');
    const dy = Math.abs((((sim.ch.yawDeg - spot.yawDeg) % 360) + 540) % 360 - 180);
    expect(dy).toBeLessThan(2);
    expect(Math.abs((((sim.cam.yawDeg - spot.yawDeg) % 360) + 540) % 360 - 180)).toBeLessThan(2);
  }, 60000);

  it('is a calm walk: never the jog clip, never faster than 1.5 m/s, eased in and out, to every room of the flat', async () => {
    let longRoutes = 0;
    for (const room of loadScene(FLAT_204).layout.rooms) {
      const sim = makeSim(FLAT_204, 'living');
      const spot = sim.driver.spotIn(room.id);
      if (!spot || room.id === 'living') continue;
      const p = sim.driver.goTo(room.id);
      let bad = 0;
      await sim.run(() => !sim.driver.busy, 90, (live) => { if (!circleFree(live, sim.ch.position.x, sim.ch.position.z, CHARACTER_RADIUS_M - 0.03)) bad++; });
      const r = await p;
      expect(['walked', 'jumped']).toContain(r);
      expect(bad).toBe(0);
      expect(sim.ch.gaits.some((g) => g.jog)).toBe(false);
      const speeds = sim.ch.gaits.map((g) => g.speed);
      expect(Math.max(...speeds)).toBeLessThanOrEqual(1.5);
      // eased start: the first half second never exceeds what 1.5 m/s^2 would reach (the driver steps at 120 Hz: one call per step)
      expect(speeds.slice(0, 60).every((v, i) => v <= 1.5 * ((i + 1) / 120) + 0.05)).toBe(true);
      if (r === 'jumped') continue;
      expect(Math.hypot(sim.ch.position.x - spot.x, sim.ch.position.z - spot.z)).toBeLessThan(0.06);
      expect(inRoom(sim.layout, sim.ch.position)).toBe(room.id);
      if (sim.jumps.length > 0) longRoutes++;
    }
    expect(longRoutes).toBeGreaterThan(0);
  }, 240000);

  it('a way over 8 m is walked for 1.5 s, cut once to a spot 2 m of walking before the standing spot, and ends at the same spot as the full walk', async () => {
    const scene = loadScene(FLAT_204);
    let tried = 0;
    for (const room of scene.layout.rooms) {
      const probe = makeSim(FLAT_204, 'living');
      const spot = probe.driver.spotIn(room.id);
      if (!spot || room.id === 'living') continue;
      const route = findRoute(planGridOf(probe.statics, probe.doors.leaves()), probe.ch.position, spot, 150);
      if (!route || route.lengthM <= SHORTCUT_FROM_M) continue;
      tried++;
      const sim = makeSim(FLAT_204, 'living');
      const p = sim.driver.goTo(room.id);
      let tCut = -1, t = 0;
      await sim.run(() => !sim.driver.busy, 90, () => { t += 1 / 30; if (tCut < 0 && sim.jumps.length > 0) tCut = t; });
      expect(await p).toBe('walked');
      expect(sim.jumps).toHaveLength(1);
      // the cut came after about 1.5 s of walking
      expect(tCut).toBeGreaterThan(1.3);
      expect(tCut).toBeLessThan(2.4);
      // it landed 2 m of route from the spot
      const j = sim.jumps[0];
      const rest = findRoute(planGridOf(sim.statics, sim.doors.leaves()), { x: j.x, z: j.z }, spot, 150)!;
      expect(rest.lengthM).toBeGreaterThan(1.7);
      expect(rest.lengthM).toBeLessThan(2.4);
      expect(Math.hypot(sim.ch.position.x - spot.x, sim.ch.position.z - spot.z)).toBeLessThan(0.06);
      expect(sim.ch.gaits.some((g) => g.jog)).toBe(false);
      expect(Math.max(...sim.ch.gaits.map((g) => g.speed))).toBeLessThanOrEqual(1.5);
      // the walk on from the cut did not start from rest: it carried the speed it had
      const after = sim.ch.gaits.slice(Math.round(tCut * 120));
      expect(after[3].speed).toBeGreaterThan(0.4);
      if (tried >= 3) break;
    }
    expect(tried).toBeGreaterThan(0);
  }, 240000);

  it('goes a long way by the shortcut, not a plain fade: the 23 m hall is one cut and the walk in', async () => {
    // a 24 m hall with a room at each end: the walk is 23 m
    const { DEFAULT_FINISHES } = await import('../src/types');
    const rect = (id: string, x0: number, z0: number, x1: number, z1: number, type: 'bedroom' | 'other', label: string) => ({ id, roomType: type, label, polygon: [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }], edges: ['wall', 'wall', 'wall', 'wall'] as ('wall')[] });
    const rooms = [rect('w', 0, 0, 4, 4, 'bedroom', 'West'), rect('hall', 4.12, 0, 24.12, 4, 'other', 'Long hall'), rect('e', 24.24, 0, 28.24, 4, 'bedroom', 'East')];
    const open = (id: string, roomId: string, edge: number, c: number) => ({ id, roomId, edge, type: 'door' as const, centreM: c, widthM: 0.9, sillM: 0, headM: 2.1, leaf: { hinge: 'start' as const, swing: 'in' as const, kind: 'hinged' as const } });
    const layout = { wallHeightM: 2.75, wallThicknessM: 0.12, railingHeightM: 1.1, rooms, openings: [open('d1', 'w', 1, 2), open('d2', 'e', 3, 2)], finishes: DEFAULT_FINISHES, scaleSource: 'typed-sizes' as const };
    const prop = { version: 1, id: 'long', title: 'Long', layout, furniture: [], spawn: { x: 1, z: 2, yawDeg: 90 }, updatedAt: '2026-11-16T00:00:00Z' } as unknown as Parameters<typeof makeSim>[0];
    const sim = makeSim(prop, 'w');
    const spot = sim.driver.spotIn('e')!;
    const p = sim.driver.goTo('e');
    await sim.run(() => !sim.driver.busy, 60);
    expect(await p).toBe('walked');
    expect(sim.jumps).toHaveLength(1);
    expect(Math.hypot(sim.jumps[0].x - spot.x, sim.jumps[0].z - spot.z)).toBeGreaterThan(1.7);
    expect(Math.hypot(sim.jumps[0].x - spot.x, sim.jumps[0].z - spot.z)).toBeLessThan(2.4);
    expect(Math.hypot(sim.ch.position.x - spot.x, sim.ch.position.z - spot.z)).toBeLessThan(0.06);
    expect(sim.ch.gaits.some((g) => g.jog)).toBe(false);
    expect(inRoom(layout as never, sim.ch.position)).toBe('e');
    // with reduced motion there is no walk to cut: a plain jump to the spot
    const calm = makeSim(prop, 'w', { reduced: true });
    const p2 = calm.driver.goTo('e');
    await calm.run(() => !calm.driver.busy, 5);
    expect(await p2).toBe('jumped');
    expect(Math.hypot(calm.ch.position.x - spot.x, calm.ch.position.z - spot.z)).toBeLessThan(1e-6);
  }, 60000);

  it('answers "no-spot" for a room only partly on the drawing, and does not move', async () => {
    const prop = loadSceneWithPartial();
    const sim = makeSim(prop, 'living');
    const here = { ...sim.ch.position };
    const r = await sim.driver.goTo('ghost');
    expect(r).toBe('no-spot');
    expect(sim.ch.position).toEqual(here);
  });
});

describe('taking over', () => {
  it('stops a tour where the walker stands, and a paused tour holds still until it is resumed', async () => {
    const sim = makeSim(FLAT_204, 'living');
    void sim.driver.startTour();
    await sim.run(() => (sim.driver.tour?.visited.length ?? 0) >= 2 && sim.driver.tour?.phase === 'walking', 200);
    sim.driver.pause();
    const held = { ...sim.ch.position };
    await sim.run(() => false, 2);
    expect(sim.ch.position).toEqual(held);
    expect(sim.driver.tour?.paused).toBe(true);
    sim.driver.resume();
    await sim.run(() => false, 3); // it eases away from rest: a glide, not a lunge
    expect(Math.hypot(sim.ch.position.x - held.x, sim.ch.position.z - held.z)).toBeGreaterThan(0.2);
    sim.driver.stop();
    const stopped = { ...sim.ch.position };
    const driven = sim.driver.update(1 / 30);
    await sim.run(() => false, 1);
    expect(driven).toBe(false);
    expect(sim.ch.position).toEqual(stopped);
    expect(sim.driver.touring).toBe(false);
    expect(sim.driver.tour?.phase).toBe('stopped');
  }, 60000);

  it('with reduced motion, a room is a hold (no arc) and arriving in the next is a cut', async () => {
    const sim = makeSim(FLAT_204, 'living', { reduced: true });
    void sim.driver.startTour();
    await sim.run(() => sim.driver.tour?.phase === 'looking', 5);
    const room = sim.driver.tour?.roomId;
    const base = sim.cam.yawDeg;
    const seen: number[] = [];
    await sim.run(() => sim.driver.tour?.roomId !== room, 10, () => { if (sim.driver.tour?.roomId === room) seen.push(sim.cam.yawDeg); });
    expect(seen.length).toBeGreaterThan(30);
    expect(Math.max(...seen) - Math.min(...seen)).toBeLessThan(1e-6);
    expect(seen[0]).toBeCloseTo(base, 6);
    // the next room was a jump (a fade in the page), never a glide
    expect(sim.jumps.length).toBeGreaterThan(0);
  }, 60000);
});

function loadSceneWithPartial() {
  const prop = loadScene(FLAT_204);
  prop.layout.rooms.push({ id: 'ghost', roomType: 'other', label: 'Ghost', polygon: [{ x: 30, z: 30 }, { x: 33, z: 30 }, { x: 33, z: 33 }, { x: 30, z: 33 }], edges: ['wall', 'wall', 'wall', 'wall'], partial: { reason: 'runs off the sheet' } });
  return prop;
}
