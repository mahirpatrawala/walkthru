// Owned by C4. Furnish mode (SPEC 2.1): a tray of real-size Indian furniture, a live verdict while the buyer drags it
// around, clearance lines, Place / Cancel / Move / Remove / Clear all. Everything goes through BuyerContext.
//
// Layout of this file: pure helpers (headless-tested), then `createFurnishSession` (the state machine: no DOM, runs under
// Node against the real FurnitureStore), then `createFurnishMode` (the tray DOM, pointer and key wiring).
import * as THREE from 'three';
import './furnish.css';
import { withSwingNote } from './wardrobe-hooks';
import { CATALOG, catalogItem, itemFromCatalog, specFor } from '../core/catalog';
import { pointInBox, sideEdge } from '../core/geometry';
import { circleFree, nearestFree } from '../core/grid-query';
import { checkPlacement, snapToWalls } from '../core/placement';
import type { PointerEvt } from '../engine/controls';
import { buildFurnitureMesh, setFurnitureTint } from '../engine/furniture';
import { CHARACTER_RADIUS_M } from '../types';
import type { Box, CatalogItem, FurnitureItem, FurnitureKind, Grid, PlacementResult, Side, Tone, Vec2, Vec3 } from '../types';
import type { BuyerContext, BuyerMode, FurnitureStore, OverlayHandle } from './context';
import { toneColor } from './overlays';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- pure helpers

/** A new item appears this far in front of the character (SPEC 2.1 step 2). */
export const SPAWN_DISTANCE_M = 1.8;
/** Clearance lines are drawn for sides with less than this (SPEC 2.1 step 4). */
export const LINE_MAX_M = 1.5;
/** ...and more than this: a side pressed against a wall has nothing to measure. */
export const LINE_MIN_M = 0.05;
/** Q / E step and the Rotate button (SPEC 2.1 step 3). */
export const ROTATE_STEP_DEG = 15;
export const ROTATE_BIG_DEG = 90;
/** Outlines and lines sit just above the floor so they do not z-fight with it. */
const OUTLINE_Y = 0.02;
const LINE_Y = 0.04;
/** Width of the outline ribbon in overlays.ts (RIBBON_M); the outline box is grown by this on every side. */
const OUTLINE_RIBBON_M = 0.035;
/** A pointer press this close to the footprint (m) still grabs the item: fingers are not precise. */
const GRAB_SLACK_M = 0.15;
export const LINE_COLOR = '#2F6BFF';

/** Yaw after turning by `deltaDeg`, wrapped into [0, 360). Positive turns counter-clockwise seen from above. */
export function rotateYaw(yawDeg: number, deltaDeg: number): number {
  const v = (((yawDeg + deltaDeg) % 360) + 360) % 360;
  const r = Math.round(v * 1e6) / 1e6;
  return r >= 360 ? 0 : r;
}

/** Where a new item goes before wall snapping: 1.8 m ahead of the character, its front facing the character. */
export function rawSpawnBox(spec: CatalogItem, charPos: Vec2, charYawDeg: number): Box {
  const y = charYawDeg * DEG;
  return {
    cx: charPos.x + Math.sin(y) * SPAWN_DISTANCE_M,
    cz: charPos.z + Math.cos(y) * SPAWN_DISTANCE_M,
    w: spec.footprint.w,
    d: spec.footprint.d,
    yawDeg: rotateYaw(charYawDeg, 180),
  };
}

/** `rawSpawnBox`, then squared to a nearby wall (4.5). `grid` holds every item already in the flat. */
export function spawnBox(grid: Grid, spec: CatalogItem, charPos: Vec2, charYawDeg: number): Box {
  return snapToWalls(grid, rawSpawnBox(spec, charPos, charYawDeg));
}

export interface ClearanceLine {
  side: Side;
  /** the item's edge, mid-side, at line height */
  from: Vec3;
  /** the first obstacle along the side's outward normal */
  to: Vec3;
  m: number;
  cm: number;
  label: string;
}

