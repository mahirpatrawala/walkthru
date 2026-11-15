// Turns the raw Poly Haven downloads (scripts/fetch-look-models.ts) into the small GLBs the model library ships (SPEC 16.15).
//
//   MANIFEST_DIR=<repo>/src/look/models node optimise-look-models.mjs <rawDir> <repo>/public/look/models [id ...]
//
// Dev-only. Needs (not in package.json: copy this file next to a scratch install, e.g. ~/walkthru-tools/gltf, and run it there):
//   @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
// For each model it: bakes node transforms and a yaw into the vertices, puts the origin where the library expects it (floor models:
// centre of the footprint on y = 0, front +Z; wall models: bottom centre of the back face, front +Z), splits the mesh into the named PARTS
// the library recolours (src/look/models/library.ts), drops glass, simplifies each part for two tiers (`low` = phones, `full` = medium
// and high), resizes textures to WebP, drops the normal and roughness maps on `low`, and compresses with EXT_meshopt_compression.
// Writes <id>.low.glb and <id>.glb plus manifest.json (sizes in metres, per-part facts) into <outDir>.
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP } from '@gltf-transform/extensions';
import { flatten, meshopt, prune, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [rawDir, outDir, ...only] = process.argv.slice(2);
// manifest.json is imported by src/look/models/library.ts (Vite does not allow importing from public/): MANIFEST_DIR says where it lives
const manifestDir = process.env.MANIFEST_DIR || outDir;
fs.mkdirSync(outDir, { recursive: true });
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;

/**
 * Per model: `place` floor | wall, `yaw` (degrees about +Y to bring the front to +Z), `budget` triangles per tier, `tex` max texture edge per tier,
 * `classify(c)` names a part from a connected component (bbox, node name, material name), `drop` part names to leave out (glass),
 * `surfaceM` the height of the surface a person sits on or a thing is put on (measured here, see the manifest), `keepRough` keep the roughness map on low.
 */
const flat = (n) => () => n;
const CONFIG = {
  dining_chair_02: {
    place: 'floor', budget: { low: 2200, full: 6500 }, tex: { low: 512, full: 1024 }, surfaceM: 0.45,
    // wide components (the back panel and the seat) are upholstery, the thin posts and legs are the frame
    classify: (c) => (c.dx >= 0.1 && c.dy >= 0.01 ? 'fabric' : 'legs'),
  },
  side_table_01: { place: 'floor', budget: { low: 1400, full: 2800 }, tex: { low: 512, full: 1024 }, classify: flat('body'), surfaceM: 0.55 },
  modern_wooden_cabinet: {
    place: 'floor', budget: { low: 3500, full: 9000 }, tex: { low: 512, full: 1024 }, surfaceM: 0.68, relax: true,
    boxify: ['slats'],
    classify: (c, m, node) => (/door/.test(node) ? 'slats' : c.maxY <= 0.14 && c.dx <= 0.03 ? 'legs' : 'body'),
  },
  // the pebbles on the soil are 500 separate stones (66 000 triangles): left out, the soil under them stays
  potted_plant_01: { place: 'floor', budget: { low: 3800, full: 9000 }, tex: { low: 512, full: 1024 }, minTris: { pot: 700, leaves: 2500 }, drop: ['pebbles'], classify: (c, m, node) => (/pebbles/.test(node) ? 'pebbles' : /leaves/.test(m) ? 'leaves' : 'pot') },
  potted_plant_02: { place: 'floor', budget: { low: 3200, full: 8000 }, tex: { low: 512, full: 1024 }, minTris: { pot: 700, leaves: 1800 }, classify: (c, m) => (/leaves/.test(m) ? 'leaves' : 'pot') },
  jug_01: { place: 'floor', budget: { low: 900, full: 2600 }, tex: { low: 256, full: 512 }, classify: flat('body') },
  ceramic_vase_01: { place: 'floor', budget: { low: 700, full: 2000 }, tex: { low: 256, full: 512 }, classify: flat('body') },
  ceramic_vase_02: { place: 'floor', budget: { low: 700, full: 2000 }, tex: { low: 256, full: 512 }, classify: flat('body') },
  ceramic_vase_04: { place: 'floor', budget: { low: 700, full: 2000 }, tex: { low: 256, full: 512 }, classify: flat('body') },
  wooden_bowl_01: { place: 'floor', budget: { low: 800, full: 2400 }, tex: { low: 256, full: 512 }, classify: flat('body') },
  food_apple_01: { place: 'floor', budget: { low: 450, full: 1100 }, tex: { low: 128, full: 256 }, classify: flat('body') },
  lemon: { place: 'floor', budget: { low: 450, full: 1100 }, tex: { low: 128, full: 256 }, classify: flat('body') },
  food_pomegranate_01: { place: 'floor', budget: { low: 450, full: 1100 }, tex: { low: 128, full: 256 }, classify: flat('body') },
  wall_clock: { place: 'wall', budget: { low: 900, full: 2400 }, tex: { low: 256, full: 512 }, drop: ['glass'], classify: (c, m) => (/glass/.test(m) ? 'glass' : 'body') },
};

const ATTRS = ['POSITION', 'NORMAL', 'TEXCOORD_0'];

function applyMatrix(prim, m) {
  const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL');
  const v = [0, 0, 0];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, v);
    pos.setElement(i, [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]);
  }
  if (nor) {
    // rotation and uniform scale only here (checked below), so the plain matrix is the normal matrix up to length
    for (let i = 0; i < nor.getCount(); i++) {
      nor.getElement(i, v);
      const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2], y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2], z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2];
      const l = Math.hypot(x, y, z) || 1;
      nor.setElement(i, [x / l, y / l, z / l]);
    }
  }
}

