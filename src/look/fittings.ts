// "Fittings": the things in a home that are not furniture and not the drawing (split AC, ceiling fan, tube light, downlights, wall lights,
// curtains, rug, switchboards, plants, clock, picture, window seat, the drawing's chairs ...). A viewer can tap one, move it, resize it where
// that makes sense, or remove it, in "My layout" only (SPEC 16.2: the home as drawn never changes, and what is not on the drawing is labelled).
//
// This file is PURE (no three, no DOM). It holds the overlay value (what a viewer changed, keyed by stable fitting ids), its storage and link
// codecs, the movement rules by mount (wall / ceiling / floor), the size options, and the hit test. The planners (kit, design mount, lived-in,
// the drawing's chairs) apply the overlay when they build and report what they built as `FittingRecord`s; nothing here is read by a measurement,
// a fit check, a clearance or the collision grid.
import { distanceToSegment, mulberry32, pointInPolygon } from '../core/geometry';
import { GRID_FREE } from '../types';
import type { EdgeFrame, Grid, Layout, RoomTag, Vec2 } from '../types';
import { cellIndex } from '../core/grid-codec';

// ---------------------------------------------------------------- words

export const FITTING_TYPICAL = 'Typical fitting, not from your drawing';
export const FITTING_RENDERS = "From the designer's renders";
/** the honesty line of a fitting's card */
export const labelOf = (r: Pick<FittingRecord, 'provenance' | 'label'>): string => r.label ?? (r.provenance === 'renders' ? FITTING_RENDERS : FITTING_TYPICAL);

export const FITTING_EDITED_NOTE = 'Edited in your layout. The home as drawn does not change.';

// ---------------------------------------------------------------- kinds

export type FittingKind =
  | 'ac' | 'fan' | 'tube' | 'downlight' | 'wall-light' | 'curtain' | 'rug' | 'switchboard' | 'plant' | 'clock' | 'frame' | 'pooja'
  | 'window-seat' | 'chair' | 'panelling' | 'slat-wall' | 'ceiling-band'
  | 'cushion' | 'throw' | 'books' | 'lamp' | 'cooker' | 'dabbas' | 'fruit' | 'jug' | 'shoes'
  | 'nightstand' | 'hob' | 'hood' | 'wallcab' | 'dado' | 'sink' | 'console' | 'mirror' | 'mat';

export type Mount = 'wall' | 'ceiling' | 'floor' | 'surface';

export const KIND_NAMES: Record<FittingKind, string> = {
  ac: 'Split AC', fan: 'Ceiling fan', tube: 'Tube light', downlight: 'Downlight', 'wall-light': 'Wall light', curtain: 'Curtains', rug: 'Rug',
  switchboard: 'Switchboard', plant: 'Plant', clock: 'Wall clock', frame: 'Picture frame', pooja: 'Pooja shelf', 'window-seat': 'Window seat',
  chair: 'Chair', panelling: 'Wall panelling', 'slat-wall': 'Slatted wall', 'ceiling-band': 'Ceiling band',
  cushion: 'Cushion', throw: 'Throw', books: 'Books', lamp: 'Table lamp', cooker: 'Pressure cooker', dabbas: 'Kitchen jars', fruit: 'Fruit bowl',
  jug: 'Jug', shoes: 'Shoes',
  nightstand: 'Bedside table', hob: 'Gas hob', hood: 'Chimney hood', wallcab: 'Wall cabinet', dado: 'Backsplash tiles', sink: 'Kitchen sink', console: 'Shoe cabinet', mirror: 'Mirror', mat: 'Doormat',
};

// ---------------------------------------------------------------- the overlay

/** Where a viewer put a fitting. Wall: along a wall of ITS room (u = centre along the edge, y = its anchor height). Ceiling: across its room's ceiling. Floor: on the floor of its room. */
export type MoveSpec =
  | { m: 'w'; edge: number; u: number; y: number }
  | { m: 'c'; x: number; z: number }
  | { m: 'f'; x: number; z: number; yawDeg?: number };