/** One line from the middle of each side with `LINE_MIN_M <= clearance < LINE_MAX_M` (SPEC 2.1 step 4). */
export function clearanceLines(box: Box, clearanceM: Record<Side, number>, y = LINE_Y): ClearanceLine[] {
  const out: ClearanceLine[] = [];
  for (const side of ['front', 'left', 'right', 'back'] as Side[]) {
    const m = clearanceM[side];
    if (!(m >= LINE_MIN_M) || !(m < LINE_MAX_M)) continue;
    const e = sideEdge(box, side);
    const cm = Math.round(m * 100);
    out.push({
      side,
      from: { x: e.mid.x, y, z: e.mid.z },
      to: { x: e.mid.x + e.normal.x * m, y, z: e.mid.z + e.normal.z * m },
      m, cm, label: `${cm} cm`,
    });
  }
  return out;
}

/** The tray card text: "King bed · 183 × 198 cm (72 × 78 in)". */
export function cardLabel(spec: CatalogItem): string {
  return `${spec.name} · ${spec.sizeLabel}`;
}

/** Copy for a selected real item, which cannot be moved. */
export function realItemText(item: FurnitureItem): string {
  return `${item.label} · ${Math.round(item.box.w * 100)} × ${Math.round(item.box.d * 100)} cm. Marked on the floor plan, it cannot be moved.`;
}

export const BROWSE_TEXT = 'Pick something below. It lands in front of you.';

/** A press at `floor` grabs the box when it is within `slackM` of the footprint. */
export function grabsBox(box: Box, floor: Vec2, slackM: number = GRAB_SLACK_M): boolean {
  return pointInBox(floor, box, -slackM);
}

// ---------------------------------------------------------------- the session (state machine, no DOM)

export interface FurnishView {
  phase: 'browse' | 'edit' | 'selected';
  message: string;
  tone: Tone | null;
  canPlace: boolean;
  canRotate: boolean;
  canMove: boolean;
  canRemove: boolean;
  /** items the buyer placed (Clear all shows when above 0) */
  buyerCount: number;
}

export interface FurnishUi { render(view: FurnishView): void }

export interface FurnishVerdict {
  id: string;
  catalogId: string | null;
  name: string;
  box: Box;
  verdict: PlacementResult['verdict'];
  reason: PlacementResult['reason'];
  tone: Tone;
  message: string;
  clearanceM: Record<Side, number>;
  canPlace: boolean;
  lines: Array<{ side: Side; cm: number }>;
}

interface Work { kind: 'new' | 'move'; item: FurnitureItem; spec: CatalogItem; box: Box; origBox: Box; mesh: THREE.Group }
type StoreX = FurnitureStore & { has?(id: string): boolean; get?(id: string): FurnitureItem | undefined; buyerIds?(): string[]; flush?(): void };

export interface FurnishSession {
  /** a new catalogue item in front of the character (replaces any item being placed) */
  spawn(catalogId: string): FurnishVerdict | null;
  /** put the item being placed centred at (cx, cz), no wall snap (what a drag does) */
  moveTo(cx: number, cz: number): FurnishVerdict | null;
  /** pointer-release behaviour: square up to a nearby wall */
  release(): FurnishVerdict | null;
  /** turn the item being placed by `deltaDeg` (positive = counter-clockwise from above) */
  rotate(deltaDeg: number): FurnishVerdict | null;
  setYaw(yawDeg: number): FurnishVerdict | null;
  startDrag(floor: Vec2): boolean;
  dragTo(floor: Vec2): void;
  endDrag(): void;
  dragging(): boolean;
  /** true when a press at `floor` (or on the mesh) should grab the item being placed */
  grabs(floor: Vec2 | null): boolean;
  /** Place: adds or updates the item in the store. Returns its id, or null (nothing to place, or blocked). */
  place(): string | null;
  /** Cancel: drops the item being placed (a moved item snaps back). */
  cancel(): void;
  select(id: string | null): void;
  selected(): string | null;
  /** Move: pick the selected virtual item up again */
  beginMove(): boolean;
  /** Remove the selected virtual item */
  removeSelected(): boolean;
  remove(id: string): boolean;
  /** Clear all: the buyer's placements (broker items stay). Returns how many were removed. */
  clearAll(): number;
  verdict(): FurnishVerdict | null;
  view(): FurnishView;
  working(): { id: string; kind: 'new' | 'move'; box: Box } | null;
  workMesh(): THREE.Object3D | null;
  /** per frame: redraws overlays and the view when something changed */
  update(): void;
  /** drop everything (leaving furnish mode) */
  dispose(): void;
}

