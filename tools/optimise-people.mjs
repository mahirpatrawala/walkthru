// Turns the raw family exports (tools/make_family.py) into the shipped bodies (SPEC 16.6).
//
//   node tools/optimise-people.mjs <rawDir> <outDir>
//
// Dev-only. Needs (not in package.json, install them in a scratch directory and run from there):
//   @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer
// Writes person-<key>.glb and person-<key>-low.glb for key in man, woman, elder, child. Medium and high share the first file.
//
// The bodies carry no textures (flat colours, recoloured per role at run time by src/look/people-materials.ts), so this
// only welds, simplifies each part by its own ratio, fixes material flags (garments and hair are double sided), and
// compresses with EXT_meshopt_compression. Part names are the roles: skin, eyes, pupil, brows, top, bottom, trim, wrap, hair, shoes.
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const [rawDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;

const KEYS = ['man', 'woman', 'elder', 'child'];
// meshopt simplify ratios per part: [medium, low]
const RATIO = { skin: [0.42, 0.16], eyes: [0.5, 0.2], pupil: [1, 0.6], brows: [1, 0.6], top: [0.5, 0.2], bottom: [0.5, 0.2], trim: [0.8, 0.4], wrap: [1, 0.6], hair: [0.8, 0.4], shoes: [0.45, 0.2] };
const ROUGH = { skin: 0.6, eyes: 0.2, pupil: 0.15, brows: 0.8, top: 0.9, bottom: 0.9, trim: 0.7, wrap: 0.9, hair: 0.6, shoes: 0.7 };
const DOUBLE = new Set(['top', 'bottom', 'trim', 'wrap', 'hair']);

function simplifyMesh(mesh, ratio) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const idx = prim.getIndices();
    const target = Math.max(3 * 30, Math.floor((idx.getCount() * ratio) / 3) * 3);
    const src = idx.getArray() instanceof Uint32Array ? idx.getArray() : new Uint32Array(idx.getArray());
    const [newIdx] = MeshoptSimplifier.simplify(src, pos.getArray(), 3, target, 0.02, ['LockBorder']);
    idx.setArray(newIdx.length < 65536 ? new Uint16Array(newIdx) : newIdx);
  }
}

for (const key of KEYS) {
  for (const tier of [0, 1]) {
    const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMaterialsUnlit]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
    const doc = await io.read(path.join(rawDir, `person-${key}.raw.glb`));
    const root = doc.getRoot();
    for (const node of root.listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const part = mesh.getName() || node.getName();
      if (!(part in RATIO)) throw new Error(`unexpected mesh ${mesh.getName()} / ${node.getName()}`);
      mesh.setName(part); node.setName(part);
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial();
        mat.setName(part);
        mat.setAlphaMode('OPAQUE').setDoubleSided(DOUBLE.has(part));
        mat.setMetallicFactor(0).setRoughnessFactor(ROUGH[part]);
        for (const t of [mat.getBaseColorTexture(), mat.getNormalTexture(), mat.getMetallicRoughnessTexture()]) t?.dispose();
      }
    }
    await doc.transform(weld({ tolerance: 0.00001 }), dedup());
    for (const mesh of root.listMeshes()) {
      const ratio = RATIO[mesh.getName()][tier];
      if (ratio < 1) simplifyMesh(mesh, ratio);
    }
    await doc.transform(prune());
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    const out = path.join(outDir, `person-${key}${tier ? '-low' : ''}.glb`);
    await io.write(out, doc);
    let tris = 0;
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
    console.log(path.basename(out), fs.statSync(out).size, 'bytes', Math.round(tris), 'tris');
  }
}
