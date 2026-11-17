// Real skinning of the shipped people for the cloth checks (SPEC 16.6.12): loads a body, retargets the clip library onto it, poses it at
// a clip time, and gives every part's skinned vertices in world space as plain arrays, plus a uniform-grid ray and nearest-surface query
// over a set of triangles. No browser and no Blender.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { retargetOnto } from '../../src/look/people';

export const CHAR_DIR = path.resolve(import.meta.dirname, '../../public/characters');
/** the people's own files: `PEOPLE_DIR` points the check at a directory of candidate builds (clips.glb always comes from the shipped directory) */
const PEOPLE_DIR = process.env.PEOPLE_DIR || CHAR_DIR;
export const BODIES = ['man', 'woman', 'elder', 'child'] as const;
export type Body = (typeof BODIES)[number];

export function parseGlb(file: string): Promise<GLTF> {
  const buf = fs.readFileSync(path.join(file === 'clips.glb' ? CHAR_DIR : PEOPLE_DIR, file));
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  l.register(() => ({ name: 'skip-textures', loadTexture: () => Promise.resolve(null) }) as never);
  return new Promise((res, rej) => l.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
}

export interface Part { name: string; mesh: THREE.SkinnedMesh; index: Uint32Array; n: number }
export interface Posed {
  gltf: GLTF;
  parts: Map<string, Part>;
  mixer: THREE.AnimationMixer;
  /** poses the body at `clip` (a library clip name) `t` seconds in; `null` leaves the bind pose */
  pose(clip: string | null, t?: number): void;
  /** world-space vertices of a part in the current pose, as a flat array */
  positions(part: string): Float32Array;
  /** the clips' lengths in seconds */
  duration(clip: string): number;
}

export async function loadPosed(body: Body, tier = ''): Promise<Posed> {
  const [src, gltf] = await Promise.all([parseGlb('clips.glb'), parseGlb(`person-${body}${tier}.glb`)]);
  retargetOnto(gltf, src);
  const parts = new Map<string, Part>();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const s = o as THREE.SkinnedMesh;
    if (!s.isSkinnedMesh) return;
    const idx = s.geometry.getIndex()!;
    parts.set(s.name, { name: s.name, mesh: s, index: Uint32Array.from(idx.array as ArrayLike<number>), n: s.geometry.getAttribute('position').count });
  });
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const v = new THREE.Vector3();
  const bind: { b: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.Bone).isBone) bind.push({ b: o, p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }); });
  return {
    gltf, parts, mixer,
    pose(clip, t = 0) {
      mixer.stopAllAction();
      for (const e of bind) { e.b.position.copy(e.p); e.b.quaternion.copy(e.q); e.b.scale.copy(e.s); }
      if (clip) {
        const c = gltf.animations.find((a) => a.name === clip);
        if (!c) throw new Error('no clip ' + clip);
        const a = mixer.clipAction(c); a.play(); a.time = t; mixer.setTime(0); a.time = t; mixer.update(0);
      }
      gltf.scene.updateMatrixWorld(true);
      for (const p of parts.values()) p.mesh.skeleton.update();
    },
    positions(part) {
      const p = parts.get(part)!;
      const out = new Float32Array(p.n * 3);
      for (let i = 0; i < p.n; i++) { p.mesh.getVertexPosition(i, v); v.applyMatrix4(p.mesh.matrixWorld); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
      return out;
    },
    duration(clip) { return gltf.animations.find((a) => a.name === clip)!.duration; },
  };
}

// ---------------------------------------------------------------- triangle soup with a uniform grid

