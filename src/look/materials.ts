// Owned by C11a. SPEC 16.5 "Materials": one cache of lit materials for the shell. The surface keeps its sampled mean colour:
// an albedo texture is never the colour, it only multiplies it by (texel / mean texel), clamped (rule 2 of 16.2).
import * as THREE from 'three';
import { makeTileTexture } from '../engine/shell';
import type { ShellMaterialSet } from '../engine/shell';
import type { AssetLoader } from './assets';
import type { AoField } from './floor-ao';
import type { TierConfig } from './quality';

/** Mean linear luminance of each diffuse texture, measured once with scripts/derive-look-assets.ts. */
export const TEXTURE_MEAN = {
  marble_01_diff: 0.3499,
  plastered_wall_04_diff: 0.2561,
  dark_wood_diff: 0.0431,
  walnut_veneer_diff: 0.162,
  rough_linen_diff: 0.3972,
  cotton_jersey_diff: 0.4303,
} as const;

export const DETAIL_CLAMP_FLOOR: [number, number] = [0.85, 1.15];
export const DETAIL_CLAMP_WALL: [number, number] = [0.95, 1.05];
export const FLOOR_ROUGHNESS_RANGE: [number, number] = [0.08, 0.22];
/** floor roughness when there is no roughness map (low tier) */
export const FLOOR_ROUGHNESS_FLAT = 0.2;
const BALCONY_ROUGHNESS = 0.6;

export type SurfaceKind = 'floor' | 'wall' | 'ceiling' | 'frame' | 'railing';
export type ReflectionMode = 'none' | 'cube' | 'planar';

type Uniform<T> = { value: T };

/** Uniforms shared by every look material, so one assignment updates all of them. */
export interface SharedUniforms {
  plain: Uniform<number>;
  floorAO: Uniform<THREE.Texture | null>; floorAORect: Uniform<THREE.Vector4>;
  ceilAO: Uniform<THREE.Texture | null>; ceilAORect: Uniform<THREE.Vector4>;
  wallH: Uniform<number>;
  reflMode: Uniform<number>; cube: Uniform<THREE.Texture | null>; planar: Uniform<THREE.Texture | null>;
  reflVP: Uniform<THREE.Matrix4>; reflSize: Uniform<THREE.Vector2>; reflStrength: Uniform<number>;
}

interface Rec {
  kind: SurfaceKind;
  balcony: boolean;
  mat: THREE.MeshStandardMaterial;
  u: { [k: string]: Uniform<unknown> };
  /** today's roughness and metalness (SPEC 5), restored in plain mode */
  plain: { roughness: number; metalness: number };
  look: { roughness: number; metalness: number };
  map: THREE.Texture | null;
}

const FLAT_WHITE = (): THREE.DataTexture => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
};
const FLAT_NORMAL = (): THREE.DataTexture => {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
};

// ---------------------------------------------------------------- the shader patch

const VERT_PARS = /* glsl */ `
varying vec3 vLkPos;
varying vec3 vLkN;
`;
const VERT_BODY = /* glsl */ `
vLkPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vLkN = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vLkPos;
varying vec3 vLkN;
uniform float uLkMode;        // 0 floor (tile grid), 1 box-mapped (walls, ceilings, frames)
uniform vec2 uLkTile;
uniform float uLkRepeat;      // metres per texture repeat for mode 1
uniform float uLkPlain;
uniform sampler2D uLkDetail; uniform float uLkDetailMean; uniform vec2 uLkDetailClamp; uniform float uLkDetailOn;
uniform sampler2D uLkNorm; uniform float uLkNormScale; uniform float uLkNormOn;
uniform sampler2D uLkRough; uniform vec2 uLkRoughRange; uniform float uLkRoughOn;
uniform sampler2D uLkAO; uniform vec4 uLkAORect; uniform float uLkAOOn;
uniform float uLkWallAOOn; uniform float uLkWallH;
uniform float uLkReflMode; uniform samplerCube uLkCube; uniform sampler2D uLkPlanar;
uniform mat4 uLkReflVP; uniform vec2 uLkReflSize; uniform float uLkReflStrength; uniform float uLkReflOn;
vec2 lkUV; vec2 lkUVc; vec2 lkDx; vec2 lkDy;
float lkHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void lkSetup() {
  vec3 n = normalize(vLkN);
  vec3 an = abs(n);
  if (uLkMode < 0.5) {
    // floor: one tile of the grid is one print of the texture, a random quarter of it per tile
    lkUVc = vec2(vLkPos.x, -vLkPos.z) / uLkTile;
    vec2 id = floor(lkUVc);
    vec2 q = step(0.5, vec2(lkHash(id), lkHash(id + 7.3)));
    lkUV = fract(lkUVc) * 0.5 + 0.5 * q;
    lkDx = dFdx(lkUVc) * 0.5; lkDy = dFdy(lkUVc) * 0.5;
  } else {
    vec2 c;
    if (an.y >= an.x && an.y >= an.z) c = vec2(vLkPos.x, -vLkPos.z * sign(n.y));
    else if (an.x >= an.z) c = vec2(-vLkPos.z * sign(n.x), vLkPos.y);
    else c = vec2(vLkPos.x * sign(n.z), vLkPos.y);
    lkUVc = c / uLkRepeat;
    lkUV = lkUVc;
    lkDx = dFdx(lkUVc); lkDy = dFdy(lkUVc);
  }
}
mat3 lkTBN(vec3 eye, vec3 N, vec2 uv) {
  vec3 q0 = dFdx(eye); vec3 q1 = dFdy(eye);
  vec2 st0 = dFdx(uv); vec2 st1 = dFdy(uv);
  vec3 q1perp = cross(q1, N); vec3 q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float s = (det == 0.0) ? 0.0 : inversesqrt(det);
  return mat3(T * s, B * s, N);
}
`;

