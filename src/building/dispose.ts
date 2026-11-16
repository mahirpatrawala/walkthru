// Letting go of a scene graph: geometry, materials and every texture a material holds, then the root itself. The GPU copies are freed
// with the context when a space is taken down; this frees the CPU side and keeps `renderer.info` honest when only a part goes.
import type * as THREE from 'three';

export interface DisposeCounts { geometries: number; materials: number; textures: number }

export function disposeTree(root: THREE.Object3D): DisposeCounts {
  const seen = { g: new Set<unknown>(), m: new Set<unknown>(), t: new Set<unknown>() };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !seen.g.has(m.geometry)) { seen.g.add(m.geometry); m.geometry.dispose(); }
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      if (seen.m.has(mat)) continue;
      seen.m.add(mat);
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) {
        const t = v as THREE.Texture | undefined;
        if (t && t.isTexture && !seen.t.has(t)) { seen.t.add(t); t.dispose(); }
      }
      mat.dispose();
    }
    // a skinned mesh owns a skeleton and its bone texture
    const sk = (o as THREE.SkinnedMesh).skeleton;
    if (sk) sk.dispose();
  });
  root.removeFromParent();
  return { geometries: seen.g.size, materials: seen.m.size, textures: seen.t.size };
}
