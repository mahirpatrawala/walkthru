// Turns the raw gym downloads (scripts/fetch-gym-assets.ts) into what ships (SPEC 16.17.1):
//   public/look/gym/tex/*.jpg          resized maps (leather grain normal, rubber floor colour and normal)
//   public/look/gym/models/<id>.glb    one object cut out of its source, in metres, centred, split into named parts, meshopt-compressed
//   public/look/gym/models/<id>.low.glb  the phone file (decimated)
//   src/look/gym/manifest.json         measured sizes, triangles and bytes of every output (the app and the tests read it)
//
//   node optimise-gym-assets.mjs <rawDir> <repo>
//
// Dev-only, like tools/optimise-look-models.mjs: copy it next to a scratch install of
//   @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
// (e.g. ~/walkthru-tools/gltf) and run it there. No textures ship in the models: every part takes the app's own materials (rubber, chrome,
// powder-coated iron), which keep the zoom test of SPEC 16.15.1 and the app's light; the source supplies the shape.
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { meshopt, flatten, join, weld as weldDoc, simplify as simplifyDoc, metalRough, textureCompress, prune, dedup, getBounds, transformMesh } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [rawDir, repo] = process.argv.slice(2);
const OUT = path.join(repo, 'public/look/gym');
fs.mkdirSync(path.join(OUT, 'tex'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'models'), { recursive: true });
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const outputs = {};

// ------------------------------------------------------------------ maps
const MAPS = [
  { src: 'leather_white/leather_white_nor_gl_1k.jpg', out: 'tex/leather_nor.jpg', size: 1024, q: 85 },
  { src: 'Rubber001/Rubber001_1K-JPG_NormalGL.jpg', out: 'tex/rubber_nor.jpg', size: 512, q: 86 },
  { src: 'Rubber001/Rubber001_1K-JPG_Color.jpg', out: 'tex/rubber_floor_diff.jpg', size: 1024, q: 82, lift: 0.36 },
];
for (const m of MAPS) {
  let img = sharp(path.join(rawDir, m.src)).resize(m.size, m.size);
  if (m.lift) {
    // the photographed EPDM is near black (mean about 0.1): lifted to a charcoal rubber floor of mean `lift`, flecks and all, so it is not a hole in the room
    const st = await sharp(path.join(rawDir, m.src)).stats();
    const mean = (st.channels[0].mean + st.channels[1].mean + st.channels[2].mean) / 3 / 255;
    const k = m.lift / mean;
    img = img.linear([k, k, k], [0, 0, 0]);
  }
  const buf = await img.jpeg({ quality: m.q, mozjpeg: true }).toBuffer();
  fs.writeFileSync(path.join(OUT, m.out), buf);
  outputs[m.out] = { bytes: buf.length, sha256: sha(buf) };
}

// ------------------------------------------------------------------ geometry helpers
/** every mesh primitive of a document as world-space triangles: { pos: Float32Array (xyz per vertex), uv, idx, material name, node name } */
async function readPrims(file) {
  const doc = await io.read(file);
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), U = prim.getAttribute('TEXCOORD_0'), I = prim.getIndices();
      const n = P.getCount(), pos = new Float32Array(n * 3), uv = U ? new Float32Array(n * 2) : null, e = [0, 0, 0], t = [0, 0];
      for (let i = 0; i < n; i++) {
        P.getElement(i, e);
        pos[i * 3] = M[0] * e[0] + M[4] * e[1] + M[8] * e[2] + M[12];
        pos[i * 3 + 1] = M[1] * e[0] + M[5] * e[1] + M[9] * e[2] + M[13];
        pos[i * 3 + 2] = M[2] * e[0] + M[6] * e[1] + M[10] * e[2] + M[14];
        if (U) { U.getElement(i, t); uv[i * 2] = t[0]; uv[i * 2 + 1] = t[1]; }
      }
      const idx = I ? Uint32Array.from(I.getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
      const mat = prim.getMaterial();
      out.push({ pos, uv, idx, material: mat?.getName() ?? '', node: node.getName(), tex: mat?.getBaseColorTexture() ?? null });
    }
  }
  return out;
}

