// Downloaded models inside the open-air pieces (SPEC 19.13, 22 Nov 2026): the pool lounger, the pool-side chair, the park bench, the parasol,
// the pool-side table and the deck planter are free CC-BY 4.0 / CC0 models (credited in public/look/outdoor/LICENCE.txt and in the item's card),
// cut, re-centred and given one file a tier by tools/optimise-outdoor-models.mjs. A piece is always built first by its generator (src/look/gen/
// pool.ts, garden.ts); when its model has arrived the piece is rebuilt with it, fitted to exactly the same box (16.2 rule 1: the catalogue's size
// wins, a model is stretched or squeezed by the few percent its own proportions differ), and a failed fetch keeps the generated piece.
// `?models=off` keeps the generated pieces too.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Tier } from '../types';
import { modelsEnabled } from '../models/library';
import { floatGeometry } from '../models/load';
import facts from '../../outdoor/models.json';

export type PieceModelId = 'lounger' | 'pool-chair' | 'bench' | 'parasol' | 'patio-table';
interface Facts { kind: string; height: number; parts: string[]; min: number[]; max: number[]; tiers: Record<Tier, { file: string; bytes: number; tris: number }> }
const FACTS = (facts as unknown as { models: Record<string, Facts> }).models;

/** the credit a CC-BY model needs, said in the card of the piece that shows it */
export const PIECE_CREDITS: Record<PieceModelId, string> = {
  lounger: 'Lounger: "Garden Chair" by Medhatelo (sketchfab.com/Medhatelo), CC BY 4.0, adapted.',
  'pool-chair': 'Chair: "Metallic garden table" by anDDDres (sketchfab.com/anDDDres), CC BY 4.0, adapted.',
  bench: 'Bench: "Park bench" by krolzuzannapl (sketchfab.com/krolzuzannapl), CC BY 4.0, adapted.',
  parasol: 'Parasol: "White outdoor Umbrella" by Ngo.Phuoc.Truong (sketchfab.com/Ngo.Phuoc.Truong), CC BY 4.0, adapted.',
  'patio-table': 'Table: "Metallic garden table" by anDDDres (sketchfab.com/anDDDres), CC BY 4.0, adapted.',
};

export const pieceModelIds = (): PieceModelId[] => (Object.keys(PIECE_CREDITS) as PieceModelId[]).filter((id) => !!FACTS[id]);
export const pieceUrl = (id: PieceModelId, tier: Tier): string | null => { const f = FACTS[id]?.tiers[tier]?.file; return f ? `/look/outdoor/${f}` : null; };

export interface PieceGeo { id: PieceModelId; meshes: { part: string; geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }[] }
const ready = new Map<string, PieceGeo>();
const loading = new Map<string, Promise<PieceGeo | null>>();
export const pieceStats = { bytes: 0, files: [] as string[], failed: [] as string[] };

