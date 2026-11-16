// Owned by furnish-edit. "My layout": the per-viewer overlay on a home. The home's own layout (property.json) is the record and is never
// touched; a viewer's changes are a small value stored in localStorage and, if they want, carried in a link:
//   removed   ids of pieces that came with the home and are hidden in this viewer's layout
//   added     catalogue pieces the viewer placed (this includes every replacement)
//   finishes  the look chosen for a piece that came with the home (an added piece carries its own `finish`)
// Pure: no DOM, no three. The store applies it, the furnish UI edits it, the link codec here carries it.
import { CATALOG, itemFromCatalog } from '../core/catalog';
import { finishFamily, sanitizeFinish } from '../look/finishes';
import type { Finish } from '../look/finishes';
import { emptyFittings, fittingsFromWire, fittingsToWire, isEmptyFittings, sanitizeFittings } from '../look/fittings';
import type { FittingsOverlay, FittingsWire } from '../look/fittings';
import type { OriginalEdit } from './resize';
import type { Box, FurnitureItem } from '../types';

export interface MyLayout {
  removed: string[];
  added: FurnitureItem[];
  finishes: Record<string, Finish>;
  /** originals moved or resized in this layout, by id: the whole new place and size (the drawing's own box is never touched) */
  moved: Record<string, OriginalEdit>;
  /** the fittings (AC, fan, curtains, plants, the drawing's chairs ...) removed, moved or resized, by stable fitting id */
  fittings: FittingsOverlay;
}

export const emptyLayout = (): MyLayout => ({ removed: [], added: [], finishes: {}, moved: {}, fittings: emptyFittings() });
export const isEmptyLayout = (l: MyLayout): boolean =>
  l.removed.length === 0 && l.added.length === 0 && Object.keys(l.finishes).length === 0 && Object.keys(l.moved).length === 0 && isEmptyFittings(l.fittings);
export const cloneMoved = (m: Record<string, OriginalEdit>): Record<string, OriginalEdit> => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v }]));

// ---------------------------------------------------------------- the words (SPEC 16.2: say what is and is not from the drawing)

export const EDITED_CHIP = 'Your layout · edited';
export const RESET_LABEL = 'Reset to the home as drawn';
export const BUILT_IN_NOTE = 'Built-in on the drawing: hidden in your layout only';
/** the same note when the piece is moved or resized instead: the drawing's own size and place stay the record */
export const BUILT_IN_EDIT_NOTE = 'Built-in on the drawing: moved or resized in your layout only';
export const OVERLAY_NOTE = 'Your layout is a private try-out on this device. The home as drawn does not change.';

// ---------------------------------------------------------------- the built-in rule

/**
 * In a home made from a REAL drawing, some pieces are the drawing's own fixed work: anything the drawing's furniture designs file
 * describes, and every wardrobe or counter (built-ins whose size the drawing dimensions). They can be hidden in a viewer's layout,
 * but only with the explicit note `BUILT_IN_NOTE`. A made-up sample home has no such pieces.
 */
export function isBuiltIn(
  item: Pick<FurnitureItem, 'id' | 'kind' | 'source'>,
  scene: { origin: 'real' | 'sample' | 'video' | 'upload'; designed: ReadonlySet<string> },
): boolean {
  // a plan the visitor uploaded is a real drawing too: its wardrobes and counters are the drawing's own fixed work
  if (scene.origin !== 'real' && scene.origin !== 'upload') return false;
  if (item.source !== 'real') return false;
  return scene.designed.has(item.id) || item.kind === 'wardrobe' || item.kind === 'counter';
}

// ---------------------------------------------------------------- storage (the part of the overlay that is not a placed piece)

export const mineKey = (sceneId: string): string => `walkthru:${sceneId}:mine`;

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One stored edit of an original, or null when it is malformed. Its size is put through the family limits when the store applies it. */
export function sanitizeEdit(v: unknown): OriginalEdit | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (![o.cx, o.cz, o.yawDeg, o.w, o.d, o.heightM, o.surfaceHeightM].every(isNumber)) return null;
  const e = o as unknown as OriginalEdit;
  if (Math.abs(e.cx) > 100000 || Math.abs(e.cz) > 100000) return null;
  if (!(e.w > 0.05 && e.w < 8) || !(e.d > 0.05 && e.d < 8) || !(e.heightM > 0.05 && e.heightM < 5) || !(e.surfaceHeightM > 0.01 && e.surfaceHeightM < 5)) return null;
  return { cx: e.cx, cz: e.cz, yawDeg: (((e.yawDeg % 360) + 360) % 360), w: e.w, d: e.d, heightM: e.heightM, surfaceHeightM: e.surfaceHeightM };
}
const sanitizeMoved = (raw: unknown, originals: ReadonlyMap<string, FurnitureItem>): Record<string, OriginalEdit> => {
  const out: Record<string, OriginalEdit> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!originals.has(id)) continue;
    const e = sanitizeEdit(v);
    if (e) out[id] = e;
  }
  return out;
};

