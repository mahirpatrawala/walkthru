// Views: a set of still camera positions for a flat, composed from its own layout (SPEC 2.10). Pure: no DOM, no three.
//
// HOW A VIEW IS CHOSEN. For each whole room, the places to stand are a lattice of points by its doorways, in its corners and along its walls
// (never the middle of the floor), each at least STAND_CLEAR_M from every wall and piece of furniture on the walking grid, clear of every door
// leaf where it rests shut and where it rests open, and inside the room. From each place 72 sight lines (every 5 degrees) are traced on the grid
// at eye height: a wall or anything taller than the eye ends one, a window or a railing with open air beyond it is an outlook. A heading is kept
// only if it does not face a wall or a tall piece within FACE_MIN_M, and, in a room with a main piece (bed, sofa, dining table, kitchen counter),
// only if that piece is in frame (its middle within FRAME_HALF_DEG of the heading, seen, not too close). What is kept is scored: the depth of
// the view (the sight lines over a 60 degree fan), the longest open line straight ahead set against the room's diagonal, a window or the
// balcony in frame, standing in a doorway or a corner, the main piece well placed and at a good distance. Each room keeps its best view and up
// to its share of others that are as good and look a different way. The flat's front door gives one more: just inside it, looking in.
//
// NAMES are the layout's own room names and what is true of the view: "Living · from the entrance", "Master bedroom · towards the window",
// "Balcony · looking out", "Kitchen · towards the counter". Nothing is said that the layout does not show.
import { GRID_VOID } from '../../types';
import type { FurnitureItem, Grid, Layout, RoomTag, Vec2 } from '../../types';
import { circleFree } from '../../core/grid-query';
import { distanceToSegment, pointInPolygon, polygonArea } from '../../core/geometry';
import { computeEdgeFrames } from '../../core/layout-geom';
import { mainEntrance } from '../../core/entrance';
import { distanceToLeaf, freePos, resolveDoors } from '../../core/doors';
import type { Door } from '../../core/doors';
import { yawToward } from '../../core/spawn';
import { pickNext, roomKind } from '../nav/tour-plan';
import type { RoomKind } from '../nav/tour-plan';

/** Eye height of every composed view, metres: the architect's 1.5 to 1.6 m, and within a few cm of the walk's own first-person eye (0.93 of a 160 to 175 cm walker). */
export const VIEW_EYE_M = 1.55;
/** Clear floor around the place a view stands, metres (walls and furniture on the walking grid). */
export const STAND_CLEAR_M = 0.35;
/** A view never stands nearer than this to a door leaf, shut or open. */
const LEAF_CLEAR_M = 0.4;
/** Nor nearer than this to an open side of the room (it must be in the room, not on its threshold). */
const OPEN_EDGE_INSET_M = 0.3;
/** Nothing taller than this ends a sight line early (cm on the grid): the eye is at 155 cm. */
const BLOCK_CM = 150;
/** A view does not face a wall or a tall piece nearer than this anywhere within 10 degrees of its heading, nor nearer than CENTRE_MIN_M straight ahead. */
export const FACE_MIN_M = 1.5;
const CENTRE_MIN_M = 1.8;
/** The main piece is in frame: its middle within this many degrees of the heading (in frame on a 16:9 screen and on a phone held upright). */
export const FRAME_HALF_DEG = 22;
/** ... and at least this far away. */
export const SUBJECT_MIN_M = 1.5;
const RAYS = 72;
const RAY_STEP_M = 0.06;
const RAY_MAX_M = 9;
const LATTICE_M = 0.15;
/** At most this many views for one flat. */
export const MAX_VIEWS = 18;
/** A view that scores under this (out of about 8) is not worth showing. */
const MIN_SCORE = 4.0;
/** A second view of a room must be at least this good next to the room's best. */
const SECOND_SHARE = 0.72;
/** What a sight line sees past its own room counts for this much. */
const BEYOND_K = 0.45;
/** At least this share of what the middle of the frame sees must be inside the view's own room (a bath, a bedroom, a kitchen, a utility). */
const OWN_SHARE_MIN = 0.55;
/** The view from the front door must see at least this far along most of its middle 60 degrees (ENTRANCE_OPEN_SHARE of the sight lines), metres. */
const ENTRANCE_MIN_FAN_M = 2.5;
const ENTRANCE_OPEN_SHARE = 0.6;

export type ViewKind = 'entrance' | 'outlook' | 'window' | 'door' | 'subject' | 'corner' | 'across' | 'authored';

export interface Viewpoint {
  /** stable: the room's id and the view's number in it ("living-1"); the `vp=` of a link */
  id: string;
  roomId: string;
  roomLabel: string;
  /** what the view is, after the room: "from the entrance" */
  phrase: string;
  /** "Living · from the entrance" */
  name: string;
  /** where the eye is, scene frame, metres */
  x: number;
  z: number;
  /** eye height above the floor, metres */
  eyeM: number;
  /** the heading: forward is (sin yaw, cos yaw), SPEC 3.1 */
  yawDeg: number;
  /** degrees below level (positive looks down) */
  pitchDeg: number;
  kind: ViewKind;
  /** the piece kept in frame, when the room has a main piece */
  subjectId?: string;
  /** how the view scored (generated views only) */
  score?: number;
  source: 'generated' | 'authored';
  /** the room tab it is listed under (SPEC 2.10: a bath or a balcony is listed under the room it opens off) */
  tabId: string;
  tabLabel: string;
  /** a 360 degree picture rendered offline from this view (SPEC 2.10): shown on arrival, with "Illustrative render" */
  pano?: PanoRef;
}

/**
 * An equirectangular picture (2:1) rendered from a camera at (x, y, z) in the scene's three.js frame (metres, y up), the middle of the picture
 * looking along `yawDeg` (forward is (sin yaw, 0, cos yaw)), level, the right half of the picture to the viewer's right.
 */
export interface PanoRef { url: string; x: number; y: number; z: number; yawDeg: number }

/** A room tab: a main room and the baths, balconies and passages that open off it. */
export interface ViewTab { id: string; label: string; roomIds: string[]; viewIds: string[] }

export interface ComposeInput {
  layout: Layout;
  furniture: readonly FurnitureItem[];
  /** walls and furniture, no door leaves and no people: the walking grid as drawn */
  grid: Grid;
}

