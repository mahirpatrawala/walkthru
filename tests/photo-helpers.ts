// Test helpers for C12f: a tiny z-buffer renderer that draws the same walls and furniture boxes the app samples, so the size
// check can be run against believable frames under Node (no GL, no network). Not shipped.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { validateProperty } from '../src/core/layout-validate';
import { buildPhotoGeometry, cropToAspect, sampleView } from '../src/photo/geometry';
import type { CropRect, PhotoGeometry, Sampled } from '../src/photo/geometry';
import { lumaOf } from '../src/photo/edges';
import type { Gray } from '../src/photo/edges';
import type { PropertyFile } from '../src/types';

export function loadScene(id = 'test-flat'): PropertyFile {
  return validateProperty(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, `../public/scenes/${id}/property.json`), 'utf8')));
}

export function makeCamera(pos: [number, number, number], look: [number, number, number], aspect: number, fov = 60): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(fov, aspect, 0.05, 200);
  c.position.set(...pos);
  c.lookAt(...look);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}

const COLOURS: Record<string, [number, number, number]> = { wall: [226, 220, 208], floor: [176, 150, 120], ceiling: [240, 240, 236] };
function colourOf(group: string): [number, number, number] {
  if (COLOURS[group]) return COLOURS[group];
  let h = 0;
  for (const ch of group) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return [60 + (h % 150), 70 + ((h >> 8) % 120), 90 + ((h >> 16) % 120)];
}

/** Flat-shaded z-buffer render of the geometry plus each room's floor. */
export function renderFrame(geom: PhotoGeometry, prop: PropertyFile, camera: THREE.PerspectiveCamera, crop: CropRect, w: number, h: number): Uint8ClampedArray {
  const tris: { v: [number, number, number][]; group: string }[] = [];
  for (const s of geom.solids) for (let i = 0; i < s.tris.length; i += 9) {
    const t = s.tris;
    tris.push({ group: s.group, v: [[t[i], t[i + 1], t[i + 2]], [t[i + 3], t[i + 4], t[i + 5]], [t[i + 6], t[i + 7], t[i + 8]]] });
  }
  for (const r of prop.layout.rooms) {
    for (let k = 1; k + 1 < r.polygon.length; k++) {
      const p = (i: number): [number, number, number] => [r.polygon[i].x, 0, r.polygon[i].z];
      tris.push({ group: 'floor', v: [p(0), p(k), p(k + 1)] });
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < out.length; i += 4) { out[i] = 200; out[i + 1] = 214; out[i + 2] = 230; out[i + 3] = 255; }
  const zbuf = new Float32Array(w * h).fill(Infinity);
  camera.updateMatrixWorld(true);
  const view = camera.matrixWorldInverse;
  const proj = camera.projectionMatrix;
  const light = new THREE.Vector3(0.4, 0.8, 0.45).normalize();
  const tv = new THREE.Vector3();
  for (const tr of tris) {
    const cam = tr.v.map((p) => tv.set(...p).applyMatrix4(view).clone());
    if (cam.some((c) => c.z > -0.05)) continue; // anything crossing the near plane is skipped (the test views stay inside)
    const n = new THREE.Vector3().subVectors(new THREE.Vector3(...tr.v[1]), new THREE.Vector3(...tr.v[0])).cross(new THREE.Vector3().subVectors(new THREE.Vector3(...tr.v[2]), new THREE.Vector3(...tr.v[0]))).normalize();
    const shade = 0.55 + 0.45 * Math.abs(n.dot(light));
    const base = colourOf(tr.group);
    const scr = cam.map((c) => { const q = c.clone().applyMatrix4(proj); return { x: (((q.x + 1) / 2 - crop.u0) / crop.uw) * w, y: (((1 - q.y) / 2 - crop.v0) / crop.vh) * h, iz: 1 / -c.z }; });
    const minX = Math.max(0, Math.floor(Math.min(...scr.map((p) => p.x)))), maxX = Math.min(w - 1, Math.ceil(Math.max(...scr.map((p) => p.x))));
    const minY = Math.max(0, Math.floor(Math.min(...scr.map((p) => p.y)))), maxY = Math.min(h - 1, Math.ceil(Math.max(...scr.map((p) => p.y))));
    const [a, b, c] = scr;
    const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const l1 = ((b.y - c.y) * (x + 0.5 - c.x) + (c.x - b.x) * (y + 0.5 - c.y)) / den;
      const l2 = ((c.y - a.y) * (x + 0.5 - c.x) + (a.x - c.x) * (y + 0.5 - c.y)) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const z = 1 / (l1 * a.iz + l2 * b.iz + l3 * c.iz);
      const j = y * w + x;
      if (z >= zbuf[j]) continue;
      zbuf[j] = z;
      out[j * 4] = base[0] * shade; out[j * 4 + 1] = base[1] * shade; out[j * 4 + 2] = base[2] * shade;
    }
  }
  return out;
}

export interface TestView { prop: PropertyFile; geom: PhotoGeometry; camera: THREE.PerspectiveCamera; crop: CropRect; w: number; h: number; sampled: Sampled; rgba: Uint8ClampedArray; gray: Gray }

/** A 3:2 view from inside the bedroom of the test-flat scene, towards the bed and the sofa. */
export function makeView(opts: { pos?: [number, number, number]; look?: [number, number, number]; w?: number; h?: number; drop?: string[] } = {}): TestView {
  const prop = loadScene();
  const w = opts.w ?? 1024, h = opts.h ?? 683;
  const items = prop.furniture.filter((f) => !opts.drop?.includes(f.id));
  const geomFull = buildPhotoGeometry(prop.layout, prop.furniture);
  const camera = makeCamera(opts.pos ?? [2.9, 1.6, 0.5], opts.look ?? [1.9, 0.8, 3.0], w / h);
  const crop = cropToAspect(w, h, w / h);
  const sampled = sampleView(geomFull, camera, crop, w, h);
  const geomShown = buildPhotoGeometry(prop.layout, items);
  const rgba = renderFrame(geomShown, prop, camera, crop, w, h);
  return { prop, geom: geomFull, camera, crop, w, h, sampled, rgba, gray: lumaOf(rgba, w, h) };
}

/** Deterministic noise, so a test run does not depend on Math.random. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