function copyBox(b: Box): Box {
  return { cx: b.cx, cz: b.cz, w: b.w, d: b.d, yawDeg: b.yawDeg };
}

function disposeGroup(g: THREE.Object3D): void {
  g.removeFromParent();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) mat?.dispose();
  });
}

/**
 * In a room whose size is not measured on the drawing, the wall distances behind a verdict are not measurements. A
 * "fits" or "tight" verdict becomes an amber "Not measured" one with no clearance numbers or lines; "blocked" stays
 * blocked (an overlap with another item is real) but says its room is not measured.
 */
export function honestPlacement(r: PlacementResult, name: string, rooms: string[]): PlacementResult {
  if (rooms.length === 0) return r;
  const who = `${rooms.join(' and ')} ${rooms.length > 1 ? 'are' : 'is'} not measured on the drawing`;
  if (r.verdict === 'blocked') return { ...r, message: `${r.message} Not measured: ${who}, so this may differ in the real flat.` };
  return {
    ...r, tone: 'warn',
    message: `${name}: not measured. ${who}, so its fit and spaces cannot be checked here.`,
    clearanceM: { front: 3, back: 3, left: 3, right: 3 },
  };
}

export function createFurnishSession(ctx: BuyerContext, ui: FurnishUi): FurnishSession {
  const store = ctx.furniture as StoreX;
  const R = CHARACTER_RADIUS_M;
  const TAG_EDIT = 'furnish-edit';
  const TAG_SEL = 'furnish-sel';

  let work: Work | null = null;
  let selectedId: string | null = null;
  let drag: { dx: number; dz: number } | null = null;
  let dirty = true;
  let gridCache: { id: string; grid: Grid } | null = null;
  let handles: OverlayHandle[] = [];
  let lastView = '';
  let disposed = false;

  const ceilingM = (): number => ctx.property.layout.wallHeightM;
  const getItem = (id: string): FurnitureItem | undefined => (store.get ? store.get(id) : store.all().find((i) => i.id === id));
  const hasItem = (id: string): boolean => (store.has ? store.has(id) : store.all().some((i) => i.id === id));
  const buyerCount = (): number => (store.buyerIds ? store.buyerIds().length : store.all().filter((i) => i.source === 'virtual').length);
  const flushStore = (): void => { store.flush?.(); };

  /** layout + every item except `id`, cached until the store changes */
  const gridWithout = (id: string): Grid => {
    if (!gridCache || gridCache.id !== id) gridCache = { id, grid: ctx.gridWithout([id]) };
    return gridCache.grid;
  };
  const offStore = store.onChange(() => {
    gridCache = null;
    if (selectedId && !work && !hasItem(selectedId)) selectedId = null;
    dirty = true;
  });

  const subject = (): { id: string; spec: CatalogItem; box: Box; item: FurnitureItem } | null => {
    if (work) return { id: work.item.id, spec: work.spec, box: work.box, item: work.item };
    if (selectedId) {
      const item = getItem(selectedId);
      if (item) return { id: item.id, spec: specFor(item), box: item.box, item };
    }
    return null;
  };

  const check = (s: { id: string; spec: CatalogItem; box: Box }): PlacementResult =>
    honestPlacement(checkPlacement(gridWithout(s.id), s.spec, s.box, ceilingM()), s.spec.name, ctx.notMeasuredNear?.([{ x: s.box.cx, z: s.box.cz }]) ?? []);

  const verdictOf = (): FurnishVerdict | null => {
    const s = subject();
    if (!s) return null;
    const r = check(s);
    return {
      id: s.id, catalogId: s.item.catalogId ?? null, name: s.spec.name, box: copyBox(s.box),
      verdict: r.verdict, reason: r.reason, tone: r.tone, message: withSwingNote(r.message, s.box, s.id),
      clearanceM: { ...r.clearanceM }, canPlace: r.verdict !== 'blocked',
      lines: clearanceLines(s.box, r.clearanceM).map((l) => ({ side: l.side, cm: l.cm })),
    };
  };

  const clearOverlays = (): void => {
    for (const h of handles) h.remove();
    handles = [];
    ctx.overlays.clear(TAG_EDIT);
    ctx.overlays.clear(TAG_SEL);
  };

  const syncMesh = (w: Work): void => {
    w.mesh.position.set(w.box.cx, 0, w.box.cz);
    w.mesh.rotation.y = w.box.yawDeg * DEG;
    w.mesh.updateMatrixWorld(true);
  };

  const computeView = (): FurnishView => {
    const bc = buyerCount();
    const s = subject();
    if (!s) return { phase: 'browse', message: BROWSE_TEXT, tone: null, canPlace: false, canRotate: false, canMove: false, canRemove: false, buyerCount: bc };
    if (work) {
      const r = check(s);
      return { phase: 'edit', message: withSwingNote(r.message, s.box, s.id), tone: r.tone, canPlace: r.verdict !== 'blocked', canRotate: true, canMove: false, canRemove: false, buyerCount: bc };
    }
    if (s.item.source === 'real') {
      return { phase: 'selected', message: realItemText(s.item), tone: null, canPlace: false, canRotate: false, canMove: false, canRemove: false, buyerCount: bc };
    }
    const r = check(s);
    return { phase: 'selected', message: withSwingNote(r.message, s.box, s.id), tone: r.tone, canPlace: false, canRotate: false, canMove: true, canRemove: true, buyerCount: bc };
  };

  /** Redraws the outline, the clearance lines and the tint, then pushes the view to the UI when it changed. */
  const flush = (): void => {
    if (disposed || !dirty) return;
    dirty = false;
    clearOverlays();
    const s = subject();
    if (s) {
      const r = check(s);
      const tag = work ? TAG_EDIT : TAG_SEL;
      const real = !work && s.item.source === 'real';
      const color = real ? LINE_COLOR : toneColor(r.tone);
      // the ribbon sits just outside the footprint, so a bed's frame does not hide it
      handles.push(ctx.overlays.outlineBox({ ...s.box, w: s.box.w + 2 * OUTLINE_RIBBON_M, d: s.box.d + 2 * OUTLINE_RIBBON_M }, OUTLINE_Y, color, tag));
      if (!real) {
        for (const l of clearanceLines(s.box, r.clearanceM)) handles.push(ctx.overlays.line(l.from, l.to, l.label, LINE_COLOR, tag));
      }
      if (work) setFurnitureTint(work.mesh, r.tone);
    }
    const v = computeView();
    const key = JSON.stringify(v);
    if (key !== lastView) { lastView = key; ui.render(v); }
  };

  const touch = (): void => { dirty = true; };

  /** Drops the item being placed. A moved item comes back where it was. */
  const discardWork = (): void => {
    if (!work) return;
    const w = work;
    work = null;
    drag = null;
    disposeGroup(w.mesh);
    if (w.kind === 'move') {
      const m = store.mesh(w.item.id);
      if (m) m.visible = true;
    }
    touch();
  };

  const nudgeCharacter = (): void => {
    const g = ctx.grid();
    const p = ctx.character.position;
    if (circleFree(g, p.x, p.z, R)) return;
    const free = nearestFree(g, p.x, p.z, R, 3);
    if (free) ctx.character.position = free;
  };

  const startWork = (kind: 'new' | 'move', item: FurnitureItem, spec: CatalogItem, box: Box): Work => {
    const mesh = buildFurnitureMesh({ ...item, box: copyBox(box) });
    ctx.viewer.scene.add(mesh);
    const w: Work = { kind, item, spec, box: copyBox(box), origBox: copyBox(item.box), mesh };
    work = w;
    selectedId = null;
    drag = null;
    syncMesh(w);
    touch();
    return w;
  };

  const session: FurnishSession = {
    spawn(catalogId) {
      let spec: CatalogItem;
      try { spec = catalogItem(catalogId); } catch { return null; }
      discardWork();
      const box = spawnBox(ctx.grid(), spec, ctx.character.position, ctx.character.yawDeg);
      const item = itemFromCatalog(catalogId, box, 'virtual');
      startWork('new', item, spec, box);
      flush();
      return verdictOf();
    },
    moveTo(cx, cz) {
      if (!work) return null;
      work.box = { ...work.box, cx, cz };
      syncMesh(work);
      touch();
      flush();
      return verdictOf();
    },
    release() {
      if (!work) return null;
      work.box = snapToWalls(gridWithout(work.item.id), work.box);
      syncMesh(work);
      touch();
      flush();
      return verdictOf();
    },
    rotate(deltaDeg) {
      if (!work) return null;
      work.box = { ...work.box, yawDeg: rotateYaw(work.box.yawDeg, deltaDeg) };
      syncMesh(work);
      touch();
      flush();
      return verdictOf();
    },
    setYaw(yawDeg) {
      if (!work) return null;
      work.box = { ...work.box, yawDeg: rotateYaw(yawDeg, 0) };
      syncMesh(work);
      touch();
      flush();
      return verdictOf();
    },
    startDrag(floor) {
      if (!work) return false;
      drag = { dx: work.box.cx - floor.x, dz: work.box.cz - floor.z };
      return true;
    },
    dragTo(floor) {
      if (!work || !drag) return;
      work.box = { ...work.box, cx: floor.x + drag.dx, cz: floor.z + drag.dz };
      syncMesh(work);
      touch();
    },
    endDrag() {
      if (!drag) return;
      drag = null;
      session.release();
    },
    dragging: () => drag !== null,
    grabs(floor) {
      if (!work || !floor) return false;
      return grabsBox(work.box, floor);
    },
    place() {
      if (!work) return null;
      const w = work;
      if (check({ id: w.item.id, spec: w.spec, box: w.box }).verdict === 'blocked') return null;
      work = null;
      drag = null;
      disposeGroup(w.mesh);
      const id = w.item.id;
      if (w.kind === 'new') {
        store.add({ ...w.item, box: copyBox(w.box) });
      } else {
        const m = store.mesh(id);
        if (m) m.visible = true;
        store.update(id, copyBox(w.box));
      }
      flushStore();
      nudgeCharacter();
      selectedId = id;
      touch();
      flush();
      return id;
    },
    cancel() {
      discardWork();
      flush();
    },
    select(id) {
      if (work) return;
      const next = id && hasItem(id) ? id : null;
      if (next === selectedId) return;
      selectedId = next;
      touch();
      flush();
    },
    selected: () => selectedId,
    beginMove() {
      if (work || !selectedId) return false;
      const item = getItem(selectedId);
      if (!item || item.source === 'real') return false;
      const m = store.mesh(item.id);
      if (m) m.visible = false;
      startWork('move', item, specFor(item), item.box);
      flush();
      return true;
    },
    removeSelected() {
      return selectedId ? session.remove(selectedId) : false;
    },
    remove(id) {
      if (work && work.item.id === id) discardWork();
      const item = getItem(id);
      if (!item || item.source === 'real') return false;
      store.remove(id);
      flushStore();
      if (selectedId === id) selectedId = null;
      touch();
      flush();
      return true;
    },
    clearAll() {
      const ids = store.buyerIds ? store.buyerIds() : store.all().filter((i) => i.source === 'virtual').map((i) => i.id);
      if (work && work.kind === 'move' && ids.includes(work.item.id)) discardWork();
      const n = ids.length;
      store.clearBuyerItems();
      flushStore();
      if (selectedId && !hasItem(selectedId)) selectedId = null;
      touch();
      flush();
      return n;
    },
    verdict: () => { flush(); return verdictOf(); },
    view: () => { flush(); return computeView(); },
    working: () => (work ? { id: work.item.id, kind: work.kind, box: copyBox(work.box) } : null),
    workMesh: () => work?.mesh ?? null,
    update: flush,
    dispose() {
      discardWork();
      selectedId = null;
      clearOverlays();
      offStore();
      disposed = true;
    },
  };
  // let the tray show its first state
  flush();
  return session;
}

