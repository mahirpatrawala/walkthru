// Real 3D models inside the gym's generated pieces (SPEC 16.17.1): the hex dumbbells of a dumbbell rack and the bells of a kettlebell rack are
// downloaded models (CC BY 4.0, credited below and in public/look/gym/LICENCE.txt), cut out, re-centred and split into parts by
// tools/optimise-gym-assets.mjs. A rack is always built first with its generated weights; when the model arrives the piece is rebuilt with it
// (same box, same part names, same materials), and a failed fetch keeps the generated weights. `?models=off` keeps them too.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Tier } from '../types';
import { modelsEnabled } from '../models/library';
import { floatGeometry } from '../models/load';
import manifest from './manifest.json';
import clubManifest from '../club/manifest.json';

/** the gym's props (public/look/gym, SPEC 16.17.1) */
export type GymPropKind = 'dumbbell' | 'kettlebell' | 'chess';
/** whole pieces of the clubhouse (public/look/club, SPEC 16.17.3): a model that stands in for a generated piece, scaled into its box */
export type ClubPropKind = 'power-rack' | 'recumbent' | 'pool-table' | 'table-tennis' | 'carrom-board' | 'dartboard' | 'pendant' | 'chandelier';
export type PropKind = GymPropKind | ClubPropKind;
export const PROP_KINDS: PropKind[] = ['dumbbell', 'kettlebell', 'chess', 'power-rack', 'recumbent', 'pool-table', 'table-tennis', 'carrom-board', 'dartboard', 'pendant', 'chandelier'];

type PropTier = 'full' | 'mid' | 'low';
interface PropInfo {
  source: string | string[];
  /** keeps its own maps and materials (the chess set, the clubhouse models) */
  textured?: boolean;
  /** `mid` (the medium tier) only on the clubhouse models; the gym's have a full and a phone file */
  files: Partial<Record<PropTier, { file: string; bytes: number }>> & Record<'full' | 'low', { file: string; bytes: number }>;
  tris: Partial<Record<PropTier, number>> & Record<'full' | 'low', number>;
  parts: string[];
  dims: Record<string, number>;
  /** height of the bed or seat of a whole-piece model, measured on it */
  surfaceM?: number;
  /** the folder under /look/ the files are in */
  dir: 'gym' | 'club';
}
const INFO = {
  ...Object.fromEntries(Object.entries((manifest as unknown as { models: Record<string, Omit<PropInfo, 'dir'>> }).models).map(([k, v]) => [k, { ...v, dir: 'gym' as const }])),
  ...Object.fromEntries(Object.entries((clubManifest as unknown as { models: Record<string, Omit<PropInfo, 'dir'>> }).models).map(([k, v]) => [k, { ...v, dir: 'club' as const }])),
} as Record<PropKind, PropInfo>;
export function propInfo(kind: PropKind): PropInfo { return INFO[kind]; }
/** which file a tier loads: the phone file on low, the medium file where there is one, else the full file */
export const propFile = (t: Tier, kind?: PropKind): PropTier => (t === 'low' ? 'low' : t === 'medium' && kind && INFO[kind]?.files.mid ? 'mid' : 'full');
export const propUrl = (kind: PropKind, t: Tier): string => `/look/${INFO[kind].dir}/${INFO[kind].files[propFile(t, kind)]!.file}`;

/** the credit a CC BY 4.0 model needs, said wherever the piece that shows it is described (the item card) */
export const PROP_CREDITS: Record<PropKind, string> = {
  dumbbell: 'Dumbbells: "Weight Room Set 2" by Tytan (sketchfab.com/tylerhalterman), CC BY 4.0, adapted.',
  kettlebell: 'Kettlebells: "kettlebell" by anesbe89 (sketchfab.com/anesbe89), CC BY 4.0, adapted.',
  chess: 'Chess set: "Chess Set" by Riley Queen (polyhaven.com), CC0.',
  'power-rack': 'Rack, bar and plates: "Weight Room Set 1" and "Weight Room Set 3" by Tytan (sketchfab.com/tylerhalterman), CC BY 4.0, adapted.',
  recumbent: 'Bike: "cycle" by killer456 (sketchfab.com/killer456), CC BY 4.0, adapted.',
  'pool-table': 'Table: "Pooltable" by jdastine (sketchfab.com/jdastine), CC BY 4.0, adapted.',
  'table-tennis': 'Table: "Table Tennis Table" by Diccbudd (sketchfab.com/Diccbudd), CC BY 4.0, adapted.',
  'carrom-board': 'Board: "Karambol Carom Board" by Francesco Coldesina (sketchfab.com/topfrank2013), CC BY 4.0, adapted.',
  dartboard: 'Dartboard: "Dartboard" by Satyaki Mandal (polyhaven.com), CC0.',
  pendant: 'Pendant lights: "Modern Ceiling Lamp 01" by James Ray Cock (polyhaven.com), CC0.',
  chandelier: 'Chandeliers: "Chandelier 01" by Kirill Sannikov (polyhaven.com), CC0.',
};

