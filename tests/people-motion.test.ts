// Motion checks for the person bodies (motion pass of 15 Nov 2026). Headless: Character + stepLocomotion on an open floor.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_CM, fakeInput, haveBodies, measureSlide, openGrid, person } from './motion-helpers';
import { stepLocomotion } from '../src/engine/locomotion';
import type { Character } from '../src/engine/character';

type Inner = { currentClip: string | null; h0: number; actions: Record<string, THREE.AnimationAction>; skinned: THREE.SkinnedMesh[] };
const inner = (ch: Character): Inner => ch as unknown as Inner;
const bone = (ch: Character, name: string): THREE.Bone => inner(ch).skinned[0].skeleton.bones.find((b) => b.name.toLowerCase() === name)!;
const DT = 1 / 60;

describe.skipIf(!haveBodies)('walking, turning, stopping', () => {
  for (const body of ['man', 'woman', 'elder', 'child'] as const) {
    it(`${body}: a planted foot stays where it landed (net slide per step under 3 cm; it was 22 to 26 cm)`, async () => {
      const ch = await person(body);
      ch.setHeight(DEFAULT_CM[body] / 100, '#E8823A');
      ch.position = { x: -20, z: 0 };
      ch.yawDeg = 0;
      const s = measureSlide(ch, fakeInput(), 6);
      console.log(`SLIDE walk ${body} ${DEFAULT_CM[body]}cm bodySpeed ${s.bodySpeed.toFixed(2)} plantedFootSpeed mean ${s.meanSpeed.toFixed(3)} p95 ${s.p95.toFixed(3)} slip/step ${s.slipPerStepCm.toFixed(1)}cm planted ${s.planted}`);
      expect(s.planted).toBeGreaterThan(100);
      expect(s.slipPerStepCm).toBeLessThan(3);
      // and a slower push (a joystick held half way) keeps the feet down too
      const half = await person(body);
      half.setHeight(DEFAULT_CM[body] / 100, '#E8823A');
      half.position = { x: -20, z: 0 };
      const input = fakeInput();
      input.set(0, 0.5);
      const slow = measureSlide(half, input, 6);
      console.log(`SLIDE half-push ${body} bodySpeed ${slow.bodySpeed.toFixed(2)} slip/step ${slow.slipPerStepCm.toFixed(1)}cm`);
      expect(slow.slipPerStepCm).toBeLessThan(3);
    });
  }

  it('the elder walks with the slower clip and at 0.62 of the man\'s pace; the others use the walk', async () => {
    const elder = await person('elder');
    elder.setHeight(1.5, '#fff');
    elder.setLocomotion(0.8, false);
    expect(inner(elder).currentClip).toBe('walkSlow');
    const man = await person('man');
    man.setHeight(1.75, '#fff');
    man.setLocomotion(1.4, false);
    expect(inner(man).currentClip).toBe('walk');
    expect(elder.walkFactor / man.walkFactor).toBeCloseTo(0.62, 5);
  });

  it('a start eases in and a stop eases out: no jump in speed, no pop in the pose', async () => {
    const ch = await person('man');
    ch.setHeight(1.75, '#fff');
    ch.position = { x: -20, z: 0 };
    const input = fakeInput();
    const names = ['pelvis', 'head', 'spine_03', 'hand_l', 'hand_r'];
    const bones = names.map((n) => bone(ch, n));
    const rel = bones.map(() => new THREE.Vector3());
    const prev = bones.map(() => new THREE.Vector3());
    let worst = 0, worstName = '', maxStep = 0, last = 0;
    const speeds: number[] = [];
    const frame = (t: number, move: boolean): void => {
      input.set(0, move ? 1 : 0);
      const v = stepLocomotion(ch, input, 0, openGrid, DT);
      maxStep = Math.max(maxStep, Math.abs(v - last));
      last = v;
      speeds.push(v);
      ch.update(DT);
      ch.object.updateMatrixWorld(true);
      bones.forEach((b, i) => {
        b.getWorldPosition(rel[i]);
        rel[i].x -= ch.object.position.x; rel[i].z -= ch.object.position.z;
        if (t > 0) { const d = rel[i].distanceTo(prev[i]); if (d > worst) { worst = d; worstName = names[i]; } }
        prev[i].copy(rel[i]);
      });
    };
    for (let i = 0; i < 90; i++) frame(i, false);   // standing
    worst = 0;
    for (let i = 1; i <= 150; i++) frame(i, true);  // 2.5 s of walking from a standstill
    const x1 = ch.position.z;
    for (let i = 1; i <= 90; i++) frame(i, false);  // let go
    console.log(`POP worst per-frame move of ${worstName} ${(worst * 100).toFixed(1)} cm, biggest speed step ${maxStep.toFixed(3)} m/s, glide ${(ch.position.z - x1).toFixed(2)} m, clip after ${inner(ch).currentClip}`);
    expect(maxStep).toBeLessThan(0.15);                 // 4.2 m/s^2 * 1/60 s = 0.07 m/s per frame
    expect(worst).toBeLessThan(0.05);                   // hands and head never jump more than 5 cm between frames
    expect(speeds[speeds.length - 1]).toBe(0);
    expect(ch.position.z - x1).toBeGreaterThan(0.05);   // it glides a little, it does not stop dead
    expect(ch.position.z - x1).toBeLessThan(0.5);
    expect(inner(ch).currentClip).toBe('idle');
  });

  it('turning to face the other way is done on the spot, with the feet stepping, then it walks off', async () => {
    const ch = await person('man');
    ch.setHeight(1.75, '#fff');
    ch.position = { x: -20, z: 0 };
    ch.yawDeg = 0;
    const input = fakeInput();
    input.set(0, -1); // the camera looks along +z, so this is straight back
    const ball = bone(ch, 'ball_l');
    const p = new THREE.Vector3();
    let steppedFor = 0, minY = 9, maxY = -9, moved = 0;
    const z0 = ch.position.z;
    for (let i = 0; i < 40; i++) {
      stepLocomotion(ch, input, 0, openGrid, DT);
      ch.update(DT);
      ch.object.updateMatrixWorld(true);
      if (inner(ch).currentClip === 'turn') steppedFor++;
      ball.getWorldPosition(p);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      moved = Math.max(moved, Math.abs(ch.position.z - z0));
    }
    expect(steppedFor).toBeGreaterThan(8);          // the stepping clip was on while it came round
    expect(maxY - minY).toBeGreaterThan(0.03);      // and a foot really lifted
    expect(moved).toBeLessThan(0.4);                // it did not wander off before facing the way
    for (let i = 0; i < 90; i++) { stepLocomotion(ch, input, 0, openGrid, DT); ch.update(DT); }
    expect(Math.abs((((ch.yawDeg % 360) + 360) % 360) - 180)).toBeLessThan(1);
    expect(z0 - ch.position.z).toBeGreaterThan(0.5); // and walked back
    expect(inner(ch).currentClip).toBe('walk');
  });

  it('standing still the walker glances round, folds their arms, then stands again; reach lifts the hand', async () => {
    const ch = await person('woman');
    ch.setHeight(1.6, '#fff');
    const seen: string[] = [];
    for (let t = 0; t < 32; t += DT) {
      ch.setLocomotion(0, false);
      ch.update(DT);
      const c = inner(ch).currentClip!;
      if (seen[seen.length - 1] !== c) seen.push(c);
    }
    console.log('IDLES', seen.join(' > '));
    expect(seen.slice(0, 5)).toEqual(['idle', 'look', 'idle', 'fold', 'idle']);
    // reach: one hand comes up well above where it hangs
    const hands = [bone(ch, 'hand_l'), bone(ch, 'hand_r')];
    const p = new THREE.Vector3();
    ch.object.updateMatrixWorld(true);
    const rest = hands.map((h) => h.getWorldPosition(p).y);
    ch.reach();
    let rise = 0;
    for (let t = 0; t < 2.4; t += DT) { ch.setLocomotion(0, false); ch.update(DT); ch.object.updateMatrixWorld(true); hands.forEach((h, i) => { rise = Math.max(rise, h.getWorldPosition(p).y - rest[i]); }); }
    console.log(`REACH hand rose ${rise.toFixed(2)} m`);
    expect(rise).toBeGreaterThan(0.2);
    expect(inner(ch).currentClip).toBe('idle');
  });

  it('the eyes are where the head is: a believable eye height for each person', async () => {
    for (const body of ['man', 'woman', 'elder', 'child'] as const) {
      const ch = await person(body);
      ch.setHeight(DEFAULT_CM[body] / 100, '#fff');
      const H = DEFAULT_CM[body] / 100;
      const e = ch.eyePosition(new THREE.Vector3());
      console.log(`EYES ${body} ${DEFAULT_CM[body]} cm: eye height ${e.y.toFixed(3)} m (${(e.y / H).toFixed(3)} of height)`);
      expect(e.y / H).toBeGreaterThan(0.86);
      expect(e.y / H).toBeLessThan(0.97);
      expect(ch.eyeHeightM).toBeCloseTo(e.y, 1);
    }
  });
});
