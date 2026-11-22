// Turns a parsed model template into meshes in an item's frame (SPEC 16.15): scaled to the size the home asks for, recoloured through the
// finish palette's roles, named by stable part names, plain geometry with normals and UVs (the GLB export and the baked lighting see
// ordinary MeshStandardMaterial meshes). Geometry is cloned per instance, so a piece can be disposed like any generated one.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Roles } from '../gen';
import { DEFS, patchDetail } from '../furniture-materials';
import type { FurnitureKit, MatKey } from '../furniture-materials';
import type { MatSpec } from '../gen';
import { modelInfo, pickRole } from './library';
import type { PartUse } from './library';
import type { Template } from './load';

/** finish kinds that are a plain colour (no grain or weave to keep): the model's own diffuse map goes, its normal map stays */
const FLAT: ReadonlySet<MatKey> = new Set<MatKey>(['laminate', 'gloss', 'paint', 'white', 'shutterWhite', 'dark', 'granite', 'brass', 'blackMetal', 'metal']);

/** finish kinds that are cloth: what an upholstered part (`PartUse.fabric`) may wear */
const FABRIC: ReadonlySet<MatKey> = new Set<MatKey>(['linen', 'sofa', 'headboard', 'pad', 'cover', 'cotton', 'weave', 'quilt', 'shag', 'drape', 'felt', 'vinyl']);

/** the first of `names` the roles define whose finish is a cloth, or null */
export function pickFabric(roles: Roles, names: string[] | undefined): MatSpec | null {
  for (const n of names ?? []) if (roles[n] && FABRIC.has(roles[n].key)) return roles[n];
  return null;
}

/**
 * Applies a finish (a kit material kind and a tint) to a model's material, the way `paintMaterial` does for a generated part: a wood or a
 * fabric keeps the model's own light and dark (grain, tufting, weave) as detail around the tint, a laminate or a metal is a plain colour with its
 * own roughness and metalness. Sets the same userData flags the generators' materials carry (`baseColor` for the verdict tint, `flatFinish`).
 */
export function applyFinishToModelMaterial(mat: THREE.MeshStandardMaterial, spec: { key: MatKey; tint?: string }, detailMean: number, detailCv = 0): void {
  const d = DEFS[spec.key];
  mat.color.set(spec.tint ?? d.color);
  if (FLAT.has(spec.key)) {
    mat.map = null;
    mat.roughnessMap = null;
    mat.roughness = d.roughness;
    mat.metalness = d.metalness;
    mat.userData.flatFinish = true;
  } else {
    mat.metalness = d.metalness;
    // a map that varies a lot around its mean (a mottled dark leather) shows less of it, so a pale tint does not look stained
    if (mat.map && detailMean > 0) patchDetail(mat, detailMean, detailCv > 0 ? Math.min(0.85, Math.max(0.2, 0.35 / detailCv)) : 0.85);
    else mat.userData.flatFinish = true;
    if (!mat.roughnessMap) mat.roughness = d.roughness;
  }
  mat.userData.baseColor = mat.color.getHex();
  mat.userData.finish = spec.key;
  mat.needsUpdate = true;
}

export interface Placement {
  x: number; y: number; z: number;
  /** degrees about +Y, applied after the scale */
  yawDeg: number;
  scale: { x: number; y: number; z: number };
}

export interface InstanceOpts {
  partUse: Record<string, PartUse>;
  roles?: Roles;
  /** rename the parts (the dining chairs take the generator's names) */
  nameOf?: (part: string) => string;
  /** decor: no ray can hit it */
  noRaycast?: boolean;
  /** several placements are merged into one mesh per part (chairs) instead of one mesh each */
  merge?: boolean;
  /** the furniture kit: an upholstered part (`PartUse.fabric`) wears the kit's own fabric material, maps and all */
  kit?: FurnitureKit;
}

const noRaycast: THREE.Object3D['raycast'] = () => { /* decor is never hit by a ray */ };

function matrixOf(p: Placement): THREE.Matrix4 {
  const s = new THREE.Matrix4().makeScale(p.scale.x, p.scale.y, p.scale.z);
  const r = new THREE.Matrix4().makeRotationY((p.yawDeg * Math.PI) / 180);
  const t = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z);
  return t.multiply(r).multiply(s);
}

/**
 * One group of meshes, one per part of the model (and, with `merge`, per part across all the placements). Every mesh carries
 * `userData.walkthruPart` (the part's name) and `userData.model` (the model id).
 */
export function instantiate(tpl: Template, placements: Placement[], opts: InstanceOpts): THREE.Group {
  const group = new THREE.Group();
  group.userData.model = tpl.id;
  const info = modelInfo(tpl.id);
  const make = (name: string, geometry: THREE.BufferGeometry, src: THREE.MeshStandardMaterial, partName: string): THREE.Mesh => {
    const use = opts.partUse[partName];
    const cloth = use?.fabric && opts.kit ? pickFabric(opts.roles ?? {}, use.role) : null;
    let mat: THREE.MeshStandardMaterial;
    if (cloth && opts.kit) {
      // upholstered with no maps of its own: the kit's fabric of the role's kind (weave and normal map on medium and high, the plain tint on a
      // phone), its UVs brought from the optimiser's metres-based units to the kind's tile
      mat = opts.kit.material(cloth.key, cloth.tint);
      const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
      const k = (info?.parts[partName]?.uvMetres ?? 0) / opts.kit.tile(cloth.key);
      if (uv && k > 0) { for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k); uv.needsUpdate = true; }
    } else {
      mat = src.clone();
      mat.userData = { ...src.userData };
      const spec = pickRole(opts.roles ?? {}, use?.role);
      if (spec) applyFinishToModelMaterial(mat, spec, info?.parts[partName]?.detailMean ?? 0, info?.parts[partName]?.detailCv ?? 0);
      else mat.userData.baseColor = mat.color.getHex();
    }
    mat.name = name;
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = name;
    mesh.userData.walkthruPart = name;
    mesh.userData.model = tpl.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (opts.noRaycast) mesh.raycast = noRaycast;
    if (opts.partUse[partName]?.bake === 'skip') mesh.userData.walkthruBake = 'skip';
    return mesh;
  };
  for (const part of tpl.parts) {
    const name = opts.nameOf?.(part.name) ?? part.name;
    const geos = placements.map((pl) => { const g = part.geometry.clone(); g.applyMatrix4(matrixOf(pl)); return g; });
    if (opts.merge && geos.length > 1) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (merged) group.add(make(name, merged, part.material, part.name));
    } else {
      geos.forEach((g, i) => { group.add(make(geos.length > 1 ? `${name}${i}` : name, g, part.material, part.name)); });
    }
  }
  return group;
}

/** Frees the geometry and materials of a group built by `instantiate` (textures are shared with the template and stay). */
export function disposeInstance(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) mat.dispose();
  });
}
