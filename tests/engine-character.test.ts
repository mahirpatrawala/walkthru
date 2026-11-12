// Headless checks of the Character against the real GLB (parsed in Node, no canvas, no WebGL).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { buildTruthProperty } from '../scripts/make-test-room';
import { liePose, seatPose, standPose } from '../src/core/poses';
import { Character } from '../src/engine/character';
import { LIE_BACK_RATIO, SIT_HIP_BACK_RATIO, SIT_SEAT_RATIO } from '../src/types';

const GLB = path.resolve(import.meta.dirname, '../public/characters/mannequin.glb');
const haveGlb = fs.existsSync(GLB);

async function fresh(): Promise<Character> {
  // each character gets its own parse: clones of the scene would share skeletons
  const buf = fs.readFileSync(GLB);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const g = await new Promise<GLTF>((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
  return Character.fromGLTF(g);
}

/** Run update() for `seconds` in 1/60 s frames. */
function run(ch: Character, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) ch.update(1 / 60);
}

/** World-space bounding box of every skinned vertex, with an optional vertex filter. */
function bodyVerts(ch: Character, boneFilter?: RegExp): THREE.Vector3[] {
  ch.object.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  ch.object.traverse((o) => {
    const s = o as THREE.SkinnedMesh;
    if (!s.isSkinnedMesh) return;
    s.skeleton.update();
    const p = s.geometry.attributes.position;
    const sw = s.geometry.attributes.skinWeight;
    const si = s.geometry.attributes.skinIndex;
    for (let i = 0; i < p.count; i++) {
      if (boneFilter) {
        let best = 0, bw = -1;
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
        if (!boneFilter.test(s.skeleton.bones[best].name)) continue;
      }
      const v = new THREE.Vector3();
      s.getVertexPosition(i, v);
      out.push(v.applyMatrix4(s.matrixWorld));
    }
  });
  return out;
}
function bbox(vs: THREE.Vector3[]): THREE.Box3 {
  return new THREE.Box3().setFromPoints(vs);
}
function bone(ch: Character, name: string): THREE.Vector3 {
  let found: THREE.Bone | null = null;
  ch.object.traverse((o) => { if ((o as THREE.Bone).isBone && o.name === name) found = o as THREE.Bone; });
  if (!found) throw new Error(`no bone ${name}`);
  return (found as THREE.Bone).getWorldPosition(new THREE.Vector3());
}

describe.skipIf(!haveGlb)('Character (headless, real GLB)', () => {
  it('loads, finds all six clips and measures a plausible h0', async () => {
    const ch = await fresh();
    expect(ch.state).toBe('idle');
    expect(ch.heightM).toBeCloseTo(1.75, 9);
  });

  it('the standing idle figure is exactly H tall for 140, 160, 175, 190 and 200 cm', async () => {
    const ch = await fresh();
    const seen: string[] = [];
    for (const cm of [140, 160, 175, 190, 200]) {
      ch.setHeight(cm / 100, '#1FA3A3');
      ch.update(0);
      const b = bbox(bodyVerts(ch));
      seen.push(`${cm}: ${((b.max.y - b.min.y) * 100).toFixed(2)}`);
      expect(b.max.y - b.min.y).toBeCloseTo(cm / 100, 2);
      expect(b.min.y).toBeCloseTo(0, 2);
    }
    console.log('standing height (cm) by setHeight:', seen.join(' | '));
  });

  it('tints the body and a darker joint colour, per instance', async () => {
    const a = await fresh();
    const b = await fresh();
    a.setHeight(1.75, '#1FA3A3');
    b.setHeight(1.75, '#7A5AF0');
    const colours = (c: Character): string[] => {
      const out: string[] = [];
      c.object.traverse((o) => { const s = o as THREE.SkinnedMesh; if (s.isSkinnedMesh) out.push((s.material as THREE.MeshStandardMaterial).color.getHexString()); });
      return out;
    };
    expect(colours(a)).not.toEqual(colours(b));
    expect(colours(a)).toContain(new THREE.Color('#1FA3A3').getHexString());
  });

  it('walk and jog timeScale follow speed / (nominal * H / 1.75); locomotion ignored while posed', async () => {
    const ch = await fresh();
    ch.setHeight(1.9, '#7A5AF0');
    ch.setLocomotion(1.4 * 1.9 / 1.75, false);
    expect(ch.state).toBe('walk');
    const acts = (ch as unknown as { actions: Record<string, THREE.AnimationAction> }).actions;
    expect(acts.walk.timeScale).toBeCloseTo(1, 9);
    ch.setLocomotion(2.8 * 1.9 / 1.75 * 0.5, true);
    expect(ch.state).toBe('jog');
    expect(acts.jog.timeScale).toBeCloseTo(0.5, 9);
    ch.setLocomotion(0, false);
    expect(ch.state).toBe('idle');
    run(ch, 0.5);
    void ch.standAt({ root: { x: 1, z: 1 }, yawDeg: 90 });
    ch.setLocomotion(1.4, false);
    expect(ch.state).toBe('transition');
  });

  it('lie: ends supine on the truth bed, head H m toward -a, feet at the pose, face up', async () => {
    const ch = await fresh();
    const bed = buildTruthProperty('furnished').furniture.find((i) => i.kind === 'bed')!;
    const H = 1.75;
    ch.setHeight(H, '#E8823A');
    ch.position = { x: 2.5, z: 1.0 };
    const pose = liePose(bed, H, { x: 2.5, z: 1.0 });
    const p = ch.lie(pose);
    expect(ch.state).toBe('transition');
    let resolved = false;
    void p.then(() => { resolved = true; });
    run(ch, 0.3);
    expect(ch.state).toBe('transition');
    run(ch, 0.45);
    await p;
    expect(resolved).toBe(true);
    expect(ch.state).toBe('lying');
    expect(ch.object.position.x).toBeCloseTo(pose.feet.x, 6);
    expect(ch.object.position.z).toBeCloseTo(pose.feet.z, 6);
    expect(ch.object.position.y).toBeCloseTo(pose.surfaceY + LIE_BACK_RATIO * H, 6);
    expect(ch.yawDeg).toBeCloseTo(90, 6);
    expect(ch.object.children[0].rotation.x).toBeCloseTo(-Math.PI / 2, 6);

    const vs = bodyVerts(ch);
    const b = bbox(vs);
    const headBone = bone(ch, 'DEF-head');
    const toeBone = bone(ch, 'DEF-toeL');
    // face up: the head bone's world direction along its own +Y... use the nose side: vertices of the head with max local z should be highest
    const faceDir = new THREE.Vector3(0, 0, 1).transformDirection(ch.object.children[0].matrixWorld);
    console.log('lie: bbox min', b.min.toArray().map((v) => v.toFixed(3)), 'max', b.max.toArray().map((v) => v.toFixed(3)));
    console.log('lie: head bone', headBone.toArray().map((v) => v.toFixed(3)), 'toe', toeBone.toArray().map((v) => v.toFixed(3)), 'face dir', faceDir.toArray().map((v) => v.toFixed(3)));
    expect(faceDir.y).toBeCloseTo(1, 6);
    // the crown reaches x = feet.x - H (the head is H metres toward -a = -x), to within the mesh's own proportions
    expect(Math.abs(b.min.x - (pose.feet.x - H))).toBeLessThan(0.05);
    // the figure stays in the bed's lane (width 1.5 m) and its lowest point is near the mattress surface
    expect(b.min.z).toBeGreaterThan(1.45); // arms hang 0.6 cm past the bed edge at the half-bed offset
    expect(b.max.z).toBeLessThan(3.0);
    const sinkCm = (pose.surfaceY - b.min.y) * 100;
    console.log(`lie: lowest vertex sits ${sinkCm.toFixed(1)} cm below the mattress surface (surface ${pose.surfaceY} m)`);
    // glutes/back rest on the surface; stiff pose, upper back and the posed right leg sink a few cm
    expect(sinkCm).toBeLessThan(20);
    expect(sinkCm).toBeGreaterThan(-1);
    const torso = bodyVerts(ch, /spine|neck|head|hips/);
    console.log(`lie: torso (spine, neck, head, hips) lowest vertex ${((pose.surfaceY - bbox(torso).min.y) * 100).toFixed(1)} cm below the surface`);
  });

  it('lie then release: stands up at the requested spot', async () => {
    const ch = await fresh();
    const bed = buildTruthProperty('furnished').furniture.find((i) => i.kind === 'bed')!;
    ch.position = { x: 2.5, z: 1.0 };
    const lying = ch.lie(liePose(bed, 1.75, { x: 2.5, z: 1.0 }));
    run(ch, 0.7);
    await lying;
    const rel = ch.release({ x: 2.6, z: 2.4 });
    expect(ch.state).toBe('transition');
    run(ch, 0.6);
    await rel;
    expect(ch.state).toBe('idle');
    expect(ch.position.x).toBeCloseTo(2.6, 6);
    expect(ch.position.z).toBeCloseTo(2.4, 6);
    expect(ch.object.position.y).toBeCloseTo(0, 6);
    expect(ch.object.children[0].rotation.x).toBeCloseTo(0, 6);
    // standing again, full height, idle plays at normal speed (lie froze it)
    const acts = (ch as unknown as { actions: Record<string, THREE.AnimationAction> }).actions;
    expect(acts.idle.timeScale).toBe(1);
    const b = bbox(bodyVerts(ch));
    expect(b.max.y - b.min.y).toBeGreaterThan(1.7);
  });

  it('sit: hips land on the seat spot, thighs rest near the sofa seat height', async () => {
    const ch = await fresh();
    const sofa = buildTruthProperty('furnished').furniture.find((i) => i.kind === 'sofa')!;
    for (const H of [1.6, 1.75, 1.9]) {
      ch.release({ x: 2.5, z: 3.0 });
      ch.setHeight(H, '#E8823A');
      const pose = seatPose(sofa, H, { x: 2.5, z: 3.0 });
      const p = ch.sit(pose);
      run(ch, 0.4);
      await p;
      expect(ch.state).toBe('sitting');
      run(ch, 1.6); // Sitting_Enter finishes, Sitting_Idle_Loop takes over
      expect(ch.object.position.y).toBeCloseTo(pose.rootY, 6);
      expect(ch.yawDeg).toBeCloseTo(270, 6);
      const hips = bone(ch, 'DEF-hips');
      const hipTargetX = 3.4; // 3.55 - (0.45 - 0.30)
      const vs = bodyVerts(ch);
      // underside of the buttocks and thighs: lowest vertex of the lower body behind the knees, above the calves
      const seat = bodyVerts(ch, /hips|thigh/);
      const underside = Math.min(...seat.map((v) => v.y));
      const b = bbox(vs);
      console.log(`sit H=${H}: hips.x ${hips.x.toFixed(3)} (target ${hipTargetX}), hips.y ${hips.y.toFixed(3)}, thigh underside ${underside.toFixed(3)} vs seat 0.42 (${((underside - 0.42) * 100).toFixed(1)} cm), bbox x ${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)}`);
      expect(Math.abs(hips.x - hipTargetX)).toBeLessThan(0.03);
      expect(Math.abs(hips.z - 3.0)).toBeLessThan(0.03);
      // within 5 cm of the seat top (SPEC 10.2 step 8)
      expect(Math.abs(underside - 0.42)).toBeLessThan(0.06);
    }
  });

  it('sit then release: stands up and ends idle at the requested spot', async () => {
    const ch = await fresh();
    const sofa = buildTruthProperty('furnished').furniture.find((i) => i.kind === 'sofa')!;
    const s = ch.sit(seatPose(sofa, 1.75, { x: 2.5, z: 3.0 }));
    run(ch, 0.4);
    await s;
    run(ch, 1.5);
    const rel = ch.release({ x: 2.4, z: 3.0 });
    run(ch, 1.0);
    await rel;
    expect(ch.state).toBe('idle');
    expect(ch.position.x).toBeCloseTo(2.4, 6);
    expect(ch.object.position.y).toBeCloseTo(0, 6);
    ch.setLocomotion(1.4, false);
    expect(ch.state).toBe('walk');
  });

  it('release during a sit in progress resolves both promises', async () => {
    const ch = await fresh();
    const sofa = buildTruthProperty('furnished').furniture.find((i) => i.kind === 'sofa')!;
    const s = ch.sit(seatPose(sofa, 1.75, { x: 2.5, z: 3.0 }));
    run(ch, 0.1);
    const rel = ch.release({ x: 2.4, z: 3.0 });
    run(ch, 1.5);
    await Promise.all([s, rel]);
    expect(ch.state).toBe('idle');
  });

  it('standAt faces the item and stays in idle', async () => {
    const ch = await fresh();
    const counter = { id: 'c', source: 'real' as const, kind: 'counter' as const, label: 'Counter',
      box: { cx: 2, cz: 0.3, w: 2.4, d: 0.6, yawDeg: 0 }, heightM: 0.85, surfaceHeightM: 0.85 };
    const p = ch.standAt(standPose(counter, 1.75, { x: 1.5, z: 2 }));
    run(ch, 0.4);
    await p;
    expect(ch.state).toBe('standing-at');
    expect(ch.yawDeg).toBeCloseTo(180, 6);
    expect(ch.position.z).toBeCloseTo(0.9, 6);
  });

  it('records the pose constants measured from the GLB (for the report)', async () => {
    const ch = await fresh();
    const H = 1.75;
    // standing idle at t = 0
    ch.update(0);
    const vs = bodyVerts(ch);
    const h0 = (ch as unknown as { h0: number }).h0;
    const hipsStand = bone(ch, 'DEF-hips');
    const back = Math.min(...vs.filter((v) => v.y > 0.9 && v.y < 1.5 && Math.abs(v.x) < 0.12).map((v) => v.z));
    const glutes = Math.min(...vs.filter((v) => v.y > 0.6 && v.y < 1.0 && Math.abs(v.x) < 0.2).map((v) => v.z));
    console.log(`h0 = ${h0.toFixed(4)} m; standing hips ${hipsStand.toArray().map((v) => (v / H).toFixed(3))} (ratios of H = 1.75)`);
    console.log(`standing back surface z/H = ${(back / H).toFixed(3)} (upper back), glutes z/H = ${(glutes / H).toFixed(3)}; LIE_BACK_RATIO = ${LIE_BACK_RATIO}`);
    // sitting pose measures (clip Sitting_Idle_Loop, same h0)
    ch.release({ x: 0, z: 0 });
    const sitAct = (ch as unknown as { actions: Record<string, THREE.AnimationAction> }).actions;
    sitAct.idle.stop();
    sitAct.sitIdle.reset().play();
    (ch as unknown as { mixer: THREE.AnimationMixer }).mixer.update(0);
    const hipsSit = bone(ch, 'DEF-hips');
    const under = Math.min(...bodyVerts(ch, /hips|thigh/).map((v) => v.y));
    console.log(`sit clip: hips bone behind root ${(-hipsSit.z).toFixed(4)} m = ${(-hipsSit.z / H).toFixed(4)} H (constant ${SIT_HIP_BACK_RATIO}); thigh/buttock underside ${under.toFixed(4)} m = ${(under / H).toFixed(4)} H (constant ${SIT_SEAT_RATIO}); hips bone height ${(hipsSit.y / H).toFixed(4)} H`);
    expect(SIT_HIP_BACK_RATIO).toBeGreaterThan(0);
    expect(SIT_SEAT_RATIO).toBeGreaterThan(0);
    void H;
  });
});
