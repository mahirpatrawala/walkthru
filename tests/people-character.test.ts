// Headless checks of the person bodies (SPEC 16.6.6 checks 5 and the pose parts of 8 to 10, without a browser).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildTruthProperty } from '../scripts/make-test-room';
import { liePose, seatPose } from '../src/core/poses';
import { Character } from '../src/engine/character';
import { retargetOnto } from '../src/look/people';
import type { PersonBody } from '../src/look/people';

const DIR = path.resolve(import.meta.dirname, '../public/characters');
const have = ['person-man.glb', 'person-woman.glb', 'person-elder.glb', 'person-child.glb', 'clips.glb'].every((f) => fs.existsSync(path.join(DIR, f)));

function parse(file: string): Promise<GLTF> {
  const buf = fs.readFileSync(path.join(DIR, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  // there is no canvas under Node: the textures are skipped, geometry and skeleton are what these checks need
  l.register(() => ({ name: 'skip-textures', loadTexture: () => Promise.resolve(null) }) as never);
  return new Promise((res, rej) => l.parse(ab, '', res, rej));
}

async function person(body: PersonBody, low = false): Promise<Character> {
  const gltf = await parse(`person-${body}${low ? '-low' : ''}.glb`);
  retargetOnto(gltf, await parse('clips.glb'));
  return Character.fromGLTF(gltf, { body, tier: low ? 'low' : 'medium' });
}
function run(ch: Character, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) ch.update(1 / 60);
}

/** the heights each person is checked at: the ends of their range and the quick heights between (SPEC 16.6.4) */
const HEIGHTS: Record<PersonBody, number[]> = { man: [150, 160, 175, 190, 200], woman: [140, 160, 168, 176, 190], elder: [135, 150, 158, 166, 180], child: [90, 105, 120, 135, 150] };
/** the three heights the bed and sofa checks run at */
const TRIO: Record<PersonBody, number[]> = { man: [160, 175, 190], woman: [150, 160, 176], elder: [145, 155, 165], child: [105, 120, 135] };

describe.skipIf(!have)('person bodies', () => {
  it('the elderly parent walks more slowly than the man', async () => {
    expect((await person('elder')).walkFactor).toBeLessThan(0.8);
    expect((await person('man')).walkFactor).toBe(1);
  });

  for (const body of ['man', 'woman', 'elder', 'child'] as const) {
    it(`${body}: height is exact across the range, standing`, async () => {
      const ch = await person(body);
      for (const cm of HEIGHTS[body]) {
        ch.setHeight(cm / 100, '#E8823A');
        ch.update(0);
        const m = ch.measure();
        expect(Math.abs(m.heightM - cm / 100)).toBeLessThan(0.01);
        expect(Math.abs(m.bboxMin.y)).toBeLessThan(0.02); // soles on the floor
      }
      expect(ch.visibleMeshNames().some((n) => /mannequin/i.test(n))).toBe(false);
      console.log(body, 'pose constants', JSON.stringify(ch.poseConstants));
    });

    it(`${body}: has the idle clips, glances round after standing still and reaches on request`, async () => {
      const gltf = await parse(`person-${body}.glb`);
      retargetOnto(gltf, await parse('clips.glb'));
      const names = gltf.animations.map((a) => a.name);
      expect(names).toEqual(expect.arrayContaining(['Idle_Loop', 'Walk_Loop', 'Lie_Pose', 'Look_Around', 'Reach_Forward']));
      const idle = gltf.animations.find((a) => a.name === 'Idle_Loop')!;
      for (const n of ['Look_Around', 'Reach_Forward']) {
        const clip = gltf.animations.find((a) => a.name === n)!;
        // every bone the idle drives is driven here too, or it would drift to the bind pose while the clip is blended in
        expect(new Set(clip.tracks.map((t) => t.name))).toEqual(new Set(idle.tracks.map((t) => t.name)));
      }
      const ch = Character.fromGLTF(gltf, { body, tier: 'medium' });
      ch.setHeight(1.7, '#E8823A');
      const look = gltf.animations.find((a) => a.name === 'Look_Around')!;
      const head = look.tracks.find((t) => /^head\.quaternion$/.test(t.name))!;
      const first = new THREE.Quaternion().fromArray(Array.from(head.values), 0);
      let widest = 0;
      for (let i = 0; i < head.values.length; i += 4) widest = Math.max(widest, first.angleTo(new THREE.Quaternion().fromArray(Array.from(head.values), i)));
      expect(widest * 180 / Math.PI).toBeGreaterThan(15); // the head really turns
      run(ch, 9); // stands still for longer than the glance delay
      ch.reach();
      run(ch, 0.8);
      expect(ch.state).toBe('idle');
      run(ch, 2.5);
      expect(Math.abs(ch.measure().heightM - 1.7)).toBeLessThan(0.02); // standing again, same height
    });

    it(`${body}: lying on the queen bed at three heights`, async () => {
      const ch = await person(body);
      const bed = buildTruthProperty('furnished').furniture.find((i) => i.kind === 'bed')!;
      for (const cm of TRIO[body]) {
        const H = cm / 100;
        ch.release({ x: 0, z: 0 });
        ch.setHeight(H, '#E8823A');
        const pose = liePose(bed, H, { x: bed.box.cx, z: bed.box.cz + 0.5 });
        const p = ch.lie(pose);
        run(ch, 0.8);
        await p;
        const m = ch.measure();
        const lowest = pose.surfaceY - m.bboxMin.y;
        console.log(`${body} lie ${cm}: headToHeel ${m.headToHeelM.toFixed(3)}, lowest ${(lowest * 100).toFixed(1)} cm below surface, y range ${m.bboxMin.y.toFixed(3)}..${m.bboxMax.y.toFixed(3)}`);
        expect(Math.abs(m.headToHeelM - H)).toBeLessThan(0.02);
        expect(lowest).toBeLessThan(0.03);
      }
    });

    it(`${body}: sitting on the sofa at three heights`, async () => {
      const ch = await person(body);
      const sofa = buildTruthProperty('furnished').furniture.find((i) => i.kind === 'sofa')!;
      ch.surfaceProbe = () => sofa.surfaceHeightM;
      for (const cm of TRIO[body]) {
        const H = cm / 100;
        ch.release({ x: 2.5, z: 3.0 });
        ch.setHeight(H, '#E8823A');
        const pose = seatPose(sofa, H, { x: 2.5, z: 3.0 });
        const p = ch.sit(pose);
        run(ch, 0.4);
        await p;
        run(ch, 1.8);
        const m = ch.measure();
        const hip = { x: 3.4, z: 3.0 };
        const above = m.pelvis.y - sofa.surfaceHeightM;
        console.log(`${body} sit ${cm}: pelvis (${m.pelvis.x.toFixed(3)}, ${m.pelvis.y.toFixed(3)}, ${m.pelvis.z.toFixed(3)}) above seat ${(above * 100).toFixed(1)} cm, lowest ${m.bboxMin.y.toFixed(3)}`);
        expect(Math.hypot(m.pelvis.x - hip.x, m.pelvis.z - hip.z)).toBeLessThan(0.05);
        expect(above).toBeGreaterThan(0.05);
        expect(above).toBeLessThan(0.15);
        expect(m.bboxMin.y).toBeGreaterThan(-0.01);
      }
    });
  }
});
