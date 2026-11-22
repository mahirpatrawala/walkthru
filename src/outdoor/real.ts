// The photographic layer of the open-air spaces (SPEC 19.12, 22 Nov 2026): which shipped file each plant, finish and model uses, and the loading
// of the coconut palm model. Everything here arrives AFTER the first paint and replaces something already drawn (a painted leaf spray, a
// procedural palm, a flat tint), so a phone that never gets a file still sees the space; nothing here decides a size (16.2).
// Files: public/look/outdoor/ (tools/optimise-outdoor-real.mjs; sources, authors and licences in sources.lock.json and LICENCE.txt).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Tier } from '../look/types';
import { LOOK_BASE } from '../look/assets';
import type { AssetLoader } from '../look/assets';
import type { SpeciesId } from './types';
import modelFacts from './models.json';

const BASE = 'outdoor/';
const lowOf = (tier: Tier): string => (tier === 'low' ? '.low' : '');

/** the species whose leaf card is a spray composed from real leaf photographs (the palms take the frond picture) */
export const PHOTO_SPRAYS: readonly SpeciesId[] = ['neem', 'gulmohar', 'frangipani', 'ficus', 'hibiscus', 'bougainvillea', 'croton'];
export const sprayPath = (id: SpeciesId, tier: Tier): string | null => (PHOTO_SPRAYS.includes(id) ? `${BASE}leaves/${id}${lowOf(tier)}.webp` : null);
export const FROND_PATH = `${BASE}leaves/palm-frond.webp`;
export const HEDGE_PATH = `${BASE}leaves/hedge-ficus.jpg`;
export const BARK_PATH = `${BASE}tex/bark_diff.jpg`;
export const GRASS_PATH = `${BASE}grass/tufts.webp`;
export const DECK_PATHS = { diff: `${BASE}tex/deck_diff.jpg`, nor: `${BASE}tex/deck_nor.jpg` } as const;
export const MOSAIC_PATHS = { diff: `${BASE}tex/mosaic_diff.jpg`, nor: `${BASE}tex/mosaic_nor.jpg` } as const;
/** metres one repeat of the shipped mosaic covers: twelve 2.5 cm glass tiles */
export const MOSAIC_REPEAT_M = 0.3;
/** metres one repeat of the deck covers (Poly Haven wooden_planks: 2 x 2 m) */
export const DECK_REPEAT_M = 2;
export const BARK_REPEAT_M = 1.5;

/** SPEC 19.13: the models of tools/optimise-outdoor-models.mjs, as measured on the shipped files (one file a tier: .low, .med and the full one) */
export interface ModelFacts { kind: 'plant' | 'piece'; height: number; parts: string[]; min: number[]; max: number[]; tiers: Record<Tier, { file: string; bytes: number; tris: number }> }
export const MODEL_FACTS = (modelFacts as unknown as { models: Record<string, ModelFacts> }).models;

/** the plants drawn by a model (SPEC 19.12 coconut palm; SPEC 19.13 the others): the file per tier, its height as shipped (metres) and its parts */
export type OutdoorModelId = 'coconut-palm' | 'neem' | 'areca-palm' | 'royal-palm';
export interface OutdoorModel { file(tier: Tier): string; heightM: number; parts: readonly string[] }
const fromFacts = (id: string): OutdoorModel => {
  const f = MODEL_FACTS[id];
  return { file: (tier) => `${BASE}${f?.tiers[tier]?.file ?? `models/${id}.glb`}`, heightM: f?.max?.[1] ?? f?.height ?? 1, parts: f?.parts ?? [] };
};
export const OUTDOOR_MODELS: Record<OutdoorModelId, OutdoorModel> = {
  'coconut-palm': { file: (tier: Tier) => `${BASE}models/coconut-palm${lowOf(tier)}.glb`, heightM: 7.65, parts: ['trunk', 'fibre', 'fronds', 'crown', 'nuts'] },
  neem: fromFacts('neem'),
  'areca-palm': fromFacts('areca-palm'),
  'royal-palm': fromFacts('royal-palm'),
};
/** a model's leafy parts: alpha-tested, double-sided, moved by the wind */
export const LEAFY_PARTS: ReadonlySet<string> = new Set(['leaves', 'fronds', 'flowers', 'crown', 'nuts', 'fibre']);

/** a photographic texture through the outdoor materials' loader; null (and a warning) when it does not arrive */
export async function photoTexture(loader: AssetLoader, path: string, srgb = true, anisotropy = 4): Promise<THREE.Texture | null> {
  if (typeof document === 'undefined') return null;
  try { return await loader.texture(path, { srgb, anisotropy }); } catch (e) { console.warn(`[walkthru] ${path} did not load: the drawn version stays`, e); return null; }
}

export interface ModelPart { name: string; geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }

const bytesCache = new Map<string, Promise<ArrayBuffer>>();
/** bytes of the outdoor models fetched this session (the payload checks read it) */
export const outdoorModelStats = { bytes: 0, files: [] as string[] };

/**
 * The parts of a model, in its own frame (origin at the foot, up +Y), each a fresh geometry and material owned by the caller (who disposes them
 * with the space). The file's bytes are cached for the session; the parsed objects are not, so a torn-down space frees its GPU memory.
 */
export async function loadOutdoorModel(id: OutdoorModelId, tier: Tier): Promise<ModelPart[] | null> {
  if (typeof document === 'undefined') return null;
  const url = LOOK_BASE + OUTDOOR_MODELS[id].file(tier);
  try {
    let p = bytesCache.get(url);
    if (!p) {
      p = fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }).then((b) => { outdoorModelStats.bytes += b.byteLength; outdoorModelStats.files.push(url); return b; });
      bytesCache.set(url, p);
      p.catch(() => bytesCache.delete(url));
    }
    const buf = await p;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.parseAsync(buf.slice(0), '');
    gltf.scene.updateMatrixWorld(true);
    const parts: ModelPart[] = [];
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // meshopt quantises positions: bake the node's matrix (which undoes it) into a float copy
      const g = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(m.geometry.attributes)) {
        const attr = a as THREE.BufferAttribute;
        const f = new Float32Array(attr.count * attr.itemSize);
        for (let i = 0; i < attr.count; i++) for (let k = 0; k < attr.itemSize; k++) f[i * attr.itemSize + k] = k === 0 ? attr.getX(i) : k === 1 ? attr.getY(i) : k === 2 ? attr.getZ(i) : attr.getW(i);
        g.setAttribute(name, new THREE.BufferAttribute(f, attr.itemSize));
      }
      const idx = m.geometry.getIndex();
      if (idx) g.setIndex(new THREE.BufferAttribute(idx.array.slice(), 1));
      g.applyMatrix4(m.matrixWorld);
      m.geometry.dispose();
      const mat = m.material as THREE.MeshStandardMaterial;
      parts.push({ name: mat.name || m.name, geometry: g, material: mat });
    });
    return parts;
  } catch (e) {
    console.warn(`[walkthru] the ${id} model did not load: the drawn plant stays`, e);
    return null;
  }
}
