// Turns the raw clubhouse downloads (scripts/fetch-club-assets.ts) into what ships (SPEC 16.17.3):
//   public/look/club/models/<id>.glb       high tier
//   public/look/club/models/<id>.mid.glb   medium tier
//   public/look/club/models/<id>.low.glb   the phone file (decimated, small colour maps only)
//   src/look/club/manifest.json            measured sizes, triangles and bytes of every output (the app and the tests read it)
//
//   node optimise-club-assets.mjs <rawDir> <repo>
//
// Dev-only, like tools/optimise-gym-assets.mjs: copy it next to a scratch install of
//   @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
// (e.g. ~/walkthru-tools/gltf) and run it there. Every model comes out in metres, its footprint centred on the origin, its lowest point on y = 0,
// its FRONT (where a person steps on or sits) toward +z and its back toward -z (SPEC 16.17), so the app only scales it into the item's box.
// Print the source carried that must not ship (a maker's name on a shroud, the words on a plate) is painted out of the map or the part is
// re-surfaced with a plain material; what was done is said per model below and in public/look/club/club.lock.json.
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, flatten, join, weld, simplify, metalRough, textureCompress, prune, dedup, getBounds, transformMesh, clearNodeTransform, mergeDocuments, unpartition, cloneDocument } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [rawDir, repo, only] = process.argv.slice(2);
const OUT = path.join(repo, 'public/look/club');
fs.mkdirSync(path.join(OUT, 'models'), { recursive: true });
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const manifestPath = path.join(repo, 'src/look/club/manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { generatedBy: 'tools/optimise-club-assets.mjs', models: {} };
const lockPath = path.join(OUT, 'club.lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const outputs = lock.outputs ?? {};
const TIERS = ['full', 'mid', 'low'];
const suffix = { full: '', mid: '.mid', low: '.low' };

// ------------------------------------------------------------------ matrices (column-major, like glTF)
const mul = (A, B) => { const C = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let q = 0; q < 4; q++) C[j * 4 + i] += A[q * 4 + i] * B[j * 4 + q]; return C; };
const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const S = (x, y = x, z = x) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
const RY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const RX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
const chain = (...ms) => ms.reduce((a, b) => mul(b, a));

// ------------------------------------------------------------------ document helpers
const raw = (rel) => path.join(rawDir, rel);
async function load(rel) { return io.read(raw(rel)); }
/** every node's world transform baked into its own (unshared) mesh, the hierarchy flattened: node names and materials kept */
async function bake(doc) {
  await doc.transform(flatten());
  const seen = new Set();
  for (const n of doc.getRoot().listNodes()) {
    const m = n.getMesh();
    if (m && seen.has(m)) n.setMesh(deepClone(doc, m));
    if (n.getMesh()) seen.add(n.getMesh());
    clearNodeTransform(n);
  }
  return doc;
}
function deepClone(doc, mesh) {
  const out = doc.createMesh(mesh.getName());
  for (const p of mesh.listPrimitives()) {
    const q = doc.createPrimitive().setMaterial(p.getMaterial()).setMode(p.getMode());
    for (const s of p.listSemantics()) q.setAttribute(s, p.getAttribute(s).clone());
    if (p.getIndices()) q.setIndices(p.getIndices().clone());
    out.addPrimitive(q);
  }
  return out;
}
const label = (n) => `${n.getName()} ${n.getMesh()?.listPrimitives().map((p) => p.getMaterial()?.getName() ?? '').join(' ') ?? ''}`;
const meshNodes = (doc, re) => doc.getRoot().listNodes().filter((n) => n.getMesh() && (!re || re.test(label(n))));
function move(doc, re, M) { for (const n of meshNodes(doc, re)) transformMesh(n.getMesh(), M); }
function drop(doc, re) { for (const n of meshNodes(doc, re)) n.dispose(); }
/** a copy of each matching node (its own mesh), moved by M */
function copy(doc, re, M) { const scene = doc.getRoot().listScenes()[0]; for (const n of meshNodes(doc, re)) { const c = doc.createNode(n.getName() + '-copy').setMesh(deepClone(doc, n.getMesh())); transformMesh(c.getMesh(), M); scene.addChild(c); } }
/** bounds of the matching nodes' meshes (after bake(), a mesh's own coordinates are the world's) */
function boundsOf(doc, re) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], e = [0, 0, 0];
  for (const n of meshNodes(doc, re)) for (const p of n.getMesh().listPrimitives()) { const P = p.getAttribute('POSITION'); for (let i = 0; i < P.getCount(); i++) { P.getElement(i, e); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], e[k]); max[k] = Math.max(max[k], e[k]); } } }
  return { min, max };
}
/** all of `src` brought into `doc`'s scene (its buffers merged) */
async function absorb(doc, src) {
  const map = mergeDocuments(doc, src);
  const scenes = doc.getRoot().listScenes();
  const main = scenes[0];
  for (const s of scenes.slice(1)) { for (const c of s.listChildren()) main.addChild(c); s.dispose(); }
  void map;
  await doc.transform(unpartition());
  return doc;
}
/** a plain material (no maps): the app's look for a re-surfaced part */
function plain(doc, name, rgb, rough, metal = 0) { return doc.createMaterial(name).setBaseColorFactor([...rgb, 1]).setRoughnessFactor(rough).setMetallicFactor(metal); }
function setMat(doc, re, mat) { for (const n of meshNodes(doc, re)) for (const p of n.getMesh().listPrimitives()) p.setMaterial(mat); }

