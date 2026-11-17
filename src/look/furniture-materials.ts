// Owned by C11b. SPEC 16.6.5 materials for the real furniture look: wood grain, white laminate, linen, cotton, metal, granite.
// Every part gets its own MeshStandardMaterial (tints are per item, setFurnitureTint lerps `color`), but the textures are
// shared. Textures arrive after first paint (SPEC 16.3: loaded lazily) and are applied to the materials that already exist.
import * as THREE from 'three';
import type { Tier } from './types';
import { AssetLoader } from './assets';
import { REALISTIC_FURNITURE_2K } from './realistic';

export type MatKey =
  | 'walnut' | 'white' | 'dark' | 'linen' | 'cotton' | 'metal' | 'granite' | 'shutterWhite' | 'cover' | 'headboard' | 'sofa' | 'pad'
  // style generators (src/look/gen): `wood` is the oak grain tinted to any species, the rest are tinted too
  | 'wood' | 'laminate' | 'gloss' | 'paint' | 'weave' | 'quilt' | 'shag' | 'stripe' | 'brass' | 'blackMetal' | 'sheer' | 'drape' | 'lamp'
  // SPEC 16.21 (round 3): a quartz worktop and a woven rug, which only the Realistic materials layer gives a surface (Off draws them flat)
  | 'quartz' | 'rug' | 'felt';

interface Def {
  /** colour, also the flat colour on the low tier (the mean of the texture where there is one) */
  color: string;
  /** flat colour on the low tier when it should differ from `color` (a wood whose texture is the colour above it) */
  lowColor?: string;
  roughness: number;
  metalness: number;
  tex?: 'walnut_veneer' | 'rough_linen' | 'cotton_jersey' | 'oak_veneer_01' | 'curly_teddy_natural' | 'stripe' | 'grey_plaster';
  /** the texture is the colour (wood), or only detail around `color` (fabric) */
  detail?: boolean;
  /** metres one repeat of the texture covers */
  tile: number;
  /** how much of the texture's light and dark shows around the tint, 0..1 (default 1: the clamp of 0.7..1.3) */
  strength?: number;
  /** a normal map of its own (a quilt, flutes), path under public/look/ */
  nor?: string;
  norScale?: number;
  /** see-through cloth */
  opacity?: number;
  doubleSide?: boolean;
  /** glowing: full-on emissive colour (the look dims it with the time of day, SPEC 16.12) */
  emissive?: string;
}

/** Mean linear luminance of each diffuse map (scripts/derive-look-assets.ts, also in materials.ts). */
const MEAN = { walnut_veneer: 0.162, rough_linen: 0.3972, cotton_jersey: 0.4303, oak_veneer_01: 0.2342, curly_teddy_natural: 0.6786, stripe: 1, grey_plaster: 0.247 } as const;