/** keeps the triangles `keep(a, b, c)` says yes to, compacting the vertices */
function subset(p, keep) {
  const map = new Map(), pos = [], idx = [];
  for (let t = 0; t < p.idx.length; t += 3) {
    const tri = [p.idx[t], p.idx[t + 1], p.idx[t + 2]];
    if (!keep(...tri)) continue;
    for (const v of tri) {
      if (!map.has(v)) { map.set(v, pos.length / 3); pos.push(p.pos[v * 3], p.pos[v * 3 + 1], p.pos[v * 3 + 2]); }
      idx.push(map.get(v));
    }
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

/** welds coincident vertices (the source splits them along UV seams), so the simplifier and the normals see one surface */
function weld(g, eps = 1e-5) {
  const key = (i) => `${Math.round(g.pos[i * 3] / eps)},${Math.round(g.pos[i * 3 + 1] / eps)},${Math.round(g.pos[i * 3 + 2] / eps)}`;
  const map = new Map(), remap = new Uint32Array(g.pos.length / 3), pos = [];
  for (let i = 0; i < remap.length; i++) { const k = key(i); if (!map.has(k)) { map.set(k, pos.length / 3); pos.push(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]); } remap[i] = map.get(k); }
  const idx = [];
  for (let t = 0; t < g.idx.length; t += 3) { const a = remap[g.idx[t]], b = remap[g.idx[t + 1]], c = remap[g.idx[t + 2]]; if (a !== b && b !== c && a !== c) idx.push(a, b, c); }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

function simplify(g, targetTris, err = 0.02) {
  if (g.idx.length / 3 <= targetTris) return g;
  const [idx] = MeshoptSimplifier.simplify(g.idx, g.pos, 3, targetTris * 3, err, ['LockBorder']);
  return { pos: g.pos, idx: Uint32Array.from(idx) };
}

function transform(g, f) { const pos = new Float32Array(g.pos.length); for (let i = 0; i < g.pos.length; i += 3) { const r = f(g.pos[i], g.pos[i + 1], g.pos[i + 2]); pos[i] = r[0]; pos[i + 1] = r[1]; pos[i + 2] = r[2]; } return { pos, idx: g.idx }; }
function boundsOf(list) { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const g of list) for (let i = 0; i < g.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], g.pos[i + k]); mx[k] = Math.max(mx[k], g.pos[i + k]); } return { mn, mx }; }

/** smooth normals, but split where faces meet at more than `crease` degrees (the edges of a hex head stay crisp) */
function normalsCreased(g, crease = 40) {
  const fn = [], cos = Math.cos((crease * Math.PI) / 180);
  for (let t = 0; t < g.idx.length; t += 3) {
    const [a, b, c] = [g.idx[t], g.idx[t + 1], g.idx[t + 2]].map((v) => [g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1; fn.push([n[0] / l, n[1] / l, n[2] / l, Math.hypot(...n) / 2]);
  }
  const vf = new Map();
  for (let t = 0; t < g.idx.length; t++) { const v = g.idx[t]; if (!vf.has(v)) vf.set(v, []); vf.get(v).push(Math.floor(t / 3)); }
  const pos = [], nor = [], idx = [];
  for (let t = 0; t < g.idx.length; t++) {
    const v = g.idx[t], f = fn[Math.floor(t / 3)], n = [0, 0, 0];
    for (const o of vf.get(v)) { const h = fn[o]; if (h[0] * f[0] + h[1] * f[1] + h[2] * f[2] >= cos) { n[0] += h[0] * h[3]; n[1] += h[1] * h[3]; n[2] += h[2] * h[3]; } }
    const l = Math.hypot(...n) || 1;
    pos.push(g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]); nor.push(n[0] / l, n[1] / l, n[2] / l); idx.push(t);
  }
  // re-weld identical position+normal pairs
  const map = new Map(), P = [], N = [], I = [];
  for (let i = 0; i < idx.length; i++) {
    const k = `${pos[i * 3].toFixed(5)},${pos[i * 3 + 1].toFixed(5)},${pos[i * 3 + 2].toFixed(5)},${nor[i * 3].toFixed(3)},${nor[i * 3 + 1].toFixed(3)},${nor[i * 3 + 2].toFixed(3)}`;
    if (!map.has(k)) { map.set(k, P.length / 3); P.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); N.push(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]); }
    I.push(map.get(k));
  }
  return { pos: new Float32Array(P), nor: new Float32Array(N), idx: new Uint32Array(I) };
}

