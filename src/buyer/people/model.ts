// Added people: the rules, as pure functions (no three, no DOM). How many a device can hold, how wide a body is, where a person
// may stand, how a second person sits or lies where the first already is, and whether two people can pass in a narrow place.
// Everything that touches the page lives in manager.ts and ui.ts.
import { seatHeightVerdict } from '../../core/checks';
import { boxAxes } from '../../core/geometry';
import { circleFree, clearance, nearestFree } from '../../core/grid-query';
import { cellValue } from '../../core/grid-codec';
import { liePose, seatPose } from '../../core/poses';
import { CHARACTER_RADIUS_M, GRID_TALL_CM } from '../../types';
import type { Box, CheckCard, FurnitureItem, Grid, LiePose, SeatPose, Vec2 } from '../../types';
import { PERSON_LABELS } from '../person-store';
import { PEOPLE_MAX } from './rec';
import type { PersonBodyId, PersonRec } from './rec';

export type DeviceTier = 'low' | 'medium' | 'high';

// ---------------------------------------------------------------- how many

/** People a device holds besides the walker. Each is a skinned body, which a phone pays for, so the cap follows the tier. */
export const TIER_CAP: Record<DeviceTier, number> = { low: 2, medium: 3, high: PEOPLE_MAX };
export const capForTier = (tier: DeviceTier): number => TIER_CAP[tier];

/** The bodies that are drawn: the first `cap` of the list. The rest stay in the layout (and the link) and are named in the rooms sheet. */
export function shownCount(total: number, tier: DeviceTier): number {
  return Math.min(total, capForTier(tier));
}

// ---------------------------------------------------------------- how wide

/** Shoulder breadth over height, by person (adult ranges are 0.23 to 0.26). The proportions are those of the bodies themselves. */
export const SHOULDER_RATIO: Record<PersonBodyId, number> = { man: 0.245, woman: 0.225, elder: 0.235, child: 0.215 };

export function shoulderWidthM(body: PersonBodyId, heightCm: number): number {
  return SHOULDER_RATIO[body] * (heightCm / 100);
}

const cm = (m: number): number => Math.round(m * 100) + 0;

/** The floor a standing person takes: shoulder width across, chest depth deep, turned as they stand. This is what blocks the walker. */
export function standBox(r: Pick<PersonRec, 'body' | 'heightCm' | 'x' | 'z' | 'yawDeg'>): Box {
  const w = shoulderWidthM(r.body, r.heightCm);
  const d = Math.max(0.18, 0.5 * w + 0.07);
  return { cx: r.x, cz: r.z, w, d, yawDeg: r.yawDeg };
}

/** Radius of the circle that must be free of walls and furniture for someone to stand there. */
export const standRadiusM = (r: Pick<PersonRec, 'body' | 'heightCm'>): number => shoulderWidthM(r.body, r.heightCm) / 2;

/** What each standing person adds to the walk grid (`store.setTemporary`). Sitting and lying people are on a piece that already blocks. */
export function obstaclesOf(list: readonly PersonRec[]): { box: Box; heightM: number }[] {
  return list.filter((r) => r.pose === 'stand').map((r) => ({ box: standBox(r), heightM: r.heightCm / 100 }));
}

export function labelOf(r: Pick<PersonRec, 'body'>): string {
  return PERSON_LABELS[r.body];
}

// ---------------------------------------------------------------- where they may stand

export interface PlaceContext {
  /** layout, furniture, the drawing's chairs and the door leaves: everything but added people */
  grid: Grid;
  others: readonly PersonRec[];
  walker?: Vec2;
  /** "Blocks the Bedroom door from opening." for a box in a door's or wardrobe's swing, else null (buyer/wardrobe-hooks.ts) */
  swingNote?: (box: Box) => string | null;
}
export type PlaceResult = { ok: true; at: Vec2 } | { ok: false; reason: 'blocked' | 'person' | 'walker' | 'swing'; message: string };

/** How far a tapped spot may be moved to the nearest free floor before it counts as "not here". */
export const NUDGE_M = 0.3;