export class Soup {
  readonly tris: number[] = [];   // vertex triples into `pos`
  private grid = new Map<number, number[]>();
  constructor(readonly pos: Float32Array, readonly cell = 0.04) {}
  add(index: ArrayLike<number>): void { for (let i = 0; i < index.length; i++) this.tris.push(index[i]); }
  build(): this {
    this.grid.clear();
    const { pos, cell } = this;
    for (let t = 0; t < this.tris.length; t += 3) {
      const a = this.tris[t] * 3, b = this.tris[t + 1] * 3, c = this.tris[t + 2] * 3;
      const lo = [0, 1, 2].map((k) => Math.floor(Math.min(pos[a + k], pos[b + k], pos[c + k]) / cell));
      const hi = [0, 1, 2].map((k) => Math.floor(Math.max(pos[a + k], pos[b + k], pos[c + k]) / cell));
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
        const key = Soup.key(x, y, z);
        let l = this.grid.get(key);
        if (!l) this.grid.set(key, (l = []));
        l.push(t);
      }
    }
    return this;
  }
  static key(x: number, y: number, z: number): number { return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512); }

  /** distance along the unit ray (o, d) to the nearest triangle within `max`, or Infinity (both faces count). Walks the grid cell by cell (Amanatides and Woo). */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
    const { pos, cell } = this;
    let best = Infinity;
    let ix = Math.floor(ox / cell), iy = Math.floor(oy / cell), iz = Math.floor(oz / cell);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(cell / dx) : Infinity, tdy = dy !== 0 ? Math.abs(cell / dy) : Infinity, tdz = dz !== 0 ? Math.abs(cell / dz) : Infinity;
    let tx = dx !== 0 ? ((dx > 0 ? ix + 1 : ix) * cell - ox) / dx : Infinity;
    let ty = dy !== 0 ? ((dy > 0 ? iy + 1 : iy) * cell - oy) / dy : Infinity;
    let tz = dz !== 0 ? ((dz > 0 ? iz + 1 : iz) * cell - oz) / dz : Infinity;
    const seen = new Set<number>();
    for (let guard = 0; guard < 4096; guard++) {
      const l = this.grid.get(Soup.key(ix, iy, iz));
      if (l) for (const t of l) {
        if (seen.has(t)) continue;
        seen.add(t);
        const a = this.tris[t] * 3, b = this.tris[t + 1] * 3, c = this.tris[t + 2] * 3;
        const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
        const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const tx0 = ox - pos[a], ty0 = oy - pos[a + 1], tz0 = oz - pos[a + 2];
        const u = (tx0 * px + ty0 * py + tz0 * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty0 * e1z - tz0 * e1y, qy = tz0 * e1x - tx0 * e1z, qz = tx0 * e1y - ty0 * e1x;
        const w = (dx * qx + dy * qy + dz * qz) * inv;
        if (w < 0 || u + w > 1) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist > 0 && dist < best) best = dist;
      }
      const tn = Math.min(tx, ty, tz);
      if (best <= tn || tn > max) break;
      if (tx <= ty && tx <= tz) { ix += sx; tx += tdx; } else if (ty <= tz) { iy += sy; ty += tdy; } else { iz += sz; tz += tdz; }
    }
    return best <= max ? best : Infinity;
  }

  /** the nearest point on the soup within `max` of p: [distance, nx, ny, nz of that triangle (unit), signed distance (positive on the side the normal faces)], or null */
  nearest(px: number, py: number, pz: number, max: number): [number, number, number, number, number] | null {
    const { pos, cell } = this;
    const r = Math.ceil(max / cell);
    const cx = Math.floor(px / cell), cy = Math.floor(py / cell), cz = Math.floor(pz / cell);
    let best = max * max, out: [number, number, number, number, number] | null = null;
    const seen = new Set<number>();
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
      const l = this.grid.get(Soup.key(x, y, z));
      if (!l) continue;
      for (const t of l) {
        if (seen.has(t)) continue;
        seen.add(t);
        const a = this.tris[t] * 3, b = this.tris[t + 1] * 3, c = this.tris[t + 2] * 3;
        const q = closest(px, py, pz, pos, a, b, c);
        if (q[0] < best) { best = q[0]; const dd = Math.sqrt(q[0]); out = [dd, q[1], q[2], q[3], (px - q[4]) * q[1] + (py - q[5]) * q[2] + (pz - q[6]) * q[3] >= 0 ? dd : -dd]; }
      }
    }
    return out;
  }
}

