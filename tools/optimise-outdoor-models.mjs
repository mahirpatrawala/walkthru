// SPEC 19.13 (22 Nov 2026): the downloaded models of the open-air spaces (trees, palms, shrubs, pool-side and garden furniture) made into the
// small files the app ships, under public/look/outdoor/models/, one file a tier:
//   <id>.low.glb (phones), <id>.med.glb (medium), <id>.glb (high)
// and their facts (size, height, parts, triangles, bytes) into src/outdoor/models.json, and every shipped file's SHA-256 into
// public/look/outdoor/files.lock.json. The raw files are scripts/fetch-outdoor-real.mjs's (pinned SHA-256, untrusted data: only read, never run).
//
//   node optimise-outdoor-models.mjs <repo> [id,id,...]     (from a scratch install, as tools/optimise-outdoor-real.mjs says)
//
// What it does to a model: bakes every node's transform into its vertices (one flat level of meshes), turns it upright and to the metre where the
// source was not, puts the origin at the foot of a plant's trunk or the middle of a piece's footprint with the lowest point on y = 0, names each
// mesh by its part (trunk, leaves, flowers; frame, cushion, canopy, ...), drops parts it is told to (a logo plate, a scene's ground), and per tier:
//  - a plant's leaf cards are thinned (whole cards kept or dropped, a seeded share; the kept ones grown a little so the crown keeps its mass),
//    the woody parts simplified (meshoptimizer);
//  - textures re-encoded as WebP at 1024 / 512 / 256 px (normal maps dropped on low), a leaf picture with no alpha of its own (black behind the
//    leaves) is given one from its brightness;
//  - meshopt-compressed.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, meshopt, getBounds, flatten } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = process.argv[2];
if (!REPO || !fs.existsSync(path.join(REPO, 'SPEC.md'))) { console.error('usage: node optimise-outdoor-models.mjs <repo> [ids]'); process.exit(1); }
const RAW = process.env.OUTDOOR_RAW || path.join(os.homedir(), 'walkthru-tools/outdoor-raw/real');
const OUT = path.join(REPO, 'public/look/outdoor');
const FACTS = path.join(REPO, 'src/outdoor/models.json');
const ONLY = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;

/**
 * The picks (sources, authors and licences: scripts/fetch-outdoor-real.mjs MODELS and public/look/outdoor/sources.lock.json).
 *  src: raw file under RAW; parts: [regex on material or mesh name, part] in order, first match wins (unmatched = dropped when `strict`);
 *  drop: regex of meshes or materials left out; leaves: the parts thinned per tier; alphaFromLuma: parts whose picture has no alpha;
 *  height: metres to scale the model to (a plant: its height; a piece: its own height, fitted to the catalogue box at run time);
 *  kind: 'plant' (origin at the foot of the trunk) or 'piece' (origin at the middle of the footprint); turnY: degrees about +Y (a piece's front to +Z).
 */
export const PICKS = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'outdoor-model-picks.json'), 'utf8'));

const TIERS = {
  high: { suffix: '', tex: 1024, leafTex: 1024, leafKeep: 1, simplify: 1, normals: true },
  medium: { suffix: '.med', tex: 512, leafTex: 512, leafKeep: 0.55, simplify: 0.6, normals: true },
  low: { suffix: '.low', tex: 256, leafTex: 256, leafKeep: 0.3, simplify: 0.35, normals: false },
};

function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function bake(root) {
  for (const node of root.listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'); const nor = prim.getAttribute('NORMAL');
      const a = pos.getArray().slice(); for (let i = 0; i < a.length; i += 3) { const x = a[i], y = a[i + 1], z = a[i + 2]; a[i] = m[0] * x + m[4] * y + m[8] * z + m[12]; a[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; a[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]; }
      pos.setArray(a);
      if (nor) { const b = nor.getArray().slice(); for (let i = 0; i < b.length; i += 3) { const x = b[i], y = b[i + 1], z = b[i + 2]; const nx = m[0] * x + m[4] * y + m[8] * z, ny = m[1] * x + m[5] * y + m[9] * z, nz = m[2] * x + m[6] * y + m[10] * z; const l = Math.hypot(nx, ny, nz) || 1; b[i] = nx / l; b[i + 1] = ny / l; b[i + 2] = nz / l; } nor.setArray(b); }
    }
    node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
}

const eachPos = (root, f) => { for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) { const p = prim.getAttribute('POSITION'); const a = p.getArray().slice(); f(a, prim); p.setArray(a); } };
const eachNor = (root, f) => { for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) { const p = prim.getAttribute('NORMAL'); if (!p) continue; const a = p.getArray().slice(); f(a); p.setArray(a); } };

