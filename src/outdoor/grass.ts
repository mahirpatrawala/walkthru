// Grass blades on the lawns (SPEC 19.12, 22 Nov 2026). A lawn seen from eye height is not a flat green: near the eye its blades stand up. This
// scatters small crossed cards carrying real grass tufts (CC0 Poly Haven grass_bermuda_01, cut by tools/optimise-outdoor-real.mjs) over every
// point where the top finish is lawn (not under a deck, a path, a bed or the water drawn over it), seeded so the same file always grows the
// same lawn, merged into ONE mesh (one draw call). Low tier: none (the textured lawn alone). Decor: no ray hits it, nothing walks on it.
import * as THREE from 'three';
import { pointInPolygon } from '../core/geometry';
import type { Tier } from '../look/types';
import type { AssetLoader } from '../look/assets';
import { rng } from './plants';
import { copingRects } from './pool';
import { GRASS_PATH, photoTexture } from './real';
import type { OutdoorFile, Vec2Like } from './types';

/** tufts per square metre of visible lawn, by tier */
export const GRASS_DENSITY: Record<Tier, number> = { low: 0, medium: 20, high: 32 };
/** a tuft: two crossed cards of this width and height (metres), scaled 0.7 to 1.3 */
export const TUFT_W = 0.21, TUFT_H = 0.13;
const TRIS_PER_TUFT = 4;

/** is the top finish at (x, z) a lawn, and not water, coping or a hole? */
export function lawnAt(file: OutdoorFile, x: number, z: number): boolean {
  const p = { x, z };
  let top: string | null = null;
  for (const a of file.areas) {
    if (!pointInPolygon(p, a.polygon as Vec2Like[] as { x: number; z: number }[])) continue;
    if ((a.holes ?? []).some((h) => pointInPolygon(p, h as { x: number; z: number }[]))) { top = null; continue; }
    top = a.finish;
  }
  if (top !== 'lawn') return false;
  for (const b of file.pools) {
    for (const r of [b.rect, ...copingRects(b)]) if (x > r.x0 - 0.05 && x < r.x1 + 0.05 && z > r.z0 - 0.05 && z < r.z1 + 0.05) return false;
  }
  return true;
}

/** where the tufts stand: a jittered grid over every lawn area, kept where the lawn is on top */
export function tuftSpots(file: OutdoorFile, tier: Tier): { x: number; z: number; s: number; yaw: number; k: number }[] {
  const d = GRASS_DENSITY[tier];
  if (d <= 0) return [];
  const step = 1 / Math.sqrt(d);
  const r = rng(file.seed * 131 + 17);
  const out: { x: number; z: number; s: number; yaw: number; k: number }[] = [];
  const done = new Set<string>();
  for (const a of file.areas) {
    if (a.finish !== 'lawn') continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const q of a.polygon) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
    for (let z = Math.floor(z0 / step) * step + step / 2; z < z1; z += step) for (let x = Math.floor(x0 / step) * step + step / 2; x < x1; x += step) {
      const key = `${Math.round(x / step)}|${Math.round(z / step)}`;
      if (done.has(key)) continue;
      done.add(key);
      const px = x + (r() - 0.5) * step * 0.9, pz = z + (r() - 0.5) * step * 0.9;
      const s = 0.7 + r() * 0.6, yaw = r() * Math.PI, k = Math.floor(r() * 4);
      if (lawnAt(file, px, pz)) out.push({ x: px, z: pz, s, yaw, k });
    }
  }
  return out;
}

export const grassTriangles = (file: OutdoorFile, tier: Tier): number => tuftSpots(file, tier).length * TRIS_PER_TUFT;

export interface GrassHandle { mesh: THREE.Mesh | null; tufts: number; update(dt: number): void; dispose(): void }

/** the blades: one merged mesh, a soft sway on medium and high, the tuft picture once it arrives (until then nothing is drawn: no painted stand-in) */
export function mountGrass(file: OutdoorFile, tier: Tier, loader: AssetLoader | null): GrassHandle {
  const spots = tuftSpots(file, tier);
  if (!spots.length) return { mesh: null, tufts: 0, update() {}, dispose() {} };
  const pos = new Float32Array(spots.length * 8 * 3), uv = new Float32Array(spots.length * 8 * 2), col = new Float32Array(spots.length * 8 * 3);
  const idx = new Uint32Array(spots.length * 12);
  const r = rng(file.seed * 7 + 3);
  spots.forEach((t, i) => {
    const w = TUFT_W * t.s, h = TUFT_H * t.s * (0.85 + r() * 0.3);
    // a little dry or a little lush, as a lawn is
    const g = 0.85 + r() * 0.3, dry = r() < 0.15 ? 0.12 : 0;
    for (let c = 0; c < 2; c++) {
      const a = t.yaw + c * (Math.PI / 2), dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
      const v = (i * 2 + c) * 4;
      const corners: [number, number, number][] = [[t.x - dx, 0, t.z - dz], [t.x + dx, 0, t.z + dz], [t.x + dx, h, t.z + dz], [t.x - dx, h, t.z - dz]];
      corners.forEach((p, j) => {
        pos.set(p, (v + j) * 3);
        uv.set([(t.k + (j === 1 || j === 2 ? 1 : 0)) / 4, j >= 2 ? 1 : 0], (v + j) * 2);
        // the foot of a blade is in the lawn's shade
        const sh = j >= 2 ? 1.05 : 0.72;
        col.set([g * sh * (1 + dry), g * sh, g * sh * (1 - dry * 2)], (v + j) * 3);
      });
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], (i * 2 + c) * 6);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  // blades lit like the lawn under them: normals up
  const nor = new Float32Array(pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.computeBoundingSphere();
  const clock = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({ color: '#C9D7A6', vertexColors: true, roughness: 0.9, alphaTest: 0.42, side: THREE.DoubleSide, transparent: false });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = clock;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  { float k = transformed.y / ${TUFT_H.toFixed(3)}; float ph = transformed.x * 1.7 + transformed.z * 1.3;
    transformed.x += sin(uTime * 1.9 + ph) * 0.012 * k * k; transformed.z += cos(uTime * 1.5 + ph) * 0.008 * k * k; }`);
    // a blade is lit as the lawn is, from either side (a double-sided card would turn its normal down on its back face and go black)
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize( vNormal );');
  };
  mat.customProgramCacheKey = () => 'ow-grass';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'outdoor-grass'; mesh.userData.outdoor = 'grass'; mesh.userData.cast = false;
  mesh.castShadow = false; mesh.receiveShadow = true; mesh.visible = false;
  mesh.raycast = () => {};
  let disposed = false;
  if (loader) {
    void photoTexture(loader, GRASS_PATH, true, 4).then((t) => {
      if (!t || disposed) return;
      t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
      mat.map = t; mat.needsUpdate = true; mesh.visible = true;
    });
  }
  return {
    mesh, tufts: spots.length,
    update(dt) { if (tier !== 'low') clock.value += dt; },
    dispose() { disposed = true; geo.dispose(); mat.map?.dispose(); mat.dispose(); mesh.removeFromParent(); },
  };
}
