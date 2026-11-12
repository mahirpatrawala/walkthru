// Builds public/characters/clips.glb: the six clips of public/characters/mannequin.glb (rotations of the DEF- bones and the hips
// position only, meshopt-compressed), so a person body does not have to download the 6.6 MB mannequin for its animation.
//   node tools/make-clips.mjs <mannequin.glb> <clips.glb>
// Dev-only; needs @gltf-transform/core, extensions, functions and meshoptimizer installed in a scratch directory (see optimise-people.mjs).
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { MeshoptEncoder } from 'meshoptimizer';
import { prune, meshopt, resample } from '@gltf-transform/functions';
import fs from 'node:fs';
await MeshoptEncoder.ready;
const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const keep = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sitting_Enter', 'Sitting_Idle_Loop', 'Sitting_Exit'];
for (const a of doc.getRoot().listAnimations()) if (!keep.includes(a.getName())) { for (const c of a.listChannels()) c.dispose(); for (const sm of a.listSamplers()) sm.dispose(); a.dispose(); }
for (const n of doc.getRoot().listNodes()) { if (n.getMesh()) { n.setMesh(null); } if (n.getSkin()) n.setSkin(null); }
for (const m of doc.getRoot().listMeshes()) m.dispose();
for (const s of doc.getRoot().listSkins()) s.dispose();
for (const a of doc.getRoot().listAnimations()) {
  for (const ch of a.listChannels()) {
    const bone = ch.getTargetNode()?.getName() ?? '';
    const path = ch.getTargetPath();
    const isHips = bone === 'DEF-hips';
    if (path === 'scale' || (path === 'translation' && !isHips) || !bone.startsWith('DEF-')) { const s = ch.getSampler(); a.removeChannel(ch); ch.dispose(); if (s && !a.listChannels().some(c => c.getSampler() === s)) { a.removeSampler(s); s.dispose(); } }
  }
}
await doc.transform(prune({ keepLeaves: true }));
await doc.transform(resample());
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
await io.write(out, doc);
console.log(out, fs.statSync(out).size, doc.getRoot().listAnimations().map(a => a.getName() + ':' + a.listChannels().length));
