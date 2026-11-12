// Open the wardrobe (buyer): shutters swing open on their hinges, the floor shows the swing arcs and the walking space from each
// shutter's free edge to the nearest obstacle in front, the card says how much room is left, and the open shutters block
// walking until they are closed. The numbers come from the drawing (designs.json `openable`) or, for a catalogue wardrobe, from
// the catalogue (its door count and width); see wardrobe-swing.ts for the arithmetic and wardrobe-model.ts for the meshes.
import * as THREE from 'three';
import { specFor as catalogSpecFor } from '../core/catalog';
import { boxAxes } from '../core/geometry';
import { circleFree, nearestFree } from '../core/grid-query';
import { CHARACTER_RADIUS_M } from '../types';
import type { Box, CheckCard, FurnitureItem, Tone } from '../types';
import type { DesignsFile, OpenableZone } from '../look/designs';
import { furnitureKit } from '../look/furniture-materials';
import type { FurnitureKit } from '../look/furniture-materials';
import type { WardrobeDesign } from '../look/furniture-real';
import type { BuyerContext } from './context';
import { toneColor } from './overlays';
import { distanceToBox } from './store';
import type { FurnitureStoreImpl } from './store';
import { setSwingProvider } from './wardrobe-hooks';
import { REPLACED_NAMES, buildWardrobeModel } from './wardrobe-model';
import type { WardrobeModel } from './wardrobe-model';
import {
  ftInHalf, lengthLabel, openCard, shutterObstacle, shutterPose, specFromCatalogue, specFromDesign, swingArc, swingNeedCm,
  swingNote, walkingSpace, freeAngleRad,
} from './wardrobe-swing';
import type { OpenSpec, Shutter, ShutterReading } from './wardrobe-swing';
import './wardrobe.css';

/** A quarter turn takes this long. */
const OPEN_SECONDS = 0.7;
const ARC_Y = 0.014;
const ARC_HALF_M = 0.011;
const LINE_Y = 0.05;
const ARC_COLOR = '#2F6BFF';
/** The Open / Close chips show within this distance of a wardrobe's footprint. */
const CHIP_RADIUS_M = 1.6;
/** The card hides when the buyer is further than this from the wardrobe. */
const CARD_RADIUS_M = 4;

export interface OpenResult { card: CheckCard; tone: Tone; readings: ShutterReading[]; blocked: boolean; minSpaceM: number | null }

export interface Wardrobes {
  /** the pill text for an item ("Open wardrobe" / "Close wardrobe"), or null when it does not open */
  promptFor(item: FurnitureItem): string | null;
  /** E / tap on the pill: opens every bay, or closes them all when any is open. True when the item is an openable wardrobe. */
  activate(item: FurnitureItem): boolean;
  update(dt: number): void;
  /** hooks for tests and screenshots; the promises resolve when the shutters stand still */
  debug: {
    ids(): string[];
    spec(id: string): OpenSpec | null;
    open(id: string, bays?: number[]): Promise<OpenResult | null>;
    close(id: string, bays?: number[]): Promise<void>;
    result(id: string): OpenResult | null;
    angles(id: string): Record<string, number>;
    model(id: string): WardrobeModel | null;
  };
  dispose(): void;
}

interface Rec {
  item: FurnitureItem;
  spec: OpenSpec;
  wd: WardrobeDesign | null;
  model: WardrobeModel;
  target: Map<string, number>;
  /** angle a closing shutter's obstacle stays at until the shutter is shut */
  hold: Map<string, number>;
  open: Set<number>;
  settled: boolean;
  waiters: (() => void)[];
  result: OpenResult | null;
  arcs: THREE.Group | null;
  lastBox: Box;
}

/** How much room a wardrobe needs in front: its catalogue access rule (SPEC 4.4, "all of front >= 0.90"). */
const frontNeedM = (item: FurnitureItem): number => catalogSpecFor(item).access.find((r) => r.sides.includes('front'))?.minM ?? 0.9;

