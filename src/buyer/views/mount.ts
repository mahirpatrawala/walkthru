// Mounts the three views of a space (Walk, Doll house, Plan) on the buyer page and ties them together: the state machine (view-modes.ts), the doll house
// (dollhouse.ts), the plan (plan-view.ts), the segmented control that switches them, the `?view=` address, and the places where the three meet the rest of
// the page (the nav aids' go-to from above, Furnish and Measure stepping aside, the tour forcing Walk, the frame loop resting under the plan). One call from
// main.ts, one `dispose()`; everything made here goes with the space.
import * as THREE from 'three';
import { CHARACTER_RADIUS_M } from '../../types';
import type { CheckCard, FurnitureItem, Vec2 } from '../../types';
import { circleFree, nearestFree } from '../../core/grid-query';
import { yawToward } from '../../core/spawn';
import { resetLocomotion } from '../../engine/locomotion';
import type { Look } from '../../look/look';
import type { Viewer } from '../../engine/viewer';
import type { Character } from '../../engine/character';
import type { BuyerContext, ModeManager } from '../context';
import type { HudImpl } from '../hud';
import type { MountedNav } from '../nav/mount';
import { roomChips } from '../nav/nav-model';
import { pieceAction } from '../piece-actions';
import { actionFor as kindAction } from '../store';
import type { UnverifiedRooms } from '../store';
import { CHAIR_PROMPT } from '../seats';
import { createDollhouse } from './dollhouse';
import type { Dollhouse } from './dollhouse';
import { entranceOutward } from './framing';
import { labelPoint } from './labels';
import { createPlanView } from './plan-view';
import type { PlanViewApi } from './plan-view';
import { VIEW_LABELS, VIEW_MODES, createViewMachine, withViewParam } from './view-modes';
import type { ViewMachine, ViewMode, ViewsApi } from './view-modes';
import './views.css';

export interface ViewsDeps {
  ctx: BuyerContext;
  viewer: Viewer;
  look: Look | null;
  character: Character;
  hud: HudImpl;
  modes: ModeManager;
  shell: THREE.Object3D;
  furnitureRoot: THREE.Object3D;
  outdoor: boolean;
  skipEdges?: ReadonlySet<string>;
  unverified: UnverifiedRooms;
  water: { x0: number; z0: number; x1: number; z1: number }[];
  nav: MountedNav;
  wardrobe: { promptFor(item: FurnitureItem): string | null };
  seats: { isSeat(item: FurnitureItem): boolean };
  cardFor(item: FurnitureItem): CheckCard;
  standUp(): Promise<void>;
  northDeg: number | undefined;
  /** the mode to start in (applied when the HUD first shows, after the height picker) */
  initial: ViewMode;
  /** false: no segmented control of this module's own (the top bar adopts `ctx.views` instead) */
  controls: boolean;
  /** the HUD is on screen (the buyer has chosen a height and started) */
  hudVisible(): boolean;
}

export interface MountedViews extends ViewsApi {
  machine: ViewMachine;
  dollhouse: Dollhouse;
  plan: PlanViewApi;
  /** debug: what is in the scene and what the renderer holds, for "everything is back after leaving the doll house" */
  census(): Census;
  dispose(): void;
}

export interface Census {
  objects: number; visibleObjects: number; meshes: number; visibleMeshes: number; geometries: number; materials: number; lights: number;
  rendererGeometries: number; rendererTextures: number; programs: number;
  /** a signature of which named objects are visible (ceilings, fans, lights, signs) */
  hiddenNames: string[];
  triangles: number;
}

const ICONS: Record<ViewMode, string> = {
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M9.5 21l2.2-6-2.6-3 1.2-4.2 3.4 1.6 2.3 2.8"/><path d="M13.4 8.9l-3.9 1.7L7.4 14M11.7 15l3.3 2.2L16 21"/>',
  doll: '<path d="M12 3l8 4.2v9.6L12 21l-8-4.2V7.2z"/><path d="M4 7.2l8 4.3 8-4.3M12 11.5V21"/>',
  plan: '<path d="M4 4h16v16H4z"/><path d="M4 12h6.5M10.5 4v8M14.5 12V20M10.5 16.5h4"/>',
};
const icon = (m: ViewMode): string => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[m]}</svg>`;

/** The segmented control: Walk / Doll house / Plan, the selected one a white pill with its icon. One small function, one flag (`controls`) to leave it out. */
export function mountViewControl(host: HTMLElement, api: ViewsApi): () => void {
  const bar = document.createElement('div');
  bar.className = 'wt-views-bar';
  bar.dataset.testid = 'views-bar';
  bar.dataset.ui = '1';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'View');
  const buttons = new Map<ViewMode, HTMLButtonElement>();
  for (const m of VIEW_MODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wt-views-seg';
    b.dataset.view = m;
    b.dataset.ui = '1';
    b.innerHTML = `${icon(m)}<span>${VIEW_LABELS[m]}</span>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); api.set(m); b.blur(); });
    bar.appendChild(b);
    buttons.set(m, b);
  }
  const sync = (mode: ViewMode): void => {
    for (const [m, b] of buttons) { b.classList.toggle('is-on', m === mode); b.setAttribute('aria-pressed', m === mode ? 'true' : 'false'); }
  };
  sync(api.mode());
  const off = api.onChange((m) => sync(m));
  host.appendChild(bar);
  host.classList.add('wt-has-views');
  return () => { off(); bar.remove(); host.classList.remove('wt-has-views'); };
}