export const DEFS: Record<MatKey, Def> = {
  // the wood grain is detail around a warm brown (the map alone renders as near-black chocolate under PBR light); low shows the flat mean
  walnut: { color: '#A87C56', lowColor: '#8A6446', roughness: 0.48, metalness: 0, tex: 'walnut_veneer', detail: true, tile: 0.8 },
  white: { color: '#F4F2EE', roughness: 0.35, metalness: 0, tile: 1 },
  shutterWhite: { color: '#F4F2EE', roughness: 0.5, metalness: 0, tile: 1 },
  dark: { color: '#2E2A27', roughness: 0.7, metalness: 0, tile: 1 },
  linen: { color: '#8E9AA6', roughness: 0.95, metalness: 0, tex: 'rough_linen', detail: true, tile: 0.5 },
  sofa: { color: '#8E9AA6', roughness: 0.95, metalness: 0, tex: 'rough_linen', detail: true, tile: 0.5 },
  headboard: { color: '#A89B8C', roughness: 0.95, metalness: 0, tex: 'rough_linen', detail: true, tile: 0.5 },
  pad: { color: '#9A8F82', roughness: 0.95, metalness: 0, tex: 'rough_linen', detail: true, tile: 0.4 },
  cover: { color: '#C9B8A3', roughness: 0.95, metalness: 0, tex: 'rough_linen', detail: true, tile: 0.5 },
  cotton: { color: '#F1EEE8', roughness: 0.9, metalness: 0, tex: 'cotton_jersey', detail: true, tile: 0.4 },
  metal: { color: '#B8B8B8', roughness: 0.35, metalness: 0.8, tile: 1 },
  granite: { color: '#1F1F21', roughness: 0.15, metalness: 0, tile: 1 },
  // ---- style generators: tints come from the finish palette (src/look/finishes.ts), the grain and weave are shared detail
  wood: { color: '#CFA06A', lowColor: '#B88C58', roughness: 0.5, metalness: 0, tex: 'oak_veneer_01', detail: true, tile: 0.8, strength: 0.6 },
  // a matt laminate: a faint wood-grain emboss (the Realistic materials layer only; Off is flat), as the fronts of a fitted wardrobe have
  laminate: { color: '#E8E4DC', roughness: 0.58, metalness: 0, tex: 'oak_veneer_01', detail: true, tile: 0.6, strength: 0.14, norScale: 0.22 },
  gloss: { color: '#F4F2EE', roughness: 0.28, metalness: 0, tile: 1 },
  paint: { color: '#E8DCC8', roughness: 0.92, metalness: 0, tile: 1 },
  weave: { color: '#8E9AA6', roughness: 0.96, metalness: 0, tex: 'rough_linen', detail: true, tile: 0.45 },
  quilt: { color: '#CDBBA3', roughness: 0.97, metalness: 0, tex: 'cotton_jersey', detail: true, tile: 0.6, nor: 'tex/gen/quilt_nor.jpg', norScale: 0.55 },
  shag: { color: '#8C8C8C', roughness: 1, metalness: 0, tex: 'curly_teddy_natural', detail: true, tile: 0.4 },
  stripe: { color: '#FFFFFF', roughness: 0.95, metalness: 0, tex: 'stripe', tile: 0.34 },
  brass: { color: '#D4AD66', roughness: 0.38, metalness: 0.35, tile: 1 },
  blackMetal: { color: '#1D1D1F', roughness: 0.42, metalness: 0.75, tile: 1 },
  sheer: { color: '#F4F1EB', roughness: 1, metalness: 0, tile: 1, opacity: 0.8, doubleSide: true },
  drape: { color: '#8A8D92', roughness: 0.97, metalness: 0, tex: 'rough_linen', detail: true, tile: 0.5, doubleSide: true },
  // a quartz worktop: near-uniform, with a fine speckle and a polished sheen
  quartz: { color: '#E9E6E0', roughness: 0.2, metalness: 0, tex: 'grey_plaster', detail: true, tile: 0.8, strength: 0.1, norScale: 0.1 },
  // a woven rug: the linen weave at a finer, deeper pile
  rug: { color: '#B3AEA6', roughness: 0.98, metalness: 0, tex: 'rough_linen', detail: true, tile: 0.22, norScale: 1.0 },
  // baize and felt (a pool table's cloth): a fine, dense nap
  felt: { color: '#1F6B46', roughness: 0.98, metalness: 0, tex: 'rough_linen', detail: true, tile: 0.09, norScale: 0.4 },
  lamp: { color: '#FFFFFF', roughness: 0.4, metalness: 0, tile: 1, emissive: '#FFE8C2' },
};

const DETAIL_VERT_PARS = '';
export function patchDetail(mat: THREE.MeshStandardMaterial, mean: number, strength = 1): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFMean = { value: mean };
    shader.uniforms.uFStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFMean;\nuniform float uFStrength;')
      .replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float fLum = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) / uFMean;
  diffuseColor.rgb *= mix( 1.0, clamp( fLum, 0.7, 1.3 ), uFStrength );
#endif`);
  };
  mat.customProgramCacheKey = () => `walkthru-furniture-detail-v2-${mean}`;
  void DETAIL_VERT_PARS;
}

