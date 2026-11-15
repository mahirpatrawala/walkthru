// Owned by furnish-edit. The smallest way a chosen finish (src/look/finishes.ts) reaches today's furniture meshes: a colour swap on
// the parts of a built group, by part name. Nothing about a part's geometry changes. Safe to call on a group more than once, and
// on the openable wardrobe's own shutters (which replace the store mesh's shutter parts).
//
// `generators` rewrites the meshes and consumes `item.finish` itself; when a generated piece already applies its finish it can set
// `group.userData.finishApplied = true` and this pass leaves it alone.
import * as THREE from 'three';
import type { FurnitureItem } from '../types';
import { finishFamily, resolveFinish } from './finishes';
import type { FinishFamily, ResolvedFinish, Swatch } from './finishes';

type Role = 'primary' | 'secondary' | 'fabric' | 'bedding' | 'foldBand';

/** Part names of the real look, by role, per family. */
const ROLES: Record<FinishFamily, Array<[RegExp, Role]>> = {
  bed: [
    [/^(frame-lower|frame-upper|headboard-frame)$/, 'primary'],
    [/^headboard$/, 'fabric'],
    [/^bedcover$/, 'bedding'],
    [/^bedcover-fold$/, 'foldBand'],
  ],
  sofa: [
    [/^legs$/, 'primary'],
    [/^(frame|arm-left|arm-right|backrest|seat-cushion\d*|back-cushion\d*)$/, 'fabric'],
  ],
  wardrobe: [
    // the store's own shutters, and the openable model's slabs
    [/^(carcass|shutters|drawer-fronts|shutter-wood|shutter-white|loft-wood|loft-white|shutter-slab:.*)$/, 'primary'],
    [/^(handles|shutter-handles|loft-handles|shutter-handle:.*)$/, 'secondary'],
  ],
  table: [
    [/^(top)$/, 'primary'],
    [/^(legs|apron|side-panel|back-panel|pedestal|shelf|upstand|drawer-box|drawer-fronts|drawer-front|knobs|knob|chair\d+-wood)$/, 'secondary'],
    [/^chair\d+-pad$/, 'fabric'],
  ],
  // the second catalogue table is always drawn by the generators, which apply the finish themselves: no part names to recolour here
  swing: [], storage: [], appliance: [], pouf: [], bunk: [], plain: [], sanitary: [],
  chair: [
    [/^legs$/, 'primary'],
    [/^(frame|arm-left|arm-right|backrest|seat-cushion\d*|back-cushion\d*)$/, 'fabric'],
  ],
};

function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

function swatchFor(role: Role, r: ResolvedFinish, family: FinishFamily): Swatch | null {
  switch (role) {
    case 'primary': {
      // a bed's upholstered style wraps the whole frame in the headboard fabric; a panel bed carries its wood across the headboard
      if (family === 'bed' && r.style === 'upholstered' && r.fabric) return r.fabric;
      return r.primary ?? null;
    }
    case 'secondary': return r.secondary ?? null;
    case 'fabric': {
      if (family === 'bed' && r.style === 'panel' && (r.primary || !r.fabric)) return r.primary ?? null;
      return r.fabric ?? null;
    }
    case 'bedding': return r.secondary ?? null;
    case 'foldBand': return r.secondary ? { ...r.secondary, hex: shade(r.secondary.hex, 0.88) } : null;
  }
}

/** Sets a material to a swatch: colour, PBR hints and, for plain colours, no grain. Updates the tint baseline. */
export function paintMaterial(mat: THREE.MeshStandardMaterial, sw: Swatch): void {
  if (mat.userData.finishOriginal === undefined) {
    mat.userData.finishOriginal = { color: mat.color.getHex(), roughness: mat.roughness, metalness: mat.metalness };
  }
  mat.color.set(sw.hex);
  mat.userData.baseColor = mat.color.getHex();
  mat.roughness = sw.roughness;
  mat.metalness = sw.metalness;
  // a solid laminate or a metal is a plain colour: the wood grain stays only on woods; fabrics keep their weave (furniture-materials checks this flag)
  mat.userData.flatFinish = sw.group === 'laminate' || sw.group === 'metal';
  if (mat.userData.flatFinish && mat.map) { mat.map = null; mat.roughnessMap = null; mat.needsUpdate = true; }
}

/**
 * Applies `item.finish` to the parts of `group`. No finish, or a family with no choices, leaves the group as built.
 * Returns the number of parts recoloured (0 when there was nothing to do).
 */
export function applyFinish(group: THREE.Object3D, item: Pick<FurnitureItem, 'kind' | 'label' | 'catalogId' | 'finish' | 'box'>): number {
  if (!item.finish || group.userData.finishApplied) return 0;
  const family = finishFamily(item);
  if (!family) return 0;
  const resolved = resolveFinish(item.finish);
  if (!resolved.primary && !resolved.secondary && !resolved.fabric && !resolved.style) return 0;
  const rules = ROLES[family];
  let n = 0;
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const rule = rules.find(([re]) => re.test(mesh.name));
    if (!rule) return;
    const sw = swatchFor(rule[1], resolved, family);
    if (!sw) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (!std.color) continue;
      paintMaterial(std, sw);
      n += 1;
    }
  });
  return n;
}