/** `removed` ids are hidden, `moved` and `sized` are keyed by the stable fitting id. A size is a list of metres (what each kind reads is in `resizeSpec`). */
export interface FittingsOverlay { removed: string[]; moved: Record<string, MoveSpec>; sized: Record<string, number[]> }

export const emptyFittings = (): FittingsOverlay => ({ removed: [], moved: {}, sized: {} });
export const isEmptyFittings = (f: FittingsOverlay): boolean => f.removed.length === 0 && Object.keys(f.moved).length === 0 && Object.keys(f.sized).length === 0;
export const cloneFittings = (f: FittingsOverlay): FittingsOverlay => ({
  removed: [...f.removed],
  moved: Object.fromEntries(Object.entries(f.moved).map(([k, v]) => [k, { ...v }])),
  sized: Object.fromEntries(Object.entries(f.sized).map(([k, v]) => [k, [...v]])),
});
export const sameFittings = (a: FittingsOverlay, b: FittingsOverlay): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
function canon(f: FittingsOverlay): unknown {
  return { r: [...f.removed].sort(), m: Object.keys(f.moved).sort().map((k) => [k, f.moved[k]]), s: Object.keys(f.sized).sort().map((k) => [k, f.sized[k]]) };
}

/** what the overlay says about one fitting */
export function overlayFor(o: FittingsOverlay | null | undefined, id: string): { removed: boolean; move?: MoveSpec; size?: number[] } {
  if (!o) return { removed: false };
  return { removed: o.removed.includes(id), move: o.moved[id], size: o.sized[id] };
}

const MAX_IDS = 300;
const ID_RE = /^[A-Za-z0-9_.:\-]{1,90}$/;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const bound = (v: unknown, lim = 1000): v is number => isNum(v) && Math.abs(v) <= lim;