/** a loaded prop: its named parts in the model's own frame (the dumbbell along x, centred; the kettlebell 1 m high, foot centre at the origin) */
export interface PropGeo { kind: PropKind; parts: Record<string, THREE.BufferGeometry>; /** a textured model's meshes as modelled, with their own materials (footprint centre at the origin, lowest point on y = 0, metres) */ meshes?: { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }[] }

const ready = new Map<string, PropGeo>();
const loading = new Map<string, Promise<PropGeo | null>>();
export const propStats = { bytes: 0, files: [] as string[], failed: [] as string[] };

type Fetcher = (url: string) => Promise<ArrayBuffer>;
let fetcher: Fetcher = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} answered HTTP ${r.status}`); return r.arrayBuffer(); };
/** tests hand in a reader of the files on disk, or null to go back to fetch */
export function setPropFetcher(f: Fetcher | null): void { fetcher = f ?? (async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} answered HTTP ${r.status}`); return r.arrayBuffer(); }); }
/** forget every loaded prop (tests) */
let generation = 0;
export function clearProps(): void { generation++; ready.clear(); loading.clear(); propStats.bytes = 0; propStats.files.length = 0; propStats.failed.length = 0; }

/** the prop if it is already here (a generator asks this while it builds), else null: the generator draws its own weight */
export function propGeo(kind: PropKind, tier: Tier): PropGeo | null {
  if (!modelsEnabled()) return null;
  return ready.get(propUrl(kind, tier)) ?? null;
}

/** loads a prop once per file; resolves null when it could not be had (the generated weights stay) */
export function loadProp(kind: PropKind, tier: Tier): Promise<PropGeo | null> {
  const url = propUrl(kind, tier);
  const have = ready.get(url);
  if (have) return Promise.resolve(have);
  let p = loading.get(url);
  if (p) return p;
  const mine = generation;
  p = (async (): Promise<PropGeo | null> => {
    try {
      const buf = await fetcher(url);
      propStats.bytes += buf.byteLength;
      propStats.files.push(url);
      const l = new GLTFLoader();
      l.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await l.parseAsync(buf, `/look/${INFO[kind].dir}/`);
      gltf.scene.updateMatrixWorld(true);
      const parts: Record<string, THREE.BufferGeometry> = {};
      const meshes: { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }[] = [];
      const textured = !!INFO[kind].textured;
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const g = floatGeometry(m.geometry);
        g.applyMatrix4(m.matrixWorld);
        if (!g.getAttribute('normal')) g.computeVertexNormals();
        if (textured) { meshes.push({ geometry: g, material: (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial }); return; }
        g.deleteAttribute('uv');
        parts[m.name || m.parent?.name || 'part'] = g;
      });
      for (const want of INFO[kind].parts) if (!parts[want]) throw new Error(`${url} has no part "${want}"`);
      if (textured && meshes.length === 0) throw new Error(`${url} has no mesh`);
      const geo: PropGeo = { kind, parts, ...(textured ? { meshes } : {}) };
      // a load started before clearProps (a test) does not fill the fresh cache
      if (mine === generation) ready.set(url, geo);
      return geo;
    } catch (err) {
      propStats.failed.push(url);
      console.warn(`[walkthru] model ${kind} not loaded, the generated piece stays:`, err instanceof Error ? err.message : err);
      return null;
    } finally {
      if (mine === generation) loading.delete(url);
    }
  })();
  loading.set(url, p);
  return p;
}

