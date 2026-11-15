// Fetches, parses and caches the model GLBs (SPEC 16.15). A model is fetched only when a piece of the home can use it (the library's
// `planFurniture` / `decorChoice` said yes), lazily, after the generated piece is already on screen; the tier picks the file (`low` is the
// phone file). A failed fetch or parse leaves the generated piece in place: nothing here ever throws into the caller.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Tier } from '../types';
import { modelInfo, modelUrl } from './library';
import type { ModelTier } from './library';

export const tierFile = (t: Tier): ModelTier => (t === 'low' ? 'low' : 'full');

/** A parsed model: its parts in the model's own frame (origin and front as the manifest says), never mutated: instances clone the geometry. */
export interface Template {
  id: string;
  tier: ModelTier;
  parts: { name: string; geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }[];
}

/** bytes and files fetched so far (the weight checks read this) */
export const modelStats = { bytes: 0, files: [] as { url: string; bytes: number }[], parsed: 0, failed: [] as string[] };

type Fetcher = (url: string) => Promise<ArrayBuffer>;
const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  return res.arrayBuffer();
};
let fetcher: Fetcher = defaultFetcher;
/** tests hand in a reader of the files on disk, or null to go back to fetch */
export function setModelFetcher(f: Fetcher | null): void { fetcher = f ?? defaultFetcher; }

const cache = new Map<string, Promise<Template | null>>();
let pending = 0;
const idleWaiters: (() => void)[] = [];
function settle(): void { if (pending === 0) for (const w of idleWaiters.splice(0)) w(); }
/** resolves when no model is being fetched or parsed (the bake driver waits for it before it dumps the scene) */
export function modelsIdle(): Promise<void> { return pending === 0 ? Promise.resolve() : new Promise((r) => { idleWaiters.push(r); }); }

function loader(): GLTFLoader {
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  return l;
}

/**
 * A copy of the geometry with float attributes. meshopt quantises positions, normals and UVs to normalised integers, and the node transform
 * that undoes it holds the scale: applying that transform to integer attributes would clip every value back into [-1, 1].
 */
export function floatGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) {
    const attr = a as THREE.BufferAttribute;
    const f = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) for (let k = 0; k < attr.itemSize; k++) f[i * attr.itemSize + k] = k === 0 ? attr.getX(i) : k === 1 ? attr.getY(i) : k === 2 ? attr.getZ(i) : attr.getW(i);
    g.setAttribute(name, new THREE.BufferAttribute(f, attr.itemSize));
  }
  const idx = src.getIndex();
  if (idx) g.setIndex(new THREE.BufferAttribute(idx.array.slice(), 1));
  return g;
}

/** Loads (once per id and file) a model template. Resolves null when the model could not be had: the caller keeps its generated piece. */
export function loadModel(id: string, tier: Tier): Promise<Template | null> {
  const file = tierFile(tier);
  const url = modelUrl(id, file);
  if (!url) return Promise.resolve(null);
  let p = cache.get(url);
  if (p) return p;
  pending += 1;
  p = (async (): Promise<Template | null> => {
    try {
      const buf = await fetcher(url);
      modelStats.bytes += buf.byteLength;
      modelStats.files.push({ url, bytes: buf.byteLength });
      const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
      if (magic !== 'glTF') throw new Error(`${url} is not a GLB (starts with "${magic}")`);
      const gltf = await loader().parseAsync(buf, '/look/models/');
      const parts: Template['parts'] = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
        // the node transform (meshopt's dequantisation) goes into the vertices once, here: instances then only scale
        const g = floatGeometry(m.geometry);
        g.applyMatrix4(m.matrixWorld);
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        parts.push({ name: m.name || m.parent?.name || 'part', geometry: g, material: mat });
      });
      if (parts.length === 0) throw new Error(`${url} has no mesh`);
      modelStats.parsed += 1;
      checkSize(id, parts);
      return { id, tier: file, parts };
    } catch (err) {
      modelStats.failed.push(url);
      console.warn(`[walkthru] model ${id} not loaded, the generated piece stays:`, err instanceof Error ? err.message : err);
      cache.delete(url);
      return null;
    } finally {
      pending -= 1;
      settle();
    }
  })();
  cache.set(url, p);
  return p;
}

/** the measured size in the manifest is what every fit decision used: a file that is not that size is a build error, said loudly in dev */
function checkSize(id: string, parts: Template['parts']): void {
  const info = modelInfo(id);
  if (!info) return;
  const box = new THREE.Box3();
  for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox as THREE.Box3); }
  const s = box.getSize(new THREE.Vector3());
  const off = Math.max(Math.abs(s.x - info.dims.w), Math.abs(s.y - info.dims.h), Math.abs(s.z - info.dims.d));
  if (off > 0.01) console.warn(`[walkthru] model ${id} measures ${s.x.toFixed(3)} x ${s.y.toFixed(3)} x ${s.z.toFixed(3)}, the manifest says ${info.dims.w} x ${info.dims.h} x ${info.dims.d}`);
}

/** tests hand in a template made by hand (the real files need a browser to decode their WebP textures) */
export function primeModel(id: string, tier: Tier, tpl: Template): void {
  const url = modelUrl(id, tierFile(tier));
  if (url) cache.set(url, Promise.resolve(tpl));
}

/** forget every cached model (tests) */
export function clearModelCache(): void { cache.clear(); modelStats.bytes = 0; modelStats.files.length = 0; modelStats.parsed = 0; modelStats.failed.length = 0; }