/** The overlay from anything stored or sent: unknown shapes are dropped, numbers must be finite and sane. Never throws. */
export function sanitizeFittings(raw: unknown): FittingsOverlay {
  const out = emptyFittings();
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as { removed?: unknown; moved?: unknown; sized?: unknown };
  if (Array.isArray(o.removed)) {
    for (const id of o.removed) if (typeof id === 'string' && ID_RE.test(id) && !out.removed.includes(id) && out.removed.length < MAX_IDS) out.removed.push(id);
  }
  if (o.moved && typeof o.moved === 'object') {
    let n = 0;
    for (const [id, v] of Object.entries(o.moved as Record<string, unknown>)) {
      if (!ID_RE.test(id) || n >= MAX_IDS || !v || typeof v !== 'object') continue;
      const s = v as Record<string, unknown>;
      if (s.m === 'w' && isNum(s.edge) && Number.isInteger(s.edge) && s.edge >= 0 && s.edge < 200 && bound(s.u, 200) && bound(s.y, 20)) { out.moved[id] = { m: 'w', edge: s.edge, u: s.u, y: s.y }; n++; }
      else if (s.m === 'c' && bound(s.x, 100000) && bound(s.z, 100000)) { out.moved[id] = { m: 'c', x: s.x, z: s.z }; n++; }
      else if (s.m === 'f' && bound(s.x, 100000) && bound(s.z, 100000)) {
        out.moved[id] = { m: 'f', x: s.x, z: s.z, ...(isNum(s.yawDeg) ? { yawDeg: (((s.yawDeg % 360) + 360) % 360) } : {}) };
        n++;
      }
    }
  }
  if (o.sized && typeof o.sized === 'object') {
    let n = 0;
    for (const [id, v] of Object.entries(o.sized as Record<string, unknown>)) {
      if (!ID_RE.test(id) || n >= MAX_IDS || !Array.isArray(v) || v.length < 1 || v.length > 3) continue;
      if (!v.every((x) => isNum(x) && x > 0.01 && x < 20)) continue;
      out.sized[id] = (v as number[]).slice();
      n++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- the link: compact rows (centimetres)

/** Wire form of a fittings overlay: removed ids, moved rows `[id, 'w', edge, u cm, y cm]` / `[id, 'c', x cm, z cm]` / `[id, 'f', x cm, z cm, yaw deg x10?]`, sized rows `[id, cm, cm?, cm?]`. */
export interface FittingsWire { r?: string[]; m?: (string | number)[][]; s?: (string | number)[][] }
const cm = (v: number): number => Math.round(v * 100);

export function fittingsToWire(f: FittingsOverlay): FittingsWire | undefined {
  if (isEmptyFittings(f)) return undefined;
  const w: FittingsWire = {};
  if (f.removed.length) w.r = [...f.removed];
  const moved = Object.entries(f.moved).map(([id, v]) => (v.m === 'w' ? [id, 'w', v.edge, cm(v.u), cm(v.y)] : v.m === 'c' ? [id, 'c', cm(v.x), cm(v.z)] : [id, 'f', cm(v.x), cm(v.z), ...(v.yawDeg !== undefined ? [Math.round(v.yawDeg * 10)] : [])]));
  if (moved.length) w.m = moved;
  const sized = Object.entries(f.sized).map(([id, v]) => [id, ...v.map(cm)]);
  if (sized.length) w.s = sized;
  return w;
}

export function fittingsFromWire(w: unknown): FittingsOverlay {
  const out = emptyFittings();
  if (!w || typeof w !== 'object') return out;
  const o = w as FittingsWire;
  const raw: { removed: unknown; moved: Record<string, unknown>; sized: Record<string, unknown> } = { removed: o.r, moved: {}, sized: {} };
  if (Array.isArray(o.m)) {
    for (const row of o.m.slice(0, MAX_IDS)) {
      if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
      const id = row[0];
      if (row[1] === 'w' && isNum(row[2]) && isNum(row[3]) && isNum(row[4])) raw.moved[id] = { m: 'w', edge: row[2], u: row[3] / 100, y: row[4] / 100 };
      else if (row[1] === 'c' && isNum(row[2]) && isNum(row[3])) raw.moved[id] = { m: 'c', x: row[2] / 100, z: row[3] / 100 };
      else if (row[1] === 'f' && isNum(row[2]) && isNum(row[3])) raw.moved[id] = { m: 'f', x: row[2] / 100, z: row[3] / 100, ...(isNum(row[4]) ? { yawDeg: row[4] / 10 } : {}) };
    }
  }
  if (Array.isArray(o.s)) {
    for (const row of o.s.slice(0, MAX_IDS)) {
      if (!Array.isArray(row) || typeof row[0] !== 'string' || row.length < 2) continue;
      const nums = row.slice(1).filter(isNum).map((x) => x / 100);
      if (nums.length === row.length - 1) raw.sized[row[0]] = nums;
    }
  }
  return sanitizeFittings(raw);
}

// ---------------------------------------------------------------- records: what a planner built

export interface ClassOption { /** metres: the width, diameter or length */ value: number; label: string }
export interface DimSpec { key: 'w' | 'd' | 'h'; label: string; min: number; max: number; step: number }
export type ResizeSpec =
  | { kind: 'classes'; label: string; options: ClassOption[] }
  | { kind: 'dims'; dims: DimSpec[] };

/** How a fitting may be moved: along a wall (and to another wall of its room), across its room's ceiling, or on its room's free floor. */
export type MoveRule =
  | { mount: 'wall'; shape: WallShape }
  | { mount: 'ceiling'; margin: number }
  | { mount: 'floor'; w: number; d: number; needFree: boolean; doorKeepM: number; /** may the footprint be turned */ turn?: boolean };

export interface FittingRecord {
  id: string;
  kind: FittingKind;
  name: string;
  mount: Mount;
  roomId: string;
  removed: boolean;
  moved: boolean;
  sized: boolean;
  /** the oriented box a tap hits: centre in world metres, half sizes along the box's right (x), up (y) and front (z), and its yaw (Box convention) */
  centre: { x: number; y: number; z: number };
  half: { x: number; y: number; z: number };
  yawDeg: number;
  /** what the card says: width x depth x height, or a diameter */
  size: { w: number; d: number; h: number; round?: boolean };
  /** height of its lowest point (floor) or its anchor above the floor, metres */
  heightM: number;
  wall?: { edge: number; u: number; y: number; length: number };
  provenance: 'typical' | 'renders';
  /** the honesty line of the card when it is not the standard one for `provenance` */
  label?: string;
  movable: boolean;
  moveRule?: MoveRule;
  resize: ResizeSpec | null;
  /** the size values (see ResizeSpec) the fitting has when nothing is changed */
  defaultSize: number[] | null;
  /** the size values it has now, same order */
  currentSize: number[] | null;
  /** surface decor: what it sits on */
  hostLabel?: string;
  /** a piece the planner is not drawing right now (lived-in decor under furniture a viewer put there): nothing to tap */
  hidden?: boolean;
}

export const mountText = (r: Pick<FittingRecord, 'mount' | 'heightM' | 'hostLabel'>): string => {
  switch (r.mount) {
    case 'wall': return `On the wall, lowest edge ${r.heightM.toFixed(2)} m above the floor`;
    case 'ceiling': return 'On the ceiling';
    case 'floor': return 'On the floor';
    default: return r.hostLabel ? `On the ${r.hostLabel.toLowerCase()}` : 'On a piece of furniture';
  }
};

/** "90 × 20 × 29 cm" or "60 cm across" */
export function sizeText(s: FittingRecord['size']): string {
  const c = (v: number): string => String(Math.round(v * 100));
  if (s.round) return `${c(s.w)} cm across${s.h > 0.02 ? ` · ${c(s.h)} cm high` : ''}`;
  return s.h > 0.005 ? `${c(s.w)} × ${c(s.d)} × ${c(s.h)} cm` : `${c(s.w)} × ${c(s.d)} cm`;
}

// ---------------------------------------------------------------- the oriented box a tap hits

export interface Obb { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number; yawDeg: number }
export const obbOf = (r: Pick<FittingRecord, 'centre' | 'half' | 'yawDeg'>): Obb => ({ cx: r.centre.x, cy: r.centre.y, cz: r.centre.z, hx: r.half.x, hy: r.half.y, hz: r.half.z, yawDeg: r.yawDeg });

/**
 * Where a ray first meets an oriented box (grown by `slack` metres on every side: a fingertip is not a pixel), as a distance along the ray,
 * or null. The ray direction must be a unit vector. A ray that starts inside the box meets it at 0.
 */
export function rayHitsObb(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, box: Obb, slack = 0): number | null {
  const yaw = (box.yawDeg * Math.PI) / 180;
  const s = Math.sin(yaw), c = Math.cos(yaw);
  // box frame: x = right (cos, -sin), z = front (sin, cos)
  const ox = origin.x - box.cx, oy = origin.y - box.cy, oz = origin.z - box.cz;
  const lo = [ox * c - oz * s, oy, ox * s + oz * c];
  const ld = [dir.x * c - dir.z * s, dir.y, dir.x * s + dir.z * c];
  const h = [box.hx + slack, box.hy + slack, box.hz + slack];
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-9) { if (Math.abs(lo[i]) > h[i]) return null; continue; }
    let a = (-h[i] - lo[i]) / ld[i], b = (h[i] - lo[i]) / ld[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

/** The nearest fitting a ray meets, with its distance; removed ones never. `slackFor` gives the generous reach of small things. */
export function pickFitting(
  records: readonly FittingRecord[], origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, slack: number | ((r: FittingRecord) => number) = 0,
  maxDist = 40,
): { id: string; dist: number } | null {
  let best: { id: string; dist: number } | null = null;
  for (const r of records) {
    if (r.removed || r.hidden) continue;
    const sl = typeof slack === 'function' ? slack(r) : slack;
    const t = rayHitsObb(origin, dir, obbOf(r), sl);
    if (t === null || t > maxDist) continue;
    if (!best || t < best.dist) best = { id: r.id, dist: t };
  }
  return best;
}

/** A small thing gets a bigger reach: a fingertip covers about 2 cm of wall at arm's length, a switchboard is 12 cm. */
export function hitSlack(r: Pick<FittingRecord, 'half'>, touch: boolean): number {
  const smallest = Math.max(r.half.x, r.half.y, r.half.z) * 2;
  const want = touch ? 0.2 : 0.07;
  return Math.max(0.02, Math.min(want, want * (0.6 / Math.max(0.15, smallest))));
}

// ---------------------------------------------------------------- limits and options by kind

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** AC class widths: 0.8 / 1.0 / 1.2 m (a 1 t, 1.5 t and 2 t split). The generated unit is 0.9 wide, 0.29 high, 0.2 deep. */
export const AC_CLASSES: ClassOption[] = [{ value: 0.8, label: '80 cm' }, { value: 1.0, label: '100 cm' }, { value: 1.2, label: '120 cm' }];
export const AC_DEFAULT_W = 0.9;
export const AC_H_PER_W = 0.29 / 0.9;
export const AC_D_PER_W = 0.2 / 0.9;
/** fan sweep (blade diameter) in metres: 900 / 1200 / 1400 mm */
export const FAN_SWEEPS: ClassOption[] = [{ value: 0.9, label: '900 mm' }, { value: 1.2, label: '1200 mm' }, { value: 1.4, label: '1400 mm' }];
export const TUBE_LENGTHS: ClassOption[] = [{ value: 0.6, label: '2 ft · 60 cm' }, { value: 0.9, label: '3 ft · 90 cm' }, { value: 1.22, label: '4 ft · 122 cm' }];
export const CLOCK_SIZES: ClassOption[] = [{ value: 0.25, label: '25 cm' }, { value: 0.32, label: '32 cm' }, { value: 0.45, label: '45 cm' }];
export const FRAME_WIDTHS: ClassOption[] = [{ value: 0.4, label: '40 cm' }, { value: 0.62, label: '62 cm' }, { value: 0.9, label: '90 cm' }];

export const nearestOption = (opts: ClassOption[], v: number): ClassOption => opts.reduce((a, b) => (Math.abs(b.value - v) < Math.abs(a.value - v) ? b : a));

/** Sensible range of a stepper by kind, in metres (width / depth / height). */
export function dimLimits(kind: FittingKind, defaults: { w: number; d: number; h: number }): DimSpec[] {
  switch (kind) {
    case 'rug': return [
      { key: 'w', label: 'Width', min: 0.9, max: 3.2, step: 0.1 },
      { key: 'd', label: 'Depth', min: 0.9, max: 3.2, step: 0.1 },
    ];
    case 'curtain': return [{ key: 'w', label: 'Width', min: 0.6, max: 4, step: 0.1 }];
    case 'plant': return [{ key: 'h', label: 'Height', min: Math.max(0.3, defaults.h * 0.6), max: defaults.h * 1.5, step: 0.05 }];
    default: return [];
  }
}

// ---------------------------------------------------------------- walls

export interface WallSpanLike { u0: number; u1: number; type: 'door' | 'opening' | 'window'; sillM: number; headM: number }
export interface WallInfoLike { room: RoomTag; frame: EdgeFrame; spans: WallSpanLike[] }

export interface WallShape {
  /** width along the wall, metres */
  w: number;
  /** the vertical extent as a function of the anchor height: [lowest, highest] point above the floor */
  yRange: (y: number) => [number, number];
  /** lowest and highest anchor height the fitting may be moved to */
  yMin: number;
  yMax: number;
  /** curtains hang over a window by design: windows never block them (a door still does) */
  overWindows?: boolean;
  /** clear wall kept at each end, metres */
  endPad?: number;
}

const DOOR_PAD = 0.05;
const WINDOW_PAD = 0.04;

/** A piece of furniture that may stand in front of a wall fitting (its footprint corners and height) */
export interface WallBlocker { box: { cx: number; cz: number; w: number; d: number; yawDeg: number }; heightM: number }

/** The stretch of an edge (u0..u1) a blocker stands in front of when it is within `nearM` of the wall, else null. */
function blockerSpan(f: EdgeFrame, b: WallBlocker, nearM: number): [number, number] | null {
  const yaw = (b.box.yawDeg * Math.PI) / 180;
  const a = { x: Math.sin(yaw), z: Math.cos(yaw) }, r = { x: Math.cos(yaw), z: -Math.sin(yaw) };
  let u0 = Infinity, u1 = -Infinity, dMin = Infinity, dMax = -Infinity;
  for (const [sa, sb] of [[-1, -1], [-1, 1], [1, 1], [1, -1]]) {
    const px = b.box.cx + a.x * sa * b.box.d / 2 + r.x * sb * b.box.w / 2, pz = b.box.cz + a.z * sa * b.box.d / 2 + r.z * sb * b.box.w / 2;
    const u = (px - f.a.x) * f.dir.x + (pz - f.a.z) * f.dir.z;
    const d = -((px - f.a.x) * f.out.x + (pz - f.a.z) * f.out.z);
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); dMin = Math.min(dMin, d); dMax = Math.max(dMax, d);
  }
  if (dMin > nearM || dMax < -0.1) return null;
  return [u0, u1];
}

/** Stretches of an edge (centre positions) where a fitting of `shape` at anchor height `y` touches nothing it must not cross. Sorted. */
export function allowedCentres(info: WallInfoLike, shape: WallShape, y: number, blockers: readonly WallBlocker[] = []): [number, number][] {
  const L = info.frame.length;
  const pad = shape.endPad ?? 0.08;
  const half = shape.w / 2;
  const lo = half + pad, hi = L - half - pad;
  if (hi < lo) return [];
  const [y0, y1] = shape.yRange(y);
  const blocks: [number, number][] = [];
  for (const s of info.spans) {
    const isWindow = s.type === 'window';
    if (isWindow && shape.overWindows) continue;
    // above or below the hole: no clash
    if (y0 >= s.headM - 1e-6 && !isWindow) continue;
    if (isWindow && (y0 >= s.headM + WINDOW_PAD || y1 <= s.sillM - WINDOW_PAD)) continue;
    const p = isWindow ? WINDOW_PAD : DOOR_PAD;
    blocks.push([s.u0 - p - half, s.u1 + p + half]);
  }
  // furniture that stands against the wall and reaches above the fitting's lowest point hides it: the viewer is not offered that stretch
  if (!shape.overWindows) {
    for (const b of blockers) {
      if (b.heightM <= y0 + 0.02) continue;
      const span = blockerSpan(info.frame, b, 0.3);
      if (span) blocks.push([span[0] - 0.02 - half, span[1] + 0.02 + half]);
    }
  }
  blocks.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let at = lo;
  for (const [a, b] of blocks) {
    if (a > at) out.push([at, Math.min(a, hi)]);
    at = Math.max(at, b);
    if (at > hi) break;
  }
  if (at <= hi) out.push([at, hi]);
  return out.filter(([a, b]) => b - a >= -1e-9);
}

/** The nearest allowed centre to `u`, or null when the wall has no room for the fitting at this height. */
export function nearestAllowed(runs: [number, number][], u: number): number | null {
  let best: number | null = null, bestD = Infinity;
  for (const [a, b] of runs) {
    const c = clamp(u, a, b);
    const d = Math.abs(c - u);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

export interface WallTarget { edge: number; u: number; y: number; frame: EdgeFrame }

/**
 * A request to put a wall fitting on wall `edge` of its room at (u, y): the height is kept inside the kind's range, and the position slides to the
 * nearest stretch that is clear of doors, openings and (unless it hangs over windows) windows, and of the corners. Null when that wall has no room.
 */
export function resolveWallMove(infos: readonly WallInfoLike[], roomId: string, req: { edge: number; u: number; y: number }, shape: WallShape, blockers: readonly WallBlocker[] = []): WallTarget | null {
  const info = infos.find((w) => w.room.id === roomId && w.frame.edge === req.edge && w.frame.kind === 'wall');
  if (!info) return null;
  const y = clamp(req.y, shape.yMin, shape.yMax);
  const u = nearestAllowed(allowedCentres(info, shape, y, blockers), req.u);
  return u === null ? null : { edge: info.frame.edge, u, y, frame: info.frame };
}

/** The wall edge of `roomId` a point near the wall belongs to: the nearest wall edge of the room, with the point's distance to it. */
export function nearestWallEdge(frames: readonly EdgeFrame[], roomId: string, p: Vec2, rayDirXZ?: Vec2): { frame: EdgeFrame; u: number; dist: number } | null {
  let best: { frame: EdgeFrame; u: number; dist: number } | null = null;
  for (const f of frames) {
    if (f.roomId !== roomId || f.kind !== 'wall') continue;
    // a ray that hits a wall from inside the room travels against the wall's outward normal: a wall whose normal points along the ray is seen from behind
    const d = distanceToSegment(p, f.a, f.b);
    const u = clamp((p.x - f.a.x) * f.dir.x + (p.z - f.a.z) * f.dir.z, 0, f.length);
    if (rayDirXZ && f.out.x * rayDirXZ.x + f.out.z * rayDirXZ.z > 0.2) continue;
    if (!best || d < best.dist) best = { frame: f, u, dist: d };
  }
  return best;
}

// ---------------------------------------------------------------- ceilings

const clearance = (pt: Vec2, poly: Vec2[]): number => {
  let b = Infinity;
  for (let i = 0; i < poly.length; i++) b = Math.min(b, distanceToSegment(pt, poly[i], poly[(i + 1) % poly.length]));
  return b;
};

/** A point on the ceiling of `room` that keeps `margin` metres from every wall: the request itself, or the nearest point on the way to the room's middle. */
export function resolveCeilingMove(room: RoomTag, req: Vec2, margin: number, centre: Vec2): Vec2 | null {
  const ok = (p: Vec2): boolean => pointInPolygon(p, room.polygon) && clearance(p, room.polygon) >= margin;
  if (ok(req)) return { x: req.x, z: req.z };
  for (let i = 1; i <= 40; i++) {
    const t = i / 40;
    const p = { x: req.x + (centre.x - req.x) * t, z: req.z + (centre.z - req.z) * t };
    if (ok(p)) return p;
  }
  return ok(centre) ? centre : null;
}

// ---------------------------------------------------------------- floors

export interface DoorSite { at: Vec2; widthM: number; frame: EdgeFrame }

export interface FloorBox { cx: number; cz: number; w: number; d: number; yawDeg: number }

function floorSamples(b: FloorBox, step = 0.07): Vec2[] {
  const y = (b.yawDeg * Math.PI) / 180;
  const a = { x: Math.sin(y), z: Math.cos(y) }, r = { x: Math.cos(y), z: -Math.sin(y) };
  const nx = Math.max(1, Math.ceil(b.w / step)), nz = Math.max(1, Math.ceil(b.d / step));
  const out: Vec2[] = [];
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    const lx = -b.w / 2 + (b.w * i) / nx, lz = -b.d / 2 + (b.d * j) / nz;
    out.push({ x: b.cx + r.x * lx + a.x * lz, z: b.cz + r.z * lx + a.z * lz });
  }
  return out;
}

export type FloorVerdict = { ok: true } | { ok: false; reason: 'outside' | 'blocked' | 'doorway' };

/**
 * Can a floor fitting stand here? All of it inside its room; (`needFree`) on cells the walking grid calls free; and clear of every doorway by
 * `doorKeepM` beyond the door's own half width. A rug is flat, so it only keeps off the doorway itself (`needFree` false, a small keep).
 */
export function checkFloorSpot(box: FloorBox, room: RoomTag, grid: Grid | null, doors: readonly DoorSite[], opts: { needFree: boolean; doorKeepM: number }): FloorVerdict {
  const pts = floorSamples(box);
  for (const p of pts) if (!pointInPolygon(p, room.polygon)) return { ok: false, reason: 'outside' };
  if (opts.needFree && grid) {
    for (const p of pts) {
      const k = cellIndex(grid, p.x, p.z);
      if (k < 0 || grid.cells[k] !== GRID_FREE) return { ok: false, reason: 'blocked' };
    }
  }
  for (const d of doors) {
    const r = Math.max(0.45, d.widthM / 2) + opts.doorKeepM;
    if (pts.some((p) => Math.hypot(p.x - d.at.x, p.z - d.at.z) < r)) return { ok: false, reason: 'doorway' };
  }
  return { ok: true };
}

export const FLOOR_REASON_TEXT: Record<'outside' | 'blocked' | 'doorway', string> = {
  outside: 'It has to stay inside its room.',
  blocked: 'Something is in the way there.',
  doorway: 'That would block a doorway.',
};

// ---------------------------------------------------------------- small helpers shared by the planners

/** yaw (Box convention, local +Z) of a unit direction */
export const yawOf = (x: number, z: number): number => (Math.atan2(x, z) * 180) / Math.PI;

/** The oriented box of a wall fitting: depth `d` reaches from the wall into the room; `y0` and `y1` are its lowest and highest points. */
export function wallObb(f: EdgeFrame, u: number, y0: number, y1: number, w: number, d: number): Pick<FittingRecord, 'centre' | 'half' | 'yawDeg'> {
  const into = { x: -f.out.x, z: -f.out.z };
  return {
    centre: { x: f.a.x + f.dir.x * u + into.x * (d / 2), y: (y0 + y1) / 2, z: f.a.z + f.dir.z * u + into.z * (d / 2) },
    half: { x: w / 2, y: (y1 - y0) / 2, z: d / 2 },
    yawDeg: yawOf(into.x, into.z),
  };
}

export const roundTo = r2;

/** a deterministic id suffix, for tests that want to prove ids are stable */
export function idHash(text: string): string {
  const rnd = mulberry32([...text].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0);
  return Math.floor(rnd() * 0xffffff).toString(36);
}

export type { Layout };

// ---------------------------------------------------------------- overlay edits (pure, return a new overlay)

const without = (o: FittingsOverlay, id: string): FittingsOverlay => {
  const c = cloneFittings(o);
  c.removed = c.removed.filter((x) => x !== id);
  delete c.moved[id];
  delete c.sized[id];
  return c;
};
export function fittingsRemove(o: FittingsOverlay, id: string): FittingsOverlay {
  const c = without(o, id);
  c.removed.push(id);
  return c;
}
/** Undo a removal: the fitting comes back where and how big it was before it was removed (a move or a size made before stays). */
export function fittingsRestore(o: FittingsOverlay, id: string): FittingsOverlay {
  const c = cloneFittings(o);
  c.removed = c.removed.filter((x) => x !== id);
  return c;
}
export function fittingsMove(o: FittingsOverlay, id: string, spec: MoveSpec): FittingsOverlay {
  const c = cloneFittings(o);
  c.removed = c.removed.filter((x) => x !== id);
  c.moved[id] = { ...spec };
  return c;
}
export function fittingsSize(o: FittingsOverlay, id: string, values: number[]): FittingsOverlay {
  const c = cloneFittings(o);
  c.sized[id] = [...values];
  return c;
}
/** back to how the home has it: no move, no size, not removed */
export function fittingsClear(o: FittingsOverlay, id: string): FittingsOverlay { return without(o, id); }
export function fittingsClearSize(o: FittingsOverlay, id: string): FittingsOverlay {
  const c = cloneFittings(o);
  delete c.sized[id];
  return c;
}
export function fittingsClearMove(o: FittingsOverlay, id: string): FittingsOverlay {
  const c = cloneFittings(o);
  delete c.moved[id];
  return c;
}

// ---------------------------------------------------------------- the registry the planners report into

/** Every planner (the kit, the design mount, lived-in decor, the drawing's chairs) sets its records here under its own name. Pure. */
export interface FittingRegistry {
  set(source: string, records: FittingRecord[]): void;
  all(): FittingRecord[];
  get(id: string): FittingRecord | undefined;
  onChange(cb: () => void): () => void;
}

export function createFittingRegistry(): FittingRegistry {
  const by = new Map<string, FittingRecord[]>();
  const index = new Map<string, FittingRecord>();
  const listeners = new Set<() => void>();
  return {
    set(source, records) {
      by.set(source, records);
      index.clear();
      for (const list of by.values()) for (const r of list) index.set(r.id, r);
      for (const cb of [...listeners]) { try { cb(); } catch (err) { console.error('[walkthru] fittings listener threw', err); } }
    },
    all: () => [...index.values()],
    get: (id) => index.get(id),
    onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };
}