// ---------------------------------------------------------------- the mode (DOM, pointer, keys)

export interface FurnishMode extends BuyerMode { session: FurnishSession }

const ICONS: Record<FurnitureKind, string> = {
  bed: '<path d="M3 18V7M3 14h18v4M21 14v-2.5A2.5 2.5 0 0 0 18.5 9H11v5"/><circle cx="7" cy="11" r="1.6"/>',
  sofa: '<path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11"/><path d="M3.5 12.5a2 2 0 0 1 4 0V15h9v-2.5a2 2 0 0 1 4 0V18h-17z"/><path d="M6 18v2M18 18v2"/>',
  dining: '<path d="M4 9h16M7 9v10M17 9v10"/><path d="M8 5h8"/>',
  wardrobe: '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M12 3.5v17M10 12v1.6M14 12v1.6"/>',
  counter: '<path d="M3 9h18v3H3zM6 12v8M18 12v8"/>',
};
const icon = (k: FurnitureKind): string =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;
const ROTATE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function isTouchDevice(): boolean {
  try { return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0; } catch { return false; }
}

const MODE_TEXT = {
  browse: 'Furnish · pick an item below',
  edit: 'Furnish · drag it into place',
  selected: 'Furnish · move or remove it',
} as const;

export function createFurnishMode(ctx: BuyerContext): FurnishMode {
  const touch = isTouchDevice();
  let session!: FurnishSession;

  // ---- tray DOM
  const root = h('div', 'wtf-root');
  root.dataset.ui = '1';
  root.dataset.testid = 'furnish';

  const bar = h('div', 'wtf-bar', root);
  bar.dataset.ui = '1';
  bar.dataset.testid = 'furnish-verdict';
  const text = h('div', 'wtf-text', bar);
  text.setAttribute('role', 'status');
  text.setAttribute('aria-live', 'polite');
  const barMsg = h('div', 'wtf-msg', text);
  const barHint = h('div', 'wtf-hint', text);

  const actions = h('div', 'wtf-actions', bar);
  actions.dataset.ui = '1';
  const btn = (label: string, cls: string, onClick: () => void, html?: string): HTMLButtonElement => {
    const b = h('button', `wtf-btn ${cls}`, actions);
    b.type = 'button';
    b.dataset.ui = '1';
    if (html) b.innerHTML = `${html}<span></span>`;
    (b.querySelector('span') ?? b).textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); b.blur(); });
    return b;
  };
  const bRotate = btn('Rotate', 'is-ghost', () => session.rotate(-ROTATE_BIG_DEG), ROTATE_ICON);
  bRotate.dataset.act = 'rotate';
  const bCancel = btn('Cancel', 'is-ghost', () => session.cancel());
  bCancel.dataset.act = 'cancel';
  const bPlace = btn('Place', 'is-primary', () => { session.place(); });
  bPlace.dataset.act = 'place';
  const bMove = btn('Move', 'is-ghost', () => { session.beginMove(); });
  bMove.dataset.act = 'move';
  const bRemove = btn('Remove', 'is-danger', () => { session.removeSelected(); });
  bRemove.dataset.act = 'remove';

  const tray = h('div', 'wtf-tray', root);
  tray.dataset.ui = '1';
  const head = h('div', 'wtf-head', tray);
  h('div', 'wtf-title', head, 'Add furniture');
  const headRight = h('div', 'wtf-head-right', head);
  const clearBtn = h('button', 'wtf-link', headRight, 'Clear all');
  clearBtn.type = 'button';
  clearBtn.dataset.ui = '1';
  clearBtn.dataset.act = 'clear';
  const doneBtn = h('button', 'wtf-link is-strong', headRight, 'Done');
  doneBtn.type = 'button';
  doneBtn.dataset.ui = '1';
  doneBtn.dataset.act = 'done';
  const cards = h('div', 'wtf-cards', tray);
  cards.dataset.ui = '1';
  for (const spec of CATALOG) {
    const c = h('button', 'wtf-item', cards);
    c.type = 'button';
    c.dataset.ui = '1';
    c.dataset.catalogId = spec.id;
    c.title = cardLabel(spec);
    c.setAttribute('aria-label', cardLabel(spec));
    const ic = h('span', 'wtf-item-icon', c);
    ic.innerHTML = icon(spec.kind);
    h('span', 'wtf-item-name', c, spec.name);
    h('span', 'wtf-item-size', c, spec.sizeLabel);
    c.addEventListener('click', (e) => { e.stopPropagation(); session.spawn(spec.id); c.blur(); });
  }

  // Clear all asks twice (a stray tap must not wipe the buyer's layout)
  let clearArmed = false;
  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  const disarm = (): void => {
    clearArmed = false;
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
    clearBtn.textContent = 'Clear all';
    clearBtn.classList.remove('is-armed');
  };
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!clearArmed) {
      clearArmed = true;
      clearBtn.textContent = 'Tap again to clear all';
      clearBtn.classList.add('is-armed');
      clearTimer = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    const n = session.clearAll();
    if (n > 0) ctx.hud.toast(n === 1 ? 'Removed 1 item.' : `Removed ${n} items.`);
  });
  doneBtn.addEventListener('click', (e) => { e.stopPropagation(); ctx.setMode('walk'); });

  let active = false;
  const ui: FurnishUi = {
    render(v) {
      barMsg.textContent = v.message;
      bar.dataset.tone = v.tone ?? 'none';
      bar.dataset.phase = v.phase;
      barHint.textContent = v.phase === 'edit'
        ? (touch ? 'Drag it to move. Tap Rotate to turn it.' : 'Drag to move. Q / E turn it, R for a quarter turn.')
        : '';
      barHint.hidden = v.phase !== 'edit';
      const showEdit = v.phase === 'edit';
      bRotate.hidden = bCancel.hidden = bPlace.hidden = !showEdit;
      bMove.hidden = bRemove.hidden = v.phase !== 'selected' || !v.canMove;
      actions.hidden = !(showEdit || (v.phase === 'selected' && v.canMove));
      bPlace.disabled = !v.canPlace;
      clearBtn.hidden = v.buyerCount === 0;
      if (v.buyerCount === 0) disarm();
      cards.classList.toggle('is-editing', showEdit);
      tray.classList.toggle('is-editing', showEdit);
      if (active) ctx.hud.setModeBar(MODE_TEXT[v.phase], () => ctx.setMode('walk'));
    },
  };
  session = createFurnishSession(ctx, ui);

  // ---- pointer: press on the item being placed to drag it; anything else is the normal look drag or a tap
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const meshHit = (e: { ndcX: number; ndcY: number }): boolean => {
    const m = session.workMesh();
    if (!m) return false;
    ctx.viewer.camera.updateMatrixWorld(true);
    ndc.set(e.ndcX, e.ndcY);
    raycaster.setFromCamera(ndc, ctx.viewer.camera);
    return raycaster.intersectObject(m, true).length > 0;
  };
  const claim = (e: PointerEvt): boolean => {
    if (!active) return false;
    if (e.type === 'down') {
      if (!session.working()) return false;
      const floor = ctx.raycastFloor(e);
      if (!(meshHit(e) || session.grabs(floor))) return false;
      // the floor point under a press on the item's top is behind it: take the offset from whatever the ray finds
      return floor ? session.startDrag(floor) : false;
    }
    if (e.type === 'move') {
      if (!session.dragging()) return true;
      const floor = ctx.raycastFloor(e);
      if (floor) session.dragTo(floor);
      return true;
    }
    session.endDrag();
    return true;
  };

  // ---- tap on a placed item selects it; a tap elsewhere clears the selection
  const itemIdAt = (e: PointerEvt): string | null => {
    const hit = ctx.raycast(e);
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o) {
      const id = o.userData?.itemId;
      if (typeof id === 'string') return id;
      o = o.parent;
    }
    return null;
  };

  let offs: Array<() => void> = [];
  let unmount: (() => void) | null = null;

  const mode: FurnishMode = {
    id: 'furnish',
    session,
    enter() {
      active = true;
      unmount = ctx.hud.mount(root, 'bottom');
      root.classList.remove('is-in');
      void root.offsetWidth; // restart the slide-up
      root.classList.add('is-in');
      ctx.input.setInteractKeyMode('rotate');
      ctx.input.claimPointer(claim);
      offs = [
        ctx.input.on('rotate-left', () => { if (active) session.rotate(ROTATE_STEP_DEG); }),
        ctx.input.on('rotate-right', () => { if (active) session.rotate(-ROTATE_STEP_DEG); }),
        ctx.input.on('rotate-90', () => { if (active) session.rotate(-ROTATE_BIG_DEG); }),
        ctx.input.onTap((e) => {
          if (!active || session.working()) return;
          session.select(itemIdAt(e));
        }),
      ];
      session.select(null);
      ctx.hud.hideCard();
      ui.render(session.view());
    },
    exit() {
      active = false;
      session.cancel();
      session.select(null);
      session.update();
      disarm();
      for (const off of offs) off();
      offs = [];
      ctx.input.setInteractKeyMode('interact');
      ctx.input.claimPointer(null);
      ctx.hud.setModeBar(null);
      unmount?.();
      unmount = null;
    },
    update() {
      if (active) session.update();
    },
  };
  installDebug(ctx, mode);
  return mode;
}