function composeMatrix(t, q, s) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0, (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
}

/** connected components of a primitive's triangles (vertices that sit at the same place are one) -> per triangle component id and per component bbox */
function components(prim) {
  const pos = prim.getAttribute('POSITION'), ia = prim.getIndices().getArray();
  const n = pos.getCount();
  const canon = new Int32Array(n), keys = new Map(), v = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    pos.getElement(i, v);
    const k = `${Math.round(v[0] * 1e4)},${Math.round(v[1] * 1e4)},${Math.round(v[2] * 1e4)}`;
    if (keys.has(k)) canon[i] = keys.get(k); else { keys.set(k, i); canon[i] = i; }
  }
  const par = new Int32Array(n).map((_, i) => i);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let t = 0; t < ia.length; t += 3) { const a = find(canon[ia[t]]); par[find(canon[ia[t + 1]])] = a; par[find(canon[ia[t + 2]])] = a; }
  const triComp = new Int32Array(ia.length / 3), comps = new Map();
  for (let t = 0; t < ia.length; t += 3) {
    const r = find(canon[ia[t]]);
    triComp[t / 3] = r;
    let c = comps.get(r);
    if (!c) comps.set(r, c = { minX: 1e9, minY: 1e9, minZ: 1e9, maxX: -1e9, maxY: -1e9, maxZ: -1e9, tris: 0 });
    c.tris++;
    for (let k = 0; k < 3; k++) {
      pos.getElement(ia[t + k], v);
      c.minX = Math.min(c.minX, v[0]); c.maxX = Math.max(c.maxX, v[0]); c.minY = Math.min(c.minY, v[1]); c.maxY = Math.max(c.maxY, v[1]); c.minZ = Math.min(c.minZ, v[2]); c.maxZ = Math.max(c.maxZ, v[2]);
    }
  }
  for (const c of comps.values()) { c.dx = c.maxX - c.minX; c.dy = c.maxY - c.minY; c.dz = c.maxZ - c.minZ; }
  return { triComp, comps };
}

/** a new primitive holding only the triangles in `tris`, with compact vertex arrays */
function subPrimitive(doc, buffer, src, tris, material) {
  const ia = src.getIndices().getArray();
  const remap = new Map(), order = [];
  const idx = new Uint32Array(tris.length * 3);
  tris.forEach((t, j) => { for (let k = 0; k < 3; k++) { const o = ia[t * 3 + k]; let n = remap.get(o); if (n === undefined) { n = order.length; remap.set(o, n); order.push(o); } idx[j * 3 + k] = n; } });
  const prim = doc.createPrimitive().setMaterial(material);
  for (const sem of ATTRS) {
    const a = src.getAttribute(sem);
    if (!a) continue;
    const size = a.getElementSize(), arr = new Float32Array(order.length * size), e = new Array(size);
    order.forEach((o, i) => { a.getElement(o, e); arr.set(e, i * size); });
    prim.setAttribute(sem, doc.createAccessor().setType(a.getType()).setArray(arr).setBuffer(buffer));
  }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer));
  return prim;
}

