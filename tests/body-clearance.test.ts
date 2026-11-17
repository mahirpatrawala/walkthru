// SPEC 4.12 on the real thing: person bodies with the shipped clips walk into every wall of every room of Flat 204 (a 3 BHK) and of a 2 BHK from
// several angles, along walls, into shut doors, frame posts and furniture, and every vertex of the drawn skin is checked against the drawn walls
// (the 1 cm truth map of tests/helpers/body-sim.ts), not against the grid the engine uses. No browser.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
const { Vector3 } = THREE;
import { DEFAULT_CM, fakeInput, haveBodies, person } from './motion-helpers';
import { DoorSim, loadScene, makeSim } from './helpers/nav-sim';
import { bodyPenetration, bonePenetration, truthOf } from './helpers/body-sim';
import type { Truth } from './helpers/body-sim';
import { stepLocomotion, resetLocomotion } from '../src/engine/locomotion';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { bodyGridOf, resolveDoors } from '../src/core/doors';
import { doorway } from '../src/buyer/nav/door-route';
import { circleFree } from '../src/core/grid-query';
import { pointInPolygon } from '../src/core/geometry';
import { CHARACTER_RADIUS_M } from '../src/types';
import type { Grid } from '../src/types';
import type { Character } from '../src/engine/character';
import type { PersonBody } from '../src/look/people';

const FLAT_204 = 'test-tower-flat-3bhk-a';
const TWO_BHK = 'test-tower-flat-2bhk-b2';
const BODIES: PersonBody[] = ['man', 'woman', 'elder', 'child'];
const DT = 1 / 30;

/** The most any vertex of the skin may be past a wall face, a frame post or a shut leaf, metres (the skin is drawn; the walls are the 1 cm map). Worst measured with the guard: 5.6 cm, a trouser leg at a WC for one frame (the guard's own margin is 6 cm). */
const SKIN_TOL_M = 0.06;
/** The most a named bone (a joint centre, 4 to 10 cm inside the skin) may be past one. Worst measured: 2.6 cm (the head at the frame post of a 2 m slider). */
const BONE_TOL_M = 0.03;
/** A walker pushed into something is standing in the upright idle (walk clip weight under 5 %) this long after it stopped moving, seconds. */
const BLOCKED_IDLE_S = 0.6;

/** the measured numbers go to the file named by CLEARANCE_LOG when it is set (vitest keeps console output from a passing test) */
const log = (line: string): void => { if (process.env.CLEARANCE_LOG) fs.appendFileSync(process.env.CLEARANCE_LOG, line); };

type Inner = { actions: Record<string, THREE.AnimationAction>; currentClip: string | null };

interface Rig { tr: Truth; grid: Grid; body: Grid; layout: ReturnType<typeof loadScene>['layout']; people: Record<PersonBody, Character>; doors: DoorSim; statics: Grid }

async function rig(scene: string, guard = true): Promise<Rig> {
  const prop = loadScene(scene);
  const statics = stampFurniture(rasterizeLayout(prop.layout), prop.furniture);
  const doors = new DoorSim(prop.layout, statics);
  const grid = doors.stamp(statics);
  const body = bodyGridOf(prop.layout)(grid);
  const people = {} as Record<PersonBody, Character>;
  for (const b of BODIES) {
    people[b] = await person(b);
    people[b].setHeight(DEFAULT_CM[b] / 100, '#fff');
    if (guard) people[b].setBodyGuard(() => body);
  }
  return { tr: truthOf(prop), grid, body, layout: prop.layout, people, doors, statics };
}

interface Run { depth: number; boneDepth: number; note: string; stoppedAt: number; stoodAt: number; /** worst skin depth by what it was in: wall, through wall, post, leaf, furniture */ kinds: Record<string, number>; /** the most the drawn body's shift from the collision spot changed in one frame, metres, and the most the drawn root moved in one frame */ shiftStep: number; drawnStep: number; shiftNote?: string }

