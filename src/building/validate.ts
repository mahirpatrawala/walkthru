// Building-level checks (SPEC 18.6): the scenes behind the spaces, the portals, the plates. Pure: scenes arrive through `scene`.
// Errors are things that break a walk or a drawing; warnings are things worth a look.
import { stampFurniture, rasterizeLayout } from '../core/layout-raster';
import { overlapAreaM2, validateLayout } from '../core/layout-validate';
import { boxCorners, pointInPolygon } from '../core/geometry';
import { polygonCentroid } from '../core/spawn';
import { nearestFree } from '../core/grid-query';
import type { PropertyFile } from '../types';
import { arrivalAtDoor, reachable } from './arrival';
import { doorFrame, dirToLevel, roomsOnLevel, toLevel } from './geom';
import type { BuildingFile, Space } from './types';

/** How far apart the two sides of one doorway may sit on the plan: both walls together, with a little to spare. */
export const DOOR_PAIR_TOL_M = 0.36;
/** Door widths on the two sides agree to this, metres. */
export const DOOR_WIDTH_TOL_M = 0.01;
/** Two spaces on a plan may overlap by this much (sliver rounding) before it is an error, m². */
export const PLATE_OVERLAP_TOL_M2 = 0.05;
/** Narrowest corridor, metres. */
export const MIN_CORRIDOR_M = 1.5;

export type SceneLookup = (sceneId: string) => PropertyFile | undefined;
export interface BuildingReport { errors: string[]; warnings: string[] }

/** The width of the narrowest part of a room (its smaller bounding side, which is right for the straight corridors here). */
function narrowM(p: PropertyFile['layout']['rooms'][number]): number {
  const xs = p.polygon.map((q) => q.x), zs = p.polygon.map((q) => q.z);
  return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
}