/** squared distance from p to triangle (a, b, c) and the triangle's unit normal (Ericson, Real-Time Collision Detection 5.1.5) */
function closest(px: number, py: number, pz: number, P: Float32Array, a: number, b: number, c: number): [number, number, number, number, number, number, number] {
  const abx = P[b] - P[a], aby = P[b + 1] - P[a + 1], abz = P[b + 2] - P[a + 2];
  const acx = P[c] - P[a], acy = P[c + 1] - P[a + 1], acz = P[c + 2] - P[a + 2];
  let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
  const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
  const apx = px - P[a], apy = py - P[a + 1], apz = pz - P[a + 2];
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx: number, qy: number, qz: number;
  const set = (u: number, v: number) => { qx = P[a] + abx * u + acx * v; qy = P[a + 1] + aby * u + acy * v; qz = P[a + 2] + abz * u + acz * v; };
  qx = qy = qz = 0;
  if (d1 <= 0 && d2 <= 0) set(0, 0);
  else {
    const bpx = px - P[b], bpy = py - P[b + 1], bpz = pz - P[b + 2];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) set(1, 0);
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) set(d1 / (d1 - d3), 0);
      else {
        const cpx = px - P[c], cpy = py - P[c + 1], cpz = pz - P[c + 2];
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) set(0, 1);
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) set(0, d2 / (d2 - d6));
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) set(1 - (d4 - d3) / (d4 - d3 + (d5 - d6)), (d4 - d3) / (d4 - d3 + (d5 - d6)));
            else { const dn = 1 / (va + vb + vc); set(vb * dn, vc * dn); }
          }
        }
      }
    }
  }
  const dx = px - qx!, dy = py - qy!, dz = pz - qz!;
  return [dx * dx + dy * dy + dz * dz, nx, ny, nz, qx!, qy!, qz!];
}

// ---------------------------------------------------------------- what the cloth covers

export const GARMENT_LAYERS = ['top', 'bottom', 'wrap', 'trim', 'shoes'] as const;

/** One soup of every garment part (and the shoes) in the current pose. */
export function garmentSoup(p: Posed, only: readonly string[] = GARMENT_LAYERS): Soup {
  const names = only.filter((n) => p.parts.has(n));
  let total = 0;
  for (const n of names) total += p.parts.get(n)!.n;
  const all = new Float32Array(total * 3);
  const idx: number[] = [];
  let off = 0;
  for (const n of names) { const pp = p.parts.get(n)!; all.set(p.positions(n), off * 3); for (const i of pp.index) idx.push(i + off); off += pp.n; }
  const s = new Soup(all);
  s.add(idx);
  return s.build();
}

export interface Cover {
  /** per skin triangle: 1 when cloth lies over it at this pose (a ray from its centre along its outward normal meets a garment within 2.5 cm) */
  cov: Uint8Array;
  /** per skin triangle: area in m2 in this pose */
  area: Float32Array;
  centre: Float32Array;
  normal: Float32Array;
}

export function skinCover(p: Posed, part = 'skin', outer: readonly string[] = GARMENT_LAYERS): Cover {
  const skin = p.parts.get(part)!;
  const sp = p.positions(part);
  const soup = garmentSoup(p, outer);
  const nt = skin.index.length / 3;
  const cov = new Uint8Array(nt), area = new Float32Array(nt), centre = new Float32Array(nt * 3), normal = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = skin.index[t * 3] * 3, b = skin.index[t * 3 + 1] * 3, c = skin.index[t * 3 + 2] * 3;
    const cx = (sp[a] + sp[b] + sp[c]) / 3, cy = (sp[a + 1] + sp[b + 1] + sp[c + 1]) / 3, cz = (sp[a + 2] + sp[b + 2] + sp[c + 2]) / 3;
    const e1x = sp[b] - sp[a], e1y = sp[b + 1] - sp[a + 1], e1z = sp[b + 2] - sp[a + 2];
    const e2x = sp[c] - sp[a], e2y = sp[c + 1] - sp[a + 1], e2z = sp[c + 2] - sp[a + 2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    area[t] = l / 2;
    nx /= l; ny /= l; nz /= l;
    centre.set([cx, cy, cz], t * 3);
    normal.set([nx, ny, nz], t * 3);
    cov[t] = soup.ray(cx + nx * 0.001, cy + ny * 0.001, cz + nz * 0.001, nx, ny, nz, 0.025) < Infinity ? 1 : 0;
  }
  return { cov, area, centre, normal };
}

