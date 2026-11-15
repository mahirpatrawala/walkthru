// Shared by the motion tests: loads a person body with the shipped clips, an open floor, a scripted input, and the foot-slide measure.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Character } from '../src/engine/character';
import { stepLocomotion } from '../src/engine/locomotion';
import type { Input } from '../src/engine/controls';
import { retargetOnto } from '../src/look/people';
import type { PersonBody } from '../src/look/people';
import { GRID_CELL_M } from '../src/types';
import type { Grid } from '../src/types';

export const DIR = path.resolve(import.meta.dirname, '../public/characters');
export const haveBodies = ['person-man.glb', 'person-woman.glb', 'person-elder.glb', 'person-child.glb', 'clips.glb'].every((f) => fs.existsSync(path.join(DIR, f)));

export function parse(file: string): Promise<GLTF> {
  const buf = fs.readFileSync(path.join(DIR, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  l.register(() => ({ name: 'skip-textures', loadTexture: () => Promise.resolve(null) }) as never);
  return new Promise((res, rej) => l.parse(ab, '', res, rej));
}
export async function person(body: PersonBody): Promise<Character> {
  const gltf = await parse(`person-${body}.glb`);
  retargetOnto(gltf, await parse('clips.glb'));
  return Character.fromGLTF(gltf, { body, tier: 'medium' });
}

const N = Math.round(60 / GRID_CELL_M);
export const openGrid: Grid = { cellM: GRID_CELL_M, originX: -30, originZ: -30, nx: N, nz: N, cells: new Uint8Array(N * N) };
export const DEFAULT_CM: Record<PersonBody, number> = { man: 175, woman: 160, elder: 150, child: 120 };

export function fakeInput(): Input & { set(x: number, y: number, jog?: boolean): void } {
  const s = { moveX: 0, moveY: 0, jog: false };
  return {
    get moveX() { return s.moveX; }, get moveY() { return s.moveY; }, get jog() { return s.jog; },
    takeLook: () => ({ dx: 0, dy: 0, zoom: 0 }), on: () => () => {}, onTap: () => () => {}, claimPointer: () => {}, setInteractKeyMode: () => {}, dispose: () => {},
    set(x: number, y: number, jog = false) { s.moveX = x; s.moveY = y; s.jog = jog; },
  } as never;
}

export interface Slide { meanSpeed: number; p95: number; slipPerStepCm: number; planted: number; bodySpeed: number }
/**
 * Planted-foot slide. A foot bone counts as planted in the frames where it is within `tol` of the lowest it gets, in both
 * that frame and the one before; its slide is its horizontal world speed then. `slipPerStepCm` is how far it travels between
 * landing and lifting, averaged over the steps. The ball of the foot is used (the ankle swings through a low arc and would
 * count as planted while it is still moving).
 */
export function measureSlide(ch: Character, input: ReturnType<typeof fakeInput>, seconds: number, jog = false, setup?: (t: number) => void, tol = 0.02): Slide {
  const bones = (ch as unknown as { skinned: THREE.SkinnedMesh[] }).skinned[0].skeleton.bones;
  const find = (n: string): THREE.Bone => bones.find((b) => b.name.toLowerCase() === n)!;
  const feet = ['ball_l', 'ball_r'].map(find);
  const dt = 1 / 60;
  const warm = 1.5;
  const frames = Math.round((seconds + warm) / dt);
  const pos: THREE.Vector3[][] = feet.map(() => []);
  const body: THREE.Vector3[] = [];
  input.set(0, 1, jog);
  for (let i = 0; i < frames; i++) {
    setup?.(i * dt);
    stepLocomotion(ch, input, 0, openGrid, dt);
    ch.update(dt);
    ch.object.updateMatrixWorld(true);
    if (i * dt < warm) continue;
    feet.forEach((b, k) => pos[k].push(b.getWorldPosition(new THREE.Vector3())));
    body.push(new THREE.Vector3(ch.object.position.x, 0, ch.object.position.z));
  }
  const speeds: number[] = [];
  let stepSlip = 0, steps = 0;
  feet.forEach((_, k) => {
    const ys = pos[k].map((p) => p.y);
    const lo = Math.min(...ys);
    let run = 0, start: THREE.Vector3 | null = null, last: THREE.Vector3 | null = null;
    for (let i = 1; i < pos[k].length; i++) {
      const planted = ys[i] < lo + tol && ys[i - 1] < lo + tol;
      if (planted) {
        speeds.push(Math.hypot(pos[k][i].x - pos[k][i - 1].x, pos[k][i].z - pos[k][i - 1].z) / dt);
        if (!start) start = pos[k][i - 1];
        last = pos[k][i];
        run++;
      } else {
        if (start && last && run > 5) { stepSlip += Math.hypot(last.x - start.x, last.z - start.z); steps++; }
        start = null; last = null; run = 0;
      }
    }
  });
  speeds.sort((a, b) => a - b);
  const mean = speeds.reduce((s, v) => s + v, 0) / Math.max(1, speeds.length);
  const bodyDist = body[0].distanceTo(body[body.length - 1]);
  return { meanSpeed: mean, p95: speeds[Math.floor(speeds.length * 0.95)] ?? 0, slipPerStepCm: (stepSlip / Math.max(1, steps)) * 100, planted: speeds.length, bodySpeed: bodyDist / seconds };
}

