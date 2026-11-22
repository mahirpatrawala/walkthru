// Turns the raw downloads of scripts/fetch-home-models.ts into what ships for the flats (SPEC 16.15.4):
//   public/look/home/models/<id>.glb       medium and high tiers: named parts, source maps as WebP (colour, normal, metal-rough) at 1024 px
//   public/look/home/models/<id>.low.glb   the phone file: fewer triangles, the colour map only, at 512 px
//   src/look/models/home-manifest.json     measured sizes (metres, front +Z, origin at the centre of the footprint on the floor), surface heights,
//                                          triangles per part and tier, bytes; the model library reads it (src/look/models/library.ts)
// and the SHA-256 of every output into public/look/home/home.lock.json (`outputs`).
//
//   node optimise-home-models.mjs <rawDir> <repo>
//
// Dev-only, like tools/optimise-gym-assets.mjs: copy or link it next to a scratch install of
//   @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
// and run it there. Nothing from a download is executed: the GLBs are parsed as data.
//
// What it does to each model, in order: bake every node transform into the vertices; drop the parts the config drops (bedding of a bed frame, a
// second copy, glass, hoses); turn it so its back faces -Z (found from where its tall parts are, or given); mirror it if asked (an L sofa's
// chaise goes to the right, where the generator puts it); scale it to metres (the source's units vary: a given real width, height or depth);
// put the centre of its footprint on the origin and its lowest point on y = 0; split it into named parts (by material, node or connected
// piece); simplify each tier (meshopt; the box can only shrink, never grow, so a model scaled to its box never sticks out of it); WebP maps.
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, weld, simplify, textureCompress, prune, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [rawDir, repo] = process.argv.slice(2);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const OUT = path.join(repo, 'public/look/home');
fs.mkdirSync(path.join(OUT, 'models'), { recursive: true });
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// plain materials for parts whose source map adds nothing a plain PBR colour does not (glazed ceramic, chrome, enamel, glass top)
const PLAIN = {
  ceramic: { color: [0.94, 0.94, 0.93, 1], metal: 0, rough: 0.12 },
  chrome: { color: [0.82, 0.83, 0.85, 1], metal: 1, rough: 0.12 },
  steel: { color: [0.74, 0.75, 0.76, 1], metal: 1, rough: 0.32 },
  black: { color: [0.03, 0.03, 0.035, 1], metal: 0.2, rough: 0.35 },
  blackGlass: { color: [0.02, 0.02, 0.025, 1], metal: 0, rough: 0.06 },
  iron: { color: [0.06, 0.06, 0.06, 1], metal: 0.6, rough: 0.45 },
  white: { color: [0.92, 0.92, 0.9, 1], metal: 0, rough: 0.55 },
};

/**
 * Per model. `uid`: the Objaverse/Sketchfab id (raw file glb/<uid>.glb). `keep(node, material, bbox)`: which source meshes stay (default all).
 * `back`: 'auto' (the side its tall parts are on) or degrees to turn. `mirror`: flip x. `size`: one real dimension in metres ({ w } | { h } | { d }).
 * `part(node, material, comp)`: the part a source piece belongs to (`comp` is a connected piece's bbox in metres, origin as shipped), null drops it.
 * `plain`: part -> a PLAIN material (the source maps are not kept). `budget`: triangles per tier. `probe`: where the seat, rim, deck or top is
 * measured: x and z as fractions of the half width and half depth (+z is the front), the highest surface there below `below` (a fraction of the height).
 */
