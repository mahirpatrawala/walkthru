// SPEC 16.13: giving baked UVs to meshes, by name. Pure three (no renderer, no DOM): the same code runs in the browser and in the tests.
import * as THREE from 'three';
import { positionChecksum } from './checksum';
import { meshPathKey } from './keys';
import type { BakedManifest, MeshEntry } from './types';

export interface BakedGeometry { u16: Uint16Array; u32: Uint32Array }

/** Splits a geometry.bin buffer the way manifest.geometry says. Throws when it is too short. */
export function parseGeometryBuffer(buf: ArrayBuffer, uvElements: number): BakedGeometry {
  const uvBytes = uvElements * 2;
  if (uvBytes > buf.byteLength) throw new Error('geometry.bin is shorter than the manifest says');
  const u32Start = Math.ceil(uvBytes / 4) * 4;
  const rest = buf.byteLength - u32Start;
  return { u16: new Uint16Array(buf, 0, uvElements), u32: new Uint32Array(buf.slice(u32Start, u32Start + rest - (rest % 4))) };
}

/** local-position checksum of a geometry, the function the page used when it dumped the scene */
export function geometryChecksum(geo: THREE.BufferGeometry): { count: number; checksum: number } {
  const p = geo.getAttribute('position');
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { a[i * 3] = p.getX(i); a[i * 3 + 1] = p.getY(i); a[i * 3 + 2] = p.getZ(i); }
  return { count: p.count, checksum: positionChecksum(a) };
}

/**
 * Gives `mesh` its second UV set `uv1` (normalised Uint16) when it is the mesh the entry was made for (same vertex count and checksum).
 * When the unwrap had to split vertices, the geometry is rebuilt with the copies appended and the new index. Positions of the source
 * vertices are never touched. Returns false (and changes nothing) when the mesh does not match.
 */
export function applyUv(mesh: THREE.Mesh, e: MeshEntry, g: BakedGeometry): boolean {
  const geo = mesh.geometry;
  if (!geo.getAttribute('position')) return false;
  const cs = geometryChecksum(geo);
  if (cs.count !== e.verts || cs.checksum !== e.checksum) return false;
  if (e.uvOffset + e.uvCount * 2 > g.u16.length) return false;
  const uv = g.u16.slice(e.uvOffset, e.uvOffset + e.uvCount * 2);
  if (e.remapOffset === undefined) {
    geo.setAttribute('uv1', new THREE.BufferAttribute(uv, 2, true));
    return true;
  }
  if (e.remapOffset + e.remapCount! > g.u32.length || e.indexOffset! + e.indexCount! > g.u32.length) return false;
  const src = g.u32.subarray(e.remapOffset, e.remapOffset + e.remapCount!);
  const index = g.u32.slice(e.indexOffset!, e.indexOffset! + e.indexCount!);
  const next = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute;
    const size = a.itemSize;
    const arr = new (a.array.constructor as new (n: number) => THREE.TypedArray)(e.uvCount * size);
    for (let i = 0; i < e.verts; i++) for (let k = 0; k < size; k++) arr[i * size + k] = a.getComponent(i, k);
    for (let j = 0; j < src.length; j++) for (let k = 0; k < size; k++) arr[(e.verts + j) * size + k] = a.getComponent(src[j], k);
    next.setAttribute(name, new THREE.BufferAttribute(arr, size, a.normalized));
  }
  next.setAttribute('uv1', new THREE.BufferAttribute(uv, 2, true));
  next.setIndex(new THREE.BufferAttribute(index, 1));
  next.computeBoundingBox();
  next.computeBoundingSphere();
  mesh.geometry = next;
  geo.dispose();
  return true;
}

export type AssignKind = 'static' | 'dyn' | 'probe';
export interface AssignResult { mesh: THREE.Mesh; key: string; kind: AssignKind }

/** The roots a bake covers: the shell and the kit (the room) and the furniture root (movable). */
export const BAKED_ROOTS = ['shell', 'kit', 'furniture'] as const;
/** movable roots: furniture, the design sheet's decor, door leaves (named `door:<id>`) */
export const isMovableRoot = (name: string): boolean => name === 'furniture' || name === 'design' || name.startsWith('door:');

/**
 * Walks the shell, the kit and the furniture root of `scene`, matching meshes to manifest entries by their stable key. `skip` lets the
 * caller pass over meshes it already handled. Returns what was assigned and the keys that matched by name but not by shape (rejected).
 */
export function assignByName(scene: THREE.Object3D, mf: BakedManifest, g: BakedGeometry, skip: (m: THREE.Mesh) => boolean = () => false): { assigned: AssignResult[]; rejected: string[] } {
  const assigned: AssignResult[] = [];
  const rejected: string[] = [];
  const walk = (obj: THREE.Object3D, chain: THREE.Object3D[], movableRoot: boolean): void => {
    const here = [...chain, obj];
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && !(obj as THREE.InstancedMesh).isInstancedMesh && !skip(mesh) && mesh.geometry.getAttribute('position')) {
      const key = meshPathKey(here);
      const e = mf.meshes[key];
      if (e) {
        if (applyUv(mesh, e, g)) assigned.push({ mesh, key, kind: e.atlas === 'static' ? 'static' : 'dyn' });
        else {
          rejected.push(key);
          if (e.atlas === 'dyn') assigned.push({ mesh, key, kind: 'probe' });
        }
      } else if (movableRoot || here.some((o) => o.name.startsWith('kit:bedhead'))) {
        assigned.push({ mesh, key, kind: 'probe' });
      }
    }
    for (const c of obj.children) walk(c, here, movableRoot);
  };
  for (const c of scene.children) if ((BAKED_ROOTS as readonly string[]).includes(c.name) || isMovableRoot(c.name)) walk(c, [scene], isMovableRoot(c.name));
  return { assigned, rejected };
}
