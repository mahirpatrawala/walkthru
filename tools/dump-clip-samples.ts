// Samples the clips a person actually plays (the retargeted ones, as src/look/people.ts builds them), for tools/make_family.py's posed sheets and
// clearance checks:   npx tsx tools/dump-clip-samples.ts <out.json> [body=man]
// Per frame: the world rotation change of every bone since the rest pose (glTF axes, x y z w) and the pelvis's world movement.
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { retargetOnto } from '../src/look/people';

const out = process.argv[2] || 'clip_samples.json';
const body = process.argv[3] || 'man';
const root = new URL('../public/characters/', import.meta.url);
const load = async (name: string) => {
  const b = fs.readFileSync(new URL(name, root));
  const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
  return l.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
};
const [src, gltf] = await Promise.all([load('clips.glb'), load(`person-${body}.glb`)]);
retargetOnto(gltf, src);
const scene = gltf.scene;
const bones = new Map<string, THREE.Object3D>();
scene.traverse((o) => { if ((o as THREE.Bone).isBone) bones.set(o.name, o); });
scene.updateMatrixWorld(true);
const rest = new Map<string, THREE.Quaternion>(); const restPos = new Map<string, THREE.Vector3>();
for (const [n, o] of bones) { const q = new THREE.Quaternion(), p = new THREE.Vector3(); o.matrixWorld.decompose(p, q, new THREE.Vector3()); rest.set(n, q); restPos.set(n, p); }
const mixer = new THREE.AnimationMixer(scene);
// clip -> number of frames over its loop; Sitting_Enter runs once so its frames are spread over the clip
const want: Record<string, number> = { Walk_Loop: 12, Walk_Formal_Loop: 12, Jog_Fwd_Loop: 8, Idle_Loop: 1, Idle_FoldArms_Loop: 3, Sitting_Idle_Loop: 1, Sitting_Enter: 4, Turn_Step: 4, Reach_Forward: 3 };
const result: Record<string, unknown> = {};
for (const clip of gltf.animations) {
  const n = want[clip.name]; if (!n) continue;
  const act = mixer.clipAction(clip); act.play();
  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = clip.name === 'Sitting_Enter' ? clip.duration * (i + 1) / n * 0.999 : clip.name === 'Turn_Step' ? clip.duration * (i + 0.5) / n : clip.duration * i / n;
    act.time = t; mixer.setTime(0); act.time = t; mixer.update(0);
    scene.updateMatrixWorld(true);
    const dq: Record<string, number[]> = {}; let hips: number[] | null = null;
    for (const [nm, o] of bones) {
      const q = new THREE.Quaternion(), p = new THREE.Vector3(); o.matrixWorld.decompose(p, q, new THREE.Vector3());
      const d = q.clone().multiply(rest.get(nm)!.clone().invert());
      dq[nm] = [d.x, d.y, d.z, d.w];
      if (nm === 'pelvis') hips = p.clone().sub(restPos.get(nm)!).toArray();
    }
    frames.push({ t, dq, hips });
  }
  act.stop(); mixer.uncacheClip(clip);
  result[clip.name] = { duration: clip.duration, frames };
}
result.restPos = Object.fromEntries([...restPos].map(([k, v]) => [k, v.toArray()]));
fs.writeFileSync(out, JSON.stringify(result));
console.log('clips sampled:', Object.keys(result).filter((k) => k !== 'restPos').join(', '), 'bones', bones.size);