async function writeModel(id, tier, parts) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  let tris = 0;
  for (const [name, g0] of Object.entries(parts)) {
    const g = normalsCreased(g0);
    tris += g.idx.length / 3;
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(g.pos).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(g.nor).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(g.pos.length / 3 > 65535 ? g.idx : Uint16Array.from(g.idx)).setBuffer(buffer))
      .setMaterial(doc.createMaterial(name));
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  }
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = `models/${id}${tier === 'low' ? '.low' : ''}.glb`;
  const buf = Buffer.from(await io.writeBinary(doc));
  fs.writeFileSync(path.join(OUT, file), buf);
  outputs[file] = { bytes: buf.length, sha256: sha(buf) };
  return { file, bytes: buf.length, tris };
}

const manifest = { generatedBy: 'tools/optimise-gym-assets.mjs', maps: Object.fromEntries(MAPS.map((m) => [m.out, outputs[m.out].bytes])), models: {} };

// ------------------------------------------------------------------ the hex dumbbell (Weight Room Set 2, Tytan, CC BY 4.0)
{
  const prims = await readPrims(path.join(rawDir, 'sketchfab-fa481412927e43dfbeab9f6da464c15b/fa481412927e43dfbeab9f6da464c15b.glb'));
  // the set has a rack, one long object of many dumbbells, and nine single dumbbells of 332 triangles: take the single one at the light end
  const singles = prims.filter((p) => p.material === 'Dumbbell' && p.idx.length / 3 < 600);
  const one = singles.sort((a, b) => boundsOf([a]).mx[0] - boundsOf([b]).mx[0]).at(-1);
  // each dumbbell of the set lies tilted (one head on the floor): find its long axis by principal components and turn it onto x, centred on the origin
  const n = one.pos.length / 3, c = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += one.pos[i * 3 + k] / n;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) { const d = [0, 1, 2].map((k) => one.pos[i * 3 + k] - c[k]); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b]; }
  let ax = [1, 1, 1];
  for (let it = 0; it < 60; it++) { const v = [0, 1, 2].map((a) => C[a][0] * ax[0] + C[a][1] * ax[1] + C[a][2] * ax[2]); const l = Math.hypot(...v); ax = v.map((x) => x / l); }
  // a frame (ax, up, side) with `up` as close to world y as it can be
  let up = [0, 1, 0]; const dot = up[0] * ax[0] + up[1] * ax[1] + up[2] * ax[2]; up = up.map((u, k) => u - dot * ax[k]); { const l = Math.hypot(...up); up = up.map((u) => u / l); }
  const side = [ax[1] * up[2] - ax[2] * up[1], ax[2] * up[0] - ax[0] * up[2], ax[0] * up[1] - ax[1] * up[0]];
  const toX = (x, y, z) => { const d = [x - c[0], y - c[1], z - c[2]]; const f = (v) => v[0] * d[0] + v[1] * d[1] + v[2] * d[2]; return [f(ax), f(up), f(side)]; };
  const all = transform({ pos: one.pos, idx: one.idx }, toX);
  // re-centre along x (the heads are equal), then the chrome handle is every triangle closer to the axis than 60 % of the head's radius
  const bb = boundsOf([all]);
  const mid = (bb.mn[0] + bb.mx[0]) / 2;
  const centred = transform(all, (x, y, z) => [x - mid, y, z]);
  const rOf = (v) => Math.hypot(centred.pos[v * 3 + 1], centred.pos[v * 3 + 2]);
  let rMax = 0; for (let v = 0; v < n; v++) rMax = Math.max(rMax, rOf(v));
  const thin = (a, b, cc) => Math.max(rOf(a), rOf(b), rOf(cc)) < rMax * 0.6;
  let head = subset(centred, (a, b, cc) => !thin(a, b, cc)), handle = subset(centred, thin);
  head = weld(head); handle = weld(handle);
  // the source keeps one head of every dumbbell with its handle (the other heads were merged into another object of the set): the second head is
  // this one mirrored about the middle of the bare handle, so the grip between the heads is the source's own length
  {
    const hb0 = boundsOf([head]), gb0 = boundsOf([handle]);
    const atRight = hb0.mx[0] > gb0.mx[0];
    const m = atRight ? (gb0.mn[0] + hb0.mn[0]) / 2 : (gb0.mx[0] + hb0.mx[0]) / 2;
    const mirrored = transform(head, (x, y, z) => [2 * m - x, y, z]);
    const flipped = new Uint32Array(mirrored.idx.length);
    for (let t = 0; t < flipped.length; t += 3) { flipped[t] = mirrored.idx[t]; flipped[t + 1] = mirrored.idx[t + 2]; flipped[t + 2] = mirrored.idx[t + 1]; }
    const both = { pos: new Float32Array([...head.pos, ...mirrored.pos]), idx: new Uint32Array([...head.idx, ...Array.from(flipped, (v) => v + head.pos.length / 3)]) };
    const bx = boundsOf([both, handle]), cxm = (bx.mn[0] + bx.mx[0]) / 2;
    head = transform(both, (x, y, z) => [x - cxm, y, z]); handle = transform(handle, (x, y, z) => [x - cxm, y, z]);
  }
  const b = boundsOf([head, handle]);
  const full = await writeModel('dumbbell', 'full', { head, handle });
  const low = await writeModel('dumbbell', 'low', { head: simplify(head, 140, 0.05), handle: simplify(handle, 24, 0.05) });
  const hb = boundsOf([head]), gb = boundsOf([handle]);
  manifest.models.dumbbell = {
    source: 'sketchfab-fa481412927e43dfbeab9f6da464c15b',
    dims: { len: +(b.mx[0] - b.mn[0]).toFixed(4), headR: +((hb.mx[1] - hb.mn[1]) / 2).toFixed(4), handleR: +((gb.mx[1] - gb.mn[1]) / 2).toFixed(4) },
    files: { full: { file: full.file, bytes: full.bytes }, low: { file: low.file, bytes: low.bytes } }, tris: { full: full.tris, low: low.tris }, parts: ['head', 'handle'],
  };
}

