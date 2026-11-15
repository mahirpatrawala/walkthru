// Owned by C4. Furnish mode (SPEC 2.1): a tray of real-size Indian furniture, a live verdict while the buyer drags it
// around, clearance lines, Place / Cancel / Move / Remove / Clear all. Everything goes through BuyerContext.
//
// Layout of this file: pure helpers (headless-tested), then `createFurnishSession` (the state machine: no DOM, runs under
// Node against the real FurnitureStore), then `createFurnishMode` (the tray DOM, pointer and key wiring).
import { ceilingIsKnown } from '../core/room-trust';
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
import { FAMILY_SLOTS, BED_STYLES, describeFinish, finishFamily, sanitizeFinish, surpriseFinish, swatch, withPick } from '../look/finishes';
import type { Finish, FinishFamily, FinishSlotKey } from '../look/finishes';
import { boxAxes } from '../core/geometry';
import { BUILT_IN_EDIT_NOTE, BUILT_IN_NOTE, EDITED_CHIP, OVERLAY_NOTE, RESET_LABEL, emptyLayout, isBuiltIn, shareUrl } from './my-layout';
import { BACK_TO_DRAWN_PLACE, BACK_TO_DRAWN_SIZE, editNote, placeChanged, resizePatch, sizeLimits, sizeValues } from './resize';
import type { SizeKey } from './resize';
import { labelOf, mountText, sizeText as fittingSizeText } from '../look/fittings';
import type { FittingRecord, ResizeSpec } from '../look/fittings';
import type { Target } from './fittings-api';
import { sceneOrigin } from './scene-tag';
import { pieceName } from './furnish-names';
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
export const LINE_COLOR = '#1E6B73';

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

/** The card line for a piece that came with the home (its name and size are on the line above it). */
export function realItemNote(): string {
  return 'Marked on the floor plan. Move it, resize it, replace it or hide it in your layout only: the home as drawn does not change.';
}

export { pieceName };

/** Copy for a selected piece that came with the home: its size is the record and cannot change, but it can be replaced or hidden in My layout. */
export function realItemText(item: FurnitureItem): string {
  return `${pieceName(item)} · ${Math.round(item.box.w * 100)} × ${Math.round(item.box.d * 100)} cm. ${realItemNote()}`;
}

/**
 * Where a replacement goes: the old piece's back edge stays where it was (a bed's head, a wardrobe's back on its wall) and the new
 * piece grows out of it toward the front, on the same centre line, the same way round. The caller wall-snaps the result.
 */
export function replacementBox(old: Box, spec: CatalogItem): Box {
  const { a } = boxAxes(old);
  const back = { x: old.cx - a.x * (old.d / 2), z: old.cz - a.z * (old.d / 2) };
  return { cx: back.x + a.x * (spec.footprint.d / 2), cz: back.z + a.z * (spec.footprint.d / 2), w: spec.footprint.w, d: spec.footprint.d, yawDeg: old.yawDeg };
}

/** Catalogue pieces in the order a Replace list shows them: the same family first (a bed for a bed), then everything else. */
export function replacementChoices(item: Pick<FurnitureItem, 'kind' | 'label' | 'catalogId'> & { box?: { w: number; d: number } }): { same: CatalogItem[]; other: CatalogItem[] } {
  const fam = (c: CatalogItem): string => familyKey({ kind: c.kind, label: c.name, catalogId: c.id, box: c.footprint });
  const mine = familyKey(item);
  return { same: CATALOG.filter((c) => fam(c) === mine), other: CATALOG.filter((c) => fam(c) !== mine) };
}
function familyKey(i: Pick<FurnitureItem, 'kind' | 'label' | 'catalogId'> & { box?: { w: number; d: number } }): string {
  return finishFamily(i) ?? `${i.kind}`;
}

export const BROWSE_TEXT = 'Pick something below. It lands in front of you.';

/** A press at `floor` grabs the box when it is within `slackM` of the footprint. */
export function grabsBox(box: Box, floor: Vec2, slackM: number = GRAB_SLACK_M): boolean {
  return pointInBox(floor, box, -slackM);
}

// ---------------------------------------------------------------- the session (state machine, no DOM)

/** The piece the action card is about. */
export interface FurnishSelection {
  id: string;
  name: string;
  /** '120 × 60 cm' */
  sizeText: string;
  /** true for a piece that came with the home, false for one the viewer placed */
  home: boolean;
  /** a fixed built-in of a real drawing: hiding it needs the explicit note */
  builtIn: boolean;
  family: FinishFamily | null;
  finish: Finish | null;
  /** the finish in words, '' when it is as built */
  finishText: string;
  /** a piece of the home that was moved or resized in this layout: "Moved in your layout. Your size: ... On the drawing: ...", else null */
  edit: string | null;
  /** the steppers of a piece of the home: width, depth and the height its family edits, with the live number and the family's limits (metres) */
  sizes: Array<{ key: SizeKey; label: string; value: number; min: number; max: number; step: number }> | null;
  /** the drawn place or size is not what the viewer has */
  canBackSize: boolean;
  canBackPlace: boolean;
}

