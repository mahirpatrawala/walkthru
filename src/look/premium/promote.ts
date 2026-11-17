// SPEC 16.24: promote a MeshStandardMaterial to a MeshPhysicalMaterial in place, and take it back. The object stays the same (so everything that holds it keeps
// working: the furniture kit's live set and its tints, the baked-light patch, the finish pass, disposal), only its class and the physical fields change. Off
// and 1K never call this, so their materials are the plain standard ones they always were.
import * as THREE from 'three';
import { PBR, roughOf } from './pbr';
import type { PbrClass } from './pbr';

/** what promote() changed, to put back */
interface Saved {
  cls: PbrClass;
  color: number; roughness: number; metalness: number; vertexColors: boolean; opacity: number; transparent: boolean; depthWrite: boolean; envMapIntensity: number;
  hadOwnHooks: boolean; classEnv: { value: number }; classCon: { value: number }; prevCompile: THREE.Material['onBeforeCompile'] | null; prevKey: THREE.Material['customProgramCacheKey'] | null; mine: THREE.Material['onBeforeCompile'] | null; patched: boolean;
}
type M = THREE.MeshStandardMaterial & { userData: { premium?: Saved } };

let addedKeys: string[] | null = null;
function physicalOnlyKeys(): string[] {
  if (!addedKeys) {
    const std = new Set(Object.getOwnPropertyNames(new THREE.MeshStandardMaterial()));
    addedKeys = Object.getOwnPropertyNames(new THREE.MeshPhysicalMaterial()).filter((k) => !std.has(k));
  }
  return addedKeys;
}

/** the uniforms every promoted material shares: the active room's box for the parallax correction of its reflection, and how much of the probe lights the diffuse */
export interface ProbeUniforms {
  uBoxMin: { value: THREE.Vector3 }; uBoxMax: { value: THREE.Vector3 }; uProbePos: { value: THREE.Vector3 };
  uBoxOn: { value: number }; uProbeChroma: { value: number };
  /** the active room's filtered picture (a PMREM, laid out like the sky's, so the same cube-UV lookup reads it); null until it exists */
  uProbeMap: { value: THREE.Texture | null }; uProbeOn: { value: number };
}
export function makeProbeUniforms(): ProbeUniforms {
  return { uBoxMin: { value: new THREE.Vector3() }, uBoxMax: { value: new THREE.Vector3() }, uProbePos: { value: new THREE.Vector3() }, uBoxOn: { value: 0 }, uProbeChroma: { value: 0.55 }, uProbeMap: { value: null }, uProbeOn: { value: 0 } };
}

const BOX_FN = /* glsl */ `
uniform vec3 uBoxMin; uniform vec3 uBoxMax; uniform vec3 uProbePos; uniform float uBoxOn; uniform float uProbeChroma;
uniform sampler2D uProbeMap; uniform float uProbeOn; uniform float uClassEnv; uniform float uClassCon;
vec3 lkNeutral( vec3 c ) { float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); return mix( vec3( l ), c, uProbeChroma ); }
vec3 lkBoxProject( vec3 dir ) {
  if ( uBoxOn < 0.5 ) return dir;
  // the fragment's world position: the camera plus the view-space vector to it turned back by the view matrix's rotation (not normalised, unlike transformDirectionByInverseViewMatrix)
  vec3 wp = cameraPosition + ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz;
  if ( any( lessThan( wp, uBoxMin - 0.05 ) ) || any( greaterThan( wp, uBoxMax + 0.05 ) ) ) return dir;
  vec3 inv = 1.0 / ( dir + vec3( 1e-6 ) * sign( dir + vec3( 1e-9 ) ) );
  vec3 t1 = ( uBoxMax - wp ) * inv; vec3 t2 = ( uBoxMin - wp ) * inv;
  vec3 tf = max( t1, t2 );
  float t = max( 0.0, min( min( tf.x, tf.y ), tf.z ) );
  return normalize( wp + dir * t - uProbePos );
}
`;

const RADIANCE = /vec4 envMapColor = textureCubeUV\( envMap, envMapRotation \* reflectVec, roughness \);\s*return envMapColor\.rgb \* envMapIntensity;/g;
const RADIANCE_WITH_PROBE = `vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness ); float lkScale = envMapIntensity;
    if ( uProbeOn > 0.5 ) { envMapColor = textureCubeUV( uProbeMap, lkBoxProject( reflectVec ), roughness ); envMapColor.rgb = min( pow( max( lkNeutral( envMapColor.rgb ), vec3( 1e-4 ) ), vec3( uClassCon ) ), vec3( 12.0 ) ); lkScale = uClassEnv; }
    return envMapColor.rgb * lkScale;`;
let patchedChunk: string | null = null;
/** three's own envmap_physical_pars_fragment with the specular lookup of getIBLRadiance reading the probe when there is one (cached; exported for the test) */
export function PATCHED_CHUNK(): string {
  patchedChunk ??= THREE.ShaderChunk.envmap_physical_pars_fragment.replace(RADIANCE, RADIANCE_WITH_PROBE);
  return patchedChunk;
}