/**
 * The part of `cov` that is well inside the cloth: triangles whose neighbours (through shared vertices), and theirs again, are all covered. Skin close to a
 * garment's edge (a cuff, the neck opening, the hem) is allowed to come and go as the cloth slides, a hole in the middle of a sleeve is not.
 */
export function interior(p: Posed, cov: Uint8Array, rings = 2, part = 'skin'): Uint8Array {
  const idx = p.parts.get(part)!.index;
  const nv = p.parts.get(part)!.n;
  let cur = Uint8Array.from(cov);
  for (let r = 0; r < rings; r++) {
    const vOk = new Uint8Array(nv).fill(1);
    for (let t = 0; t < cur.length; t++) if (!cur[t]) for (let k = 0; k < 3; k++) vOk[idx[t * 3 + k]] = 0;
    const next = new Uint8Array(cur.length);
    for (let t = 0; t < cur.length; t++) next[t] = cur[t] && vOk[idx[t * 3]] && vOk[idx[t * 3 + 1]] && vOk[idx[t * 3 + 2]] ? 1 : 0;
    cur = next;
  }
  return cur;
}

/**
 * The skin that has to stay hidden everywhere: what was well inside the cloth at the bind pose (`interior`, less the neck opening, 3 cm under the neck joint
 * and up), and the whole trunk (the skin driven by the spine, the pelvis and the collar bones) from 7 cm under the neck joint down, whether or not it happens to be covered in the bind pose itself (a hole that is
 * already there at rest must not count as "bare by design"). Call with the bind pose posed.
 */
export function mustCover(p: Posed, rest: Cover, rings = 1): Uint8Array {
  const skin = p.parts.get('skin')!;
  const bones = skin.mesh.skeleton.bones;
  const names = bones.map((b) => b.name);
  const neck = new THREE.Vector3().setFromMatrixPosition(bones[names.indexOf('neck_01')].matrixWorld).y;
  const si = skin.mesh.geometry.getAttribute('skinIndex'), sw = skin.mesh.geometry.getAttribute('skinWeight');
  const trunk = new Set(['spine_01', 'spine_02', 'spine_03', 'pelvis', 'clavicle_l', 'clavicle_r']);
  const dom = (i: number): string => { let bi = 0, bw = -1; for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > bw) { bw = sw.getComponent(i, k); bi = si.getComponent(i, k); } return names[bi]; };
  const out = interior(p, rest.cov, rings);
  for (let t = 0; t < out.length; t++) {
    if (trunk.has(dom(skin.index[t * 3])) && rest.centre[t * 3 + 1] < neck - 0.07) out[t] = 1;
    else if (rest.centre[t * 3 + 1] > neck - 0.03) out[t] = 0;       // the neck opening (an open collar, a round neck) shows what it shows when the head bends
  }
  return out;
}

/**
 * The trousers' own must-cover set: what the top covered well inside at the bind pose, and everything higher than 8 cm above the top's lowest hem (the
 * side vents of a kurti and a tunic are 4 to 7 cm and are open by design), and the middle of the front and the back from 1.2 cm above it, covered or not at bind. Call with the bind pose posed.
 */