/** one flat-shaded box per entry ({ min, max, uv }), every vertex mapped to `uv` (a solid patch of the texture) */
function boxPrimitive(doc, buffer, boxes, material) {
  const pos = [], nor = [], uvs = [], idx = [];
  for (const b of boxes) {
    const faces = [[0, 1, 1], [0, -1, 1], [1, 1, 0], [1, -1, 0], [2, 1, 0], [2, -1, 0]];
    for (const [ax, sg] of faces) {
      const u = (ax + 1) % 3, v = (ax + 2) % 3, base = pos.length / 3;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = [0, 0, 0];
        p[ax] = sg > 0 ? b.max[ax] : b.min[ax]; p[u] = su > 0 ? b.max[u] : b.min[u]; p[v] = sv > 0 ? b.max[v] : b.min[v];
        pos.push(...p); const n = [0, 0, 0]; n[ax] = sg; nor.push(...n); uvs.push(b.uv[0], b.uv[1]);
      }
      // wind so the face looks along +normal
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      const a = [pos[base * 3], pos[base * 3 + 1], pos[base * 3 + 2]], b1 = [pos[(base + 1) * 3], pos[(base + 1) * 3 + 1], pos[(base + 1) * 3 + 2]], c = [pos[(base + 2) * 3], pos[(base + 2) * 3 + 1], pos[(base + 2) * 3 + 2]];
      const e1 = [b1[0] - a[0], b1[1] - a[1], b1[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const n = [0, 0, 0]; n[ax] = sg;
      if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) { const l = idx.length; [idx[l - 5], idx[l - 4]] = [idx[l - 4], idx[l - 5]]; [idx[l - 2], idx[l - 1]] = [idx[l - 1], idx[l - 2]]; }
    }
  }
  const mk = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  return doc.createPrimitive().setMaterial(material).setAttribute('POSITION', mk('VEC3', new Float32Array(pos))).setAttribute('NORMAL', mk('VEC3', new Float32Array(nor)))
    .setAttribute('TEXCOORD_0', mk('VEC2', new Float32Array(uvs))).setIndices(mk('SCALAR', new Uint32Array(idx)));
}

function triCount(prim) { return prim.getIndices().getCount() / 3; }

function primBounds(prim, idxArr) {
  const pos = prim.getAttribute('POSITION'), v = [0, 0, 0];
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  const seen = new Uint8Array(pos.getCount());
  for (let k = 0; k < idxArr.length; k++) {
    const i = idxArr[k];
    if (seen[i]) continue;
    seen[i] = 1; pos.getElement(i, v);
    for (let j = 0; j < 3; j++) { mn[j] = Math.min(mn[j], v[j]); mx[j] = Math.max(mx[j], v[j]); }
  }
  return { mn, mx };
}

/**
 * Simplify to about `target` triangles, keeping uv seams and the silhouette: the error bound is raised step by step and the first result that
 * both reaches the budget (within 1.5x) and keeps the bounding box (within 4 mm or 1 %) is taken. If none does, the smallest that keeps the
 * box (a model's size is what every fit decision reads, so a part that shrinks is a build error, not a saving).
 */