/** Standing at a tapped floor spot: free floor for the body, clear of other people and of the walker, and outside every swing. */
export function placeStanding(c: PlaceContext, spec: Pick<PersonRec, 'body' | 'heightCm'>, tap: Vec2, yawDeg = 0): PlaceResult {
  const r = standRadiusM(spec);
  const at = nearestFree(c.grid, tap.x, tap.z, r, NUDGE_M);
  if (!at) return { ok: false, reason: 'blocked', message: 'There is no free floor there for a person.' };
  for (const o of c.others) {
    if (o.pose !== 'stand') continue;
    if (Math.hypot(o.x - at.x, o.z - at.z) < r + standRadiusM(o) + 0.02) return { ok: false, reason: 'person', message: 'Someone is already standing there.' };
  }
  if (c.walker && Math.hypot(c.walker.x - at.x, c.walker.z - at.z) < r + CHARACTER_RADIUS_M + 0.02) return { ok: false, reason: 'walker', message: 'That is too close to you. Step away or tap another spot.' };
  const note = c.swingNote?.(standBox({ ...spec, x: at.x, z: at.z, yawDeg }));
  if (note) return { ok: false, reason: 'swing', message: `A person there would be in the way. ${note}` };
  return { ok: true, at };
}

/** The nearest spot, within `maxM`, where a person may stand when what was under them has gone (a bed dropped on them): null when there is none. */
export function nudgeAside(grid: Grid, rec: Pick<PersonRec, 'body' | 'heightCm' | 'x' | 'z'>, maxM = 1.2): Vec2 | null {
  return nearestFree(grid, rec.x, rec.z, standRadiusM(rec), maxM);
}

export const standingFree = (grid: Grid, rec: Pick<PersonRec, 'body' | 'heightCm' | 'x' | 'z'>): boolean => circleFree(grid, rec.x, rec.z, standRadiusM(rec));

// ---------------------------------------------------------------- sitting and lying on a piece

export type HostAction = 'sit' | 'lie';

/** What the piece is for: a bed is lain on, a sofa or a chair is sat on, nothing else takes a person. */
export function hostActionOf(item: Pick<FurnitureItem, 'kind'>): HostAction | null {
  return item.kind === 'bed' ? 'lie' : item.kind === 'sofa' ? 'sit' : null;
}

const SIT_APART_M = 0.5;
const LIE_APART_M = 0.45;
/** What to call a piece in a sentence: its own label, else its kind ("bed", "sofa"; a chair from the drawing carries its own label). */
export function hostName(item: Pick<FurnitureItem, 'kind' | 'label'>): string {
  return (item.label || item.kind).trim();
}

/** Signed distance of a point from the piece's centre along its width axis. */
export const lateralOf = (item: FurnitureItem, p: Vec2): number => {
  const { b } = boxAxes(item.box);
  return (p.x - item.box.cx) * b.x + (p.z - item.box.cz) * b.z;
};
const sitMargin = (item: FurnitureItem): number => item.box.w / 2 - 0.35;

/** Where along the piece's width a person sits or lies when tapped at `approach`: what core/poses.ts does, as one number. */
export function spotLateral(item: FurnitureItem, action: HostAction, approach: Vec2, chair = false): number {
  if (action === 'lie') {
    const inner = item.inner ?? { w: item.box.w, d: item.box.d };
    return inner.w < 1.2 ? 0 : Math.sign(lateralOf(item, approach)) * (inner.w / 4);
  }
  if (chair) return 0;
  const m = Math.max(0, sitMargin(item));
  return Math.min(m, Math.max(-m, lateralOf(item, approach)));
}

/**
 * The spot for one more person on a piece: the tapped one when it is free, else the nearest free one across its width (the other half
 * of a double bed, the next place on a sofa). `taken` are the lateral spots already used (other people, the walker if posed there).
 * Null when the piece is full.
 */
export function freeApproach(item: FurnitureItem, action: HostAction, approach: Vec2, taken: readonly number[], chair = false): Vec2 | null {
  const { b } = boxAxes(item.box);
  const apart = action === 'lie' ? LIE_APART_M : SIT_APART_M;
  const at = (lat: number): Vec2 => ({ x: item.box.cx + b.x * lat, z: item.box.cz + b.z * lat });
  const free = (lat: number): boolean => taken.every((t) => Math.abs(t - lat) >= apart - 1e-9);
  const want = spotLateral(item, action, approach, chair);
  if (free(want)) return action === 'lie' && Math.abs(want) < 1e-9 ? { ...approach } : at(action === 'lie' ? Math.sign(want || 1) * 0.5 : want);
  const cands: number[] = [];
  if (action === 'lie') {
    const inner = item.inner ?? { w: item.box.w, d: item.box.d };
    if (inner.w >= 1.2) cands.push(inner.w / 4, -inner.w / 4);
  } else if (!chair) {
    const m = Math.max(0, sitMargin(item));
    for (let l = -m; l <= m + 1e-9; l += 0.1) cands.push(l);
  }
  cands.sort((x, y) => Math.abs(x - want) - Math.abs(y - want));
  for (const c of cands) if (free(c)) return at(action === 'lie' ? Math.sign(c) * 0.5 : c);
  return null;
}