const FRAG_MAP = /* glsl */ `
lkSetup();
float lkDet = 1.0;
if (uLkDetailOn > 0.5 && uLkPlain < 0.5) {
  vec3 lkT = textureGrad(uLkDetail, lkUV, lkDx, lkDy).rgb;
  lkDet = clamp(dot(lkT, vec3(0.2126, 0.7152, 0.0722)) / uLkDetailMean, uLkDetailClamp.x, uLkDetailClamp.y);
}
diffuseColor.rgb *= lkDet;
`;
const FRAG_ROUGH = /* glsl */ `
if (uLkRoughOn > 0.5 && uLkPlain < 0.5) {
  roughnessFactor = mix(uLkRoughRange.x, uLkRoughRange.y, textureGrad(uLkRough, lkUV, lkDx, lkDy).g);
}
`;
const FRAG_NORMAL = /* glsl */ `
if (uLkNormOn > 0.5 && uLkPlain < 0.5) {
  vec3 lkN = textureGrad(uLkNorm, lkUV, lkDx, lkDy).xyz * 2.0 - 1.0;
  lkN.xy *= uLkNormScale;
  normal = normalize(lkTBN(-vViewPosition, normal, lkUVc) * lkN);
}
`;
const FRAG_AO = /* glsl */ `
{
  float lkAO = 1.0;
  if (uLkAOOn > 0.5 && uLkPlain < 0.5) lkAO *= texture(uLkAO, (vLkPos.xz - uLkAORect.xy) / uLkAORect.zw).r;
  if (uLkWallAOOn > 0.5 && uLkPlain < 0.5) lkAO *= mix(0.78, 1.0, smoothstep(0.0, 0.35, min(vLkPos.y, uLkWallH - vLkPos.y)));
  reflectedLight.indirectDiffuse *= lkAO;
  reflectedLight.indirectSpecular *= lkAO;
  if (uLkReflOn > 0.5 && uLkPlain < 0.5 && uLkReflMode > 0.5) {
    vec3 lkV = normalize(vViewPosition);
    float lkCos = clamp(dot(normal, lkV), 0.0, 1.0);
    float lkF = 0.04 + (0.55 - 0.04) * pow(1.0 - lkCos, 5.0);
    vec3 lkRefl = vec3(0.0);
    if (uLkReflMode < 1.5) {
      vec3 rv = inverseTransformDirection(reflect(-lkV, normal), viewMatrix);
      lkRefl = textureLod(uLkCube, rv, roughnessFactor * 6.0).rgb * uLkReflStrength;
    } else {
      vec4 rc = uLkReflVP * vec4(vLkPos, 1.0);
      vec2 ruv = rc.xy / rc.w * 0.5 + 0.5;
      vec3 wn = inverseTransformDirection(normal, viewMatrix);
      ruv += wn.xz * 0.04;
      vec2 px = (1.0 + 24.0 * roughnessFactor) / uLkReflSize;
      lkRefl = (texture(uLkPlanar, ruv).rgb * 2.0 + texture(uLkPlanar, ruv + vec2(px.x, 0.0)).rgb + texture(uLkPlanar, ruv - vec2(px.x, 0.0)).rgb
        + texture(uLkPlanar, ruv + vec2(0.0, px.y)).rgb + texture(uLkPlanar, ruv - vec2(0.0, px.y)).rgb) / 6.0 * uLkReflStrength;
    }
    reflectedLight.indirectSpecular += lkRefl * lkF;
  }
}
`;