/** Puts `ch` at `start` facing `headingDeg` (0 = +z) pushing the stick that way for `frames` frames; reports the worst penetration of skin and bones. */
function drive(r: Rig, ch: Character, start: { x: number; z: number }, hx: number, hz: number, jog: boolean, frames: number, tag: string): Run {
  resetLocomotion(ch);
  ch.position = { ...start };
  ch.yawDeg = Math.atan2(hx, hz) * 180 / Math.PI;
  (ch as unknown as { guard: { reset(): void } }).guard.reset();
  const input = fakeInput();
  input.set(-hx, hz, jog);
  const worst: Run = { depth: 0, boneDepth: 0, note: '', stoppedAt: -1, stoodAt: -1, kinds: {}, shiftStep: 0, drawnStep: 0 };
  const inner = ch as unknown as Inner;
  const speeds: number[] = [], gait: number[] = [];
  let prevShift = { x: 0, z: 0 }, prevDrawn = { x: start.x, z: start.z };
  for (let i = 0; i < frames; i++) {
    const v = stepLocomotion(ch, input, 0, r.grid, DT);
    ch.update(DT);
    speeds.push(v);
    {
      const f = ch.bodyFit;
      const drawn = { x: ch.position.x + f.shiftX, z: ch.position.z + f.shiftZ };
      if (i > 0) { const ss = Math.hypot(f.shiftX - prevShift.x, f.shiftZ - prevShift.z); if (ss > worst.shiftStep) worst.shiftNote = `${tag} i${i} pos ${ch.position.x.toFixed(2)},${ch.position.z.toFixed(2)} v${v.toFixed(2)} resid ${f.residualM.toFixed(3)} stance ${f.stance.toFixed(2)}`; worst.shiftStep = Math.max(worst.shiftStep, ss); worst.drawnStep = Math.max(worst.drawnStep, Math.hypot(drawn.x - prevDrawn.x, drawn.z - prevDrawn.z)); }
      prevShift = { x: f.shiftX, z: f.shiftZ }; prevDrawn = drawn;
    }
    gait.push(Object.entries(inner.actions).filter(([k]) => /^(walk|walkSlow|jog)$/.test(k)).reduce((a, [, act]) => a + (act.isRunning() ? act.getEffectiveWeight() : 0), 0));
    if (i % 2) continue;
    const h = bodyPenetration(ch, r.tr, { stride: 6 });
    if (h.depth > 0) { const k = h.what.split(' ')[0] === 'through' ? 'through-wall' : h.what.split(' ')[0]; worst.kinds[k] = Math.max(worst.kinds[k] ?? 0, h.depth); }
    if (h.depth > worst.depth) { worst.depth = h.depth; worst.note = `${tag} t${(i * DT).toFixed(2)} ${h.what} ${h.mesh}@${h.at.map((q) => q.toFixed(2))} pos ${ch.position.x.toFixed(2)},${ch.position.z.toFixed(2)} clip ${inner.currentClip}`; }
    const b = bonePenetration(ch, r.tr);
    if (b.depth > worst.boneDepth) { worst.boneDepth = b.depth; if (!worst.note) worst.note = `${tag} bone ${b.bone} ${b.what}`; }
  }
  // a walker that is still stopped at the end of the run (pushed into something): when it stopped, and when the gait clips were out of the mix
  let first = frames;
  while (first > 0 && speeds[first - 1] < 0.02) first--;
  if ((frames - first) * DT >= BLOCKED_IDLE_S + 0.1) {
    worst.stoppedAt = first * DT;
    const k = gait.findIndex((w, i) => i >= first && w < 0.05);
    worst.stoodAt = k < 0 ? -1 : k * DT;
  }
  return worst;
}

