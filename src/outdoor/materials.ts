// Materials of the outdoor spaces (SPEC 19.1). Ground finishes are the CC0 Poly Haven textures of public/look/tex/outdoor used as detail
// around a tint (the same idea as the furniture's: the texture's light and dark around its own mean, so a lawn is the green we pick and
// not whatever the photograph happened to be), with a world-space noise on top so no patch repeats in a way you can see. Textures arrive
// after the first paint: until then a material is its flat tint.
import * as THREE from 'three';
import type { Tier } from '../look/types';
import { AssetLoader } from '../look/assets';
import type { GroundFinish } from './types';
import { PREMIUM_GROUND, meanLuminance, premiumPaths } from '../look/premium/texture';

export type GroundKind = GroundFinish | 'soil-kerb';
interface GroundSpec {
  /** folder and file stem under tex/outdoor/, or null for a flat tint */
  tex: string | null;
  /** mean linear luminance of the diffuse map (scripts/fetch-outdoor-assets.ts prints it) */
  mean: number;
  /** metres one repeat covers */
  tile: number;
  tint: string;
  roughness: number;
  normalScale: number;
  /** how much of the texture's light and dark shows (0..1.4) */
  strength: number;
  /** large-scale variation of tone, 0..0.3 */
  noise: number;
  /** a warm shift towards dry grass in the noise's bright patches, 0..0.6 (lawn) */
  dry: number;
}

export const GROUND: Record<GroundKind, GroundSpec> = {
  lawn: { tex: 'leafy_grass', mean: 0.2389, tile: 1.6, tint: '#588C3A', roughness: 0.95, normalScale: 0.9, strength: 0.85, noise: 0.27, dry: 0.42 },
  deck: { tex: 'wood_floor_deck', mean: 0.06, tile: 2.0, tint: '#9C7857', roughness: 0.62, normalScale: 0.8, strength: 1.0, noise: 0.1, dry: 0 },
  paving: { tex: 'red_sandstone_pavement', mean: 0.1068, tile: 1.8, tint: '#C9B49A', roughness: 0.88, normalScale: 0.9, strength: 0.9, noise: 0.1, dry: 0 },
  path: { tex: 'interlocking_concrete_pavers', mean: 0.0912, tile: 1.2, tint: '#B6AFA6', roughness: 0.9, normalScale: 0.9, strength: 0.9, noise: 0.08, dry: 0 },
  gravel: { tex: 'gravel_floor_02', mean: 0.3875, tile: 1.1, tint: '#D4CAB6', roughness: 0.97, normalScale: 1.0, strength: 0.9, noise: 0.1, dry: 0 },
  bed: { tex: 'farm_soil', mean: 0.0588, tile: 0.9, tint: '#6A4A33', roughness: 1, normalScale: 1, strength: 0.9, noise: 0.14, dry: 0 },
  'soil-kerb': { tex: null, mean: 1, tile: 1, tint: '#C9C2B5', roughness: 0.92, normalScale: 0, strength: 0, noise: 0.08, dry: 0 },
  rubber: { tex: 'rubber_tiles', mean: 0.0158, tile: 1.0, tint: '#A8483B', roughness: 0.95, normalScale: 0, strength: 0.45, noise: 0.05, dry: 0 },
  track: { tex: 'rubber_tiles', mean: 0.0158, tile: 1.0, tint: '#8F4338', roughness: 0.92, normalScale: 0, strength: 0.25, noise: 0.04, dry: 0 },
};

export interface GroundTweaks { colour?: string; stripes?: boolean }
interface Patched { mat: THREE.MeshStandardMaterial; uniforms: { uMean: { value: number }; uStrength: { value: number }; uNoise: { value: number }; uDry: { value: number }; uStripe: { value: number } } }

const NOISE_GLSL = `
float owHash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float owNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(owHash(i), owHash(i+vec2(1.,0.)), f.x), mix(owHash(i+vec2(0.,1.)), owHash(i+vec2(1.,1.)), f.x), f.y); }
`;