// ---------------------------------------------------------------- the cache

export interface LookMaterials extends ShellMaterialSet {
  readonly shared: SharedUniforms;
  /** plain = the SPEC 5 look (no detail, AO, gloss, reflections, glass): used while a scan is shown (rule 5) */
  setPlain(on: boolean): void;
  setFloorAO(f: AoField | null): void;
  setCeilingAO(f: AoField | null): void;
  setWallHeight(h: number): void;
  /** applies the tier's material settings; call after the tier or assets change */
  configure(cfg: TierConfig, opts: { trueColours: boolean }): void;
  /** loads the maps the tier needs. Resolves when they are applied. */
  loadTextures(loader: AssetLoader, cfg: TierConfig): Promise<void>;
  setReflection(mode: ReflectionMode, tex: { cube?: THREE.Texture | null; planar?: THREE.Texture | null }): void;
  /** number of GPU textures this cache holds (stats) */
  textureCount(): number;
  dispose(): void;
}

function aoTexture(f: AoField): THREE.DataTexture {
  const t = new THREE.DataTexture(f.data as Uint8Array<ArrayBuffer>, f.nx, f.nz, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export function createLookMaterials(opts: { wallHeightM: number }): LookMaterials {
  const white = FLAT_WHITE();
  const flatNormal = FLAT_NORMAL();
  const shared: SharedUniforms = {
    plain: { value: 0 },
    floorAO: { value: white }, floorAORect: { value: new THREE.Vector4(0, 0, 1, 1) },
    ceilAO: { value: white }, ceilAORect: { value: new THREE.Vector4(0, 0, 1, 1) },
    wallH: { value: opts.wallHeightM },
    reflMode: { value: 0 }, cube: { value: null }, planar: { value: null },
    reflVP: { value: new THREE.Matrix4() }, reflSize: { value: new THREE.Vector2(1, 1) }, reflStrength: { value: 0.5 },
  };
  const records: Rec[] = [];
  const byKey = new Map<string, Rec>();
  const tileTextures: THREE.Texture[] = [];
  const loaded = new Set<THREE.Texture>();
  let floorAoTex: THREE.DataTexture | null = null;
  let ceilAoTex: THREE.DataTexture | null = null;
  let paneMat: THREE.MeshBasicMaterial | null = null;
  let trueColours = false;
  let cfg: TierConfig | null = null;

  function make(kind: SurfaceKind, key: string, params: THREE.MeshStandardMaterialParameters, plain: { roughness: number; metalness: number }, balcony = false): Rec {
    const hit = byKey.get(key);
    if (hit) return hit;
    const mat = new THREE.MeshStandardMaterial(params);
    mat.userData.shared = true;
    const u: Rec['u'] = {
      uLkMode: { value: kind === 'floor' ? 0 : 1 },
      uLkTile: { value: new THREE.Vector2(0.6, 0.6) },
      uLkRepeat: { value: kind === 'frame' ? 0.6 : 3.2 },
      uLkPlain: shared.plain,
      uLkDetail: { value: white }, uLkDetailMean: { value: 1 }, uLkDetailClamp: { value: new THREE.Vector2(1, 1) }, uLkDetailOn: { value: 0 },
      uLkNorm: { value: flatNormal }, uLkNormScale: { value: 0.3 }, uLkNormOn: { value: 0 },
      uLkRough: { value: white }, uLkRoughRange: { value: new THREE.Vector2(0.1, 0.2) }, uLkRoughOn: { value: 0 },
      uLkAO: kind === 'ceiling' ? shared.ceilAO : shared.floorAO, uLkAORect: kind === 'ceiling' ? shared.ceilAORect : shared.floorAORect,
      uLkAOOn: { value: kind === 'floor' || kind === 'ceiling' ? 1 : 0 },
      uLkWallAOOn: { value: kind === 'wall' ? 1 : 0 }, uLkWallH: shared.wallH,
      uLkReflMode: shared.reflMode, uLkCube: shared.cube, uLkPlanar: shared.planar,
      uLkReflVP: shared.reflVP, uLkReflSize: shared.reflSize, uLkReflStrength: shared.reflStrength,
      uLkReflOn: { value: kind === 'floor' && !balcony ? 1 : 0 },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG_MAP}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${FRAG_AO}`);
    };
    mat.customProgramCacheKey = () => 'walkthru-look-v1';
    const rec: Rec = { kind, balcony, mat, u, plain, look: { roughness: mat.roughness, metalness: mat.metalness }, map: null };
    records.push(rec);
    byKey.set(key, rec);
    return rec;
  }

  const set = <T,>(r: Rec, k: string, v: T): void => { (r.u[k] as Uniform<T>).value = v; };

  const api: LookMaterials = {
    shared,
    floor({ color, tile, groutColor, balcony }) {
      const key = `floor|${color}|${tile ? `${tile.wM}x${tile.lM}` : 'none'}|${groutColor}|${balcony}`;
      const had = byKey.has(key);
      const r = make('floor', key, { color, roughness: balcony ? BALCONY_ROUGHNESS : FLOOR_ROUGHNESS_FLAT, metalness: 0 }, { roughness: 0.35, metalness: 0 }, balcony);
      if (!had && tile) {
        const tex = makeTileTexture(color, groutColor); // the grout layer, with the sampled colour baked in
        if (tex) { r.mat.map = tex; r.mat.color.set('#ffffff'); r.map = tex; tileTextures.push(tex); }
        set(r, 'uLkTile', new THREE.Vector2(tile.wM, tile.lM));
      }
      return r.mat;
    },
    wall(color) {
      return make('wall', `wall|${color}`, { color, roughness: 0.9, metalness: 0 }, { roughness: 0.9, metalness: 0 }).mat;
    },
    ceiling(color) {
      return make('ceiling', `ceiling|${color}`, { color, roughness: 0.9, metalness: 0 }, { roughness: 0.95, metalness: 0 }).mat;
    },
    frame(color) {
      return make('frame', `frame|${color}`, { color, roughness: 0.6, metalness: 0 }, { roughness: 0.7, metalness: 0 }).mat;
    },
    railing(color) {
      return make('railing', `railing|${color}`, { color, roughness: 0.4, metalness: 0.2 }, { roughness: 0.6, metalness: 0 }).mat;
    },
    pane() {
      if (!paneMat) {
        // an unlit veil: lit glass reflects the environment (and the sun) as a bright smear that hides the view
        paneMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide });
        paneMat.userData.shared = true;
        paneMat.visible = shared.plain.value < 0.5;
      }
      return paneMat;
    },
    setPlain(on) {
      shared.plain.value = on ? 1 : 0;
      for (const r of records) {
        const p = on ? r.plain : r.look;
        r.mat.roughness = p.roughness;
        r.mat.metalness = p.metalness;
      }
      if (paneMat) paneMat.visible = !on;
    },
    setFloorAO(f) {
      floorAoTex?.dispose();
      floorAoTex = null;
      if (!f) { shared.floorAO.value = white; return; }
      floorAoTex = aoTexture(f);
      shared.floorAO.value = floorAoTex;
      shared.floorAORect.value.set(f.originX, f.originZ, f.nx * f.cellM, f.nz * f.cellM);
    },
    setCeilingAO(f) {
      ceilAoTex?.dispose();
      ceilAoTex = null;
      if (!f) { shared.ceilAO.value = white; return; }
      ceilAoTex = aoTexture(f);
      shared.ceilAO.value = ceilAoTex;
      shared.ceilAORect.value.set(f.originX, f.originZ, f.nx * f.cellM, f.nz * f.cellM);
    },
    setWallHeight(h) { shared.wallH.value = h; },
    configure(c, o) {
      cfg = c;
      trueColours = o.trueColours;
      for (const r of records) {
        if (r.kind === 'floor' && !r.balcony) r.look.roughness = r.u.uLkRoughOn.value ? 0.15 : FLOOR_ROUGHNESS_FLAT;
        // nearly matt: the plain sky gives a metal little to reflect, and a railing at metalness 0.6 (or 0.35) went black against the window
        if (r.kind === 'railing') { r.look.metalness = c.environment ? 0.12 : 0.1; r.look.roughness = 0.5; }
        if (r.map) r.map.anisotropy = c.anisotropy;
        // colour truth beats gloss: "True colours" shows no reflections
        r.u.uLkReflOn.value = r.kind === 'floor' && !r.balcony && !o.trueColours ? 1 : 0;
      }
      shared.reflStrength.value = c.reflection === 'cube' ? 2.4 : 1.25;
      api.setPlain(shared.plain.value > 0.5);
    },
    async loadTextures(loader, c) {
      const A = c.anisotropy;
      const get = (path: string, srgb: boolean): Promise<THREE.Texture> =>
        loader.texture(path, { srgb, anisotropy: A }).then((t) => { loaded.add(t); t.anisotropy = A; return t; });
      const [floorNor, wallNor] = await Promise.all([
        get('tex/marble_01/marble_01_nor_gl_1k.jpg', false),
        get('tex/plastered_wall_04/plastered_wall_04_nor_gl_1k.jpg', false),
      ]);
      for (const r of records) {
        if (r.kind === 'floor') { set(r, 'uLkNorm', floorNor); set(r, 'uLkNormScale', 0.15); set(r, 'uLkNormOn', 1); }
        if (r.kind === 'wall' || r.kind === 'ceiling') { set(r, 'uLkNorm', wallNor); set(r, 'uLkNormScale', 0.35); set(r, 'uLkNormOn', 1); }
      }
      if (!c.fullTextures) return;
      const [floorDiff, floorRough, wallDiff] = await Promise.all([
        get('tex/marble_01/marble_01_diff_1k.jpg', true),
        get('tex/marble_01/marble_01_rough_1k.jpg', false),
        get('tex/plastered_wall_04/plastered_wall_04_diff_1k.jpg', true),
      ]);
      for (const r of records) {
        if (r.kind === 'floor') {
          set(r, 'uLkDetail', floorDiff); set(r, 'uLkDetailMean', TEXTURE_MEAN.marble_01_diff);
          set(r, 'uLkDetailClamp', new THREE.Vector2(...DETAIL_CLAMP_FLOOR)); set(r, 'uLkDetailOn', 1);
          if (!r.balcony) { set(r, 'uLkRough', floorRough); set(r, 'uLkRoughRange', new THREE.Vector2(...FLOOR_ROUGHNESS_RANGE)); set(r, 'uLkRoughOn', 1); }
        }
        if (r.kind === 'wall' || r.kind === 'ceiling') {
          set(r, 'uLkDetail', wallDiff); set(r, 'uLkDetailMean', TEXTURE_MEAN.plastered_wall_04_diff);
          set(r, 'uLkDetailClamp', new THREE.Vector2(...DETAIL_CLAMP_WALL)); set(r, 'uLkDetailOn', 1);
        }
      }
      const [woodDiff, woodNor, woodRough] = await Promise.all([
        get('tex/dark_wood/dark_wood_diff_1k.jpg', true),
        get('tex/dark_wood/dark_wood_nor_gl_1k.jpg', false),
        get('tex/dark_wood/dark_wood_rough_1k.jpg', false),
      ]);
      for (const r of records) {
        if (r.kind !== 'frame') continue;
        set(r, 'uLkDetail', woodDiff); set(r, 'uLkDetailMean', TEXTURE_MEAN.dark_wood_diff);
        set(r, 'uLkDetailClamp', new THREE.Vector2(...DETAIL_CLAMP_FLOOR)); set(r, 'uLkDetailOn', 1);
        set(r, 'uLkNorm', woodNor); set(r, 'uLkNormScale', 0.5); set(r, 'uLkNormOn', 1);
        set(r, 'uLkRough', woodRough); set(r, 'uLkRoughRange', new THREE.Vector2(0, 1)); set(r, 'uLkRoughOn', 1);
      }
      if (cfg) api.configure(cfg, { trueColours });
    },
    setReflection(mode, tex) {
      shared.reflMode.value = mode === 'none' ? 0 : mode === 'cube' ? 1 : 2;
      if (tex.cube !== undefined) shared.cube.value = tex.cube;
      if (tex.planar !== undefined) shared.planar.value = tex.planar;
    },
    textureCount() { return loaded.size + tileTextures.length + (floorAoTex ? 1 : 0) + (ceilAoTex ? 1 : 0); },
    dispose() {
      for (const r of records) r.mat.dispose();
      paneMat?.dispose();
      for (const t of tileTextures) t.dispose();
      floorAoTex?.dispose();
      ceilAoTex?.dispose();
      white.dispose();
      flatNormal.dispose();
      records.length = 0;
      byKey.clear();
    },
  };
  return api;
}
