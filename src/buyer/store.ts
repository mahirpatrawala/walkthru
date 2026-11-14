// Owned by C3. Pure helpers (nearest interactable, room chip text, height + placed-items persistence) and the
// FurnitureStore (SPEC 7.1). three is used only for meshes and runs under Node; `localStorage` is always injected.
import * as THREE from 'three';
import { cellValue } from '../core/grid-codec';
import { roomAt } from '../core/layout-geom';
import { distanceToPolygon, polygonArea } from '../core/geometry';
import { stampFurniture } from '../core/layout-raster';
import { formatArea } from '../core/units';
import { buildFurnitureMesh } from '../engine/furniture';
import {
  GRID_TALL_CM, HEIGHT_MAX_CM, HEIGHT_MIN_CM, HEIGHT_PRESETS_CM, HEIGHT_TINTS,
} from '../types';
import type { Box, FurnitureItem, FurnitureKind, Grid, Layout, Vec2 } from '../types';
import type { FurnitureStore } from './context';
import { finishFamily, sanitizeFinish } from '../look/finishes';
import type { Finish } from '../look/finishes';
import { decodeLayout, mineKey, parseMine, serializeMine } from './my-layout';
import type { MyLayout } from './my-layout';

// ---------------------------------------------------------------- storage

/** The slice of `Storage` we use, so tests can inject a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const HEIGHT_KEY = 'walkthru:height';
export const HINT_KEY = 'walkthru:hintSeen';
export function placedKey(sceneId: string): string {
  return `walkthru:${sceneId}:placed`;
}

/** `window.localStorage` when it works (private modes and blocked storage throw), else null. */
export function safeStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    const probe = '__walkthru_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

function tryGet(storage: StorageLike | null, key: string): string | null {
  if (!storage) return null;
  try { return storage.getItem(key); } catch { return null; }
}
function trySet(storage: StorageLike | null, key: string, value: string): boolean {
  if (!storage) return false;
  try { storage.setItem(key, value); return true; } catch { return false; }
}
function tryRemove(storage: StorageLike | null, key: string): void {
  if (!storage) return;
  try { storage.removeItem(key); } catch { /* ignore */ }
}

export { tryGet as storageGet, trySet as storageSet };

// ---------------------------------------------------------------- height

export const DEFAULT_HEIGHT_CM = 175;

/** Whole centimetres, clamped to 140..200. Not a number gives the default. */
export function clampHeightCm(cm: number): number {
  if (typeof cm !== 'number' || !Number.isFinite(cm)) return DEFAULT_HEIGHT_CM;
  return Math.min(HEIGHT_MAX_CM, Math.max(HEIGHT_MIN_CM, Math.round(cm)));
}

/** Index into HEIGHT_PRESETS_CM of the preset nearest to `cm` (a tie goes to the shorter preset). */
export function nearestPresetIndex(cm: number): number {
  let best = 0;
  let bestD = Infinity;
  HEIGHT_PRESETS_CM.forEach((p, i) => {
    const d = Math.abs(p - cm);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/** A custom height takes the tint of the nearest preset (SPEC 2.1 B2). */
export function tintForHeightCm(cm: number): string {
  return HEIGHT_TINTS[nearestPresetIndex(cm)];
}

export function loadHeightCm(storage: StorageLike | null): number | null {
  const raw = tryGet(storage, HEIGHT_KEY);
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < HEIGHT_MIN_CM || n > HEIGHT_MAX_CM) return null;
  return Math.round(n);
}

export function saveHeightCm(storage: StorageLike | null, cm: number): void {
  trySet(storage, HEIGHT_KEY, String(clampHeightCm(cm)));
}

// ---------------------------------------------------------------- placed items persistence

const KINDS: FurnitureKind[] = ['bed', 'sofa', 'dining', 'wardrobe', 'counter'];
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One stored item, or null when it is malformed. Stored items are always virtual. */
export function parsePlacedItem(v: unknown): FurnitureItem | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const b = o.box as Record<string, unknown> | undefined;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (typeof o.kind !== 'string' || !KINDS.includes(o.kind as FurnitureKind)) return null;
  if (!b || typeof b !== 'object') return null;
  if (!isNum(b.cx) || !isNum(b.cz) || !isNum(b.w) || !isNum(b.d) || !isNum(b.yawDeg)) return null;
  if (!(b.w > 0.05) || !(b.d > 0.05)) return null;
  if (!isNum(o.heightM) || !(o.heightM > 0) || !isNum(o.surfaceHeightM)) return null;
  const item: FurnitureItem = {
    id: o.id,
    source: 'virtual',
    kind: o.kind as FurnitureKind,
    label: typeof o.label === 'string' && o.label ? o.label : o.kind,
    box: { cx: b.cx, cz: b.cz, w: b.w, d: b.d, yawDeg: b.yawDeg },
    heightM: o.heightM,
    surfaceHeightM: o.surfaceHeightM,
  };
  if (typeof o.catalogId === 'string') item.catalogId = o.catalogId;
  const inner = o.inner as Record<string, unknown> | undefined;
  if (inner && isNum(inner.w) && isNum(inner.d)) item.inner = { w: inner.w, d: inner.d };
  const finish = sanitizeFinish(finishFamily(item), o.finish);
  if (finish) item.finish = finish;
  return item;
}

/** Parses the stored JSON (`{ version: 1, items: [...] }` or a bare array). Bad input gives an empty list. */
export function parsePlaced(raw: string | null): FurnitureItem[] {
  if (!raw) return [];
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return []; }
  const list = Array.isArray(json) ? json : (json && typeof json === 'object' ? (json as { items?: unknown }).items : null);
  if (!Array.isArray(list)) return [];
  const out: FurnitureItem[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    const it = parsePlacedItem(v);
    if (it && !seen.has(it.id)) { seen.add(it.id); out.push(it); }
  }
  return out;
}