const sameBox = (a: Box, b: Box): boolean =>
  a.cx === b.cx && a.cz === b.cz && a.w === b.w && a.d === b.d && a.yawDeg === b.yawDeg;

/** What one bay holds, bottom to top, as the drawing labels it: boards left out, equal neighbours merged ("3 x glass drawer 8\""). */
export function interiorText(zones: OpenableZone[]): string {
  const parts: { text: string; n: number; dim: string; derived: boolean }[] = [];
  for (const z of zones) {
    if (z.kind === 'board' || z.kind === 'gap') continue;
    const name = z.label.replace(/ \(two side by side\)/, '');
    const prev = parts[parts.length - 1];
    if (prev && prev.text === name && prev.dim === z.dim) { prev.n += 1; continue; }
    parts.push({ text: name, n: 1, dim: z.dim, derived: !!z.derived });
  }
  return parts.map((p) => {
    const dim = p.derived ? ' (not dimensioned)' : p.dim ? ` ${p.dim}` : '';
    return p.n > 1 ? `${p.n} \u00d7 ${p.text.toLowerCase()}${dim}` : `${p.text}${dim}`;
  }).join(', ');
}

/** One line per distinct inside among the open bays: "Inside bays 1, 2 (page 4, bottom to top): ...". */
export function interiorLines(bays: number[], zonesByBay: OpenableZone[][]): string[] {
  const groups = new Map<string, number[]>();
  for (const b of bays) {
    const txt = interiorText(zonesByBay[b] ?? []);
    groups.set(txt, [...(groups.get(txt) ?? []), b]);
  }
  return [...groups].map(([txt, bs]) => `Inside bay${bs.length > 1 ? 's' : ''} ${bs.map((b) => b + 1).join(', ')} (page 4, bottom to top): ${txt}.`);
}

