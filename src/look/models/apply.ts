// Puts a library model into a built piece of furniture (SPEC 16.15). The generated piece is built first, as always, and stays on screen; when
// the model arrives (and only if nothing rebuilt the piece meanwhile) it replaces the generated meshes in place. The group, its box, its
// heights and every number a check reads are the item's and never change: only the meshes inside the group are swapped.
import * as THREE from 'three';
import type { FurnitureItem } from '../../types';
import { GENERATORS, genQuality, sizeOf } from '../gen';
import type { GenEnv } from '../gen';
import { buildDining, diningChairLayout } from '../gen/seating';
import type { DiningParams } from '../gen/seating';
import type { FurnitureKit } from '../furniture-materials';
import type { ResolvedLook } from '../style';
import type { Tier } from '../types';
import { CHAIR_SLOT } from './library';
import type { FurniturePlan } from './library';
import { disposeInstance, instantiate } from './instance';
import type { Placement } from './instance';
import { loadModel } from './load';
import type { Template } from './load';

/** the parts of a generated bed that stay on a model's frame: what a person lies on (src/look/gen/bed.ts, ultra-bed.ts) */
const BEDDING = /^(mattress|duvet|pillow)/;

/** the names the generator gives the dining chairs' parts, so everything that knows them (the colour pass, the bake keys) is unchanged */
const CHAIR_PART_NAME: Record<string, string> = { fabric: 'chair-seats', legs: 'chair-legs' };

/** which items currently show a model, for the card note ("Shown with a stock model...") */
const inUse = new Map<string, { model: string; label: string; credit?: string }>();
export function modelUsedBy(itemId: string): { model: string; label: string; credit?: string } | null { return inUse.get(itemId) ?? null; }

/** One honest sentence for an item's card: the model is typical styling, the size is the drawn one. Empty when the piece is the generated one. */
export function modelNote(itemId: string): string {
  const u = inUse.get(itemId);
  if (!u) return '';
  // a CC BY model names its author (the licence asks for the credit wherever it is shown)
  return u.credit
    ? ` Shown with a stock 3D model (${u.label}: ${u.credit}, adapted), scaled to the drawn size: typical styling, not from your drawing.`
    : ` Shown with a stock 3D model (${u.label}, free CC0 asset), scaled to the drawn size: typical styling, not from your drawing.`;
}

function disposeKids(g: THREE.Object3D): void {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat?.dispose();
    });
  }
}

/** The group's meshes for a plan whose template is in hand: the whole piece, or the table with model chairs. */
function buildFromTemplate(tpl: Template, item: FurnitureItem, look: ResolvedLook, plan: FurniturePlan, tier: Tier, kit: FurnitureKit): THREE.Group {
  const out = new THREE.Group();
  const sc = plan.fit.scale;
  if (plan.model.use === 'chairs') {
    const size = sizeOf(item);
    const env: GenEnv = { kit, q: genQuality(tier) };
    const table = buildDining(env, size, look.params as unknown as DiningParams, look.roles, { chairs: false });
    for (const c of [...table.children]) out.add(c);
    const lay = diningChairLayout(size, look.params as unknown as DiningParams);
    const dm = plan.info.dims;
    const placements: Placement[] = lay.slots.map((s) => ({
      x: s.x, y: 0, z: s.side * (lay.d / 2 - (dm.d * sc.z) / 2),
      // a chair faces the table: the +z row looks toward -z
      yawDeg: s.side > 0 ? 180 : 0, scale: sc,
    }));
    const chairs = instantiate(tpl, placements, { partUse: plan.model.parts, roles: look.roles, merge: true, nameOf: (p) => CHAIR_PART_NAME[p] ?? `chair-${p}` });
    if (lay.turned) chairs.rotation.y = Math.PI / 2;
    out.add(chairs);
    return out;
  }
  if (plan.model.use === 'frame') {
    // a bed: the generated mattress, flat quilt and pillows (SPEC 16.23, exactly as the generator lays them) on the model's deck
    const bedding = GENERATORS[look.kind].build({ kit, q: genQuality(tier) }, sizeOf(item), { ...look.params, baseTopM: plan.deckM ?? 0 }, look.roles);
    for (const c of [...bedding.children]) if (BEDDING.test(c.name)) out.add(c); else disposeKids(c);
  }
  const off = plan.offset ?? { y: 0, z: 0 };
  const inst = instantiate(tpl, [{ x: 0, y: off.y, z: off.z, yawDeg: plan.fit.turned ? 90 : 0, scale: sc }], { partUse: plan.model.parts, roles: look.roles });
  for (const c of [...inst.children]) out.add(c);
  return out;
}

/**
 * Starts loading the plan's model for `group` and swaps it in when it arrives. `token` makes a late answer harmless: a rebuild of the group
 * (a new tier, a new style, a new finish) starts a new token, and the old answer is dropped. Returns the promise (tests and the bake driver wait on it).
 */
export function attachModel(group: THREE.Group, item: FurnitureItem, look: ResolvedLook, plan: FurniturePlan, tier: Tier, kit: FurnitureKit): Promise<boolean> {
  const token = {};
  group.userData.modelToken = token;
  group.userData.modelWanted = plan.model.id;
  inUse.delete(item.id);
  return loadModel(plan.model.id, tier).then((tpl) => {
    if (!tpl || group.userData.modelToken !== token) return false;
    const built = buildFromTemplate(tpl, item, look, plan, tier, kit);
    disposeKids(group);
    for (const c of [...built.children]) group.add(c);
    group.userData.model = { id: plan.model.id, tier: tpl.tier, scale: plan.fit.scale, turned: plan.fit.turned, worst: plan.fit.worst };
    inUse.set(item.id, { model: plan.model.id, label: plan.model.label, ...(plan.model.credit ? { credit: plan.model.credit } : {}) });
    group.updateMatrixWorld(true);
    (group.userData.afterModelSwap as (() => void) | undefined)?.();
    return true;
  }, () => false);
}

/** Forgets that `itemId` shows a model (its group was rebuilt as the generated piece). */
export function clearModelUse(itemId: string): void { inUse.delete(itemId); }

export { disposeInstance };
