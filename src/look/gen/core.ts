// Shared parts of the style generators (SPEC 16.13): the material spec, the quality of a tier, and `Parts`, the builder that
// buckets geometry by material and flushes one mesh per bucket, each tagged `userData.walkthruPart` (a stable name that the
// baked-lighting pipeline and the tests rely on). A generator is a pure function params -> THREE.Group in metres.
import * as THREE from 'three';
import type { Tier } from '../types';
import type { FurnitureKit, MatKey } from '../furniture-materials';
import { roundedBoxBetween } from '../furniture-parts';
import { boardOffset, chamferBox, frontUV, grainUV, mergeGeos } from './geo';
import type { Axis } from './geo';

/** a material kind with an optional tint (the finish's colour) */
export interface MatSpec { key: MatKey; tint?: string }
/** the named finishes a generator reads: `case`, `accent`, `top`, `fabric`, `handle`... filled by the pack, the sheet and the viewer */
export type Roles = Record<string, MatSpec>;

/** what a tier buys */
export interface GenQuality {
  tier: Tier;
  /** chamfered edges (44 triangles a box) instead of plain boxes */
  chamfer: boolean;
  /** metres of an edge chamfer on a large part */
  edge: number;
  /** radial segments of rods and round legs */
  sides: number;
  /** fluted strips are real ribs (otherwise a plain darker recess) */
  flutes: boolean;
  /** puffed cushion grid, 0 = a rounded box */
  puff: number;
  /** duvet and curtain grid density */
  cloth: number;
  /** louvre slats and wall slats are separate boxes (otherwise one panel with a few grooves) */
  slats: boolean;
  /** RoundedBoxGeometry segments for mattresses */
  seg: number;
  /** SPEC 16.24: the 2K level. Boxes with an edge radius are rounded (smooth, 300 triangles), not chamfered, and the generators add the fine parts (see gen/ultra.ts) */
  ultra?: boolean;
}
export const GEN_QUALITY: Record<Tier, GenQuality> = {
  low: { tier: 'low', chamfer: false, edge: 0.004, sides: 6, flutes: false, puff: 0, cloth: 8, slats: false, seg: 1 },
  medium: { tier: 'medium', chamfer: true, edge: 0.005, sides: 8, flutes: true, puff: 8, cloth: 20, slats: true, seg: 2 },
  high: { tier: 'high', chamfer: true, edge: 0.006, sides: 12, flutes: true, puff: 12, cloth: 32, slats: true, seg: 3 },
};

/** SPEC 16.24: segments of a welded soft pad (softCushion): 2 or 3 by tier, 4 at 2K (3,000 triangles a cushion, a rounded edge and a crown that shows) */
export const softSeg = (q: GenQuality): number => (q.ultra ? 4 : q.tier === 'high' ? 3 : 2);

export interface GenEnv { kit: FurnitureKit; q: GenQuality }

/** a generator's size input: the item's own numbers (the box and the heights), never invented */
export interface GenSize {
  w: number; d: number;
  /** total height */
  h: number;
  /** usable surface height (mattress top, seat, table top) */
  s: number;
  /** a mattress or cushion size the drawing gave */
  inner?: { w: number; d: number };
}

interface Bucket { name: string; mat: MatSpec; geos: THREE.BufferGeometry[]; grain: Axis; uv: 'world' | 'keep' | 'front'; tile?: number; shadow: boolean; double: boolean }

export interface PutOpts {
  /** the way a wood grain runs; default up and down */
  grain?: Axis;
  /** 'keep' leaves the geometry's own UVs (curtains, stripes mapped by hand); 'front' projects straight onto the xy plane (ribs, whose normals turn) */
  uv?: 'world' | 'keep' | 'front';
  /** metres per texture repeat, when it should not be the material's */
  tile?: number;
  /** does not cast a shadow (thin decor) */
  noShadow?: boolean;
  /** both faces are drawn (a thin shell) */
  double?: boolean;
}