// ---------------------------------------------------------------- small maths

const DEG = Math.PI / 180;
const wrap = (d: number): number => { const r = ((((d + 180) % 360) + 360) % 360) - 180; return r === -180 ? 180 : r; };
const norm360 = (d: number): number => ((d % 360) + 360) % 360;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** `d`: how far the eye sees; `own`: how much of that is inside the view's own room (the rest is a room beyond, or open air) */
interface Sight { d: number; outlook: boolean; own: number }

/** How far the eye sees from `p` along `yawDeg` before a wall or anything taller than the eye; open air past a window or a railing is an outlook (seen to the limit). */
export function sightLine(grid: Grid, p: Vec2, yawDeg: number, maxM = RAY_MAX_M, room?: Uint8Array): Sight {
  const dx = Math.sin(yawDeg * DEG), dz = Math.cos(yawDeg * DEG);
  const { cells, nx, nz, originX, originZ, cellM } = grid;
  let low = -1, own = -1;
  for (let d = RAY_STEP_M; d <= maxM; d += RAY_STEP_M) {
    const i = Math.floor((p.x + dx * d - originX) / cellM), j = Math.floor((p.z + dz * d - originZ) / cellM);
    const out = i < 0 || j < 0 || i >= nx || j >= nz;
    const v = out ? GRID_VOID : cells[j * nx + i];
    if (own < 0 && room && (out || !room[j * nx + i])) own = d;
    const ownAt = (end: number): number => (room ? (own < 0 ? end : Math.min(own, end)) : end);
    if (v === GRID_VOID) return low >= 0 && d - low < 0.6 ? { d: maxM, outlook: true, own: ownAt(d) } : { d, outlook: false, own: ownAt(d) };
    if (v >= BLOCK_CM) return { d, outlook: false, own: ownAt(d) };
    if (v > 0) low = d;
  }
  return { d: maxM, outlook: false, own: room ? (own < 0 ? maxM : own) : maxM };
}

/** The cells of the grid inside a room (1) and outside (0). */
function roomMask(grid: Grid, poly: Vec2[]): Uint8Array {
  const m = new Uint8Array(grid.nx * grid.nz);
  const xs = poly.map((q) => q.x), zs = poly.map((q) => q.z);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - grid.originX) / grid.cellM)), i1 = Math.min(grid.nx - 1, Math.ceil((Math.max(...xs) - grid.originX) / grid.cellM));
  const j0 = Math.max(0, Math.floor((Math.min(...zs) - grid.originZ) / grid.cellM)), j1 = Math.min(grid.nz - 1, Math.ceil((Math.max(...zs) - grid.originZ) / grid.cellM));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (pointInPolygon({ x: grid.originX + (i + 0.5) * grid.cellM, z: grid.originZ + (j + 0.5) * grid.cellM }, poly)) m[j * grid.nx + i] = 1;
  }
  return m;
}

// ---------------------------------------------------------------- what a room has

interface Entry { at: Vec2; inward: Vec2; type: 'door' | 'opening' | 'open'; leadsTo: RoomTag | null; openingId: string | null }
interface Light { at: Vec2; word: string; kind: 'window' | 'balcony' }
interface Subject { id: string; at: Vec2; surfaceM: number; halfDiag: number; word: string; required: boolean; rank: number }
interface RoomInfo {
  room: RoomTag;
  kind: RoomKind;
  area: number;
  diag: number;
  entries: Entry[];
  lights: Light[];
  corners: Vec2[];
  rails: { at: Vec2; out: Vec2 }[];
  subjects: Subject[];
  openEdges: [Vec2, Vec2][];
  doors: { door: Door; open: number }[];
  /** the room's cells on the grid (made on first use) */
  mask?: Uint8Array;
  /** a bath's fittings (basin, WC, shower): its view keeps them in frame */
  fixtures: Vec2[];
}

function subjectWord(it: FurnitureItem): string {
  const l = it.label.toLowerCase();
  if (it.kind === 'bed') return 'the bed';
  if (it.kind === 'dining') return 'the dining table';
  if (it.kind === 'sofa') return /armchair|chair/.test(l) ? 'the armchairs' : 'the sofa';
  if (it.kind === 'wardrobe') return 'the wardrobe';
  if (/basin/.test(l)) return 'the basin';
  if (/washing|washer/.test(l)) return 'the washing machine';
  if (/desk|study/.test(l)) return 'the desk';
  if (/counter|hob|sink/.test(l)) return 'the counter';
  return `the ${l}`;
}

/** The pieces a room is about, best first. Bed, sofa (not an ottoman), dining table and a kitchen's counter are main pieces: every view of the room keeps one in frame. */
function subjectsOf(room: RoomTag, items: readonly FurnitureItem[]): Subject[] {
  const inRoom = items.filter((it) => pointInPolygon({ x: it.box.cx, z: it.box.cz }, room.polygon));
  const out: Subject[] = [];
  const take = (it: FurnitureItem, rank: number, required: boolean): void => {
    out.push({ id: it.id, at: { x: it.box.cx, z: it.box.cz }, surfaceM: it.surfaceHeightM, halfDiag: Math.hypot(it.box.w, it.box.d) / 2, word: subjectWord(it), required, rank });
  };
  const biggest = (xs: FurnitureItem[]): FurnitureItem | null => xs.reduce<FurnitureItem | null>((b, it) => (!b || it.box.w * it.box.d > b.box.w * b.box.d + 1e-9 ? it : b), null);
  const bed = biggest(inRoom.filter((it) => it.kind === 'bed'));
  if (bed) take(bed, 5, true);
  const seats = inRoom.filter((it) => it.kind === 'sofa' && !/ottoman|pouf|stool/i.test(it.label));
  const sofa = biggest(seats.filter((it) => !/armchair|chair/i.test(it.label))) ?? biggest(seats);
  if (sofa) take(sofa, 4, room.roomType === 'living' || room.roomType === 'bedroom');
  const dining = biggest(inRoom.filter((it) => it.kind === 'dining'));
  if (dining) take(dining, 3, true);
  const counters = inRoom.filter((it) => it.kind === 'counter' && !/fridge|refrigerator|tv|shower|geyser/i.test(it.label));
  if (room.roomType === 'kitchen') {
    // the kitchen's counters, the largest first: any one of them in frame keeps the kitchen in the view (a galley is seen along its counters)
    const runs = counters.filter((it) => /counter|hob|sink/i.test(it.label));
    for (const c of (runs.length ? runs : counters).slice().sort((a, b) => b.box.w * b.box.d - a.box.w * a.box.d || (a.id < b.id ? -1 : 1))) take(c, 2, true);
  } else if (out.length === 0) {
    const prefer = counters.find((it) => /basin|washing|washer|desk|study/i.test(it.label)) ?? biggest(counters);
    if (prefer) take(prefer, 1, false);
  }
  // in a bedroom the bed is the piece; a sofa there is only a bonus
  if (bed) for (const s of out) if (s.id !== bed.id) s.required = false;
  return out.sort((a, b) => b.rank - a.rank);
}

