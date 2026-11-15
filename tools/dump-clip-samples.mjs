// Samples the mannequin clips: per DEF bone, world rotation change since rest (glTF world), plus hips world position change.
import fs from 'node:fs';
import * as THREE from '/Users/mahir/walkthru-wt/hem/node_modules/three/build/three.module.js';
import { GLTFLoader } from '/Users/mahir/walkthru-wt/hem/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
const buf = fs.readFileSync('/Users/mahir/walkthru-wt/hem/public/characters/clips.glb');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
import { MeshoptDecoder } from '/Users/mahir/walkthru-wt/hem/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';
const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
const gltf = await new Promise((res, rej) => l.parse(ab, '', res, rej));
const root = gltf.scene;
const bones = new Map();
root.traverse((o) => { if (o.name.startsWith('DEF-')) bones.set(o.name, o); });
root.updateMatrixWorld(true);
const rest = new Map(); const restPos = new Map();
for (const [n, o] of bones) { const q = new THREE.Quaternion(), p = new THREE.Vector3(); o.matrixWorld.decompose(p, q, new THREE.Vector3()); rest.set(n, q); restPos.set(n, p); }
console.error('clips', gltf.animations.map((a) => `${a.name} ${a.duration}`));
const mixer = new THREE.AnimationMixer(root);
const want = { Walk_Loop: 12, Jog_Fwd_Loop: 8, Idle_Loop: 1, Sitting_Idle_Loop: 1 };
const out = {};
for (const clip of gltf.animations) {
  if (!(clip.name in want) && clip.name !== 'Sitting_Enter') continue;
  const n = clip.name === 'Sitting_Enter' ? 4 : want[clip.name];
  const act = mixer.clipAction(clip); act.play();
  out[clip.name] = { duration: clip.duration, frames: [] };
  for (let i = 0; i < n; i++) {
    const t = clip.name === 'Sitting_Enter' ? clip.duration * (i + 1) / n * 0.999 : clip.duration * i / n;
    act.time = t; mixer.setTime(0); act.time = t; mixer.update(0);
    root.updateMatrixWorld(true);
    const f = { t, dq: {}, hips: null };
    for (const [nm, o] of bones) {
      const q = new THREE.Quaternion(), p = new THREE.Vector3(); o.matrixWorld.decompose(p, q, new THREE.Vector3());
      const d = q.clone().multiply(rest.get(nm).clone().invert());
      f.dq[nm] = [d.x, d.y, d.z, d.w];
      if (nm === 'DEF-hips') f.hips = p.clone().sub(restPos.get(nm)).toArray();
    }
    out[clip.name].frames.push(f);
  }
  act.stop(); mixer.uncacheClip(clip);
}
out.restPos = Object.fromEntries([...restPos].map(([k, v]) => [k, v.toArray()]));
fs.writeFileSync('clip_samples.json', JSON.stringify(out));
