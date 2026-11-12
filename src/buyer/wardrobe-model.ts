// The meshes of an openable wardrobe: shutters on hinge pivots (each rotates about its outer-edge hinge), and, for a wardrobe
// drawn on a sheet, the inside as page 4 dimensions it (boards, drawers, shelves, a hanger rail) behind them. Built in the item's
// frame (+Z front, +X right), so the group sits at the item's position with rotation.y = yaw like the furniture meshes do.
// Visual only: thickness, handle size and rail size are illustrative (the drawing gives none), and no calculation reads them.
import * as THREE from 'three';
import type { FurnitureItem } from '../types';
import { barBetween, boxBetween, mergeAll, worldUV } from '../look/furniture-parts';
import { furnitureKit } from '../look/furniture-materials';
import type { FurnitureKit, MatKey } from '../look/furniture-materials';
import type { WardrobeDesign } from '../look/furniture-real';
import type { OpenableZone } from '../look/designs';
import type { OpenSpec, Shutter } from './wardrobe-swing';

/** Visual slab thickness of a shutter, the same 18 mm the generic wardrobe look uses. Never used in a calculation. */
const SLAB_M = 0.018;
const GAP_M = 0.003;
/** The inside is set back from the front plane by the same 3 cm the generic carcass is. */
const FRONT_SETBACK_M = 0.03;
const CARCASS_TINT = '#CFC3B5';
const BACK_TINT = '#B3A593';
const GLASS_TINT = '#AEC3D1';
const HANDLE_LEN_M = 0.3;

/** Names of the meshes of the store's own wardrobe look that this model replaces (they are hidden while the model is in use). */
export const REPLACED_NAMES = /^(shutters|handles|drawer-fronts|carcass|shutter-wood|shutter-white|shutter-handles|seam)$/;

export interface WardrobeModel {
  group: THREE.Group;
  /** pivots by shutter id */
  pivot(id: string): THREE.Object3D | undefined;
  /** angle in radians, 0 closed */
  setAngle(id: string, rad: number): void;
  angle(id: string): number;
  /** the inside (drawn wardrobes only): shown while any shutter is open */
  setInteriorVisible(on: boolean): void;
  hasInterior: boolean;
  /** put the group where the item is */
  place(box: FurnitureItem['box']): void;
  meshes(): THREE.Mesh[];
  dispose(): void;
}

interface Parts {
  kit: FurnitureKit;
  group: THREE.Group;
  buckets: Map<string, { key: MatKey; tint?: string; geos: THREE.BufferGeometry[] }>;
}

function bucket(p: Parts, name: string, key: MatKey, geo: THREE.BufferGeometry, tint?: string): void {
  let b = p.buckets.get(name);
  if (!b) p.buckets.set(name, (b = { key, tint, geos: [] }));
  b.geos.push(geo);
}
function flush(p: Parts, into: THREE.Object3D): void {
  for (const [name, b] of p.buckets) {
    for (const g of b.geos) worldUV(g, p.kit.tile(b.key));
    const mesh = new THREE.Mesh(mergeAll(b.geos), p.kit.material(b.key, b.tint));
    mesh.name = name;
    into.add(mesh);
    for (const g of b.geos) g.dispose();
  }
  p.buckets.clear();
}

/** The inside of a drawn wardrobe, from page 4's zones (bottom to top, above the base gap). */
function buildInterior(item: FurnitureItem, spec: OpenSpec, wd: WardrobeDesign, kit: FurnitureKit): THREE.Group | null {
  const inn = spec.design?.interior;
  if (!inn || inn.zonesBottomUp.length !== spec.bays) return null;
  const { w, d } = item.box;
  const H = item.heightM;
  const y0 = wd.baseGapM;
  const zi = d / 2 - FRONT_SETBACK_M;
  const t = 0.018;
  const g = new THREE.Group();
  g.name = 'interior';
  const p: Parts = { kit, group: g, buckets: new Map() };
  const frontTint = wd.frontColor;
  // shell: back, side panels, partitions, top
  bucket(p, 'shell', 'shutterWhite', boxBetween(-w / 2, w / 2, y0, H, -d / 2, -d / 2 + t), BACK_TINT);
  const sp = inn.sidePanelM;
  bucket(p, 'shell-sides', 'shutterWhite', boxBetween(-w / 2, -w / 2 + sp, y0, H, -d / 2, zi), CARCASS_TINT);
  bucket(p, 'shell-sides', 'shutterWhite', boxBetween(w / 2 - sp, w / 2, y0, H, -d / 2, zi), CARCASS_TINT);
  bucket(p, 'shell-sides', 'shutterWhite', boxBetween(-w / 2, w / 2, H - t, H, -d / 2, zi), CARCASS_TINT);
  const rail: THREE.BufferGeometry[] = [];
  for (let b = 0; b < spec.bays; b++) {
    const x0 = -w / 2 + sp + b * (inn.bayClearM + inn.partitionM);
    const x1 = x0 + inn.bayClearM;
    if (b + 1 < spec.bays) bucket(p, 'shell-sides', 'shutterWhite', boxBetween(x1, x1 + inn.partitionM, y0, H, -d / 2, zi), CARCASS_TINT);
    let y = y0;
    for (const z of inn.zonesBottomUp[b]) {
      const y1 = Math.min(H - t, y + z.heightM);
      if (y1 <= y + 1e-4) break;
      zone(p, rail, z, x0, x1, y, y1, -d / 2 + t, zi, frontTint);
      y += z.heightM;
    }
  }
  if (rail.length) bucket(p, 'rail', 'metal', mergeAll(rail));
  flush(p, g);
  return g;
}

