// Turns the raw MPFB exports (tools/make_people.py) into the shipped bodies (SPEC 16.6.2, 16.6.6 check 14).
//
//   node tools/optimise-people.mjs <rawDir> <outDir>
//
// Dev-only. Needs (not in package.json, install them in a scratch directory and run from there):
//   @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
// Writes person-m.glb, person-m-low.glb, person-f.glb, person-f-low.glb. Medium and high share the first file.
//
// What it does: names meshes and materials (skin, eyes, brows, lashes, clothes, shoes, hair), fixes alpha modes (opaque
// everywhere except hair, brows and lashes, which are cut-outs; the suit is split into top and bottom), simplifies each mesh by its own ratio, resizes every
// texture, keeps a 1-pixel mean-colour of the skin texture in the material's extras (the detail-multiply needs it),
// drops the clothes' own colour maps (clothes are flat colours at run time) and compresses with EXT_meshopt_compression.
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, meshopt, resample, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const [rawDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;

const PARTS = (key) => ({
  [`${key}-body`]: 'skin', [`${key}-body.high-poly`]: 'eyes', [`${key}-body.eyebrow001`]: 'brows',
  [`${key}-body.eyelashes01`]: 'lashes', [`${key}-body.shoes05`]: 'shoes',
});
// meshopt simplify ratios per part: [medium, low]
const RATIO = { skin: [0.55, 0.22], eyes: [0.35, 0.12], brows: [1, 1], lashes: [1, 0.5], top: [0.65, 0.3], bottom: [0.7, 0.3], shoes: [0.5, 0.25], hair: [0.8, 0.45] };
// texture side in px per slot and tier: [medium, low]
const TEX = { skin: [1024, 512], eyes: [256, 128], brows: [256, 128], lashes: [256, 128], hair: [512, 256], shoes: [512, 256], clothesNormal: [1024, 0], clothesAO: [0, 0] };

const raw = [
  { key: 'male', file: 'person-m.raw.glb', out: 'person-m', clothes: 'male_casualsuit06', hair: 'short01' },
  { key: 'female', file: 'person-f.raw.glb', out: 'person-f', clothes: 'female_casualsuit01', hair: 'long01' },
];

async function resizeImage(buf, side, kind) {
  let img = sharp(buf);
  if (side) img = img.resize(side, side, { fit: 'fill', kernel: 'lanczos3' });
  if (kind === 'jpeg') return { data: await img.flatten({ background: '#808080' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer(), mime: 'image/jpeg' };
  if (kind === 'jpeg-normal') return { data: await img.jpeg({ quality: 90, mozjpeg: true }).toBuffer(), mime: 'image/jpeg' };
  return { data: await img.png({ palette: true, quality: 80, effort: 8, colours: 128 }).toBuffer(), mime: 'image/png' };
}

const SIDE = 256;
/** Marks the texels the mesh's UV triangles cover (the skin that is left after the clothes' hidden faces were cut away). */
function uvMask(prim) {
  const uv = prim.getAttribute('TEXCOORD_0'), idx = prim.getIndices();
  const mask = new Uint8Array(SIDE * SIDE);
  const P = (i) => { const v = uv.getElement(i, []); return [v[0] * SIDE, v[1] * SIDE]; };
  for (let t = 0; t < idx.getCount(); t += 3) {
    const a = P(idx.getScalar(t)), b = P(idx.getScalar(t + 1)), c = P(idx.getScalar(t + 2));
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(SIDE - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(SIDE - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const l1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den;
      const l2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den;
      if (l1 >= -0.02 && l2 >= -0.02 && 1 - l1 - l2 >= -0.02) mask[y * SIDE + x] = 1;
    }
  }
  return mask;
}

/** Mean linear colour of the texture; over the masked texels only when a mask is given (the skin that is actually drawn). */
async function meanLinear(buf, mask) {
  const { data, info } = await sharp(buf).resize(SIDE, SIDE, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const s = [0, 0, 0];
  let n = 0;
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  for (let i = 0, k = 0; i < data.length; i += info.channels, k++) {
    if (mask && !mask[k]) continue;
    for (let c = 0; c < 3; c++) s[c] += lin(data[i + c]);
    n++;
  }
  return s.map((v) => v / Math.max(1, n));
}

for (const b of raw) {
  for (const tier of [0, 1]) {
    const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMaterialsUnlit]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
    const doc = await io.read(path.join(rawDir, b.file));
    const root = doc.getRoot();
    const names = { ...PARTS(b.key), [`${b.key}-body.${b.clothes}.top`]: 'top', [`${b.key}-body.${b.clothes}.bottom`]: 'bottom', [`${b.key}-body.${b.hair}`]: 'hair' };
    const info = {};
    let skinPrim = null;
    for (const node of root.listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const part = names[mesh.getName()] ?? names[node.getName()];
      if (!part) throw new Error(`unexpected mesh ${mesh.getName()} / ${node.getName()}`);
      mesh.setName(part); node.setName(part);
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial();
        const matPart = part === 'top' || part === 'bottom' ? 'clothes' : part;
        mat.setName(matPart);
        const cut = part === 'hair' || part === 'brows' || part === 'lashes';
        mat.setAlphaMode(cut ? 'MASK' : 'OPAQUE').setAlphaCutoff(0.5).setDoubleSided(cut);
        mat.setMetallicFactor(0).setRoughnessFactor(part === 'skin' ? 0.55 : 0.8);
        info[matPart] = { mat };
        if (part === 'skin') skinPrim = prim;
      }
    }
    // textures: resize and re-encode, keep the skin's mean colour
    for (const [part, { mat }] of Object.entries(info)) {
      const base = mat.getBaseColorTexture();
      if (part === 'clothes') {
        // clothes are flat colours at run time: no colour map, normal map only on the medium tier
        if (base) { base.dispose(); mat.setBaseColorTexture(null); }
        const nrm = mat.getNormalTexture();
        const side = TEX.clothesNormal[tier];
        if (nrm && side) {
          const r = await resizeImage(Buffer.from(nrm.getImage()), side, 'jpeg-normal');
          nrm.setImage(r.data).setMimeType(r.mime);
        } else if (nrm) { mat.setNormalTexture(null); nrm.dispose(); }
        mat.setBaseColorFactor([1, 1, 1, 1]);
        continue;
      }
      if (!base) continue;
      const buf = Buffer.from(base.getImage());
      if (part === 'skin' || part === 'hair' || part === 'shoes') {
        // the run-time shader paints the person's own colour times (texel / mean texel), so it needs the mean
        const prim = part === 'skin' ? skinPrim : null;
        const mean = await meanLinear(buf, prim ? uvMask(prim) : null);
        mat.setExtras({ meanLinear: mean.map((v) => +v.toFixed(5)) });
      }
      const kind = part === 'skin' || part === 'eyes' || part === 'shoes' ? 'jpeg' : 'png';
      const r = await resizeImage(buf, TEX[part][tier], kind);
      base.setImage(r.data).setMimeType(r.mime);
    }
    await doc.transform(
      weld({ tolerance: 0.00001 }),
      dedup(),
      async (d) => {
        for (const mesh of d.getRoot().listMeshes()) {
          const ratio = RATIO[mesh.getName()]?.[tier] ?? 1;
          if (ratio >= 1) continue;
          await d.transform(simplifyMesh(mesh, ratio));
        }
      },
      prune(),
    );
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    const out = path.join(outDir, b.out + (tier ? '-low' : '') + '.glb');
    await io.write(out, doc);
    let tris = 0;
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
    console.log(path.basename(out), fs.statSync(out).size, 'bytes', Math.round(tris), 'tris');
  }
}

// simplify one mesh only: a transform that works on a single Mesh by temporarily hiding the others is awkward, so do it directly
function simplifyMesh(mesh, ratio) {
  return async (doc) => {
    const { simplify: simp } = await import('@gltf-transform/functions');
    // build a scratch document view: run `simplify` through a filtered dispatch
    const others = doc.getRoot().listMeshes().filter((m) => m !== mesh);
    const stash = new Map();
    for (const m of others) { stash.set(m, m.listPrimitives().map((p) => p)); }
    // simplify() processes every mesh, so give it a per-call ratio by temporarily tagging: simplest is to call the lower-level API
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const idx = prim.getIndices();
      const target = Math.max(3 * 30, Math.floor((idx.getCount() * ratio) / 3) * 3);
      const [newIdx] = MeshoptSimplifier.simplify(idx.getArray() instanceof Uint32Array ? idx.getArray() : new Uint32Array(idx.getArray()), pos.getArray(), 3, target, 0.02, ['LockBorder']);
      idx.setArray(newIdx.length < 65536 ? new Uint16Array(newIdx) : newIdx);
    }
  };
}