type Fetcher = (url: string) => Promise<ArrayBuffer>;
const defaultFetcher: Fetcher = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} answered HTTP ${r.status}`); return r.arrayBuffer(); };
let fetcher: Fetcher = defaultFetcher;
/** tests hand in a reader of the files on disk, or null to go back to fetch */
export function setPieceFetcher(f: Fetcher | null): void { fetcher = f ?? defaultFetcher; }
let generation = 0;
export function clearPieces(): void { generation++; ready.clear(); loading.clear(); pieceStats.bytes = 0; pieceStats.files.length = 0; pieceStats.failed.length = 0; }

/** the model if it is already here (a generator asks while it builds), else null: the generator draws its own piece */
export function pieceGeo(id: PieceModelId, tier: Tier): PieceGeo | null {
  if (!modelsEnabled()) return null;
  const url = pieceUrl(id, tier);
  return url ? ready.get(url) ?? null : null;
}

/** a model parsed by hand (tests: Node cannot decode the WebP maps, so a test primes stand-in geometry of the measured size) */
export function primePiece(id: PieceModelId, tier: Tier, geo: PieceGeo): void { const url = pieceUrl(id, tier); if (url) ready.set(url, geo); }

export function loadPiece(id: PieceModelId, tier: Tier): Promise<PieceGeo | null> {
  const url = pieceUrl(id, tier);
  // in Node (tests, scripts) a model is loaded only through a fetcher a test handed in
  if (!url || !modelsEnabled() || (fetcher === defaultFetcher && typeof document === 'undefined')) return Promise.resolve(null);
  const have = ready.get(url);
  if (have) return Promise.resolve(have);
  let p = loading.get(url);
  if (p) return p;
  const mine = generation;
  p = (async (): Promise<PieceGeo | null> => {
    try {
      const buf = await fetcher(url);
      pieceStats.bytes += buf.byteLength; pieceStats.files.push(url);
      const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await l.parseAsync(buf, '/look/outdoor/models/');
      gltf.scene.updateMatrixWorld(true);
      const meshes: PieceGeo['meshes'] = [];
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const g = floatGeometry(m.geometry);
        g.applyMatrix4(m.matrixWorld);
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        m.geometry.dispose();
        const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
        meshes.push({ part: mat.name || m.name || 'part', geometry: g, material: mat });
      });
      if (!meshes.length) throw new Error(`${url} has no mesh`);
      const geo: PieceGeo = { id, meshes };
      if (mine === generation) ready.set(url, geo);
      return geo;
    } catch (err) {
      pieceStats.failed.push(url);
      console.warn(`[walkthru] outdoor model ${id} not loaded, the generated piece stays:`, err instanceof Error ? err.message : err);
      return null;
    } finally {
      if (mine === generation) loading.delete(url);
    }
  })();
  loading.set(url, p);
  return p;
}

/**
 * Adds a model's meshes to `group`, stretched to fill exactly w x h x d (footprint centred on the origin, floor at y = 0), each with its own copy
 * of its material (so a piece can be disposed alone). `name(part)` names each mesh (a parasol's canopy is named so it is not counted in its box).
 * `fit` decides which parts the box is measured on (all, by default); the others follow the same scale.
 */
export function addPiece(group: THREE.Group, geo: PieceGeo, w: number, h: number, d: number, name: (part: string) => string, fit: (part: string) => boolean = () => true): void {
  const bb = new THREE.Box3();
  for (const m of geo.meshes) if (fit(m.part)) { m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox!); }
  const sx = w / Math.max(1e-6, bb.max.x - bb.min.x), sy = h / Math.max(1e-6, bb.max.y - bb.min.y), sz = d / Math.max(1e-6, bb.max.z - bb.min.z);
  const cx = (bb.max.x + bb.min.x) / 2, cz = (bb.max.z + bb.min.z) / 2;
  for (const m of geo.meshes) {
    const g = m.geometry.clone().translate(-cx, -bb.min.y, -cz).scale(sx, sy, sz);
    // a stretched model's stored tangents no longer match its normals (a degenerate frame lit one bench white): the shader derives its own
    g.deleteAttribute('tangent');
    const mat = m.material.clone();
    if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name(m.part);
    mesh.userData.walkthruPart = mesh.name;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
}

/** which pieces show a model, for the card's credit line */
const shownBy = new Map<string, PieceModelId>();
export function pieceNote(itemId: string): string { const k = shownBy.get(itemId); return k ? ' ' + PIECE_CREDITS[k] : ''; }

/**
 * The one call buildRealFurniture makes after a generator ran: a generator that drew a model says so (`outdoorModelUsed`), one that wanted a model
 * not loaded yet says which (`outdoorModelWanted`). The model is loaded and, if the piece was not rebuilt meanwhile, the piece is rebuilt with it
 * and its meshes swapped in place: the group, its box and every number a check reads stay the item's.
 */
export function hookPieceModels(group: THREE.Group, built: THREE.Object3D, itemId: string, tier: Tier, rebuild: () => THREE.Group): void {
  const used = built.userData.outdoorModelUsed as PieceModelId | undefined;
  const wanted = built.userData.outdoorModelWanted as PieceModelId | undefined;
  if (used) shownBy.set(itemId, used); else shownBy.delete(itemId);
  if (!wanted || !modelsEnabled()) return;
  const token = group.userData.modelToken;
  void loadPiece(wanted, tier).then((got) => {
    if (!got || group.userData.modelToken !== token) return;
    const fresh = rebuild();
    for (const c of [...group.children]) {
      group.remove(c);
      c.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.geometry?.dispose(); for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat?.dispose(); });
    }
    for (const c of [...fresh.children]) group.add(c);
    shownBy.set(itemId, wanted);
    group.updateMatrixWorld(true);
    (group.userData.afterModelSwap as (() => void) | undefined)?.();
  });
}
