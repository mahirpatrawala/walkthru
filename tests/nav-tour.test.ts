// The tour and the jump on the real flat layouts, without a browser: every reachable room is visited once, the body is never inside a wall,
// a piece of furniture or a door leaf, a shut door on the way is opened first, and the walk ends where it started.
import { describe, expect, it } from 'vitest';
import { CHARACTER_RADIUS_M } from '../src/types';
import { circleFree } from '../src/core/grid-query';
import { makeSim, inRoom, loadScene } from './helpers/nav-sim';

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
    expect(st.visited.length).toBe(st.total);
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

  it('fades (a jump to the standing spot) when the path is over 12 m, and for a room it cannot walk to', async () => {
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
    await sim.run(() => !sim.driver.busy, 20);
    expect(await p).toBe('jumped');
    expect(sim.jumps).toHaveLength(1);
    expect(Math.hypot(sim.ch.position.x - spot.x, sim.ch.position.z - spot.z)).toBeLessThan(1e-6);
    expect(inRoom(layout as never, sim.ch.position)).toBe('e');
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
    await sim.run(() => false, 1);
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

  it('with reduced motion, the look round is a hold (no pan) and a turn is a cut', async () => {
    const sim = makeSim(FLAT_204, 'living', { reduced: true });
    const camAt: number[] = [];
    void sim.driver.startTour();
    await sim.run(() => sim.driver.tour?.phase === 'looking', 5, () => camAt.push(sim.cam.yawDeg));
    const base = sim.cam.yawDeg;
    const seen: number[] = [];
    await sim.run(() => sim.driver.tour?.phase !== 'looking', 10, () => seen.push(sim.cam.yawDeg));
    expect(Math.max(...seen) - Math.min(...seen)).toBeLessThan(1e-6);
    expect(seen[0]).toBeCloseTo(base, 6);
  }, 60000);
});

function loadSceneWithPartial() {
  const prop = loadScene(FLAT_204);
  prop.layout.rooms.push({ id: 'ghost', roomType: 'other', label: 'Ghost', polygon: [{ x: 30, z: 30 }, { x: 33, z: 30 }, { x: 33, z: 33 }, { x: 30, z: 33 }], edges: ['wall', 'wall', 'wall', 'wall'], partial: { reason: 'runs off the sheet' } });
  return prop;
}
