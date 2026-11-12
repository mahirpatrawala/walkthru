// What every painted thing shares: the uniforms (sun, wind, land, shade maps, the brush sheet) and the GLSL that
// reads them. Colours here are paint, not light: they are picked as they should look on the canvas and are never
// tone-mapped, so a palette is three mixed colours (light, half-tone, shade) and a thing in the world chooses
// between them stroke by stroke.
import * as THREE from 'three';

export const SUN = new THREE.Vector3(-0.44, 0.5, -0.75).normalize(); // a low autumn sun, ahead and to the left of the way in
export const WIND = new THREE.Vector2(0.8, 0.6).normalize(); // blows toward the east and a little south
export const EXTENT = 256; // the land map covers -EXTENT..EXTENT metres both ways
export const LAND_RES = 1025;

const blank = (r, g, b, a) => {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1);
  t.needsUpdate = true;
  return t;
};

/** A tiling noise sheet: four unrelated smooth noises in the four channels, with mipmaps. */
function noiseSheet(size = 256, seed = 7) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const data = new Uint8Array(size * size * 4);
  for (let ch = 0; ch < 4; ch++) {
    const field = new Float32Array(size * size);
    // octaves of value noise on lattices that divide the sheet, so it tiles
    for (const [cells, amp] of [[8, 1], [16, 0.5], [32, 0.25], [64, 0.125]]) {
      const lat = new Float32Array(cells * cells);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * cells, fy = (y / size) * cells;
          const x0 = Math.floor(fx), y0 = Math.floor(fy);
          let tx = fx - x0, ty = fy - y0;
          tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
          const a = lat[(x0 % cells) + (y0 % cells) * cells], b = lat[((x0 + 1) % cells) + (y0 % cells) * cells];
          const c = lat[(x0 % cells) + ((y0 + 1) % cells) * cells], d = lat[((x0 + 1) % cells) + ((y0 + 1) % cells) * cells];
          field[x + y * size] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
        }
      }
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of field) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let i = 0; i < field.length; i++) data[i * 4 + ch] = Math.round(((field[i] - lo) / (hi - lo)) * 255);
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function createShared() {
  return {
    uTime: { value: 0 },
    uPixel: { value: 0.001 }, // metres one pixel covers at one metre from the eye
    uSunDir: { value: SUN.clone() },
    uWind: { value: new THREE.Vector3(WIND.x, WIND.y, 1) }, // direction on the ground (x, z) and strength
    uExtent: { value: EXTENT },
    tHeight: { value: blank(0, 0, 0, 0) },
    tLand: { value: blank(0, 0, 128, 0) }, // r path, g open to the sky (the clearing), b moss, a unused
    tNoise: { value: noiseSheet() },
    tBrush: { value: blank(255, 255, 128, 255) },
    tTreeShade: { value: null },
    uTreeShadeMat: { value: new THREE.Matrix4() },
    tFigShade: { value: null },
    uFigShadeMat: { value: new THREE.Matrix4() },
    uHaze: { value: new THREE.Color(0.6, 0.6, 0.67) },
    uHazeSun: { value: new THREE.Color(1.0, 0.89, 0.62) },
    uHazeDensity: { value: 0.0105 },
    uHazeGlow: { value: new THREE.Color(0.1, 0.08, 0.02) }, // what the air adds right round the sun
    uShadeBias: { value: 0.0009 }, // how far a spot must be behind the still world's shade to be in it
    uBounce: { value: new THREE.Color(0.1, 0.045, 0.0) }, // light the ground throws up into a figure's shade
    uLamp: { value: new THREE.Vector4(0, 0, 0, 0) }, // a light carried through the picture: where, and how strong (0: none)
    uLampCol: { value: new THREE.Color(1.0, 0.62, 0.25) },
    // the glaze a moving thing's shadow lays over the ground: the paint times the first, plus the second
    uGlazeMul: { value: new THREE.Color(0.5, 0.38, 0.46) },
    uGlazeAdd: { value: new THREE.Color(0.03, 0.02, 0.06) },
    uImpasto: { value: 1 },
    uFocus: { value: new THREE.Vector3() }, // where the wanderer stands
  };
}

export const COMMON = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;
#define TAU 6.28318530718
uniform float uTime;
uniform float uPixel;
uniform vec3 uSunDir;
uniform vec3 uWind;
uniform float uExtent;
uniform sampler2D tHeight;
uniform sampler2D tLand;
uniform sampler2D tNoise;
uniform sampler2D tBrush;
uniform sampler2DShadow tTreeShade;
uniform mat4 uTreeShadeMat;
uniform sampler2DShadow tFigShade;
uniform mat4 uFigShadeMat;
uniform vec3 uHaze;
uniform vec3 uHazeSun;
uniform float uHazeDensity;
uniform vec3 uHazeGlow;
uniform float uShadeBias;
uniform vec3 uBounce;
uniform vec4 uLamp;
uniform vec3 uLampCol;
uniform vec3 uGlazeMul;
uniform vec3 uGlazeAdd;
uniform float uImpasto;
uniform vec3 uFocus;