const MODELS = [
  {
    // the source is in centimetre-like units with no stated scale: 2.10 m wide gives a 0.90 m back and a 0.42 m seat, an ordinary 3-seater
    id: 'sofa_3s_midcentury', uid: '1f9f52ae17d642b582d0c5ccf9dd64b3', back: 0, size: { w: 2.1 },
    part: (n, m, c) => (c.max[1] < 0.13 ? 'legs' : 'fabric'), budget: { full: 5400, low: 2600 }, probe: { x: 0, z: 0.25, below: 0.75 },
  },
  {
    // unitless source: 1.65 m wide gives a 0.78 m back and a 0.42 m seat
    id: 'sofa_2s_grey', uid: '03550a3529c24611a12aa158747374e0', back: 'auto', size: { w: 1.65 },
    part: (n, m, c) => (c.max[1] < 0.12 ? 'legs' : 'fabric'), budget: { full: 9000, low: 3200 }, probe: { x: 0.25, z: 0.25, below: 0.75 },
  },
  {
    // unitless source (1 x 1 x 0.95): 0.85 m wide gives a 0.80 m back and a 0.40 m seat
    id: 'armchair_tub', uid: 'ec62634ebb5a41f491bbb9da04cd9dd1', back: 0, size: { w: 0.85 },
    part: (n, m, c) => (c.max[1] < 0.2 && c.max[0] - c.min[0] < 0.1 && c.max[2] - c.min[2] < 0.1 ? 'legs' : 'fabric'), budget: { full: 9000, low: 3000 }, tex: { full: 512, low: 256 }, probe: { x: 0, z: 0.25, below: 0.75 },
  },
  {
    // unitless source; the lid stands open above the cistern in the source and is left out (a lid up would make the piece 10 cm taller than its box)
    id: 'wc_floor', uid: 'adb3b931f3ef4941830eea9705657a3d', back: 'auto', size: { w: 0.4 },
    part: (n, m, c) => (/02___/.test(m) && c.max[1] > 0.72 ? null : /02___/.test(m) ? 'seat' : 'pan'),
    plain: { pan: 'ceramic', seat: 'ceramic' }, budget: { full: 8000, low: 2600 }, probe: { x: 0.6, z: 0.84, below: 0.7 },
  },
  {
    // the source is in centimetres (61 cm wide): kept at that real size
    id: 'basin_wall', uid: '6f5a66deecf348c1a6ebed0ce38b810d', back: 'auto', size: { w: 0.6109 },
    part: (n, m, c) => (/Faucet/.test(n) ? 'tap' : c.max[1] - c.min[1] > 0 && c.min[1] < 0.25 && c.max[0] - c.min[0] < 0.12 ? 'trap' : 'bowl'),
    plain: { bowl: 'ceramic', tap: 'chrome', trap: 'chrome' }, budget: { full: 5000, low: 1800 }, probe: { x: 0, z: 0.85, below: 1 },
  },
  {
    // the frame and headboard of an upholstered bed; its mattress, duvet and pillows are left out (the generated bedding of SPEC 16.23 goes on it)
    id: 'bed_frame_soho', uid: '97e361e8beda4112ac5b1b5bcd388cdf', back: 'auto', size: { w: 1.80 },
    keep: (n, m) => /Soho_180_001/.test(m), part: () => 'frame', budget: { full: 9000, low: 2600 }, probe: { x: 0, z: 0.1, below: 0.6 },
  },
  {
    id: 'hob_4_glass', uid: '0a9441fbe4bd47b990e17dab99267d40', back: 0, size: { w: 0.75 },
    part: (n, m) => (/004/.test(m) ? 'grates' : /011/.test(m) ? 'trim' : 'glass'), plain: { grates: 'iron' }, budget: { full: 6000, low: 2500 }, error: { full: 0.01, low: 0.08 }, tex: { full: 512, low: 256 }, noLow: true, decor: true,
  },
  {
    id: 'hood_chimney', uid: 'e846cb48e88446808af55976ff76b1da', back: 0, size: { w: 0.762 },
    part: (n, m, c) => (/light/.test(m) ? 'lights' : c.min[1] > 0.2 ? 'flue' : 'canopy'), plain: { canopy: 'steel', flue: 'steel', lights: 'white' },
    budget: { full: 4000, low: 1400 }, decor: true, splitY: 0.22,
  },
];

// ------------------------------------------------------------------ reading a source as triangles
const mul = (A, B) => { const C = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let q = 0; q < 4; q++) C[j * 4 + i] += A[q * 4 + i] * B[j * 4 + q]; return C; };