/** turn about +Y by deg, scale by k, then put the origin where `kind` wants it */
function place(root, pick, partOf) {
  const t = ((pick.turnY ?? 0) * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const rotX = ((pick.turnX ?? 0) * Math.PI) / 180, cx = Math.cos(rotX), sx = Math.sin(rotX);
  const rot = (a) => { for (let i = 0; i < a.length; i += 3) { let x = a[i], y = a[i + 1], z = a[i + 2]; const y2 = y * cx - z * sx, z2 = y * sx + z * cx; y = y2; z = z2; a[i] = x * c + z * s; a[i + 1] = y; a[i + 2] = -x * s + z * c; } };
  eachPos(root, rot); eachNor(root, rot);
  let minY = Infinity, maxY = -Infinity;
  eachPos(root, (a) => { for (let i = 1; i < a.length; i += 3) { minY = Math.min(minY, a[i]); maxY = Math.max(maxY, a[i]); } });
  const k = pick.height / (maxY - minY);
  let fx = 0, fz = 0;
  if (pick.kind === 'plant') {
    // the foot: the middle of the woody vertices within 20 cm (scaled) of the ground
    let sxm = 0, szm = 0, n = 0;
    for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
      if (partOf(prim) !== 'trunk') continue;
      const a = prim.getAttribute('POSITION').getArray();
      for (let i = 0; i < a.length; i += 3) if ((a[i + 1] - minY) * k < 0.2) { sxm += a[i]; szm += a[i + 2]; n++; }
    }
    if (n) { fx = sxm / n; fz = szm / n; }
  } else {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    eachPos(root, (a) => { for (let i = 0; i < a.length; i += 3) { x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]); z0 = Math.min(z0, a[i + 2]); z1 = Math.max(z1, a[i + 2]); } });
    fx = (x0 + x1) / 2; fz = (z0 + z1) / 2;
  }
  eachPos(root, (a) => { for (let i = 0; i < a.length; i += 3) { a[i] = (a[i] - fx) * k; a[i + 1] = (a[i + 1] - minY) * k; a[i + 2] = (a[i + 2] - fz) * k; } });
}

/** a clump of stems from one foot (an areca palm): every primitive repeated, each copy leant out, turned, scaled and moved by its [dx, dz, scale, yawDeg, leanDeg] */
function clump(root, copies) {
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), idx = prim.getIndices();
    const n = pos.getCount(), pa = pos.getArray(), na = nor?.getArray(), ia = idx.getArray();
    const others = prim.listSemantics().filter((s) => s !== 'POSITION' && s !== 'NORMAL').map((s) => [s, prim.getAttribute(s)]);
    const P = new Float32Array(n * 3 * copies.length), N = na ? new Float32Array(n * 3 * copies.length) : null;
    const I = new Uint32Array(ia.length * copies.length);
    copies.forEach(([dx, dz, k, yawDeg, leanDeg], c) => {
      const y = (yawDeg * Math.PI) / 180, l = (leanDeg * Math.PI) / 180, cy = Math.cos(y), sy = Math.sin(y), cl = Math.cos(l), sl = Math.sin(l);
      const tf = (x, yy, z) => { const y2 = yy * cl - z * sl, z2 = yy * sl + z * cl; return [x * cy + z2 * sy, y2, -x * sy + z2 * cy]; };
      for (let v = 0; v < n; v++) {
        const [x, yy, z] = tf(pa[v * 3] * k, pa[v * 3 + 1] * k, pa[v * 3 + 2] * k);
        P.set([x + dx, yy, z + dz], (c * n + v) * 3);
        if (N) N.set(tf(na[v * 3], na[v * 3 + 1], na[v * 3 + 2]), (c * n + v) * 3);
      }
      for (let i = 0; i < ia.length; i++) I[c * ia.length + i] = ia[i] + c * n;
    });
    pos.setArray(P); if (N) nor.setArray(N);
    for (const [, a] of others) { const src = a.getArray(); const out = new src.constructor(src.length * copies.length); for (let c = 0; c < copies.length; c++) out.set(src, c * src.length); a.setArray(out); }
    idx.setArray(I);
  }
}