vec4 hash4(vec2 p, float salt) {
  vec4 q = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099) + salt * 0.0713);
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}
vec4 hash4(float n) {
  vec4 q = fract(vec4(n) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}

vec2 landUv(vec2 xz) { return (xz + uExtent) / (2.0 * uExtent) * (1024.0 / 1025.0) + 0.5 / 1025.0; }
float heightAt(vec2 xz) { return texture(tHeight, landUv(xz)).r; }
vec3 normalAt(vec2 xz) {
  const float e = 0.75;
  float hx = heightAt(xz + vec2(e, 0.0)) - heightAt(xz - vec2(e, 0.0));
  float hz = heightAt(xz + vec2(0.0, e)) - heightAt(xz - vec2(0.0, e));
  return normalize(vec3(-hx, 2.0 * e, -hz));
}

// Wind: bands crossing the wood with the wind, stretched along their fronts, with finer squalls inside.
float gustAt(vec2 xz) {
  vec2 w = uWind.xy;
  vec2 q = vec2(dot(xz, w), dot(xz, vec2(-w.y, w.x)));
  float a = texture(tNoise, vec2(q.x - uTime * 4.0, q.y * 0.45) / 95.0).r;
  float b = texture(tNoise, vec2(q.x - uTime * 6.5, q.y * 0.6) / 23.0 + 0.37).g;
  return clamp(smoothstep(0.36, 0.74, a) * 0.8 + (b - 0.5) * 0.6, 0.0, 1.0) * uWind.z;
}

// 1 in the sun, 0 in the wood's shade. That shade never moves, so a dab can take it whole.
float woodSunAt(vec3 world) {
  vec4 t = uTreeShadeMat * vec4(world, 1.0);
  float lit = smoothstep(0.56, 0.62, texture(tNoise, world.xz / 29.0).r); // beyond the picture of the shade: patches
  if (t.x > 0.0 && t.x < 1.0 && t.y > 0.0 && t.y < 1.0 && t.z < 1.0) lit = texture(tTreeShade, vec3(t.xy, t.z - uShadeBias));
  return lit;
}
// The wanderer's own shadow moves all the time (he breathes, his cloak blows), so it is read soft: a few looks
// round the spot, which turns its edge into a gradual thing instead of a line that dabs flick across.
float figSunSoft(vec3 f) {
  if (f.x <= 0.0 || f.x >= 1.0 || f.y <= 0.0 || f.y >= 1.0 || f.z >= 1.0) return 1.0;
  float z = f.z - 0.004;
  const float e = 0.013;
  float s = texture(tFigShade, vec3(f.xy, z)) * 0.28;
  s += texture(tFigShade, vec3(f.xy + vec2(e, e * 0.4), z)) * 0.18;
  s += texture(tFigShade, vec3(f.xy + vec2(-e * 0.4, e), z)) * 0.18;
  s += texture(tFigShade, vec3(f.xy + vec2(-e, -e * 0.4), z)) * 0.18;
  s += texture(tFigShade, vec3(f.xy + vec2(e * 0.4, -e), z)) * 0.18;
  return s;
}
float figSunAt(vec3 world) { return figSunSoft((uFigShadeMat * vec4(world, 1.0)).xyz); }
float sunAt(vec3 world) { return min(woodSunAt(world), figSunAt(world)); }

// The painter's three mixes. x is how lit the spot is; r moves the edges about so that one zone breaks into
// the next dab by dab.
vec3 paint3(vec3 cl, vec3 cm, vec3 cs, float x, float r) {
  x += (r - 0.5) * 0.2;
  vec3 c = mix(cs, cm, smoothstep(0.24, 0.36, x));
  return mix(c, cl, smoothstep(0.56, 0.7, x));
}

// Broken colour: every dab is mixed a little differently on the palette (value, hue, strength).
vec3 jitter(vec3 c, vec3 r, float amount) {
  float a = (r.y - 0.5) * 0.9 * amount;
  vec3 k = vec3(0.57735);
  c = c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
  float g = dot(c, vec3(0.3, 0.59, 0.11));
  c = mix(vec3(g), c, 1.0 + (r.z - 0.5) * 0.7 * amount);
  return max(c * (1.0 + (r.x - 0.5) * 0.5 * amount), 0.0);
}

// Mist: it lies low among the trunks, takes the sun's colour toward the sun and a grey violet away from it, and
// is what puts distance between one row of trees and the next.
vec3 airColour(vec3 v) {
  float sunward = max(dot(v, uSunDir), 0.0);
  vec3 air = mix(uHaze, uHazeSun, sunward * sunward);
  return air + uHazeGlow * pow(sunward, 12.0);
}

// A light carried through the picture, a lantern: how much of it falls on a spot that faces n. Add
// (the thing's own colour) * uLampCol * lampAt. It is nothing while uLamp.w is 0.
float lampAt(vec3 world, vec3 n) {
  vec3 to = uLamp.xyz - world;
  float d2 = dot(to, to);
  float face = clamp(dot(n, to) * inversesqrt(d2 + 1e-4) * 0.7 + 0.4, 0.0, 1.0);
  return uLamp.w * face / (1.0 + d2 * 0.2);
}
float mistBetween(vec3 world) {
  vec3 d = world - cameraPosition;
  float dist = length(d);
  float sunward = max(dot(d / dist, uSunDir), 0.0);
  float up = clamp((0.5 * (world.y + cameraPosition.y) - uFocus.y - 2.0) / 22.0, 0.0, 1.0);
  return 1.0 - exp(-dist * uHazeDensity * mix(1.2, 0.4, up) * (1.0 + 0.7 * sunward * sunward));
}
vec3 hazed(vec3 c, vec3 world) {
  return mix(c, airColour(normalize(world - cameraPosition)), mistBetween(world));
}
`;