// ------------------------------------------------------------------ the kettlebell (anesbe89, CC BY 4.0)
{
  const prims = await readPrims(path.join(rawDir, 'sketchfab-2e09cbcbde964a658d51838e2f9866bb/2e09cbcbde964a658d51838e2f9866bb.glb'));
  const bodyP = prims.find((p) => /Black/.test(p.material)), bandP = prims.find((p) => /Color/.test(p.material));
  let body = weld({ pos: bodyP.pos, idx: bodyP.idx }), band = weld({ pos: bandP.pos, idx: bandP.idx });
  // origin at the middle of its foot, y up, in metres of a 1-unit-high bell (the app scales it to each weight's height)
  const { mn, mx } = boundsOf([body, band]);
  const h = mx[1] - mn[1], cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
  const norm = (x, y, z) => [(x - cx) / h, (y - mn[1]) / h, (z - cz) / h];
  body = transform(body, norm); band = transform(band, norm);
  const full = await writeModel('kettlebell', 'full', { body: simplify(body, 1400, 0.004), band: simplify(band, 260, 0.004) });
  const low = await writeModel('kettlebell', 'low', { body: simplify(body, 360, 0.02), band: simplify(band, 80, 0.02) });
  const b = boundsOf([body, band]);
  manifest.models.kettlebell = {
    source: 'sketchfab-2e09cbcbde964a658d51838e2f9866bb',
    dims: { w: +(b.mx[0] - b.mn[0]).toFixed(4), h: +(b.mx[1] - b.mn[1]).toFixed(4), d: +(b.mx[2] - b.mn[2]).toFixed(4) },
    files: { full: { file: full.file, bytes: full.bytes }, low: { file: low.file, bytes: low.bytes } }, tris: { full: full.tris, low: low.tris }, parts: ['body', 'band'],
  };
}