/** splits a single-material model into parts by where each triangle's middle is: [[part, { maxY?, minY?, maxR?, minR? }], ...], first match wins,
 *  the last part takes the rest (a parasol drawn as one mesh: its base, its pole and its canopy). Each part gets its own copy of the material. */
function split(doc, root, rules) {
  for (const mesh of root.listMeshes()) for (const prim of [...mesh.listPrimitives()]) {
    const pa = prim.getAttribute('POSITION').getArray(), ia = prim.getIndices().getArray();
    const lists = rules.map(() => []);
    for (let t = 0; t < ia.length; t += 3) {
      let x = 0, y = 0, z = 0; for (let k = 0; k < 3; k++) { x += pa[ia[t + k] * 3]; y += pa[ia[t + k] * 3 + 1]; z += pa[ia[t + k] * 3 + 2]; }
      x /= 3; y /= 3; z /= 3; const r = Math.hypot(x, z);
      const i = rules.findIndex(([, c]) => (c.maxY === undefined || y <= c.maxY) && (c.minY === undefined || y >= c.minY) && (c.maxR === undefined || r <= c.maxR) && (c.minR === undefined || r >= c.minR));
      lists[i < 0 ? rules.length - 1 : i].push(ia[t], ia[t + 1], ia[t + 2]);
    }
    rules.forEach(([part], i) => {
      if (!lists[i].length) return;
      const p2 = prim.clone(); const m2 = prim.getMaterial().clone(); m2.setName(part); p2.setMaterial(m2);
      p2.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(lists[i])).setBuffer(prim.getIndices().getBuffer()));
      mesh.addPrimitive(p2);
    });
    mesh.removePrimitive(prim);
  }
}

/** simplifies one primitive (meshoptimizer), keeping its UV seams */
function simplifyPrim(prim, ratio, error) {
  const idx = prim.getIndices(); if (!idx) return;
  const pos = prim.getAttribute('POSITION').getArray();
  const src = new Uint32Array(idx.getArray());
  const target = Math.max(3, Math.floor((src.length / 3) * ratio) * 3);
  let [out] = MeshoptSimplifier.simplify(src, pos instanceof Float32Array ? pos : new Float32Array(pos), 3, target, error, []);
  if (out.length > target * 1.5) [out] = MeshoptSimplifier.simplifySloppy ? MeshoptSimplifier.simplifySloppy(src, pos instanceof Float32Array ? pos : new Float32Array(pos), 3, null, target, error * 4) : [out];
  idx.setArray(prim.getAttribute('POSITION').getCount() > 65535 ? new Uint32Array(out) : new Uint16Array(out));
}

/** keeps a seeded share of a leaf primitive's cards (connected pieces), growing each kept one about its middle so the crown keeps its mass */
function thin(doc, prim, keep, seed, crownFrom = -Infinity) {
  if (keep >= 1 && crownFrom === -Infinity) return;
  const idx = prim.getIndices(); if (!idx) return;
  const ia = idx.getArray(); const pos = prim.getAttribute('POSITION'); const pa = pos.getArray().slice();
  const nv = pos.getCount();
  // union-find over vertices joined by a triangle (welded first, so a card is one piece)
  const par = new Int32Array(nv); for (let i = 0; i < nv; i++) par[i] = i;
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < ia.length; t += 3) { const a = find(ia[t]), b = find(ia[t + 1]), c = find(ia[t + 2]); par[b] = a; par[c] = a; }
  const r = rng(seed); const keepOf = new Map(); const cen = new Map();
  const low = new Map();
  for (let v = 0; v < nv; v++) { const root = find(v); low.set(root, Math.min(low.get(root) ?? Infinity, pa[v * 3 + 1])); }
  for (let v = 0; v < nv; v++) { const root = find(v); if (!keepOf.has(root)) keepOf.set(root, r() < keep && low.get(root) >= crownFrom); const c = cen.get(root) ?? [0, 0, 0, 0]; c[0] += pa[v * 3]; c[1] += pa[v * 3 + 1]; c[2] += pa[v * 3 + 2]; c[3]++; cen.set(root, c); }
  const grow = Math.min(1.5, 1 / Math.sqrt(Math.min(1, keep)));
  for (let v = 0; v < nv; v++) { const c = cen.get(find(v)); for (let k = 0; k < 3; k++) pa[v * 3 + k] = c[k] / c[3] + (pa[v * 3 + k] - c[k] / c[3]) * grow; }
  pos.setArray(pa);
  const out = []; for (let t = 0; t < ia.length; t += 3) if (keepOf.get(find(ia[t]))) out.push(ia[t], ia[t + 1], ia[t + 2]);
  idx.setArray(nv > 65535 ? new Uint32Array(out) : new Uint16Array(out));
}

