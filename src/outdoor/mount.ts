// Mounts an open-air space into the walk (SPEC 19): builds the ground, boundaries, roofs, facade, pools and plants from the scene's outdoor.json,
// follows the look's tier and hour, animates the water and the wind, and takes everything down again with the space (no leaks: SPEC 18.5).
import * as THREE from 'three';
import type { Layout } from '../types';
import type { Look } from '../look/look';
import type { Tier } from '../look/types';
import { disposeTree } from '../building/dispose';
import { buildStructure } from './build';
import { OutdoorMaterials } from './materials';
import { mountFoliage } from './foliage';
import type { FoliageHandle } from './foliage';
import { allHedges, plantsForTier } from './plants';
import { buildPools } from './pool-build';
import { mountPoolUi } from './pool-ui';
import type { PoolUi, PoolUiDeps } from './pool-ui';
import type { PoolBuild } from './pool-build';
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
  /** the depth pill, the walkway verdict and the depth card (a space with a pool only; null otherwise) */
  attachUi(deps: Pick<PoolUiDeps, 'host' | 'walker' | 'items' | 'onItemsChange' | 'block'>): PoolUi | null;
  readonly ui: PoolUi | null;
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
  // SPEC 16.24: at 2K the deck and paving take their 2K sets, the water mirrors the surroundings and swims, the rails are smooth
  let ultra = o.look?.ultra ?? false;
  mats.setUltra(ultra);
  const group = new THREE.Group();
  group.name = 'outdoor';
  const structure = buildStructure({ layout, file, mats, tier });
  group.add(structure.group);
  scene.add(group);

  // the plants: one instanced mesh a species, rebuilt when the tier changes (it sets how many cards a crown has and whether the wind blows)
  let plants: FoliageHandle | null = null;
  const growPlants = (): void => {
    if (plants) { plants.dispose(); plants = null; }
    plants = mountFoliage(plantsForTier(file, tier), [...allHedges(file), ...structure.hedges], tier, file.seed);
    group.add(plants.group);
  };
  growPlants();
  // the pools: the basin, its tile and the water; rebuilt with the tier (the water's detail is a tier setting)
  let pools: PoolBuild | null = null;
  const growPools = (): void => {
    if (pools) { pools.dispose(); pools = null; }
    if (file.pools.length === 0) return;
    pools = buildPools(file.pools, mats, tier, o.look, ultra);
    group.add(pools.group);
    pools.sync(o.look);
  };
  growPools();

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
    const u = o.look!.ultra;
    if (t !== tier) { tier = t; mats.setTier(t); growPlants(); growPools(); applyShadows(); }
    else if (u !== ultra) { ultra = u; mats.setUltra(u); growPools(); applyShadows(); }
    else pools?.sync(o.look);
  });

  let disposed = false;
  let ui: PoolUi | null = null;
  return {
    file, group,
    get ui() { return ui; },
    attachUi(deps) {
      if (file.pools.length === 0 || ui) return ui;
      ui = mountPoolUi({ ...deps, pools: file.pools, roofs: file.roofs, room: layout.rooms[0].polygon });
      return ui;
    },
    setTier(t) { tier = t; mats.setTier(t); growPlants(); growPools(); applyShadows(); },
    update(dt) { plants?.update(dt); pools?.update(dt); ui?.update(dt); },
    stats() { const c = countTriangles(group); return { triangles: Math.round(c.triangles), drawCalls: c.meshes, meshes: c.meshes, plants: plants?.counts.plants ?? 0, hedgeSegments: plants?.counts.hedges ?? 0, instancedMeshes: c.instanced }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      off?.();
      ui?.dispose();
      plants?.dispose();
      pools?.dispose();
      scene.remove(group);
      disposeTree(group);
      mats.dispose();
    },
  };
}