function zone(p: Parts, rail: THREE.BufferGeometry[], z: OpenableZone, x0: number, x1: number, y0: number, y1: number, zBack: number, zFront: number, frontTint: string): void {
  switch (z.kind) {
    case 'board':
      bucket(p, 'shell-sides', 'shutterWhite', boxBetween(x0, x1, y0, y1, zBack, zFront), CARCASS_TINT);
      break;
    case 'footwear-drawer':
      bucket(p, 'drawer-fronts', 'shutterWhite', boxBetween(x0 + GAP_M, x1 - GAP_M, y0 + GAP_M / 2, y1 - GAP_M / 2, zBack, zFront), frontTint);
      break;
    case 'glass-drawer':
      bucket(p, 'drawer-glass', 'white', boxBetween(x0 + 0.02, x1 - 0.02, y0 + GAP_M, y1 - GAP_M, zBack, zFront - 0.004), GLASS_TINT);
      break;
    case 'lockable-drawer': {
      const mid = (x0 + x1) / 2;
      bucket(p, 'drawer-fronts', 'shutterWhite', boxBetween(x0 + GAP_M, mid - GAP_M / 2, y0 + GAP_M / 2, y1 - GAP_M / 2, zBack, zFront), frontTint);
      bucket(p, 'drawer-fronts', 'shutterWhite', boxBetween(mid + GAP_M / 2, x1 - GAP_M, y0 + GAP_M / 2, y1 - GAP_M / 2, zBack, zFront), frontTint);
      break;
    }
    case 'hanging':
    case 'folded-shirts': {
      // a hanger rail near the top of the compartment (illustrative size)
      const ry = y1 - 0.06, rz = (zBack + zFront) / 2;
      rail.push(barBetween(x0, ry, rz, x1, ry, rz, 0.0125, 8));
      break;
    }
    default: break; // open shelf, gap: an empty compartment
  }
}

/** Builds the model: shutters at the spec's hinges, and the inside when the drawing gives it. */
export function buildWardrobeModel(item: FurnitureItem, spec: OpenSpec, wd: WardrobeDesign | null, kit: FurnitureKit = furnitureKit): WardrobeModel {
  const { d } = item.box;
  const H = item.heightM;
  const group = new THREE.Group();
  group.name = `openable:${item.id}`;
  group.userData.openableFor = item.id;
  const pivots = new Map<string, THREE.Group>();
  const angles = new Map<string, number>();
  const zFront = d / 2;

  const y0 = wd ? wd.baseGapM + Math.max(0, wd.drawerStripM) + (wd.drawerStripM > 0 ? GAP_M : 0) : 0.083;
  const top = H - GAP_M;
  const handleY = wd ? wd.handleYM : Math.min(1.05, H / 2);
  const handleLen = wd ? wd.handleLenM : HANDLE_LEN_M;

  const slabBucket = (s: Shutter, i: number): { key: MatKey; tint?: string } => {
    if (wd) return { key: 'shutterWhite', tint: wd.frontColor };
    return i % 2 === 0 ? { key: 'walnut' } : { key: 'shutterWhite' };
  };
  spec.shutters.forEach((s, i) => {
    const piv = new THREE.Group();
    piv.name = `shutter:${s.id}`;
    piv.position.set(s.hingeU, 0, zFront);
    // the slab, relative to the hinge: from just off the hinge to just short of the meeting edge, flush with the front plane
    const a = s.dir * GAP_M / 2, b = s.dir * (s.widthM - GAP_M / 2);
    const sb = slabBucket(s, i);
    const slab = boxBetween(Math.min(a, b), Math.max(a, b), y0, top, -SLAB_M, 0);
    worldUV(slab, kit.tile(sb.key));
    const mesh = new THREE.Mesh(slab, kit.material(sb.key, sb.tint));
    mesh.name = `shutter-slab:${s.id}`;
    piv.add(mesh);
    // the bar handle sits on the free (meeting) edge, 3.5 cm in
    const hx = s.dir * (s.widthM - GAP_M / 2 - 0.035);
    const bar = barBetween(hx, handleY - handleLen / 2, 0.012, hx, handleY + handleLen / 2, 0.012, 0.006, 8);
    worldUV(bar, 1);
    const hk: MatKey = wd ? 'dark' : 'metal';
    const hm = new THREE.Mesh(bar, kit.material(hk, wd ? wd.handleColor : undefined));
    hm.name = `shutter-handle:${s.id}`;
    piv.add(hm);
    group.add(piv);
    pivots.set(s.id, piv);
    angles.set(s.id, 0);
  });

  let interior: THREE.Group | null = null;
  if (wd) {
    interior = buildInterior(item, spec, wd, kit);
    if (interior) { interior.visible = false; group.add(interior); }
  }
  group.position.set(item.box.cx, 0, item.box.cz);
  group.rotation.y = (item.box.yawDeg * Math.PI) / 180;
  group.updateMatrixWorld(true);

  return {
    group,
    pivot: (id) => pivots.get(id),
    setAngle(id, rad) {
      const piv = pivots.get(id);
      const s = spec.shutters.find((x) => x.id === id);
      if (!piv || !s) return;
      angles.set(id, rad);
      piv.rotation.y = -s.dir * rad;
      piv.updateMatrixWorld(true);
    },
    angle: (id) => angles.get(id) ?? 0,
    setInteriorVisible(on) { if (interior) interior.visible = on; },
    hasInterior: !!interior,
    place(box) {
      group.position.set(box.cx, 0, box.cz);
      group.rotation.y = (box.yawDeg * Math.PI) / 180;
      group.updateMatrixWorld(true);
    },
    meshes() {
      const out: THREE.Mesh[] = [];
      group.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
      return out;
    },
    dispose() {
      group.removeFromParent();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) mat.dispose();
      });
    },
  };
}