export interface Mine { removed: string[]; finishes: Record<string, Finish>; moved: Record<string, OriginalEdit>; fittings: FittingsOverlay }

/** The stored `{ version: 1 | 2, removed, finishes, moved?, fittings? }` (version 1 has no moved or fittings), or empty for anything malformed. Finishes are sanitised against `originals`. */
export function parseMine(raw: string | null, originals: ReadonlyMap<string, FurnitureItem>): Mine {
  const out: Mine = { removed: [], finishes: {}, moved: {}, fittings: emptyFittings() };
  if (!raw) return out;
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return out; }
  if (!json || typeof json !== 'object') return out;
  const o = json as { removed?: unknown; finishes?: unknown; moved?: unknown; fittings?: unknown };
  if (Array.isArray(o.removed)) {
    for (const id of o.removed) if (typeof id === 'string' && originals.has(id) && !out.removed.includes(id)) out.removed.push(id);
  }
  if (o.finishes && typeof o.finishes === 'object') {
    for (const [id, f] of Object.entries(o.finishes as Record<string, unknown>)) {
      const item = originals.get(id);
      const clean = item ? sanitizeFinish(finishFamily(item), f) : undefined;
      if (clean) out.finishes[id] = clean;
    }
  }
  out.moved = sanitizeMoved(o.moved, originals);
  out.fittings = sanitizeFittings(o.fittings);
  return out;
}

export function serializeMine(removed: string[], finishes: Record<string, Finish>, moved: Record<string, OriginalEdit> = {}, fittings: FittingsOverlay = emptyFittings()): string | null {
  if (removed.length === 0 && Object.keys(finishes).length === 0 && Object.keys(moved).length === 0 && isEmptyFittings(fittings)) return null;
  const plain = Object.keys(moved).length === 0 && isEmptyFittings(fittings);
  return JSON.stringify(plain ? { version: 1, removed, finishes } : { version: 2, removed, finishes, moved, fittings });
}

// ---------------------------------------------------------------- the link: compact, versioned

/** The query parameter a shared layout travels in: `?scene=...&my=1.<code>`. */
export const SHARE_PARAM = 'my';
/** Version 1 carries removed pieces, added pieces and looks. Version 2 adds moved/resized originals and fittings; a layout with neither is still written as 1, so old readers keep working. */
const VERSION = 2;
/** a hall's seating is a piece per chair (SPEC 16.17): a block of 72 seats and the pieces round it fit in a link */
const MAX_ADDED = 220;
const MAX_MOVED = 60;
const MAX_CODE_CHARS = 12000;

interface Wire {
  /** removed original ids */ r?: string[];
  /** added pieces: [catalogId, cx cm, cz cm, yaw deg x10, finish?] */ a?: Array<[string, number, number, number, WireFinish?]>;
  /** finishes of originals, by id */ f?: Record<string, WireFinish>;
  /** version 2: moved or resized originals: [id, cx cm, cz cm, yaw deg x10, w cm, d cm, height cm, surface height cm] */ p?: Array<[string, number, number, number, number, number, number, number]>;
  /** version 2: fittings (AC, fan, curtains, plants ...) removed, moved or resized */ x?: FittingsWire;
}
type WireFinish = { p?: string; s?: string; f?: string; t?: string };

const toWire = (f: Finish | undefined): WireFinish | undefined => {
  if (!f) return undefined;
  const w: WireFinish = {};
  if (f.primary) w.p = f.primary;
  if (f.secondary) w.s = f.secondary;
  if (f.fabric) w.f = f.fabric;
  if (f.style) w.t = f.style;
  return Object.keys(w).length ? w : undefined;
};
const fromWire = (w: unknown): Finish | undefined => {
  if (!w || typeof w !== 'object') return undefined;
  const o = w as WireFinish;
  const f: Record<string, unknown> = {};
  if (typeof o.p === 'string') f.primary = o.p;
  if (typeof o.s === 'string') f.secondary = o.s;
  if (typeof o.f === 'string') f.fabric = o.f;
  if (typeof o.t === 'string') f.style = o.t;
  return f as Finish;
};

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(code: string): string | null {
  try {
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return null; }
}

