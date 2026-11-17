// Pool water (SPEC 19.3). Two parts that work together:
//  - the SURFACE: a transparent shader that adds only what a water surface adds, the sky and the sun mirrored in it, strongest at a low angle
//    (Fresnel), moved by a few crossing waves, and lets everything under it through;
//  - the UNDERWATER surfaces (the pool's tile floor, walls and steps): ordinary lit materials patched so that what is under the water is
//    tinted by how much water the eye looks through (water takes red first, so deep water goes green-blue), wobbles like a refracted image,
//    and on the higher tiers is netted with caustics.
// Per tier: low = moving normals and the depth tint only; medium = + the wobble and a 3-pass caustic; high = + a 5-pass caustic and a finer ripple.
// The sky it mirrors is the look's own plain graded sky (no buildings, no trees are invented in it); the facade and the planting are not mirrored.
import * as THREE from 'three';
import type { Grade } from '../look/grade';
import type { Tier } from '../look/types';

type U<T> = { value: T };
export interface WaterUniforms {
  uTime: U<number>; uWaterY: U<number>;
  uSunDir: U<THREE.Vector3>; uSunCol: U<THREE.Color>; uSunStrength: U<number>;
  uZenith: U<THREE.Color>; uHorizon: U<THREE.Color>; uGround: U<THREE.Color>;
  /** how much of a lit day there is: dims the body colour at dusk and night */
  uLight: U<number>;
  /** the pool lights: 0 by day, 1 at night */
  uGlow: U<number>;
  uAbsorb: U<THREE.Vector3>; uScatter: U<number>; uWaterCol: U<THREE.Color>;
  /** SPEC 16.24: the surroundings as the room probe saw them (a PMREM like the sky's), which the 2K surface mirrors; off until it exists */
  uProbeMap: U<THREE.Texture | null>; uProbeOn: U<number>;
}

export function makeWaterUniforms(waterY: number, tint: 'blue' | 'turquoise' | 'white'): WaterUniforms {
  const col = tint === 'blue' ? '#0F6E93' : tint === 'turquoise' ? '#15A3AE' : '#3FB4C9';
  return {
    uTime: { value: 0 }, uWaterY: { value: waterY },
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.3).normalize() }, uSunCol: { value: new THREE.Color(1, 0.95, 0.85) }, uSunStrength: { value: 1 },
    uZenith: { value: new THREE.Color('#5F9AD6') }, uHorizon: { value: new THREE.Color('#DCE6EE') }, uGround: { value: new THREE.Color('#BDB09A') },
    uLight: { value: 1 }, uGlow: { value: 0 },
    // per metre of water: red goes first
    uAbsorb: { value: new THREE.Vector3(0.62, 0.12, 0.07) }, uScatter: { value: 0.42 }, uWaterCol: { value: new THREE.Color(col).convertSRGBToLinear() },
    uProbeMap: { value: null }, uProbeOn: { value: 0 },
  };
}

/** feeds a basin's uniforms from the look: the sky colours, the sun, and how bright and how lit the day is */
export function syncWaterUniforms(u: WaterUniforms, g: Grade, sun: { toSun: [number, number, number] }, lampsOn: number): void {
  u.uZenith.value.setRGB(...g.sky.zenith); u.uHorizon.value.setRGB(...g.sky.horizon); u.uGround.value.setRGB(...g.sky.ground);
  u.uSunDir.value.set(...sun.toSun).normalize();
  u.uSunCol.value.setRGB(...g.sunColour);
  u.uSunStrength.value = g.night ? 0 : Math.min(1.3, g.sunIntensity / 5.9);
  // daylight washes the body colour; at night only the pool lights colour the water
  u.uLight.value = g.night ? 0.12 : 0.35 + 0.65 * Math.min(1, g.sunIntensity / 4);
  u.uGlow.value = lampsOn;
}

const NOISE = `
float owH(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float owN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(owH(i), owH(i+vec2(1.,0.)), f.x), mix(owH(i+vec2(0.,1.)), owH(i+vec2(1.,1.)), f.x), f.y); }
`;

/** the pool-floor caustic: a swirl of folded sines that makes bright, soft, moving nets (after the common tileable water-caustic trick), `iters` passes */
const CAUSTIC = `
float owCaustic(vec2 uv, float t, int iters){
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    if (n >= iters) break;
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= float(iters);
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
`;

