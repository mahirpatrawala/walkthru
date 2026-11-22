// The sky over an open-air space (SPEC 19.12, 22 Nov 2026): a photograph of a real sky (the CC0 Poly Haven kloofendal_48d_partly_cloudy_puresky
// HDRI the look already ships, its upper hemisphere tone mapped by tools/optimise-outdoor-real.mjs) on a dome that follows the camera. It is a sky
// and nothing else: no building, tree or street is in it (SPEC 16.2.4 stands: "Outside the window is a plain sky, not the real view"). The picture
// is turned so its sun sits where the scene's sun is, and tinted by the hour's grade (the plain sky of the look stays the light, the environment
// and the night). Below the horizon it fades into the look's own plain haze. The pool water mirrors the same picture (water.ts).
import * as THREE from 'three';
import type { Grade } from '../look/grade';
import type { Tier } from '../look/types';
import type { AssetLoader } from '../look/assets';

/** where the picture's sun is (u, 0..1 across the picture) and which elevations its rows span: written by the optimiser into manifest.json */
export const SKY_PICTURE = { sunU: 0.595, elTop: 90, elBot: -8 } as const;
export const skyPicturePath = (tier: Tier): string => `outdoor/sky/sky_day${tier === 'low' ? '.low' : ''}.jpg`;
/** mean linear colour of the clear sky in the picture at about 30 degrees up (measured on the shipped file): the grade's mid sky is matched to it */
export const SKY_PICTURE_MID: [number, number, number] = [0.238, 0.305, 0.479];

export interface SkyUniforms {
  uSkyMap: { value: THREE.Texture | null };
  /** 0: no picture (night, True colours, not loaded); 1: the picture */
  uSkyOn: { value: number };
  /** u offset that puts the picture's sun at the scene's sun */
  uSkyRot: { value: number };
  /** per-channel gain from the picture to the hour's sky */
  uSkyGain: { value: THREE.Vector3 };
  uSkyHaze: { value: THREE.Color };
}

export function makeSkyUniforms(): SkyUniforms {
  return { uSkyMap: { value: null }, uSkyOn: { value: 0 }, uSkyRot: { value: 0 }, uSkyGain: { value: new THREE.Vector3(1, 1, 1) }, uSkyHaze: { value: new THREE.Color(0.8, 0.85, 0.9) } };
}

/** GLSL: the picture in a world direction (shared with the water's reflection) */
export const SKY_GLSL = `
uniform sampler2D uSkyMap; uniform float uSkyOn; uniform float uSkyRot; uniform vec3 uSkyGain; uniform vec3 uSkyHaze;
vec4 owSkyPicture(vec3 d){
  d = normalize(d);
  float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
  float u = fract(atan(d.z, d.x) / 6.2831853 + uSkyRot);
  float v = (el - ${SKY_PICTURE.elBot.toFixed(1)}) / ${(SKY_PICTURE.elTop - SKY_PICTURE.elBot).toFixed(1)};
  vec3 c = texture2D(uSkyMap, vec2(u, clamp(v, 0.002, 0.998))).rgb * uSkyGain;
  // under the horizon the picture gives way to the look's plain haze
  float a = smoothstep(-6.0, -1.0, el) * uSkyOn;
  return vec4(mix(uSkyHaze, c, smoothstep(-6.0, 0.5, el)), a);
}
`;

/** the gain that takes the picture to the hour: its mid sky onto the grade's mid sky, half of the hue shift (a photo of a blue sky goes warm at dusk, not orange) */
export function skyGain(g: Grade): [number, number, number] {
  const lum = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const k = lum(g.sky.mid) / lum(SKY_PICTURE_MID);
  return [0, 1, 2].map((i) => {
    const hue = g.sky.mid[i] / Math.max(1e-4, SKY_PICTURE_MID[i] * k);
    return k * (0.5 + 0.5 * hue);
  }) as [number, number, number];
}

/** how much of the picture shows: all of it by day, fading out as the sun sets, none at night (the plain night sky is the sky) */
export function skyPictureOn(g: Grade, trueColours: boolean): number {
  if (trueColours || g.night) return 0;
  return Math.min(1, Math.max(0, g.sunIntensity / 2.2));
}

/** turns the picture so its sun is at the scene's sun: atan2(z, x) of the direction to the sun */
export function skyRotation(toSun: readonly [number, number, number]): number {
  const az = Math.atan2(toSun[2], toSun[0]) / (2 * Math.PI);
  return ((SKY_PICTURE.sunU - az) % 1 + 1) % 1;
}

export interface SkyDome {
  readonly mesh: THREE.Mesh;
  readonly uniforms: SkyUniforms;
  /** the hour, the sun, True colours */
  sync(g: Grade, toSun: readonly [number, number, number], trueColours: boolean): void;
  /** once a frame: the dome sits on the camera */
  follow(camera: THREE.Camera): void;
  dispose(): void;
}

/** The dome. `loader` fetches the picture (after the first paint); until it arrives, and if it never does, the look's plain sky shows. */
export function mountSkyDome(loader: AssetLoader | null, tier: Tier): SkyDome {
  const uniforms = makeSkyUniforms();
  const geo = new THREE.SphereGeometry(150, tier === 'low' ? 32 : 48, tier === 'low' ? 12 : 20, 0, Math.PI * 2, 0, (98 / 180) * Math.PI);
  const mat = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir;\n${SKY_GLSL}\nvoid main(){ vec4 s = owSkyPicture(vDir); if (s.a < 0.003) discard; gl_FragColor = vec4(s.rgb, s.a);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`,
    // opaque list (drawn first, renderOrder -1000) but blended over the cleared background where it fades under the horizon
    side: THREE.BackSide, depthWrite: false, depthTest: false, transparent: false, blending: THREE.NormalBlending, fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'outdoor-sky'; mesh.userData.outdoor = 'sky'; mesh.userData.cast = false;
  mesh.renderOrder = -1000; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
  // a ray (the walk's measure, a click) must never hit the sky
  mesh.raycast = () => {};
  let disposed = false;
  let tex: THREE.Texture | null = null;
  if (loader && typeof document !== 'undefined') {
    loader.texture(skyPicturePath(tier), { srgb: true, anisotropy: 2 }).then((t) => {
      if (disposed) { t.dispose(); return; }
      tex = t;
      // no mipmaps: the seam where u wraps would pick the smallest mip for one column (a visible line), and the picture is magnified anyway
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      uniforms.uSkyMap.value = t;
    }).catch((e) => console.warn('[walkthru] the sky picture did not load: the plain sky stays', e));
  }
  let want = 0;
  return {
    mesh, uniforms,
    sync(g, toSun, trueColours) {
      want = skyPictureOn(g, trueColours);
      uniforms.uSkyGain.value.set(...skyGain(g));
      uniforms.uSkyRot.value = skyRotation(toSun);
      uniforms.uSkyHaze.value.setRGB(...g.sky.horizon);
      uniforms.uSkyOn.value = uniforms.uSkyMap.value ? want : 0;
    },
    follow(camera) {
      mesh.position.copy(camera.position);
      // the picture arrived since the last sync
      if (uniforms.uSkyMap.value && uniforms.uSkyOn.value === 0 && want > 0) uniforms.uSkyOn.value = want;
    },
    dispose() { disposed = true; geo.dispose(); mat.dispose(); tex?.dispose(); mesh.removeFromParent(); },
  };
}