function simplifyPrim(doc, buffer, prim, target, leaves, relax) {
  const have = triCount(prim);
  if (have <= target) return prim;
  const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), uv = prim.getAttribute('TEXCOORD_0');
  const n = pos.getCount();
  const attrs = new Float32Array(n * 5), e = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    nor.getElement(i, e); attrs.set(e, i * 5);
    uv.getElement(i, e); attrs[i * 5 + 3] = e[0]; attrs[i * 5 + 4] = e[1];
  }
  const src = prim.getIndices().getArray();
  const idx32 = src instanceof Uint32Array ? src : new Uint32Array(src);
  const posArr = pos.getArray();
  const ref = primBounds(prim, idx32);
  const keepsBox = (out) => {
    if (out.length < 9) return false;
    const b = primBounds(prim, out);
    return [0, 1, 2].every((j) => Math.abs(b.mn[j] - ref.mn[j]) <= Math.max(0.004, 0.01 * (ref.mx[j] - ref.mn[j])) && Math.abs(b.mx[j] - ref.mx[j]) <= Math.max(0.004, 0.01 * (ref.mx[j] - ref.mn[j])));
  };
  let best = null;
  for (const err of [0.01, 0.02, 0.04, 0.08, 0.15, 0.3]) {
    for (const flags of relax || leaves ? [[], ['LockBorder']] : [['LockBorder'], []]) {
      const [out] = MeshoptSimplifier.simplifyWithAttributes(idx32, posArr, 3, attrs, 5, [0.6, 0.6, 0.6, 1.2, 1.2], null, Math.max(9, Math.floor(target) * 3), err, flags);
      if (!keepsBox(out)) continue;
      if (!best || out.length < best.length) best = out;
      if (out.length / 3 <= target * 1.5) { best = out; err > 1 && 0; break; }
    }
    if (best && best.length / 3 <= target * 1.5) break;
  }
  if (!best) { console.warn('  could not simplify without moving the box, kept whole', have, 'tris', 'ref', ref.mn.map((v) => v.toFixed(3)), ref.mx.map((v) => v.toFixed(3))); return prim; }
  const keep = [];
  for (let t = 0; t < best.length; t += 3) keep.push(t / 3);
  const tmp = doc.createPrimitive().setMaterial(prim.getMaterial());
  for (const sem of ATTRS) { const a = prim.getAttribute(sem); if (a) tmp.setAttribute(sem, a); }
  tmp.setIndices(doc.createAccessor().setType('SCALAR').setArray(best).setBuffer(buffer));
  return subPrimitive(doc, buffer, tmp, keep, prim.getMaterial());
}

/** mean linear luminance of a texture (the recolour pass divides by it) */
async function meanLuminance(buf) {
  const { data } = await sharp(Buffer.from(buf)).resize(64, 64, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const lin = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  let s = 0, s2 = 0;
  const n = data.length / 3;
  for (let i = 0; i < data.length; i += 3) { const l = 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]); s += l; s2 += l * l; }
  const mean = s / n;
  // cv: how much the light and dark vary around the mean (a mottled dark leather is high, a plain fabric low): the recolour pass shows less of a high-cv map
  return { mean, cv: Math.sqrt(Math.max(0, s2 / n - mean * mean)) / Math.max(mean, 1e-4) };
}

const lockShas = {};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const manifest = fs.existsSync(path.join(manifestDir, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(manifestDir, 'manifest.json'), 'utf8')) : { version: 1, models: {} };
const ids = only.length ? only : Object.keys(CONFIG);