/** paints `boxes` ([x, y, w, h] in pixels of the source map) of a material's colour map: pixels that differ from `keep` (the plain surface around the print) take its colour */
async function paintOut(doc, matName, boxes, test) {
  const m = doc.getRoot().listMaterials().find((x) => x.getName() === matName);
  const t = m.getBaseColorTexture();
  const img = sharp(Buffer.from(t.getImage()));
  const md = await img.metadata();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (const [bx, by, bw, bh, fill] of boxes) for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
    const i = (y * info.width + x) * 4;
    if (test(data[i], data[i + 1], data[i + 2])) { data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; n++; }
  }
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  t.setImage(new Uint8Array(png)).setMimeType('image/png');
  return { n, w: md.width, h: md.height };
}

/**
 * Places the model (footprint centre on the origin, lowest point on y = 0), then writes the three tiers: `ratio` of the triangles kept and
 * the maps at `tex` px per tier (the phone file keeps colour maps only). Returns and records the measured sizes.
 */
async function ship(id, doc, o) {
  await doc.transform(prune(), metalRough());
  const b0 = getBounds(doc.getRoot().listScenes()[0]);
  move(doc, null, T(-(b0.min[0] + b0.max[0]) / 2, -b0.min[1], -(b0.min[2] + b0.max[2]) / 2));
  const out = {};
  for (const tier of TIERS) {
    const d = cloneDocument(doc);
    if (tier === 'low') for (const m of d.getRoot().listMaterials()) { m.setNormalTexture(null); m.setOcclusionTexture(null); m.setMetallicRoughnessTexture(null); }
    await d.transform(join({ keepNamed: false }), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: o.ratio[tier], error: (o.error ?? 0.002) * { full: 1, mid: 2.5, low: 8 }[tier], lockBorder: false }), dedup(), prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [o.tex[tier], o.tex[tier]], quality: 82 }));
    let tris = 0; for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices() ? p.getIndices().getCount() / 3 : p.getAttribute('POSITION').getCount() / 3;
    await d.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const file = `models/${id}${suffix[tier]}.glb`;
    const buf = Buffer.from(await io.writeBinary(d));
    fs.writeFileSync(path.join(OUT, file), buf);
    outputs[file] = { bytes: buf.length, sha256: sha(buf) };
    const bb = getBounds(d.getRoot().listScenes()[0]);
    out[tier] = { file, bytes: buf.length, tris, dims: { w: +(bb.max[0] - bb.min[0]).toFixed(4), h: +(bb.max[1] - bb.min[1]).toFixed(4), d: +(bb.max[2] - bb.min[2]).toFixed(4) } };
  }
  manifest.models[id] = {
    source: o.source, textured: true, ...(o.surfaceM !== undefined ? { surfaceM: o.surfaceM } : {}), dims: out.full.dims,
    files: Object.fromEntries(TIERS.map((t) => [t, { file: out[t].file, bytes: out[t].bytes }])), tris: Object.fromEntries(TIERS.map((t) => [t, out[t].tris])), parts: [], note: o.note,
  };
  console.log(id, JSON.stringify(manifest.models[id].dims), JSON.stringify(manifest.models[id].tris), TIERS.map((t) => out[t].bytes).join(' / '));
}
const want = (id) => !only || only.split(',').includes(id);

