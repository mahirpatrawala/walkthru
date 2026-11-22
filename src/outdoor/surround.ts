// What lies under and beyond an open-air space that sits up on a building (SPEC 19.13, 22 Nov 2026). Before this, nothing was drawn past the
// space's edge: from the bridge of the pool wing the outside of the basins hung in the air over the cleared background, a flat grey slab under
// a white band. Now, when the file says how high the space is above the site (`aboveGroundM`, from the building's levels):
//   - the storeys under the space are a plain plastered face from every open edge down to the ground, with a slab edge at the deck (a bridge,
//     an area marked `bridge`, is a slab with a soffit, open under it);
//   - the site is a plain ground at that depth, drawn by the sky dome under the horizon (sky-dome.ts GROUND_GLSL: behind everything, so the
//     deck, the storeys and the planting always stand in front of it), mottled so it does not read as one colour, fading with distance into
//     the sky's own horizon haze. It is NOT the real site: no road, building, tree or lawn is drawn on it, and nothing on it is a fact
//     (honesty rule 16.2.4 stands).
// Everything here is decor: no ray of the walk hits it, nothing is measured on it.
import * as THREE from 'three';
import { computeEdgeFrames } from '../core/layout-geom';
import type { EdgeFrame, Layout, Vec2 } from '../types';
import type { Tier } from '../look/types';
import { mergeAndFree, segmentBox, flatGeometry } from './geo';
import type { OutdoorFile } from './types';

/** the depth of a bridge's slab and of the slab edge along the deck (typical, not a drawing) */
export const BRIDGE_SLAB_M = 0.5;
export const SLAB_EDGE_M = 0.35;
const PODIUM_PAINT = '#DDD0B8';
const SLAB_PAINT = '#EFE6D3';
const PLINTH_PAINT = '#9C978C';

const NOOP_RAY = (): void => {};

export interface SurroundSegment { a: Vec2; b: Vec2; kind: 'storeys' | 'bridge-edge' }

const dist2Seg = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x, dz = b.z - a.z, L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
};
/** segment s lies along segment t (both ends within 3 cm of it) */
const along = (s: { a: Vec2; b: Vec2 }, t: { a: Vec2; b: Vec2 }): boolean => dist2Seg(s.a, t.a, t.b) < 0.03 && dist2Seg(s.b, t.a, t.b) < 0.03;
const edgesOf = (poly: Vec2[]): { a: Vec2; b: Vec2 }[] => poly.map((a, i) => ({ a, b: poly[(i + 1) % poly.length] }));

/**
 * Which faces go down from the space (pure, tested): every edge of the room that is not on a bridge drops the storeys' face to the ground,
 * including the facade (the building goes down too); a room edge along a bridge is only the bridge's slab edge; the ends of a bridge that
 * are not on the room's edge (where it meets the wing) drop the storeys' face too, so nothing is open under the deck.
 */
export function surroundSegments(layout: Layout, file: OutdoorFile, frames: EdgeFrame[] = computeEdgeFrames(layout)): SurroundSegment[] {
  const bridges = file.areas.filter((a) => a.bridge);
  const bridgeEdges = bridges.flatMap((b) => edgesOf(b.polygon));
  const kindOf = new Map(file.boundary.map((b) => [`${b.room}:${b.edge}`, b.kind]));
  const out: SurroundSegment[] = [];
  for (const f of frames) {
    const seg = { a: f.a, b: f.b };
    const facade = kindOf.get(`${f.roomId}:${f.edge}`) === 'facade';
    out.push({ ...seg, kind: !facade && bridgeEdges.some((e) => along(seg, e)) ? 'bridge-edge' : 'storeys' });
  }
  for (const e of bridgeEdges) if (!frames.some((f) => along(e, { a: f.a, b: f.b }))) out.push({ ...e, kind: 'storeys' });
  return out;
}

/** how far under the deck the deepest basin goes (its floor and a slab under it): a ground any higher must leave the pools open */
export function basinBottomM(file: OutdoorFile): number {
  let d = 0;
  for (const p of file.pools) d = Math.max(d, p.waterBelowDeckM + Math.max(...p.profile.map((q) => q[1])) + 0.35);
  return d;
}

