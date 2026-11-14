// SPEC 16.14: the two small shader patches of the baked look. A lit three.js material gets its diffuse light from the hemisphere, the
// sun and the pooled lights. Where a bake exists, that light is replaced:
//   static  (shell, kit): diffuse light = the composited lightmap; the hemisphere, environment and sun add nothing to the diffuse
//   dynamic (furniture, doors, decor, the walker): diffuse ambient = the room's light probes (SH) at the object; the sun stays real and shadowed
// Specular light (the sun's glint, the environment reflection of the glossy floor) is left alone. Each patch is a uniform away from "off".
import * as THREE from 'three';

export interface PatchUniforms {
  /** 1 = lightmapped surfaces take their diffuse light from the lightmap */
  baked: { value: number };
  /** 1 = probe-lit objects take their ambient light from the probes */
  probe: { value: number };
  /** the SH (9 rgb coefficients) of the object being drawn; set per mesh in onBeforeRender */
  sh: { value: THREE.Vector3[] };
}

export function createPatchUniforms(): PatchUniforms {
  return { baked: { value: 0 }, probe: { value: 0 }, sh: { value: Array.from({ length: 9 }, () => new THREE.Vector3()) } };
}

const STATIC_END = /* glsl */ `
#if defined( RE_IndirectDiffuse ) && defined( USE_LIGHTMAP )
  irradiance = mix( irradiance, lightMapIrradiance, uWtBaked );
  iblIrradiance *= ( 1.0 - uWtBaked );
#endif
reflectedLight.directDiffuse *= ( 1.0 - uWtBaked );
#include <lights_fragment_end>
`;

const DYNAMIC_PARS = /* glsl */ `
uniform vec3 uWtSH[9];
uniform float uWtProbe;
vec3 wtShIrradiance( vec3 n ) {
  float x = n.x, y = n.y, z = n.z;
  vec3 r = uWtSH[0] * ( 0.282095 * 3.141593 );
  r += uWtSH[1] * ( 0.488603 * y * 2.094395 );
  r += uWtSH[2] * ( 0.488603 * z * 2.094395 );
  r += uWtSH[3] * ( 0.488603 * x * 2.094395 );
  r += uWtSH[4] * ( 1.092548 * x * y * 0.785398 );
  r += uWtSH[5] * ( 1.092548 * y * z * 0.785398 );
  r += uWtSH[6] * ( 0.315392 * ( 3.0 * z * z - 1.0 ) * 0.785398 );
  r += uWtSH[7] * ( 1.092548 * x * z * 0.785398 );
  r += uWtSH[8] * ( 0.546274 * ( x * x - y * y ) * 0.785398 );
  return max( r, vec3( 0.0 ) );
}
`;
const DYNAMIC_END = /* glsl */ `
#if defined( RE_IndirectDiffuse )
{
  vec3 wtN = inverseTransformDirection( geometryNormal, viewMatrix );
  irradiance = mix( irradiance, wtShIrradiance( wtN ), uWtProbe );
  iblIrradiance *= ( 1.0 - uWtProbe );
}
#endif
#include <lights_fragment_end>
`;

type Compile = NonNullable<THREE.Material['onBeforeCompile']>;

function wrap(mat: THREE.Material, tag: string, edit: (shader: Parameters<Compile>[0]) => void): void {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (this: THREE.Material, shader, renderer) {
    prev?.call(this, shader, renderer);
    edit(shader);
  } as Compile;
  mat.customProgramCacheKey = function (this: THREE.Material) { return `${prevKey.call(this)}|${tag}`; };
  mat.userData[`wt${tag}`] = true;
  mat.needsUpdate = true;
}

/** Idempotent. The material gets `uWtBaked`; assign `lightMap` (channel 1) and `lightMapIntensity` separately. */
export function patchStatic(mat: THREE.Material, u: PatchUniforms): void {
  if (mat.userData.wtstatic || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
  wrap(mat, 'static', (shader) => {
    shader.uniforms.uWtBaked = u.baked;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWtBaked;')
      .replace('#include <lights_fragment_end>', STATIC_END);
  });
}

/** Idempotent. The material gets `uWtSH` and `uWtProbe`. */
export function patchDynamic(mat: THREE.Material, u: PatchUniforms): void {
  if (mat.userData.wtdynamic || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
  wrap(mat, 'dynamic', (shader) => {
    shader.uniforms.uWtSH = u.sh;
    shader.uniforms.uWtProbe = u.probe;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DYNAMIC_PARS}`)
      .replace('#include <lights_fragment_end>', DYNAMIC_END);
  });
}
