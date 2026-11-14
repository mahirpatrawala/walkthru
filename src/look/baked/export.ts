// SPEC 16.13 step 1: the SAME runtime three.js scene, as the app built it, dumped for the offline bake. Browser only, loaded on demand
// (`window.__walkthru.bake.exportScene()`), never part of a buyer's first load. The driver (scripts/bake-scene.ts) calls it in headless Chrome.
//
// What is dumped: every lit mesh of the shell, the kit and the furniture root, in world coordinates, with the stable key, the material's
// albedo (for bounce), emitters and a checksum of its LOCAL positions. What is not: the character, overlays, glass, veils, anything whose
// material writes no colour, instanced rotors, unlit (basic) materials.
import * as THREE from 'three';
import type { DumpMesh, SceneDump } from './types';
import { positionChecksum } from './checksum';
import { meshPathKey } from './keys';

const GLASS_NAMES = new Set(['panes', 'drawing-edge']);

export interface ExportInput {
  scene: THREE.Scene;
  sceneId: string;
  wallHeightM: number;
}

type Cls = 'static' | 'dyn' | null;

/** which atlas a mesh goes to: shell and kit are the room (static), the furniture root is movable (dyn), anything else is not baked */
export function classify(chain: THREE.Object3D[]): { cls: Cls; group?: string } {
  const names = chain.map((o) => o.name);
  const tag = chain.map((o) => o.userData?.walkthruBake as string | undefined).filter(Boolean);
  if (tag.includes('skip')) return { cls: null };
  const root = names[1] ?? ''; // chain[0] is the scene
  if (root === 'shell') return { cls: 'static' };
  if (root === 'kit') return { cls: names[2]?.startsWith('kit:bedhead') ? 'dyn' : 'static', group: names[2]?.startsWith('kit:bedhead') ? 'kit:bedheads' : undefined };
  if (root === 'furniture') {
    if (tag.includes('static')) return { cls: 'static' };
    return { cls: 'dyn', group: (names[2] === 'lived-in' ? names[3] : names[2]) || names[1] };
  }
  return { cls: null };
}

const toLinear = (c: THREE.Color): [number, number, number] => [c.r, c.g, c.b];

/** albedo for bounce: the material colour; a white material with a canvas map takes the map's mean (the shell's tile texture) */
function albedoOf(mat: THREE.MeshStandardMaterial): [number, number, number] {
  const c = mat.color.clone();
  const map = mat.map;
  const img = map?.image as CanvasImageSource | undefined;
  const nearWhite = c.r > 0.92 && c.g > 0.92 && c.b > 0.92;
  if (map && img && nearWhite && typeof document !== 'undefined' && (map as THREE.CanvasTexture).isCanvasTexture) {
    try {
      const cv = document.createElement('canvas');
      cv.width = 8; cv.height = 8;
      const g = cv.getContext('2d');
      if (g) {
        g.drawImage(img, 0, 0, 8, 8);
        const px = g.getImageData(0, 0, 8, 8).data;
        let r = 0, gg = 0, b = 0;
        for (let i = 0; i < px.length; i += 4) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; }
        const n = px.length / 4;
        const m = new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
        return toLinear(m);
      }
    } catch { /* tainted or unavailable: use the colour */ }
  }
  return toLinear(c);
}

function visibleUp(chain: THREE.Object3D[]): boolean {
  for (const o of chain) if (!o.visible) return false;
  return true;
}

export interface ExportResult { dump: SceneDump; bin: string }