/** From a spot `d` m in from the middle of each wall of each room, walking at it at the given angles off the wall's normal. */
function* wallRuns(r: Rig, angles: [number, boolean][], fractions: (len: number) => number[]): Generator<{ tag: string; start: { x: number; z: number }; hx: number; hz: number; jog: boolean }> {
  for (const room of r.layout.rooms) {
    const poly = room.polygon;
    for (let e = 0; e < poly.length; e++) {
      const a = poly[e], b = poly[(e + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.3) continue;
      const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
      let n = { x: -dir.z, z: dir.x };
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      if (!pointInPolygon({ x: mid.x + n.x * 0.05, z: mid.z + n.z * 0.05 }, poly)) n = { x: -n.x, z: -n.z };
      for (const f of fractions(len)) {
        const at0 = { x: a.x + dir.x * len * f, z: a.z + dir.z * len * f };
        let start: { x: number; z: number } | null = null;
        for (const d of [0.8, 0.6, 0.45, 0.32]) {
          const p = { x: at0.x + n.x * d, z: at0.z + n.z * d };
          if (circleFree(r.grid, p.x, p.z, CHARACTER_RADIUS_M)) { start = p; break; }
        }
        if (!start) continue;
        for (const [ang, jog] of angles) {
          const rad = ang * Math.PI / 180;
          yield { tag: `${room.id} e${e} f${f} ang${ang}${jog ? ' jog' : ''}`, start, hx: -n.x * Math.cos(rad) + n.z * Math.sin(rad), hz: -n.z * Math.cos(rad) - n.x * Math.sin(rad), jog };
        }
      }
    }
  }
}

const describeBodies = haveBodies ? describe : describe.skip;

describeBodies('the drawn body keeps clear of walls, frames, leaves and furniture (SPEC 4.12)', () => {
  for (const scene of [FLAT_204, TWO_BHK]) {
    it(`${scene}: walking into every wall of every room from several angles, the skin and bones stay out; a stopped walker is in the upright idle`, async () => {
      const r = await rig(scene);
      let n = 0, worstSkin = 0, worstBone = 0, worstNote = '', slowStop = 0;
      const kinds: Record<string, number> = {};
      const bad: string[] = [];
      let shiftStep = 0, drawnStep = 0;
      for (const run of wallRuns(r, [[0, false], [40, false], [-40, false], [70, true]], (len) => (len > 2.4 ? [0.25, 0.75] : [0.5]))) {
        const body = BODIES[n % BODIES.length];
        n++;
        const out = drive(r, r.people[body], run.start, run.hx, run.hz, run.jog, 60, `${body} ${run.tag}`);
        if (out.depth > worstSkin) { worstSkin = out.depth; worstNote = out.note; }
        worstBone = Math.max(worstBone, out.boneDepth);
        shiftStep = Math.max(shiftStep, out.shiftStep); drawnStep = Math.max(drawnStep, out.drawnStep);
        for (const [k, v] of Object.entries(out.kinds)) kinds[k] = Math.max(kinds[k] ?? 0, v);
        if (out.depth > SKIN_TOL_M) bad.push(`${(out.depth * 100).toFixed(1)}cm ${out.note}`);
        // a walker that came to a stop at a wall stands up straight within BLOCKED_IDLE_S
        if (out.stoppedAt >= 0 && (out.stoodAt < 0 || out.stoodAt - out.stoppedAt > BLOCKED_IDLE_S)) slowStop++;
      }
      log(`CLEARANCE ${scene} runs ${n} worst skin ${(worstSkin * 100).toFixed(1)} cm, worst bone ${(worstBone * 100).toFixed(1)} cm, by kind ${JSON.stringify(Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, +(v * 100).toFixed(1)])))} ${worstNote}\n`);
      log(`max shift change per frame ${(shiftStep * 100).toFixed(1)} cm, max drawn-root step per frame ${(drawnStep * 100).toFixed(1)} cm\n`);
      log(`${bad.length} runs over tolerance\n${bad.sort().reverse().join('\n')}\n`);
      expect(n).toBeGreaterThan(60);
      expect(worstSkin, worstNote).toBeLessThanOrEqual(SKIN_TOL_M);
      expect(worstBone).toBeLessThanOrEqual(BONE_TOL_M);
      expect(slowStop).toBe(0);
      // no popping: the drawn body's shift from the collision spot grows by 5 cm a frame at most (30 fps), and the drawn root, walking included, never steps 10 cm
      expect(shiftStep).toBeLessThanOrEqual(0.0505);
      expect(drawnStep).toBeLessThanOrEqual(0.1);
    }, 900000);
  }

  it('Flat 204: into each shut door head on and at its frame post, in every body, nothing is drawn through the leaf, the post or the wall', async () => {
    const r = await rig(FLAT_204);
    const doors = resolveDoors(r.layout);
    let worst = 0, worstNote = '', n = 0;
    for (const d of doors) {
      const w = doorway(d);
      const mid = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 };
      for (const side of [1, -1]) {
        for (const [u, label] of [[0.5, 'leaf'], [0.04, 'post'], [0.96, 'post']] as [number, string][]) {
          const aim = { x: w.a.x + (w.b.x - w.a.x) * u, z: w.a.z + (w.b.z - w.a.z) * u };
          const start = { x: mid.x + d.out.x * side * 0.85, z: mid.z + d.out.z * side * 0.85 };
          if (!circleFree(r.grid, start.x, start.z, CHARACTER_RADIUS_M)) continue;
          const len = Math.hypot(aim.x - start.x, aim.z - start.z);
          const body = BODIES[n % BODIES.length];
          n++;
          const out = drive(r, r.people[body], start, (aim.x - start.x) / len, (aim.z - start.z) / len, false, 60, `${body} ${d.id} ${label} side${side}`);
          if (out.depth > worst) { worst = out.depth; worstNote = out.note; }
          expect(out.boneDepth, out.note).toBeLessThanOrEqual(BONE_TOL_M);
        }
      }
    }
    log(`CLEARANCE doors runs ${n} worst skin ${(worst * 100).toFixed(1)} cm ${worstNote}\n`);
    expect(n).toBeGreaterThan(30);
    // 7 cm here, not 5: the head-on run at the end post of the 2 m balcony slider squeezes the body between the jamb wall and the shut leaf (6.0 cm)
    expect(worst, worstNote).toBeLessThanOrEqual(0.07);
  }, 900000);

  it('every door of both flats is passable by every body, standing in the opening at the narrowest (0.62 m) with the skin clear, and every room is reachable', async () => {
    for (const scene of [FLAT_204, TWO_BHK]) {
      const r = await rig(scene);
      // doors open: the leaves swung away
      const prop = loadScene(scene);
      const open = new DoorSim(prop.layout, r.statics, () => true);
      for (let i = 0; i < 40; i++) open.update(0.1);
      const grid = open.stamp(r.statics);
      const body = bodyGridOf(prop.layout)(grid);
      let narrowest = Infinity;
      for (const d of resolveDoors(r.layout)) {
        const w = doorway(d);
        narrowest = Math.min(narrowest, d.u1 - d.u0);
        const mid = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 };
        for (const b of BODIES) {
          const ch = r.people[b];
          ch.setBodyGuard(() => body);
          for (const side of [1, -1]) {
            // walk from 1 m on one side to 1 m on the other, through the middle of the doorway
            const start = { x: mid.x + d.out.x * side * 1.0, z: mid.z + d.out.z * side * 1.0 };
            const end = { x: mid.x - d.out.x * side * 1.0, z: mid.z - d.out.z * side * 1.0 };
            if (!circleFree(grid, start.x, start.z, CHARACTER_RADIUS_M) || !circleFree(grid, end.x, end.z, CHARACTER_RADIUS_M)) continue;
            resetLocomotion(ch);
            ch.position = { ...start };
            ch.yawDeg = Math.atan2(-d.out.x * side, -d.out.z * side) * 180 / Math.PI;
            (ch as unknown as { guard: { reset(): void } }).guard.reset();
            const input = fakeInput();
            input.set(d.out.x * side, -d.out.z * side, false);
            let through = false;
            for (let i = 0; i < 150 && !through; i++) {
              stepLocomotion(ch, input, 0, grid, DT);
              ch.update(DT);
              through = Math.hypot(ch.position.x - end.x, ch.position.z - end.z) < 0.45;
              if (i % 3 === 0) {
                const near = Math.hypot(ch.position.x - mid.x, ch.position.z - mid.z) < 0.7;
                if (near) {
                  const h = bodyPenetration(ch, { ...r.tr, doors: [] }, { stride: 8, furniture: false });
                  expect(h.depth, `${scene} ${d.id} ${b} side ${side} ${h.what}`).toBeLessThanOrEqual(SKIN_TOL_M);
                }
              }
            }
            expect(through, `${scene} ${d.id} (${(d.u1 - d.u0).toFixed(2)} m) ${b} side ${side} did not get through`).toBe(true);
          }
          ch.setBodyGuard(() => r.body);
        }
      }
      log(`${scene} narrowest door clear of its posts ${narrowest.toFixed(2)} m\n`);
      expect(narrowest).toBeLessThan(0.8);
      // every room can be walked to from the first: the planner's own route on the body-radius lattice, over the drawing's walls and furniture (the leaves are
      // opened on the way, as the go-to does)
      const { findRoute } = await import('../src/buyer/nav/grid-path');
      const { chooseSpawn } = await import('../src/core/spawn');
      const first = r.layout.rooms[0];
      const from = chooseSpawn(r.layout, first.id, r.statics)!;
      for (const room of r.layout.rooms) {
        const spot = chooseSpawn(r.layout, room.id, r.statics);
        if (!spot || room.partial) continue;
        // the planner has never found a way to a balcony or deck behind a slider (SPEC 2.6: the tour names the Balcony as not reachable); the walk through the slider is tested above
        if (/balcony|deck/i.test(room.id)) continue;
        expect(findRoute(r.statics, from, spot), `${scene}: no way to ${room.id}`).not.toBeNull();
      }
    }
  }, 900000);

  it('a walker pushed into a wall and into a shut door stands in the idle within BLOCKED_IDLE_S, and leans no more than upright idles do', async () => {
    const r = await rig(FLAT_204);
    for (const b of BODIES) {
      const ch = r.people[b];
      const door = resolveDoors(r.layout).find((d) => d.id === 'door-bedroom-2');
      expect(door).toBeTruthy();
      const w = doorway(door!);
      const mid = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 };
      const start = { x: mid.x + door!.out.x * 0.9, z: mid.z + door!.out.z * 0.9 };
      const out = drive(r, ch, start, -door!.out.x, -door!.out.z, false, 90, `${b} door`);
      expect(out.stoppedAt).toBeGreaterThan(0);
      expect(out.stoodAt).toBeGreaterThan(0);
      expect(out.stoodAt - out.stoppedAt).toBeLessThanOrEqual(BLOCKED_IDLE_S);
      expect(out.depth, out.note).toBeLessThanOrEqual(SKIN_TOL_M);
    }
  }, 300000);
});