/** a prop already parsed by hand (tests: the real files decode in node too, but a test may want a tiny stand-in) */
export function primeProp(kind: PropKind, tier: Tier, geo: PropGeo): void { ready.set(propUrl(kind, tier), geo); }

/** which pieces show a model prop, for the card's credit line */
const shownBy = new Map<string, PropKind[]>();
/** the credit sentence of the props an item shows ('' for none) */
export function propNote(itemId: string): string {
  const k = shownBy.get(itemId);
  return k && k.length ? ' ' + k.map((x) => PROP_CREDITS[x]).join(' ') : '';
}

/**
 * After a generator built `group` with generated weights because the props it wanted (`kinds`) were not loaded yet: load them and, if the
 * group was not rebuilt meanwhile (`group.userData.modelToken` unchanged), rebuild it with the models and swap its meshes in place. The group,
 * its box and every number a check reads stay the item's.
 */
export function attachProps(group: THREE.Group, itemId: string, kinds: PropKind[], tier: Tier, rebuild: () => THREE.Group): Promise<boolean> {
  shownBy.delete(itemId);
  if (!modelsEnabled() || kinds.length === 0) return Promise.resolve(false);
  const token = group.userData.modelToken;
  return Promise.all(kinds.map((k) => loadProp(k, tier))).then((got) => {
    if (got.some((g) => !g) || group.userData.modelToken !== token) return false;
    const built = rebuild();
    for (const c of [...group.children]) {
      group.remove(c);
      c.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.geometry?.dispose(); for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat?.dispose(); });
    }
    for (const c of [...built.children]) group.add(c);
    shownBy.set(itemId, kinds);
    group.userData.gymProps = kinds;
    group.updateMatrixWorld(true);
    (group.userData.afterModelSwap as (() => void) | undefined)?.();
    return true;
  }, () => false);
}

/** records that a piece shows props that were already loaded when it was built (no swap needed) */
export function noteProps(itemId: string, kinds: PropKind[]): void { if (kinds.length) shownBy.set(itemId, kinds); else shownBy.delete(itemId); }

/**
 * The one call buildRealFurniture makes after a generator ran: a generator that drew weights says which props it used (`gymPropsUsed`) and which
 * it wanted but did not have yet (`gymPropsWanted`), on the group it returned.
 */
export function hookProps(group: THREE.Group, built: THREE.Object3D, itemId: string, tier: Tier, rebuild: () => THREE.Group): void {
  const used = (built.userData.gymPropsUsed as PropKind[] | undefined) ?? [];
  const wanted = (built.userData.gymPropsWanted as PropKind[] | undefined) ?? [];
  noteProps(itemId, used);
  if (wanted.length) void attachProps(group, itemId, [...new Set([...used, ...wanted])], tier, rebuild);
}

/**
 * Adds a textured model's meshes to a generator's group, scaled uniformly by `k` and moved to (x, y, z): each mesh keeps its own maps
 * (a copy of the material, so a piece can be disposed alone) and is named `name` for the bake and the colour pass.
 */
export function addTextured(group: THREE.Group, geo: PropGeo, name: string, k: number, at: [number, number, number]): void {
  for (const m of geo.meshes ?? []) {
    const g = m.geometry.clone().scale(k, k, k).translate(...at);
    const mesh = new THREE.Mesh(g, m.material.clone());
    mesh.name = name;
    mesh.userData.walkthruPart = name;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
}

/**
 * A whole piece from a model (SPEC 16.17.3): the model's meshes scaled on each axis to fill the item's box (`w` x `h` x `d`, the footprint centred
 * on the origin, the floor at y = 0, the front toward +z), each with a copy of its own material. The caller has checked the fit (never more than
 * FIT_TOL on an axis), so a piece is never visibly stretched and the box stays the item's to the millimetre.
 */
export function addWhole(group: THREE.Group, geo: PropGeo, name: string, box: { w: number; h: number; d: number }): void {
  const dims = INFO[geo.kind].dims;
  const sx = box.w / dims.w, sy = box.h / dims.h, sz = box.d / dims.d;
  for (const m of geo.meshes ?? []) {
    const g = m.geometry.clone().scale(sx, sy, sz);
    if (sx !== sy || sy !== sz) g.computeVertexNormals();
    const mat = m.material.clone();
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = name;
    mesh.userData.walkthruPart = name;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
}