export function loadPlaced(storage: StorageLike | null, sceneId: string): FurnitureItem[] {
  return parsePlaced(tryGet(storage, placedKey(sceneId)));
}

/** Writes the buyer's items; an empty list removes the key. */
export function savePlaced(storage: StorageLike | null, sceneId: string, items: FurnitureItem[]): void {
  if (items.length === 0) { tryRemove(storage, placedKey(sceneId)); return; }
  trySet(storage, placedKey(sceneId), JSON.stringify({ version: 1, items }));
}

// ---------------------------------------------------------------- interaction (SPEC 2.1 prompts table)

export type PoseAction = 'lie' | 'sit' | 'stand' | 'dims';
export const INTERACT_RADIUS_M = 1.0;

const ACTIONS: Record<FurnitureKind, { action: PoseAction; prompt: string; upPrompt: string }> = {
  bed: { action: 'lie', prompt: 'Lie on the bed', upPrompt: 'Get up' },
  sofa: { action: 'sit', prompt: 'Sit on the sofa', upPrompt: 'Get up' },
  counter: { action: 'stand', prompt: 'Stand at the counter', upPrompt: 'Step back' },
  dining: { action: 'dims', prompt: 'See dimensions', upPrompt: 'Get up' },
  wardrobe: { action: 'dims', prompt: 'See dimensions', upPrompt: 'Get up' },
};

export function actionFor(kind: FurnitureKind): { action: PoseAction; prompt: string; upPrompt: string } {
  return ACTIONS[kind];
}

/** Distance from a point to a box footprint, 0 when inside. */
export function distanceToBox(pt: Vec2, box: Box): number {
  const y = (box.yawDeg * Math.PI) / 180;
  const dx = pt.x - box.cx;
  const dz = pt.z - box.cz;
  const along = Math.abs(dx * Math.sin(y) + dz * Math.cos(y)) - box.d / 2;
  const across = Math.abs(dx * Math.cos(y) - dz * Math.sin(y)) - box.w / 2;
  return Math.hypot(Math.max(0, along), Math.max(0, across));
}

/**
 * True when a full-height cell (a wall, the void between rooms, a tall cupboard) lies on the straight line from `pt`
 * to the footprint `box`. Prompts and chips for an item behind a wall must not appear: the buyer is in another room.
 * The box's own cells are skipped by stopping 6 cm short of its edge.
 */
export function wallBetween(grid: Grid, pt: Vec2, box: Box): boolean {
  const dist = distanceToBox(pt, box);
  if (dist <= 0.06) return false;
  const dx = box.cx - pt.x;
  const dz = box.cz - pt.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  const step = grid.cellM / 2;
  for (let t = 0; t < len; t += step) {
    const p = { x: pt.x + (dx * t) / len, z: pt.z + (dz * t) / len };
    if (distanceToBox(p, box) <= 0.06) return false;
    if (cellValue(grid, p.x, p.z) >= GRID_TALL_CM) return true;
  }
  return false;
}