export interface FurnitureKit {
  /** a fresh material of this kind for one part of one item; `tint` overrides the colour (a bedcover, a sofa) */
  material(key: MatKey, tint?: string): THREE.MeshStandardMaterial;
  /** the tile size (metres per texture repeat) the UVs of this kind must be built with */
  tile(key: MatKey): number;
  /** choose the tier; textures are fetched for medium and high, in the background */
  setTier(t: Tier, loader?: AssetLoader): Promise<void>;
  /** SPEC 16.21: a material built elsewhere (a door leaf) takes the normal map of `key` when the realistic layer is on, and loses it when it is off; it must have a normal-map UV transform of its own */
  adopt(mat: THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial, key: MatKey, normalScale?: number): void;
  /** SPEC 16.21: 'off' leaves the furniture's flat colours, '1k' the 1K maps, '2k' the 2K maps where there is one (oak veneer for timber, linen for upholstery) */
  setRealism(level: 'off' | '1k' | '2k'): Promise<void>;
  readonly tier: Tier;
  /** bytes of furniture textures fetched so far */
  readonly bytes: number;
  /** resolves when the current tier's textures are applied */
  readonly ready: Promise<void>;
  dispose(): void;
}

interface Live { /** normal strength of an adopted material, over the kind's own */ nScale?: number; key: MatKey; mat: THREE.MeshStandardMaterial; /** an adopted material (a door leaf): only the normal map is applied, the colour stays its own */ normalOnly?: boolean }