function analyse(layout: Layout, items: readonly FurnitureItem[], grid: Grid, doors: Door[]): Map<string, RoomInfo> {
  const frames = computeEdgeFrames(layout);
  const byId = new Map(layout.rooms.map((r) => [r.id, r]));
  const infos = new Map<string, RoomInfo>();
  const roomOfPoint = (p: Vec2, not: string): RoomTag | null => layout.rooms.find((r) => r.id !== not && pointInPolygon(p, r.polygon)) ?? null;
  const openAt = new Map(doors.map((d) => [d.id, freePos(grid, d, 0).pos]));
  for (const room of layout.rooms) {
    if (room.partial) continue;
    const xs = room.polygon.map((q) => q.x), zs = room.polygon.map((q) => q.z);
    const info: RoomInfo = {
      room, kind: roomKind(room), area: Math.abs(polygonArea(room.polygon)),
      diag: Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)),
      entries: [], lights: [], corners: [], rails: [], subjects: subjectsOf(room, items), openEdges: [],
      fixtures: room.roomType === 'bathroom' ? items.filter((it) => it.kind === 'counter' && pointInPolygon({ x: it.box.cx, z: it.box.cz }, room.polygon)).map((it) => ({ x: it.box.cx, z: it.box.cz })) : [],
      doors: doors.filter((d) => d.rooms.includes(room.id)).map((d) => ({ door: d, open: openAt.get(d.id) ?? 0 })),
    };
    infos.set(room.id, info);
  }
  // doorways, open sides, windows and railings, seen from each room they belong to
  for (const f of frames) {
    const room = byId.get(f.roomId);
    if (!room || room.partial) continue;
    const info = infos.get(room.id) as RoomInfo;
    const inward = { x: -f.out.x, z: -f.out.z };
    if (f.kind === 'railing') info.rails.push({ at: { x: (f.a.x + f.b.x) / 2, z: (f.a.z + f.b.z) / 2 }, out: { x: f.out.x, z: f.out.z } });
    if (f.kind === 'none') {
      info.openEdges.push([f.a, f.b]);
      const mid = { x: (f.a.x + f.b.x) / 2, z: (f.a.z + f.b.z) / 2 };
      const other = roomOfPoint({ x: mid.x + f.out.x * (f.thickness + 0.3), z: mid.z + f.out.z * (f.thickness + 0.3) }, room.id);
      info.entries.push({ at: mid, inward, type: 'open', leadsTo: other, openingId: null });
      if (other && !other.partial) {
        const oi = infos.get(other.id) as RoomInfo;
        oi.entries.push({ at: { x: mid.x + f.out.x * f.thickness, z: mid.z + f.out.z * f.thickness }, inward: { x: f.out.x, z: f.out.z }, type: 'open', leadsTo: room, openingId: null });
      }
    }
  }
  const frameOf = new Map(frames.map((f) => [`${f.roomId}:${f.edge}`, f]));
  for (const o of layout.openings) {
    const f = frameOf.get(`${o.roomId}:${o.edge}`);
    const room = byId.get(o.roomId);
    if (!f || !room || room.partial) continue;
    const at = { x: f.a.x + f.dir.x * o.centreM, z: f.a.z + f.dir.z * o.centreM };
    const info = infos.get(room.id) as RoomInfo;
    if (o.type === 'window') { info.lights.push({ at, word: 'the window', kind: 'window' }); continue; }
    const far = { x: at.x + f.out.x * (f.thickness + 0.3), z: at.z + f.out.z * (f.thickness + 0.3) };
    const other = roomOfPoint(far, room.id);
    const type: Entry['type'] = o.type === 'door' ? 'door' : 'opening';
    info.entries.push({ at, inward: { x: -f.out.x, z: -f.out.z }, type, leadsTo: other, openingId: o.id });
    const farAt = { x: at.x + f.out.x * f.thickness, z: at.z + f.out.z * f.thickness };
    if (other && !other.partial) (infos.get(other.id) as RoomInfo).entries.push({ at: farAt, inward: { x: f.out.x, z: f.out.z }, type, leadsTo: room, openingId: o.id });
    // a door onto a balcony is the light of the room it opens from
    if (other && other.roomType === 'balcony' && room.roomType !== 'balcony') info.lights.push({ at, word: `the ${other.label.toLowerCase()}`, kind: 'balcony' });
    if (other && room.roomType === 'balcony' && other.roomType !== 'balcony' && !other.partial) (infos.get(other.id) as RoomInfo).lights.push({ at: farAt, word: `the ${room.label.toLowerCase()}`, kind: 'balcony' });
  }
  // corners: a vertex where two walls meet and the room is convex there
  for (const info of infos.values()) {
    const p = info.room.polygon, n = p.length, sign = Math.sign(polygonArea(p)) || 1;
    for (let i = 0; i < n; i++) {
      const prev = p[(i + n - 1) % n], v = p[i], next = p[(i + 1) % n];
      if (info.room.edges[(i + n - 1) % n] !== 'wall' || info.room.edges[i] !== 'wall') continue;
      const cross = (v.x - prev.x) * (next.z - v.z) - (v.z - prev.z) * (next.x - v.x);
      if (cross * sign > 1e-6) info.corners.push(v);
    }
  }
  return infos;
}

// ---------------------------------------------------------------- places to stand

type PlaceClass = 'door' | 'corner' | 'edge';
interface Place { p: Vec2; cls: PlaceClass; entry: Entry | null; prof: Sight[]; /** 0.6 m clear all round: not pressed against a piece */ roomy: boolean }

