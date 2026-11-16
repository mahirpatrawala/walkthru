// Owned by C11a. SPEC 16.5 "Materials": one cache of lit materials for the shell. The surface keeps its sampled mean colour:
// an albedo texture is never the colour, it only multiplies it by (texel / mean texel), clamped (rule 2 of 16.2).
import * as THREE from 'three';
import { makeTileTexture } from '../engine/shell';
import type { ShellMaterialSet } from '../engine/shell';
import type { AssetLoader } from './assets';
import type { AoField } from './floor-ao';
import type { TierConfig } from './quality';
import { GLSL_NOISE, GLSL_WOOD } from './procedural';
import { MAX_LAMP_POOLS, MAX_WINDOW_LIGHTS } from './daylight';

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
  /** SPEC 16.19: window light and downlight pools (the nearest few sources, set by look.ts); `winOn` 0 on low and in Plain and baked modes */
  winOn: Uniform<number>; winA: Uniform<THREE.Vector4[]>; winB: Uniform<THREE.Vector4[]>; winCol: Uniform<THREE.Color>;
  lampA: Uniform<THREE.Vector4[]>; lampCol: Uniform<THREE.Color>;
  /** 1 on tiers that draw the procedural fine detail (paint grain, tile speckle): medium and high */
  fine: Uniform<number>;
  /** 1 while a bake lights the room (SPEC 16.14): the wall-edge darkening steps back, the bake has the real corners */
  baked: Uniform<number>;
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
varying vec2 vLkUv;
LK_END_VERT
`;
const VERT_BODY = /* glsl */ `
vLkUv = uv;
LK_END_SET
vLkPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vLkN = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vLkPos;
varying vec3 vLkN;
varying vec2 vLkUv;
LK_END_FRAG
uniform float uLkMode;        // 0 floor (tile grid), 1 box-mapped (walls, ceilings), 2 the mesh's own UVs (frames: u runs along the grain)
uniform float uLkPaint;       // 1 on walls and ceilings: fine paint grain, relief and the ceiling shadow line (SPEC 16.18)
uniform float uLkWood;        // 1 on frames: procedural wood grain along the member (u of the UV is along the grain)
uniform vec3 uLkWallTile;     // wall tile width, height and the height the tile runs to (m); width 0 = painted wall
uniform vec3 uLkWallJoint;
float lkTileIn;
uniform float uLkWinOn;
uniform vec4 uLkWinA[6];   // window centre xyz, half width
uniform vec4 uLkWinB[6];   // inward normal x, z, half height, 1 when the slot is used
uniform vec3 uLkWinCol;
uniform vec4 uLkLampA[6]; // downlight xyz, 1 when used
uniform vec3 uLkLampCol;
// skylight from the nearest windows: an area source with a soft falloff, wrapped so a surface that faces away still gets a little bounce;
// only on the room side of the opening (SPEC 16.19). No sun is invented here.
vec3 lkDaylight(vec3 p, vec3 n, float floorK) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    if (uLkWinB[i].w < 0.5) continue;
    vec3 c = uLkWinA[i].xyz;
    vec3 wn = vec3(uLkWinB[i].x, 0.0, uLkWinB[i].y);
    vec3 v = c - p;
    float d2 = dot(v, v);
    vec3 L = v * inversesqrt(max(d2, 1e-4));
    float facing = smoothstep(0.02, 0.4, dot(-L, wn));
    float lam = clamp(dot(n, L) * 0.75 + 0.25, 0.0, 1.0);
    float area = uLkWinA[i].w * uLkWinB[i].z * 4.0;
    float fall = area / (d2 + 1.8 + 0.6 * area);
    float k = lam * facing * fall;
    if (floorK > 0.5) {
      // a soft bright patch of skylight on the floor in front of the opening, wider than the glass and fading over about 1.6 m
      vec2 rel = p.xz - (c.xz + wn.xz * c.y * 0.7);
      float across = dot(rel, vec2(-wn.z, wn.x));
      float along = dot(rel, wn.xz);
      float lkPatchK = smoothstep(uLkWinA[i].w * 1.5 + 0.35, uLkWinA[i].w * 0.3, abs(across)) * smoothstep(1.7, 0.1, abs(along - 0.3));
      k += 0.55 * lkPatchK * facing * clamp(area * 0.35, 0.1, 1.0);
    }
    acc += k;
  }
  return acc * uLkWinCol;
}
// the light pool under a recessed downlight: a soft cone down, in a room that has no window it is on by day too
vec3 lkLamps(vec3 p, vec3 n) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    if (uLkLampA[i].w < 0.5) continue;
    vec3 v = uLkLampA[i].xyz - p;
    float d2 = dot(v, v);
    vec3 L = v * inversesqrt(max(d2, 1e-4));
    float cone = smoothstep(0.2, 0.85, L.y);
    float lam = clamp(dot(n, L) * 0.8 + 0.2, 0.0, 1.0);
    acc += cone * lam / (d2 + 0.9);
  }
  return acc * uLkLampCol;
}
uniform float uLkPlank;       // 1 on a plank floor: rows along the grid axis, each row staggered at random, grain along the plank
uniform float uLkFine;        // 1 where the tier draws procedural fine detail (medium, high)
uniform float uLkKitBevel;    // strength of the bevel at a tile joint
uniform float uLkKitSpeck;    // strength of the fine speckle and cloud in the tile
uniform vec2 uLkTile;
uniform float uLkRepeat;      // metres per texture repeat for mode 1
uniform float uLkPlain;
uniform sampler2D uLkDetail; uniform float uLkDetailMean; uniform vec2 uLkDetailClamp; uniform float uLkDetailOn;
uniform sampler2D uLkNorm; uniform float uLkNormScale; uniform float uLkNormOn;
uniform sampler2D uLkRough; uniform vec2 uLkRoughRange; uniform float uLkRoughOn;
uniform sampler2D uLkAO; uniform vec4 uLkAORect; uniform float uLkAOOn;
uniform float uLkWallAOOn; uniform float uLkWallH; uniform float uLkBaked;
uniform float uLkKit; uniform vec2 uLkKitAxis; uniform vec2 uLkKitOrigin; uniform vec2 uLkKitTile; uniform float uLkKitGrout; uniform vec3 uLkKitGroutCol;
uniform float uLkKitVar; uniform float uLkKitRoughMin;
float lkGrout;
uniform float uLkReflMode; uniform samplerCube uLkCube; uniform sampler2D uLkPlanar;
uniform mat4 uLkReflVP; uniform vec2 uLkReflSize; uniform float uLkReflStrength; uniform float uLkReflOn;
vec2 lkUV; vec2 lkUVc; vec2 lkDx; vec2 lkDy;
${GLSL_NOISE}
${GLSL_WOOD}
// bump mapping from a height in metres (the same maths as three's perturbNormalArb, on the view-space normal)
vec3 lkBump(vec3 N, vec3 eye, float h) {
  vec3 q0 = dFdx(eye), q1 = dFdy(eye);
  vec3 r1 = cross(q1, N), r2 = cross(N, q0);
  float det = dot(q0, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * N - grad);
}
void lkSetup() {
  vec3 n = normalize(vLkN);
  vec3 an = abs(n);
  if (uLkMode < 0.5) {
    // floor: one tile of the grid is one print of the texture, a random quarter of it per tile
    lkUVc = vec2(vLkPos.x, -vLkPos.z) / uLkTile;
    if (uLkKit > 0.5) {
      // look-kit: the room's own tile grid, aligned to its longest wall and anchored at its corner (SPEC 16.5 floors)
      vec2 d = vLkPos.xz - uLkKitOrigin;
      vec2 lkPm0 = vec2(dot(d, uLkKitAxis), dot(d, vec2(-uLkKitAxis.y, uLkKitAxis.x)));
      lkUVc = lkPm0 / uLkKitTile;
      if (uLkPlank > 0.5) lkUVc.x += lkHash(vec2(floor(lkUVc.y), 4.7));   // each row of planks starts somewhere else along its length
    }
    vec2 id = floor(lkUVc);
    vec2 q = step(0.5, vec2(lkHash(id), lkHash(id + 7.3)));
    lkUV = fract(lkUVc) * 0.5 + 0.5 * q;
    lkDx = dFdx(lkUVc) * 0.5; lkDy = dFdy(lkUVc) * 0.5;
  } else if (uLkMode > 1.5) {
    lkUVc = vLkUv / uLkRepeat;
    lkUV = lkUVc;
    lkDx = dFdx(lkUVc); lkDy = dFdy(lkUVc);
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
if (uLkWood > 0.5 && uLkPlain < 0.5) {
  vec2 lkWg = lkUVc * uLkRepeat;
  diffuseColor.rgb *= lkWoodTone(lkWg, max(fwidth(lkWg.x), fwidth(lkWg.y)));
}
lkGrout = 0.0;
lkTileIn = 0.0;
if (uLkWallTile.x > 0.0 && uLkPlain < 0.5) {
  // a glazed wall tile with hairline joints, from the floor to the ceiling (SPEC 16.19): the same joint maths as the floor, in metres on the wall
  vec2 lkTs = uLkWallTile.xy;
  vec2 lkTc = (lkUVc * uLkRepeat) / lkTs;
  vec2 lkCw = fract(lkTc);
  vec2 lkFwt = max(fwidth(lkTc), vec2(1e-5));
  vec2 lkDw = min(lkCw, 1.0 - lkCw);
  vec2 lkRealT = vec2(0.001) / lkTs;
  vec2 lkHalfT = max(lkRealT, lkFwt * 0.55);
  vec2 lkMt = (1.0 - smoothstep(lkHalfT - lkFwt * 0.5, lkHalfT + lkFwt * 0.5, lkDw)) * max(lkRealT / lkHalfT, vec2(0.4));
  lkTileIn = 1.0 - smoothstep(uLkWallTile.z - 0.02, uLkWallTile.z, vLkPos.y);
  float lkJoint = max(lkMt.x, lkMt.y) * lkTileIn;
  diffuseColor.rgb *= 1.0 + (lkHash(floor(lkTc) + 5.3) - 0.5) * 0.04 * lkTileIn;
  diffuseColor.rgb = mix(diffuseColor.rgb, uLkWallJoint, lkJoint);
}
if (uLkKit > 0.5) {
  // a hairline joint: its real width (about 2 mm) where a pixel is narrower than that, and one pixel wide, but only as dark as the part of the pixel the joint
  // really covers, where a pixel is wider (so a joint never reads thicker or darker at a distance than it is)
  vec2 lkCell = fract(lkUVc);
  vec2 lkFw = max(fwidth(lkUVc), vec2(1e-5));
  vec2 lkDist = min(lkCell, 1.0 - lkCell);
  vec2 lkReal = vec2(uLkKitGrout * 0.5) / uLkKitTile;
  vec2 lkHalf = max(lkReal, lkFw * 0.55);
  vec2 lkM = (1.0 - smoothstep(lkHalf - lkFw * 0.5, lkHalf + lkFw * 0.5, lkDist)) * max(lkReal / lkHalf, vec2(0.4));
  lkGrout = max(lkM.x, lkM.y);
  if (uLkPlain < 0.5) {
    diffuseColor.rgb *= 1.0 + (lkHash(floor(lkUVc) + 3.1) - 0.5) * uLkKitVar;
    if (uLkPlank > 0.5) {
      // board to board: a warmer or greyer oak, and a faint grain along the board (computed in metres on the board, so it is sharp at any distance)
      vec2 lkPid = floor(lkUVc);
      float lkH1 = lkHash(lkPid + 8.1), lkH2 = lkHash(lkPid + 2.9);
      diffuseColor.rgb *= vec3(1.0 + (lkH1 - 0.5) * 0.07, 1.0 + (lkH1 - 0.5) * 0.045 - (lkH2 - 0.5) * 0.02, 1.0 - (lkH1 - 0.5) * 0.05 + (lkH2 - 0.5) * 0.04);
      vec2 lkG = vec2(fract(lkUVc.x) * uLkKitTile.x + lkH2 * 7.0, fract(lkUVc.y) * uLkKitTile.y);
      float lkWt = lkWoodTone(lkG, max(fwidth(lkG.x), fwidth(lkG.y)));
      diffuseColor.rgb *= mix(1.0, lkWt, 0.55);
    }
    if (uLkFine > 0.5 && uLkKitSpeck > 0.0) {
      // fine speckle and a soft cloud, in metres so it is the same size on every tile; faded where a pixel is wider than the grain
      float lkFade = 1.0 - smoothstep(0.0025, 0.009, max(fwidth(vLkPos.x), fwidth(vLkPos.z)));
      float lkSp = (lkVN(vLkPos.xz * 380.0) - 0.5) * 0.05 + (lkVN(vLkPos.xz * 70.0) - 0.5) * 0.035;
      float lkCl = (lkVN(lkUVc * 1.7 + floor(lkUVc) * 3.7) - 0.5) * 0.05;
      diffuseColor.rgb *= 1.0 + (lkSp * lkFade + lkCl) * uLkKitSpeck;
    }
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, uLkKitGroutCol, lkGrout);
}
if (uLkPaint > 0.5 && uLkPlain < 0.5 && uLkFine > 0.5) {
  // paint is not a flat fill: a faint grain at two sizes (metres, faded where a pixel is wider than the grain) and a slow drift of tone across the wall
  vec2 lkPm = lkUVc * uLkRepeat;
  float lkFade = 1.0 - smoothstep(0.0025, 0.01, max(fwidth(lkPm.x), fwidth(lkPm.y)));
  float lkG = ((lkVN(lkPm * 230.0) - 0.5) * 0.028 + (lkVN(lkPm * 36.0) - 0.5) * 0.022) * lkFade + (lkVN(lkPm * 0.9) - 0.5) * 0.03;
  diffuseColor.rgb *= 1.0 + lkG;
}
if (uLkWallAOOn > 0.5 && uLkPlain < 0.5) {
  // the shadow line where a wall meets the ceiling: an 11 mm dark gap and a soft cove of shade above 5 cm
  float lkW = max(fwidth(vLkPos.y) * 0.75, 1e-4);
  float lkTop = uLkWallH - vLkPos.y;
  float lkLn = 1.0 - smoothstep(0.011 - lkW, 0.011 + lkW, lkTop);
  float lkCove = 1.0 - smoothstep(0.0, 0.06, lkTop);
  diffuseColor.rgb *= 1.0 - 0.55 * lkLn - 0.07 * lkCove;
}
`;
const FRAG_ROUGH = /* glsl */ `
if (uLkRoughOn > 0.5 && uLkPlain < 0.5) {
  roughnessFactor = mix(uLkRoughRange.x, uLkRoughRange.y, textureGrad(uLkRough, lkUV, lkDx, lkDy).g);
}
if (uLkKit > 0.5 && uLkPlain < 0.5) roughnessFactor = mix(max(roughnessFactor, uLkKitRoughMin), 0.92, lkGrout);
if (uLkWallTile.x > 0.0 && uLkPlain < 0.5) roughnessFactor = mix(roughnessFactor, 0.26, lkTileIn);
`;
const FRAG_NORMAL = /* glsl */ `
if (uLkNormOn > 0.5 && uLkPlain < 0.5) {
  vec3 lkN = textureGrad(uLkNorm, lkUV, lkDx, lkDy).xyz * 2.0 - 1.0;
  lkN.xy *= uLkNormScale;
  normal = normalize(lkTBN(-vViewPosition, normal, lkUVc) * lkN);
}
if (uLkKit > 0.5 && uLkPlain < 0.5 && uLkKitBevel > 0.0) {
  // a 1.6 mm bevel at every joint: the normal tips towards the joint, so a glossy tile catches a fine highlight along each edge. Faded out where a pixel is wider than the bevel.
  const float lkBw = 0.0016;
  vec2 lkC = fract(lkUVc);
  vec2 lkEdgeM = min(lkC, 1.0 - lkC) * uLkKitTile;
  vec2 lkFwM = max(fwidth(lkUVc) * uLkKitTile, vec2(1e-5));
  vec2 lkB = (1.0 - smoothstep(0.0, lkBw, lkEdgeM)) * (1.0 - smoothstep(0.5, 1.4, lkFwM / lkBw));
  vec2 lkS = vec2(lkC.x < 0.5 ? -1.0 : 1.0, lkC.y < 0.5 ? -1.0 : 1.0);
  vec3 lkTu = vec3(uLkKitAxis.x, 0.0, uLkKitAxis.y), lkTv = vec3(-uLkKitAxis.y, 0.0, uLkKitAxis.x);
  vec3 lkD = (lkTu * lkS.x * lkB.x + lkTv * lkS.y * lkB.y) * uLkKitBevel;
  normal = normalize(normal + (viewMatrix * vec4(lkD, 0.0)).xyz);
}
if (uLkPaint > 0.5 && uLkPlain < 0.5 && uLkFine > 0.5) {
  vec2 lkPm2 = lkUVc * uLkRepeat;
  float lkF2 = 1.0 - smoothstep(0.0025, 0.01, max(fwidth(lkPm2.x), fwidth(lkPm2.y)));
  float lkH = (lkVN(lkPm2 * 160.0) * 0.6 + lkVN(lkPm2 * 42.0) * 0.4) * 0.0007 * lkF2;
  normal = lkBump(normal, -vViewPosition, lkH);
}
`;
const FRAG_AO = /* glsl */ `
{
  float lkAO = 1.0;
  if (uLkAOOn > 0.5 && uLkPlain < 0.5) lkAO *= texture(uLkAO, (vLkPos.xz - uLkAORect.xy) / uLkAORect.zw).r;
  if (uLkWallAOOn > 0.5 && uLkPlain < 0.5 && uLkBaked < 0.5) {
    // soft shade towards the floor, the ceiling and every room corner: the form of a room reads from this, with no texture at all
    lkAO *= mix(0.7, 1.0, smoothstep(0.0, 0.42, min(vLkPos.y, uLkWallH - vLkPos.y)));
    float lkCd = min(99.0 - vLkEnd.x, 99.0 - vLkEnd.y);
    lkAO *= mix(0.74, 1.0, smoothstep(0.0, 0.55, lkCd));
  }
  if (uLkWinOn > 0.5 && uLkPlain < 0.5 && uLkBaked < 0.5) {
    vec3 lkNw = normalize(vLkN);
    vec3 lkLit = lkDaylight(vLkPos, lkNw, uLkMode < 0.5 ? 1.0 : 0.0) + lkLamps(vLkPos, lkNw);
    reflectedLight.indirectDiffuse += lkLit * BRDF_Lambert(diffuseColor.rgb);
  }
  reflectedLight.indirectDiffuse *= lkAO;
  reflectedLight.indirectSpecular *= lkAO;
  if (uLkReflOn > 0.5 && uLkPlain < 0.5 && uLkReflMode > 0.5) {
    vec3 lkV = normalize(vViewPosition);
    float lkCos = clamp(dot(normal, lkV), 0.0, 1.0);
    float lkF = (0.04 + (0.55 - 0.04) * pow(1.0 - lkCos, 5.0)) * (1.0 - smoothstep(0.35, 0.75, roughnessFactor));
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
    // a floor reflects the light of the room, not the colour of the sky: the reflection is mostly desaturated, so a warm stone does not turn blue-grey
    lkRefl = mix(vec3(dot(lkRefl, vec3(0.2126, 0.7152, 0.0722))), lkRefl, 0.3);
    reflectedLight.indirectSpecular += lkRefl * lkF;
  }
}
`;

// ---------------------------------------------------------------- the cache

/** A room's own tile grid (look-kit, SPEC 16.5 floors). The grid axis u is a unit vector, the origin the room's bounding corner in that frame. */
export interface FloorKitSpec {
  color: string; groutColor: string;
  tileU: number; tileV: number; axisX: number; axisZ: number; originX: number; originZ: number;
  groutM: number; antiSkid: boolean; matt: boolean;
  /** a wood-look plank floor (SPEC 16.20) */
  plank?: boolean;
}

export interface LookMaterials extends ShellMaterialSet {
  readonly shared: SharedUniforms;
  /** plain = the SPEC 5 look (no detail, AO, gloss, reflections, glass): used while a scan is shown (rule 5) */
  setPlain(on: boolean): void;
  setFloorAO(f: AoField | null): void;
  setCeilingAO(f: AoField | null): void;
  /** SPEC 16.14: a bake lights the room, so the wall-edge darkening steps back */
  setBakedMode(on: boolean): void;
  setWallHeight(h: number): void;
  /** applies the tier's material settings; call after the tier or assets change */
  configure(cfg: TierConfig, opts: { trueColours: boolean }): void;
  /** loads the maps the tier needs. Resolves when they are applied. */
  loadTextures(loader: AssetLoader, cfg: TierConfig): Promise<void>;
  setReflection(mode: ReflectionMode, tex: { cube?: THREE.Texture | null; planar?: THREE.Texture | null }): void;
  /** a floor material with one room's tile grid: vitrified tiles with thin grout, aligned to the room's longest wall, never stretched */
  floorKit(spec: FloorKitSpec): THREE.Material;
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
    fine: { value: 0 },
    winOn: { value: 0 },
    winA: { value: Array.from({ length: MAX_WINDOW_LIGHTS }, () => new THREE.Vector4()) },
    winB: { value: Array.from({ length: MAX_WINDOW_LIGHTS }, () => new THREE.Vector4()) },
    winCol: { value: new THREE.Color(0, 0, 0) },
    lampA: { value: Array.from({ length: MAX_LAMP_POOLS }, () => new THREE.Vector4()) },
    lampCol: { value: new THREE.Color(0, 0, 0) },
    baked: { value: 0 },
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
      uLkMode: { value: kind === 'floor' ? 0 : kind === 'frame' ? 2 : 1 },
      uLkPaint: { value: kind === 'wall' || kind === 'ceiling' ? 1 : 0 }, uLkWood: { value: kind === 'frame' ? 1 : 0 }, uLkFine: shared.fine, uLkWinOn: shared.winOn, uLkWinA: shared.winA, uLkWinB: shared.winB, uLkWinCol: shared.winCol, uLkLampA: shared.lampA, uLkLampCol: shared.lampCol, uLkPlank: { value: 0 }, uLkKitBevel: { value: 0 }, uLkKitSpeck: { value: 0 }, uLkWallTile: { value: new THREE.Vector3(0, 0, 0) }, uLkWallJoint: { value: new THREE.Color('#999') },
      uLkTile: { value: new THREE.Vector2(0.6, 0.6) },
      uLkRepeat: { value: kind === 'frame' ? 0.6 : 1.6 },
      uLkPlain: shared.plain,
      uLkDetail: { value: white }, uLkDetailMean: { value: 1 }, uLkDetailClamp: { value: new THREE.Vector2(1, 1) }, uLkDetailOn: { value: 0 },
      uLkNorm: { value: flatNormal }, uLkNormScale: { value: 0.3 }, uLkNormOn: { value: 0 },
      uLkRough: { value: white }, uLkRoughRange: { value: new THREE.Vector2(0.1, 0.2) }, uLkRoughOn: { value: 0 },
      uLkAO: kind === 'ceiling' ? shared.ceilAO : shared.floorAO, uLkAORect: kind === 'ceiling' ? shared.ceilAORect : shared.floorAORect,
      uLkAOOn: { value: kind === 'floor' || kind === 'ceiling' ? 1 : 0 },
      uLkWallAOOn: { value: kind === 'wall' ? 1 : 0 }, uLkWallH: shared.wallH, uLkBaked: shared.baked,
      uLkReflMode: shared.reflMode, uLkCube: shared.cube, uLkPlanar: shared.planar,
      uLkKit: { value: 0 }, uLkKitAxis: { value: new THREE.Vector2(1, 0) }, uLkKitOrigin: { value: new THREE.Vector2(0, 0) }, uLkKitTile: { value: new THREE.Vector2(0.6, 0.6) },
      uLkKitGrout: { value: 0.0025 }, uLkKitGroutCol: { value: new THREE.Color('#9a9086') }, uLkKitVar: { value: 0.06 }, uLkKitRoughMin: { value: 0 },
      uLkReflVP: shared.reflVP, uLkReflSize: shared.reflSize, uLkReflStrength: shared.reflStrength,
      uLkReflOn: { value: kind === 'floor' && !balcony ? 1 : 0 },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      // walls carry `lkEnd` (shell.ts): how far each vertex is from a room corner, for the corner shading; every other surface has no corner
      const wallEnds = kind === 'wall';
      const vp = VERT_PARS.replace('LK_END_VERT', wallEnds ? 'attribute vec2 lkEnd;\nvarying vec2 vLkEnd;' : '');
      const vb = VERT_BODY.replace('LK_END_SET', wallEnds ? 'vLkEnd = lkEnd;' : '');
      const fp = FRAG_PARS.replace('LK_END_FRAG', wallEnds ? 'varying vec2 vLkEnd;' : 'const vec2 vLkEnd = vec2(0.0);');
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${vp}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${vb}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${fp}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG_MAP}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${FRAG_AO}`);
    };
    mat.customProgramCacheKey = () => 'walkthru-look-v6';
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
    floorKit(spec) {
      const key = `floorkit|${spec.plank ? 'plank|' : ''}${spec.color}|${spec.groutColor}|${spec.tileU}x${spec.tileV}|${spec.axisX.toFixed(4)},${spec.axisZ.toFixed(4)}|${spec.originX.toFixed(3)},${spec.originZ.toFixed(3)}|${spec.antiSkid}|${spec.matt}`;
      const had = byKey.has(key);
      const r = make('floor', key, { color: spec.color, roughness: spec.matt ? BALCONY_ROUGHNESS : FLOOR_ROUGHNESS_FLAT, metalness: 0 }, { roughness: 0.35, metalness: 0 }, spec.matt);
      if (!had) {
        set(r, 'uLkKit', 1);
        set(r, 'uLkPlank', spec.plank ? 1 : 0);
        set(r, 'uLkKitAxis', new THREE.Vector2(spec.axisX, spec.axisZ));
        set(r, 'uLkKitOrigin', new THREE.Vector2(spec.originX, spec.originZ));
        set(r, 'uLkKitTile', new THREE.Vector2(spec.tileU, spec.tileV));
        set(r, 'uLkKitGrout', spec.groutM);
        // the joint is the tile's own colour, a little deeper and a little towards the drawing's grout colour: a hairline you can see, not a dark rule
        set(r, 'uLkKitGroutCol', spec.plank ? new THREE.Color(spec.color).multiplyScalar(0.55) : new THREE.Color(spec.color).lerp(new THREE.Color(spec.groutColor), 0.3).multiplyScalar(0.62));
        if (!spec.matt) { set(r, 'uLkKitBevel', spec.antiSkid ? 0.35 : 0.9); set(r, 'uLkKitSpeck', spec.antiSkid ? 1.4 : 1); } else set(r, 'uLkKitSpeck', 1.6);
        set(r, 'uLkKitVar', spec.plank ? 0.05 : spec.antiSkid ? 0.12 : 0.06);
        set(r, 'uLkKitRoughMin', spec.plank ? 0.42 : spec.antiSkid ? 0.72 : spec.matt ? 0.6 : 0);
        // maps that arrived before this room's floor was made
        const donor = records.find((o) => o !== r && o.kind === 'floor' && o.u.uLkNormOn.value);
        if (donor) for (const k of ['uLkNorm', 'uLkNormScale', 'uLkNormOn', 'uLkDetail', 'uLkDetailMean', 'uLkDetailClamp', 'uLkDetailOn', 'uLkRough', 'uLkRoughRange', 'uLkRoughOn']) {
          if (k.startsWith('uLkRough') && spec.matt) continue;
          r.u[k].value = donor.u[k].value;
        }
        if (spec.antiSkid) r.look.metalness = 0;
        if (cfg) api.configure(cfg, { trueColours });
      }
      return r.mat;
    },
    wall(color, tile) {
      const key = `wall|${color}|${tile ? `${tile.wM}x${tile.hM}` : ''}`;
      const had = byKey.has(key);
      const r = make('wall', key, { color, roughness: tile ? 0.3 : 0.9, metalness: 0 }, { roughness: 0.9, metalness: 0 });
      if (!had && tile) {
        set(r, 'uLkWallTile', new THREE.Vector3(tile.wM, tile.hM, shared.wallH.value));
        set(r, 'uLkWallJoint', new THREE.Color(color).multiplyScalar(0.8));
      }
      return r.mat;
    },
    ceiling(color) {
      return make('ceiling', `ceiling|${color}`, { color, roughness: 0.9, metalness: 0 }, { roughness: 0.95, metalness: 0 }).mat;
    },
    frame(color, grain = true) {
      const had = byKey.has(`frame|${color}|${grain}`);
      const r = make('frame', `frame|${color}|${grain}`, { color, roughness: grain ? 0.55 : 0.5, metalness: 0 }, { roughness: 0.7, metalness: 0 });
      if (!had) set(r, 'uLkWood', grain ? 1 : 0);
      return r.mat;
    },
    railing(color) {
      return make('railing', `railing|${color}`, { color, roughness: 0.4, metalness: 0.2 }, { roughness: 0.6, metalness: 0 }).mat;
    },
    pane() {
      if (!paneMat) {
        // an unlit veil: lit glass reflects the environment (and the sun) as a bright smear that hides the view
        // frosted, bright glass (SPEC 16.18): the window glows with daylight and does not pretend to show a real view
        paneMat = new THREE.MeshBasicMaterial({ color: '#F7FAFD', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
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
    setBakedMode(on) { shared.baked.value = on ? 1 : 0; },
    setWallHeight(h) { shared.wallH.value = h; },
    configure(c, o) {
      cfg = c;
      trueColours = o.trueColours;
      shared.fine.value = c.fullTextures ? 1 : 0;
      for (const r of records) {
        if (r.kind === 'floor' && !r.balcony) r.look.roughness = r.u.uLkRoughOn.value ? 0.15 : FLOOR_ROUGHNESS_FLAT;
        // nearly matt: the plain sky gives a metal little to reflect, and a railing at metalness 0.6 (or 0.35) went black against the window
        if (r.kind === 'railing') { r.look.metalness = c.environment ? 0.12 : 0.1; r.look.roughness = 0.5; }
        if (r.map) r.map.anisotropy = c.anisotropy;
        // colour truth beats gloss: "True colours" shows no reflections
        r.u.uLkReflOn.value = r.kind === 'floor' && !r.balcony && !o.trueColours ? 1 : 0;
      }
      shared.reflStrength.value = c.reflection === 'cube' ? 1.3 : 0.9;
      api.setPlain(shared.plain.value > 0.5);
    },
    async loadTextures(_loader, c) {
      // SPEC 16.18: no photograph is stretched over the shell any more. The tile speckle, the paint grain and relief, the wood grain of the
      // frames and the tile bevel are computed in the shader, in metres, so they are as sharp at 30 cm as at 3 m, and the shell costs no
      // texture memory (the three tile maps, the three plaster maps and the three dark-wood maps are no longer fetched).
      if (cfg) api.configure(cfg, { trueColours });
      void c;
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