/** The code for a layout: `1.<base64url>`. Pieces without a catalogue id cannot be shared and are left out. Empty layout: null. */
export function encodeLayout(l: MyLayout): string | null {
  if (isEmptyLayout(l)) return null;
  const wire: Wire = {};
  if (l.removed.length) wire.r = [...l.removed];
  const added = l.added.filter((i) => i.catalogId);
  if (added.length) {
    wire.a = added.map((i) => {
      const row: [string, number, number, number, WireFinish?] = [i.catalogId!, Math.round(i.box.cx * 100), Math.round(i.box.cz * 100), Math.round(i.box.yawDeg * 10)];
      const f = toWire(i.finish);
      if (f) row.push(f);
      return row;
    });
  }
  const fin: Record<string, WireFinish> = {};
  for (const [id, f] of Object.entries(l.finishes)) { const w = toWire(f); if (w) fin[id] = w; }
  if (Object.keys(fin).length) wire.f = fin;
  const moved = Object.entries(l.moved).map(([id, e]): [string, number, number, number, number, number, number, number] => [id, Math.round(e.cx * 100), Math.round(e.cz * 100), Math.round(e.yawDeg * 10), Math.round(e.w * 100), Math.round(e.d * 100), Math.round(e.heightM * 100), Math.round(e.surfaceHeightM * 100)]);
  if (moved.length) wire.p = moved;
  const fx = fittingsToWire(l.fittings);
  if (fx) wire.x = fx;
  return `${wire.p || wire.x ? VERSION : 1}.${b64urlEncode(JSON.stringify(wire))}`;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * A layout from a code, checked against the home it is opened on: removed ids must be pieces of this home, added pieces must be
 * catalogue entries, positions must be sane numbers, finishes must be legal for their family. Anything else is dropped.
 * A code of another version, or one that is not decodable, gives null (the link is ignored, nothing breaks).
 */
export function decodeLayout(code: string | null | undefined, originals: ReadonlyMap<string, FurnitureItem>): MyLayout | null {
  if (!code || code.length > MAX_CODE_CHARS) return null;
  const dot = code.indexOf('.');
  const version = Number(code.slice(0, dot));
  if (dot < 1 || (version !== 1 && version !== 2)) return null;
  const text = b64urlDecode(code.slice(dot + 1));
  if (!text) return null;
  let wire: Wire;
  try { wire = JSON.parse(text) as Wire; } catch { return null; }
  if (!wire || typeof wire !== 'object') return null;
  const out = emptyLayout();
  if (Array.isArray(wire.r)) {
    for (const id of wire.r) if (typeof id === 'string' && originals.has(id) && !out.removed.includes(id)) out.removed.push(id);
  }
  if (Array.isArray(wire.a)) {
    for (const row of wire.a.slice(0, MAX_ADDED)) {
      if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
      const spec = CATALOG.find((c) => c.id === row[0]);
      if (!spec || !isNum(row[1]) || !isNum(row[2]) || !isNum(row[3])) continue;
      if (Math.abs(row[1]) > 100000 || Math.abs(row[2]) > 100000) continue;
      const box: Box = { cx: row[1] / 100, cz: row[2] / 100, w: spec.footprint.w, d: spec.footprint.d, yawDeg: (((row[3] / 10) % 360) + 360) % 360 };
      const item = itemFromCatalog(spec.id, box, 'virtual');
      item.id = `shared-${out.added.length + 1}-${spec.id}`;
      const f = sanitizeFinish(finishFamily(item), fromWire(row[4]));
      if (f) item.finish = f;
      out.added.push(item);
    }
  }
  if (wire.f && typeof wire.f === 'object') {
    for (const [id, w] of Object.entries(wire.f)) {
      const item = originals.get(id);
      const clean = item ? sanitizeFinish(finishFamily(item), fromWire(w)) : undefined;
      if (clean) out.finishes[id] = clean;
    }
  }
  if (version === 2) {
    if (Array.isArray(wire.p)) {
      const rows: Record<string, unknown> = {};
      for (const row of wire.p.slice(0, MAX_MOVED)) {
        if (!Array.isArray(row) || typeof row[0] !== 'string' || row.length < 8) continue;
        rows[row[0]] = { cx: Number(row[1]) / 100, cz: Number(row[2]) / 100, yawDeg: Number(row[3]) / 10, w: Number(row[4]) / 100, d: Number(row[5]) / 100, heightM: Number(row[6]) / 100, surfaceHeightM: Number(row[7]) / 100 };
      }
      out.moved = sanitizeMoved(rows, originals);
    }
    if (wire.x) out.fittings = fittingsFromWire(wire.x);
  }
  return isEmptyLayout(out) ? null : out;
}

/** `href` with the layout code set (or removed, when the layout is empty). */
export function shareUrl(href: string, l: MyLayout): string {
  const u = new URL(href);
  u.searchParams.delete(SHARE_PARAM);
  const code = encodeLayout(l);
  if (code) u.searchParams.set(SHARE_PARAM, code);
  return u.toString();
}