// ------------------------------------------------------------------ textured models of the games room (SPEC 16.17.2): kept with their own maps
/**
 * One textured model: every mesh joined by material, welded, simplified to `ratio` (per tier), spec-gloss converted to metal-rough, maps to WebP
 * at `tex` px, then moved so the origin is the centre of its footprint on its lowest point, scaled to metres by `scale`. Writes <id>.glb and
 * <id>.low.glb and returns the measured size.
 */
async function texturedModel(id, src, o) {
  const out = {};
  for (const tier of ['full', 'low']) {
    const doc = await io.read(src);
    for (const n of doc.getRoot().listNodes()) if (o.drop && o.drop.test(n.getName() + ' ' + (n.getMesh()?.listPrimitives()[0]?.getMaterial()?.getName() ?? ''))) n.dispose();
    if (tier === 'low') for (const m of doc.getRoot().listMaterials()) { m.setNormalTexture(null); m.setOcclusionTexture(null); m.setMetallicRoughnessTexture(null); } // a phone gets the colour maps only
    await doc.transform(prune(), metalRough(), flatten(), join({ keepNamed: false }), weldDoc(), simplifyDoc({ simplifier: MeshoptSimplifier, ratio: o.ratio[tier], error: o.error ?? 0.002 }), dedup(), prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [o.tex[tier], o.tex[tier]], quality: 82 }));
    // place: footprint centre on the origin, lowest point on y = 0, metres
    const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
    const b = getBounds(scene);
    const k = o.scale ?? 1, cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const M = [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, -cx * k, -b.min[1] * k, -cz * k, 1];
    for (const n of doc.getRoot().listNodes()) { const m = n.getMesh(); if (m) { const W = n.getWorldMatrix(); const mul = (A, B) => { const C = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let q = 0; q < 4; q++) C[j * 4 + i] += A[q * 4 + i] * B[j * 4 + q]; return C; }; transformMesh(m, mul(M, W)); } n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]); }
    for (const n of doc.getRoot().listNodes()) if (!n.getMesh() && n.listChildren().length === 0) n.dispose();
    let tris = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const file = `models/${id}${tier === 'low' ? '.low' : ''}.glb`;
    const buf = Buffer.from(await io.writeBinary(doc));
    fs.writeFileSync(path.join(OUT, file), buf);
    outputs[file] = { bytes: buf.length, sha256: sha(buf) };
    const bb = getBounds(doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0]);
    out[tier] = { file, bytes: buf.length, tris, dims: { w: +(bb.max[0] - bb.min[0]).toFixed(4), h: +(bb.max[1] - bb.min[1]).toFixed(4), d: +(bb.max[2] - bb.min[2]).toFixed(4) } };
  }
  manifest.models[id] = { source: o.source, textured: true, dims: out.full.dims, files: { full: { file: out.full.file, bytes: out.full.bytes }, low: { file: out.low.file, bytes: out.low.bytes } }, tris: { full: out.full.tris, low: out.low.tris }, parts: [] };
}

// the chess set (Poly Haven, CC0): board and men as modelled, the board 0.52 m across in the source
await texturedModel('chess', path.join(rawDir, 'chess_set/chess_set_1k.gltf'), { source: 'chess_set', ratio: { full: 0.12, low: 0.04 }, tex: { full: 512, low: 256 }, error: 0.01 });

fs.mkdirSync(path.join(repo, 'src/look/gym'), { recursive: true });
fs.writeFileSync(path.join(repo, 'src/look/gym/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
// the SHA-256 of every output goes into the lock, next to its sources
const lockPath = path.join(OUT, 'gym.lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
lock.outputs = outputs;
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 1));
