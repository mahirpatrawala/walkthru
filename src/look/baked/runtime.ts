// SPEC 16.14: the runtime of the baked look. Loads public/scenes/<id>/baked/manifest.json after first paint and swaps the baked lighting in:
//   * lightmap of the room (shell + kit): the baked components are mixed per time of day into one picture (composite.ts)
//   * light probes (SH) for everything movable: furniture, door leaves, decor, the walker, pieces the buyer adds
//   * per-object AO (own atlas) for movable pieces, a soft contact shadow of furniture on the floor (floor-ao.ts), downlight discs
// A scene with no bake, a corrupt bake, a bake of another format, or `?bake=off`, renders exactly as before. Baking changes only light:
// no size, no layout, no collision, no measurement reads anything in this folder (SPEC 16.2).
import * as THREE from 'three';
import type { Layout } from '../../types';
import { buildAoField } from '../floor-ao';
import type { Look } from '../look';
import { assignByName, parseGeometryBuffer } from './assign';
import type { BakedGeometry } from './assign';
import { Compositor } from './composite';
import type { CompositorInput, CompositorLike } from './composite';
import type { BakedHook, BakedUpdate } from './hook';
import { parseManifest } from './manifest';
import { createPatchUniforms, patchDynamic, patchStatic } from './patch';
import { ProbeVolume, SH_FLOATS } from './probes';
import { floatArray } from './half';
import { FILL_FRACTION, ambientFill, componentWeights } from './weights';
import type { AtlasTier, BakedManifest, ComponentId } from './types';

export type BakedState = 'idle' | 'loading' | 'ready' | 'failed' | 'absent';

export interface BakedStats {
  state: BakedState;
  tierSet: AtlasTier | null;
  staticMeshes: number;
  dynMeshes: number;
  probeObjects: number;
  bytesFetched: number;
  rejected: string[];
  clonedMaterials: number;
}

export interface BakedHandle extends BakedHook {
  readonly state: BakedState;
  readonly manifest: BakedManifest | null;
  readonly ready: Promise<BakedState>;
  stats(): BakedStats;
  /** looks again for meshes that appeared (a piece the buyer added, a rebuilt tier) */
  rescan(): void;
  /** debug: the compositor's picture */
  readonly lightmap: THREE.Texture | null;
}

export interface MountOptions {
  look: Look;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  sceneId: string;
  layout: Layout;
  /** objects lit by the probes although they are not under the furniture root (the walker) */
  extraDynamic?: () => THREE.Object3D[];
  fetchImpl?: typeof fetch;
  /** `/scenes/<id>/baked` by default */
  baseUrl?: string;
  /** called once the bake is applied (or has failed) */
  onState?: (s: BakedState) => void;
  /** replaceable for tests: decode a picture, make the compositor */
  deps?: {
    loadTexture?: (blob: Blob) => Promise<THREE.Texture>;
    makeCompositor?: (size: number, inputs: Partial<Record<ComponentId, CompositorInput>>) => CompositorLike;
  };
}

const SCENE_ID_RE = /^[a-z0-9-]{1,40}$/;
/** the sky component is multiplied by this so that baked rooms (lit by what comes through the windows) read airy like a rendered interior */
export const SKY_BOOST = 1.3;
/** a baked texel that came out black (a face inside another piece) never darkens past 1 - this */
export const OBJECT_AO_STRENGTH = 0.65;
export const PROBE_FILL_SHADE = 0.55;
/** a probe sits in open air, a wall texel sits in a corner of it: without this a sofa by the window reads brighter than the wall behind it */
export const PROBE_GAIN = 0.7;
/** debug only: `?bakesky=2&bakefill=0.3` while tuning a look by eye */
function queryNumber(name: string, d: number): number {
  try { const v = Number(new URLSearchParams(location.search).get(name)); return Number.isFinite(v) && v > 0 ? v : d; } catch { return d; }
}

