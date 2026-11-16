// SPEC 16.6.9 and 16.6.11d: the hair must cover the skull's summit. Cast rays straight down over the crown at the bind pose and in the standing,
// walking and sitting poses, for every person and both tiers: wherever the skin is hit, the hair must be hit first and stand clear of it.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { retargetOnto } from '../src/look/people';

const DIR = path.resolve(import.meta.dirname, '../public/characters');
function parse(file: string): Promise<GLTF> {
  const buf = fs.readFileSync(path.join(DIR, file));
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  l.register(() => ({ name: 'skip-textures', loadTexture: () => Promise.resolve(null) }) as never);
  return new Promise((res, rej) => l.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
}
const BODIES = ['man', 'woman', 'elder', 'child'] as const;
const have = BODIES.every((b) => fs.existsSync(path.join(DIR, `person-${b}.glb`)) && fs.existsSync(path.join(DIR, `person-${b}-low.glb`)));

/** [cells over the crown, bare cells (skin hit with no hair above it or less than `clear` metres of hair over it), least clearance] */
function crown(gltf: GLTF, clear: number): { cells: number; bare: number; least: number } {
  const parts = new Map<string, THREE.SkinnedMesh>();
  gltf.scene.updateMatrixWorld(true);
  // (a mesh's culling sphere is of the pose it was first computed in: recompute it)
  gltf.scene.traverse((o) => { const s = o as THREE.SkinnedMesh; if (s.isSkinnedMesh) { s.skeleton.update(); s.boundingSphere = null; s.boundingBox = null; parts.set(s.name, s); } });
  const skin = parts.get('skin')!, hair = parts.get('hair')!;
  const box = new THREE.Box3().setFromObject(hair);
  const top = box.max.y;
  const rc = new THREE.Raycaster();
  rc.firstHitOnly = false;
  let cells = 0, bare = 0, least = Infinity;
  // the crown: a disc of 6 cm radius round the highest point of the skin's head, in steps of 6 mm
  const sv = new THREE.Vector3();
  let cx = 0, cz = 0, ymax = -Infinity;
  const pos = skin.geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) { skin.getVertexPosition(i, sv); sv.applyMatrix4(skin.matrixWorld); if (sv.y > ymax) { ymax = sv.y; cx = sv.x; cz = sv.z; } }
  for (let dx = -0.06; dx <= 0.0601; dx += 0.006) for (let dz = -0.06; dz <= 0.0601; dz += 0.006) {
    if (Math.hypot(dx, dz) > 0.06) continue;
    rc.set(new THREE.Vector3(cx + dx, top + 1, cz + dz), new THREE.Vector3(0, -1, 0));
    const ys = rc.intersectObject(skin, false).map((h) => h.point.y);
    if (!ys.length) continue;
    const ysk = Math.max(...ys);
    const hh = rc.intersectObject(hair, false).map((h) => h.point.y);
    cells++;
    const yh = hh.length ? Math.max(...hh) : -Infinity;
    least = Math.min(least, yh - ysk);
    if (yh - ysk < clear) bare++;
  }
  return { cells, bare, least };
}

describe.skipIf(!have)('hair covers the crown (16.6.11d)', () => {
  for (const tier of ['', '-low']) {
    for (const body of BODIES) {
      it(`${body}${tier}: no bare cell over the crown at the bind pose and in the standing, walking and sitting poses`, async () => {
        const src = await parse('clips.glb');
        const gltf = await parse(`person-${body}${tier}.glb`);
        const bind = crown(gltf, 0.004);
        expect(bind.cells).toBeGreaterThan(100);
        expect(bind.bare, `bind pose ${JSON.stringify(bind)}`).toBe(0);
        retargetOnto(gltf, src);
        const mixer = new THREE.AnimationMixer(gltf.scene);
        for (const [name, t] of [['Idle_Loop', 0], ['Walk_Loop', 0.3], ['Walk_Loop', 0.9], ['Jog_Fwd_Loop', 0.4], ['Sitting_Idle_Loop', 0.2]] as const) {
          const clip = gltf.animations.find((c) => c.name === name)!;
          mixer.stopAllAction();
          const a = mixer.clipAction(clip); a.play(); a.time = t; mixer.setTime(0); a.time = t; mixer.update(0);
          gltf.scene.updateMatrixWorld(true);
          const r = crown(gltf, 0.004);
          console.log('HAIR', body, tier, name, t, JSON.stringify(r));
          expect(r.bare, `${name} ${t} ${JSON.stringify(r)}`).toBe(0);
        }
      });
    }
  }
});
