// Portals in the world: the doors that lead to another space, a lift, the stairs. In front of one the prompt pill says where it goes
// ("Enter Flat 302", "To the corridor", "Call lift"); E, a tap on the pill or a tap on the door itself goes through. They sit in front of
// the ordinary "Open door" prompt (src/buyer/door-hooks.ts). The door leaf stays solid: a portal is crossed by the prompt, not by walking
// through a wall, and the walk grid is untouched.
import * as THREE from 'three';
import { GRID_TALL_CM } from '../types';
import type { Grid, Layout, Vec2 } from '../types';
import { cellValue } from '../core/grid-codec';
import { distanceToSegment } from '../core/geometry';
import { computeEdgeFrames } from '../core/layout-geom';
import { setPortalPrompts } from '../buyer/door-hooks';
import type { PointerEvt } from '../engine/controls';
import type { MountedSpace } from './space-host';
import { doorFrame } from './geom';
import type { DoorFrame } from './geom';
import { portalPrompt } from './portal-looks';
import type { Portal } from './types';

/** The pill shows within this distance of the doorway, metres (a little more than an ordinary door). */
export const PORTAL_REACH_M = 1.4;
/** A tap on a portal door works from this far. */
export const PORTAL_TAP_M = 3.2;

interface Live { portal: Portal; frame: DoorFrame; a: Vec2; b: Vec2 }

export interface PortalHandle {
  dispose(): void;
  /** for tests and debugging: the portal the walker could use now */
  nearest(): Portal | null;
  /** A tap in the walk: true when it landed on a portal door (nothing nearer in front of it), which it then uses. The walk asks this before its tap-to-select. */
  tap(e: PointerEvt): boolean;
}