/** every primitive in world space: positions, normals, uvs, indices, its node and material names, the material itself */
async function readSource(file) {
  const doc = await io.read(file);
  const prims = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), U = prim.getAttribute('TEXCOORD_0'), I = prim.getIndices();
      const n = P.getCount(), pos = new Float64Array(n * 3), nor = N ? new Float64Array(n * 3) : null, uv = U ? new Float32Array(n * 2) : null, e = [0, 0, 0], t = [0, 0];
      for (let i = 0; i < n; i++) {
        P.getElement(i, e);
        for (let k = 0; k < 3; k++) pos[i * 3 + k] = M[k] * e[0] + M[4 + k] * e[1] + M[8 + k] * e[2] + M[12 + k];
        if (N) { N.getElement(i, e); for (let k = 0; k < 3; k++) nor[i * 3 + k] = M[k] * e[0] + M[4 + k] * e[1] + M[8 + k] * e[2]; }
        if (U) { U.getElement(i, t); uv[i * 2] = t[0]; uv[i * 2 + 1] = t[1]; }
      }
      const idx = I ? Uint32Array.from(I.getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
      const mat = prim.getMaterial();
      prims.push({ pos, nor, uv, idx, node: node.getName() || mesh.getName() || '', material: mat?.getName() ?? '', mat });
    }
  }
  return { doc, prims };
}

function bboxOf(pos, idx) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const visit = (v) => { for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[v * 3 + k]); mx[k] = Math.max(mx[k], pos[v * 3 + k]); } };
  if (idx) for (const v of idx) visit(v); else for (let v = 0; v < pos.length / 3; v++) visit(v);
  return { min: mn, max: mx };
}

/** connected pieces of a primitive (vertices at the same place count as joined): per triangle, its piece */
function pieces(p) {
  const n = p.pos.length / 3, parent = new Int32Array(n).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const key = new Map();
  for (let i = 0; i < n; i++) { const k = `${Math.round(p.pos[i * 3] * 1e5)},${Math.round(p.pos[i * 3 + 1] * 1e5)},${Math.round(p.pos[i * 3 + 2] * 1e5)}`; if (key.has(k)) unite(i, key.get(k)); else key.set(k, i); }
  for (let t = 0; t < p.idx.length; t += 3) { unite(p.idx[t], p.idx[t + 1]); unite(p.idx[t], p.idx[t + 2]); }
  const triPiece = new Int32Array(p.idx.length / 3);
  for (let t = 0; t < triPiece.length; t++) triPiece[t] = find(p.idx[t * 3]);
  return triPiece;
}

// ------------------------------------------------------------------ the shipped frame
function transformAll(prims, f, fn) {
  for (const p of prims) {
    for (let i = 0; i < p.pos.length; i += 3) { const r = f(p.pos[i], p.pos[i + 1], p.pos[i + 2]); p.pos[i] = r[0]; p.pos[i + 1] = r[1]; p.pos[i + 2] = r[2]; }
    if (p.nor && fn) for (let i = 0; i < p.nor.length; i += 3) { const r = fn(p.nor[i], p.nor[i + 1], p.nor[i + 2]); const l = Math.hypot(...r) || 1; p.nor[i] = r[0] / l; p.nor[i + 1] = r[1] / l; p.nor[i + 2] = r[2] / l; }
  }
}
function boundsAll(prims) { const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; for (const p of prims) { const q = bboxOf(p.pos, p.idx); for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], q.min[k]); b.max[k] = Math.max(b.max[k], q.max[k]); } } return b; }

/** the direction (in the floor plane) from the middle of the model to its tall parts: that is its back */
function backAngle(prims) {
  const b = boundsAll(prims), h = b.max[1] - b.min[1], cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  let sx = 0, sz = 0, n = 0;
  for (const p of prims) for (let i = 0; i < p.pos.length; i += 3) if (p.pos[i + 1] > b.min[1] + 0.8 * h) { sx += p.pos[i] - cx; sz += p.pos[i + 2] - cz; n++; }
  // snap to the nearest quarter turn: sources are modelled square to their axes
  const a = Math.atan2(sx / n, sz / n);
  return Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
}

