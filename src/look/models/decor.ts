// Decor models (SPEC 16.15): the planned decor of a lived-in home (plants, vases, a fruit bowl, pots, a clock, a framed picture) may be a free
// CC0 model instead of the generated stand-in. Decor is out of every measurement, collision and ray, so a model is only scaled uniformly to the
// size the planner asked for, never fitted to a drawn box. Same lazy rule as furniture: the generated piece shows until the model arrives.
import * as THREE from 'three';
import type { Tier } from '../types';
import { FRUIT_IN_BOWL, decorChoice, modelInfo } from './library';
import type { ModelPolicy } from './library';
import { disposeInstance, instantiate } from './instance';
import type { Placement } from './instance';
import { loadModel } from './load';

/** the part of a DecorPiece this module reads (lived-in/plan.ts) */
export interface DecorSpec { kind: string; w: number; d: number; height: number; seed: number; place: 'floor' | 'surface' | 'wall' }

function mark(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.raycast = () => { /* decor is never hit by a ray */ };
    m.userData.decor = true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) mat.userData.decor = true;
  });
}

function freeKids(g: THREE.Object3D): void {
  for (const c of [...g.children]) { g.remove(c); disposeInstance(c); }
}

/**
 * Starts the model for decor piece `g` (built in the piece's own frame: origin at the base centre, or on the wall plane, front +Z). When it
 * arrives the generated meshes are replaced in place. Resolves true when a model went in, false when the generator stays (no model for this
 * kind, the pack says generator, the fetch failed, or the piece was rebuilt meanwhile: `alive` says so).
 */
export function attachDecorModel(g: THREE.Group, piece: DecorSpec, tier: Tier, policy: ModelPolicy | null, alive: () => boolean = () => true): Promise<boolean> {
  const choice = decorChoice(piece.kind, { w: piece.w, d: piece.d, height: piece.height, seed: piece.seed, wall: piece.place === 'wall' }, policy);
  if (!choice) return Promise.resolve(false);
  const { model, scale } = choice;
  const need = piece.kind === 'fruit' ? [...new Set(FRUIT_IN_BOWL.map((f) => f.id))] : [];
  return Promise.all([loadModel(model.id, tier), ...need.map((id) => loadModel(id, tier))]).then(([tpl, ...fruit]) => {
    if (!tpl || !alive()) return false;
    const out = new THREE.Group();
    const s = { x: scale, y: scale, z: scale };
    for (const c of [...instantiate(tpl, [{ x: 0, y: 0, z: 0, yawDeg: 0, scale: s }], { partUse: model.parts, noRaycast: true }).children]) out.add(c);
    if (piece.kind === 'fruit') {
      const r = (choice.info.dims.w / 2) * scale * 0.62;
      FRUIT_IN_BOWL.forEach((f) => {
        const ft = fruit[need.indexOf(f.id)];
        if (!ft) return;
        const info = modelInfo(f.id);
        const k = scale * f.scale;
        const place: Placement = { x: f.x * r * 1.6, y: f.lift * scale, z: f.z * r * 1.6, yawDeg: f.yaw, scale: { x: k, y: k, z: k } };
        void info;
        for (const c of [...instantiate(ft, [place], { partUse: { body: {} }, noRaycast: true }).children]) { c.name = `fruit-${f.id}-${out.children.length}`; c.userData.walkthruPart = c.name; out.add(c); }
      });
    }
    freeKids(g);
    for (const c of [...out.children]) g.add(c);
    mark(g);
    g.userData.model = model.id;
    return true;
  }, () => false);
}