export function createFurnitureKit(): FurnitureKit {
  let tier: Tier = 'medium';
  let realism: 'off' | '1k' | '2k' = '1k';
  let loader: AssetLoader | null = null;
  let own: AssetLoader | null = null;
  const live = new Set<Live>();
  const tex = new Map<string, THREE.Texture>();
  let ready: Promise<void> = Promise.resolve();

  const get = (path: string, srgb: boolean, aniso: number): Promise<THREE.Texture> =>
    (loader ?? (own ??= new AssetLoader())).texture(path, { srgb, anisotropy: aniso }).then((t) => { tex.set(path, t); return t; });

  /** the files one kind of material wants at the current tier, under public/look/ */
  function pathsOf(d: Def): { diff?: string; nor?: string; arm?: string } {
    if (!d.tex) return d.nor ? { nor: d.nor } : {};
    const name = d.tex;
    const out: { diff?: string; nor?: string; arm?: string } = {};
    const two = realism === '2k' && REALISTIC_FURNITURE_2K.has(name);
    const own = name === 'grey_plaster'; // a set only the realistic layer has (1K at both levels: a worktop shows no more at 2K)
    out.diff = name === 'stripe' ? 'tex/gen/stripe_diff.jpg' : two ? `tex/realistic/2k/${name}/${name}_diff_2k.jpg` : own ? `tex/realistic/1k/${name}/${name}_diff_1k.jpg` : `tex/${name}/${name}_diff_1k.jpg`;
    out.nor = d.nor ?? (name === 'walnut_veneer' || name === 'stripe' ? undefined : two ? `tex/realistic/2k/${name}/${name}_nor_gl_2k.jpg` : own ? `tex/realistic/1k/${name}/${name}_nor_gl_1k.jpg` : `tex/${name}/${name}_nor_gl_1k.jpg`);
    if (tier === 'high' && (name === 'walnut_veneer' || name === 'oak_veneer_01' || name === 'curly_teddy_natural')) out.arm = `tex/${name}/${name}_arm_1k.jpg`;
    return out;
  }

  function apply(l: Live): void {
    const d = DEFS[l.key];
    const m = l.mat;
    const full = tier !== 'low' && realism !== 'off' && (d.tex || d.nor) && !m.userData.flatFinish;
    const set = (k: 'map' | 'normalMap' | 'roughnessMap', t: THREE.Texture | null): void => {
      if ((m[k] ?? null) !== t) { m[k] = t; m.needsUpdate = true; }
    };
    if (!full) { set('map', null); set('normalMap', null); set('roughnessMap', null); if (!m.userData.flatFinish) m.metalness = d.metalness * (l.key === 'metal' ? 0.4 : 1); return; }
    const want = pathsOf(d);
    if (!l.normalOnly) set('map', want.diff ? tex.get(want.diff) ?? null : null);
    set('normalMap', want.nor ? tex.get(want.nor) ?? null : null);
    if (want.nor) { const k = l.nScale ?? d.norScale ?? 0.6; m.normalScale.set(k, k); }
    set('roughnessMap', want.arm && !l.normalOnly ? tex.get(want.arm) ?? null : null);
  }

  /** fetches what these kinds need that is not here yet (the other kinds are fetched when a part first asks for one) */
  async function fetchFor(keys: Iterable<MatKey>): Promise<void> {
    if (tier === 'low' || realism === 'off') return;
    const aniso = realism === '2k' ? 16 : tier === 'high' ? 8 : 4;
    const jobs: Promise<unknown>[] = [];
    const seen = new Set<string>();
    for (const k of keys) {
      const p = pathsOf(DEFS[k]);
      const add = (path: string | undefined, srgb: boolean): void => {
        if (!path || seen.has(path) || tex.has(path)) return;
        seen.add(path);
        jobs.push(get(path, srgb, aniso));
      };
      add(p.diff, true); add(p.nor, false); add(p.arm, false);
    }
    await Promise.all(jobs);
  }

  async function load(): Promise<void> {
    if (tier === 'low' || realism === 'off') { for (const l of live) apply(l); return; }
    // the classic set first (every home), then whatever the live parts of the style generators use
    await fetchFor(new Set<MatKey>(['walnut', 'linen', 'cotton', ...[...live].map((l) => l.key)]));
    for (const l of live) apply(l);
  }

  const kit: FurnitureKit = {
    material(key, tint) {
      const d = DEFS[key];
      const mat = new THREE.MeshStandardMaterial({ color: tint ?? (tier === 'low' ? d.lowColor ?? d.color : d.color), roughness: d.roughness, metalness: d.metalness });
      if (d.opacity !== undefined) { mat.transparent = true; mat.opacity = d.opacity; mat.depthWrite = false; }
      if (d.doubleSide) mat.side = THREE.DoubleSide;
      if (d.emissive) { mat.emissive = new THREE.Color(d.emissive); mat.emissiveIntensity = 1; }
      mat.userData.baseColor = mat.color.getHex();
      mat.name = key;
      if (d.tex && d.detail) patchDetail(mat, MEAN[d.tex], d.strength ?? 1);
      const l = { key, mat };
      live.add(l);
      mat.addEventListener('dispose', () => { live.delete(l); });
      if (tier !== 'low' && realism !== 'off' && (d.tex || d.nor)) {
        apply(l);
        // a kind that was not loaded at the tier change (a style generator's) is fetched now and applied when it arrives
        void fetchFor([key]).then(() => apply(l), () => { /* the flat colour stays */ });
      }
      return mat;
    },
    tile: (key) => DEFS[key].tile,
    adopt(mat, key, normalScale) {
      const d = DEFS[key];
      const l: Live = { key, mat, normalOnly: true, nScale: normalScale };
      live.add(l);
      mat.addEventListener('dispose', () => { live.delete(l); });
      if (tier !== 'low' && realism !== 'off' && (d.tex || d.nor)) { apply(l); void fetchFor([key]).then(() => apply(l), () => { /* stays flat */ }); }
    },
    async setRealism(level) {
      if (level === realism) return;
      realism = level;
      ready = load();
      await ready;
    },
    async setTier(t, ld) {
      tier = t;
      if (ld) loader = ld;
      ready = load();
      await ready;
    },
    get tier() { return tier; },
    get bytes() { return (loader ?? own)?.bytes ?? 0; },
    get ready() { return ready; },
    dispose() { live.clear(); own?.dispose(); },
  };
  return kit;
}

/** The kit the buyer page and the editor preview share. */
export const furnitureKit: FurnitureKit = createFurnitureKit();