/**
 * The nearest item whose footprint is within `maxM` of the point (or that contains it). Ties (overlapping items)
 * go to the one whose centre is nearer. With a `grid`, items behind a wall are skipped.
 */
export function nearestInteractable(
  items: FurnitureItem[], pt: Vec2, maxM: number = INTERACT_RADIUS_M, grid?: Grid,
): { item: FurnitureItem; distM: number } | null {
  let best: { item: FurnitureItem; distM: number; centre: number } | null = null;
  for (const item of items) {
    const distM = distanceToBox(pt, item.box);
    if (distM > maxM) continue;
    if (grid && wallBetween(grid, pt, item.box)) continue;
    const centre = Math.hypot(pt.x - item.box.cx, pt.z - item.box.cz);
    if (!best || distM < best.distM - 1e-9 || (Math.abs(distM - best.distM) <= 1e-9 && centre < best.centre)) {
      best = { item, distM, centre };
    }
  }
  return best ? { item: best.item, distM: best.distM } : null;
}

// ---------------------------------------------------------------- height provenance

export const STANDARD_HEIGHT_NOTE = 'Height is a standard assumption. The drawing does not give it.';

/**
 * In a scene built from a drawing (it has a designs file), a real item's height is only a fact when the design says where
 * it was read (`sources.heightM` or `sources.surfaceHeightM`, a dimension string or "derived: ..."). Otherwise it is the
 * catalogue's standard, and the card must say so. Returns the note for such an item, or null.
 */
export function standardHeightNote(
  item: FurnitureItem, designs: { items: Record<string, { sources?: Record<string, unknown> }> } | null,
): string | null {
  if (!designs || item.source !== 'real') return null;
  if (item.kind !== 'counter' && item.kind !== 'wardrobe' && item.kind !== 'dining') return null;
  const src = designs.items[item.id]?.sources;
  if (src && (src.heightM !== undefined || src.surfaceHeightM !== undefined)) return null;
  return STANDARD_HEIGHT_NOTE;
}

// ---------------------------------------------------------------- room chip

export { unverifiedRoomsFromExtras } from '../core/room-trust';

/**
 * Labels of the not-measured rooms (see `UnverifiedRooms`) that any of the points lies in or within `radiusM` of.
 * The radius covers a point on a wall face. Used so a distance or a fit verdict that rests on an unmeasured room
 * outline says "Not measured" instead of showing a number as if it came from the drawing.
 */
export function unmeasuredRoomsNear(layout: Layout, unverified: UnverifiedRooms, pts: Vec2[], radiusM = 0.3): string[] {
  const out: string[] = [];
  for (const room of layout.rooms) {
    if (!unverified[room.id] && !room.partial) continue;
    if (pts.some((pt) => distanceToPolygon(pt, room.polygon) <= radiusM)) out.push(room.label);
  }
  return out;
}
import type { UnverifiedRooms } from '../core/room-trust';
export type { UnverifiedRooms } from '../core/room-trust';

/** "Bedroom 1 · 215 sq ft · 20.0 m²", or null when the point is in no room (a doorway, a wall, outside). */
/** The words that mark a room that is only partly on the drawing (chip, rooms sheet, badge). */
export const PARTIAL_NOTE = 'Not on your drawing · shape guessed';

export function roomChipText(layout: Layout, pt: Vec2, unverified: UnverifiedRooms = {}): string | null {
  const room = roomAt(layout, pt);
  if (!room) return null;
  if (room.partial) return `${room.label} · shape guessed`;
  const note = unverified[room.id];
  if (note) return `${room.label} · not measured (${note})`;
  return `${room.label} · ${formatArea(polygonArea(room.polygon)).text}`;
}

// ---------------------------------------------------------------- the furniture store

export interface FurnitureStoreOptions {
  sceneId: string;
  /** the layout-only grid (rasterizeLayout) */
  baseGrid: Grid;
  /** real + broker-staged items from property.json */
  initial: FurnitureItem[];
  /** meshes are added here */
  parent: THREE.Object3D;
  storage: StorageLike | null;
  /** debounce for drag updates, ms. 0 saves immediately (tests). */
  saveDelayMs?: number;
  /** a layout code from a shared link (`?my=`): when it decodes for this home it replaces the stored "My layout" */
  shareCode?: string | null;
}

