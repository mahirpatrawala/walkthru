// SPEC 16.14: the one command that bakes the lighting of a home.
//   npm run bake -- <sceneId> [--quality draft|final] [--presets afternoon,night] [--force] [--gpu] [--url http://localhost:5173] [--keep]
// Steps: (1) dump the scene the app builds, in headless Chrome; (2) hash it, stop if nothing changed; (3) check geometry parity; (4) make lightmap
// UVs and pack the atlases; (5) bake in Blender (sky, suns, lamps, probes, per-object AO); (6) compress and write public/scenes/<id>/baked/.
// Never part of `npm test` or the Vercel build: the outputs are committed assets.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pointInPolygon } from '../src/core/geometry';
import { validateProperty } from '../src/core/layout-validate';
import { PRESET_HOURS } from '../src/look/grade';
import type { LookPreset } from '../src/look/grade';
import { fillInvalidProbes } from '../src/look/baked/probes';
import { halfArray } from '../src/look/baked/half';
import { outdoorPortals, planDownlights, probeGridFor, sunKeys } from '../src/look/baked/lights';
import { checkParity } from '../src/look/baked/parity';
import { isFineDetail, unwrapAtlas } from '../src/look/baked/unwrap';
import type { UnwrapMesh, UnwrapResult } from '../src/look/baked/unwrap';
import { parseLookFile } from '../src/look/types';
import { applyDesigns, parseDesigns } from '../src/look/designs';
import { BAKE_FORMAT_VERSION, BAKE_PIPELINE_VERSION, COMPONENTS } from '../src/look/baked/types';
import type { AtlasFiles, BakeQuality, DynAtlas, BakedManifest, ComponentId, DumpMesh, MeshEntry } from '../src/look/baked/types';
import { parseManifest } from '../src/look/baked/manifest';
import { decideBake, inputsHashOf, sha256 } from './bake/hash';
import { dumpScene, ensureServer } from './bake/page';
import type { PageDump } from './bake/page';

const ROOT = path.resolve(import.meta.dirname, '..');
const BLENDER = process.env.BLENDER_BIN || '/Applications/Blender.app/Contents/MacOS/Blender';

interface Args { scene: string; quality: BakeQuality; presets: LookPreset[]; force: boolean; gpu: boolean; url?: string; keep: boolean; reuseDump: boolean; dumpOnly: boolean; furnitureTolMm: number }

function parseArgs(argv: string[]): Args {
  const a: Args = { scene: '', quality: 'draft', presets: ['morning', 'afternoon', 'evening', 'night'], force: false, gpu: false, keep: false, reuseDump: false, dumpOnly: false, furnitureTolMm: 1 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--quality') { const q = argv[++i]; if (q !== 'draft' && q !== 'final') throw new Error('--quality is draft or final'); a.quality = q; }
    else if (v === '--presets') {
      a.presets = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean) as LookPreset[];
      for (const p of a.presets) if (!(p in PRESET_HOURS)) throw new Error(`unknown preset "${p}" (morning, afternoon, evening, night)`);
      if (a.presets.length === 0) throw new Error('--presets needs at least one preset');
    }
    else if (v === '--force') a.force = true;
    else if (v === '--gpu') a.gpu = true;
    else if (v === '--keep') a.keep = true;
    else if (v === '--reuse-dump') a.reuseDump = true;
    else if (v === '--dump-only') a.dumpOnly = true;
    else if (v === '--furniture-tolerance-mm') a.furnitureTolMm = Number(argv[++i]);
    else if (v === '--url') a.url = argv[++i];
    else if (!v.startsWith('--') && !a.scene) a.scene = v;
    else throw new Error(`unknown argument ${v}`);
  }
  if (!/^[a-z0-9-]{1,40}$/.test(a.scene)) throw new Error('usage: npm run bake -- <sceneId> [--quality draft|final] [--presets afternoon,night] [--force] [--gpu]');
  return a;
}

/** What each quality means. The densities are texels per metre on a floor or wall. */
const QUALITY = {
  draft: { samples: 48, texelsPerM: 16, staticMax: 1024, dynTexelsPerM: 10, dynMax: 512, probeStep: 0.75, probeRays: 192, webp: 88 },
  final: { samples: 160, texelsPerM: 40, staticMax: 2048, dynTexelsPerM: 24, dynMax: 1024, probeStep: 0.5, probeRays: 512, webp: 90 },
} as const;