export async function fetchManifest(sceneId: string, base: string, f: typeof fetch = fetch): Promise<BakedManifest | null> {
  try {
    if (!SCENE_ID_RE.test(sceneId)) return null;
    const res = await f(`${base}/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const text = await res.text();
    if (/^\s*</.test(text)) return null; // a dev server answers a missing file with its index page
    const m = parseManifest(JSON.parse(text));
    return m && m.sceneId === sceneId ? m : null;
  } catch {
    return null;
  }
}

/** Makes the handle at once (state 'idle'), loads in the background. Resolves `ready` with the final state. */
export function mountBaked(o: MountOptions): BakedHandle {
  const f = o.fetchImpl ?? fetch;
  const base = o.baseUrl ?? `/scenes/${o.sceneId}/baked`;
  const u = createPatchUniforms();
  let state: BakedState = 'idle';
  let manifest: BakedManifest | null = null;
  let disposed = false;
  let tierSet: AtlasTier | null = null;
  let compositor: CompositorLike | null = null;
  let volume: ProbeVolume | null = null;
  let aoTex: THREE.Texture | null = null;
  let geometry: BakedGeometry | null = null;
  let fixtures: THREE.Mesh | null = null;
  let textures: THREE.Texture[] = [];
  let lastOff = true;
  let lastUpdate: BakedUpdate | null = null;
  let weightsVersion = 1;
  let lastWeightsKey = '';
  let bytesFetched = 0;
  const rejected: string[] = [];
  let clonedMaterials = 0;
  const tune = { sky: queryNumber('bakesky', SKY_BOOST), fill: queryNumber('bakefill', FILL_FRACTION) };
  const applied = new Map<THREE.Mesh, { key: string; kind: 'static' | 'dyn' | 'probe' }>();
  const probed = new Set<THREE.Mesh>();
  const sunHours = (): (number | null)[] => [0, 1, 2].map((i) => manifest?.sun.find((s) => s.id === (['sun0', 'sun1', 'sun2'] as const)[i])?.hour ?? null);
  let resolveReady!: (s: BakedState) => void;
  const ready = new Promise<BakedState>((r) => { resolveReady = r; });
  const finish = (s: BakedState): void => { state = s; o.onState?.(s); resolveReady(s); };

  const url = (file: string): string => `${base}/${file}`;
  async function getBuffer(file: string, expect?: number): Promise<ArrayBuffer> {
    const res = await f(url(file));
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (expect !== undefined && buf.byteLength !== expect) throw new Error(`${file}: ${buf.byteLength} bytes, the manifest says ${expect}`);
    bytesFetched += buf.byteLength;
    return buf;
  }
  async function getTexture(file: string, expect: number): Promise<THREE.Texture> {
    const res = await f(url(file));
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const blob = await res.blob();
    if (blob.size !== expect) throw new Error(`${file}: ${blob.size} bytes, the manifest says ${expect}`);
    bytesFetched += blob.size;
    const t = o.deps?.loadTexture ? await o.deps.loadTexture(blob) : new THREE.Texture((await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })) as unknown as HTMLImageElement);
    t.flipY = false;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    textures.push(t);
    return t;
  }

  // ---- loading
  const makeCompositor = (size: number, inputs: Partial<Record<ComponentId, CompositorInput>>): CompositorLike => (o.deps?.makeCompositor ? o.deps.makeCompositor(size, inputs) : new Compositor(o.renderer, size, inputs));
  async function loadSet(tier: AtlasTier): Promise<{ inputs: Partial<Record<ComponentId, CompositorInput>>; ao: THREE.Texture | null; textures: THREE.Texture[] }> {
    const set = manifest!.atlases[tier];
    const before = textures.length;
    const inputs: Partial<Record<ComponentId, CompositorInput>> = {};
    await Promise.all(Object.entries(set.static.components).map(async ([c, file]) => {
      if (!file) return;
      inputs[c as ComponentId] = { texture: await getTexture(file.file, file.bytes), gain: file.gain };
    }));
    let ao: THREE.Texture | null = null;
    if (set.dyn) { ao = await getTexture(set.dyn.ao.file, set.dyn.ao.bytes); ao.channel = 1; }
    return { inputs, ao, textures: textures.slice(before) };
  }
  /** a tier change swaps the pictures for the other set (low = half the texels) without touching the meshes */
  let swapping = false;
  async function ensureTier(): Promise<void> {
    if (state !== 'ready' || swapping || disposed || !manifest) return;
    const want: AtlasTier = o.look.tier === 'low' ? 'low' : 'medium';
    if (want === tierSet) return;
    swapping = true;
    try {
      const old = { c: compositor, ao: aoTex, t: textures.slice() };
      textures = [];
      const next = await loadSet(want);
      if (disposed) return;
      compositor = makeCompositor(manifest.atlases[want].static.size, next.inputs);
      aoTex = next.ao;
      tierSet = want;
      for (const [mesh, rec] of applied) {
        if (rec.kind === 'dyn') { const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; for (const m of mats) { const s2 = m as THREE.MeshStandardMaterial; if (s2.isMeshStandardMaterial && s2.aoMap) { s2.aoMap = aoTex; s2.needsUpdate = true; } } }
        if (rec.kind === 'static') applyStaticMaterial(mesh);
      }
      if (lastUpdate) update(lastUpdate);
      old.c?.dispose();
      for (const t of old.t) t.dispose();
    } catch (e) {
      console.warn('[walkthru] the baked pictures for this tier could not be loaded, keeping the current ones', e);
    } finally { swapping = false; }
  }
  const offLook = o.look.onChange(() => { void ensureTier(); });

  async function load(): Promise<void> {
    state = 'loading';
    const m = await fetchManifest(o.sceneId, base, f);
    if (disposed) return;
    if (!m) { finish('absent'); return; }
    manifest = m;
    try {
      await o.look.ready;
      await new Promise<void>((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 300)));
      if (disposed) return;
      const tier: AtlasTier = o.look.tier === 'low' ? 'low' : 'medium';
      const geo = await getBuffer(m.geometry.file, m.geometry.bytes);
      geometry = parseGeometryBuffer(geo, m.geometry.uvElements);
      const loaded = await loadSet(tier);
      const inputs = loaded.inputs;
      aoTex = loaded.ao;
      if (m.probes) {
        const pb = await getBuffer(m.probes.file, m.probes.bytes);
        const total = m.probes.dims[0] * m.probes.dims[1] * m.probes.dims[2] * m.probes.components.length * SH_FLOATS;
        if (pb.byteLength !== total * 2) throw new Error('probes.bin does not match the grid');
        volume = new ProbeVolume(m.probes, floatArray(new Uint16Array(pb)));
      }
      if (disposed) return;
      compositor = makeCompositor(m.atlases[tier].static.size, inputs);
      tierSet = tier;
      buildFixtures();
      scan();
      state = 'ready';
      o.look.setBaked(handle);
      finish('ready');
    } catch (e) {
      console.warn('[walkthru] the baked lighting could not be applied, the scene keeps its normal lighting:', e);
      cleanup();
      finish('failed');
    }
  }

  // ---- applying to meshes
  const tmpV = new THREE.Vector3();
  const sh27 = new Float32Array(SH_FLOATS);
  function attachProbe(mesh: THREE.Mesh, yOffset?: number): void {
    if (probed.has(mesh)) return;
    probed.add(mesh);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) patchDynamic(m, u);
    mesh.userData.wtProbed = true;
    let seen = -1;
    let lx = NaN, ly = NaN, lz = NaN;
    const prevBefore = mesh.onBeforeRender;
    mesh.onBeforeRender = function (this: THREE.Mesh, ...args: Parameters<THREE.Object3D['onBeforeRender']>) {
      prevBefore?.apply(this, args);
      const material = args[4] as THREE.Material;
      if (!volume || !(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
      if (yOffset !== undefined) this.getWorldPosition(tmpV).y += yOffset;
      else {
        const gb = this.geometry.boundingBox ?? (this.geometry.computeBoundingBox(), this.geometry.boundingBox!);
        gb.getCenter(tmpV).applyMatrix4(this.matrixWorld);
      }
      if (seen !== weightsVersion || Math.abs(tmpV.x - lx) + Math.abs(tmpV.y - ly) + Math.abs(tmpV.z - lz) > 0.02) {
        volume.sample(tmpV.x, tmpV.y, tmpV.z, sh27);
        seen = weightsVersion; lx = tmpV.x; ly = tmpV.y; lz = tmpV.z;
      }
      const arr = u.sh.value;
      for (let k = 0; k < 9; k++) arr[k].set(sh27[k * 3], sh27[k * 3 + 1], sh27[k * 3 + 2]);
      (material as unknown as { uniformsNeedUpdate: boolean }).uniformsNeedUpdate = true;
    };
  }

  function applyStaticMaterial(mesh: THREE.Mesh): void {
    const lm = compositor?.target.texture ?? null;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial) continue;
      patchStatic(std, u);
      if (std.lightMap !== lm) { std.lightMap = lm; std.needsUpdate = true; }
      std.lightMapIntensity = lastOff ? 0 : 1;
    }
  }

  function applyDynMaterial(mesh: THREE.Mesh): void {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.isMeshStandardMaterial || !aoTex) continue;
      if (std.aoMap !== aoTex) { std.aoMap = aoTex; std.aoMapIntensity = OBJECT_AO_STRENGTH; std.needsUpdate = true; }
    }
  }

  /** A material shared between a mesh the bake lights and one it leaves alone would light both. The lit one gets its own copy. */
  function isolateMaterials(meshes: THREE.Mesh[]): void {
    if (!meshes.length) return;
    const mine = new Set<THREE.Mesh>([...applied.keys(), ...meshes]);
    const users = new Map<THREE.Material, { mine: boolean; others: boolean }>();
    const visit = (m: THREE.Mesh): void => {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        const u = users.get(mat) ?? { mine: false, others: false };
        if (mine.has(m)) u.mine = true; else u.others = true;
        users.set(mat, u);
      }
    };
    o.scene.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) visit(m); });
    for (const m of meshes) {
      const swap = (mat: THREE.Material): THREE.Material => {
        const u = users.get(mat);
        if (!u || !u.others || mat.userData.wtclone) return mat;
        const key = mat as THREE.Material & { __wtClone?: THREE.Material };
        if (!key.__wtClone) {
          const c = mat.clone();
          c.onBeforeCompile = mat.onBeforeCompile;
          c.customProgramCacheKey = mat.customProgramCacheKey;
          c.userData = { ...c.userData, wtclone: true, shared: false };
          key.__wtClone = c;
          clonedMaterials++;
        }
        return key.__wtClone;
      };
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    }
  }

  function scan(): void {
    const mf = manifest;
    if (!mf || !geometry) return;
    const { assigned, rejected: rej } = assignByName(o.scene, mf, geometry, (m) => applied.has(m));
    for (const r of rej) if (!rejected.includes(r)) rejected.push(r);
    isolateMaterials(assigned.map((a) => a.mesh));
    for (const r of assigned) {
      if (r.kind === 'static') { applied.set(r.mesh, { key: r.key, kind: 'static' }); applyStaticMaterial(r.mesh); }
      else if (r.kind === 'dyn') { applied.set(r.mesh, { key: r.key, kind: 'dyn' }); applyDynMaterial(r.mesh); attachProbe(r.mesh); }
      else { applied.set(r.mesh, { key: r.key, kind: 'probe' }); attachProbe(r.mesh); }
    }
    // static meshes already assigned: their material may have been swapped (the kit swaps floors), keep the lightmap on the current one
    for (const [mesh, rec] of applied) if (rec.kind === 'static') applyStaticMaterial(mesh);
    for (const x of o.extraDynamic?.() ?? []) {
      x.traverse((c) => {
        const m = c as THREE.Mesh;
        if ((m.isMesh || (c as THREE.SkinnedMesh).isSkinnedMesh) && !probed.has(m)) attachProbe(m, 0.9);
      });
    }
    if (lastUpdate) update(lastUpdate);
  }

  // ---- downlight discs: the visible fixtures of the lamps the bake lit
  function buildFixtures(): void {
    const list = manifest?.fixtures ?? [];
    if (!list.length) return;
    const geos: THREE.BufferGeometry[] = [];
    for (const fx of list) {
      const g = new THREE.CircleGeometry(fx.radiusM, 14);
      g.rotateX(Math.PI / 2); // faces down
      g.translate(fx.position[0], fx.position[1] - 0.004, fx.position[2]);
      geos.push(g);
    }
    const merged = mergeGeometries(geos);
    for (const g of geos) g.dispose();
    const mat = new THREE.MeshBasicMaterial({ color: '#cfcac2', side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = 'baked:downlights';
    mesh.raycast = () => {};
    mesh.userData.decor = true;
    mesh.userData.walkthruBake = 'skip';
    o.scene.add(mesh);
    fixtures = mesh;
  }
  function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const pos: number[] = [], idx: number[] = [];
    let base = 0;
    for (const g of list) {
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
      const ix = g.getIndex();
      if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
      base += p.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setIndex(idx);
    return out;
  }
  const FIXTURE_OFF = new THREE.Color('#cfcac2');
  const FIXTURE_ON = new THREE.Color().setRGB(2.4, 1.9, 1.3);

  // ---- the light
  function update(up: BakedUpdate): void {
    lastUpdate = up;
    if (state !== 'ready' || !compositor) return;
    const off = up.off;
    lastOff = off;
    u.baked.value = off ? 0 : 1;
    u.probe.value = off || !volume ? 0 : 1;
    for (const [mesh, rec] of applied) {
      if (rec.kind !== 'static') continue;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) { const s = m as THREE.MeshStandardMaterial; if (s.isMeshStandardMaterial) s.lightMapIntensity = off ? 0 : 1; }
    }
    if (fixtures) fixtures.visible = !off;
    if (off) return;
    const w = componentWeights({ grade: up.grade, skyScale: 1, sunScale: 1, sunHours: sunHours(), skyBoost: tune.sky });
    const fill = ambientFill(up.grade, tune.fill);
    compositor.compose(w, fill);
    // the lightmap's fill is shaded by the static AO (about 0.55 on average in a room); a probe has no such shade, so its fill is scaled to match
    const wkey = [...Object.values(w).flat(), ...fill].map((v) => v.toFixed(4)).join(',');
    if (volume && wkey !== lastWeightsKey) { lastWeightsKey = wkey; const gw: typeof w = { ...w }; for (const k of Object.keys(w) as (keyof typeof w)[]) gw[k] = [w[k][0] * PROBE_GAIN, w[k][1] * PROBE_GAIN, w[k][2] * PROBE_GAIN]; volume.setWeights(gw, [fill[0] * PROBE_FILL_SHADE * PROBE_GAIN, fill[1] * PROBE_FILL_SHADE * PROBE_GAIN, fill[2] * PROBE_FILL_SHADE * PROBE_GAIN]); weightsVersion++; }
    if (fixtures) {
      const lvl = Math.min(1, up.grade.interior.tube);
      (fixtures.material as THREE.MeshBasicMaterial).color.copy(FIXTURE_OFF).lerp(FIXTURE_ON, lvl);
    }
  }

  function cleanup(): void {
    for (const [mesh, rec] of applied) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const s = m as THREE.MeshStandardMaterial;
        if (rec.kind === 'static') { s.lightMapIntensity = 0; }
      }
    }
    u.baked.value = 0;
    u.probe.value = 0;
    compositor?.dispose(); compositor = null;
    for (const t of textures) t.dispose();
    textures = [];
    if (fixtures) { o.scene.remove(fixtures); fixtures.geometry.dispose(); (fixtures.material as THREE.Material).dispose(); fixtures = null; }
  }

  const handle: BakedHandle = {
    get state() { return state; },
    get manifest() { return manifest; },
    get ready() { return ready; },
    get active() { return state === 'ready' && !lastOff; },
    get lightmap() { return compositor?.target.texture ?? null; },
    update,
    contactField: (grid) => buildAoField(grid, { furnitureOnly: true, minAo: 0.5, rangeM: 0.3 }),
    rescan: scan,
    stats: () => ({
      state, tierSet, staticMeshes: [...applied.values()].filter((r) => r.kind === 'static').length, dynMeshes: [...applied.values()].filter((r) => r.kind === 'dyn').length,
      probeObjects: probed.size, bytesFetched, rejected: [...rejected], clonedMaterials,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      offLook();
      cleanup();
      o.look.setBaked(null);
    },
  };

  void load();
  return handle;
}