export type SeatPoseOf = (item: FurnitureItem, heightM: number) => SeatPose | null;

/** The pose of a person of `heightCm` on `item` at `approach`: the walker's own (core/poses), so a 150 cm grandmother sits and lies at her size. */
export function hostPose(item: FurnitureItem, action: HostAction, heightCm: number, approach: Vec2, chairPose?: SeatPoseOf): { lie?: LiePose; sit?: SeatPose } {
  const H = heightCm / 100;
  if (action === 'lie') return { lie: liePose(item, H, approach) };
  return { sit: chairPose?.(item, H) ?? seatPose(item, H, approach) };
}

/** Moves a tapped spot with its piece when the piece is moved or turned: the same place on it, in the new frame. */
export function carryApproach(p: Vec2, from: Box, to: Box): Vec2 {
  const f = boxAxes(from), t = boxAxes(to);
  const dx = p.x - from.cx, dz = p.z - from.cz;
  const a = dx * f.a.x + dz * f.a.z;
  const b = dx * f.b.x + dz * f.b.z;
  return { x: to.cx + t.a.x * a + t.b.x * b, z: to.cz + t.a.z * a + t.b.z * b };
}

/** A signature of everything about a piece that decides a pose on it. A change means the people on it are posed again. */
export function hostSignature(item: Pick<FurnitureItem, 'box' | 'surfaceHeightM' | 'inner'>): string {
  const b = item.box;
  return [b.cx, b.cz, b.w, b.d, b.yawDeg, item.surfaceHeightM, item.inner?.w ?? 0, item.inner?.d ?? 0].map((n) => Math.round(n * 1000)).join(',');
}

/** Distance from a point to a box footprint, 0 inside. */
function boxDistance(p: Vec2, box: Box): number {
  const { a, b } = boxAxes(box);
  const dx = p.x - box.cx, dz = p.z - box.cz;
  const along = Math.abs(dx * a.x + dz * a.z) - box.d / 2;
  const across = Math.abs(dx * b.x + dz * b.z) - box.w / 2;
  return Math.hypot(Math.max(0, along), Math.max(0, across));
}

/** The piece a tap at `p` lands on (within `tolM` of its footprint) that takes a sitting or lying person. Beds and sofas of the home, and the drawing's chairs. */
export function hostAt(p: Vec2, items: readonly FurnitureItem[], tolM = 0.08): FurnitureItem | null {
  let best: { item: FurnitureItem; d: number; area: number } | null = null;
  for (const item of items) {
    if (!hostActionOf(item)) continue;
    const d = boxDistance(p, item.box);
    if (d > tolM) continue;
    const area = item.box.w * item.box.d;
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && area < best.area)) best = { item, d, area };
  }
  return best?.item ?? null;
}

/** The nearest piece for `action` within `maxM` of a person, with no tall wall between them (a sofa in the next room is not a place to sit). */
export function nearestHost(p: Vec2, action: HostAction, items: readonly FurnitureItem[], grid: Grid, maxM = 2): FurnitureItem | null {
  let best: { item: FurnitureItem; d: number } | null = null;
  for (const item of items) {
    if (hostActionOf(item) !== action) continue;
    const d = boxDistance(p, item.box);
    if (d > maxM || (best && d >= best.d)) continue;
    if (wallBetween(grid, p, item.box)) continue;
    best = { item, d };
  }
  return best?.item ?? null;
}

function wallBetween(grid: Grid, p: Vec2, box: Box): boolean {
  const dx = box.cx - p.x, dz = box.cz - p.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  for (let t = 0; t < len; t += grid.cellM / 2) {
    const q = { x: p.x + (dx * t) / len, z: p.z + (dz * t) / len };
    if (boxDistance(q, box) <= 0.06) return false;
    if (cellValue(grid, q.x, q.z) >= GRID_TALL_CM) return true;
  }
  return false;
}

// ---------------------------------------------------------------- what the card says about a pose

