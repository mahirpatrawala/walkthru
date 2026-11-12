// Writes tools/mannequin-rest.json: the world position of every DEF- bone of the mannequin's rest pose (a T-pose), read from
// clips.glb. tools/make_people.py swings each limb of an MPFB body to point the same way before the clips are retargeted.
//   node tools/make-rest-json.mjs <clips.glb> <out.json>
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const d = await io.read(process.argv[2]); const o = {};
for (const n of d.getRoot().listNodes()) if (n.getName().startsWith('DEF-')) o[n.getName()] = n.getWorldTranslation().map(v => +v.toFixed(5));
fs.writeFileSync(process.argv[3], JSON.stringify(o, null, 1)); console.log(Object.keys(o).length);