/** the height of the highest surface over a point (a ray straight down), below `limit` */
function probeHeight(prims, x, z, limit) {
  let best = -Infinity;
  for (const p of prims) for (let t = 0; t < p.idx.length; t += 3) {
    const a = p.idx[t], b = p.idx[t + 1], c = p.idx[t + 2];
    const ax = p.pos[a * 3], az = p.pos[a * 3 + 2], bx = p.pos[b * 3], bz = p.pos[b * 3 + 2], cx = p.pos[c * 3], cz = p.pos[c * 3 + 2];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const y = l1 * p.pos[a * 3 + 1] + l2 * p.pos[b * 3 + 1] + l3 * p.pos[c * 3 + 1];
    if (y < limit && y > best) best = y;
  }
  return best;
}

// ------------------------------------------------------------------ writing a tier
async function imageStats(bytes) {
  const { data, info } = await sharp(Buffer.from(bytes)).resize(128, 128, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = []; for (let i = 0; i < data.length; i += info.channels) L.push((0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255);
  const mean = L.reduce((a, b) => a + b, 0) / L.length;
  const sd = Math.sqrt(L.reduce((a, b) => a + (b - mean) ** 2, 0) / L.length);
  return { mean, cv: mean > 0 ? sd / mean : 0 };
}

async function writeTier(cfg, parts, tier) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();
  const texCache = new Map();
  const tex = (t) => { if (!t) return null; if (texCache.has(t)) return texCache.get(t); const x = doc.createTexture(t.getName()).setImage(t.getImage()).setMimeType(t.getMimeType()); texCache.set(t, x); return x; };
  for (const [name, g] of Object.entries(parts)) {
    const mat = doc.createMaterial(name);
    const plain = cfg.plain?.[name];
    if (plain) {
      const p = PLAIN[plain];
      mat.setBaseColorFactor(p.color).setMetallicFactor(p.metal).setRoughnessFactor(p.rough);
    } else {
      const src = g.mat;
      mat.setBaseColorFactor(src?.getBaseColorFactor() ?? [1, 1, 1, 1]).setMetallicFactor(Math.min(src?.getMetallicFactor() ?? 0, src?.getMetallicRoughnessTexture() ? 1 : 0.1)).setRoughnessFactor(src?.getRoughnessFactor() ?? 0.8);
      if (src?.getBaseColorTexture()) mat.setBaseColorTexture(tex(src.getBaseColorTexture()));
      if (tier === 'full' && src?.getNormalTexture()) mat.setNormalTexture(tex(src.getNormalTexture()));
      if (tier === 'full' && src?.getMetallicRoughnessTexture()) mat.setMetallicRoughnessTexture(tex(src.getMetallicRoughnessTexture()));
      // a textured part is fabric, wood or plastic: no metal (several sources export metallic 1 with a packed map, which renders a sofa as dark lacquer)
      mat.setMetallicFactor(0);
    }
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.pos)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(g.idx)).setBuffer(buffer))
      .setMaterial(mat);
    if (g.nor) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.nor)).setBuffer(buffer));
    if (g.uv && !plain) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(g.uv)).setBuffer(buffer));
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  }
  const total = Object.values(parts).reduce((a, g) => a + g.idx.length / 3, 0);
  const ratio = Math.min(1, cfg.budget[tier] / total);
  await doc.transform(weld(), ...(ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: cfg.error?.[tier] ?? (tier === 'full' ? 0.004 : 0.012) })] : []), dedup(), prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: Array(2).fill(cfg.tex?.[tier] ?? (tier === 'full' ? 1024 : 512)), quality: tier === 'full' ? 82 : 74 }));
  const out = { tris: 0, parts: {} };
  for (const node of doc.getRoot().listNodes()) {
    const p = node.getMesh()?.listPrimitives()[0]; if (!p) continue;
    const t = p.getIndices().getCount() / 3;
    out.tris += t; out.parts[node.getName()] = t;
  }
  const b = boundsAll(doc.getRoot().listNodes().filter((n) => n.getMesh()).map((n) => { const p = n.getMesh().listPrimitives()[0]; return { pos: p.getAttribute('POSITION').getArray(), idx: p.getIndices().getArray() }; }));
  out.box = b;
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = `models/${cfg.id}${tier === 'low' ? '.low' : ''}.glb`;
  const buf = Buffer.from(await io.writeBinary(doc));
  fs.writeFileSync(path.join(OUT, file), buf);
  return { ...out, file, bytes: buf.length, sha256: sha(buf) };
}

