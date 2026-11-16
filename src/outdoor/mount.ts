// Mounts an open-air space into the walk (SPEC 19): builds the ground, boundaries, roofs, facade, pools and plants from the scene's outdoor.json,
// follows the look's tier and hour, animates the water and the wind, and takes everything down again with the space (no leaks: SPEC 18.5).
import * as THREE from 'three';
import type { Layout } from '../types';
import type { Look } from '../look/look';
import type { Tier } from '../look/types';
import { disposeTree } from '../building/dispose';
import { buildStructure } from './build';
import { OutdoorMaterials } from './materials';
import type { OutdoorFile } from './types';

export interface OutdoorStats { triangles: number; drawCalls: number; meshes: number; plants: number; hedgeSegments: number; instancedMeshes: number }

export interface OutdoorMount {
  readonly file: OutdoorFile;
  readonly group: THREE.Group;
  /** the tier the look is on changed: shadow flags, vegetation detail, water */
  setTier(tier: Tier): void;
  /** once a frame */
  update(dt: number): void;
  stats(): OutdoorStats;
  dispose(): void;
}

export interface MountOptions {
  scene: THREE.Scene;
  layout: Layout;
  file: OutdoorFile;
  look: Look | null;
  tier: Tier;
}

export function countTriangles(root: THREE.Object3D): { triangles: number; meshes: number; instanced: number } {
  let triangles = 0, meshes = 0, instanced = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const g = m.geometry;
    const per = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const n = (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1;
    triangles += per * n; meshes++; if ((o as THREE.InstancedMesh).isInstancedMesh) instanced++;
  });
  return { triangles, meshes, instanced };
}

export async function mountOutdoor(o: MountOptions): Promise<OutdoorMount> {
  const { scene, layout, file } = o;
  let tier = o.tier;
  const mats = new OutdoorMaterials(tier);
  const group = new THREE.Group();
  group.name = 'outdoor';
  const structure = buildStructure({ layout, file, mats, tier });
  group.add(structure.group);
  scene.add(group);

  const applyShadows = (): void => {
    const on = tier !== 'low';
    group.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = on && m.userData.outdoor !== undefined && m.userData.cast !== false && m.name !== 'ground' && !String(m.name).startsWith('ground:');
      m.receiveShadow = on || tier === 'low';
    });
  };
  applyShadows();
  const off = o.look?.onChange(() => {
    const t = o.look!.tier;
    if (t !== tier) { tier = t; mats.setTier(t); applyShadows(); }
  });

  let disposed = false;
  return {
    file, group,
    setTier(t) { tier = t; mats.setTier(t); applyShadows(); },
    update() { /* animation arrives with the water and the plants */ },
    stats() { const c = countTriangles(group); return { triangles: Math.round(c.triangles), drawCalls: c.meshes, meshes: c.meshes, plants: 0, hedgeSegments: structure.hedges.length, instancedMeshes: c.instanced }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      off?.();
      scene.remove(group);
      disposeTree(group);
      mats.dispose();
    },
  };
}