/** Walks the scene. `bin` is base64 of the concatenated arrays; offsets in the dump are byte offsets into the decoded buffer. */
export function exportScene(input: ExportInput): ExportResult {
  const { scene } = input;
  scene.updateMatrixWorld(true);
  const meshes: DumpMesh[] = [];
  const chunks: ArrayBufferView[] = [];
  let offset = 0;
  const push = (a: Float32Array | Uint32Array): number => {
    const at = offset;
    chunks.push(a);
    offset += a.byteLength;
    return at;
  };
  const seen = new Set<string>();

  const walk = (o: THREE.Object3D, chain: THREE.Object3D[]): void => {
    const here = [...chain, o];
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) exportMesh(mesh, here);
    for (const c of o.children) walk(c, here);
  };

  function exportMesh(mesh: THREE.Mesh, chain: THREE.Object3D[]): void {
    const { cls, group } = classify(chain);
    if (!cls || !visibleUp(chain) || GLASS_NAMES.has(mesh.name)) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material | undefined;
    if (!mat || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
    const std = mat as THREE.MeshStandardMaterial;
    if (std.colorWrite === false || (std.transparent && std.opacity < 0.6) || std.userData?.partialLook) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    if (!pos || pos.count < 3) return;
    // local positions -> checksum, world positions -> dump
    const local = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { local[i * 3] = pos.getX(i); local[i * 3 + 1] = pos.getY(i); local[i * 3 + 2] = pos.getZ(i); }
    const idx = geo.getIndex();
    const key = meshPathKey(chain);
    if (seen.has(key)) return;
    seen.add(key);
    const world = new Float32Array(pos.count * 3);
    const nor = new Float32Array(pos.count * 3);
    const nattr = geo.getAttribute('normal');
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.set(local[i * 3], local[i * 3 + 1], local[i * 3 + 2]).applyMatrix4(mesh.matrixWorld);
      world[i * 3] = v.x; world[i * 3 + 1] = v.y; world[i * 3 + 2] = v.z;
      x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); z0 = Math.min(z0, v.z);
      x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); z1 = Math.max(z1, v.z);
      if (nattr) { v.set(nattr.getX(i), nattr.getY(i), nattr.getZ(i)).applyMatrix3(nm).normalize(); nor[i * 3] = v.x; nor[i * 3 + 1] = v.y; nor[i * 3 + 2] = v.z; }
    }
    const col = geo.getAttribute('color');
    let colOffset: number | undefined;
    if (col) {
      const c = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { c[i * 3] = col.getX(i); c[i * 3 + 1] = col.getY(i); c[i * 3 + 2] = col.getZ(i); }
      colOffset = push(c);
    }
    const lightKind = (mesh.userData.walkthruLight ?? chain.map((o) => o.userData?.walkthruLight).find(Boolean)) as DumpMesh['light'];
    const surface = ((): DumpMesh['surface'] => {
      const n = mesh.name;
      if (cls === 'dyn') return 'furniture';
      if (n.startsWith('floor:') || n.startsWith('threshold:')) return 'floor';
      if (n.startsWith('walls:') || n === 'railings' || n === 'frames') return 'wall';
      if (n.startsWith('ceiling:')) return 'ceiling';
      if (n.startsWith('kit:')) return 'kit';
      return 'other';
    })();
    const d: DumpMesh = {
      key, cls, verts: pos.count, tris: idx ? idx.count / 3 : pos.count / 3, indexed: !!idx,
      bbox: [x0, y0, z0, x1, y1, z1], checksum: positionChecksum(local), albedo: albedoOf(std), hasColors: !!col, surface,
      posOffset: push(world), norOffset: push(nor),
    };
    if (group) d.group = group;
    if (colOffset !== undefined) d.colOffset = colOffset;
    if (idx) {
      const ia = new Uint32Array(idx.count);
      for (let i = 0; i < idx.count; i++) ia[i] = idx.getX(i);
      d.idxOffset = push(ia);
    }
    if (lightKind) {
      d.light = lightKind;
      const e = std.emissive;
      d.emissive = e.r + e.g + e.b > 0.001 ? toLinear(e) : [1, 0.9, 0.7];
    }
    meshes.push(d);
  }

  for (const c of scene.children) walk(c, [scene]);

  const buf = new Uint8Array(offset);
  let at = 0;
  for (const ch of chunks) { buf.set(new Uint8Array(ch.buffer, ch.byteOffset, ch.byteLength), at); at += ch.byteLength; }
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const dump: SceneDump = { version: 1, sceneId: input.sceneId, wallHeightM: input.wallHeightM, meshes, exporter: `three r${THREE.REVISION}` };
  return { dump, bin: btoa(s) };
}