export function mustCoverBottom(p: Posed, rest: Cover, rings = 1, strip = true): Uint8Array {
  const bottom = p.parts.get('bottom')!;
  const tp = p.positions('top');
  let hem = Infinity;
  for (let i = 1; i < tp.length; i += 3) hem = Math.min(hem, tp[i]);
  const out = interior(p, rest.cov, rings, 'bottom');
  // the middle of the front and the back (the vents are at the sides): trousers must not show through the top from 1.2 cm above the lowest hem, which is
  // where a trouser leg grown by the fit against a T-shirt that ends just below it came through as a row of teeth (the child's shorts, 16.6.12)
  let half = 0;
  for (let i = 0; i < tp.length; i += 3) if (tp[i + 1] < hem + 0.03) half = Math.max(half, Math.abs(tp[i]));
  for (let t = 0; t < out.length; t++) {
    const y = rest.centre[t * 3 + 1];
    if (y > hem + 0.08 || (strip && y > hem + 0.012 && Math.abs(rest.centre[t * 3]) < 0.6 * half)) out[t] = 1;
  }
  void bottom;
  return out;
}

/** The viewpoints the cloth is judged from, as [yaw degrees from behind the person (0 = directly behind, 180 = in front), distance m, elevation degrees]: the follow camera's own, close and above, and the sides and the front. */
export const VIEWS: [number, number, number][] = [[0, 0.9, 32], [35, 1.4, 18], [-35, 1.4, 18], [90, 1.6, 10], [-90, 1.6, 10], [180, 1.8, 16], [0, 3.5, 12]];

/**
 * Skin that is visible although it was under cloth at the bind pose: for every skin triangle that `rest` (the bind pose's `skinCover`) says was covered, a ray
 * from each viewpoint (aimed at the person's middle, the person facing +z) to the triangle's centre; the triangle is exposed from that view when it faces
 * the viewer and no garment is hit before it (a hole, a gap at the waist, skin standing out through a sleeve). Returns per triangle the number of
 * views it is exposed from, with the pose's cover.
 */
export function exposedSkin(p: Posed, rest: { cov: Uint8Array }, views = VIEWS, part = 'skin', outer: readonly string[] = GARMENT_LAYERS): { views: Uint8Array; now: Cover } {
  const now = skinCover(p, part, outer);
  const soup = garmentSoup(p, outer);
  const skinSoup = new Soup(p.positions(part));
  skinSoup.add(p.parts.get(part)!.index);
  skinSoup.build();
  const pel = p.parts.get('skin')!.mesh.skeleton.bones.find((b) => b.name === 'pelvis')!;
  const m = pel.matrixWorld.elements;
  const skinPos = p.positions('skin');
  let ymax = -Infinity, ymin = Infinity;
  for (let i = 1; i < skinPos.length; i += 3) { ymax = Math.max(ymax, skinPos[i]); ymin = Math.min(ymin, skinPos[i]); }
  const target = [m[12], ymin + (ymax - ymin) * 0.58, m[14]];
  const out = new Uint8Array(rest.cov.length);
  for (const [yaw, dist, elev] of views) {
    const a = (yaw * Math.PI) / 180, e = (elev * Math.PI) / 180;
    // behind the person is -z (the person faces +z)
    const cam = [target[0] + Math.sin(a) * dist * Math.cos(e), target[1] + dist * Math.sin(e), target[2] - Math.cos(a) * dist * Math.cos(e)];
    for (let t = 0; t < out.length; t++) {
      if (!rest.cov[t]) continue;
      const cx = now.centre[t * 3], cy = now.centre[t * 3 + 1], cz = now.centre[t * 3 + 2];
      let dx = cam[0] - cx, dy = cam[1] - cy, dz = cam[2] - cz;
      const dl = Math.hypot(dx, dy, dz);
      dx /= dl; dy /= dl; dz /= dl;
      if (dx * now.normal[t * 3] + dy * now.normal[t * 3 + 1] + dz * now.normal[t * 3 + 2] < 0.2) continue;     // faces away or grazes
      const ox = cx + dx * 0.0015, oy = cy + dy * 0.0015, oz = cz + dz * 0.0015;
      // the body hides itself too (an arm across the chest, the far side of a leaning back): only cloth or skin hit before the triangle counts as cover
      if (soup.ray(ox, oy, oz, dx, dy, dz, dl - 0.002) === Infinity && skinSoup.ray(ox, oy, oz, dx, dy, dz, dl - 0.002) === Infinity) out[t]++;
    }
  }
  return { views: out, now };
}