// ------------------------------------------------------------------ power rack: Weight Room Set 1 (half rack) + Weight Room Set 3 (Olympic bar, iron plates), Tytan, CC BY 4.0
if (want('power-rack')) {
  const doc = await bake(await load('sketchfab-1d18318c3e81407b8321159fb3424026/1d18318c3e81407b8321159fb3424026.glb'));
  await doc.transform(metalRough()); // the source is spec-gloss: converted first, so the tint below is not overwritten
  drop(doc, /\bBench\b/); // the set's bench is 32 cm wide: too narrow for the 56 cm flat-bench box, so it is left out
  // the rack's frame keeps its map (the hole rows are cut-outs in it) under a graphite powder-coat tint; its J-cups become black UHMW
  const frame = doc.getRoot().listMaterials().find((m) => m.getName() === 'Squat_Rack');
  frame.setBaseColorFactor([0.42, 0.44, 0.47, 1]).setAlphaMode('MASK').setAlphaCutoff(0.5).setRoughnessFactor(0.55).setMetallicFactor(0.2);
  const cups = plain(doc, 'cups', [0.03, 0.03, 0.035], 0.6);
  for (const n of meshNodes(doc, /Squat_Rack/)) { const b = getBounds(n); if ((b.max[1] - b.min[1]) < 0.35 && (b.max[0] - b.min[0]) < 0.12) for (const p of n.getMesh().listPrimitives()) p.setMaterial(cups); }
  const set3 = await bake(await load('sketchfab-8bfa29f8961b40258d5d1dc63d19c9a2/8bfa29f8961b40258d5d1dc63d19c9a2.glb'));
  await set3.transform(metalRough());
  // the bar lies along x at z 0.21..0.26, y -0.2..-0.15; the plates stand in the x-y plane. Keep the bar and the two biggest plates, drop the rest.
  const plates = meshNodes(set3, /Weight/).map((n) => ({ n, b: getBounds(n) })).sort((a, b) => (b.b.max[0] - b.b.min[0]) - (a.b.max[0] - a.b.min[0]));
  for (const p of plates.slice(2)) p.n.dispose();
  // the printed plate faces do not ship: black iron. The bar keeps its knurled map, as satin rather than mirror chrome (a mirror of a dim gym is black)
  setMat(set3, /Weight/, plain(set3, 'iron', [0.045, 0.045, 0.05], 0.55, 0.35));
  for (const m of set3.getRoot().listMaterials()) if (m.getName() === 'Barbell') m.setMetallicFactor(0.45).setRoughnessFactor(0.45);
  const barB = boundsOf(set3, /Barbell/);
  const barC = [(barB.min[0] + barB.max[0]) / 2, (barB.min[1] + barB.max[1]) / 2, (barB.min[2] + barB.max[2]) / 2];
  // each plate turned to face along the bar and slid onto its sleeve: the big one against the collar, the next outside it, both sides
  const collar = 0.72 * (barB.max[0] - barB.min[0]) / 2; // the inner collars of a 2.2 m bar are at +-0.72 of its half length (1.31 m apart)
  let off = 0;
  for (const p of plates.slice(0, 2)) {
    const c = [(p.b.min[0] + p.b.max[0]) / 2, (p.b.min[1] + p.b.max[1]) / 2, (p.b.min[2] + p.b.max[2]) / 2];
    const th = p.b.max[2] - p.b.min[2];
    const x = collar + off + th / 2; off += th + 0.004;
    const re = new RegExp(`^${p.n.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    void re;
    const M = (sx) => chain(T(-c[0], -c[1], -c[2]), RY(Math.PI / 2), T(barC[0] + sx * x, barC[1], barC[2]));
    const left = set3.createNode('plate').setMesh(deepClone(set3, p.n.getMesh())); transformMesh(left.getMesh(), M(-1)); set3.getRoot().listScenes()[0].addChild(left);
    transformMesh(p.n.getMesh(), M(1));
  }
  // the bar on the rack's upper J-cups: centred across, resting on the cups, at their depth
  const cupsB = (() => { let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const n of meshNodes(doc, /Squat_Rack|cups/)) { const b = getBounds(n); if ((b.max[1] - b.min[1]) < 0.35 && (b.max[0] - b.min[0]) < 0.12 && b.min[1] > 0) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], b.min[k]); mx[k] = Math.max(mx[k], b.max[k]); } } return { min: mn, max: mx }; })();
  const barR = (barB.max[1] - barB.min[1]) / 2;
  move(set3, null, T(-barC[0], cupsB.max[1] - 0.03 + barR - barC[1], (cupsB.min[2] + cupsB.max[2]) / 2 - barC[2]));
  await absorb(doc, set3);
  // one scale for everything: the bar becomes a 2.2 m Olympic bar (the set is modelled a little small), which makes the rack 2.2 m tall
  const k = 2.2 / (barB.max[0] - barB.min[0]);
  move(doc, null, S(k));
  // the set's rack faces -z (its bench ran out to +z): turned so the open side, where the lifter steps in, is +z ... it already is
  await ship('power-rack', doc, { source: ['sketchfab-1d18318c3e81407b8321159fb3424026', 'sketchfab-8bfa29f8961b40258d5d1dc63d19c9a2'], ratio: { full: 1, mid: 0.6, low: 0.3 }, tex: { full: 1024, mid: 512, low: 256 },
    note: 'Weight Room Set 1 half rack (its bench left out) with the bar and two iron plates a side from Weight Room Set 3; frame tinted graphite, plates re-surfaced plain (their printed faces do not ship), one uniform scale (2.2 m bar).' });
}

// ------------------------------------------------------------------ recumbent bike: "cycle" by killer456, CC BY 4.0
if (want('recumbent')) {
  const doc = await bake(await load('sketchfab-11acede7444c4376b8080de4286b0460/11acede7444c4376b8080de4286b0460.glb'));
  await doc.transform(metalRough());
  // the maker's name printed on both flywheel shrouds is painted out with the shroud's own white (two boxes of the 1024 px map)
  // the boxes lie inside the white shrouds (clear of their grey outline and of the map's unused black), so every pixel in them takes the white
  const r = await paintOut(doc, 'Material.002', [[310, 532, 42, 236, [246, 246, 250]], [730, 460, 34, 178, [246, 246, 250]]], () => true);
  console.log('recumbent: logo pixels painted', r.n);
  const b = getBounds(doc.getRoot().listScenes()[0]);
  // it lies along x; the console end (the highest point) is the back and goes to -z
  let topX = 0, topY = -Infinity;
  for (const n of meshNodes(doc)) for (const p of n.getMesh().listPrimitives()) { const P = p.getAttribute('POSITION'); const e = [0, 0, 0]; for (let i = 0; i < P.getCount(); i++) { P.getElement(i, e); if (e[1] > topY) { topY = e[1]; topX = e[0]; } } }
  const consoleAtMaxX = topX > (b.min[0] + b.max[0]) / 2;
  // x -> z: turning -90 deg about y sends +x to +z; the console must end at -z
  move(doc, null, RY(consoleAtMaxX ? Math.PI / 2 : -Math.PI / 2));
  const k = 1.65 / (b.max[0] - b.min[0]); // its length is the catalogue's 1.65 m
  move(doc, null, S(k));
  await ship('recumbent', doc, { source: ['sketchfab-11acede7444c4376b8080de4286b0460'], ratio: { full: 0.6, mid: 0.35, low: 0.15 }, tex: { full: 1024, mid: 512, low: 256 }, error: 0.004,
    note: 'one uniform scale to the 1.65 m length; the maker\'s name on the two flywheel shrouds painted out with the shroud\'s white.' });
}

// ------------------------------------------------------------------ pool table: "Pooltable" by jdastine, CC BY 4.0
if (want('pool-table')) {
  const doc = await bake(await load('sketchfab-cc96165eda374800a45f510d98216490/cc96165eda374800a45f510d98216490.glb'));
  // the 16 loose balls (one each with its own map, 12 000 of the 15 500 triangles, one fallen on a rail) and a stray marker are left out:
  // the generator racks its own balls on the cloth
  drop(doc, /pSphere|lambert1/);
  // its cloth map is a saturated lime (mean 7, 151, 52 of 255): toned to a tournament green, the map's own weave kept
  doc.getRoot().listMaterials().find((m) => m.getName() === 'aiStandardSurface1').setBaseColorFactor([1, 0.6, 0.95, 1]);
  const b = boundsOf(doc);
  // the bed (the cloth the balls sat on) is at the balls' lowest point in the source: y 12.16 of 2.62 .. 12.61
  const bedY = 12.16;
  const k = 2.54 / (b.max[0] - b.min[0]); // its length is the catalogue's 8 ft table, 2.54 m
  move(doc, null, S(k));
  await ship('pool-table', doc, { source: ['sketchfab-cc96165eda374800a45f510d98216490'], ratio: { full: 1, mid: 0.7, low: 0.4 }, tex: { full: 1024, mid: 512, low: 256 },
    surfaceM: +((bedY - b.min[1]) * k).toFixed(4), note: 'the loose balls and a stray marker left out; the lime cloth toned to a tournament green; one uniform scale to the 2.54 m length.' });
}

// ------------------------------------------------------------------ table tennis: "Table Tennis Table" by Diccbudd, CC BY 4.0
if (want('table-tennis')) {
  const doc = await bake(await load('sketchfab-457c34c9297d44a1a5d4e5d093c6a712/457c34c9297d44a1a5d4e5d093c6a712.glb'));
  await doc.transform(metalRough());
  // the table is modelled at twice real size, its length along z: the top is 3.04 x 5.48 (ITTF 1.525 x 2.74)
  const top = boundsOf(doc, /^Object_4\b/);
  const halfW = top.max[0];
  // the net: its mesh is a 49 600-triangle grid of cords; it becomes one sheer panel the size of the net (the cord band, posts and clamps stay)
  const netB = boundsOf(doc, /^Object_12\b/);
  drop(doc, /^Object_12\b/);
  {
    const sheer = doc.createMaterial('net').setBaseColorFactor([0.05, 0.05, 0.06, 0.55]).setAlphaMode('BLEND').setRoughnessFactor(0.9).setDoubleSided(true);
    const buf = doc.getRoot().listBuffers()[0];
    const P = new Float32Array([netB.min[0], netB.min[1], 0, netB.max[0], netB.min[1], 0, netB.max[0], netB.max[1], 0, netB.min[0], netB.max[1], 0]);
    const N = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const prim = doc.createPrimitive().setMaterial(sheer)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buf))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(buf))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 0, 2, 3])).setBuffer(buf));
    doc.getRoot().listScenes()[0].addChild(doc.createNode('net').setMesh(doc.createMesh('net').addPrimitive(prim)));
  }
  // the net and its posts overhang the sides by 15 cm (as real posts do); drawn in to the table's edge so the piece is its 152.5 cm box
  const netParts = meshNodes(doc).filter((n) => { const b = getBounds(n); return b.max[2] - b.min[2] < 0.06 && b.min[1] > 1.3; });
  const nb = (() => { let mx = 0; for (const n of netParts) { const b = getBounds(n); mx = Math.max(mx, Math.abs(b.min[0]), Math.abs(b.max[0])); } return mx; })();
  for (const n of netParts) transformMesh(n.getMesh(), S(halfW / nb, 1, 1));
  // length along x like the catalogue row (2.74 m wide x 1.525 m deep), real size
  move(doc, null, RY(Math.PI / 2));
  move(doc, null, S(0.5));
  await ship('table-tennis', doc, { source: ['sketchfab-457c34c9297d44a1a5d4e5d093c6a712'], ratio: { full: 1, mid: 0.8, low: 0.5 }, tex: { full: 256, mid: 256, low: 128 },
    note: 'modelled at twice real size (halved); the 49 600-triangle cord net replaced by one sheer panel; the net and its posts drawn in to the table edge (a real net overhangs 15 cm a side).' });
}

// ------------------------------------------------------------------ carrom board: "Karambol Carom Board" by Francesco Coldesina (topfrank2013), CC BY 4.0
if (want('carrom-board')) {
  const doc = await bake(await load('sketchfab-eaf67aa3bfd145289323d91f366e25f4/eaf67aa3bfd145289323d91f366e25f4.glb'));
  await doc.transform(metalRough()); // its maps are bound as spec-gloss, which three.js no longer reads (the board rendered white): converted
  const b = boundsOf(doc);
  const k = 0.74 / (b.max[0] - b.min[0]); // a tournament board is 74 cm across its frame
  move(doc, null, S(k));
  await ship('carrom-board', doc, { source: ['sketchfab-eaf67aa3bfd145289323d91f366e25f4'], ratio: { full: 0.6, mid: 0.35, low: 0.15 }, tex: { full: 1024, mid: 512, low: 256 },
    note: 'spec-gloss maps converted to metal-rough; one uniform scale to a 74 cm board.' });
}

// ------------------------------------------------------------------ Poly Haven decor (CC0): a dartboard, a globe pendant, a chandelier
const ph = async (slug) => bake(await load(`${slug}/${slug}_1k.gltf`));
if (want('dartboard')) {
  const doc = await ph('dartboard');
  await ship('dartboard', doc, { source: ['dartboard'], ratio: { full: 0.5, mid: 0.3, low: 0.15 }, tex: { full: 512, mid: 256, low: 128 }, note: 'as modelled, decimated.' });
}
if (want('pendant')) {
  const doc = await ph('modern_ceiling_lamp_01');
  await ship('pendant', doc, { source: ['modern_ceiling_lamp_01'], ratio: { full: 0.5, mid: 0.3, low: 0.12 }, tex: { full: 512, mid: 512, low: 256 }, error: 0.004, note: 'as modelled, decimated.' });
}
if (want('chandelier')) {
  const doc = await ph('Chandelier_01');
  await ship('chandelier', doc, { source: ['Chandelier_01'], ratio: { full: 0.35, mid: 0.2, low: 0.08 }, tex: { full: 1024, mid: 512, low: 256 }, error: 0.004, note: 'as modelled, decimated.' });
}

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
lock.outputs = Object.fromEntries(Object.entries(outputs).sort());
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