// ------------------------------------------------------------------ main
const manifestPath = path.join(repo, 'src/look/models/home-manifest.json');
// a full run starts both from empty (a model dropped from the list leaves nothing behind); `ONLY=a,b` redoes those and keeps the rest
const manifest = ONLY && fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { version: 1, generatedBy: 'tools/optimise-home-models.mjs', models: {} };
const lockPath = path.join(OUT, 'home.lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
if (!ONLY) lock.outputs = {};
lock.outputs ??= {};

for (const cfg of MODELS) {
  if (ONLY && !ONLY.has(cfg.id)) continue;
  const { prims: all } = await readSource(path.join(rawDir, 'glb', `${cfg.uid}.glb`));
  let prims = all.filter((p) => !cfg.keep || cfg.keep(p.node, p.material, bboxOf(p.pos, p.idx)));
  // turn: the back to -Z
  let a = typeof cfg.back === 'number' ? (cfg.back * Math.PI) / 180 : -backAngle(prims) + Math.PI;
  // a turn of `a` about +Y; then the mirror
  const ca = Math.cos(a), sa = Math.sin(a), mx = cfg.mirror ? -1 : 1;
  const rot = (x, y, z) => [mx * (x * ca + z * sa), y, -x * sa + z * ca];
  transformAll(prims, rot, rot);
  if (cfg.mirror) for (const p of prims) for (let t = 0; t < p.idx.length; t += 3) { const s = p.idx[t + 1]; p.idx[t + 1] = p.idx[t + 2]; p.idx[t + 2] = s; }
  // metres, centred on the footprint, standing on y = 0
  let b = boundsAll(prims);
  const k = cfg.size.w ? cfg.size.w / (b.max[0] - b.min[0]) : cfg.size.h ? cfg.size.h / (b.max[1] - b.min[1]) : cfg.size.d / (b.max[2] - b.min[2]);
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, y0 = b.min[1];
  transformAll(prims, (x, y, z) => [(x - cx) * k, (y - y0) * k, (z - cz) * k], null);
  // parts: per connected piece (`part` sees the piece's box in metres)
  const parts = {};
  const add = (name, p, tris) => {
    // one material per part: a second source material under the same name becomes name-2
    let key = name;
    for (let i = 2; parts[key] && parts[key].mat !== p.mat; i++) key = `${name}-${i}`;
    const g = (parts[key] ??= { pos: [], nor: p.nor ? [] : null, uv: p.uv ? [] : null, idx: [], mat: p.mat, map: new Map(), src: p });
    for (const t of tris) for (let j = 0; j < 3; j++) {
      const v = p.idx[t * 3 + j];
      const mk = `${p.node}|${v}|${all.indexOf(p)}`;
      if (!g.map.has(mk)) {
        g.map.set(mk, g.pos.length / 3);
        g.pos.push(p.pos[v * 3], p.pos[v * 3 + 1], p.pos[v * 3 + 2]);
        if (g.nor) g.nor.push(p.nor ? p.nor[v * 3] : 0, p.nor ? p.nor[v * 3 + 1] : 1, p.nor ? p.nor[v * 3 + 2] : 0);
        if (g.uv) g.uv.push(p.uv ? p.uv[v * 2] : 0, p.uv ? p.uv[v * 2 + 1] : 0);
      }
      g.idx.push(g.map.get(mk));
    }
  };
  for (const p of prims) {
    const tp = pieces(p);
    const byPiece = new Map();
    for (let t = 0; t < tp.length; t++) { if (!byPiece.has(tp[t])) byPiece.set(tp[t], []); byPiece.get(tp[t]).push(t); }
    for (const tris of byPiece.values()) {
      const vs = new Set(); for (const t of tris) for (let j = 0; j < 3; j++) vs.add(p.idx[t * 3 + j]);
      const c = bboxOf(p.pos, [...vs]);
      if (cfg.splitY !== undefined) {
        // a piece that spans the split height is cut there by triangle (the hood's canopy and its flue are one piece in the source)
        const lo = [], hi = [];
        for (const t of tris) { const ys = [0, 1, 2].map((j) => p.pos[p.idx[t * 3 + j] * 3 + 1]); (Math.min(...ys) >= cfg.splitY - 1e-6 ? hi : lo).push(t); }
        for (const [list, cmin] of [[lo, 0], [hi, cfg.splitY + 0.001]]) if (list.length) { const name = cfg.part(p.node, p.material, { min: [c.min[0], cmin, c.min[2]], max: c.max }); if (name) add(name, p, list); }
        continue;
      }
      const name = cfg.part(p.node, p.material, c);
      if (name) add(name, p, tris);
    }
  }
  for (const g of Object.values(parts)) if (g.nor && g.nor.every((v, i) => (i % 3 === 1 ? v === 1 : v === 0))) g.nor = null;
  // measured on the source geometry as shipped (before simplification): the size every fit decision uses
  b = boundsAll(Object.values(parts).map((g) => ({ pos: g.pos, idx: g.idx })));
  const dims = { w: b.max[0] - b.min[0], h: b.max[1] - b.min[1], d: b.max[2] - b.min[2] };
  let surfaceM;
  if (cfg.probe) surfaceM = probeHeight(Object.values(parts).map((g) => ({ pos: g.pos, idx: g.idx })), cfg.probe.x * dims.w / 2, cfg.probe.z * dims.d / 2, cfg.probe.below * dims.h + 1e-6);
  const full = await writeTier(cfg, parts, 'full');
  const low = await writeTier(cfg, parts, 'low');
  // no tier may reach past the measured box (simplification only removes vertices)
  for (const t of [full, low]) for (let q = 0; q < 3; q++) if (t.box.min[q] < b.min[q] - 1e-4 || t.box.max[q] > b.max[q] + 1e-4) throw new Error(`${cfg.id} ${t.file} grew past the measured box on axis ${q}`);
  const partFacts = {};
  for (const [name, g] of Object.entries(parts)) {
    const img = !cfg.plain?.[name] ? g.mat?.getBaseColorTexture()?.getImage() : null;
    const st = img ? await imageStats(img) : { mean: 0, cv: 0 };
    const col = cfg.plain?.[name] ? PLAIN[cfg.plain[name]].color : g.mat?.getBaseColorFactor() ?? [1, 1, 1, 1];
    partFacts[name] = { tris: { low: low.parts[name] ?? 0, full: full.parts[name] ?? 0 }, detailMean: +st.mean.toFixed(4), detailCv: +st.cv.toFixed(3), material: { baseColor: col.map((v) => +v.toFixed(3)) } };
  }
  manifest.models[cfg.id] = {
    id: cfg.id, source: `sketchfab-${cfg.uid}`, dir: 'home/models',
    // `noLow`: too heavy for a phone even simplified (a hob's grates are hundreds of separate bars): the phone keeps the generated piece
    files: { ...(cfg.noLow ? {} : { low: { file: low.file.replace('models/', ''), bytes: low.bytes } }), full: { file: full.file.replace('models/', ''), bytes: full.bytes } },
    parts: partFacts,
    dims: { w: +dims.w.toFixed(4), h: +dims.h.toFixed(4), d: +dims.d.toFixed(4) },
    ...(surfaceM !== undefined && Number.isFinite(surfaceM) ? { surfaceM: +surfaceM.toFixed(4) } : {}),
    tris: { low: low.tris, full: full.tris },
    place: 'floor',
  };
  lock.outputs[full.file] = { bytes: full.bytes, sha256: full.sha256 };
  if (cfg.noLow) { fs.rmSync(path.join(OUT, low.file), { force: true }); delete lock.outputs[low.file]; } else lock.outputs[low.file] = { bytes: low.bytes, sha256: low.sha256 };
  console.log(cfg.id, JSON.stringify(manifest.models[cfg.id].dims), 'surface', manifest.models[cfg.id].surfaceM, 'tris', full.tris, low.tris, 'bytes', full.bytes, low.bytes, Object.keys(parts).join(','));
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