/** Gives a standard material the tint-and-detail treatment: the map is detail around the tint, world noise varies the tone, stripes mow the lawn, a noise normal lumps it. */
export function patchGround(mat: THREE.MeshStandardMaterial, spec: { mean: number; strength: number; noise: number; dry: number; stripes: boolean; lumps: boolean }): Patched {
  const uniforms = { uMean: { value: spec.mean }, uStrength: { value: spec.strength }, uNoise: { value: spec.noise }, uDry: { value: spec.dry }, uStripe: { value: spec.stripes ? 1 : 0 } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vOW;\nuniform float uMean; uniform float uStrength; uniform float uNoise; uniform float uDry; uniform float uStripe;\n${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec4 owS = texture2D( map, vMapUv );
  float owL = dot(owS.rgb, vec3(0.2126, 0.7152, 0.0722)) / uMean;
  diffuseColor.rgb *= mix(1.0, clamp(owL, 0.45, 1.7), uStrength);
#endif
  float owN1 = owNoise(vOW.xz * 0.33); float owN2 = owNoise(vOW.xz * 1.7 + 7.0); float owN3 = owNoise(vOW.xz * 7.0);
  float owN = owN1 * 0.55 + owN2 * 0.3 + owN3 * 0.15;
  diffuseColor.rgb *= 1.0 + (owN - 0.5) * 2.0 * uNoise;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.18, 1.02, 0.62), smoothstep(0.52, 0.85, owN1) * uDry);
  if (uStripe > 0.5) { float st = smoothstep(0.44, 0.56, abs(fract(vOW.x / 3.4) - 0.5) * 2.0); diffuseColor.rgb *= mix(0.84, 1.13, st); }
`);
    if (spec.lumps) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  { vec2 q = vOW.xz; float e = 0.12;
    float h0 = owNoise(q * 1.1) * 0.7 + owNoise(q * 4.3) * 0.3;
    float hx = owNoise((q + vec2(e, 0.)) * 1.1) * 0.7 + owNoise((q + vec2(e, 0.)) * 4.3) * 0.3;
    float hz = owNoise((q + vec2(0., e)) * 1.1) * 0.7 + owNoise((q + vec2(0., e)) * 4.3) * 0.3;
    vec3 g = (viewMatrix * vec4(-(hx - h0) / e, 0.0, -(hz - h0) / e, 0.0)).xyz;
    normal = normalize(normal + g * 0.16); }
`);
    }
  };
  mat.customProgramCacheKey = () => `ow-ground-${spec.stripes ? 's' : 'n'}${spec.lumps ? 'l' : 'f'}`;
  return { mat, uniforms };
}

export class OutdoorMaterials {
  readonly loader: AssetLoader;
  private readonly made = new Set<THREE.Material>();
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();
  /** the ground materials by finish, with what the 2K level replaced on them (SPEC 16.24), to put back */
  private readonly grounds: { kind: GroundKind; mat: THREE.MeshStandardMaterial; uniforms: Patched['uniforms']; saved: { map: THREE.Texture | null; normalMap: THREE.Texture | null; roughness: number; mean: number; strength: number } | null }[] = [];
  private premium: THREE.Texture[] = [];
  private ultra = false;
  private disposed = false;
  constructor(private tier: Tier, loader?: AssetLoader) { this.loader = loader ?? new AssetLoader(); }

  /** the ground material of a finish (one shared by all areas of the same finish, colour and stripes) */
  ground(kind: GroundKind, tweaks: GroundTweaks = {}): THREE.MeshStandardMaterial {
    const spec = GROUND[kind];
    const key = `${kind}|${tweaks.colour ?? ''}|${tweaks.stripes ? 's' : ''}`;
    let m = this.cache.get(key);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({ color: tweaks.colour ?? spec.tint, roughness: spec.roughness, metalness: 0 });
    m.userData.shared = false;
    const patched = patchGround(m, { mean: spec.mean, strength: spec.strength, noise: spec.noise, dry: spec.dry, stripes: !!tweaks.stripes, lumps: kind === 'lawn' });
    this.grounds.push({ kind, mat: m, uniforms: patched.uniforms, saved: null });
    if (this.ultra && PREMIUM_GROUND[kind]) void this.premiumFor(this.grounds[this.grounds.length - 1]);
    this.cache.set(key, m);
    this.made.add(m);
    if (spec.tex) void this.attachTextures(m, spec);
    return m;
  }