async function encodeTex(t, size, { alphaFromLuma = false, normal = false } = {}) {
  let img = sharp(Buffer.from(t.getImage())).resize(size, size, { fit: 'inside' });
  if (alphaFromLuma) {
    const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) { const l = Math.max(data[i], data[i + 1], data[i + 2]); data[i + 3] = l < 18 ? 0 : l < 40 ? Math.round(((l - 18) / 22) * 255) : 255; }
    img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  }
  const buf = await img.webp({ quality: normal ? 88 : 82, alphaQuality: 90, effort: 6 }).toBuffer();
  t.setImage(new Uint8Array(buf)); t.setMimeType('image/webp'); t.setURI('');
}

async function make(id, pick) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptEncoder });
  const facts = { kind: pick.kind, height: pick.height, parts: [], tiers: {} };
  for (const [tier, T] of Object.entries(TIERS)) {
    const doc = await io.read(path.join(RAW, pick.src));
    const root = doc.getRoot();
    await doc.transform(flatten());
    bake(root);
    const drop = pick.drop ? new RegExp(pick.drop, 'i') : null;
    const nameOf = (node, prim) => `${node.getName()} ${node.getMesh().getName()} ${prim.getMaterial()?.getName() ?? ''}`;
    const partFor = (s) => { for (const [re, part] of pick.parts) if (new RegExp(re, 'i').test(s)) return part; return pick.strict ? null : 'body'; };
    const partMap = new Map();
    for (const node of root.listNodes()) {
      const mesh = node.getMesh(); if (!mesh) continue;
      for (const prim of mesh.listPrimitives()) {
        const s = nameOf(node, prim);
        let part = drop && drop.test(s) ? null : partFor(s);
        // one object out of a set (a chair of a table-and-chairs): only the primitives whose middle is in the box (source units, after the bake)
        if (part && pick.keep) {
          const a = prim.getAttribute('POSITION').getArray(); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
          for (let i = 0; i < a.length; i += 3) { x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]); z0 = Math.min(z0, a[i + 2]); z1 = Math.max(z1, a[i + 2]); }
          const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
          if (!(cx >= pick.keep.x[0] && cx <= pick.keep.x[1] && cz >= pick.keep.z[0] && cz <= pick.keep.z[1])) part = null;
        }
        if (!part) { mesh.removePrimitive(prim); prim.dispose(); continue; }
        partMap.set(prim, part);
      }
    }
    place(root, pick, (prim) => partMap.get(prim));
    if (pick.clump) clump(root, pick.clump);
    // one mesh per part (by material), named by the part
    for (const [prim, part] of partMap) { const mat = prim.getMaterial(); if (mat) mat.setName(part); }
    await doc.transform(prune(), dedup(), weld());
    // after dedup, which would fold the split parts' identical materials back into one
    if (pick.split) split(doc, root, pick.split);
    const B = { ...T, ...(pick.tiers?.[tier] ?? {}) };
    for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
      const part = prim.getMaterial()?.getName();
      if ((pick.leaves ?? []).includes(part)) thin(doc, prim, B.leafKeep, 7 + id.length, pick.crownFrom ?? -Infinity);
      else if (B.simplify < 1) simplifyPrim(prim, B.simplify, pick.kind === 'plant' ? 0.03 : 0.004);
    }
    // materials: PBR as the app wants it (no metal-rough maps), alpha-tested leaves, double-sided cards
    const leafParts = new Set([...(pick.leaves ?? []), ...(pick.alphaParts ?? [])]);
    const lumaParts = new Set(pick.alphaFromLuma ?? []);
    const done = new Set();
    for (const mat of root.listMaterials()) {
      const part = mat.getName();
      mat.setMetallicRoughnessTexture(null); mat.setMetallicFactor(pick.metal?.[part] ?? Math.min(mat.getMetallicFactor(), 0.3)); mat.setRoughnessFactor(pick.rough?.[part] ?? 0.85);
      mat.setEmissiveTexture(null); mat.setEmissiveFactor([0, 0, 0]); mat.setOcclusionTexture(null);
      if (leafParts.has(part)) { mat.setAlphaMode('MASK'); mat.setAlphaCutoff(0.45); mat.setDoubleSided(true); }
      else if (mat.getAlphaMode() === 'BLEND' && !(pick.blend ?? []).includes(part)) mat.setAlphaMode('OPAQUE');
      if (!T.normals || pick.noNormals?.includes(part)) mat.setNormalTexture(null);
      if (pick.tint?.[part]) mat.setBaseColorFactor(pick.tint[part]);
      const bt = mat.getBaseColorTexture();
      if (bt && !done.has(bt)) { done.add(bt); await encodeTex(bt, leafParts.has(part) ? T.leafTex : T.tex, { alphaFromLuma: lumaParts.has(part) }); }
      const nt = mat.getNormalTexture();
      if (nt && !done.has(nt)) { done.add(nt); await encodeTex(nt, Math.min(512, T.tex), { normal: true }); }
    }
    for (const node of root.listNodes()) { const mesh = node.getMesh(); if (mesh) { const n = mesh.listPrimitives()[0]?.getMaterial()?.getName() ?? 'part'; node.setName(n); mesh.setName(n); } }
    await doc.transform(prune());
    doc.createExtension(EXTTextureWebP).setRequired(true);
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const b = getBounds(root.listScenes()[0]);
    let tris = 0; for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
    const bytes = Buffer.from(await io.writeBinary(doc));
    const rel = `models/${id}${T.suffix}.glb`;
    fs.mkdirSync(path.join(OUT, 'models'), { recursive: true });
    fs.writeFileSync(path.join(OUT, rel), bytes);
    facts.tiers[tier] = { file: rel, bytes: bytes.length, tris: Math.round(tris) };
    facts.min = b.min.map((v) => +v.toFixed(3)); facts.max = b.max.map((v) => +v.toFixed(3));
    facts.parts = [...new Set(root.listMaterials().map((m) => m.getName()))].sort();
    const per = {}; for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) { const k = prim.getMaterial()?.getName(); per[k] = (per[k] ?? 0) + (prim.getIndices()?.getCount() ?? 0) / 3; }
    facts.tiers[tier].parts = per;
    console.log(id, tier, Math.round(tris), 'tris', bytes.length, 'bytes', JSON.stringify(per), facts.min, facts.max);
  }
  return facts;
}