export function mountViews(d: ViewsDeps): MountedViews {
  const { ctx, viewer, look, hud, modes } = d;
  const layout = ctx.property.layout;
  const ch = d.character;
  const chips = roomChips(layout, d.unverified);
  const machine = createViewMachine('walk');
  let started = false;
  let disposed = false;
  let paused = false;
  const cleanups: Array<() => void> = [];

  // ---- the three views
  const plan = createPlanView({
    host: document.body,
    layout, unverified: d.unverified, chips,
    items: () => ctx.furniture.all(),
    onItemsChange: (cb) => ctx.furniture.onChange(cb),
    walker: { position: () => ch.position, headingDeg: () => ctx.camera.viewYawDeg },
    northDeg: d.northDeg,
    water: d.water,
    onRoomTap: (id) => { void goToRoom(id); },
    onEscape: () => api.set('walk'),
  });
  const dollhouse = createDollhouse({
    viewer, layout, look, character: ch, ctx,
    labelHost: hud.root,
    shell: d.shell, furnitureRoot: d.furnitureRoot,
    outdoor: d.outdoor, entrance: entranceOutward(layout), skipEdges: d.skipEdges,
    chips,
    promptFor: (item) => d.wardrobe.promptFor(item) ?? (d.seats.isSeat(item) ? CHAIR_PROMPT : (pieceAction(item) ?? kindAction(item.kind)).prompt),
    cardFor: d.cardFor,
    onFloorTap: (p, roomId) => { void goToFloor(p, roomId); },
    onEscape: () => api.set('walk'),
    tier: () => look?.tier ?? 'medium',
  });

  // ---- going somewhere from above
  /** puts the walker at `at` facing `yawDeg` as the nav aids do (a jump), then flies down to them */
  async function arriveAt(at: Vec2, yawDeg: number): Promise<void> {
    await d.standUp();
    resetLocomotion(ch);
    ch.position = at;
    ch.object.position.y = 0;
    ch.yawDeg = yawDeg;
    ctx.camera.yawDeg = yawDeg;
    ctx.camera.setTarget(at, ch.heightM);
    ch.setLocomotion(0, false, 0);
    api.set('walk');
  }
  const spotIn = (roomId: string): { x: number; z: number; yawDeg: number } | null => d.nav.debug.driver.spotIn(roomId);
  async function goToRoom(roomId: string): Promise<void> {
    const chip = chips.find((c) => c.id === roomId);
    if (chip && !chip.goable) { hud.toast(`${chip.label} is only partly on the drawing, so you cannot walk there.`); return; }
    const spot = spotIn(roomId);
    if (!spot) { hud.toast(`${chip?.label ?? 'That room'} is only partly on the drawing, so there is nowhere to stand.`); return; }
    await arriveAt({ x: spot.x, z: spot.z }, spot.yawDeg);
  }
  async function goToFloor(p: Vec2, roomId: string | null): Promise<void> {
    const chip = roomId ? chips.find((c) => c.id === roomId) : undefined;
    if (chip && !chip.goable) { hud.toast(`${chip.label} is only partly on the drawing, so you cannot walk there.`); return; }
    const g = ctx.grid();
    const spot = roomId ? spotIn(roomId) : null;
    const room = roomId ? layout.rooms.find((r) => r.id === roomId) : undefined;
    let at: Vec2 = { x: p.x, z: p.z };
    let yaw: number | null = null;
    if (circleFree(g, at.x, at.z, CHARACTER_RADIUS_M)) {
      // stand where it was tapped, facing into the room: toward its middle, or the room's own start direction when it was tapped in the middle
      const mid = room ? labelPoint(room.polygon) : null;
      if (mid && Math.hypot(mid.x - at.x, mid.z - at.z) > 0.9) yaw = yawToward(at, mid);
      else if (spot) yaw = spot.yawDeg;
    } else if (spot) {
      at = { x: spot.x, z: spot.z };
      yaw = spot.yawDeg;
    } else {
      const free = nearestFree(g, at.x, at.z, CHARACTER_RADIUS_M, 3);
      if (!free) { hud.toast('There is no room to stand there.'); return; }
      at = free;
    }
    if (yaw === null) {
      // away from the camera: the way the picture looks
      const dir = new THREE.Vector3();
      viewer.camera.getWorldDirection(dir);
      yaw = (Math.atan2(dir.x, dir.z) * 180) / Math.PI;
    }
    await arriveAt(at, yaw);
  }

  // ---- the machine and what a change means for the rest of the page
  const body = document.body;
  const syncBody = (m: ViewMode): void => {
    body.classList.toggle('wt-view-dollhouse', m === 'doll');
    body.classList.toggle('wt-view-plan', m === 'plan');
  };
  const syncUrl = (m: ViewMode): void => {
    try { history.replaceState(history.state, '', withViewParam(`${location.pathname}${location.search}${location.hash}`, m)); } catch { /* a sandboxed frame */ }
  };
  machine.onChange((m, prev) => {
    syncBody(m);
    syncUrl(m);
    if (m !== 'walk') {
      // Furnish and Measure are for the walk; a tour is the walk's too
      if (modes.id === 'furnish' || modes.id === 'measure') modes.set('walk');
      d.nav.debug.stop();
      ctx.hud.setPrompt(null);
    }
    if (prev === 'doll' && m !== 'doll') dollhouse.clearSelection();
    if (m === 'plan') ctx.hud.hideCard();
  });

  // ---- the control and the API
  // before the height picker is closed the HUD (and so the control) is not on screen: a mode asked for then is the one the view starts in
  let pending: ViewMode = d.initial;
  const api: ViewsApi = {
    mode: () => (started ? machine.mode() : pending),
    set(m) {
      if (disposed) return;
      if (!started) { pending = m; return; }
      machine.set(m);
    },
    onChange: (cb) => machine.onChange(cb),
  };
  if (d.controls) cleanups.push(mountViewControl(hud.root, api));

  // the nav aids' go-to from above: a tap on a chip, a room of the mini plan or the Tour button first returns to Walk (the aids then do their own walking)
  const toWalk = (e: Event): void => {
    if (machine.mode() !== 'doll') return;
    const t = e.target as Element | null;
    if (t?.closest?.('.wt-nav-chip:not(.is-partial), .wt-nav-plan g[data-room], .wt-nav-tourbtn')) machine.set('walk');
  };
  hud.root.addEventListener('click', toWalk, true);
  cleanups.push(() => hud.root.removeEventListener('click', toWalk, true));

  // ---- each frame, after the walk's own camera has run
  cleanups.push(viewer.onFrame((dt) => {
    if (disposed) return;
    if (!started) {
      if (!d.hudVisible()) return;
      started = true;
      if (pending !== 'walk') machine.set(pending, { instant: true });
    }
    machine.tick(dt);
    // a tour begun some other way (the debug hook) is the walk's: back to Walk
    if (machine.mode() !== 'walk' && d.nav.debug.driver.touring) machine.set('walk');
    const flight = machine.flight();
    dollhouse.update(dt, flight, machine.planAmount());
    plan.setAmount(machine.planAmount());
    plan.update();
    // under a fully covering plan the 3D view is not drawn at all
    const rest = !machine.rendering3D();
    if (rest !== paused) {
      paused = rest;
      if (look) look.holdFrame(rest ? () => {} : null); else viewer.setRenderOverride(rest ? () => {} : null);
    }
  }));

  // ---- census (debug)
  function census(): Census {
    let objects = 0, visibleObjects = 0, meshes = 0, visibleMeshes = 0, lights = 0, triangles = 0;
    const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
    const hidden: string[] = [];
    const isVisible = (o: THREE.Object3D): boolean => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
    viewer.scene.traverse((o) => {
      objects++;
      const vis = isVisible(o);
      if (vis) visibleObjects++; else if (o.name) hidden.push(o.name);
      if ((o as THREE.Light).isLight) lights++;
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        meshes++;
        if (vis) { visibleMeshes++; const idx = m.geometry.getIndex(); triangles += (idx ? idx.count : m.geometry.getAttribute('position')?.count ?? 0) / 3; }
        geos.add(m.geometry);
        for (const mm of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mm);
      }
    });
    const i = viewer.renderer.info;
    return {
      objects, visibleObjects, meshes, visibleMeshes, geometries: geos.size, materials: mats.size, lights,
      rendererGeometries: i.memory.geometries, rendererTextures: i.memory.textures, programs: i.programs?.length ?? 0,
      hiddenNames: hidden.sort(), triangles: Math.round(triangles),
    };
  }

  syncUrl(d.initial === 'walk' ? 'walk' : d.initial);

  return {
    mode: api.mode, set: api.set, onChange: api.onChange,
    machine, dollhouse, plan, census,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const fn of cleanups.splice(0)) { try { fn(); } catch (err) { console.warn('[walkthru] views clean-up step failed', err); } }
      if (paused) { if (look) look.holdFrame(null); else viewer.setRenderOverride(null); paused = false; }
      dollhouse.dispose();
      plan.dispose();
      body.classList.remove('wt-view-dollhouse', 'wt-view-plan');
    },
  };
}

