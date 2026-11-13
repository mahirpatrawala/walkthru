// Owned by C11b. SPEC 16.6.5 materials for the real furniture look: wood grain, white laminate, linen, cotton, metal, granite.
// Every part gets its own MeshStandardMaterial (tints are per item, setFurnitureTint lerps `color`), but the textures are
// shared. Textures arrive after first paint (SPEC 16.3: loaded lazily) and are applied to the materials that already exist.
import * as THREE from 'three';
import type { Tier } from './types';
import { AssetLoader } from './assets';

export type MatKey =
  | 'walnut' | 'white' | 'dark' | 'linen' | 'cotton' | 'metal' | 'granite' | 'shutterWhite' | 'cover' | 'headboard' | 'sofa' | 'pad';

interface Def {
  /** colour, also the flat colour on the low tier (the mean of the texture where there is one) */
  color: string;
  /** flat colour on the low tier when it should differ from `color` (a wood whose texture is the colour above it) */
  lowColor?: string;
  roughness: number;
  metalness: number;
  tex?: 'walnut_veneer' | 'rough_linen' | 'cotton_jersey';
  /** the texture is the colour (wood), or only detail around `color` (fabric) */
  detail?: boolean;
  /** metres one repeat of the texture covers */
  tile: number;
}

/** Mean linear luminance of each diffuse map (scripts/derive-look-assets.ts, also in materials.ts). */
const MEAN = { walnut_veneer: 0.162, rough_linen: 0.3972, cotton_jersey: 0.4303 } as const;

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
};

const DETAIL_VERT_PARS = '';
function patchDetail(mat: THREE.MeshStandardMaterial, mean: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFMean = { value: mean };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFMean;')
      .replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float fLum = dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) / uFMean;
  diffuseColor.rgb *= clamp( fLum, 0.7, 1.3 );
#endif`);
  };
  mat.customProgramCacheKey = () => `walkthru-furniture-detail-${mean}`;
  void DETAIL_VERT_PARS;
}

export interface FurnitureKit {
  /** a fresh material of this kind for one part of one item; `tint` overrides the colour (a bedcover, a sofa) */
  material(key: MatKey, tint?: string): THREE.MeshStandardMaterial;
  /** the tile size (metres per texture repeat) the UVs of this kind must be built with */
  tile(key: MatKey): number;
  /** choose the tier; textures are fetched for medium and high, in the background */
  setTier(t: Tier, loader?: AssetLoader): Promise<void>;
  readonly tier: Tier;
  /** bytes of furniture textures fetched so far */
  readonly bytes: number;
  /** resolves when the current tier's textures are applied */
  readonly ready: Promise<void>;
  dispose(): void;
}

interface Live { key: MatKey; mat: THREE.MeshStandardMaterial }

export function createFurnitureKit(): FurnitureKit {
  let tier: Tier = 'medium';
  let loader: AssetLoader | null = null;
  let own: AssetLoader | null = null;
  const live = new Set<Live>();
  const tex = new Map<string, THREE.Texture>();
  let ready: Promise<void> = Promise.resolve();

  const get = (path: string, srgb: boolean, aniso: number): Promise<THREE.Texture> =>
    (loader ?? (own ??= new AssetLoader())).texture(path, { srgb, anisotropy: aniso }).then((t) => { tex.set(path, t); return t; });

  function apply(l: Live): void {
    const d = DEFS[l.key];
    const m = l.mat;
    const full = tier !== 'low' && d.tex;
    const set = (k: 'map' | 'normalMap' | 'roughnessMap', t: THREE.Texture | null): void => {
      if ((m[k] ?? null) !== t) { m[k] = t; m.needsUpdate = true; }
    };
    if (!full) { set('map', null); set('normalMap', null); set('roughnessMap', null); m.metalness = d.metalness * (l.key === 'metal' ? 0.4 : 1); return; }
    const name = d.tex!;
    set('map', tex.get(`tex/${name}/${name}_diff_1k.jpg`) ?? null);
    if (name !== 'walnut_veneer') { set('normalMap', tex.get(`tex/${name}/${name}_nor_gl_1k.jpg`) ?? null); m.normalScale.set(0.6, 0.6); }
    if (name === 'walnut_veneer' && tier === 'high') set('roughnessMap', tex.get('tex/walnut_veneer/walnut_veneer_arm_1k.jpg') ?? null);
    else if (name === 'walnut_veneer') set('roughnessMap', null);
  }

  async function load(): Promise<void> {
    if (tier === 'low') { for (const l of live) apply(l); return; }
    const aniso = tier === 'high' ? 8 : 4;
    const jobs: Promise<unknown>[] = [
      get('tex/walnut_veneer/walnut_veneer_diff_1k.jpg', true, aniso),
      get('tex/rough_linen/rough_linen_diff_1k.jpg', true, aniso),
      get('tex/rough_linen/rough_linen_nor_gl_1k.jpg', false, aniso),
      get('tex/cotton_jersey/cotton_jersey_diff_1k.jpg', true, aniso),
      get('tex/cotton_jersey/cotton_jersey_nor_gl_1k.jpg', false, aniso),
    ];
    if (tier === 'high') jobs.push(get('tex/walnut_veneer/walnut_veneer_arm_1k.jpg', false, aniso));
    await Promise.all(jobs);
    for (const l of live) apply(l);
  }

  const kit: FurnitureKit = {
    material(key, tint) {
      const d = DEFS[key];
      const mat = new THREE.MeshStandardMaterial({ color: tint ?? (tier === 'low' ? d.lowColor ?? d.color : d.color), roughness: d.roughness, metalness: d.metalness });
      mat.userData.baseColor = mat.color.getHex();
      mat.name = key;
      if (d.tex && d.detail) patchDetail(mat, MEAN[d.tex]);
      const l = { key, mat };
      live.add(l);
      mat.addEventListener('dispose', () => { live.delete(l); });
      if (tier !== 'low' && d.tex) apply(l);
      return mat;
    },
    tile: (key) => DEFS[key].tile,
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