export function validateBuilding(b: BuildingFile, scene: SceneLookup): BuildingReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const props = new Map<string, PropertyFile>();
  const need = (s: Space): PropertyFile | undefined => {
    if (props.has(s.sceneId)) return props.get(s.sceneId);
    const p = scene(s.sceneId);
    if (!p) { errors.push(`Space "${s.id}": the scene "${s.sceneId}" is missing.`); return undefined; }
    props.set(s.sceneId, p);
    return p;
  };
  const byId = new Map<string, { space: Space; levelId: string }>();
  for (const l of b.levels) for (const s of l.spaces) byId.set(s.id, { space: s, levelId: l.id });

  // ---- every scene, on its own
  const checked = new Set<string>();
  for (const l of b.levels) for (const s of l.spaces) {
    const p = need(s);
    if (!p) continue;
    if (!checked.has(s.sceneId)) {
      checked.add(s.sceneId);
      for (const e of validateLayout(p.layout).errors) errors.push(`Scene "${s.sceneId}": ${e}`);
      if (b.sample && !/sample|synthetic/i.test(p.subtitle ?? '')) errors.push(`Scene "${s.sceneId}" belongs to a sample building but is not labelled as a sample (its subtitle should say "sample").`);
    }
    for (const portal of s.portals) {
      const o = p.layout.openings.find((q) => q.id === portal.opening);
      if (!o) errors.push(`Space "${s.id}", portal "${portal.id}": the scene has no opening "${portal.opening}".`);
      else if (o.type !== 'door') errors.push(`Space "${s.id}", portal "${portal.id}": opening "${portal.opening}" is a ${o.type}, not a door.`);
      else if (portal.kind === 'door' || portal.kind === 'outside') {
        if (o.widthM < 0.9) warnings.push(`Space "${s.id}", portal "${portal.id}": the door is ${o.widthM.toFixed(2)} m wide; a main door is usually 1.0 m.`);
      }
    }
  }

  // ---- lobby anchors: each marked position lies wholly inside a room of its lobby, and no two overlap
  for (const l of b.levels) for (const s of l.spaces) {
    const p = props.get(s.sceneId);
    if (!p || !s.lobbyAnchors) continue;
    const boxes = s.lobbyAnchors.map((a) => ({ a, box: { cx: a.at.x, cz: a.at.z, w: a.footprint.w, d: a.footprint.d, yawDeg: a.yawDeg } }));
    for (const { a, box } of boxes) {
      const inside = p.layout.rooms.some((r) => boxCorners(box).every((c) => pointInPolygon(c, r.polygon)));
      if (!inside) errors.push(`Space "${s.id}": the anchor "${a.id}" does not lie wholly inside a room.`);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      if (boxesOverlap(boxes[i].box, boxes[j].box)) errors.push(`Space "${s.id}": the anchors "${boxes[i].a.id}" and "${boxes[j].a.id}" overlap.`);
    }
  }

  // ---- portals pair up: same width, same place on the plan (same level), turned to face each other, hinged on the same side
  for (const [id, { space, levelId }] of byId) {
    const p = props.get(space.sceneId);
    if (!p) continue;
    for (const portal of space.portals) {
      if (portal.kind !== 'door') continue;
      const far = byId.get(portal.to.space);
      const q = far ? props.get(far.space.sceneId) : undefined;
      if (!far || !q) continue;
      const farPortal = far.space.portals.find((x) => x.id === portal.to.portal);
      if (!farPortal) continue;
      const a = p.layout.openings.find((o) => o.id === portal.opening);
      const c = q.layout.openings.find((o) => o.id === farPortal.opening);
      if (!a || !c) continue;
      if (Math.abs(a.widthM - c.widthM) > DOOR_WIDTH_TOL_M) errors.push(`Portal ${id}/${portal.id} and ${far.space.id}/${farPortal.id}: door widths differ (${a.widthM.toFixed(2)} m and ${c.widthM.toFixed(2)} m).`);
      if (Math.abs(a.headM - c.headM) > 0.15) warnings.push(`Portal ${id}/${portal.id} and ${far.space.id}/${farPortal.id}: door heights differ (${a.headM.toFixed(2)} m and ${c.headM.toFixed(2)} m).`);
      if (levelId !== far.levelId) continue; // a stair or walkway between levels has no shared plan
      const fa = doorFrame(p.layout, portal.opening), fc = doorFrame(q.layout, farPortal.opening);
      if (!fa || !fc) continue;
      const ca = toLevel(fa.centre, space.placement), cc = toLevel(fc.centre, far.space.placement);
      const gap = Math.hypot(ca.x - cc.x, ca.z - cc.z);
      if (gap > DOOR_PAIR_TOL_M) errors.push(`Portal ${id}/${portal.id} and ${far.space.id}/${farPortal.id}: the two doors are ${gap.toFixed(2)} m apart on the plan (at most ${DOOR_PAIR_TOL_M} m, the wall between).`);
      const oa = dirToLevel(fa.out, space.placement), oc = dirToLevel(fc.out, far.space.placement);
      if (oa.x * oc.x + oa.z * oc.z > -0.95) errors.push(`Portal ${id}/${portal.id} and ${far.space.id}/${farPortal.id}: the doors do not face each other.`);
      if (fa.hinge && fc.hinge) {
        const ha = toLevel(fa.hinge, space.placement), hc = toLevel(fc.hinge, far.space.placement);
        // the same physical hinge post, seen from either side: along the wall they coincide
        const along = { x: -oa.z, z: oa.x };
        const d = Math.abs((ha.x - hc.x) * along.x + (ha.z - hc.z) * along.z);
        if (d > 0.05) errors.push(`Portal ${id}/${portal.id} and ${far.space.id}/${farPortal.id}: the two sides of the door are hinged on opposite sides.`);
      }
    }
  }

  // ---- each plate: spaces on one level do not overlap, corridors are wide enough
  for (const l of b.levels) {
    const placed = l.spaces.map((s) => ({ s, rooms: props.has(s.sceneId) ? roomsOnLevel(props.get(s.sceneId)!.layout, s.placement) : [] }));
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      for (const ra of placed[i].rooms) for (const rb of placed[j].rooms) {
        const ov = overlapAreaM2(ra.polygon, rb.polygon);
        if (ov > PLATE_OVERLAP_TOL_M2) errors.push(`Level "${l.id}": ${placed[i].s.id} (${ra.label}) and ${placed[j].s.id} (${rb.label}) overlap by ${ov.toFixed(2)} m².`);
      }
    }
    for (const { s, rooms } of placed) {
      if (s.kind !== 'corridor') continue;
      for (const r of rooms) {
        if (r.roomType === 'other' && /corridor|passage/i.test(r.label) && narrowM(r) < MIN_CORRIDOR_M - 1e-6) errors.push(`Space "${s.id}": the corridor is only ${narrowM(r).toFixed(2)} m wide (at least ${MIN_CORRIDOR_M} m).`);
      }
    }
  }

  // ---- walking: from the first portal of a space, every other portal can be reached, and each landing exists
  for (const l of b.levels) for (const s of l.spaces) {
    const p = props.get(s.sceneId);
    if (!p || s.portals.length === 0) continue;
    const grid = stampFurniture(rasterizeLayout(p.layout), p.furniture);
    const landings = s.portals.map((portal) => ({ portal, at: arrivalAtDoor(p.layout, grid, portal.opening) }));
    for (const { portal, at } of landings) if (!at) errors.push(`Space "${s.id}", portal "${portal.id}": there is no clear spot to land just inside the door.`);
    // a home: every room (a balcony apart) can be walked to from the main door
    if (s.kind === 'home' && landings[0]?.at) {
      const rooms = p.layout.rooms.filter((r) => !r.partial && r.roomType !== 'balcony');
      const spots = rooms.map((r) => { const c0 = polygonCentroid(r.polygon); const c = pointInPolygon(c0, r.polygon) ? c0 : r.polygon[0]; return nearestFree(grid, c.x, c.z, 0.25, 1.2) ?? c; });
      reachable(grid, landings[0].at, spots).forEach((yes, i) => { if (!yes) errors.push(`Space "${s.id}": the room "${rooms[i].label}" cannot be walked to from the main door.`); });
    }
    const ok = landings.filter((x) => x.at);
    if (ok.length > 1) {
      const reach = reachable(grid, ok[0].at!, ok.slice(1).map((x) => x.at!));
      reach.forEach((r, i) => { if (!r) errors.push(`Space "${s.id}": the way from "${ok[0].portal.id}" to "${ok[i + 1].portal.id}" is blocked.`); });
    }
  }

  // ---- lifts
  for (const lift of b.lifts) {
    for (const lv of lift.serves) {
      const level = b.levels.find((x) => x.id === lv);
      if (!level) continue;
      for (const s of level.spaces) for (const portal of s.portals) {
        if (portal.kind !== 'lift' || portal.lift !== lift.id) continue;
        const o = props.get(s.sceneId)?.layout.openings.find((q) => q.id === portal.opening);
        if (o && Math.abs(o.widthM - lift.car.doorM) > DOOR_WIDTH_TOL_M) errors.push(`Lift "${lift.id}" on level "${lv}": the door is ${o.widthM.toFixed(2)} m but the car's door is ${lift.car.doorM.toFixed(2)} m.`);
      }
    }
  }

  // ---- the made-up label
  if (b.sample && !/sample/i.test(`${b.name} ${b.note}`)) warnings.push('A sample building should say "sample" in its name or note.');
  return { errors, warnings };
}

const boxesOverlap = (a: Parameters<typeof boxCorners>[0], b: Parameters<typeof boxCorners>[0]): boolean =>
  overlapAreaM2(boxCorners(a), boxCorners(b)) > 0.02;