const SURFACE_DENSITY: Record<DumpMesh['surface'], number> = { floor: 1, wall: 1, ceiling: 0.5, kit: 0.6, other: 0.5, furniture: 1 };
/** a surface that faces no room (the outside of a wall, the end of a wall piece) is never seen: it gets a sliver of the density */
const HIDDEN_FACTOR = 0.1;

// the emitter constants of the bake; they are part of the inputs hash, so changing one re-bakes every scene
const LIGHT_SETUP = { skyTargetE: 1.0, tubeStrength: 24, downlightWatts: 40, coveStrength: 10, lampTargetE: 1.4, coveTargetE: 0.9, sunAngleDeg: 1.6, groundSky: 0.38, aoDistance: 0.45, downlightCone: 105 };

const sha = sha256;
const fileHash = (p: string): string => sha(fs.readFileSync(p));
const mb = (n: number): string => `${(n / 1e6).toFixed(2)} MB`;

function runBlender(script: string, jobPath: string, logPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(BLENDER)) return reject(new Error(`Blender not found at ${BLENDER} (set BLENDER_BIN)`));
    const log = fs.createWriteStream(logPath);
    const child = spawn(BLENDER, ['-b', '--factory-startup', '-P', script, '--', jobPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    const kill = (): void => { try { child.kill('SIGKILL'); } catch { /* gone */ } };
    process.once('exit', kill);
    process.once('SIGINT', () => { kill(); process.exit(130); });
    const onData = (d: Buffer): void => {
      log.write(d);
      for (const line of d.toString().split('\n')) if (line.startsWith('[bake')) console.log(line);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { log.end(); process.removeListener('exit', kill); code === 0 ? resolve() : reject(new Error(`Blender exited with ${code}, see ${logPath}`)); });
  });
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const sceneDir = path.join(ROOT, 'public', 'scenes', args.scene);
  const propPath = path.join(sceneDir, 'property.json');
  if (!fs.existsSync(propPath)) throw new Error(`no scene at ${path.relative(ROOT, sceneDir)}`);
  const property = validateProperty(JSON.parse(fs.readFileSync(propPath, 'utf8')));
  const layout = property.layout;
  const lookPath = path.join(sceneDir, 'look.json');
  const lookFile = fs.existsSync(lookPath) ? parseLookFile(JSON.parse(fs.readFileSync(lookPath, 'utf8'))) : null;
  const work = path.join(ROOT, '.cache', 'bake', args.scene);
  fs.mkdirSync(work, { recursive: true });
  const bakedDir = path.join(sceneDir, 'baked');
  const Q = QUALITY[args.quality];

  // ---- which components this run bakes
  const wantSun = (['morning', 'afternoon', 'evening'] as const).map((p) => args.presets.includes(p));
  const needLamps = args.presets.some((p) => p === 'evening' || p === 'night');
  const components: ComponentId[] = ['sky', 'ao'];
  (['sun0', 'sun1', 'sun2'] as const).forEach((c, i) => { if (wantSun[i]) components.push(c); });
  if (needLamps) components.push('lamps', 'cove');

  // ---- 1. the scene as the app builds it
  let page: PageDump;
  const dumpJson = path.join(work, 'dump.json');
  const dumpBin = path.join(work, 'dump.bin');
  if (args.reuseDump && fs.existsSync(dumpJson) && fs.existsSync(dumpBin)) {
    page = { dump: JSON.parse(fs.readFileSync(dumpJson, 'utf8')), bin: fs.readFileSync(dumpBin) };
    console.log('[bake] using the cached dump');
  } else {
    console.log('[bake] dumping the scene from the app (headless Chrome)...');
    const server = await ensureServer(args.url);
    try {
      page = await dumpScene(args.scene, { url: server.url, profileRoot: path.join(work, 'chrome') });
    } finally {
      await server.close();
    }
    fs.writeFileSync(dumpJson, JSON.stringify(page.dump));
    fs.writeFileSync(dumpBin, page.bin);
  }
  const { dump, bin } = page;
  console.log(`[bake] ${dump.meshes.length} meshes (${dump.meshes.filter((m) => m.cls === 'static').length} static, ${dump.meshes.filter((m) => m.cls === 'dyn').length} movable), ${mb(bin.length)}, ${dump.exporter}`);
  if (args.dumpOnly) return;

  // ---- 2. the hash: same inputs, same bake, nothing to do
  const scripts = [
    'tools/bake/bake_blender.py', 'scripts/bake-scene.ts', 'src/look/baked/unwrap.ts', 'src/look/baked/pack.ts', 'src/look/baked/lights.ts', 'src/look/baked/parity.ts', 'src/look/baked/types.ts',
  ].map((f) => `${f}:${fileHash(path.join(ROOT, f))}`);
  const sunHash = sunKeys(layout, lookFile);
  const inputsHash = inputsHashOf({
    meshes: dump.meshes, bin,
    settings: { quality: args.quality, components, Q, LIGHT_SETUP, sunHash, v: BAKE_PIPELINE_VERSION, f: BAKE_FORMAT_VERSION },
    sources: scripts,
  });
  const manifestPath = path.join(bakedDir, 'manifest.json');
  let oldManifest: BakedManifest | null = null;
  try { if (fs.existsSync(manifestPath)) oldManifest = parseManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))); } catch { oldManifest = null; }
  const decision = decideBake(oldManifest, inputsHash, args.force, (f) => fs.existsSync(path.join(bakedDir, f)));
  if (decision.action === 'skip') {
    console.log(`[bake] up to date (inputs hash ${inputsHash}). Nothing to do. Use --force to bake again.`);
    return;
  }
  console.log(`[bake] baking: ${decision.reason}`);

  // ---- 3. geometry parity against the scene data
  const designsPath = path.join(sceneDir, 'designs.json');
  const designs = fs.existsSync(designsPath) ? parseDesigns(JSON.parse(fs.readFileSync(designsPath, 'utf8'))) : null;
  const parity = checkParity(dump.meshes, layout, applyDesigns(property.furniture, designs), 0.001, args.furnitureTolMm / 1000);
  console.log(`[bake] parity: ${parity.checked} meshes checked against the layout, worst ${parity.maxDeltaMm.toFixed(3)} mm`);
  if (!parity.ok) {
    for (const f of parity.failures.slice(0, 12)) console.error(`  PARITY FAIL ${f.key}: ${f.what} (${f.deltaMm.toFixed(2)} mm)`);
    throw new Error(`geometry parity failed for ${parity.failures.length} mesh(es): the scene the app builds is not the scene the data describes. Nothing was baked.`);
  }

  // ---- 4. lightmap UVs
  const rooms = layout.rooms.filter((r) => r.polygon.length >= 3);
  const inAnyRoom = (x: number, y: number, z: number): boolean => y > -0.05 && y < layout.wallHeightM + 0.05 && rooms.some((r) => pointInPolygon({ x, z }, r.polygon));
  const balconyIds = new Set(layout.rooms.filter((r) => r.roomType === 'balcony').map((r) => r.id));
  const view = (m: DumpMesh) => ({
    pos: new Float32Array(bin.buffer.slice(bin.byteOffset + m.posOffset, bin.byteOffset + m.posOffset + m.verts * 12)),
    nor: new Float32Array(bin.buffer.slice(bin.byteOffset + m.norOffset, bin.byteOffset + m.norOffset + m.verts * 12)),
    idx: m.idxOffset !== undefined ? new Uint32Array(bin.buffer.slice(bin.byteOffset + m.idxOffset, bin.byteOffset + m.idxOffset + m.tris * 12)) : undefined,
  });
  const toUnwrap = (m: DumpMesh, kind: 'static' | 'dyn'): UnwrapMesh => {
    const v = view(m);
    const base = kind === 'static' ? Q.texelsPerM * SURFACE_DENSITY[m.surface] : Q.dynTexelsPerM;
    const checkVisible = kind === 'static' && m.surface !== 'floor' && m.surface !== 'ceiling';
    return {
      key: m.key, positions: v.pos, normals: v.nor, index: v.idx, texelsPerM: base, maxLeanDeg: kind === 'dyn' ? 60 : m.surface === 'kit' ? 80 : 25,
      densityOf: checkVisible ? ({ centroid, normal }) => (inAnyRoom(centroid[0] + normal[0] * 0.05, centroid[1] + normal[1] * 0.05, centroid[2] + normal[2] * 0.05) ? 1 : HIDDEN_FACTOR) : undefined,
    };
  };
  const staticAll = dump.meshes.filter((m) => m.cls === 'static');
  // fine detail (window bars, railings, switch plates) is not lightmapped: it shades and bounces in the bake, and keeps the old lighting
  const fine = staticAll.filter((m) => isFineDetail(toUnwrap(m, 'static')));
  const fineKeys = new Set(fine.map((m) => m.key));
  const staticMeshes = staticAll.filter((m) => !fineKeys.has(m.key));
  const dynMeshes = dump.meshes.filter((m) => m.cls === 'dyn');
  const sAtlas = unwrapAtlas(staticMeshes.map((m) => toUnwrap(m, 'static')), { pad: 3, minSize: 256, maxSize: Q.staticMax });
  const dAtlas = dynMeshes.length ? unwrapAtlas(dynMeshes.map((m) => toUnwrap(m, 'dyn')), { pad: 2, minSize: 128, maxSize: Q.dynMax }) : null;
  console.log(`[bake] lightmap atlas ${sAtlas.size}px (${(Q.texelsPerM * sAtlas.scale).toFixed(1)} texels/m), ${staticMeshes.length} meshes (${fine.length} fine-detail meshes left to the old lighting)${dAtlas ? `; object AO atlas ${dAtlas.size}px, ${dynMeshes.length} meshes` : ''}`);

  // uv.bin (float32 for Blender), remap.bin, and the shipped geometry.bin (uint16 uv + remaps) are built from the same results
  const uvAll: number[] = [];
  const remapAll: number[] = [];
  const jobMeshes: Record<string, unknown>[] = [];
  const rects: Record<string, number[][]> = {};
  const entries: Record<string, MeshEntry> = {};
  const uvShip: number[] = [];
  const u32Ship: number[] = [];
  const addAll = (list: DumpMesh[], atlas: { results: UnwrapResult[] } , kind: 'static' | 'dyn'): void => {
    list.forEach((m, i) => {
      const r = atlas.results[i];
      const uvFloatOffset = uvAll.length;
      for (let k = 0; k < r.uv.length; k++) uvAll.push(r.uv[k]);
      let remapOffset: number | undefined;
      let indexOffset: number | undefined;
      if (r.remap && r.index) {
        remapOffset = remapAll.length;
        for (const v of r.remap) remapAll.push(v);
        indexOffset = remapAll.length;
        for (const v of r.index) remapAll.push(v);
      }
      jobMeshes.push({ ...m, balcony: m.surface === 'floor' && [...balconyIds].some((id) => m.key === `shell/floor:${id}`), uvCount: r.uvCount, uvFloatOffset, remapOffset, indexOffset, kind });
      rects[kind === 'static' ? m.key : `dyn:${m.key}`] = r.rects;
      const e: MeshEntry = { verts: m.verts, checksum: m.checksum, atlas: kind, uvOffset: uvShip.length, uvCount: r.uvCount };
      for (let k = 0; k < r.uv.length; k++) uvShip.push(Math.min(65535, Math.max(0, Math.round(r.uv[k] * 65535))));
      if (r.remap && r.index) {
        e.remapOffset = u32Ship.length; e.remapCount = r.remap.length;
        for (const v of r.remap) u32Ship.push(v);
        e.indexOffset = u32Ship.length; e.indexCount = r.index.length;
        for (const v of r.index) u32Ship.push(v);
      }
      entries[m.key] = e;
    });
  };
  addAll(staticMeshes, sAtlas, 'static');
  for (const m of fine) {
    const uvFloatOffset = uvAll.length;
    for (let k = 0; k < m.verts * 2; k++) uvAll.push(0);
    jobMeshes.push({ ...m, noBake: true, uvCount: m.verts, uvFloatOffset, kind: 'static' });
  }
  if (dAtlas) addAll(dynMeshes, dAtlas, 'dyn');
  fs.writeFileSync(path.join(work, 'scene.bin'), bin);
  fs.writeFileSync(path.join(work, 'uv.bin'), Buffer.from(new Float32Array(uvAll).buffer));
  fs.writeFileSync(path.join(work, 'remap.bin'), Buffer.from(new Uint32Array(remapAll.length ? remapAll : [0]).buffer));

  // ---- lights, probes
  const suns = sunKeys(layout, lookFile);
  const probes = probeGridFor(layout, Q.probeStep);
  const validIdx: number[] = [];
  probes.valid.forEach((v, i) => { if (v) validIdx.push(i); });
  const probeIn = new Float32Array(validIdx.length * 3);
  validIdx.forEach((p, i) => { probeIn[i * 3] = probes.positions[p * 3]; probeIn[i * 3 + 1] = probes.positions[p * 3 + 1]; probeIn[i * 3 + 2] = probes.positions[p * 3 + 2]; });
  fs.writeFileSync(path.join(work, 'probes_in.bin'), Buffer.from(probeIn.buffer));
  const downlights = needLamps ? planDownlights(layout) : [];
  const tiers = {
    medium: { static: sAtlas.size, dyn: dAtlas?.size ?? 0 },
    low: { static: Math.max(256, sAtlas.size / 2), dyn: Math.max(64, (dAtlas?.size ?? 0) / 2) },
  };
  const outDir = path.join(work, 'out');
  fs.rmSync(outDir, { recursive: true, force: true });
  const job = {
    outDir, samples: Q.samples, denoise: true, gpu: args.gpu, components, webpQuality: Q.webp, tiers,
    atlas: { static: { size: sAtlas.size, pad: 3 }, dyn: dAtlas ? { size: dAtlas.size, pad: 2 } : null },
    meshes: jobMeshes, rects, suns: suns.map((s) => ({ id: s.id, toSun: s.toSun })),
    portals: outdoorPortals(layout), downlights: downlights.map((d) => ({ position: d.position, radius: d.radiusM })),
    probes: { rays: Q.probeRays }, ...LIGHT_SETUP,
  };
  const jobPath = path.join(work, 'job.json');
  fs.writeFileSync(jobPath, JSON.stringify(job));

  // ---- 5. Blender
  console.log(`[bake] Blender: ${components.join(', ')}, ${Q.samples} samples, ${probes.valid.reduce((a, b) => a + b, 0)} probes...`);
  const tBlender = Date.now();
  await runBlender(path.join(ROOT, 'tools', 'bake', 'bake_blender.py'), jobPath, path.join(work, 'blender.log'));
  const results = JSON.parse(fs.readFileSync(path.join(outDir, 'results.json'), 'utf8')) as {
    parity: { maxMm: number; worstKey: string }; blender: string; denoised: boolean; calibration: Record<string, { scale: number }>;
    files: { static: Record<string, Record<string, { bytes: number; gain: number; size: number }>>; dyn: Record<string, Record<string, { bytes: number; gain: number; size: number }>> };
    probes?: { count: number; components: string[] };
  };
  if (results.parity.maxMm > 1) throw new Error(`Blender round trip changed ${results.parity.worstKey} by ${results.parity.maxMm.toFixed(3)} mm (limit 1 mm)`);

  // ---- 6. write public/scenes/<id>/baked/
  fs.rmSync(bakedDir, { recursive: true, force: true });
  fs.mkdirSync(bakedDir, { recursive: true });
  const copyHashed = (src: string, name: string): { file: string; bytes: number } => {
    const buf = fs.readFileSync(src);
    const file = name.replace(/(\.[a-z0-9]+)$/, `.${sha(buf).slice(0, 8)}$1`);
    fs.writeFileSync(path.join(bakedDir, file), buf);
    return { file, bytes: buf.length };
  };
  const atlases = {} as BakedManifest['atlases'];
  for (const tier of ['medium', 'low'] as const) {
    const st: AtlasFiles = { size: tiers[tier].static, components: {} };
    for (const c of components) {
      const info = results.files.static[tier]?.[c];
      if (!info) continue;
      const f = copyHashed(path.join(outDir, tier, `static-${c}.webp`), `${tier}-static-${c}.webp`);
      st.components[c] = { file: f.file, bytes: f.bytes, gain: info.gain };
    }
    let dyn: DynAtlas | undefined;
    if (dAtlas && results.files.dyn[tier]?.ao) {
      const f = copyHashed(path.join(outDir, tier, 'dyn-ao.webp'), `${tier}-dyn-ao.webp`);
      dyn = { size: tiers[tier].dyn, ao: { file: f.file, bytes: f.bytes, gain: 1 } };
    }
    atlases[tier] = dyn ? { static: st, dyn } : { static: st };
  }
  // geometry.bin: uint16 uvs, padded to 4 bytes, then the uint32 remap / index lists
  const uvBuf = Buffer.from(new Uint16Array(uvShip).buffer);
  const pad = (4 - (uvBuf.length % 4)) % 4;
  const geo = Buffer.concat([uvBuf, Buffer.alloc(pad), Buffer.from(new Uint32Array(u32Ship).buffer)]);
  const geoFile = copyHashed(writeTmp(work, 'geometry.bin', geo), 'geometry.bin');
  // probes.bin: the valid probes come back from Blender; expand to the grid, fill the walls, store half floats
  let probeGrid: BakedManifest['probes'];
  const probeRaw = path.join(outDir, 'probes.bin');
  if (fs.existsSync(probeRaw) && results.probes) {
    const K = results.probes.components.length;
    const stride = K * 27;
    const got = new Float32Array(fs.readFileSync(probeRaw).buffer.slice(0));
    const total = probes.valid.length;
    const grid = new Float32Array(total * stride);
    validIdx.forEach((p, i) => grid.set(got.subarray(i * stride, (i + 1) * stride), p * stride));
    fillInvalidProbes(grid, probes.valid, probes.dims, stride);
    const half = Buffer.from(halfArray(grid).buffer);
    const f = copyHashed(writeTmp(work, 'probes.bin', half), 'probes.bin');
    probeGrid = { origin: probes.origin, spacing: probes.spacing, dims: probes.dims, coeffs: 9, components: results.probes.components as ComponentId[], file: f.file, bytes: f.bytes, validCount: validIdx.length };
  }
  const seconds = (Date.now() - t0) / 1000;
  const sunsBaked = suns.filter((_, i) => wantSun[i]);
  const fileBytes = (): number => fs.readdirSync(bakedDir).reduce((s, f) => s + fs.statSync(path.join(bakedDir, f)).size, 0);
  const manifest: BakedManifest = {
    version: BAKE_FORMAT_VERSION, sceneId: args.scene, inputsHash,
    pipeline: { version: BAKE_PIPELINE_VERSION, blender: results.blender, quality: args.quality, samples: Q.samples, denoised: results.denoised, texelsPerM: Math.round(Q.texelsPerM * sAtlas.scale * 10) / 10, presets: args.presets, seconds: Math.round(seconds), createdAt: new Date().toISOString() },
    sun: sunsBaked, atlases, geometry: { file: geoFile.file, bytes: geoFile.bytes, uvElements: uvShip.length }, meshes: entries,
    fixtures: downlights, calibration: { lampMeanIrradiance: LIGHT_SETUP.lampTargetE, coveMeanIrradiance: LIGHT_SETUP.coveTargetE },
    totals: { bytes: 0, meshes: dump.meshes.length, staticMeshes: staticMeshes.length, dynMeshes: dynMeshes.length },
  };
  if (probeGrid) manifest.probes = probeGrid;
  manifest.totals.bytes = fileBytes();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  manifest.totals.bytes = fileBytes();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  if (!args.keep) fs.rmSync(outDir, { recursive: true, force: true });
  const mediumBytes = Object.values(atlases.medium.static.components).reduce((s, c) => s + (c?.bytes ?? 0), 0) + geoFile.bytes + (probeGrid?.bytes ?? 0);
  console.log(`[bake] done in ${(seconds / 60).toFixed(1)} min (Blender ${((Date.now() - tBlender) / 60000).toFixed(1)} min). public/scenes/${args.scene}/baked: ${mb(manifest.totals.bytes)} on disk, about ${mb(mediumBytes)} fetched on the medium tier.`);
}

function writeTmp(dir: string, name: string, data: Buffer): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  return p;
}

main().catch((e) => { console.error(`[bake] FAILED: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
void COMPONENTS;
