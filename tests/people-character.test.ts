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
const have = ['person-m.glb', 'person-f.glb', 'clips.glb'].every((f) => fs.existsSync(path.join(DIR, f)));

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
  const gltf = await parse(`person-${body === 'male' ? 'm' : 'f'}${low ? '-low' : ''}.glb`);
  retargetOnto(gltf, await parse('clips.glb'));
  return Character.fromGLTF(gltf, { body, tier: low ? 'low' : 'medium' });
}
function run(ch: Character, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) ch.update(1 / 60);
}

describe.skipIf(!have)('person bodies', () => {
  for (const body of ['male', 'female'] as const) {
    it(`${body}: height is exact at 140, 160, 175, 190 and 200 cm, standing`, async () => {
      const ch = await person(body);
      for (const cm of [140, 160, 175, 190, 200]) {
        ch.setHeight(cm / 100, '#E8823A');
        ch.update(0);
        const m = ch.measure();
        expect(Math.abs(m.heightM - cm / 100)).toBeLessThan(0.01);
        expect(Math.abs(m.bboxMin.y)).toBeLessThan(0.02); // soles on the floor
      }
      expect(ch.visibleMeshNames().some((n) => /mannequin/i.test(n))).toBe(false);
      console.log(body, 'pose constants', JSON.stringify(ch.poseConstants));
    });

    it(`${body}: lying on the queen bed at 160 / 175 / 190`, async () => {
      const ch = await person(body);
      const bed = buildTruthProperty('furnished').furniture.find((i) => i.kind === 'bed')!;
      for (const cm of [160, 175, 190]) {
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

    it(`${body}: sitting on the sofa at 160 / 175 / 190`, async () => {
      const ch = await person(body);
      const sofa = buildTruthProperty('furnished').furniture.find((i) => i.kind === 'sofa')!;
      ch.surfaceProbe = () => sofa.surfaceHeightM;
      for (const cm of [160, 175, 190]) {
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