export function createWardrobes(deps: { ctx: BuyerContext; store: FurnitureStoreImpl; designs: DesignsFile | null; parent: THREE.Object3D; kit?: FurnitureKit }): Wardrobes {
  const { ctx, store, designs, parent } = deps;
  const kit = deps.kit ?? furnitureKit;
  const R = CHARACTER_RADIUS_M;
  const recs = new Map<string, Rec>();
  let hideClock = 0;
  let uiClock = 0;
  let cardOwner: string | null = null;

  // ------------------------------------------------------------ building and finding wardrobes

  function specFor(item: FurnitureItem): { spec: OpenSpec; wd: WardrobeDesign | null } | null {
    const d = designs?.items[item.id];
    if (d?.openable) return { spec: specFromDesign(item, d.openable), wd: d.wardrobe ?? null };
    const c = specFromCatalogue(item);
    return c ? { spec: c, wd: null } : null;
  }

  function hideOriginals(rec: Rec): void {
    const g = store.mesh(rec.item.id);
    if (!g) return;
    for (const c of g.children) {
      if (!REPLACED_NAMES.test(c.name)) continue;
      // the solid carcass and the drawer fronts are only replaced when the model draws the inside
      if (!rec.model.hasInterior && (c.name === 'carcass' || c.name === 'drawer-fronts')) continue;
      c.visible = false;
    }
  }

  function copyShadowFlags(rec: Rec): void {
    const ref = store.mesh(rec.item.id)?.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined;
    if (!ref) return;
    for (const m of rec.model.meshes()) { m.castShadow = ref.castShadow; m.receiveShadow = ref.receiveShadow; }
  }

  function scan(): void {
    const seen = new Set<string>();
    for (const item of store.all()) {
      if (item.kind !== 'wardrobe') continue;
      const built = specFor(item);
      if (!built) continue;
      seen.add(item.id);
      const have = recs.get(item.id);
      if (have && have.item.box.w === item.box.w && have.item.box.d === item.box.d && have.item.heightM === item.heightM) {
        // moved while open (furnish mode): shut it where it stood, so no obstacle is left behind
        if (!sameBox(have.item.box, item.box) && (anyOpen(have) || !have.settled)) forceClose(have);
        have.item = item;
        continue;
      }
      if (have) dispose(have);
      const model = buildWardrobeModel(item, built.spec, built.wd, kit);
      parent.add(model.group);
      const rec: Rec = {
        item, spec: built.spec, wd: built.wd, model, target: new Map(), hold: new Map(), open: new Set(), settled: true, waiters: [],
        result: null, arcs: null, lastBox: { ...item.box },
      };
      for (const s of built.spec.shutters) rec.target.set(s.id, 0);
      recs.set(item.id, rec);
      hideOriginals(rec);
      copyShadowFlags(rec);
    }
    for (const [id, rec] of [...recs]) if (!seen.has(id)) { dispose(rec); recs.delete(id); }
  }

  function forceClose(rec: Rec): void {
    rec.open.clear();
    rec.hold.clear();
    for (const s of rec.spec.shutters) { rec.target.set(s.id, 0); rec.model.setAngle(s.id, 0); }
    store.setTemporary(rec.item.id, []);
    clearPresentation(rec);
    rec.result = null;
    rec.model.setInteriorVisible(false);
    rec.settled = true;
    for (const w of rec.waiters.splice(0)) w();
    if (cardOwner === rec.item.id) { ctx.hud.hideCard(); cardOwner = null; }
  }

  function dispose(rec: Rec): void {
    clearPresentation(rec);
    store.setTemporary(rec.item.id, []);
    rec.model.dispose();
    for (const w of rec.waiters.splice(0)) w();
    if (cardOwner === rec.item.id) { ctx.hud.hideCard(); cardOwner = null; }
    recs.delete(rec.item.id);
  }

  const offChange = store.onChange(() => scan());
  scan();

  // ------------------------------------------------------------ open and close

  const anyOpen = (rec: Rec): boolean => rec.open.size > 0;
  const shutterIn = (rec: Rec, bays: number[] | undefined): Shutter[] => rec.spec.shutters.filter((s) => !bays || bays.includes(s.bay));

  /** The grid with everything except this wardrobe and every temporary obstacle, which is what a shutter swings through. */
  const freeGrid = (rec: Rec) => store.gridWithout([rec.item.id], false);

  function refreshObstacles(rec: Rec): void {
    const list: { box: Box; heightM: number }[] = [];
    for (const s of rec.spec.shutters) {
      const tgt = rec.target.get(s.id) ?? 0;
      const ang = tgt > 0 ? tgt : (rec.hold.get(s.id) ?? 0);
      if (ang > 0) list.push(shutterObstacle(rec.item.box, s, ang, rec.item.heightM));
    }
    store.setTemporary(rec.item.id, list);
    // a character standing where a shutter now is would be stuck inside it: step out to the nearest free spot
    const p = ctx.character.position;
    const g = store.grid();
    if (list.length && !circleFree(g, p.x, p.z, R)) {
      const free = nearestFree(g, p.x, p.z, R, 2);
      if (free) ctx.character.position = free;
    }
  }

  function setBays(rec: Rec, bays: number[], open: boolean): void {
    const free = open ? freeGrid(rec) : null;
    for (const bay of bays) {
      if (bay < 0 || bay >= rec.spec.bays) continue;
      if (open) rec.open.add(bay); else rec.open.delete(bay);
    }
    for (const s of shutterIn(rec, bays)) {
      if (open) {
        rec.hold.delete(s.id);
        rec.target.set(s.id, freeAngleRad(free!, rec.item.box, s, rec.spec.maxAngleRad));
      } else {
        const cur = rec.model.angle(s.id);
        if (cur > 0) rec.hold.set(s.id, Math.max(cur, rec.hold.get(s.id) ?? 0));
        rec.target.set(s.id, 0);
      }
    }
    // a shutter that cannot open at all (angle 0) stays closed; its bay still counts as open so the card can say why
    rec.settled = false;
    refreshObstacles(rec);
    if (open) { rec.model.setInteriorVisible(true); copyShadowFlags(rec); }
    if (!anyOpen(rec)) { clearPresentation(rec); rec.result = null; if (cardOwner === rec.item.id) { ctx.hud.hideCard(); cardOwner = null; } }
    else { clearPresentation(rec); }
  }

  function waitSettled(rec: Rec): Promise<void> {
    if (rec.settled) return Promise.resolve();
    return new Promise((res) => { rec.waiters.push(res); });
  }

  // ------------------------------------------------------------ the floor drawing and the card

  function clearLines(rec: Rec): void { ctx.overlays.clear(`wardrobe:${rec.item.id}`); }
  function clearPresentation(rec: Rec): void {
    clearLines(rec);
    if (rec.arcs) {
      rec.arcs.removeFromParent();
      rec.arcs.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
      rec.arcs = null;
    }
  }

  function arcRibbon(box: Box, s: Shutter, toRad: number): THREE.Mesh {
    const pts = swingArc(box, s, toRad, 32);
    const hinge = shutterPose(box, s, 0).hinge;
    const pos: number[] = [];
    const tri = (a: [number, number], b: [number, number], c: [number, number]): void => { pos.push(a[0], ARC_Y, a[1], b[0], ARC_Y, b[1], c[0], ARC_Y, c[1]); };
    const off = (p: { x: number; z: number }, k: number): [number, number] => {
      const dx = p.x - hinge.x, dz = p.z - hinge.z;
      const l = Math.hypot(dx, dz) || 1;
      return [p.x + (dx / l) * k, p.z + (dz / l) * k];
    };
    for (let i = 0; i + 1 < pts.length; i++) {
      const a0 = off(pts[i], -ARC_HALF_M), a1 = off(pts[i], ARC_HALF_M), b0 = off(pts[i + 1], -ARC_HALF_M), b1 = off(pts[i + 1], ARC_HALF_M);
      tri(a0, a1, b1); tri(a0, b1, b0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: ARC_COLOR, side: THREE.DoubleSide }));
    mesh.name = `swing-arc:${s.id}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    return mesh;
  }

  function computeResult(rec: Rec): OpenResult | null {
    const openShutters = rec.spec.shutters.filter((s) => rec.open.has(s.bay));
    if (openShutters.length === 0) return null;
    const box = rec.item.box;
    const grid = freeGrid(rec);
    const others = store.all().filter((i) => i.id !== rec.item.id);
    const { a } = boxAxes(box);
    const readings: ShutterReading[] = openShutters.map((s) => {
      const ang = rec.target.get(s.id) ?? 0;
      const tip = shutterPose(box, s, ang).tip;
      return { shutter: s, angleRad: ang, space: walkingSpace(grid, others, tip, a) };
    });
    const r = openCard(rec.spec, rec.item, readings);
    const lines = [...r.card.lines];
    const inside = rec.spec.design?.interior;
    if (inside && rec.model.hasInterior) {
      const at = Math.max(0, lines.length - (rec.spec.design?.conflicts.length ? 1 : 0));
      const add = interiorLines([...rec.open].sort((x, y) => x - y), inside.zonesBottomUp);
      lines.splice(at, 0, ...add);
    }
    return { card: { ...r.card, lines }, tone: r.tone, readings, blocked: r.blocked, minSpaceM: r.minSpaceM };
  }

  function present(rec: Rec): void {
    clearPresentation(rec);
    const res = computeResult(rec);
    rec.result = res;
    if (!res) return;
    const box = rec.item.box;
    const g = new THREE.Group();
    g.name = `wardrobe-swing:${rec.item.id}`;
    for (const rd of res.readings) if (rd.angleRad > 0) g.add(arcRibbon(box, rd.shutter, rd.angleRad));
    ctx.viewer.scene.add(g);
    rec.arcs = g;
    const { a } = boxAxes(box);
    const needM = frontNeedM(rec.item);
    const tag = `wardrobe:${rec.item.id}`;
    const done = new Set<string>();
    for (const rd of res.readings) {
      if (rd.space.kind === 'none' || rd.angleRad < rec.spec.maxAngleRad - 1e-6) continue; // a shutter that stops early has no walking space to show
      const tip = shutterPose(box, rd.shutter, rd.angleRad).tip;
      const key = `${Math.round(tip.x * 300)},${Math.round(tip.z * 300)},${Math.round(rd.space.distM * 100)}`;
      if (done.has(key)) continue;
      done.add(key);
      const hit = { x: tip.x + a.x * rd.space.distM, z: tip.z + a.z * rd.space.distM };
      const tone: Tone = rd.space.distM >= needM ? 'good' : 'warn';
      ctx.overlays.line({ x: tip.x, y: LINE_Y, z: tip.z }, { x: hit.x, y: LINE_Y, z: hit.z }, lengthLabel(rd.space.distM), toneColor(tone), tag);
    }
    ctx.hud.showCard(res.card);
    cardOwner = rec.item.id;
  }

  // ------------------------------------------------------------ frame update

  function stepRec(rec: Rec, dt: number): void {
    rec.model.place(rec.item.box);
    if (!sameBox(rec.lastBox, rec.item.box)) rec.lastBox = { ...rec.item.box };
    const speed = (Math.PI / 2) / OPEN_SECONDS;
    let moving = false;
    let released = false;
    for (const s of rec.spec.shutters) {
      const cur = rec.model.angle(s.id);
      const tgt = rec.target.get(s.id) ?? 0;
      if (Math.abs(cur - tgt) < 1e-4) { if (cur !== tgt) rec.model.setAngle(s.id, tgt); }
      else {
        const next = cur < tgt ? Math.min(tgt, cur + speed * dt) : Math.max(tgt, cur - speed * dt);
        rec.model.setAngle(s.id, next);
        if (next !== tgt) moving = true;
      }
      if (tgt === 0 && rec.model.angle(s.id) === 0 && rec.hold.has(s.id)) { rec.hold.delete(s.id); released = true; }
    }
    if (released) refreshObstacles(rec);
    if (!moving && !rec.settled) {
      rec.settled = true;
      if (anyOpen(rec)) present(rec);
      else rec.model.setInteriorVisible(false);
      for (const w of rec.waiters.splice(0)) w();
    }
    if (!anyOpen(rec) && rec.settled && rec.spec.shutters.every((s) => rec.model.angle(s.id) === 0)) rec.model.setInteriorVisible(false);
  }

  // ------------------------------------------------------------ the chips

  const bar = document.createElement('div');
  bar.className = 'wtw-bar';
  bar.dataset.testid = 'wardrobe-bar';
  bar.hidden = true;
  const unmount = ctx.hud.mount(bar, 'bottom');
  let barFor: string | null = null;
  const chips = new Map<string, HTMLButtonElement>();
  const mkChip = (id: string, text: string, onTap: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wtw-chip';
    b.dataset.chip = id;
    b.textContent = text;
    b.addEventListener('click', (e) => { e.stopPropagation(); onTap(); b.blur(); });
    bar.appendChild(b);
    chips.set(id, b);
    return b;
  };
  const target = (): Rec | null => (barFor ? recs.get(barFor) ?? null : null);
  function rebuildBar(rec: Rec): void {
    bar.replaceChildren();
    chips.clear();
    mkChip('all', 'Open all', () => { const r = target(); if (r) toggleAll(r); });
    if (rec.spec.origin === 'drawing' && rec.spec.bays > 1) {
      for (let b = 0; b < rec.spec.bays; b++) mkChip(`bay${b}`, `Bay ${b + 1}`, () => { const r = target(); if (r) { setBays(r, [b], !r.open.has(b)); } });
    }
  }
  function syncBar(rec: Rec): void {
    const all = rec.open.size === rec.spec.bays;
    const c = chips.get('all');
    if (c) { c.textContent = anyOpen(rec) ? 'Close all' : 'Open all'; c.setAttribute('aria-pressed', all ? 'true' : 'false'); }
    for (let b = 0; b < rec.spec.bays; b++) chips.get(`bay${b}`)?.setAttribute('aria-pressed', rec.open.has(b) ? 'true' : 'false');
    for (let b = 0; b < rec.spec.bays; b++) chips.get(`bay${b}`)?.classList.toggle('is-on', rec.open.has(b));
  }

  function toggleAll(rec: Rec): void {
    const all = [...Array(rec.spec.bays).keys()];
    if (anyOpen(rec)) setBays(rec, all, false); else setBays(rec, all, true);
  }

  function updateUi(dt: number): void {
    uiClock += dt;
    if (uiClock < 0.1) return;
    uiClock = 0;
    const p = ctx.character.position;
    let near: Rec | null = null;
    let nd = Infinity;
    for (const rec of recs.values()) {
      const d = distanceToBox(p, rec.item.box);
      if (d < nd) { nd = d; near = rec; }
    }
    const walking = ctx.mode() === 'walk';
    const show = walking && near !== null && (nd <= CHIP_RADIUS_M || anyOpen(near));
    if (show && near) {
      if (barFor !== near.item.id) { barFor = near.item.id; rebuildBar(near); }
      syncBar(near);
      bar.hidden = false;
    } else {
      bar.hidden = true;
    }
    // the card follows the buyer: hidden when far from the open wardrobe, shown again on return
    for (const rec of recs.values()) {
      if (!anyOpen(rec) || !rec.settled || !rec.result) continue;
      const d = distanceToBox(p, rec.item.box);
      if (d > CARD_RADIUS_M && cardOwner === rec.item.id) { ctx.hud.hideCard(); cardOwner = null; }
      else if (d <= CHIP_RADIUS_M && cardOwner === null && walking) { ctx.hud.showCard(rec.result.card); cardOwner = rec.item.id; }
    }
  }

  // ------------------------------------------------------------ furnish mode's swing sentence

  setSwingProvider((box, selfId) => {
    let need = 0;
    for (const rec of recs.values()) {
      if (rec.item.id === selfId) continue;
      const n = swingNeedCm(rec.spec, rec.item.box, box);
      if (n !== null) need = Math.max(need, n);
    }
    return need > 0 ? swingNote(need) : null;
  });

  // ------------------------------------------------------------ public

  return {
    promptFor(item) {
      const rec = recs.get(item.id);
      if (!rec) return null;
      return anyOpen(rec) ? 'Close wardrobe' : 'Open wardrobe';
    },
    activate(item) {
      const rec = recs.get(item.id);
      if (!rec) return false;
      toggleAll(rec);
      return true;
    },
    update(dt) {
      hideClock += dt;
      if (hideClock > 0.5) { hideClock = 0; for (const rec of recs.values()) hideOriginals(rec); }
      for (const rec of recs.values()) stepRec(rec, dt);
      updateUi(dt);
    },
    debug: {
      ids: () => [...recs.keys()],
      spec: (id) => recs.get(id)?.spec ?? null,
      async open(id, bays) {
        const rec = recs.get(id);
        if (!rec) return null;
        setBays(rec, bays ?? [...Array(rec.spec.bays).keys()], true);
        await waitSettled(rec);
        return rec.result;
      },
      async close(id, bays) {
        const rec = recs.get(id);
        if (!rec) return;
        setBays(rec, bays ?? [...Array(rec.spec.bays).keys()], false);
        await waitSettled(rec);
      },
      result: (id) => recs.get(id)?.result ?? null,
      angles: (id) => {
        const rec = recs.get(id);
        const out: Record<string, number> = {};
        if (rec) for (const s of rec.spec.shutters) out[s.id] = rec.model.angle(s.id);
        return out;
      },
      model: (id) => recs.get(id)?.model ?? null,
    },
    dispose() {
      offChange();
      setSwingProvider(null);
      unmount();
      for (const rec of [...recs.values()]) dispose(rec);
    },
  };
}

/** For tests: the same text the card uses for a length. */
export { ftInHalf };