// ---------------------------------------------------------------- debug hooks (window.__walkthru.furnish)

type DebugWindow = { __walkthru?: Record<string, unknown> & { setMode?(id: string): unknown } };

/** The checks the integrator drives: `__walkthru.furnish.open()`, `.spawn('bed-king')`, `.moveTo(x, z)`, ... */
function installDebug(ctx: BuyerContext, mode: FurnishMode): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as DebugWindow;
  if (!w.__walkthru) return;
  const s = mode.session;
  w.__walkthru.furnish = {
    /** switch to furnish mode */
    open: () => { ctx.setMode('furnish'); return ctx.mode(); },
    close: () => { ctx.setMode('walk'); return ctx.mode(); },
    catalogue: () => CATALOG.map((c) => ({ id: c.id, label: cardLabel(c) })),
    spawn: (catalogId: string) => s.spawn(catalogId),
    moveTo: (cx: number, cz: number) => s.moveTo(cx, cz),
    /** what letting go of a drag does: square up to the wall */
    release: () => s.release(),
    /** 90 degrees clockwise (the Rotate button) unless `deg` is given (positive = counter-clockwise) */
    rotate: (deg: number = -ROTATE_BIG_DEG) => s.rotate(deg),
    setYaw: (deg: number) => s.setYaw(deg),
    place: () => s.place(),
    cancel: () => s.cancel(),
    select: (id: string | null) => { s.select(id); return s.view(); },
    move: () => s.beginMove(),
    removeSelected: () => s.removeSelected(),
    remove: (id: string) => s.remove(id),
    clearAll: () => s.clearAll(),
    verdict: () => s.verdict(),
    view: () => s.view(),
    working: () => s.working(),
  };
}

/**
 * Before the first press of the sofa button the mode does not exist yet (it is built lazily). Until it does,
 * `__walkthru.furnish.<anything>()` opens furnish mode, which builds it and replaces this stub, then forwards the call.
 */
function installColdStub(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const w = window as unknown as DebugWindow;
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    const wt = w.__walkthru;
    if (!wt) { if (tries > 240) clearInterval(timer); return; }
    clearInterval(timer);
    if (wt.furnish) return;
    const stub: Record<string, unknown> = new Proxy({}, {
      get: (_t, key: string) => (...args: unknown[]) => {
        wt.setMode?.('furnish');
        const real = wt.furnish as Record<string, (...a: unknown[]) => unknown> | undefined;
        if (!real || real === stub) throw new Error('furnish mode could not be opened');
        return real[key](...args);
      },
    });
    wt.furnish = stub;
  }, 250);
}
installColdStub();
