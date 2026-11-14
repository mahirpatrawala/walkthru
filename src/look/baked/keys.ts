// The stable key of a mesh (SPEC 16.13): the names from the scene root down, same-named siblings numbered. The page that exports the scene
// and the runtime that applies the bake both call this, so a baked picture finds its mesh by name, never by order of creation.
import type { Object3D } from 'three';
import { meshKeyOf } from './checksum';

/** `chain[0]` is the scene, the last item is the mesh itself. */
export function meshPathKey(chain: Object3D[]): string {
  const path: { name: string; sibling: number }[] = [];
  for (let i = 1; i < chain.length; i++) {
    const o = chain[i];
    const parent = chain[i - 1];
    let sibling = 0;
    for (const c of parent.children) { if (c === o) break; if (c.name === o.name) sibling++; }
    path.push({ name: o.name || o.type, sibling });
  }
  return meshKeyOf(path);
}