describeBodies('standing still in a tight place, in every standing clip', () => {
  it('idle, folded arms, look-around, reach and the stepping turn, in a 1 m passage and at every wall of it, in every body: skin and bones stay out', async () => {
    const r = await rig(FLAT_204);
    const passage = r.layout.rooms.find((q) => q.id === 'passage-b')!;
    const xs = passage.polygon.map((q) => q.x), zs = passage.polygon.map((q) => q.z);
    const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(1.1);
    let worst = 0, worstBone = 0, worstNote = '', n = 0;
    for (const b of BODIES) {
      const ch = r.people[b];
      const inner = ch as unknown as Inner & { play(key: string, fade: number, restart?: boolean): THREE.AnimationAction; reach(): void };
      for (const yaw of [0, 45, 90, 180, 270]) {
        for (const clip of ['idle', 'fold', 'look', 'reach', 'turn']) {
          if (!inner.actions[clip]) continue;
          resetLocomotion(ch);
          ch.position = { ...mid };
          ch.yawDeg = yaw;
          (ch as unknown as { guard: { reset(): void } }).guard.reset();
          ch.setLocomotion(0, false);
          inner.play(clip, 0.1, true);
          for (let i = 0; i < 45; i++) {
            ch.update(DT);
            if (i % 5) continue;
            const h = bodyPenetration(ch, r.tr, { stride: 8 });
            const bn = bonePenetration(ch, r.tr);
            n++;
            if (h.depth > worst) { worst = h.depth; worstNote = `${b} yaw ${yaw} ${clip} t${(i * DT).toFixed(2)} ${h.what} ${h.mesh}@${h.at.map((q) => q.toFixed(2))}`; }
            worstBone = Math.max(worstBone, bn.depth);
          }
        }
      }
    }
    log(`CLEARANCE standing clips samples ${n} worst skin ${(worst * 100).toFixed(1)} cm, worst bone ${(worstBone * 100).toFixed(1)} cm ${worstNote}\n`);
    expect(n).toBeGreaterThan(200);
    expect(worst, worstNote).toBeLessThanOrEqual(SKIN_TOL_M);
    expect(worstBone).toBeLessThanOrEqual(BONE_TOL_M);
  }, 600000);
});