const all = fs.existsSync(FACTS) ? JSON.parse(fs.readFileSync(FACTS, 'utf8')) : { generatedBy: 'tools/optimise-outdoor-models.mjs', models: {} };
for (const [id, pick] of Object.entries(PICKS)) {
  if (id.startsWith('_') || (ONLY && !ONLY.has(id))) continue;
  all.models[id] = await make(id, pick);
}
for (const id of Object.keys(all.models)) if (!PICKS[id]) delete all.models[id];
fs.writeFileSync(FACTS, JSON.stringify(all, null, 1) + '\n');
// the lock of every shipped file (the same walk as tools/optimise-outdoor-real.mjs)
const lockFile = path.join(OUT, 'files.lock.json');
const lock = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) : { generatedBy: 'tools/optimise-outdoor-real.mjs', files: {} };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
lock.generatedBy = 'tools/optimise-outdoor-real.mjs and tools/optimise-outdoor-models.mjs';
lock.files = {};
for (const f of walk(OUT).sort()) {
  const rel = path.relative(OUT, f); if (rel.endsWith('.json') || rel.endsWith('.txt')) continue;
  const b = fs.readFileSync(f); lock.files[rel] = { bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') };
}
fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
console.log('models', Object.keys(all.models).length, 'lock', Object.keys(lock.files).length);