export function mountPortals(m: MountedSpace, portals: Portal[], go: (p: Portal) => void): PortalHandle {
  const layout: Layout = m.layout;
  const frames = computeEdgeFrames(layout);
  const live: Live[] = [];
  for (const p of portals) {
    const f = doorFrame(layout, p.opening, frames);
    if (!f) { console.warn(`[walkthru] portal "${p.id}": no opening "${p.opening}" in this scene`); continue; }
    const half = f.widthM / 2;
    live.push({ portal: p, frame: f, a: { x: f.centre.x - f.dir.x * half, z: f.centre.z - f.dir.z * half }, b: { x: f.centre.x + f.dir.x * half, z: f.centre.z + f.dir.z * half } });
  }

  // the walk grid without the door leaves, kept until the furniture changes (the store re-stamps temporary obstacles, so this is rebuilt rarely)
  const store = m.ctx.furniture as { gridExcludingTemporary?: (keys: string[]) => Grid; onChange(cb: () => void): () => void };
  let sight: Grid | null = null;
  const offStore = store.onChange(() => { sight = null; });
  const sightGrid = (): Grid => (sight ??= store.gridExcludingTemporary ? store.gridExcludingTemporary(['doors']) : m.ctx.grid());

  /** The doorway is in view: no wall between the walker and the nearest point of it (it stops short of the leaf's own cells). */
  function inSight(l: Live, p: Vec2): boolean {
    const ux = l.b.x - l.a.x, uz = l.b.z - l.a.z;
    const L2 = ux * ux + uz * uz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - l.a.x) * ux + (p.z - l.a.z) * uz) / L2));
    const q = { x: l.a.x + ux * t, z: l.a.z + uz * t };
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len <= 0.15) return true;
    // an open door leaf stands in the way of the doorway it hangs in: it is not a wall, so it does not hide the doorway
    const g = sightGrid();
    for (let s = 0; s < len - 0.1; s += g.cellM / 2) {
      if (cellValue(g, p.x + ((q.x - p.x) * s) / len, p.z + ((q.z - p.z) * s) / len) >= GRID_TALL_CM) return false;
    }
    return true;
  }
  /** Which doorway the walker means: the nearest, but one behind them counts for less (in a corridor two doors face each other across a metre). */
  function nearestLive(p: Vec2, reach = PORTAL_REACH_M): { l: Live; distM: number } | null {
    const yaw = (m.ctx.character.yawDeg * Math.PI) / 180;
    const heading = { x: Math.sin(yaw), z: Math.cos(yaw) };
    let best: { l: Live; distM: number; score: number } | null = null;
    for (const l of live) {
      const distM = distanceToSegment(p, l.a, l.b);
      if (distM > reach) continue;
      // on the room's side of the doorway
      if ((p.x - l.frame.centre.x) * l.frame.out.x + (p.z - l.frame.centre.z) * l.frame.out.z > 0.2) continue;
      const to = { x: l.frame.centre.x - p.x, z: l.frame.centre.z - p.z };
      const len = Math.hypot(to.x, to.z) || 1;
      const facing = (to.x * heading.x + to.z * heading.z) / len;
      const score = distM + (facing < 0 ? 2 : facing < 0.5 ? 0.5 : 0);
      if (best && score >= best.score) continue;
      if (!inSight(l, p)) continue;
      best = { l, distM, score };
    }
    return best;
  }

  setPortalPrompts({
    nearest(p) {
      const n = nearestLive(p);
      return n ? { distM: n.distM, prompt: portalPrompt(n.l.portal) } : null;
    },
    activate(p) {
      const n = nearestLive(p);
      if (!n) return false;
      go(n.l.portal);
      return true;
    },
  });

  // a tap on the door itself
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const at = new THREE.Vector3();
  /** Distance along the tap's ray to the doorway's own rectangle (mid-wall, jamb to jamb, floor to head), or null. */
  function doorwayHit(l: Live): number | null {
    const f = l.frame;
    plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(f.out.x, 0, f.out.z), new THREE.Vector3(f.centre.x + f.out.x * f.thicknessM / 2, 0, f.centre.z + f.out.z * f.thicknessM / 2));
    if (!ray.ray.intersectPlane(plane, at)) return null;
    const along = (at.x - f.centre.x) * f.dir.x + (at.z - f.centre.z) * f.dir.z;
    if (Math.abs(along) > f.widthM / 2 || at.y < 0 || at.y > f.headM) return null;
    return ray.ray.origin.distanceTo(at);
  }

  function tap(e: PointerEvt): boolean {
    if (m.blocked() || m.ctx.mode() !== 'walk') return false;
    m.ctx.viewer.camera.updateMatrixWorld(true);
    ndc.set(e.ndcX, e.ndcY);
    ray.setFromCamera(ndc, m.ctx.viewer.camera);
    let best: { l: Live; d: number } | null = null;
    for (const l of live) {
      const g = m.viewer.scene.getObjectByName(`door:${l.portal.opening}`);
      const hit = g ? ray.intersectObject(g, true)[0] : undefined;
      if (hit && (!best || hit.distance < best.d)) best = { l, d: hit.distance };
      // an open leaf is not the doorway: the opening itself counts too (a flat's main door stands open behind the walker)
      const d = doorwayHit(l);
      if (d !== null && (!best || d < best.d)) best = { l, d };
    }
    if (!best) return false;
    // a wall between the camera and the door, or a piece or fitting nearer than the door, takes the tap instead
    const wall = ray.intersectObject(m.ctx.viewer.scene.getObjectByName('shell') ?? new THREE.Object3D(), true)[0];
    if (wall && wall.distance < best.d - 0.05) return false;
    const near = m.ctx.pickAt?.(e) ?? null;
    if (near && near.dist < best.d - 0.05) return false;
    const p = m.ctx.character.position;
    if (distanceToSegment(p, best.l.a, best.l.b) <= PORTAL_TAP_M) go(best.l.portal);
    else m.ctx.hud.toast(`Walk up to the door first. ${portalPrompt(best.l.portal)}.`);
    return true;
  }

  return {
    dispose() { setPortalPrompts(null); offStore(); live.length = 0; },
    tap,
    nearest: () => nearestLive(m.ctx.character.position)?.l.portal ?? null,
  };
}