/** Patches a lit material so that whatever of it is under the water of `u` is tinted, wobbled and (medium, high) netted with caustics. */
export function makeUnderwater(mat: THREE.MeshStandardMaterial, u: WaterUniforms, tier: Tier, ultra = false): THREE.MeshStandardMaterial {
  const caustic = tier === 'low' ? 0 : tier === 'medium' ? 3 : 5;
  const wobble = tier !== 'low';
  mat.onBeforeCompile = (sh) => {
    for (const [k, v] of Object.entries(u)) sh.uniforms[k] = v;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vOW;
uniform float uTime; uniform float uWaterY; uniform vec3 uSunDir; uniform float uSunStrength; uniform float uLight; uniform float uGlow;
uniform vec3 uAbsorb; uniform float uScatter; uniform vec3 uWaterCol; uniform vec3 uSunCol;
${NOISE}${CAUSTIC}`)
      .replace('#include <map_fragment>', `
  float owDepth = max(0.0, uWaterY - vOW.y);
#ifdef USE_MAP
  vec2 owUv = vMapUv;
  ${wobble ? (ultra
    // 2K: the refracted floor swims with the same crossing waves as the surface, two scales, and grows with depth (a thicker body of water bends the picture more)
    ? 'owUv += 0.014 * min(owDepth, 1.6) * (vec2(sin(vOW.x*9.0 + uTime*1.3) + sin(vOW.z*7.0 - uTime*1.1), cos(vOW.z*8.0 + uTime*1.2) + cos(vOW.x*6.0 - uTime)) + 0.55 * vec2(sin(vOW.x*21.0 - uTime*1.9 + vOW.z*5.0), cos(vOW.z*19.0 + uTime*1.7 - vOW.x*4.0)));'
    : 'owUv += 0.01 * min(owDepth, 1.2) * vec2(sin(vOW.x*9.0 + uTime*1.3) + sin(vOW.z*7.0 - uTime*1.1), cos(vOW.z*8.0 + uTime*1.2) + cos(vOW.x*6.0 - uTime));') : ''}
  diffuseColor *= texture2D(map, owUv);
#endif
`)
      .replace('#include <opaque_fragment>', `
  if (owDepth > 0.0) {
    vec3 owV = normalize(vOW - cameraPosition);
    float owPath = owDepth / max(abs(owV.y), 0.3);
    ${caustic > 0 ? `{
      vec3 wn = inverseTransformDirection(normal, viewMatrix);
      float up = smoothstep(0.35, 0.9, wn.y);
      float c = owCaustic(vOW.xz * 0.42, uTime * 0.5, ${caustic}) * uSunStrength * up * smoothstep(2.6, 0.2, owDepth);
      outgoingLight += uSunCol * c * 0.85;
    }` : ''}
    vec3 owA = exp(-uAbsorb * owPath);
    vec3 owScatter = uWaterCol * (uLight + uGlow * 0.9) * (1.0 - exp(-uScatter * owPath));
    outgoingLight = outgoingLight * owA + owScatter;
    outgoingLight += uGlow * vec3(0.05, 0.28, 0.34) * exp(-owPath * 0.5) * 0.3;
  }
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `ow-underwater-${caustic}-${wobble ? 'w' : 'n'}${ultra ? 'u' : ''}`;
  return mat;
}

const SURFACE_VERT = `
varying vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;
const SURFACE_FRAG = (fine: boolean, ultra: boolean): string => `
${ultra ? '#include <cube_uv_reflection_fragment>\nuniform sampler2D uProbeMap; uniform float uProbeOn;' : ''}
uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunStrength;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uWaterCol; uniform float uLight; uniform float uGlow;
varying vec3 vW;
${NOISE}
vec3 owSky(vec3 r){
  float h = r.y;
  vec3 c = h >= 0.0 ? mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(uHorizon, uGround, clamp(-h * 5.0, 0.0, 1.0));
  c += uSunCol * pow(max(dot(r, uSunDir), 0.0), 7.0) * 0.18 * uSunStrength;
  return c;
}
vec3 owWave(vec2 p, float t){
  float dx = 0.0, dz = 0.0;
  // five crossing sine waves (direction, wavenumber, amplitude, speed): a gentle swell
  const vec4 W0 = vec4(0.9, 0.4, 2.1, 0.012); const vec4 W1 = vec4(-0.5, 0.86, 3.1, 0.008);
  const vec4 W2 = vec4(0.2, -0.98, 4.6, 0.006); const vec4 W3 = vec4(-0.95, -0.3, 6.4, 0.0045); const vec4 W4 = vec4(0.7, 0.7, 9.0, 0.0032);
  const float SP[5] = float[5](0.9, 1.2, 1.5, 1.8, 2.2);
  vec4 Ws[5] = vec4[5](W0, W1, W2, W3, W4);
  for (int i = 0; i < 5; i++) {
    vec2 d = normalize(Ws[i].xy); float k = Ws[i].z; float a = Ws[i].w;
    float ph = dot(d, p) * k + t * SP[i];
    dx += a * k * d.x * cos(ph); dz += a * k * d.y * cos(ph);
  }
  ${fine ? 'vec2 q = p * 14.0 + vec2(t * 0.6, -t * 0.4); dx += (owN(q) - 0.5) * 0.02; dz += (owN(q + 17.0) - 0.5) * 0.02;' : ''}
  ${ultra ? `// 2K: soft ripples at three scales crossing each other, never still (a slow drift), gentle enough not to shimmer
  vec2 q1 = p * 4.3 + vec2(t * 0.21, t * 0.13); vec2 q2 = p * 9.7 + vec2(-t * 0.33, t * 0.27); vec2 q3 = p * 23.0 + vec2(t * 0.5, -t * 0.4);
  dx += (owN(q1) - 0.5) * 0.034 + (owN(q2 + 5.0) - 0.5) * 0.022 + (owN(q3 + 9.0) - 0.5) * 0.012;
  dz += (owN(q1 + 31.0) - 0.5) * 0.034 + (owN(q2 + 19.0) - 0.5) * 0.022 + (owN(q3 + 27.0) - 0.5) * 0.012;` : ''}
  return normalize(vec3(-dx, 1.0, -dz));
}
void main(){
  vec3 V = normalize(cameraPosition - vW);
  vec3 n = owWave(vW.xz, uTime);
  // far away the ripples flatten (they would only shimmer)
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), clamp((length(cameraPosition - vW) - 14.0) / 30.0, 0.0, 0.7)));
  float cosT = clamp(dot(n, V), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  F = clamp(F * 0.95 + 0.03, 0.0, 1.0);
  vec3 R = reflect(-V, n);
  if (R.y < 0.0) R.y = -R.y * 0.2;
  vec3 refl = owSky(R);
  ${ultra ? `// 2K: the real surroundings (the facade, the planting, the sky with its clouds) mirrored, softly: the probe's picture where it has one, the plain sky at the horizon
  if (uProbeOn > 0.5) {
    vec3 pr = textureCubeUV(uProbeMap, normalize(R), 0.05).rgb;
    refl = mix(refl, pr, 0.8);
  }` : ''}
  // the sun's glint: a tight bright lobe, kept finite so a bloom pass does not flare
  refl += uSunCol * pow(max(dot(R, uSunDir), 0.0), 600.0) * 12.0 * uSunStrength;
  vec3 body = uWaterCol * (uLight * 0.5 + uGlow * 0.5);
  float a = F + 0.05;
  vec3 col = refl * F + body * 0.05;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** the cube-UV constants of a PMREM texture, as three derives them from its image height (the surface shader reads the probe with the sky's lookup) */
export function cubeUvDefines(imageHeight: number): Record<string, string> {
  const maxMip = Math.log2(imageHeight) - 2;
  return { ENVMAP_TYPE_CUBE_UV: '', CUBEUV_MAX_MIP: `${maxMip}.0`, CUBEUV_TEXEL_WIDTH: `${1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16))}`, CUBEUV_TEXEL_HEIGHT: `${1 / imageHeight}` };
}

export function makeWaterSurface(u: WaterUniforms, tier: Tier, ultra = false): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: u as unknown as Record<string, THREE.IUniform>,
    vertexShader: SURFACE_VERT, fragmentShader: SURFACE_FRAG(tier === 'high' || ultra, ultra),
    defines: ultra ? cubeUvDefines(256 * 4) : {},
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
  });
  m.userData.water = true;
  return m;
}