function placesIn(info: RoomInfo, grid: Grid, near?: Entry): Place[] {
  const poly = info.room.polygon;
  const xs = poly.map((q) => q.x), zs = poly.map((q) => q.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const out: Place[] = [];
  const mask = info.mask ?? (info.mask = roomMask(grid, poly));
  const nx = Math.floor((x1 - x0) / LATTICE_M), nz = Math.floor((z1 - z0) / LATTICE_M);
  const ox = x0 + (x1 - x0 - nx * LATTICE_M) / 2, oz = z0 + (z1 - z0 - nz * LATTICE_M) / 2;
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const p = { x: round3(ox + i * LATTICE_M), z: round3(oz + j * LATTICE_M) };
      if (!pointInPolygon(p, poly)) continue;
      if (info.openEdges.some(([a, b]) => distanceToSegment(p, a, b) < OPEN_EDGE_INSET_M)) continue;
      if (!circleFree(grid, p.x, p.z, STAND_CLEAR_M)) continue;
      if (info.doors.some(({ door, open }) => distanceToLeaf(door, 0, p) < LEAF_CLEAR_M || distanceToLeaf(door, open, p) < LEAF_CLEAR_M)) continue;
      let cls: PlaceClass | null = null, entry: Entry | null = null;
      const entries = near ? [near] : info.entries;
      for (const e of entries) {
        const into = (p.x - e.at.x) * e.inward.x + (p.z - e.at.z) * e.inward.z;
        if (into >= 0.25 && into <= 1.5 && dist(p, e.at) <= 1.5) { cls = 'door'; entry = e; break; }
      }
      if (near && cls !== 'door') continue;
      if (!cls && info.corners.some((c) => dist(c, p) <= 1.15)) cls = 'corner';
      if (!cls) {
        let edge = Infinity;
        for (let k = 0; k < poly.length; k++) edge = Math.min(edge, distanceToSegment(p, poly[k], poly[(k + 1) % poly.length]));
        if (edge <= 0.95) cls = 'edge';
      }
      if (!cls) continue;
      const prof: Sight[] = [];
      for (let k = 0; k < RAYS; k++) prof.push(sightLine(grid, p, k * (360 / RAYS), RAY_MAX_M, mask));
      out.push({ p, cls, entry, prof, roomy: circleFree(grid, p.x, p.z, 0.6) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- composing and scoring

interface Shot {
  room: RoomInfo;
  p: Vec2;
  yawDeg: number;
  pitchDeg: number;
  score: number;
  cls: PlaceClass;
  entry: Entry | null;
  subject: Subject | null;
  light: Light | null;
  /** how well the light is framed, 0..1 */
  lightK: number;
  windowsInFrame: number;
  outlook: boolean;
  entrance: boolean;
}

const STEP_DEG = 360 / RAYS;
const at = (prof: Sight[], k: number): Sight => prof[((k % RAYS) + RAYS) % RAYS];

/** The nearest wall or tall piece within 10 degrees either side of a heading, in 2.5 degree steps (an outlook is open). */
export function faceAt(grid: Grid, p: Vec2, yawDeg: number): number {
  let m = Infinity;
  for (let a = -10; a <= 10; a += 2.5) m = Math.min(m, sightLine(grid, p, yawDeg + a).d);
  return m;
}

/** Is `target` seen from `p` (no wall or tall piece before it)? */
function seen(grid: Grid, p: Vec2, target: Vec2, slackM: number): boolean {
  const d = dist(p, target);
  const s = sightLine(grid, p, yawToward(p, target), d + 0.5);
  return s.outlook || s.d >= d - slackM;
}

function shotsFrom(place: Place, info: RoomInfo, grid: Grid, entrance: boolean, onlySubject?: Subject): Shot[] {
  const out: Shot[] = [];
  const { p, prof } = place;
  const required = info.subjects.filter((s) => s.required && (!onlySubject || s.rank === onlySubject.rank));
  const optional = info.subjects.filter((s) => !s.required);
  const subjInfo = info.subjects.map((s) => ({ s, yaw: yawToward(p, s.at), d: dist(p, s.at), vis: seen(grid, p, s.at, s.halfDiag + 0.1) }));
  const lightInfo = info.lights.map((l) => ({ l, yaw: yawToward(p, l.at), d: dist(p, l.at), vis: seen(grid, p, l.at, 0.35) }));
  const roomScale = Math.max(2.5, info.diag);
  for (let k = 0; k < RAYS; k++) {
    const yaw = k * STEP_DEG;
    const s0 = prof[k];
    let near = Infinity;
    for (let j = -2; j <= 2; j++) near = Math.min(near, at(prof, k + j).d);
    if (s0.d < CENTRE_MIN_M || near < FACE_MIN_M) continue;
    // the main piece in frame
    let subject: Subject | null = null, subjK = 0, distK = 0;
    const consider = required.length ? required : optional;
    for (const si of subjInfo) {
      if (!consider.includes(si.s)) continue;
      const a = Math.abs(wrap(si.yaw - yaw));
      if (a > FRAME_HALF_DEG || si.d < SUBJECT_MIN_M || !si.vis) continue;
      const k1 = 1 - a / (2 * FRAME_HALF_DEG);
      const dk = si.d < 2 ? clamp01((si.d - SUBJECT_MIN_M) / 0.8) : si.d > 4.8 ? clamp01(1 - (si.d - 4.8) / 3) : 1;
      if (!subject || k1 + dk + si.s.rank * 0.01 > subjK + distK + subject.rank * 0.01) { subject = si.s; subjK = k1; distK = dk; }
    }
    if (required.length && !subject) continue;
    // depth: the fan of sight lines; the longest open line straight ahead, set against the room's diagonal. A view is of its own room: what lies
    // beyond it (the next room, the open air) counts for less, so a kitchen view looks at the kitchen, not over its counter at the living room
    const eff = (s: Sight): number => s.own + BEYOND_K * Math.max(0, Math.min(7, s.d) - s.own);
    let fan = 0, sky = 0;
    for (let j = -6; j <= 6; j++) { const s = at(prof, k + j); fan += Math.min(7, eff(s)); if (s.outlook) sky++; }
    fan /= 13;
    const depth = clamp01(fan / Math.max(2.2, 0.75 * roomScale));
    const long = clamp01(eff(s0) / roomScale);
    // looking at the sky is not a view of the home; a wall or a tall piece looming at the side of the frame spoils one
    const skyK = Math.max(0, sky / 13 - 0.25);
    let side = Infinity;
    for (const j of [-10, -9, -8, -7, 7, 8, 9, 10]) side = Math.min(side, at(prof, k + j).d);
    const sideK = clamp01((1.1 - side) / 0.8);
    // a view is of its own room: most of what the middle of the frame sees is in it (open air past a window or a railing does not count either way).
    // A living room is open to its neighbours and the front door's view looks into the home: neither is held to it
    if (info.room.roomType !== 'living' && !entrance) {
      let ownSum = 0, allSum = 0;
      for (let j = -6; j <= 6; j++) { const s = at(prof, k + j); const all = s.outlook ? s.own : Math.min(7, s.d); ownSum += Math.min(7, s.own, all); allSum += all; }
      if (allSum > 0 && ownSum / allSum < OWN_SHARE_MIN) continue;
    }
    // a bath is seen by its fittings: at least two of them (or its only one) within 35 degrees
    let fixK = 0;
    if (info.fixtures.length) {
      let n = 0;
      for (const f of info.fixtures) if (Math.abs(wrap(yawToward(p, f) - yaw)) <= 35 && dist(p, f) >= 0.7) n++;
      if (n < Math.min(2, info.fixtures.length)) continue;
      fixK = n / info.fixtures.length;
    }
    // a window or the balcony in frame
    let light: Light | null = null, lightK = 0, windowsInFrame = 0;
    for (const li of lightInfo) {
      if (!li.vis) continue;
      const a = Math.abs(wrap(li.yaw - yaw));
      if (li.l.kind === 'window' && a <= 30) windowsInFrame++;
      const lk = clamp01(1 - (a - 12) / 30);
      if (lk > lightK) { light = li.l; lightK = lk; }
    }
    // a balcony looks out over its railing
    let outlook = false;
    if (info.kind === 'balcony') {
      for (const r of info.rails) {
        const a = Math.abs(wrap(Math.atan2(r.out.x, r.out.z) / DEG - yaw));
        if (a <= 35 && s0.outlook) outlook = true;
      }
    }
    // where it stands: a doorway (looking into the room), a corner, along a wall
    let posK = place.cls === 'door' ? 1 : place.cls === 'corner' ? 0.85 : 0.35;
    if (place.cls === 'door' && place.entry) {
      const f = { x: Math.sin(yaw * DEG), z: Math.cos(yaw * DEG) };
      if (f.x * place.entry.inward.x + f.z * place.entry.inward.z < Math.cos(75 * DEG)) posK = 0.35;
    }
    const score = 2.0 * depth + 1.6 * long + 1.3 * lightK + posK + (subject ? 1.1 * subjK + 0.9 * distK : 0) + (outlook ? 0.6 : 0) - 3.0 * skyK - 0.9 * sideK + (place.roomy ? 0.4 : 0) + 1.0 * fixK;
    let pitch = 4;
    if (info.fixtures.length) pitch = 14; // a bath's fittings are low and near: look down at them
    else if (subject) {
      const sd = dist(p, subject.at);
      pitch = Math.max(3, Math.min(9, 0.4 * (Math.atan2(VIEW_EYE_M - subject.surfaceM, sd) / DEG)));
    } else if (outlook) pitch = 1.5;
    out.push({ room: info, p, yawDeg: yaw, pitchDeg: Math.round(pitch * 10) / 10, score, cls: place.cls, entry: place.entry, subject, light, lightK, windowsInFrame, outlook, entrance });
  }
  return out;
}

/** How many views a room is worth (SPEC 2.10): one for a WC, a utility or a store; two or three for the living room and the master bedroom; one or two otherwise. */
export function roomQuota(room: RoomTag, kind: RoomKind, area: number, isMaster: boolean): number {
  if (room.partial || kind === 'transit') return 0;
  if (kind === 'wet' || kind === 'other') return 1;
  if (kind === 'balcony') return area >= 6 ? 2 : 1;
  if (room.roomType === 'kitchen') return area >= 9 ? 2 : 1;
  if (room.roomType === 'living') return area >= 26 ? 3 : area >= 9 ? 2 : 1;
  if (room.roomType === 'bedroom') return isMaster ? (area >= 16 ? 3 : 2) : area >= 10 ? 2 : 1;
  return 1;
}

const differs = (a: Shot, b: Shot): boolean => {
  const dy = Math.abs(wrap(a.yawDeg - b.yawDeg));
  return dy >= 90 || (dy >= 40 && dist(a.p, b.p) >= 1.0);
};

/** The phrases a shot may truthfully carry, most telling first. */
function phrasesOf(s: Shot): { phrase: string; kind: ViewKind }[] {
  const out: { phrase: string; kind: ViewKind }[] = [];
  if (s.entrance) out.push({ phrase: 'from the entrance', kind: 'entrance' });
  if (s.outlook) out.push({ phrase: 'looking out', kind: 'outlook' });
  if (s.light && s.lightK >= 0.6) out.push({ phrase: s.light.kind === 'window' && s.windowsInFrame >= 2 ? 'towards the windows' : `towards ${s.light.word}`, kind: 'window' });
  if (s.cls === 'door' && s.entry) {
    const f = { x: Math.sin(s.yawDeg * DEG), z: Math.cos(s.yawDeg * DEG) };
    if (f.x * s.entry.inward.x + f.z * s.entry.inward.z >= Math.cos(75 * DEG)) {
      if (s.entry.leadsTo?.roomType === 'balcony' && s.room.kind !== 'balcony') out.push({ phrase: `from the ${s.entry.leadsTo.label.toLowerCase()}`, kind: 'door' });
      else if (s.entry.type === 'door') out.push({ phrase: 'from the door', kind: 'door' });
      else if (s.entry.leadsTo) out.push({ phrase: `from the ${s.entry.leadsTo.label.toLowerCase()}`, kind: 'door' });
      else out.push({ phrase: 'from the doorway', kind: 'door' });
    }
  }
  if (s.subject) out.push({ phrase: `towards ${s.subject.word}`, kind: 'subject' });
  if (s.cls === 'corner') out.push({ phrase: 'from the corner', kind: 'corner' });
  out.push({ phrase: 'across the room', kind: 'across' });
  return out;
}

interface Picked { shot: Shot; phrase: string; kind: ViewKind }

function pickForRoom(info: RoomInfo, grid: Grid, quota: number, entranceShot: Shot | null): Picked[] {
  const places = placesIn(info, grid);
  const variants: (Subject | undefined)[] = [undefined];
  // a room with two main pieces (a living and dining room) keeps a view of each
  const req = info.subjects.filter((s) => s.required);
  const kinds = req.filter((r, i) => req.findIndex((q) => q.rank === r.rank) === i);
  if (kinds.length >= 2) variants.splice(0, 1, ...kinds);
  const pools = variants.map((v) => {
    const all: Shot[] = [];
    for (const pl of places) all.push(...shotsFrom(pl, info, grid, false, v));
    return all.sort((a, b) => b.score - a.score || a.p.x - b.p.x || a.p.z - b.p.z || a.yawDeg - b.yawDeg);
  });
  const picked: Picked[] = [];
  const used = new Set<string>();
  const taken: Shot[] = entranceShot ? [entranceShot] : [];
  if (entranceShot) used.add('from the entrance');
  const best = Math.max(...pools.map((p) => p[0]?.score ?? -Infinity), entranceShot?.score ?? -Infinity);
  const want = quota;
  let round = 0;
  while (picked.length < want && round < 4 * want) {
    const pool = pools[round % pools.length];
    round++;
    const first = picked.length === 0 && !entranceShot;
    for (const s of pool) {
      if (s.score < MIN_SCORE) break;
      if (!first && s.score < SECOND_SHARE * best) break;
      if (!taken.every((t) => differs(s, t))) continue;
      if (faceAt(grid, s.p, s.yawDeg) < FACE_MIN_M) continue;
      const ph = phrasesOf(s).find((x) => !used.has(x.phrase));
      if (!ph) continue;
      picked.push({ shot: s, ...ph });
      used.add(ph.phrase);
      taken.push(s);
      break;
    }
    if (round >= pools.length && picked.length === 0 && !entranceShot) break; // nothing good enough in any pool
  }
  return picked;
}

/** The view just inside the flat's front door, looking in. Null when the layout has no front door or nowhere good to stand by it. */
function entranceView(layout: Layout, infos: Map<string, RoomInfo>, grid: Grid): Shot | null {
  const e = mainEntrance(layout);
  if (!e) return null;
  const o = layout.openings.find((x) => x.id === e.openingId);
  const info = o ? infos.get(o.roomId) : undefined;
  if (!o || !info) return null;
  const entry = info.entries.find((x) => x.openingId === o.id);
  if (!entry) return null;
  const places = placesIn(info, grid, entry);
  let best: Shot | null = null;
  for (const pl of places) {
    for (const s of shotsFrom(pl, info, grid, true)) {
      // looking in, not along the wall the door is in
      const f = { x: Math.sin(s.yawDeg * DEG), z: Math.cos(s.yawDeg * DEG) };
      if (f.x * entry.inward.x + f.z * entry.inward.z < Math.cos(55 * DEG)) continue;
      // and it must open up: a narrow foyer that shows a slot of the home between two walls is not a view (the room it leads to has its own)
      const k = Math.round(s.yawDeg / STEP_DEG);
      let open = 0;
      for (let j = -6; j <= 6; j++) if (at(pl.prof, k + j).d >= ENTRANCE_MIN_FAN_M) open++;
      if (open / 13 < ENTRANCE_OPEN_SHARE) continue;
      // the entrance view is about the depth of the home: a long line in counts twice
      const sc = s.score + 1.2 * clamp01(at(pl.prof, Math.round(s.yawDeg / STEP_DEG)).d / 8);
      if (!best || sc > best.score || (sc === best.score && (s.p.x < best.p.x || (s.p.x === best.p.x && s.p.z < best.p.z)))) best = { ...s, score: sc };
    }
  }
  return best && best.score >= MIN_SCORE ? best : null;
}

// ---------------------------------------------------------------- the order: room by room, the way the tour goes

/**
 * Rooms in the tour's order (SPEC 2.6, `pickNext` of tour-plan.ts with its surcharges: toilets last, utility rooms and balconies after the
 * living areas), starting at `startId`. The walking distance is measured through the doorways (room to doorway to room), not on the grid,
 * so ordering a flat costs nothing.
 */
export function tourOrder(infos: { id: string; kind: RoomKind; at: Vec2 }[], links: { a: string; b: string; at: Vec2 }[], startId: string): string[] {
  const at = new Map(infos.map((i) => [i.id, i.at]));
  const graphFrom = (src: string): Map<string, number> => {
    const d = new Map<string, number>([[src, 0]]);
    const done = new Set<string>();
    for (;;) {
      let u: string | null = null, du = Infinity;
      for (const [k, v] of d) if (!done.has(k) && v < du) { u = k; du = v; }
      if (u === null) break;
      done.add(u);
      for (const l of links) {
        const v = l.a === u ? l.b : l.b === u ? l.a : null;
        if (!v || done.has(v)) continue;
        const pu = at.get(u), pv = at.get(v);
        if (!pu || !pv) continue;
        const w = dist(pu, l.at) + dist(l.at, pv);
        if (du + w < (d.get(v) ?? Infinity)) d.set(v, du + w);
      }
    }
    return d;
  };
  const order = [startId];
  let remaining = infos.filter((i) => i.id !== startId);
  let from = startId;
  while (remaining.length) {
    const lengths = graphFrom(from);
    const pick = pickNext(remaining, (p) => {
      const hit = infos.find((i) => i.at === p);
      return hit ? lengths.get(hit.id) ?? Infinity : Infinity;
    }, (s) => s.at);
    if (!pick.next) { order.push(...remaining.map((r) => r.id)); break; }
    order.push(pick.next.id);
    from = pick.next.id;
    remaining = remaining.filter((r) => r !== pick.next);
  }
  return order;
}

// ---------------------------------------------------------------- the whole flat

/**
 * Every view of a flat, ordered room by room the way the tour goes (the room with the front door first), with stable ids. Deterministic: the
 * same layout, furniture and grid give the same list. Rooms only partly on the drawing and passages get none.
 */
export function composeViewpoints(input: ComposeInput): Viewpoint[] {
  const { layout, furniture, grid } = input;
  const doors = resolveDoors(layout);
  const infos = analyse(layout, furniture, grid, doors);
  const bedrooms = [...infos.values()].filter((i) => i.room.roomType === 'bedroom');
  const masterId = (bedrooms.find((i) => /master/i.test(i.room.label)) ?? bedrooms.reduce<RoomInfo | null>((b, i) => (!b || i.area > b.area ? i : b), null))?.room.id ?? null;
  const ent = entranceView(layout, infos, grid);
  const perRoom = new Map<string, Picked[]>();
  for (const info of infos.values()) {
    const quota = roomQuota(info.room, info.kind, info.area, info.room.id === masterId);
    const entHere = ent && ent.room === info ? ent : null;
    const picks = quota > 0 ? pickForRoom(info, grid, quota, entHere) : [];
    const all: Picked[] = entHere ? [{ shot: entHere, phrase: 'from the entrance', kind: 'entrance' }, ...picks] : picks;
    if (all.length) perRoom.set(info.room.id, all);
  }
  // at most MAX_VIEWS: the weakest second views go first, then the weakest views of wet rooms
  let total = [...perRoom.values()].reduce((n, l) => n + l.length, 0);
  while (total > MAX_VIEWS) {
    let worst: { room: string; i: number; key: number } | null = null;
    for (const [rid, list] of perRoom) {
      list.forEach((pk, i) => {
        if (pk.kind === 'entrance') return;
        const key = (i === 0 ? 100 : 0) + (i === 0 && pk.shot.room.kind !== 'wet' ? 100 : 0) + pk.shot.score;
        if (!worst || key < worst.key) worst = { room: rid, i, key };
      });
    }
    if (!worst) break;
    const w = worst as { room: string; i: number };
    const list = perRoom.get(w.room) as Picked[];
    list.splice(w.i, 1);
    if (!list.length) perRoom.delete(w.room);
    total--;
  }
  // within a room: the entrance, then the doorway views, then by score
  const rank: Record<ViewKind, number> = { entrance: 0, door: 1, outlook: 2, window: 3, subject: 3, corner: 3, across: 3, authored: 9 };
  for (const list of perRoom.values()) list.sort((a, b) => rank[a.kind] - rank[b.kind] || b.shot.score - a.shot.score);
  // rooms in the tour's order from the front door's room
  const ids = [...perRoom.keys()];
  if (!ids.length) return [];
  const startId = ent ? ent.room.room.id : ids.reduce((b, id) => ((infos.get(id) as RoomInfo).area > (infos.get(b) as RoomInfo).area && (infos.get(id) as RoomInfo).kind === 'main' ? id : b), ids[0]);
  const nodes = [...infos.values()].map((i) => ({ id: i.room.id, kind: i.kind, at: perRoom.get(i.room.id)?.[0].shot.p ?? centreOf(i.room.polygon) }));
  const links: { a: string; b: string; at: Vec2 }[] = [];
  for (const i of infos.values()) for (const e of i.entries) if (e.leadsTo && i.room.id < e.leadsTo.id) links.push({ a: i.room.id, b: e.leadsTo.id, at: e.at });
  const order = tourOrder(nodes, links, startId).filter((id) => perRoom.has(id));
  const out: Omit<Viewpoint, 'tabId' | 'tabLabel'>[] = [];
  for (const rid of order) {
    const list = perRoom.get(rid) as Picked[];
    list.forEach((pk, i) => {
      const s = pk.shot, room = s.room.room;
      out.push({
        id: `${room.id}-${i + 1}`, roomId: room.id, roomLabel: room.label, phrase: pk.phrase, name: `${room.label} · ${pk.phrase}`,
        x: round3(s.p.x), z: round3(s.p.z), eyeM: VIEW_EYE_M, yawDeg: round3(norm360(s.yawDeg)), pitchDeg: s.pitchDeg, kind: pk.kind,
        ...(s.subject ? { subjectId: s.subject.id } : {}), score: Math.round(s.score * 100) / 100, source: 'generated',
      });
    });
  }
  return groupIntoTabs(layout, out).views;
}

// ---------------------------------------------------------------- room tabs

/** Which rooms join which, and where: every doorway, opening and open side (scene frame). Pure. */
export function roomLinks(layout: Layout): { a: string; b: string; at: Vec2; type: 'door' | 'opening' | 'open' }[] {
  const frames = computeEdgeFrames(layout);
  const frameOf = new Map(frames.map((f) => [`${f.roomId}:${f.edge}`, f]));
  const otherAt = (p: Vec2, not: string): RoomTag | null => layout.rooms.find((r) => r.id !== not && pointInPolygon(p, r.polygon)) ?? null;
  const out: { a: string; b: string; at: Vec2; type: 'door' | 'opening' | 'open' }[] = [];
  const add = (a: string, b: string | undefined, at: Vec2, type: 'door' | 'opening' | 'open'): void => { if (b && a !== b && !out.some((l) => l.type === type && Math.hypot(l.at.x - at.x, l.at.z - at.z) < 0.3 && ((l.a === a && l.b === b) || (l.a === b && l.b === a)))) out.push({ a, b, at, type }); };
  for (const f of frames) {
    if (f.kind !== 'none') continue;
    const mid = { x: (f.a.x + f.b.x) / 2, z: (f.a.z + f.b.z) / 2 };
    add(f.roomId, otherAt({ x: mid.x + f.out.x * (f.thickness + 0.3), z: mid.z + f.out.z * (f.thickness + 0.3) }, f.roomId)?.id, mid, 'open');
  }
  for (const o of layout.openings) {
    if (o.type === 'window') continue;
    const f = frameOf.get(`${o.roomId}:${o.edge}`);
    if (!f) continue;
    const at = { x: f.a.x + f.dir.x * o.centreM, z: f.a.z + f.dir.z * o.centreM };
    add(o.roomId, otherAt({ x: at.x + f.out.x * (f.thickness + 0.3), z: at.z + f.out.z * (f.thickness + 0.3) }, o.roomId)?.id, at, o.type === 'door' ? 'door' : 'opening');
  }
  return out;
}

/**
 * The room tabs, Navigo's way: one tab per main room (a living room, a bedroom, a kitchen; living rooms open to each other are one tab, named
 * after the largest), and every other room with a view (a bath, a balcony, a utility room, a foyer) under the main room nearest to it through
 * the doorways. Tabs are in the order their first view comes; the views are returned regrouped tab by tab, each in its own order.
 */
export function groupIntoTabs(layout: Layout, list: readonly Omit<Viewpoint, 'tabId' | 'tabLabel'>[]): { tabs: ViewTab[]; views: Viewpoint[] } {
  const rooms = new Map(layout.rooms.map((r) => [r.id, r]));
  const links = roomLinks(layout);
  const isMain = (r: RoomTag): boolean => !r.partial && roomKind(r) === 'main';
  // living rooms open to each other are one tab
  const parent = new Map<string, string>();
  const find = (id: string): string => { let x = id; while (parent.get(x) && parent.get(x) !== x) x = parent.get(x) as string; return x; };
  for (const r of layout.rooms) parent.set(r.id, r.id);
  for (const l of links) {
    const a = rooms.get(l.a), b = rooms.get(l.b);
    if (a && b && a.roomType === 'living' && b.roomType === 'living' && l.type !== 'door') {
      const ra = find(a.id), rb = find(b.id);
      if (ra !== rb) parent.set(rb, ra);
    }
  }
  const centre = (id: string): Vec2 => centreOf((rooms.get(id) as RoomTag).polygon);
  // the nearest main room to a room, through the doorways
  const nearestMain = (start: string): string | null => {
    const d = new Map<string, number>([[start, 0]]);
    const done = new Set<string>();
    for (;;) {
      let u: string | null = null, du = Infinity;
      for (const [k, v] of d) if (!done.has(k) && v < du) { u = k; du = v; }
      if (u === null) return null;
      const ru = rooms.get(u);
      if (u !== start && ru && isMain(ru)) return u;
      done.add(u);
      for (const l of links) {
        const v = l.a === u ? l.b : l.b === u ? l.a : null;
        if (!v || done.has(v) || !rooms.get(v)) continue;
        const w = Math.hypot(centre(u).x - l.at.x, centre(u).z - l.at.z) + Math.hypot(l.at.x - centre(v).x, l.at.z - centre(v).z);
        if (du + w < (d.get(v) ?? Infinity)) d.set(v, du + w);
      }
    }
  };
  const tabOfRoom = (roomId: string): string => {
    const r = rooms.get(roomId);
    if (!r) return roomId;
    if (isMain(r)) return find(roomId);
    const m = nearestMain(roomId);
    return m ? find(m) : roomId;
  };
  const tabs: ViewTab[] = [];
  const byId = new Map<string, ViewTab>();
  for (const v of list) {
    const tid = tabOfRoom(v.roomId);
    let t = byId.get(tid);
    if (!t) {
      const members = layout.rooms.filter((r) => find(r.id) === tid).sort((a, b) => Math.abs(polygonArea(b.polygon)) - Math.abs(polygonArea(a.polygon)));
      t = { id: tid, label: (members[0] ?? rooms.get(tid))?.label ?? v.roomLabel, roomIds: [], viewIds: [] };
      byId.set(tid, t);
      tabs.push(t);
    }
    if (!t.roomIds.includes(v.roomId)) t.roomIds.push(v.roomId);
    t.viewIds.push(v.id);
  }
  const at = new Map(list.map((v) => [v.id, v]));
  const views: Viewpoint[] = [];
  for (const t of tabs) for (const id of t.viewIds) views.push({ ...(at.get(id) as Omit<Viewpoint, 'tabId' | 'tabLabel'>), tabId: t.id, tabLabel: t.label });
  return { tabs, views };
}

/** The tabs of a list of views that already carry them, in order. */
export function tabsOf(views: readonly Viewpoint[]): ViewTab[] {
  const out: ViewTab[] = [];
  for (const v of views) {
    let t = out.find((x) => x.id === v.tabId);
    if (!t) { t = { id: v.tabId, label: v.tabLabel, roomIds: [], viewIds: [] }; out.push(t); }
    if (!t.roomIds.includes(v.roomId)) t.roomIds.push(v.roomId);
    t.viewIds.push(v.id);
  }
  return out;
}

/** What a view is called in its tab's list: the phrase alone in the tab's own rooms ("From the entrance"), the full name for a room listed under another ("Master toilet · towards the basin"). */
export function listLabel(v: Viewpoint, tab: ViewTab): string {
  const own = v.tabId === v.roomId || v.roomLabel === tab.label;
  return own ? v.phrase.charAt(0).toUpperCase() + v.phrase.slice(1) : v.name;
}

function centreOf(p: Vec2[]): Vec2 {
  return { x: p.reduce((s, q) => s + q.x, 0) / p.length, z: p.reduce((s, q) => s + q.z, 0) / p.length };
}

// ---------------------------------------------------------------- checks (the tests and the debug hook use these)

export interface ViewCheck {
  inside: boolean;
  /** clear floor around the eye, metres (to the nearest wall or piece, up to 1 m) */
  clearM: number;
  /** the nearest wall or tall piece within 10 degrees of the heading, metres */
  faceM: number;
  /** the main piece's middle, degrees off the heading, and whether it is seen; null when the view keeps no piece */
  subjectOffDeg: number | null;
  subjectSeen: boolean | null;
}

export function checkViewpoint(vp: Viewpoint, input: ComposeInput): ViewCheck {
  const room = input.layout.rooms.find((r) => r.id === vp.roomId);
  const p = { x: vp.x, z: vp.z };
  let clearM = 0;
  for (let r = 0.05; r <= 1.0 + 1e-9; r += 0.05) { if (circleFree(input.grid, p.x, p.z, r)) clearM = r; else break; }
  const faceM = faceAt(input.grid, p, vp.yawDeg);
  let subjectOffDeg: number | null = null, subjectSeen: boolean | null = null;
  const it = vp.subjectId ? input.furniture.find((f) => f.id === vp.subjectId) : undefined;
  if (it) {
    const c = { x: it.box.cx, z: it.box.cz };
    subjectOffDeg = Math.abs(wrap(yawToward(p, c) - vp.yawDeg));
    subjectSeen = seen(input.grid, p, c, Math.hypot(it.box.w, it.box.d) / 2 + 0.1);
  }
  return { inside: !!room && pointInPolygon(p, room.polygon), clearM, faceM, subjectOffDeg, subjectSeen };
}