describeBodies('the points the guard checks are the drawn skin', () => {
  it('every probe sits on a vertex of the body as drawn, in a walk, a jog and an idle (not carried rigidly by one bone)', async () => {
    for (const b of ['man', 'woman', 'child'] as PersonBody[]) {
      const ch = await person(b);
      ch.setHeight(DEFAULT_CM[b] / 100, '#fff');
      const inner = ch as unknown as { skinned: THREE.SkinnedMesh[]; guard: { probes: { refs: { bone: THREE.Bone; inv: THREE.Matrix4; w: number }[]; base: THREE.Vector3 }[] } };
      for (const [speed, jog] of [[0, false], [1.3, false], [3.2, true]] as [number, boolean][]) {
        for (let i = 0; i < 40; i++) { ch.setLocomotion(speed, jog); ch.update(1 / 30); }
        ch.object.updateMatrixWorld(true);
        const drawn: THREE.Vector3[] = [];
        for (const s of inner.skinned) for (let k = 0; k < s.geometry.attributes.position.count; k++) drawn.push(s.getVertexPosition(k, new Vector3()).applyMatrix4(s.matrixWorld));
        let worst = 0;
        const v = new Vector3(), w = new Vector3();
        for (const pr of inner.guard.probes) {
          v.set(0, 0, 0);
          for (const r of pr.refs) v.addScaledVector(w.copy(pr.base).applyMatrix4(r.inv).applyMatrix4(r.bone.matrixWorld), r.w);
          let d = Infinity;
          for (const q of drawn) d = Math.min(d, q.distanceToSquared(v));
          worst = Math.max(worst, Math.sqrt(d));
        }
        expect(worst, `${b} ${speed} m/s`).toBeLessThan(0.002);
      }
    }
  }, 300000);
});