export interface SurroundBuild {
  readonly group: THREE.Group;
  dispose(): void;
}

/** null when the file does not say how high the space is (a space at ground level built before SPEC 19.13 keeps its look) */
export function buildSurround(layout: Layout, file: OutdoorFile, tier: Tier): SurroundBuild | null {
  const above = file.aboveGroundM;
  if (above === undefined) return null;
  const group = new THREE.Group();
  group.name = 'outdoor-surround';
  const disposables: { dispose(): void }[] = [];
  const groundY = -above - 0.02;
  const deep = basinBottomM(file);
  // the storeys are drawn only when the space really is up on them (deeper than its pools)
  const storeys = above > deep;
  const paint = (colour: string, name: string): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.95, metalness: 0, name });
    disposables.push(m);
    return m;
  };
  const tag = (m: THREE.Mesh, name: string, cast: boolean): THREE.Mesh => {
    m.name = name; m.userData.outdoor = name; m.userData.cast = cast; m.castShadow = cast && tier !== 'low'; m.receiveShadow = true; m.raycast = NOOP_RAY;
    return m;
  };
  if (storeys) {
    const frames = computeEdgeFrames(layout);
    const face: THREE.BufferGeometry[] = [], slab: THREE.BufferGeometry[] = [], plinth: THREE.BufferGeometry[] = [];
    const out = (s: SurroundSegment): Vec2 => {
      // outward normal of the segment: the room's edge frame where it is one, else away from the bridge's middle
      const f = frames.find((q) => along(s, { a: q.a, b: q.b }));
      if (f) return f.out;
      const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, L = Math.hypot(dx, dz) || 1;
      return { x: dz / L, z: -dx / L };
    };
    for (const s of surroundSegments(layout, file, frames)) {
      const n = out(s);
      const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
      // a little past each end so corners close
      const at = (u: number, o: number): Vec2 => ({ x: s.a.x + ux * u + n.x * o, z: s.a.z + uz * u + n.z * o });
      if (s.kind === 'storeys') {
        face.push(segmentBox(at(-0.1, 0.1), at(L + 0.1, 0.1), 0.2, groundY, -SLAB_EDGE_M + 0.001, 0, 1));
        slab.push(segmentBox(at(-0.12, 0.13), at(L + 0.12, 0.13), 0.26, -SLAB_EDGE_M, 0, 0, 1));
        plinth.push(segmentBox(at(-0.1, 0.12), at(L + 0.1, 0.12), 0.24, groundY, groundY + 0.3, 0, 1));
      } else {
        slab.push(segmentBox(at(-0.02, 0.1), at(L + 0.02, 0.1), 0.2, -BRIDGE_SLAB_M, 0, 0, 1));
      }
    }
    // a bridge's soffit, facing down
    for (const b of file.areas.filter((a) => a.bridge)) {
      const g = flatGeometry(b.polygon, undefined, -BRIDGE_SLAB_M, 1);
      const p = g.attributes.position as THREE.BufferAttribute, nr = g.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i += 3) { const x = p.getX(i + 1), z = p.getZ(i + 1); p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, x, -BRIDGE_SLAB_M, z); }
      for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, -1, 0);
      slab.push(g);
    }
    const add = (list: THREE.BufferGeometry[], mat: THREE.Material, name: string): void => {
      const g = mergeAndFree(list);
      if (!g) return;
      disposables.push(g);
      group.add(tag(new THREE.Mesh(g, mat), name, true));
    };
    add(face, paint(PODIUM_PAINT, 'outdoor-storeys'), 'surround:storeys');
    add(slab, paint(SLAB_PAINT, 'outdoor-slab-edge'), 'surround:slab-edge');
    add(plinth, paint(PLINTH_PAINT, 'outdoor-plinth'), 'surround:plinth');
  }

  return {
    group,
    dispose() { for (const d of disposables) d.dispose(); group.removeFromParent(); },
  };
}