export class Parts {
  readonly group = new THREE.Group();
  private readonly buckets = new Map<string, Bucket>();
  constructor(readonly env: GenEnv, name = '') { if (name) this.group.name = name; }

  /** adds a geometry to the bucket called `name` (one mesh per name and material) */
  put(name: string, mat: MatSpec, geo: THREE.BufferGeometry, o: PutOpts = {}): void {
    const key = `${name}|${mat.key}|${mat.tint ?? ''}|${o.grain ?? 'y'}|${o.uv ?? 'world'}|${o.tile ?? ''}|${o.double ? 'd' : ''}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { name, mat, geos: [], grain: o.grain ?? 'y', uv: o.uv ?? 'world', tile: o.tile, shadow: !o.noShadow, double: !!o.double }));
    b.geos.push(geo);
  }

  /** a box: chamfered when the tier allows it */
  box(name: string, mat: MatSpec, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, o: PutOpts & { c?: number } = {}): void {
    const c = o.c ?? this.env.q.edge;
    // 2K: an edge radius worth seeing (2.5 mm and up) is a real round-over with smooth normals, so a highlight rolls round the edge instead of snapping at a facet
    if (this.env.q.ultra && c >= 0.0025) {
      const r = Math.min(c * 1.15, Math.min(x1 - x0, y1 - y0, z1 - z0) / 2.2);
      if (r >= 0.0015) { this.put(name, mat, roundedBoxBetween(x0, x1, y0, y1, z0, z1, r, r > 0.006 ? 3 : 2), o); return; }
    }
    this.put(name, mat, boxGeo(x0, x1, y0, y1, z0, z1, this.env.q.chamfer ? c : 0), o);
  }

  /** flushes every bucket into a mesh on `group` and returns the group */
  done(): THREE.Group {
    for (const b of this.buckets.values()) {
      const tile = b.tile ?? this.env.kit.tile(b.mat.key);
      let geo: THREE.BufferGeometry;
      if (b.uv === 'world') { for (const g of b.geos) grainUV(g, tile, b.grain, boardOffset(g)); }
      else if (b.uv === 'front') { for (const g of b.geos) frontUV(g, tile); }
      geo = mergeGeos(b.geos);
      for (const g of b.geos) g.dispose();
      const material = this.env.kit.material(b.mat.key, b.mat.tint);
      if (b.double) material.side = THREE.DoubleSide;
      if (geo.attributes.color) material.vertexColors = true;
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = b.name;
      mesh.userData.walkthruPart = b.name;
      mesh.castShadow = b.shadow;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.buckets.clear();
    return this.group;
  }
}

/** a chamfered box or, with c = 0, a plain flat-shaded one */
export function boxGeo(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number): THREE.BufferGeometry {
  return chamferBox(x0, x1, y0, y1, z0, z1, c);
}

/** the spec for a role, falling back to another role, then to a plain default */
export function role(roles: Roles, name: string, ...fallbacks: string[]): MatSpec {
  for (const n of [name, ...fallbacks]) if (roles[n]) return roles[n];
  return { key: 'laminate', tint: '#CCCCCC' };
}

/** merges the children of `src` into `dst` (a generator builds into its own group, the caller fills the item's group) */
export function moveChildren(src: THREE.Object3D, dst: THREE.Object3D): void {
  for (const c of [...src.children]) dst.add(c);
}

/** the same material a little darker (or lighter) by factor `k` of its tint, for a recess, a shadow gap or an inner face */
export function shade(m: MatSpec, k: number): MatSpec {
  if (!m.tint) return m;
  const c = new THREE.Color(m.tint).multiplyScalar(k);
  return { key: m.key, tint: `#${c.getHexString()}` };
}

/** a role's spec, else `fallback` (a plain material: glass, chrome, ceramic) when no pack, sheet or viewer named one */
export function roleOr(roles: Roles, fallback: MatSpec, ...names: string[]): MatSpec {
  for (const n of names) if (roles[n]) return roles[n];
  return fallback;
}