export interface FurnitureStoreImpl extends FurnitureStore {
  /** layout + all furniture (cached until the next change) */
  grid(): Grid;
  /** layout + all furniture except the given ids; `withTemporary` false leaves out the temporary obstacles too */
  gridWithout(ids: string[], withTemporary?: boolean): Grid;
  /**
   * Temporary obstacles in the walk grid (an open wardrobe's shutters): thin boxes under a key, replaced as a set. They are
   * not items: nothing is saved, no mesh is built, `all()` does not list them. An empty list clears the key.
   */
  setTemporary(key: string, obstacles: { box: Box; heightM: number }[]): void;
  /** writes any pending save now */
  flush(): void;
  /** true when the id exists */
  has(id: string): boolean;
  /** a copy of one item */
  get(id: string): FurnitureItem | undefined;
  /** ids the buyer placed (these persist; broker items do not) */
  buyerIds(): string[];

  // ---- "My layout": the per-viewer overlay (src/buyer/my-layout.ts). The home as drawn is never edited.
  /** true for a piece that came with the home (real, or staged in property.json), false for one the buyer placed */
  isOriginal(id: string): boolean;
  /** hides a piece that came with the home, in this viewer's layout only. Persists. */
  hideOriginal(id: string): boolean;
  /** brings a hidden original back */
  restoreOriginal(id: string): boolean;
  /** the originals hidden in this layout, as drawn */
  hiddenOriginals(): FurnitureItem[];
  /** the look of any piece (null clears it); rebuilds that piece's mesh. Persists. Never touches a box. */
  setFinish(id: string, finish: Finish | null | undefined): boolean;
  /** swaps a piece (an original is hidden, a placed one is removed) for a new virtual item in one step */
  replace(id: string, next: FurnitureItem): boolean;
  /** the overlay as a value, for storage and for the link */
  layout(): MyLayout;
  /** true when this viewer's layout differs from the home as drawn */
  isEdited(): boolean;
  /** back to the home as drawn: placed pieces gone, hidden originals back, looks and staged moves undone. Clears storage. */
  reset(): void;
  /** true when this visit opened a shared layout link */
  fromLink(): boolean;
  /** the home as drawn: a deep copy of what property.json handed the store (for tests and the reset check) */
  pristine(): FurnitureItem[];
  dispose(): void;
}

interface Entry { item: FurnitureItem; mesh: THREE.Group; origin: 'property' | 'buyer' }

function cloneItem(it: FurnitureItem): FurnitureItem {
  const c: FurnitureItem = { ...it, box: { ...it.box } };
  if (it.inner) c.inner = { ...it.inner };
  if (it.finish) c.finish = { ...it.finish };
  return c;
}