/** A selected fitting (AC, fan, curtains, plant, the drawing's chair ...): what its card shows and does. */
export interface FittingSelection {
  id: string;
  name: string;
  /** '90 × 20 × 29 cm' or '60 cm across' */
  sizeText: string;
  /** 'On the wall, bottom edge 2.06 m above the floor' */
  mountText: string;
  /** 'Typical fitting, not from your drawing' / "From the designer's renders" */
  label: string;
  /** what the viewer changed, in words, or null */
  edit: string | null;
  canMove: boolean;
  canTurn: boolean;
  resize: null
    | { kind: 'classes'; label: string; options: Array<{ value: number; label: string; on: boolean }> }
    | { kind: 'dims'; dims: Array<{ index: number; key: string; label: string; value: number; min: number; max: number; step: number; text: string }> };
  canBackSize: boolean;
  canBackPlace: boolean;
  /** Move is on: drag or tap where it should go, then Place */
  moving: boolean;
  /** where it stands (rounded), so the camera follows a fitting that has been moved */
  at: string;
  /** while moving: can it go where the pointer is, and if not why */
  targetOk: boolean;
  targetReason: string | null;
}
export interface FurnishView {
  phase: 'browse' | 'edit' | 'selected' | 'fitting';
  message: string;
  tone: Tone | null;
  canPlace: boolean;
  canRotate: boolean;
  canMove: boolean;
  canRemove: boolean;
  /** items the buyer placed (Clear all shows when above 0) */
  buyerCount: number;
  /** what the piece being placed is for: 'new' (Place), 'move' (Place), 'replace' (Replace) */
  workKind: 'new' | 'move' | 'replace' | null;
  selection: FurnishSelection | null;
  /** the fitting being looked at (phase 'fitting') */
  fitting: FittingSelection | null;
  /** every piece in the home right now, for the tray list */
  pieces: Array<{ id: string; label: string; home: boolean }>;
  /** originals and fittings removed in this layout, with an Undo each */
  removed: Array<{ id: string; label: string; builtIn: boolean; fitting?: boolean }>;
  /** true when this layout differs from the home as drawn (the chip shows) */
  edited: boolean;
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

interface Work { kind: 'new' | 'move' | 'replace'; item: FurnitureItem; spec: CatalogItem; box: Box; origBox: Box; mesh: THREE.Group; /** the piece a replacement stands in for */ replaces?: string }
type StoreX = FurnitureStore & {
  has?(id: string): boolean; get?(id: string): FurnitureItem | undefined; buyerIds?(): string[]; flush?(): void;
  isOriginal?(id: string): boolean; hideOriginal?(id: string): boolean; restoreOriginal?(id: string): boolean; hiddenOriginals?(): FurnitureItem[];
  setFinish?(id: string, finish: Finish | null | undefined): boolean; replace?(id: string, next: FurnitureItem): boolean;
  layout?(): import('./my-layout').MyLayout; isEdited?(): boolean; reset?(): void;
  drawnItem?(id: string): FurnitureItem | undefined; editOriginal?(id: string, patch: Partial<import('./resize').OriginalEdit>): boolean; restoreDrawn?(id: string, what?: 'place' | 'size' | 'both'): boolean;
  isOriginalEdited?(id: string): boolean;
};

export interface FurnishOptions {
  /** is this piece a fixed built-in of the drawing (see isBuiltIn)? Default: none is. */
  builtIn?: (item: FurnitureItem) => boolean;
}

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
  /** Remove the selected piece: a placed one is deleted, one that came with the home is hidden in My layout */
  removeSelected(): boolean;
  remove(id: string): boolean;
  /** Replace: pick a catalogue piece for the selected one. It appears at the same spot, wall-snapped, as a preview with a verdict; Place commits. */
  replaceSelected(catalogId: string): FurnishVerdict | null;
  /** Rotate on a selected placed piece: picks it up and turns it a quarter, ready to Place */
  rotateSelected(deltaDeg?: number): boolean;
  /** the look of the selected piece: set one choice (null clears it) */
  pick(key: FinishSlotKey, id: string | null): boolean;
  /** "Surprise me": a coherent combination for the selected piece */
  surprise(): Finish | null;
  /** back to the default look of the selected piece */
  clearLook(): boolean;
  /** undo a removal */
  restore(id: string): boolean;
  // ---- sizing a piece of the home (My layout only): the back edge stays where it is, the width grows about the middle
  /** set one of the selected piece's sizes (metres): 'w', 'd', or 'h' (the height its family edits). Limits per family apply. */
  resizeSelected(key: SizeKey, value: number): boolean;
  /** one step of the stepper (+1 or -1) */
  stepSelected(key: SizeKey, dir: 1 | -1): boolean;
  /** the selected piece of the home back to its drawn size, its drawn place, or both */
  backToDrawn(what: 'size' | 'place' | 'both'): boolean;
  // ---- fittings (AC, fan, curtains, plants, the drawing's chairs ...)
  selectFitting(id: string | null): void;
  selectedFitting(): string | null;
  /** Move: the fitting follows the pointer as a ghost until Place */
  beginFittingMove(): boolean;
  /** the pointer is at these places (wall point, floor point, ceiling point): the ghost goes where the fitting can go */
  aimFitting(at: { wallPoint: { x: number; y: number; z: number } | null; floor: Vec2 | null; ceiling: Vec2 | null; rayDirXZ: Vec2 | null }): Target | null;
  /** Place: puts the fitting at the ghost (when legal) */
  placeFitting(): boolean;
  cancelFittingMove(): void;
  fittingMoving(): boolean;
  /** put the fitting at an exact place (checks, debug) */
  moveFitting(id: string, spec: import('../look/fittings').MoveSpec): boolean;
  /** a size of the selected fitting: for a class (AC width, fan sweep ...) its value; for a stepper (rug width ...) the dimension's index and value (metres) */
  sizeFitting(values: number[]): boolean;
  stepFitting(index: number, dir: 1 | -1): boolean;
  /** quarter turn of a floor fitting that can be turned */
  turnFitting(deltaDeg?: number): boolean;
  backFittingSize(): boolean;
  backFittingPlace(): boolean;
  removeFitting(id?: string): boolean;
  restoreFitting(id: string): boolean;
  /** back to the home as drawn */
  resetLayout(): void;
  /** the layout as a link a buyer can send */
  shareLink(href: string): string;
  /** Clear all: the buyer's placements (broker items stay). Returns how many were removed. */
  clearAll(): number;
  verdict(): FurnishVerdict | null;
  view(): FurnishView;
  working(): { id: string; kind: 'new' | 'move' | 'replace'; box: Box } | null;
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

export function createFurnishSession(ctx: BuyerContext, ui: FurnishUi, options: FurnishOptions = {}): FurnishSession {
  const store = ctx.furniture as StoreX;
  const R = CHARACTER_RADIUS_M;
  const TAG_EDIT = 'furnish-edit';
  const TAG_SEL = 'furnish-sel';

  let work: Work | null = null;
  let selectedId: string | null = null;
  /** the fitting being looked at, and the state of its Move (a ghost that follows the pointer until Place) */
  let selectedFit: string | null = null;
  let fitMove: { target: Target | null } | null = null;
  const fx = ctx.fittings;
  const TAG_FIT = 'furnish-fit';
  let fitGhost: THREE.Group | null = null;
  let fitSel: THREE.Group | null = null;
  let drag: { dx: number; dz: number } | null = null;
  let dirty = true;
  let gridCache: { key: string; grid: Grid } | null = null;
  let handles: OverlayHandle[] = [];
  let lastView = '';
  let disposed = false;

  const ceilingM = (): number => ctx.property.layout.wallHeightM;
  const getItem = (id: string): FurnitureItem | undefined => (store.get ? store.get(id) : store.all().find((i) => i.id === id));
  const hasItem = (id: string): boolean => (store.has ? store.has(id) : store.all().some((i) => i.id === id));
  const buyerCount = (): number => (store.buyerIds ? store.buyerIds().length : store.all().filter((i) => i.source === 'virtual').length);
  const flushStore = (): void => { store.flush?.(); };

  /** layout + every item except `id` (and, while a replacement is being placed, the piece it replaces), cached until the store changes */
  const gridWithout = (id: string): Grid => {
    const ids = work && work.item.id === id && work.replaces ? [id, work.replaces] : [id];
    const key = ids.join('|');
    if (!gridCache || gridCache.key !== key) gridCache = { key, grid: ctx.gridWithout(ids) };
    return gridCache.grid;
  };
  const offStore = store.onChange(() => {
    gridCache = null;
    if (selectedId && !work && !hasItem(selectedId)) selectedId = null;
    dirty = true;
  });
  // the planners report a fitting a moment after the overlay changes: look again when they do
  const offFit = fx?.onChange(() => { dirty = true; }) ?? (() => {});

  const subject = (): { id: string; spec: CatalogItem; box: Box; item: FurnitureItem } | null => {
    if (work) return { id: work.item.id, spec: work.spec, box: work.box, item: work.item };
    if (selectedId) {
      const item = getItem(selectedId);
      if (item) return { id: item.id, spec: specFor(item), box: item.box, item };
    }
    return null;
  };

  const check = (s: { id: string; spec: CatalogItem; box: Box }): PlacementResult =>
    honestPlacement(checkPlacement(gridWithout(s.id), s.spec, s.box, ceilingM(), ceilingIsKnown()), s.spec.name, ctx.notMeasuredNear?.([{ x: s.box.cx, z: s.box.cz }]) ?? []);

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

  const isHome = (id: string): boolean => (store.isOriginal ? store.isOriginal(id) : false);
  const builtIn = (item: FurnitureItem): boolean => !!options.builtIn?.(item);
  // width × depth, and the height when the piece has one
  const sizeText = (i: FurnitureItem): string => `${Math.round(i.box.w * 100)} × ${Math.round(i.box.d * 100)} cm${i.heightM > 0 ? ` · ${Math.round(i.heightM * 100)} cm high` : ''}`;
  const drawnOf = (id: string): FurnitureItem | undefined => store.drawnItem?.(id);
  const sizesOf = (item: FurnitureItem): FurnishSelection['sizes'] => {
    if (!isHome(item.id)) return null;
    const v = sizeValues(item);
    return sizeLimits(item, ceilingM()).map((l) => {
      const d = drawnOf(item.id);
      // a size the drawing already has outside the family's range is allowed to stay
      const dv = d ? sizeValues(d)[l.key] : v[l.key];
      return { key: l.key, label: l.label, value: v[l.key], min: Math.min(l.min, dv), max: Math.max(l.max, dv), step: l.step };
    });
  };
  const selectionOf = (item: FurnitureItem): FurnishSelection => {
    const family = finishFamily(item);
    const d = isHome(item.id) ? drawnOf(item.id) : undefined;
    const edit = d ? editNote(d, item) : null;
    const dd = d ? sizeValues(d) : null, cc = sizeValues(item);
    return {
      id: item.id, name: pieceName(item), sizeText: sizeText(item), home: isHome(item.id), builtIn: builtIn(item), family,
      finish: item.finish ? { ...item.finish } : null, finishText: family ? describeFinish(family, item.finish) : '',
      edit, sizes: sizesOf(item),
      canBackSize: !!dd && (Math.abs(dd.w - cc.w) > 0.0005 || Math.abs(dd.d - cc.d) > 0.0005 || Math.abs(dd.h - cc.h) > 0.0005),
      canBackPlace: !!d && placeChanged(d.box, item.box),
    };
  };

  // ---- fittings
  const fitRec = (): FittingRecord | undefined => (selectedFit && fx ? fx.get(selectedFit) : undefined);
  const nearlyEq = (a: number, b: number): boolean => Math.abs(a - b) < 0.0075;
  const resizeView = (rec: FittingRecord): FittingSelection['resize'] => {
    const r: ResizeSpec | null = rec.resize;
    if (!r || !rec.currentSize) return null;
    if (r.kind === 'classes') return { kind: 'classes', label: r.label, options: r.options.map((o) => ({ value: o.value, label: o.label, on: nearlyEq(o.value, rec.currentSize![0]) })) };
    return {
      kind: 'dims',
      dims: r.dims.map((d, index) => ({ index, key: d.key, label: d.label, value: rec.currentSize![index] ?? 0, min: d.min, max: d.max, step: d.step, text: `${Math.round((rec.currentSize![index] ?? 0) * 100)} cm` })),
    };
  };
  const fittingEdit = (rec: FittingRecord): string | null => {
    if (!rec.moved && !rec.sized) return null;
    const parts: string[] = [];
    if (rec.moved) parts.push('Moved in your layout');
    if (rec.sized && rec.defaultSize) parts.push(`Your size: ${fittingSizeText(rec.size)}. Typical ${rec.resize?.kind === 'classes' ? rec.resize.label.toLowerCase() : 'size'}: ${defaultSizeText(rec)}`);
    else if (rec.sized) parts.push(`Your size: ${fittingSizeText(rec.size)}`);
    return `${parts.join('. ')}.`;
  };
  const defaultSizeText = (rec: FittingRecord): string => {
    const d = rec.defaultSize ?? [];
    const c = (v: number): string => String(Math.round(v * 100));
    if (rec.resize?.kind === 'classes') return rec.kind === 'fan' ? `${Math.round(d[0] * 1000)} mm` : `${c(d[0])} cm`;
    if (rec.resize?.kind === 'dims') return d.map((v) => c(v)).join(' × ') + ' cm';
    return `${c(d[0] ?? 0)} cm`;
  };
  const fittingView = (rec: FittingRecord): FittingSelection => ({
    id: rec.id, name: rec.name, sizeText: fittingSizeText(rec.size), mountText: mountText(rec), label: labelOf(rec), edit: fittingEdit(rec),
    canMove: rec.movable && !!rec.moveRule, canTurn: !!rec.moveRule && rec.moveRule.mount === 'floor' && !!rec.moveRule.turn,
    resize: resizeView(rec), canBackSize: rec.sized, canBackPlace: rec.moved, moving: fitMove !== null, at: `${rec.centre.x.toFixed(2)},${rec.centre.z.toFixed(2)}`,
    targetOk: fitMove?.target ? fitMove.target.ok : true, targetReason: fitMove?.target && !fitMove.target.ok ? fitMove.target.reason ?? null : null,
  });
  const removedFittings = (): FurnishView['removed'] => (fx ? fx.removed().map((r) => ({ id: r.id, label: `${r.name} (${labelOf(r).toLowerCase()})`, builtIn: false, fitting: true })) : []);
  /** the tray's list: every piece, labels numbered when two share a name ("Bed 1", "Bed 2") */
  const piecesList = (): FurnishView['pieces'] => {
    const all = store.all();
    const count = new Map<string, number>();
    for (const i of all) count.set(pieceName(i), (count.get(pieceName(i)) ?? 0) + 1);
    const seen = new Map<string, number>();
    return all.map((i) => {
      const name = pieceName(i);
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      return { id: i.id, label: (count.get(name) ?? 0) > 1 ? `${name} ${n}` : name, home: isHome(i.id) };
    });
  };
  const removedList = (): FurnishView['removed'] => [...(store.hiddenOriginals ? store.hiddenOriginals().map((i) => ({ id: i.id, label: pieceName(i), builtIn: builtIn(i) })) : []), ...removedFittings()];
  const extras = (): Pick<FurnishView, 'pieces' | 'removed' | 'edited'> => ({ pieces: piecesList(), removed: removedList(), edited: store.isEdited ? store.isEdited() : false });

  const computeView = (): FurnishView => {
    const bc = buyerCount();
    const ex = extras();
    const rec = fitRec();
    if (selectedFit && rec && !work) {
      const fit = fittingView(rec);
      const tone: Tone | null = fit.moving ? (fit.targetOk ? 'good' : 'bad') : null;
      const message = fit.moving
        ? (fit.targetOk ? 'Drag or tap where it should go, then Place.' : fit.targetReason ?? 'It cannot go there.')
        : `${fit.mountText}. ${fit.label.replace(/\.$/, '')}.`;
      return { phase: 'fitting', message, tone, canPlace: fit.moving && fit.targetOk, canRotate: false, canMove: fit.canMove, canRemove: true, buyerCount: bc, workKind: null, selection: null, fitting: fit, ...ex };
    }
    const s = subject();
    if (!s) return { phase: 'browse', message: BROWSE_TEXT, tone: null, canPlace: false, canRotate: false, canMove: false, canRemove: false, buyerCount: bc, workKind: null, selection: null, fitting: null, ...ex };
    if (work) {
      const r = check(s);
      let msg = withSwingNote(r.message, s.box, s.id);
      if (work.kind === 'replace' && work.replaces) {
        const orig = getItem(work.replaces);
        if (orig && builtIn(orig)) msg = `${msg} ${BUILT_IN_NOTE}.`;
      }
      if (work.kind === 'move' && isHome(work.item.id) && builtIn(work.item)) msg = `${msg} ${BUILT_IN_EDIT_NOTE}.`;
      return { phase: 'edit', message: msg, tone: r.tone, canPlace: r.verdict !== 'blocked', canRotate: true, canMove: false, canRemove: false, buyerCount: bc, workKind: work.kind, selection: null, fitting: null, ...ex };
    }
    const sel = selectionOf(s.item);
    if (sel.home) {
      const note = sel.builtIn ? ` ${BUILT_IN_NOTE}.` : '';
      // a piece as drawn is not checked (it is the record); one the viewer moved or resized gets the same live verdict as any placed piece
      if (!sel.edit) return { phase: 'selected', message: realItemNote() + note, tone: null, canPlace: false, canRotate: true, canMove: true, canRemove: true, buyerCount: bc, workKind: null, selection: sel, fitting: null, ...ex };
      const r = check(s);
      const editNoteText = sel.builtIn ? ` ${BUILT_IN_EDIT_NOTE}.` : '';
      return { phase: 'selected', message: withSwingNote(r.message, s.box, s.id) + editNoteText, tone: r.tone, canPlace: false, canRotate: true, canMove: true, canRemove: true, buyerCount: bc, workKind: null, selection: sel, fitting: null, ...ex };
    }
    const r = check(s);
    return { phase: 'selected', message: withSwingNote(r.message, s.box, s.id), tone: r.tone, canPlace: false, canRotate: true, canMove: true, canRemove: true, buyerCount: bc, workKind: null, selection: sel, fitting: null, ...ex };
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
      // a piece of the home as drawn keeps the teal outline and no clearance lines; once the viewer has moved or resized it, it is checked like any piece
      const real = !work && s.item.source === 'real' && !(store.isOriginalEdited?.(s.item.id) ?? false);
      const color = real ? LINE_COLOR : toneColor(r.tone);
      // the ribbon sits just outside the footprint, so a bed's frame does not hide it
      handles.push(ctx.overlays.outlineBox({ ...s.box, w: s.box.w + 2 * OUTLINE_RIBBON_M, d: s.box.d + 2 * OUTLINE_RIBBON_M }, OUTLINE_Y, color, tag));
      if (!real) {
        for (const l of clearanceLines(s.box, r.clearanceM)) handles.push(ctx.overlays.line(l.from, l.to, l.label, LINE_COLOR, tag));
      }
      if (work) setFurnitureTint(work.mesh, r.tone);
    }
    drawFittingBoxes();
    const v = computeView();
    const key = JSON.stringify(v);
    if (key !== lastView) { lastView = key; ui.render(v); }
  };

