// A walker, a camera and a set of doors without a browser: the auto-walk's Driver runs on these against a real layout, frame by frame.
import fs from 'node:fs';
import path from 'node:path';
import { Driver } from '../../src/buyer/nav/driver';
import type { DriverDeps } from '../../src/buyer/nav/driver';
import { leafObstacle, resolveDoors, freePos } from '../../src/core/doors';
import type { Door } from '../../src/core/doors';
import { rasterizeLayout, stampFurniture } from '../../src/core/layout-raster';
import { validateProperty } from '../../src/core/layout-validate';
import { chooseSpawn } from '../../src/core/spawn';
import { circleFree } from '../../src/core/grid-query';
import { roomAt } from '../../src/core/layout-geom';
import type { Grid, Layout, PropertyFile, Vec2 } from '../../src/types';

export function loadScene(id: string): PropertyFile {
  const file = path.join(__dirname, '..', '..', 'public', 'scenes', id, 'property.json');
  return validateProperty(JSON.parse(fs.readFileSync(file, 'utf8')));
}

const obstacleItem = (id: string, o: ReturnType<typeof leafObstacle>) => ({
  id, source: 'virtual' as const, kind: 'wardrobe' as const, label: 'door leaf', box: o.box, heightM: o.heightM, surfaceHeightM: o.heightM,
});

export class DoorSim {
  readonly doors: Door[];
  readonly pos = new Map<string, number>();
  private target = new Map<string, number>();
  private waiters = new Map<string, (() => void)[]>();
  opened: string[] = [];
  constructor(private readonly layout: Layout, private readonly statics: Grid, startOpen: (d: Door) => boolean = () => false) {
    this.doors = resolveDoors(layout);
    for (const d of this.doors) this.pos.set(d.id, startOpen(d) ? freePos(statics, d, 0).pos : 0);
  }
  leaves() { return this.doors.map((door) => ({ door, pos: this.pos.get(door.id) as number })); }
  open(id: string): Promise<void> {
    const d = this.doors.find((x) => x.id === id);
    if (!d) return Promise.resolve();
    // like the real door: it opens as far as the walls and furniture let it, a leaf already there stays
    const to = Math.max(this.pos.get(id) as number, freePos(this.statics, d, 0).pos);
    this.target.set(id, to);
    this.opened.push(id);
    if (Math.abs(to - (this.pos.get(id) as number)) < 1e-9) return Promise.resolve();
    return new Promise((res) => { this.waiters.set(id, [...(this.waiters.get(id) ?? []), res]); });
  }
  update(dt: number): void {
    for (const [id, to] of this.target) {
      const p = this.pos.get(id) as number;
      const d = this.doors.find((x) => x.id === id) as Door;
      const speed = (d.kind === 'sliding' ? Math.max(0.5, d.maxPos) : Math.PI / 2) / 0.5;
      const next = p < to ? Math.min(to, p + speed * dt) : Math.max(to, p - speed * dt);
      this.pos.set(id, next);
      if (Math.abs(next - to) < 1e-9) { this.target.delete(id); for (const w of this.waiters.get(id) ?? []) w(); this.waiters.delete(id); }
    }
  }
  /** the leaves as obstacles on `grid` */
  stamp(grid: Grid): Grid {
    return stampFurniture(grid, this.doors.map((d, i) => obstacleItem(`leaf:${i}`, leafObstacle(d, this.pos.get(d.id) as number))));
  }
}

export interface Sim {
  driver: Driver;
  layout: Layout;
  doors: DoorSim;
  ch: { position: Vec2; yawDeg: number; moving: number };
  cam: { yawDeg: number };
  statics: Grid;
  /** runs frames until `until()` or `maxS` seconds; calls `each` after every frame */
  run(until: () => boolean, maxS: number, each?: (live: Grid) => void): Promise<number>;
  jumps: { x: number; z: number; yawDeg: number }[];
  positions: Vec2[];
}

export function makeSim(scene: string | PropertyFile, startRoom: string, opts: { startOpen?: (d: Door) => boolean; reduced?: boolean } = {}): Sim {
  const prop = typeof scene === 'string' ? loadScene(scene) : scene;
  const layout = prop.layout;
  const statics = stampFurniture(rasterizeLayout(layout), prop.furniture);
  const doors = new DoorSim(layout, statics, opts.startOpen);
  const spawn = chooseSpawn(layout, startRoom, statics);
  if (!spawn) throw new Error(`no spawn in ${startRoom}`);
  const ch = { position: { x: spawn.x, z: spawn.z }, yawDeg: spawn.yawDeg, moving: 0, setLocomotion(speed: number) { this.moving = speed; } };
  const cam = { yawDeg: spawn.yawDeg };
  const jumps: Sim['jumps'] = [];
  let live = doors.stamp(statics);
  const deps: DriverDeps = {
    layout, character: ch, camera: cam,
    staticGrid: () => statics,
    liveGrid: () => live,
    leaves: () => doors.leaves(),
    openDoor: (id) => doors.open(id),
    jump: async (to) => { jumps.push(to); ch.position = { x: to.x, z: to.z }; ch.yawDeg = to.yawDeg; cam.yawDeg = to.yawDeg; },
    reducedMotion: () => !!opts.reduced,
  };
  const driver = new Driver(deps);
  const positions: Vec2[] = [];
  const sim: Sim = {
    driver, layout, doors, ch, cam, statics, jumps, positions,
    async run(until, maxS, each) {
      const dt = 1 / 30;
      let t = 0;
      while (!until() && t < maxS) {
        doors.update(dt);
        live = doors.stamp(statics);
        driver.update(dt);
        for (let k = 0; k < 4; k++) await Promise.resolve();
        positions.push({ x: ch.position.x, z: ch.position.z });
        each?.(live);
        t += dt;
      }
      return t;
    },
  };
  return sim;
}

export const inRoom = (layout: Layout, p: Vec2): string | null => roomAt(layout, p)?.id ?? null;
export { circleFree };
