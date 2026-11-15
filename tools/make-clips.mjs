// Builds public/characters/clips.glb from the two free Quaternius libraries (both CC0, see public/characters/PEOPLE-LICENCE.txt):
//   Universal Animation Library   [Standard]  UAL1_Standard.glb   (Unreal-Godot folder, root motion off)
//   Universal Animation Library 2 [Standard]  UAL2_Standard.glb
// Both use the same 65-bone rig with Unreal-style names (root, pelvis, spine_01 ...), which are the names our bodies carry, so the
// clips need no renaming. The file keeps the bone hierarchy at its rest pose (a T-pose; src/look/retarget.ts reads it), rotations of every
// bone and the position of pelvis only, meshopt-compressed, no meshes.
//   node tools/make-clips.mjs <UAL1_Standard.glb> <UAL2_Standard.glb> <clips.glb>
// Dev-only; needs @gltf-transform/core, extensions, functions and meshoptimizer in a scratch directory (see optimise-people.mjs).
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptEncoder } from 'meshoptimizer';
import { prune, meshopt, resample } from '@gltf-transform/functions';
import fs from 'node:fs';
await MeshoptEncoder.ready;
const [src1, src2, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src1);
const doc2 = await io.read(src2);
const KEEP1 = ['Idle_Loop', 'Walk_Loop', 'Walk_Formal_Loop', 'Jog_Fwd_Loop', 'Sitting_Enter', 'Sitting_Idle_Loop', 'Sitting_Exit', 'Interact'];
const KEEP2 = ['Idle_FoldArms_Loop'];

for (const a of doc.getRoot().listAnimations()) if (!KEEP1.includes(a.getName())) { for (const c of a.listChannels()) c.dispose(); for (const sm of a.listSamplers()) sm.dispose(); a.dispose(); }

// copy the wanted clips of library 2 onto library 1's bone nodes (same names, same rig)
const byName = new Map(doc.getRoot().listNodes().map((n) => [n.getName(), n]));
const buffer = doc.getRoot().listBuffers()[0];
for (const a2 of doc2.getRoot().listAnimations()) {
  if (!KEEP2.includes(a2.getName())) continue;
  const a = doc.createAnimation(a2.getName());
  for (const ch2 of a2.listChannels()) {
    const node = byName.get(ch2.getTargetNode()?.getName() ?? '');
    if (!node) throw new Error(`library 2 targets a bone library 1 lacks: ${ch2.getTargetNode()?.getName()}`);
    const s2 = ch2.getSampler();
    const input = doc.createAccessor().setArray(s2.getInput().getArray().slice()).setType('SCALAR').setBuffer(buffer);
    const output = doc.createAccessor().setArray(s2.getOutput().getArray().slice()).setType(s2.getOutput().getType()).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation(s2.getInterpolation());
    a.addSampler(sampler);
    a.addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(ch2.getTargetPath()).setSampler(sampler));
  }
}

for (const n of doc.getRoot().listNodes()) { if (n.getMesh()) n.setMesh(null); if (n.getSkin()) n.setSkin(null); }
for (const m of doc.getRoot().listMeshes()) m.dispose();
for (const s of doc.getRoot().listSkins()) s.dispose();
for (const a of doc.getRoot().listAnimations()) {
  for (const ch of a.listChannels()) {
    const bone = ch.getTargetNode()?.getName() ?? '';
    const path = ch.getTargetPath();
    if (path === 'scale' || (path === 'translation' && bone !== 'pelvis')) { const s = ch.getSampler(); a.removeChannel(ch); ch.dispose(); if (s && !a.listChannels().some((c) => c.getSampler() === s)) { a.removeSampler(s); s.dispose(); } }
  }
}
await doc.transform(prune({ keepLeaves: true }));
await doc.transform(resample());
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
await io.write(out, doc);
console.log(out, fs.statSync(out).size, doc.getRoot().listAnimations().map((a) => a.getName() + ':' + a.listChannels().length));