  private async attachTextures(m: THREE.MeshStandardMaterial, spec: GroundSpec): Promise<void> {
    try {
      const base = `tex/outdoor/${spec.tex}/${spec.tex}`;
      const diff = await this.loader.texture(`${base}_diff.jpg`, { srgb: true, anisotropy: this.tier === 'low' ? 2 : 8 });
      if (this.disposed) return;
      m.map = diff;
      if (this.tier !== 'low' && spec.normalScale > 0) {
        const nor = await this.loader.texture(`${base}_nor_gl.jpg`, { srgb: false, anisotropy: 4 });
        if (this.disposed) return;
        m.normalMap = nor;
        m.normalScale.set(spec.normalScale, spec.normalScale);
      }
      m.needsUpdate = true;
    } catch (e) {
      console.warn('[walkthru] an outdoor texture did not load, the finish stays a flat tint', e);
    }
  }

  /** a plain standard material (paint, metal, glass, wood) the outdoor builder owns */
  plain(key: string, make: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    let m = this.cache.get(`plain:${key}`);
    if (!m) { m = make(); this.cache.set(`plain:${key}`, m); this.made.add(m); }
    return m;
  }

  setTier(t: Tier): void { this.tier = t; }

  /** SPEC 16.24: at 2K the deck and the paving (and the coping, which is paving) take 2K photographed sets with a roughness map; off, they go back to the 512 px ones */
  setUltra(on: boolean): void {
    if (on === this.ultra) return;
    this.ultra = on;
    for (const g of this.grounds) {
      if (!PREMIUM_GROUND[g.kind]) continue;
      if (on) void this.premiumFor(g);
      else if (g.saved) {
        const s = g.saved;
        g.mat.map = s.map; g.mat.normalMap = s.normalMap; g.mat.roughnessMap = null; g.mat.roughness = s.roughness; g.uniforms.uMean.value = s.mean; g.uniforms.uStrength.value = s.strength; g.mat.normalScale.divideScalar(0.7);
        g.mat.needsUpdate = true;
        g.saved = null;
      }
    }
    if (!on) { for (const t of this.premium) t.dispose(); this.premium = []; }
  }

  private async premiumFor(g: { kind: GroundKind; mat: THREE.MeshStandardMaterial; uniforms: Patched['uniforms']; saved: { map: THREE.Texture | null; normalMap: THREE.Texture | null; roughness: number; mean: number; strength: number } | null }): Promise<void> {
    const set = PREMIUM_GROUND[g.kind];
    if (!set || g.saved) return;
    const p = premiumPaths(set);
    try {
      const [diff, nor, rough] = await Promise.all([
        this.loader.texture(p.diff, { srgb: true, anisotropy: 16 }),
        this.loader.texture(p.nor, { srgb: false, anisotropy: 16 }),
        this.loader.texture(p.rough, { srgb: false, anisotropy: 8 }),
      ]);
      if (this.disposed || !this.ultra || g.saved) return;
      g.saved = { map: g.mat.map, normalMap: g.mat.normalMap, roughness: g.mat.roughness, mean: g.uniforms.uMean.value, strength: g.uniforms.uStrength.value };
      g.mat.map = diff; g.mat.normalMap = nor; g.mat.roughnessMap = rough; g.mat.roughness = 1;
      g.uniforms.uMean.value = meanLuminance(diff);
      g.uniforms.uStrength.value = Math.min(g.uniforms.uStrength.value, 0.5); g.mat.normalScale.multiplyScalar(0.7); // a 2K photograph has more contrast than the 512 px one it replaces: the finish keeps its own mean colour
      this.premium.push(diff, nor, rough);
      g.mat.needsUpdate = true;
    } catch (e) {
      console.warn('[walkthru] a 2K outdoor texture did not load, the finish keeps its 512 px set', e);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const m of this.made) {
      // the textures of a finish go with it, whether or not its mesh is still in the scene
      const std = m as THREE.MeshStandardMaterial;
      std.map?.dispose(); std.normalMap?.dispose();
      m.dispose();
    }
    this.made.clear();
    this.cache.clear();
    this.grounds.length = 0;
    for (const t of this.premium) t.dispose();
    this.premium = [];
    this.loader.dispose();
  }
}