/** one chain of onBeforeCompile hooks: the material's own (the baked-light patch, the detail shader) first, then the probe's */
function patchForProbe(m: M, saved: Saved, u: ProbeUniforms): void {
  if (saved.patched) return;
  saved.patched = true;
  saved.prevCompile = m.onBeforeCompile;
  saved.prevKey = m.customProgramCacheKey;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = function (this: THREE.Material, shader, renderer) {
    prev.call(this, shader, renderer);
    Object.assign(shader.uniforms, u);
    shader.uniforms.uClassEnv = saved.classEnv;
    shader.uniforms.uClassCon = saved.classCon;
    // the diffuse light and the ambient stay the sky environment's, exactly as at Off and 1K; only the SPECULAR reflection (and the clear coat's) is read from the room's probe.
    // `onBeforeCompile` sees the shader before its #include lines are resolved, so the chunk is taken from ShaderChunk, patched, and put in the include's place.
    shader.fragmentShader = shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>', `${BOX_FN}\n${PATCHED_CHUNK()}`);
  };
  m.customProgramCacheKey = function (this: THREE.Material) { return `${prevKey.call(this)}|lk-probe`; };
  saved.mine = m.onBeforeCompile;
}

export function isPromoted(m: THREE.Material): boolean { return !!(m as M).userData.premium; }
export function promotedClass(m: THREE.Material): PbrClass | null { return (m as M).userData.premium?.cls ?? null; }

const WHITE = new THREE.Color(1, 1, 1);

/** Turns `m` into a physical material of class `cls`. Idempotent for the same class; a different class is applied over the first. */
export function promote(m: THREE.MeshStandardMaterial, cls: PbrClass, u: ProbeUniforms): void {
  const mm = m as M;
  const p = PBR[cls];
  let saved = mm.userData.premium;
  if (!saved) {
    saved = {
      cls, color: m.color.getHex(), roughness: m.roughness, metalness: m.metalness, vertexColors: m.vertexColors, opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite,
      envMapIntensity: m.envMapIntensity, hadOwnHooks: Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile'), classEnv: { value: 1 }, classCon: { value: 1 }, prevCompile: null, prevKey: null, mine: null, patched: false,
    };
    mm.userData.premium = saved;
    const fresh = new THREE.MeshPhysicalMaterial() as unknown as Record<string, unknown>;
    Object.setPrototypeOf(mm, THREE.MeshPhysicalMaterial.prototype);
    for (const k of physicalOnlyKeys()) (mm as unknown as Record<string, unknown>)[k] = fresh[k];
    (mm as unknown as { type: string }).type = 'MeshPhysicalMaterial';
    mm.defines = { STANDARD: '', PHYSICAL: '' };
    patchForProbe(mm, saved, u);
  }
  saved.cls = cls;
  const ph = mm as unknown as THREE.MeshPhysicalMaterial;
  m.metalness = p.metalness;
  m.roughness = roughOf(cls, saved.roughness);
  if (p.colour) m.color.set(p.colour);
  else if (cls === 'glass') { m.color.setHex(saved.color).lerp(WHITE, 1 - (p.tintKeep ?? 0.5)); }
  else m.color.setHex(saved.color);
  if (cls === 'mirror') m.vertexColors = false; else m.vertexColors = saved.vertexColors;
  ph.clearcoat = p.clearcoat ?? 0;
  ph.clearcoatRoughness = p.clearcoatRoughness ?? 0;
  ph.sheen = p.sheen ?? 0;
  ph.sheenRoughness = p.sheenRoughness ?? 0.5;
  if (p.sheen) ph.sheenColor.copy(m.color).lerp(WHITE, 0.15);
  ph.transmission = p.transmission ?? 0;
  ph.thickness = p.thickness ?? 0;
  if (cls === 'glass') { m.opacity = 1; m.transparent = false; m.depthWrite = true; } else { m.opacity = saved.opacity; m.transparent = saved.transparent; m.depthWrite = saved.depthWrite; }
  saved.classEnv.value = p.env;
  saved.classCon.value = p.contrast ?? 1;
  mm.needsUpdate = true;
}

/** Puts a promoted material back as the standard one it was. */
export function demote(m: THREE.MeshStandardMaterial): void {
  const mm = m as M;
  const saved = mm.userData.premium;
  if (!saved) return;
  m.color.setHex(saved.color); m.roughness = saved.roughness; m.metalness = saved.metalness; m.vertexColors = saved.vertexColors;
  m.opacity = saved.opacity; m.transparent = saved.transparent; m.depthWrite = saved.depthWrite; m.envMapIntensity = saved.envMapIntensity;
  // put the material's own hooks back, unless another patch (the baked light) was chained on top of ours since: that one stays, and mine is inert once the class is standard
  if (saved.patched && saved.prevCompile && m.onBeforeCompile === saved.mine) {
    if (saved.hadOwnHooks) { m.onBeforeCompile = saved.prevCompile; if (saved.prevKey) m.customProgramCacheKey = saved.prevKey; }
    else { delete (m as { onBeforeCompile?: unknown }).onBeforeCompile; delete (m as { customProgramCacheKey?: unknown }).customProgramCacheKey; }
  }
  Object.setPrototypeOf(mm, THREE.MeshStandardMaterial.prototype);
  for (const k of physicalOnlyKeys()) delete (mm as unknown as Record<string, unknown>)[k];
  (mm as unknown as { type: string }).type = 'MeshStandardMaterial';
  mm.defines = { STANDARD: '' };
  if (mm.userData.premiumNor !== undefined) { m.normalScale.set(mm.userData.premiumNor as number, mm.userData.premiumNor as number); delete mm.userData.premiumNor; }
  delete mm.userData.premium;
  mm.needsUpdate = true;
}

/** cloth shows its weave: once its normal map has arrived the map is read 1.7 times as strongly (put back by demote) */
export function strengthenWeave(m: THREE.MeshStandardMaterial): void {
  const mm = m as M;
  const cls = mm.userData.premium?.cls;
  if ((cls !== 'fabric' && cls !== 'bedding') || !m.normalMap || mm.userData.premiumNor !== undefined) return;
  mm.userData.premiumNor = m.normalScale.x;
  m.normalScale.multiplyScalar(1.7);
}