for (const id of ids) {
  const cfg = CONFIG[id];
  if (!cfg) throw new Error(`no config for ${id}`);
  const meanLumByMaterial = {};
  const result = { id, files: {}, parts: {}, dims: null, tris: {} };
  for (const tier of ['low', 'full']) {
    const io = new NodeIO().registerExtensions([EXTMeshoptCompression, EXTTextureWebP]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
    const doc = await io.read(path.join(rawDir, id, `${id}_1k.gltf`));
    const root = doc.getRoot();
    const buffer = root.listBuffers()[0];
    await doc.transform(flatten());
    const scene = root.listScenes()[0];

    // 1. bake node transforms, then the yaw
    const yaw = ((cfg.yaw ?? 0) * Math.PI) / 180;
    const yawM = composeMatrix([0, 0, 0], [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], [1, 1, 1]);
    const seen = new Set();
    const nodes = root.listNodes().filter((n) => n.getMesh());
    const items = [];
    for (const node of nodes) {
      const sc = node.getScale();
      if (Math.abs(sc[0] - sc[1]) > 1e-6 || Math.abs(sc[1] - sc[2]) > 1e-6) throw new Error(`${id}: non-uniform node scale`);
      const mesh = node.getMesh();
      if (seen.has(mesh)) throw new Error(`${id}: a mesh is shared by two nodes`);
      seen.add(mesh);
      const m = composeMatrix(node.getTranslation(), node.getRotation(), sc);
      for (const p of mesh.listPrimitives()) { applyMatrix(p, m); if (yaw) applyMatrix(p, yawM); items.push({ prim: p, node: node.getName(), mat: p.getMaterial() }); }
    }
    // 2. origin
    let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
    const gather = (fn) => { for (const { prim, mat, node } of items) { if (cfg.drop && cfg.drop.includes(cfg.classify({}, mat.getName(), node))) continue; fn(prim); } };
    gather((prim) => { const pos = prim.getAttribute('POSITION'), v = [0, 0, 0]; for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); for (let j = 0; j < 3; j++) { min[j] = Math.min(min[j], v[j]); max[j] = Math.max(max[j], v[j]); } } });
    const shift = cfg.place === 'wall' ? [-(min[0] + max[0]) / 2, -min[1], -min[2]] : [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
    for (const { prim } of items) { const pos = prim.getAttribute('POSITION'), v = [0, 0, 0]; for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); pos.setElement(i, [v[0] + shift[0], v[1] + shift[1], v[2] + shift[2]]); } }
    const dims = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

    // 3. split into parts
    const byPart = new Map();
    for (const { prim, node, mat } of items) {
      const { triComp, comps } = components(prim);
      const buckets = new Map();
      for (let t = 0; t < triComp.length; t++) {
        const c = comps.get(triComp[t]);
        const name = cfg.classify(c, mat.getName(), node);
        if (cfg.drop?.includes(name)) continue;
        if (!buckets.has(name)) buckets.set(name, []);
        buckets.get(name).push(t);
      }
      for (const [name, tris] of buckets) {
        let sub;
        if (cfg.boxify?.includes(name)) {
          // every small connected piece of the part (a slat: 44 triangles) becomes its bounding box, painted with the colour of the texture at its
          // centre; pieces that are not box-like (a curved one, a bigger one) stay as they are
          const uvA = prim.getAttribute('TEXCOORD_0'), ia = prim.getIndices().getArray(), e = [0, 0];
          const boxes = new Map(), rest = [];
          for (const t of tris) {
            const r = triComp[t], c = comps.get(r);
            if (c.tris > 60) { rest.push(t); continue; }
            if (!boxes.has(r)) { uvA.getElement(ia[t * 3], e); boxes.set(r, { min: [c.minX, c.minY, c.minZ], max: [c.maxX, c.maxY, c.maxZ], uv: [e[0], e[1]] }); }
          }
          sub = boxPrimitive(doc, buffer, [...boxes.values()], mat);
          if (rest.length) { if (!byPart.has(name)) byPart.set(name, []); byPart.get(name).push(subPrimitive(doc, buffer, prim, rest, mat)); }
        } else sub = subPrimitive(doc, buffer, prim, tris, mat);
        if (!byPart.has(name)) byPart.set(name, []);
        byPart.get(name).push(sub);
      }
    }
    // 4. budget per part
    const total = [...byPart.values()].flat().reduce((s, p) => s + triCount(p), 0);
    for (const n of nodes) n.dispose();
    for (const m of root.listMeshes()) m.dispose();
    const budget = cfg.budget[tier];
    const lowTier = tier === 'low';
    for (const [name, prims] of byPart) {
      const have = prims.reduce((s, p) => s + triCount(p), 0);
      const minFor = cfg.minTris?.[name] ? (lowTier ? cfg.minTris[name] : cfg.minTris[name] * 2.2) : 60;
      const target = Math.max(minFor, (have / total) * budget);
      const out = prims.map((p) => simplifyPrim(doc, buffer, p, (target * triCount(p)) / have, name === 'leaves', !!cfg.relax));
      const mesh = doc.createMesh(name);
      for (const p of out) mesh.addPrimitive(p);
      scene.addChild(doc.createNode(name).setMesh(mesh));
      result.tris[tier] = (result.tris[tier] ?? 0) + out.reduce((s, p) => s + triCount(p), 0);
      result.parts[name] ??= { tris: {} };
      result.parts[name].tris[tier] = out.reduce((s, p) => s + triCount(p), 0);
      // one material per part: the part's first primitive's
      const mat = out[0].getMaterial().clone().setName(name);
      for (const p of out) p.setMaterial(mat);
      result.parts[name].material = { alphaMode: 'OPAQUE', baseColor: mat.getBaseColorFactor().map((v) => +v.toFixed(3)), emissive: mat.getEmissiveFactor() };
    }
    // 5. materials: opaque, single sided except leaves, no extensions; roughness and normal maps only on full
    for (const mat of root.listMaterials()) {
      const part = mat.getName();
      mat.setAlphaMode('OPAQUE').setDoubleSided(part === 'leaves');
      const hasArm = !!mat.getMetallicRoughnessTexture();
      if (lowTier) {
        mat.setNormalTexture(null);
        mat.setOcclusionTexture(null);
        mat.setMetallicRoughnessTexture(null);
        const metal = hasArm && /brass|enamel|pot|metal|clock|frame|leg/.test(id + part) ? 0 : 0;
        mat.setMetallicFactor(metal).setRoughnessFactor(part === 'leaves' ? 0.8 : 0.6);
      } else if (hasArm) {
        mat.setOcclusionTexture(null);
      }
      const bc = mat.getBaseColorTexture();
      if (bc) meanLumByMaterial[part] ??= await meanLuminance(bc.getImage());
    }
    // 6. textures to WebP at the tier's size
    const size = cfg.tex[tier];
    doc.createExtension(EXTTextureWebP).setRequired(true);
    for (const tex of root.listTextures()) {
      const isBase = root.listMaterials().some((m) => m.getBaseColorTexture() === tex);
      const edge = isBase ? size : Math.min(size, 512);
      const buf = await sharp(Buffer.from(tex.getImage())).resize(edge, edge, { fit: 'inside', withoutEnlargement: true }).webp({ quality: isBase ? (lowTier ? 74 : 82) : 80 }).toBuffer();
      tex.setImage(new Uint8Array(buf)).setMimeType('image/webp');
    }
    await doc.transform(prune());
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
    const file = `${id}${lowTier ? '.low' : ''}.glb`;
    const glb = await io.writeBinary(doc);
    fs.writeFileSync(path.join(outDir, file), glb);
    result.files[tier] = { file, bytes: glb.length, sha256: sha(glb) };
    if (tier === 'full') {
      result.dims = { w: +dims[0].toFixed(4), h: +dims[1].toFixed(4), d: +dims[2].toFixed(4) };
      for (const [name, p] of Object.entries(result.parts)) { p.detailMean = +(meanLumByMaterial[name]?.mean ?? 0).toFixed(4); p.detailCv = +(meanLumByMaterial[name]?.cv ?? 0).toFixed(3); }
    }
    console.log(id, tier, glb.length, 'bytes', result.tris[tier], 'tris');
  }
  // the SHA-256 lives in models.lock.json only (a hash can contain a run of digits that the anti-overfit lint reads as a phone number)
  lockShas[id] = Object.fromEntries(Object.values(result.files).map((f) => [f.file, f.sha256]));
  for (const f of Object.values(result.files)) delete f.sha256;
  result.place = cfg.place;
  if (cfg.surfaceM !== undefined) result.surfaceM = cfg.surfaceM;
  manifest.models[id] = result;
}
// the lock (scripts/fetch-look-models.ts) learns the SHA-256 and size of every output
const lockPath = path.join(outDir, 'models.lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  for (const [mid, r] of Object.entries(manifest.models)) {
    if (!lock.models[mid] || !lockShas[mid]) continue;
    lock.models[mid].outputs = Object.fromEntries(Object.values(r.files).map((f) => [f.file, { bytes: f.bytes, sha256: lockShas[mid][f.file] }]));
  }
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
}
manifest.models = Object.fromEntries(Object.entries(manifest.models).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(path.join(manifestDir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log('manifest written for', Object.keys(manifest.models).length, 'models');