function disposeMesh(g: THREE.Object3D): void {
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
 * Real + staged items come from property.json (session only, a buyer may move or remove staged ones), buyer items
 * from storage (persisted). Real items are immovable. The live grid is the layout grid with every item stamped,
 * recomputed lazily after a change.
 */
export function createFurnitureStore(opts: FurnitureStoreOptions): FurnitureStoreImpl {
  const { sceneId, baseGrid, parent, storage } = opts;
  const delay = opts.saveDelayMs ?? 250;
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const temporary = new Map<string, FurnitureItem[]>();
  const temporaryItems = (): FurnitureItem[] => [...temporary.values()].flat();
  let cached: Grid | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  // The home as drawn, kept apart from everything below. Nothing here is ever written to after this point.
  const drawn: FurnitureItem[] = opts.initial.map(cloneItem);
  const drawnById = new Map(drawn.map((i) => [i.id, i]));
  /** originals hidden in this viewer's layout: id -> the piece as it stood */
  const hidden = new Map<string, FurnitureItem>();
  /** the viewer's looks for originals (a placed piece carries its own `finish`) */
  const looks = new Map<string, Finish>();
  let linked = false;

  const mk = (item: FurnitureItem, origin: Entry['origin']): void => {
    const old = entries.get(item.id);
    if (old) disposeMesh(old.mesh);
    const copy = cloneItem(item);
    const mesh = buildFurnitureMesh(copy);
    parent.add(mesh);
    entries.set(copy.id, { item: copy, mesh, origin });
  };
  /** the entries in the order the home lists them, then the buyer's own in the order they were added */
  const reorder = (): void => {
    const rank = new Map(drawn.map((i, n) => [i.id, n]));
    const list = [...entries.entries()].sort(([a], [b]) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
    entries.clear();
    for (const [k, v] of list) entries.set(k, v);
  };
  const withLook = (item: FurnitureItem, f: Finish | undefined): FurnitureItem => {
    const c = cloneItem(item);
    if (f) c.finish = { ...f }; else delete c.finish;
    return c;
  };
  /** puts a layout on the home as drawn, with no events and no save (boot only) */
  const seed = (my: MyLayout): void => {
    for (const id of my.removed) {
      const it = drawnById.get(id);
      if (it) hidden.set(id, cloneItem(it));
    }
    for (const [id, f] of Object.entries(my.finishes)) {
      const it = drawnById.get(id);
      const clean = it ? sanitizeFinish(finishFamily(it), f) : undefined;
      if (clean) looks.set(id, clean);
    }
    for (const it of drawn) if (!hidden.has(it.id)) mk(withLook(it, looks.get(it.id)), 'property');
    for (const it of my.added) if (!entries.has(it.id) && !drawnById.has(it.id)) mk(it, 'buyer');
  };

  {
    const shared = decodeLayout(opts.shareCode, drawnById);
    if (shared) {
      linked = true;
      seed(shared);
    } else {
      const mine = parseMine(tryGet(storage, mineKey(sceneId)), drawnById);
      seed({ removed: mine.removed, finishes: mine.finishes, added: loadPlaced(storage, sceneId) });
    }
  }

  const changed = (): void => {
    cached = null;
    for (const cb of [...listeners]) {
      try { cb(); } catch (err) { console.error('[walkthru] furniture listener threw', err); }
    }
  };
  const buyerItems = (): FurnitureItem[] => [...entries.values()].filter((e) => e.origin === 'buyer').map((e) => cloneItem(e.item));
  const layoutNow = (): MyLayout => ({
    removed: [...hidden.keys()],
    added: buyerItems(),
    finishes: Object.fromEntries([...looks].map(([k, v]) => [k, { ...v }])),
  });
  const saveNow = (): void => {
    if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
    dirty = false;
    savePlaced(storage, sceneId, buyerItems());
    const mine = serializeMine([...hidden.keys()], Object.fromEntries(looks));
    if (mine === null) tryRemove(storage, mineKey(sceneId)); else trySet(storage, mineKey(sceneId), mine);
  };
  const scheduleSave = (): void => {
    dirty = true;
    if (delay <= 0 || typeof setTimeout === 'undefined') { saveNow(); return; }
    if (saveTimer === null) saveTimer = setTimeout(saveNow, delay);
  };
  const onHide = (): void => { if (dirty) saveNow(); };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
  }
  // a shared layout is kept as this viewer's own from the moment it is opened, so a reload shows the same home
  if (linked) saveNow();

  const store: FurnitureStoreImpl = {
    all() {
      return [...entries.values()].map((e) => cloneItem(e.item));
    },
    add(item) {
      if (item.source !== 'virtual') throw new Error(`FurnitureStore.add: only virtual items can be added (got "${String(item.source)}")`);
      mk(item, 'buyer');
      scheduleSave();
      changed();
    },
    update(id, box) {
      const e = entries.get(id);
      if (!e) { console.warn(`[walkthru] FurnitureStore.update: no item "${id}"`); return; }
      if (e.item.source === 'real') { console.warn(`[walkthru] FurnitureStore.update: "${id}" is a real item and cannot be moved`); return; }
      const sizeChanged = Math.abs(box.w - e.item.box.w) > 1e-9 || Math.abs(box.d - e.item.box.d) > 1e-9;
      e.item = { ...e.item, box: { ...box } };
      if (sizeChanged) {
        disposeMesh(e.mesh);
        e.mesh = buildFurnitureMesh(e.item);
        parent.add(e.mesh);
      } else {
        e.mesh.position.set(box.cx, 0, box.cz);
        e.mesh.rotation.y = (box.yawDeg * Math.PI) / 180;
        e.mesh.updateMatrixWorld(true);
      }
      if (e.origin === 'buyer') scheduleSave();
      changed();
    },
    remove(id) {
      const e = entries.get(id);
      if (!e) return;
      if (e.item.source === 'real') { console.warn(`[walkthru] FurnitureStore.remove: "${id}" is a real item and cannot be removed (hideOriginal hides it in My layout)`); return; }
      if (e.origin === 'property') { store.hideOriginal(id); return; }
      disposeMesh(e.mesh);
      entries.delete(id);
      scheduleSave();
      changed();
    },
    clearBuyerItems() {
      let any = false;
      for (const [id, e] of [...entries]) {
        if (e.origin !== 'buyer') continue;
        disposeMesh(e.mesh);
        entries.delete(id);
        any = true;
      }
      saveNow();
      if (any) changed();
    },
    mesh(id) {
      return entries.get(id)?.mesh;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    grid() {
      if (!cached) cached = stampFurniture(baseGrid, [...[...entries.values()].map((e) => e.item), ...temporaryItems()]);
      return cached;
    },
    gridWithout(ids, withTemporary = true) {
      const skip = new Set(ids);
      const items = [...entries.values()].filter((e) => !skip.has(e.item.id)).map((e) => e.item);
      return stampFurniture(baseGrid, withTemporary ? [...items, ...temporaryItems()] : items);
    },
    setTemporary(key, obstacles) {
      if (obstacles.length === 0) {
        if (!temporary.delete(key)) return;
      } else {
        temporary.set(key, obstacles.map((o, i) => ({
          id: `temporary:${key}:${i}`, source: 'virtual' as const, kind: 'wardrobe' as const, label: 'temporary obstacle',
          box: { ...o.box }, heightM: o.heightM, surfaceHeightM: o.heightM,
        })));
      }
      changed();
    },
    flush() {
      if (dirty) saveNow();
    },
    has(id) {
      return entries.has(id);
    },
    get(id) {
      const e = entries.get(id);
      return e ? cloneItem(e.item) : undefined;
    },
    buyerIds() {
      return [...entries.values()].filter((e) => e.origin === 'buyer').map((e) => e.item.id);
    },
    isOriginal(id) {
      return entries.get(id)?.origin === 'property' || hidden.has(id);
    },
    hideOriginal(id) {
      const e = entries.get(id);
      if (!e || e.origin !== 'property') return false;
      hidden.set(id, e.item);
      looks.delete(id);
      disposeMesh(e.mesh);
      entries.delete(id);
      scheduleSave();
      changed();
      return true;
    },
    restoreOriginal(id) {
      const it = hidden.get(id);
      if (!it) return false;
      hidden.delete(id);
      mk(drawnById.get(id) ?? it, 'property');
      reorder();
      scheduleSave();
      changed();
      return true;
    },
    hiddenOriginals() {
      return [...hidden.values()].map((i) => cloneItem(drawnById.get(i.id) ?? i));
    },
    setFinish(id, finish) {
      const e = entries.get(id);
      if (!e) return false;
      const clean = sanitizeFinish(finishFamily(e.item), finish ?? undefined);
      if (!clean && !e.item.finish) return true;
      const next = withLook(e.item, clean);
      disposeMesh(e.mesh);
      const mesh = buildFurnitureMesh(next);
      parent.add(mesh);
      e.item = next;
      e.mesh = mesh;
      if (e.origin === 'property') { if (clean) looks.set(id, clean); else looks.delete(id); }
      scheduleSave();
      changed();
      return true;
    },
    replace(id, next) {
      if (next.source !== 'virtual') throw new Error(`FurnitureStore.replace: only virtual items can be added (got "${String(next.source)}")`);
      const e = entries.get(id);
      if (!e) return false;
      if (e.origin === 'property') { hidden.set(id, e.item); looks.delete(id); }
      disposeMesh(e.mesh);
      entries.delete(id);
      mk(next, 'buyer');
      scheduleSave();
      changed();
      return true;
    },
    layout: layoutNow,
    isEdited() {
      if (hidden.size > 0 || looks.size > 0) return true;
      for (const e of entries.values()) {
        if (e.origin === 'buyer') return true;
        const d = drawnById.get(e.item.id);
        if (d && JSON.stringify(d.box) !== JSON.stringify(e.item.box)) return true;
      }
      return false;
    },
    reset() {
      for (const [id, e] of [...entries]) {
        const d = drawnById.get(id);
        const keep = e.origin === 'property' && d && !looks.has(id) && JSON.stringify(d.box) === JSON.stringify(e.item.box);
        if (!keep) { disposeMesh(e.mesh); entries.delete(id); }
      }
      hidden.clear();
      looks.clear();
      for (const d of drawn) if (!entries.has(d.id)) mk(d, 'property');
      reorder();
      saveNow();
      changed();
    },
    fromLink: () => linked,
    pristine: () => drawn.map(cloneItem),
    dispose() {
      if (dirty) saveNow();
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onHide);
        window.removeEventListener('beforeunload', onHide);
      }
      for (const e of entries.values()) disposeMesh(e.mesh);
      entries.clear();
      listeners.clear();
    },
  };
  return store;
}