describeBodies('the go-to and the tour walk the real body with the same clearance', () => {
  it('going to five rooms of Flat 204 in two bodies (every door shut), the drawn skin is never past a wall, frame post or leaf, and the walk ends on the standing spot', async () => {
    const prop = loadScene(FLAT_204);
    const tr = truthOf(prop);
    const post = bodyGridOf(prop.layout);
    let worst = 0, worstNote = '', n = 0;
    for (const body of ['man', 'elder'] as PersonBody[]) {
      for (const room of ['bedroom-2', 'master-bedroom', 'toilet-2', 'kitchen', 'utility']) {
        const ch = await person(body);
        ch.setHeight(DEFAULT_CM[body] / 100, '#fff');
        let live: Grid | null = null;
        ch.setBodyGuard(() => (live ? post(live) : null));
        const sim = makeSim(FLAT_204, 'living', { character: ch as never });
        const spot = sim.driver.spotIn(room)!;
        const p = sim.driver.goTo(room);
        let frame = 0;
        await sim.run(() => !sim.driver.busy, 120, (g) => {
          live = g;
          ch.update(1 / 30);
          if (frame++ % 3) return;
          const h = bodyPenetration(ch, { ...tr, doors: [] }, { stride: 10, furniture: false });
          n++;
          // door leaves are checked against where this sim has them, in the grid: only the walls and posts are asked of the truth map here
          if (h.depth > worst) { worst = h.depth; worstNote = `${body} -> ${room} ${h.what} ${h.mesh}@${h.at.map((q) => q.toFixed(2))} pos ${ch.position.x.toFixed(2)},${ch.position.z.toFixed(2)}`; }
        });
        expect(['walked', 'jumped']).toContain(await p);
        if (sim.jumps.length === 0) expect(Math.hypot(ch.position.x - spot.x, ch.position.z - spot.z)).toBeLessThan(0.08);
        ch.dispose();
      }
    }
    log(`CLEARANCE go-to samples ${n} worst skin ${(worst * 100).toFixed(1)} cm ${worstNote}\n`);
    expect(n).toBeGreaterThan(200);
    expect(worst, worstNote).toBeLessThanOrEqual(SKIN_TOL_M);
  }, 900000);
});

describe('what was tested has teeth: without the guard the same walk goes through the wall', () => {
  it('the unguarded man walking into a wall of Flat 204 is drawn more than 5 cm into it', async () => {
    if (!haveBodies) return;
    const r = await rig(FLAT_204, false);
    let worst = 0;
    let n = 0;
    for (const run of wallRuns(r, [[0, false]], () => [0.5])) {
      if (n++ % 3) continue;
      const out = drive(r, r.people.man, run.start, run.hx, run.hz, false, 45, run.tag);
      worst = Math.max(worst, out.depth);
      if (worst > 0.05) break;
    }
    expect(worst).toBeGreaterThan(0.05);
  }, 300000);
});