/** A line about how this person fits the piece they are on, in the third person ("Lying on the Single bed: 25 cm to spare."). */
export function fitLine(item: FurnitureItem, action: HostAction, heightCm: number, chairSeatM?: number): string {
  const H = heightCm / 100;
  if (action === 'lie') {
    const len = (item.inner ?? item.box).d;
    const spare = cm(len - H);
    const where = `${hostName(item)[0].toUpperCase()}${hostName(item).slice(1)} · ${cm(len)} cm long`;
    if (spare >= 15) return `${where}. ${spare} cm to spare.`;
    if (spare >= 0) return `${where}. Tight, ${spare} cm to spare.`;
    return `${where}. Feet hang ${-spare} cm over the end.`;
  }
  const seat = chairSeatM ?? item.surfaceHeightM;
  const v = seatHeightVerdict(seat, H);
  return `${hostName(item)[0].toUpperCase()}${hostName(item).slice(1)}. ${v.line.replace('suits you', 'suits them').replace('Your feet', 'Their feet').replace('Your knees', 'Their knees')}`;
}

// ---------------------------------------------------------------- can two people pass

/** A passage wider than this is open floor, not a place two people must squeeze past. */
export const PASS_OPEN_M = 1.6;
/** Slack beyond the two shoulder widths for two people to pass without touching. */
export const PASS_COMFORT_M = 0.1;

export type PassVerdictId = 'can' | 'tight' | 'cannot';
export interface PassVerdict { verdict: PassVerdictId; needM: number; spareM: number }

/** Two people pass in a passage `passageM` wide when it is at least both shoulder widths (tight, turning a little) and comfortably with 10 cm more. */
export function passVerdict(passageM: number, aShoulderM: number, bShoulderM: number): PassVerdict {
  const needM = aShoulderM + bShoulderM;
  const spareM = passageM - needM;
  return { verdict: spareM >= PASS_COMFORT_M - 1e-9 ? 'can' : spareM >= -1e-9 ? 'tight' : 'cannot', needM, spareM };
}

/**
 * The width of the passage through `at`, across the direction `toward` (unit, from the walker to the person): the free floor to each side,
 * measured on a grid that has no added people in it. Null when either side is open floor for more than `PASS_OPEN_M` in total.
 */
export function passageWidth(gridNoPeople: Grid, at: Vec2, toward: Vec2): number | null {
  const perp = { x: -toward.z, z: toward.x };
  const cap = PASS_OPEN_M;
  const l = clearance(gridNoPeople, at, perp, cap);
  const r = clearance(gridNoPeople, at, { x: -perp.x, z: -perp.z }, cap);
  const w = l + r;
  return w >= PASS_OPEN_M ? null : w;
}

export const PASS_FOOTER = 'Shoulder widths are typical for each person at their height. The passage is measured on the floor plan.';

export function passCard(walkerLabel: string, otherLabel: string, passageM: number, walkerShoulderM: number, otherShoulderM: number, walkerMinFreeM = 2 * CHARACTER_RADIUS_M): CheckCard {
  const v = passVerdict(passageM, walkerShoulderM, otherShoulderM);
  const lines = [`Passage ${cm(passageM)} cm wide.`, `${walkerLabel} ${cm(walkerShoulderM)} cm + ${otherLabel} ${cm(otherShoulderM)} cm = ${cm(v.needM)} cm of shoulders.`];
  if (v.verdict === 'can') lines.push(`${cm(v.spareM)} cm to spare.`);
  else if (v.verdict === 'tight') lines.push(`${cm(v.spareM)} cm to spare. Turn a little to pass.`);
  else lines.push(`${-cm(v.spareM)} cm short. One has to wait or step into a room.`);
  const gap = passageM - otherShoulderM;
  if (v.verdict !== 'cannot' && gap < walkerMinFreeM - 1e-9) lines.push(`The walking controls need ${cm(walkerMinFreeM)} cm of clear floor, so the walker stops here. In person you would turn sideways.`);
  const head = v.verdict === 'can' ? 'Two people can pass here.' : v.verdict === 'tight' ? 'Tight. Two people can just pass.' : 'Two people cannot pass here.';
  return { title: `Passing ${otherLabel}`, tone: v.verdict === 'can' ? 'good' : v.verdict === 'tight' ? 'warn' : 'bad', headline: head, lines, footer: PASS_FOOTER };
}