  /** a ghost or selection box in the scene: edges always, and a faint fill for a ghost. Never hit by a ray. */
  const boxGroup = (o: { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; yawDeg: number }, color: string, fill: boolean): THREE.Group => {
    const g = new THREE.Group();
    g.name = fill ? 'furnish-fitting-ghost' : 'furnish-fitting-selection';
    g.userData.decor = true;
    // a tiny fitting still gets a box a fingertip can see
    const sx = Math.max(0.1, o.hx * 2 + 0.03), sy = Math.max(0.1, o.hy * 2 + 0.03), sz = Math.max(0.1, o.hz * 2 + 0.03);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
    edges.renderOrder = 999;
    edges.raycast = () => {};
    g.add(edges);
    if (fill) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthTest: false, depthWrite: false }));
      m.renderOrder = 998;
      m.raycast = () => {};
      g.add(m);
    } else geo.dispose();
    g.scale.set(sx, sy, sz);
    g.position.set(o.cx, o.cy, o.cz);
    g.rotation.y = o.yawDeg * DEG;
    g.updateMatrixWorld(true);
    ctx.viewer.scene.add(g);
    return g;
  };
  const drawFittingBoxes = (): void => {
    if (fitSel) { disposeGroup(fitSel); fitSel = null; }
    if (fitGhost) { disposeGroup(fitGhost); fitGhost = null; }
    const rec = fitRec();
    if (!rec || work || rec.removed) return;
    fitSel = boxGroup({ cx: rec.centre.x, cy: rec.centre.y, cz: rec.centre.z, hx: rec.half.x, hy: rec.half.y, hz: rec.half.z, yawDeg: rec.yawDeg }, LINE_COLOR, false);
    const t = fitMove?.target;
    if (t) fitGhost = boxGroup(t.ghost, t.ok ? '#1E9E5A' : '#D64545', true);
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
      if (hasItem(w.item.id)) selectedId = w.item.id; // Cancel puts the piece back and leaves it selected
    }
    if (w.kind === 'replace' && w.replaces) {
      const m = store.mesh(w.replaces);
      if (m) m.visible = true;
      if (hasItem(w.replaces)) selectedId = w.replaces;
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

  const startWork = (kind: Work['kind'], item: FurnitureItem, spec: CatalogItem, box: Box, replaces?: string): Work => {
    const mesh = buildFurnitureMesh({ ...item, box: copyBox(box) });
    ctx.viewer.scene.add(mesh);
    const w: Work = { kind, item, spec, box: copyBox(box), origBox: copyBox(item.box), mesh, ...(replaces ? { replaces } : {}) };
    work = w;
    selectedId = null;
    selectedFit = null;
    fitMove = null;
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
      } else if (w.kind === 'replace' && w.replaces) {
        const orig = getItem(w.replaces);
        const m = store.mesh(w.replaces);
        if (m) m.visible = true;
        if (!store.replace?.(w.replaces, { ...w.item, box: copyBox(w.box) })) store.add({ ...w.item, box: copyBox(w.box) });
        if (orig && builtIn(orig)) ctx.hud.toast(`${BUILT_IN_NOTE}.`);
      } else {
        const m = store.mesh(id);
        if (m) m.visible = true;
        store.update(id, copyBox(w.box));
        if (isHome(id) && builtIn(w.item)) ctx.hud.toast(`${BUILT_IN_EDIT_NOTE}.`);
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
      const hadFit = selectedFit !== null;
      if (next === selectedId && !hadFit) return;
      selectedId = next;
      selectedFit = null;
      fitMove = null;
      touch();
      flush();
    },
    selected: () => selectedId,
    // ---- fittings
    selectFitting(id) {
      if (work) return;
      const next = id && fx?.get(id) && !fx.get(id)!.removed ? id : null;
      if (next === selectedFit && selectedId === null) return;
      selectedFit = next;
      fitMove = null;
      if (next) selectedId = null;
      touch();
      flush();
    },
    selectedFitting: () => selectedFit,
    beginFittingMove() {
      const rec = fitRec();
      if (!rec || !rec.moveRule || !rec.movable) return false;
      fitMove = { target: { spec: rec.moveRule.mount === 'floor' ? { m: 'f', x: rec.centre.x, z: rec.centre.z, yawDeg: rec.yawDeg } : rec.moveRule.mount === 'ceiling' ? { m: 'c', x: rec.centre.x, z: rec.centre.z } : { m: 'w', edge: rec.wall?.edge ?? 0, u: rec.wall?.u ?? 0, y: rec.wall?.y ?? rec.centre.y }, ok: true, ghost: { cx: rec.centre.x, cy: rec.centre.y, cz: rec.centre.z, hx: rec.half.x, hy: rec.half.y, hz: rec.half.z, yawDeg: rec.yawDeg } } };
      touch();
      flush();
      return true;
    },
    aimFitting(at) {
      const rec = fitRec();
      if (!rec || !fitMove || !fx) return null;
      const t = fx.target(rec, at);
      // the pointer is on nothing this fitting can stand on: the ghost stays where it was
      if (!t) return fitMove.target;
      fitMove = { target: t };
      touch();
      flush();
      return t;
    },
    placeFitting() {
      const rec = fitRec();
      if (!rec || !fitMove?.target || !fitMove.target.ok || !fx) return false;
      const spec = fitMove.target.spec;
      fitMove = null;
      fx.move(rec.id, spec);
      flushStore();
      nudgeCharacter();
      touch();
      flush();
      return true;
    },
    cancelFittingMove() {
      if (!fitMove) return;
      fitMove = null;
      touch();
      flush();
    },
    fittingMoving: () => fitMove !== null,
    moveFitting(id, spec) {
      const rec = fx?.get(id);
      if (!rec || !fx || !rec.moveRule) return false;
      fx.move(id, spec);
      flushStore();
      touch();
      flush();
      return true;
    },
    sizeFitting(values) {
      const rec = fitRec();
      if (!rec || !fx || !rec.resize) return false;
      fx.size(rec.id, values);
      flushStore();
      touch();
      flush();
      return true;
    },
    stepFitting(index, dir) {
      const rec = fitRec();
      if (!rec || !fx || rec.resize?.kind !== 'dims' || !rec.currentSize) return false;
      const d = rec.resize.dims[index];
      if (!d) return false;
      const cur = rec.currentSize[index];
      const next = Math.round(Math.min(d.max, Math.max(d.min, cur + dir * d.step)) * 100) / 100;
      if (Math.abs(next - cur) < 1e-9) return false;
      const values = [...rec.currentSize];
      values[index] = next;
      return session.sizeFitting(values);
    },
    turnFitting(deltaDeg = -ROTATE_BIG_DEG) {
      const rec = fitRec();
      if (!rec || !fx || rec.moveRule?.mount !== 'floor' || !rec.moveRule.turn) return false;
      const yaw = rotateYaw(rec.yawDeg, deltaDeg);
      const t = fx.target({ ...rec, yawDeg: yaw }, { wallPoint: null, floor: { x: rec.centre.x, z: rec.centre.z }, ceiling: null, rayDirXZ: null });
      if (!t?.ok) { ctx.hud.toast(t?.reason ?? 'It cannot turn there.'); return false; }
      fx.move(rec.id, { m: 'f', x: rec.centre.x, z: rec.centre.z, yawDeg: yaw });
      flushStore();
      touch();
      flush();
      return true;
    },
    backFittingSize() {
      const rec = fitRec();
      if (!rec || !fx) return false;
      fx.clearSize(rec.id);
      flushStore();
      touch();
      flush();
      return true;
    },
    backFittingPlace() {
      const rec = fitRec();
      if (!rec || !fx) return false;
      fx.clearMove(rec.id);
      flushStore();
      touch();
      flush();
      return true;
    },
    removeFitting(id) {
      const rid = id ?? selectedFit;
      if (!rid || !fx?.get(rid)) return false;
      fx.remove(rid);
      flushStore();
      if (selectedFit === rid) { selectedFit = null; fitMove = null; }
      touch();
      flush();
      return true;
    },
    restoreFitting(id) {
      if (!fx?.get(id)) return false;
      fx.restore(id);
      flushStore();
      selectedFit = id;
      selectedId = null;
      touch();
      flush();
      return true;
    },
    beginMove() {
      if (work || !selectedId) return false;
      const item = getItem(selectedId);
      // a placed piece, or a piece of the home (moved in this viewer's layout only)
      if (!item || (item.source === 'real' && !isHome(item.id))) return false;
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
      if (work && (work.item.id === id || work.replaces === id)) discardWork();
      const item = getItem(id);
      if (!item) return false;
      if (isHome(id)) { if (!store.hideOriginal?.(id)) return false; }
      else store.remove(id);
      flushStore();
      if (selectedId === id) selectedId = null;
      touch();
      flush();
      return true;
    },
    replaceSelected(catalogId) {
      const fromId = work?.kind === 'replace' ? work.replaces : selectedId;
      if (!fromId) return null;
      const orig = getItem(fromId);
      if (!orig) return null;
      let spec: CatalogItem;
      try { spec = catalogItem(catalogId); } catch { return null; }
      if (work) discardWork();
      const raw = replacementBox(orig.box, spec);
      const holeFree = ctx.gridWithout([orig.id]);
      const box = snapToWalls(holeFree, raw);
      const next = itemFromCatalog(catalogId, box, 'virtual');
      const kept = sanitizeFinish(finishFamily(next), orig.finish);
      if (kept) next.finish = kept;
      const m = store.mesh(orig.id);
      if (m) m.visible = false;
      selectedId = orig.id;
      startWork('replace', next, spec, box, orig.id);
      flush();
      return verdictOf();
    },
    rotateSelected(deltaDeg = -ROTATE_BIG_DEG) {
      if (!session.beginMove()) return false;
      session.rotate(deltaDeg);
      return true;
    },
    pick(key, id) {
      if (work || !selectedId) return false;
      const item = getItem(selectedId);
      const family = item ? finishFamily(item) : null;
      if (!item || !family || !store.setFinish) return false;
      const next = withPick(family, item.finish, key, id);
      const ok = store.setFinish(item.id, next ?? null);
      flushStore();
      touch();
      flush();
      return ok;
    },
    surprise() {
      if (work || !selectedId) return null;
      const item = getItem(selectedId);
      const family = item ? finishFamily(item) : null;
      if (!item || !family || !store.setFinish) return null;
      const next = surpriseFinish(family, item.finish);
      store.setFinish(item.id, next);
      flushStore();
      touch();
      flush();
      return next;
    },
    clearLook() {
      if (work || !selectedId || !store.setFinish) return false;
      const ok = store.setFinish(selectedId, null);
      flushStore();
      touch();
      flush();
      return ok;
    },
    resizeSelected(key, value) {
      if (work || !selectedId || !store.editOriginal) return false;
      const item = getItem(selectedId);
      if (!item || !isHome(item.id)) return false;
      const ok = store.editOriginal(item.id, resizePatch(item, drawnOf(item.id), key, value, ceilingM()));
      flushStore();
      touch();
      flush();
      return ok;
    },
    stepSelected(key, dir) {
      if (work || !selectedId) return false;
      const item = getItem(selectedId);
      if (!item) return false;
      const lim = sizeLimits(item, ceilingM()).find((l) => l.key === key);
      if (!lim) return false;
      const cur = sizeValues(item)[key];
      return session.resizeSelected(key, Math.round((cur + dir * lim.step) * 100) / 100);
    },
    backToDrawn(what) {
      if (work || !selectedId || !store.restoreDrawn) return false;
      const ok = store.restoreDrawn(selectedId, what);
      flushStore();
      touch();
      flush();
      return ok;
    },
    restore(id) {
      const ok = store.restoreOriginal?.(id) ?? false;
      if (ok) { flushStore(); selectedId = id; touch(); flush(); }
      return ok;
    },
    resetLayout() {
      discardWork();
      selectedId = null;
      selectedFit = null;
      fitMove = null;
      store.reset?.();
      flushStore();
      nudgeCharacter();
      touch();
      flush();
    },
    shareLink(href) {
      return shareUrl(href, store.layout ? store.layout() : emptyLayout());
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
      selectedFit = null;
      fitMove = null;
      if (fitSel) { disposeGroup(fitSel); fitSel = null; }
      if (fitGhost) { disposeGroup(fitGhost); fitGhost = null; }
      clearOverlays();
      offStore();
      offFit();
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
  selected: 'Furnish · change, replace or remove it',
  fitting: 'Furnish · move, resize or remove it',
} as const;

export interface FurnishModeOptions {
  /** ids of the pieces the drawing's designs file describes (with the scene origin they decide which pieces are built-ins) */
  designedIds?: ReadonlySet<string>;
}

export function createFurnishMode(ctx: BuyerContext, modeOpts: FurnishModeOptions = {}): FurnishMode {
  const touch = isTouchDevice();
  let session!: FurnishSession;
  const origin = sceneOrigin({ id: ctx.property.id, subtitle: ctx.property.subtitle, hasSplat: !!ctx.property.splat });
  const designed = modeOpts.designedIds ?? new Set<string>();
  const builtInOf = (item: FurnitureItem): boolean => isBuiltIn(item, { origin, designed });

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
  const barName = h('div', 'wtf-name', text);
  const barNote = h('div', 'wtf-note', text);
  barNote.dataset.testid = 'furnish-edit-note';
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
  const setLabel = (b: HTMLElement, label: string): void => { (b.querySelector('span') ?? b).textContent = label; };
  let lastView: FurnishView | null = null;
  const bRotate = btn('Rotate', 'is-ghost', () => session.rotate(-ROTATE_BIG_DEG), ROTATE_ICON);
  bRotate.dataset.act = 'rotate';
  const bCancel = btn('Cancel', 'is-ghost', () => { if (session.fittingMoving()) session.cancelFittingMove(); else session.cancel(); });
  bCancel.dataset.act = 'cancel';
  const bPlace = btn('Place', 'is-primary', () => {
    if (session.fittingMoving()) {
      if (!session.placeFitting()) ctx.hud.toast(lastView?.fitting?.targetReason ?? 'It cannot go there.');
    } else session.place();
  });
  bPlace.dataset.act = 'place';
  const onFitting = (): boolean => lastView?.phase === 'fitting';
  const bMove = btn('Move', 'is-ghost', () => { if (onFitting()) session.beginFittingMove(); else session.beginMove(); });
  bMove.dataset.act = 'move';
  const bTurn = btn('Rotate', 'is-ghost', () => { if (onFitting()) session.turnFitting(); else session.rotateSelected(); }, ROTATE_ICON);
  bTurn.dataset.act = 'turn';
  const bSize = btn('Resize', 'is-ghost', () => setPanel(panelOpen === 'size' ? null : 'size'));
  bSize.dataset.act = 'size';
  const bReplace = btn('Replace', 'is-ghost', () => setPanel(panelOpen === 'replace' ? null : 'replace'));
  bReplace.dataset.act = 'replace';
  const bLook = btn('Change look', 'is-ghost', () => setPanel(panelOpen === 'look' ? null : 'look'));
  bLook.dataset.act = 'look';
  // Remove asks twice for a built-in of a real drawing: hiding it needs its note read (BUILT_IN_NOTE sits in the bar above)
  let removeArmed = false;
  let removeTimer: ReturnType<typeof setTimeout> | null = null;
  const disarmRemove = (): void => {
    removeArmed = false;
    if (removeTimer) { clearTimeout(removeTimer); removeTimer = null; }
    bRemove.classList.remove('is-armed');
    if (lastView?.selection) setLabel(bRemove, removeLabel(lastView.selection));
  };
  const removeLabel = (sel: FurnishSelection): string => (sel.builtIn ? 'Hide in my layout' : 'Remove');
  const bRemove = btn('Remove', 'is-danger', () => {
    const sel = lastView?.selection;
    if (sel?.builtIn && !removeArmed) {
      removeArmed = true;
      bRemove.classList.add('is-armed');
      setLabel(bRemove, 'Tap again to hide');
      removeTimer = setTimeout(disarmRemove, 3500);
      return;
    }
    disarmRemove();
    if (onFitting()) {
      const fit = lastView?.fitting;
      if (fit && session.removeFitting()) ctx.hud.toast(`${fit.name} removed in your layout. Undo is in the list. The home as drawn does not change.`);
      return;
    }
    const name = sel?.name ?? 'piece';
    const home = !!sel?.home;
    if (session.removeSelected() && home) ctx.hud.toast(`${name} hidden in your layout. The home as drawn does not change.`);
  });
  bRemove.dataset.act = 'remove';

  // ---- the panels under the bar: Replace and Change look
  let panelOpen: 'replace' | 'look' | 'size' | null = null;
  const panel = h('div', 'wtf-panel', root);
  panel.dataset.ui = '1';
  panel.dataset.testid = 'furnish-panel';
  panel.hidden = true;

  const setPanel = (p: 'replace' | 'look' | 'size' | null): void => {
    panelOpen = p;
    disarmRemove();
    renderPanel();
    // the tray and the long message step aside while a panel is open (the class normally follows the next render: do it now)
    root.classList.toggle('has-panel', !!p && (lastView?.phase === 'selected' || lastView?.phase === 'fitting'));
    bReplace.classList.toggle('is-on', p === 'replace');
    bLook.classList.toggle('is-on', p === 'look');
    bSize.classList.toggle('is-on', p === 'size');
  };

  const specCard = (parent: HTMLElement, spec: CatalogItem, onPick: () => void): void => {
    const c = h('button', 'wtf-item', parent);
    c.type = 'button';
    c.dataset.ui = '1';
    c.dataset.catalogId = spec.id;
    c.title = cardLabel(spec);
    c.setAttribute('aria-label', cardLabel(spec));
    const ic = h('span', 'wtf-item-icon', c);
    ic.innerHTML = icon(spec.kind);
    h('span', 'wtf-item-name', c, spec.name);
    h('span', 'wtf-item-size', c, spec.sizeLabel);
    c.addEventListener('click', (e) => { e.stopPropagation(); onPick(); c.blur(); });
  };

  const renderPanel = (): void => {
    panel.textContent = '';
    const v = lastView;
    const sel = v?.selection ?? null;
    const fit = v?.fitting ?? null;
    // Resize: the steppers of a piece of the home, or the size options of a fitting
    if (panelOpen === 'size' && ((v?.phase === 'selected' && sel?.sizes) || (v?.phase === 'fitting' && fit?.resize && !fit.moving))) {
      panel.hidden = false;
      const topS = h('div', 'wtf-panel-head', panel);
      h('div', 'wtf-panel-title', topS, `Resize · ${sel?.name ?? fit?.name ?? ''}`);
      const doneS = h('button', 'wtf-link is-strong', topS, 'Done');
      doneS.type = 'button'; doneS.dataset.ui = '1'; doneS.dataset.act = 'panel-close';
      doneS.addEventListener('click', (e) => { e.stopPropagation(); setPanel(null); });
      const stepper = (parent: HTMLElement, label: string, text: string, key: string, canDown: boolean, canUp: boolean, down: () => void, up: () => void): void => {
        const rowEl = h('div', 'wtf-step', parent);
        h('div', 'wtf-step-label', rowEl, label);
        const minus = h('button', 'wtf-step-btn', rowEl, '−');
        minus.type = 'button'; minus.dataset.ui = '1'; minus.dataset.step = `${key}-`; minus.setAttribute('aria-label', `${label} smaller`); minus.disabled = !canDown;
        minus.addEventListener('click', (e) => { e.stopPropagation(); down(); minus.blur(); });
        const val = h('div', 'wtf-step-val', rowEl, text);
        val.dataset.stepValue = key;
        const plus = h('button', 'wtf-step-btn', rowEl, '+');
        plus.type = 'button'; plus.dataset.ui = '1'; plus.dataset.step = `${key}+`; plus.setAttribute('aria-label', `${label} larger`); plus.disabled = !canUp;
        plus.addEventListener('click', (e) => { e.stopPropagation(); up(); plus.blur(); });
      };
      if (v?.phase === 'selected' && sel?.sizes) {
        const steps = h('div', 'wtf-steps', panel);
        for (const z of sel.sizes) {
          stepper(steps, z.label, `${Math.round(z.value * 100)} cm`, z.key, z.value > z.min + 1e-6, z.value < z.max - 1e-6, () => session.stepSelected(z.key, -1), () => session.stepSelected(z.key, 1));
        }
        const tools = h('div', 'wtf-panel-tools', panel);
        const bs = h('button', 'wtf-chipbtn', tools, BACK_TO_DRAWN_SIZE);
        bs.type = 'button'; bs.dataset.ui = '1'; bs.dataset.act = 'back-size'; bs.disabled = !sel.canBackSize;
        bs.addEventListener('click', (e) => { e.stopPropagation(); session.backToDrawn('size'); });
        const bp = h('button', 'wtf-chipbtn', tools, BACK_TO_DRAWN_PLACE);
        bp.type = 'button'; bp.dataset.ui = '1'; bp.dataset.act = 'back-place'; bp.disabled = !sel.canBackPlace;
        bp.addEventListener('click', (e) => { e.stopPropagation(); session.backToDrawn('place'); });
        h('div', 'wtf-panel-note', panel, 'Your size is a try-out. The drawing keeps its own size and says so on the card.');
      } else if (fit?.resize) {
        const r = fit.resize;
        if (r.kind === 'classes') {
          h('div', 'wtf-sub', panel, r.label);
          const row = h('div', 'wtf-slot-opts', panel);
          for (const o of r.options) {
            const b = h('button', `wtf-style${o.on ? ' is-on' : ''}`, row, o.label);
            b.type = 'button'; b.dataset.ui = '1'; b.dataset.size = String(o.value); b.setAttribute('aria-pressed', String(o.on));
            b.addEventListener('click', (e) => { e.stopPropagation(); session.sizeFitting([o.value]); });
          }
        } else {
          const steps = h('div', 'wtf-steps', panel);
          for (const d of r.dims) stepper(steps, d.label, d.text, d.key, d.value > d.min + 1e-6, d.value < d.max - 1e-6, () => session.stepFitting(d.index, -1), () => session.stepFitting(d.index, 1));
        }
        const tools = h('div', 'wtf-panel-tools', panel);
        const bs = h('button', 'wtf-chipbtn', tools, 'Back to default size');
        bs.type = 'button'; bs.dataset.ui = '1'; bs.dataset.act = 'back-size'; bs.disabled = !fit.canBackSize;
        bs.addEventListener('click', (e) => { e.stopPropagation(); session.backFittingSize(); });
        h('div', 'wtf-panel-note', panel, 'These sizes are a try-out. The home as drawn does not change.');
      }
      return;
    }
    const show = !!panelOpen && !!sel && v?.phase === 'selected' && panelOpen !== 'size';
    panel.hidden = !show;
    if (!show || !sel) return;
    const top = h('div', 'wtf-panel-head', panel);
    if (panelOpen === 'replace') {
      h('div', 'wtf-panel-title', top, `Replace ${sel.name}`);
      const x = h('button', 'wtf-link', top, 'Close');
      x.type = 'button'; x.dataset.ui = '1'; x.dataset.act = 'panel-close';
      x.addEventListener('click', (e) => { e.stopPropagation(); setPanel(null); });
      const item = ctx.furniture.all().find((i) => i.id === sel.id);
      if (!item) return;
      const { same, other } = replacementChoices(item);
      h('div', 'wtf-panel-note', panel, 'It lands at the same spot, squared to the wall, and the fit check runs. A replacement shows its own catalogue size.');
      if (sel.builtIn) h('div', 'wtf-panel-note is-strong', panel, `${BUILT_IN_NOTE}.`);
      if (same.length > 0) {
        h('div', 'wtf-sub', panel, 'Same kind');
        const row = h('div', 'wtf-cards', panel);
        for (const spec of same) specCard(row, spec, () => { session.replaceSelected(spec.id); setPanel(null); });
      }
      h('div', 'wtf-sub', panel, same.length > 0 ? 'Anything else' : 'Pick a piece');
      const row2 = h('div', 'wtf-cards', panel);
      for (const spec of other) specCard(row2, spec, () => { session.replaceSelected(spec.id); setPanel(null); });
      return;
    }
    // Change look
    const fam = sel.family;
    if (!fam) { panel.hidden = true; return; }
    h('div', 'wtf-panel-title', top, `Change look · ${sel.name}`);
    const x = h('button', 'wtf-link is-strong', top, 'Done');
    x.type = 'button'; x.dataset.ui = '1'; x.dataset.act = 'panel-close';
    x.addEventListener('click', (e) => { e.stopPropagation(); setPanel(null); });
    const tools = h('div', 'wtf-panel-tools', panel);
    const surprise = h('button', 'wtf-chipbtn', tools, 'Surprise me');
    surprise.type = 'button'; surprise.dataset.ui = '1'; surprise.dataset.act = 'surprise';
    surprise.addEventListener('click', (e) => { e.stopPropagation(); session.surprise(); });
    const def = h('button', 'wtf-chipbtn', tools, 'As it was');
    def.type = 'button'; def.dataset.ui = '1'; def.dataset.act = 'look-default';
    def.disabled = !sel.finish;
    def.addEventListener('click', (e) => { e.stopPropagation(); session.clearLook(); });
    const slots = h('div', 'wtf-slots', panel);
    for (const slot of FAMILY_SLOTS[fam]) {
      const rowEl = h('div', 'wtf-slot', slots);
      h('div', 'wtf-slot-label', rowEl, slot.label);
      const opts = h('div', 'wtf-slot-opts', rowEl);
      const cur = sel.finish?.[slot.key];
      for (const id of slot.options) {
        if (slot.key === 'style') {
          const st = BED_STYLES.find((s) => s.id === id)!;
          const b = h('button', `wtf-style${cur === id ? ' is-on' : ''}`, opts, st.name);
          b.type = 'button'; b.dataset.ui = '1'; b.dataset.slot = slot.key; b.dataset.pick = id;
          b.setAttribute('aria-pressed', String(cur === id));
          b.addEventListener('click', (e) => { e.stopPropagation(); session.pick(slot.key, cur === id ? null : id); });
          continue;
        }
        const sw = swatch(id)!;
        const b = h('button', `wtf-swatch${cur === id ? ' is-on' : ''}`, opts);
        b.type = 'button'; b.dataset.ui = '1'; b.dataset.slot = slot.key; b.dataset.pick = id;
        b.style.setProperty('--sw', sw.hex);
        b.title = sw.name;
        b.setAttribute('aria-label', `${slot.label}: ${sw.name}`);
        b.setAttribute('aria-pressed', String(cur === id));
        b.addEventListener('click', (e) => { e.stopPropagation(); session.pick(slot.key, cur === id ? null : id); });
      }
    }
    h('div', 'wtf-panel-note', panel, 'Colours and styles are illustrative. Sizes are exact.');
  };

  // ---- the tray
  const tray = h('div', 'wtf-tray', root);
  tray.dataset.ui = '1';
  const head = h('div', 'wtf-head', tray);
  const titleEl = h('div', 'wtf-title', head, 'Add furniture');
  const headRight = h('div', 'wtf-head-right', head);
  const clearBtn = h('button', 'wtf-link', headRight, 'Clear all');
  clearBtn.type = 'button';
  clearBtn.dataset.ui = '1';
  clearBtn.dataset.act = 'clear';
  const doneBtn = h('button', 'wtf-link is-strong', headRight, 'Done');
  doneBtn.type = 'button';
  doneBtn.dataset.ui = '1';
  doneBtn.dataset.act = 'done';

  // "Your layout · edited", with Share and Reset
  const mineRow = h('div', 'wtf-mine', tray);
  mineRow.dataset.ui = '1';
  mineRow.dataset.testid = 'my-layout-row';
  mineRow.hidden = true;
  const mineText = h('div', 'wtf-mine-text', mineRow);
  h('span', 'wtf-mine-chip', mineText, EDITED_CHIP);
  h('span', 'wtf-mine-note', mineText, OVERLAY_NOTE);
  const mineBtns = h('div', 'wtf-mine-btns', mineRow);
  const shareBtn = h('button', 'wtf-link', mineBtns, 'Share');
  shareBtn.type = 'button'; shareBtn.dataset.ui = '1'; shareBtn.dataset.act = 'share';
  const resetBtn = h('button', 'wtf-link', mineBtns, RESET_LABEL);
  resetBtn.type = 'button'; resetBtn.dataset.ui = '1'; resetBtn.dataset.act = 'reset';

  // the pieces in this home, as chips, and the originals removed from it
  const piecesWrap = h('div', 'wtf-pieces-wrap', tray);
  h('div', 'wtf-sub', piecesWrap, 'In this home');
  const pieces = h('div', 'wtf-pieces', piecesWrap);
  pieces.dataset.ui = '1';
  pieces.dataset.testid = 'furnish-pieces';
  const removedWrap = h('div', 'wtf-removed', tray);
  removedWrap.dataset.ui = '1';
  removedWrap.dataset.testid = 'furnish-removed';

  const addLabel = h('div', 'wtf-sub', tray, 'Add furniture');
  const cards = h('div', 'wtf-cards', tray);
  cards.dataset.ui = '1';
  for (const spec of CATALOG) specCard(cards, spec, () => { session.spawn(spec.id); });

  const renderPieces = (v: FurnishView): void => {
    pieces.textContent = '';
    for (const p of v.pieces) {
      const b = h('button', `wtf-piece${v.selection?.id === p.id ? ' is-on' : ''}`, pieces, p.label);
      b.type = 'button'; b.dataset.ui = '1'; b.dataset.itemId = p.id;
      if (!p.home) b.classList.add('is-mine');
      b.addEventListener('click', (e) => { e.stopPropagation(); session.select(v.selection?.id === p.id ? null : p.id); b.blur(); });
    }
    piecesWrap.hidden = v.pieces.length === 0;
  };
  const renderRemoved = (v: FurnishView): void => {
    removedWrap.textContent = '';
    removedWrap.hidden = v.removed.length === 0;
    for (const r of v.removed) {
      const row = h('div', 'wtf-removed-row', removedWrap);
      const t = h('div', 'wtf-removed-text', row);
      h('span', 'wtf-removed-name', t, r.fitting ? `Removed: ${r.label}` : `Removed: ${r.label} (as drawn)`);
      if (r.builtIn) h('span', 'wtf-removed-note', t, `${BUILT_IN_NOTE}.`);
      const u = h('button', 'wtf-link', row, 'Undo');
      u.type = 'button'; u.dataset.ui = '1'; u.dataset.act = 'undo'; u.dataset.itemId = r.id;
      u.addEventListener('click', (e) => { e.stopPropagation(); if (r.fitting) session.restoreFitting(r.id); else session.restore(r.id); });
    }
  };

  // Clear all and Reset ask twice (a stray tap must not wipe the buyer's layout)
  const armable = (b: HTMLButtonElement, idle: string, armed: string, run: () => void): { disarm(): void } => {
    let on = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const disarmIt = (): void => {
      on = false;
      if (timer) { clearTimeout(timer); timer = null; }
      b.textContent = idle;
      b.classList.remove('is-armed');
    };
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!on) {
        on = true;
        b.textContent = armed;
        b.classList.add('is-armed');
        timer = setTimeout(disarmIt, 3000);
        return;
      }
      disarmIt();
      run();
    });
    return { disarm: disarmIt };
  };
  const clearArm = armable(clearBtn, 'Clear all', 'Tap again to clear all', () => {
    const n = session.clearAll();
    if (n > 0) ctx.hud.toast(n === 1 ? 'Removed 1 item.' : `Removed ${n} items.`);
  });
  const resetArm = armable(resetBtn, RESET_LABEL, 'Tap again to reset', () => {
    session.resetLayout();
    ctx.hud.toast('Back to the home as drawn.');
  });
  const disarm = (): void => { clearArm.disarm(); resetArm.disarm(); disarmRemove(); };
  doneBtn.addEventListener('click', (e) => { e.stopPropagation(); ctx.setMode('walk'); });
  shareBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const url = session.shareLink(location.href);
    void (async () => {
      try {
        if (touch && typeof navigator.share === 'function') { await navigator.share({ title: `${ctx.property.title} · my layout`, url }); return; }
      } catch { /* cancelled or unsupported: fall through to copy */ }
      try {
        await navigator.clipboard.writeText(url);
        ctx.hud.toast('Link copied. Anyone who opens it sees your arrangement.');
      } catch {
        try { window.prompt('Copy this link to share your layout', url); } catch { ctx.hud.toast('Could not copy the link here.'); }
      }
    })();
  });

  let active = false;
  let lastSelId: string | null = null;
  const releaseCam = (): void => { (ctx.camera as { releaseFocus?(): void }).releaseFocus?.(); };
  /** swing the camera round the piece, with its pivot a little in front so the piece sits above the panels */
  const focusPiece = (id: string): void => {
    const item = ctx.furniture.all().find((i) => i.id === id);
    const cam = ctx.camera as { focusOn?(c: Vec3, d: number, p: number, y?: number): void };
    if (!item || !cam.focusOn) return;
    const { w, d } = item.box;
    // far enough that the piece fits the screen's width: a phone held upright sees much less sideways than a laptop
    const cv = ctx.viewer.camera as { fov?: number; aspect?: number };
    const aspect = typeof cv.aspect === 'number' && cv.aspect > 0 ? cv.aspect : 1.6;
    const hHalf = Math.tan(((typeof cv.fov === 'number' ? cv.fov : 50) * DEG) / 2) * aspect;
    const fit = (Math.max(w, d) / 2 + 0.3) / Math.max(0.2, hHalf);
    const dist = Math.min(5, Math.max(2.3, Math.max(w, d) * 1.25 + 0.9, fit));
    const shift = Math.min(0.8, Math.max(0.3, dist * 0.18));
    const { a } = boxAxes(item.box);
    cam.focusOn({ x: item.box.cx + a.x * shift, y: Math.min(1.0, item.heightM * 0.45), z: item.box.cz + a.z * shift }, dist, 52, item.box.yawDeg + 180);
  };
  /** swing the camera to a fitting: wall pieces from the room side, ceiling pieces looking up, floor pieces from above */
  const focusFitting = (id: string): void => {
    const rec = ctx.fittings?.get(id);
    const cam = ctx.camera as { focusOn?(c: Vec3, d: number, p: number, y?: number): void };
    if (!rec || !cam.focusOn) return;
    const big = Math.max(rec.half.x, rec.half.z) * 2;
    // the walker looks toward it, so the camera stands on this side of it, inside the room
    const from = ctx.character.position;
    const toward = (x: number, z: number): number => (Math.atan2(x - from.x, z - from.z) * 180) / Math.PI;
    if (rec.mount === 'wall') cam.focusOn({ x: rec.centre.x, y: Math.min(rec.centre.y, 1.6), z: rec.centre.z }, Math.min(3.4, Math.max(2.2, big * 1.4 + 1.6)), 14, rec.yawDeg + 180);
    else if (rec.mount === 'ceiling') cam.focusOn({ x: rec.centre.x, y: Math.max(1.2, rec.centre.y - 0.6), z: rec.centre.z }, Math.min(3.6, Math.max(2.4, big + 2)), -12, toward(rec.centre.x, rec.centre.z));
    // a fitting on the floor (rug, plant, chair): the viewer tapped it, so it is already in view, and under a bed or a desk a swing of the camera would end inside the furniture
  };
  let lastFitId: string | null = null;
  let lastFitAt = '';
  const ui: FurnishUi = {
    render(v) {
      lastView = v;
      // a different piece, or none: the panel and a half-confirmed Remove close, and the camera swings to the piece (or lets go)
      const selId = v.selection?.id ?? v.fitting?.id ?? null;
      if (selId !== lastSelId) {
        lastSelId = selId; panelOpen = null; disarmRemove();
        if (active) {
          if (selId && v.selection) focusPiece(selId);
          else if (selId && v.fitting) focusFitting(selId);
          else if (v.phase === 'browse') releaseCam();
        }
      }
      const fit = v.phase === 'fitting' ? v.fitting : null;
      // a fitting that was moved: the camera goes with it (not while its ghost is being aimed)
      if (fit && selId === lastSelId && fit.id === lastFitId && fit.at !== lastFitAt && !fit.moving && active) focusFitting(fit.id);
      lastFitId = fit?.id ?? null; lastFitAt = fit?.at ?? '';
      barName.textContent = v.selection
        ? `${v.selection.name} · ${v.selection.sizeText}${v.selection.home ? (v.selection.edit ? ' · in your layout' : ' · as drawn') : ''}${v.selection.finishText ? ` · ${v.selection.finishText}` : ''}`
        : fit ? `${fit.name} · ${fit.sizeText}${fit.edit ? ' · in your layout' : ''}` : '';
      barName.hidden = !v.selection && !fit;
      const note = v.selection?.edit ?? fit?.edit ?? null;
      barNote.textContent = note ?? '';
      barNote.hidden = !note;
      barMsg.textContent = v.message;
      bar.dataset.tone = v.tone ?? 'none';
      bar.dataset.phase = v.phase;
      const fitMoving = !!fit?.moving;
      barHint.textContent = v.phase === 'edit'
        ? (v.workKind === 'replace' ? 'Drag to adjust. ' : '') + (touch ? 'Drag it to move. Tap Rotate to turn it.' : 'Drag to move. Q / E turn it, R for a quarter turn.')
        : fitMoving ? (touch ? 'Drag on the wall, ceiling or floor, or tap a spot. Place when the box is green.' : 'Drag or click on the wall, ceiling or floor. Place when the box is green.') : '';
      barHint.hidden = !(v.phase === 'edit' || fitMoving);
      const showEdit = v.phase === 'edit' || fitMoving;
      const sel = v.phase === 'selected' && !!v.selection;
      const fitIdle = !!fit && !fitMoving;
      bRotate.hidden = !(v.phase === 'edit');
      bCancel.hidden = bPlace.hidden = !showEdit;
      setLabel(bPlace, v.workKind === 'replace' ? 'Replace' : 'Place');
      bMove.hidden = !((sel && v.canMove) || (fitIdle && fit!.canMove));
      bTurn.hidden = !((sel && v.canRotate) || (fitIdle && fit!.canTurn));
      bSize.hidden = !((sel && !!v.selection?.sizes) || (fitIdle && !!fit!.resize));
      bReplace.hidden = !sel;
      bLook.hidden = !sel || !v.selection?.family;
      bRemove.hidden = !((sel && v.canRemove) || fitIdle);
      if (v.selection && !removeArmed) setLabel(bRemove, removeLabel(v.selection));
      else if (fitIdle && !removeArmed) setLabel(bRemove, 'Remove');
      bReplace.classList.toggle('is-on', panelOpen === 'replace');
      bLook.classList.toggle('is-on', panelOpen === 'look');
      bSize.classList.toggle('is-on', panelOpen === 'size');
      actions.hidden = !(showEdit || sel || fitIdle);
      bPlace.disabled = !v.canPlace;
      clearBtn.hidden = v.buyerCount === 0;
      if (v.buyerCount === 0) clearArm.disarm();
      mineRow.hidden = !v.edited;
      if (!v.edited) resetArm.disarm();
      const selected = sel || fitIdle;
      root.classList.toggle('is-selected', selected);
      root.classList.toggle('has-panel', selected && !!panelOpen);
      cards.classList.toggle('is-editing', showEdit);
      tray.classList.toggle('is-editing', showEdit);
      tray.classList.toggle('is-selected', selected);
      titleEl.textContent = 'Add furniture';
      addLabel.hidden = showEdit || selected;
      cards.hidden = selected;
      piecesWrap.classList.toggle('is-quiet', showEdit);
      renderPieces(v);
      renderRemoved(v);
      removedWrap.classList.toggle('is-quiet', showEdit);
      renderPanel();
      if (active) ctx.hud.setModeBar(MODE_TEXT[v.phase], () => ctx.setMode('walk'));
    },
  };
  session = createFurnishSession(ctx, ui, { builtIn: builtInOf });

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
  /** where the pointer is pointing, for a fitting that is being moved: on a wall, on the ceiling, on the floor */
  const aimAt = (e: PointerEvt): void => {
    const ray = ctx.rayOf?.(e);
    const l = ray ? Math.hypot(ray.dir.x, ray.dir.z) : 0;
    session.aimFitting({
      wallPoint: ctx.raycastWalls?.(e) ?? null, floor: ctx.raycastFloor(e), ceiling: ctx.raycastCeiling?.(e) ?? null,
      rayDirXZ: ray && l > 1e-6 ? { x: ray.dir.x / l, z: ray.dir.z / l } : null,
    });
  };
  const claim = (e: PointerEvt): boolean => {
    if (!active) return false;
    // a fitting being moved: the ghost follows the pointer (a tap sets it too); Place commits
    if (session.fittingMoving()) {
      aimAt(e);
      return true;
    }
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
      const id = o.userData?.itemId ?? o.userData?.openableFor;
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
          if (!active || session.working() || session.fittingMoving()) return;
          // one hit-test for furniture and fittings: the nearest thing under the tap; empty wall or floor clears the selection
          const hit = ctx.pickAt?.(e) ?? null;
          if (hit?.kind === 'fitting') session.selectFitting(hit.id);
          else session.select(hit ? hit.id : itemIdAt(e));
        }),
      ];
      session.select(null);
      ctx.hud.hideCard();
      ui.render(session.view());
    },
    exit() {
      active = false;
      session.cancelFittingMove();
      session.cancel();
      session.select(null);
      releaseCam();
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
    /** Replace the selected piece with a catalogue one (a preview with a verdict; `place()` commits) */
    replace: (catalogId: string) => s.replaceSelected(catalogId),
    turn: (deg?: number) => s.rotateSelected(deg),
    /** a choice for the selected piece's look, e.g. pick('fabric', 'fab-teal'); null clears it */
    pick: (key: FinishSlotKey, id: string | null) => s.pick(key, id),
    surprise: () => s.surprise(),
    clearLook: () => s.clearLook(),
    restore: (id: string) => s.restore(id),
    reset: () => s.resetLayout(),
    shareLink: () => s.shareLink(location.href),
    clearAll: () => s.clearAll(),
    /** sizes of a piece of the home: resize('w', 1.5), step('d', 1), backToDrawn('both') */
    resize: (key: SizeKey, value: number) => s.resizeSelected(key, value),
    step: (key: SizeKey, dir: 1 | -1) => s.stepSelected(key, dir),
    backToDrawn: (what: 'size' | 'place' | 'both' = 'both') => s.backToDrawn(what),
    /** fittings: fittings() lists them, selectFitting(id), moveFitting(id, spec), sizeFitting([m]), stepFitting(i, +1), removeFitting(), restoreFitting(id) */
    fittings: () => ctx.fittings?.list().map((r) => ({ id: r.id, kind: r.kind, name: r.name, mount: r.mount, room: r.roomId, removed: r.removed, moved: r.moved, sized: r.sized, size: r.size, centre: r.centre, wall: r.wall ?? null, resize: r.resize, current: r.currentSize })) ?? [],
    selectFitting: (id: string | null) => { s.selectFitting(id); return s.view(); },
    beginFittingMove: () => s.beginFittingMove(),
    aimFitting: (at: Parameters<typeof s.aimFitting>[0]) => s.aimFitting(at),
    placeFitting: () => s.placeFitting(),
    cancelFittingMove: () => s.cancelFittingMove(),
    moveFitting: (id: string, spec: import('../look/fittings').MoveSpec) => s.moveFitting(id, spec),
    sizeFitting: (values: number[]) => s.sizeFitting(values),
    stepFitting: (i: number, dir: 1 | -1) => s.stepFitting(i, dir),
    turnFitting: (deg?: number) => s.turnFitting(deg),
    backFittingSize: () => s.backFittingSize(),
    backFittingPlace: () => s.backFittingPlace(),
    removeFitting: (id?: string) => s.removeFitting(id),
    restoreFitting: (id: string) => s.restoreFitting(id),
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
