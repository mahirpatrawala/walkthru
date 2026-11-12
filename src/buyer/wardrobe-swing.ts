// Open-wardrobe geometry and copy (SPEC 16.6 addendum). Pure: no DOM, no three. Everything here is arithmetic on the numbers a
// drawing gives (designs.json `openable`) or on a catalogue entry; nothing is defaulted. What a drawing does not give (shutter
// thickness, handle projection, the hinge opening angle) is never put into a number: the clearance of a shutter that sticks out
// at its furthest (a quarter turn, then the shutter is square to the front) does not depend on the angle, and thickness and
// handles are reported as "not included".
//
// Item frame (SPEC 3.1): a = front (the way the shutters swing out), b = right as seen from the front. A shutter is hinged at an
// outer edge of its bay at `hingeU` (along b, from the box centre), on the front plane of the box, and its free edge sits
// `dir * widthM` away along b when it is closed.
import { catalogItem, specFor } from '../core/catalog';
import { boxAxes, pointInBox } from '../core/geometry';
import { cellValue } from '../core/grid-codec';
import { clearance } from '../core/grid-query';
import { GRID_CELL_M, GRID_FREE } from '../types';
import type { Box, CheckCard, FurnitureItem, Grid, Tone, Vec2 } from '../types';
import type { OpenableDesign } from '../look/designs';
import { sourceSheet } from '../look/design-sources';

const DEG = Math.PI / 180;
const M_PER_IN = 0.0254;
/** The walking-space ray looks this far (the same cap as checkPlacement's clearances, SPEC 4.5). */
export const RAY_CAP_M = 3.0;
/**
 * Width of the strip an open shutter stamps into the walk grid. This is the grid's resolution (a cell is 5 cm, a cell is "in" a
 * shape when its centre is), NOT a shutter thickness: the drawing gives none.
 */
export const OBSTACLE_STRIP_M = GRID_CELL_M * 1.2;

export interface Shutter {
  id: string;
  /** 0-based bay, counted from the left as seen from the front */
  bay: number;
  /** which side of its bay, seen from the front */
  side: 'left' | 'right';
  /** hinge position along b from the box centre, metres */
  hingeU: number;
  /** +1: the closed shutter extends toward +b (right); -1 toward -b */
  dir: 1 | -1;
  widthM: number;
}

export interface OpenSpec {
  itemId: string;
  origin: 'drawing' | 'catalogue';
  bays: number;
  shutters: Shutter[];
  /** the furthest angle a shutter opens to, radians */
  maxAngleRad: number;
  /** where the shutter width came from, for the card */
  widthNote: string;
  design?: OpenableDesign;
  /** catalogue wardrobes: the entry's name and door count */
  catalogue?: { name: string; doors: number };
}

// ---------------------------------------------------------------- building a spec

/** A drawn wardrobe: pairs of shutters hinged at each bay's outer edges, meeting at the centre. */
export function specFromDesign(item: FurnitureItem, d: OpenableDesign): OpenSpec {
  const shutters: Shutter[] = [];
  d.bayCentresFromLeftM.forEach((c, bay) => {
    const u = c - item.box.w / 2;
    shutters.push({ id: `b${bay + 1}-l`, bay, side: 'left', hingeU: u - d.shutterWidthM, dir: 1, widthM: d.shutterWidthM });
    shutters.push({ id: `b${bay + 1}-r`, bay, side: 'right', hingeU: u + d.shutterWidthM, dir: -1, widthM: d.shutterWidthM });
  });
  return {
    itemId: item.id, origin: 'drawing', bays: d.bayCentresFromLeftM.length, shutters, maxAngleRad: d.maxAngleDeg * DEG,
    widthNote: sourceSheet(d.sources?.shutterWidthM) ?? 'the drawing', design: d,
  };
}

/** The number in a catalogue name like "2-door wardrobe", or null. */
export function doorsInName(name: string): number | null {
  const m = /(\d+)\s*-?\s*door/i.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * A catalogue wardrobe: the entry's own door count (its name, "2-door wardrobe") and its width. Only the two-door case is a
 * plain pair hinged at the outer edges; any other count is not modelled (null).
 */
export function specFromCatalogue(item: FurnitureItem): OpenSpec | null {
  if (item.kind !== 'wardrobe' || !item.catalogId) return null;
  let name: string;
  try { name = catalogItem(item.catalogId).name; } catch { return null; }
  const doors = doorsInName(name);
  if (doors !== 2) return null;
  const W = item.box.w / 2;
  return {
    itemId: item.id, origin: 'catalogue', bays: 1, maxAngleRad: 90 * DEG, widthNote: 'catalogue size', catalogue: { name, doors },
    shutters: [
      { id: 'b1-l', bay: 0, side: 'left', hingeU: -item.box.w / 2, dir: 1, widthM: W },
      { id: 'b1-r', bay: 0, side: 'right', hingeU: item.box.w / 2, dir: -1, widthM: W },
    ],
  };
}

// ---------------------------------------------------------------- geometry

/** World point of item-frame coordinates (u along b from the centre, v along a from the centre). */
export function toWorld(box: Box, u: number, v: number): Vec2 {
  const { a, b } = boxAxes(box);
  return { x: box.cx + b.x * u + a.x * v, z: box.cz + b.z * u + a.z * v };
}

export interface ShutterPose { hinge: Vec2; tip: Vec2; /** unit direction hinge -> free edge */ dir: Vec2 }

/** The hinge and the free edge of a shutter opened to `angleRad` (0 closed, PI/2 square to the front). */
export function shutterPose(box: Box, s: Shutter, angleRad: number): ShutterPose {
  const { a, b } = boxAxes(box);
  const lu = s.dir * Math.cos(angleRad);
  const lv = Math.sin(angleRad);
  const dir = { x: b.x * lu + a.x * lv, z: b.z * lu + a.z * lv };
  const hinge = toWorld(box, s.hingeU, box.d / 2);
  return { hinge, dir, tip: { x: hinge.x + dir.x * s.widthM, z: hinge.z + dir.z * s.widthM } };
}

/** The floor arc the free edge sweeps, from closed to `toRad`, as points. Radius is the shutter's width. */
export function swingArc(box: Box, s: Shutter, toRad: number, n = 24): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) pts.push(shutterPose(box, s, (toRad * i) / n).tip);
  return pts;
}

/** How far into the room a shutter reaches at its furthest: its width (reached at a quarter turn, less beyond). */
export function intrusionM(s: Shutter): number {
  return s.widthM;
}

/** A shutter as a thin obstacle box for the walk grid (stamped with the full shutter height). */
export function shutterObstacle(box: Box, s: Shutter, angleRad: number, heightM: number): { box: Box; heightM: number } {
  const p = shutterPose(box, s, angleRad);
  const yawDeg = (((Math.atan2(p.dir.x, p.dir.z) / DEG) % 360) + 360) % 360;
  return {
    box: { cx: p.hinge.x + p.dir.x * s.widthM / 2, cz: p.hinge.z + p.dir.z * s.widthM / 2, w: OBSTACLE_STRIP_M, d: s.widthM, yawDeg },
    heightM,
  };
}

/** Distance along a unit ray to a box (0 when the origin is inside), or null when it misses. */
export function rayToBox(origin: Vec2, dir: Vec2, box: Box): number | null {
  const { a, b } = boxAxes(box);
  const ox = origin.x - box.cx, oz = origin.z - box.cz;
  const ou = ox * b.x + oz * b.z, ov = ox * a.x + oz * a.z;
  const du = dir.x * b.x + dir.z * b.z, dv = dir.x * a.x + dir.z * a.z;
  let t0 = 0, t1 = Infinity;
  for (const [o, d, h] of [[ou, du, box.w / 2], [ov, dv, box.d / 2]] as const) {
    if (Math.abs(d) < 1e-12) { if (Math.abs(o) > h) return null; continue; }
    let ta = (-h - o) / d, tb = (h - o) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

export interface RayHit {
  distM: number;
  kind: 'item' | 'wall' | 'none';
  itemId?: string;
  /** "bed", "study", "wall" */
  what: string;
}

/** What an item is called in a sentence: its label in lower case ("bed", "study", "side table"). */
export function whatItem(item: FurnitureItem): string {
  return (item.label || item.kind).toLowerCase();
}

/**
 * Walking space from `origin` along `dir` to the nearest obstacle. The grid ray finds it (the grid is 5 cm, so a box edge is only
 * known to within a cell); when a furniture box explains the hit, that box's exact edge is used instead, so a drawn dimension
 * comes out exactly. `grid` must not contain the wardrobe itself or its open shutters.
 */
export function walkingSpace(grid: Grid, others: FurnitureItem[], origin: Vec2, dir: Vec2, maxM = RAY_CAP_M): RayHit {
  const g = clearance(grid, origin, dir, maxM);
  let exact: { t: number; item: FurnitureItem } | null = null;
  for (const it of others) {
    const t = rayToBox(origin, dir, it.box);
    if (t !== null && t <= maxM && (!exact || t < exact.t)) exact = { t, item: it };
  }
  if (exact && (Math.abs(exact.t - g) <= grid.cellM || exact.t < g)) {
    return { distM: exact.t, kind: 'item', itemId: exact.item.id, what: whatItem(exact.item) };
  }
  if (g >= maxM) return { distM: maxM, kind: 'none', what: 'nothing' };
  return { distM: g, kind: 'wall', what: 'wall' };
}

/**
 * The largest angle (radians, up to `maxRad`) a shutter opens to before its swing meets something in `grid` (which must not
 * contain this wardrobe or its shutters). Radial rays from the hinge every 2 degrees; points within 3 cm of the front plane are
 * skipped, since they belong to the wardrobe's own face.
 */
export function freeAngleRad(grid: Grid, box: Box, s: Shutter, maxRad: number): number {
  const step = 2 * DEG;
  let free = 0;
  for (let ang = step; ang <= maxRad + 1e-9; ang += step) {
    const p = shutterPose(box, s, Math.min(ang, maxRad));
    let clear = true;
    for (let r = 0.04; r <= s.widthM + 1e-9; r += 0.025) {
      if (r * Math.sin(Math.min(ang, maxRad)) < 0.03) continue;
      const x = p.hinge.x + p.dir.x * r, z = p.hinge.z + p.dir.z * r;
      if (cellValue(grid, x, z) !== GRID_FREE) { clear = false; break; }
    }
    if (!clear) break;
    free = Math.min(ang, maxRad);
  }
  return free;
}

/**
 * Furnish mode: how far in front of a wardrobe its shutters need to open (cm, the widest shutter touched) when `other` sits in a
 * shutter's swing, else null. The swing of a shutter is the quarter disc of its width around its hinge, in front of the box.
 */
export function swingNeedCm(spec: OpenSpec, wardrobe: Box, other: Box): number | null {
  let need = 0;
  for (const s of spec.shutters) {
    let hit = false;
    for (let ang = 6 * DEG; ang <= spec.maxAngleRad + 1e-9 && !hit; ang += 3 * DEG) {
      const p = shutterPose(wardrobe, s, ang);
      for (let r = 0.02; r <= s.widthM + 1e-9; r += 0.02) {
        if (pointInBox({ x: p.hinge.x + p.dir.x * r, z: p.hinge.z + p.dir.z * r }, other)) { hit = true; break; }
      }
    }
    if (hit) need = Math.max(need, intrusionM(s));
  }
  return need > 0 ? Math.round(need * 100) : null;
}

// ---------------------------------------------------------------- numbers as text

/** 1'-4½": feet, then inches to the nearest half inch. */
export function ftInHalf(m: number): string {
  const halves = Math.max(0, Math.round((m / M_PER_IN) * 2 + 1e-9));
  const ft = Math.floor(halves / 24);
  const rem = halves - ft * 24;
  const whole = Math.floor(rem / 2);
  return `${ft}'-${whole}${rem % 2 === 1 ? '½' : ''}"`;
}

const cmOf = (m: number): number => Math.round(m * 100) + 0;
/** "42 cm · 1'-4½"" */
export function lengthLabel(m: number): string {
  return `${cmOf(m)} cm · ${ftInHalf(m)}`;
}

// ---------------------------------------------------------------- the open card

export interface ShutterReading {
  shutter: Shutter;
  /** the angle it stands open at, radians */
  angleRad: number;
  /** from its free edge to the nearest obstacle in front */
  space: RayHit;
}

export interface OpenCardResult { card: CheckCard; tone: Tone; minSpaceM: number | null; blocked: boolean }

/**
 * The card for the shutters that are open now. Tiers reuse the placement checks (SPEC 4.5): the wardrobe's access rule in front
 * (`specFor(item).access`, "all of front >= 0.90" in the catalogue) decides `fits` (good) or `tight` (warn), and a shutter that
 * meets something before it is square to the front is `blocked` (bad), as an overlap is in furnish mode. No other threshold.
 */
export function openCard(spec: OpenSpec, item: FurnitureItem, readings: ShutterReading[]): OpenCardResult {
  const frontRule = specFor(item).access.find((r) => r.sides.includes('front'));
  const needM = frontRule?.minM ?? 0.9;
  const openBays = [...new Set(readings.map((r) => r.shutter.bay))].sort((x, y) => x - y);
  const scope = openBays.length === spec.bays
    ? 'Shutters open'
    : openBays.length === 1 ? `Bay ${openBays[0] + 1} open` : `Bays ${openBays.map((b) => b + 1).join(', ')} open`;
  const W = readings.length ? readings[0].shutter.widthM : 0;
  const stopped = readings.filter((r) => r.angleRad < spec.maxAngleRad - 1e-6);
  const blocked = stopped.length > 0;
  const lines: string[] = [];
  const dims = `${cmOf(item.box.w)} × ${cmOf(item.box.d)} × ${cmOf(item.heightM)} cm`;
  lines.push(spec.origin === 'drawing' ? `Size from the drawing: ${dims}.` : `Catalogue size: ${dims}.`);

  const min = readings.reduce<ShutterReading | null>((m, r) => (!m || r.space.distM < m.space.distM ? r : m), null);
  let headline: string;
  let tone: Tone;
  if (blocked) {
    tone = 'bad';
    const worst = stopped.reduce((m, r) => (r.angleRad < m.angleRad ? r : m));
    headline = `${scope}, but a shutter cannot swing fully here.`;
    lines.push(`Something is in the swing: it stops at ${Math.round(worst.angleRad / DEG)}° of ${Math.round(spec.maxAngleRad / DEG)}°. Each shutter needs ${cmOf(W)} cm in front.`);
  } else if (!min) {
    tone = 'good';
    headline = 'Shutters closed.';
  } else if (min.space.kind === 'none') {
    tone = 'good';
    headline = `${scope}: more than ${RAY_CAP_M} m clear in front.`;
  } else {
    tone = min.space.distM >= needM ? 'good' : 'warn';
    headline = `${scope}: ${cmOf(min.space.distM)} cm walking space to the ${min.space.what}.`;
  }

  if (!blocked && min && min.space.kind !== 'none') {
    const gap = spec.design?.gaps.find((g) => g.toItem === min.space.itemId);
    if (gap && Math.abs(gap.gapM - min.shutter.widthM - min.space.distM) < 0.01) {
      lines.push(`From the drawing: ${gap.text} gap − ${ftInHalf(min.shutter.widthM)} shutter = ${ftInHalf(gap.gapM - min.shutter.widthM)} (${cmOf(min.space.distM)} cm).`);
    } else if (spec.origin === 'catalogue' && spec.catalogue) {
      lines.push(`Catalogue size: ${cmOf(item.box.w)} cm wide, ${spec.catalogue.doors} doors, so each shutter is ${lengthLabel(W)}. Measured on the model.`);
    } else {
      lines.push(`Each shutter is ${lengthLabel(W)} (${spec.widthNote}). Measured on the model.`);
    }
  } else if (spec.origin === 'catalogue') {
    lines.push(`Each shutter is ${lengthLabel(W)} (catalogue size).`);
  }

  // per bay (drawing) or per door (catalogue): each distinct reading, nearest first
  const groups = new Map<string, ShutterReading[]>();
  for (const r of readings) {
    const key = spec.origin === 'drawing' ? `Bay ${r.shutter.bay + 1}` : (r.shutter.side === 'left' ? 'Left door' : 'Right door');
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [name, rs] of groups) {
    const seen = new Set<string>();
    const parts: string[] = [];
    for (const r of [...rs].sort((x, y) => x.space.distM - y.space.distM)) {
      const t = r.angleRad < spec.maxAngleRad - 1e-6
        ? `stops at ${Math.round(r.angleRad / DEG)}\u00b0`
        : r.space.kind === 'none' ? `more than ${RAY_CAP_M} m clear` : `${cmOf(r.space.distM)} cm to the ${r.space.what}`;
      if (!seen.has(t)) { seen.add(t); parts.push(t); }
    }
    lines.push(`${name}: ${parts.join(', ')}.`);
  }

  if (!blocked && min && min.space.kind !== 'none') {
    lines.push(tone === 'good'
      ? `That is ${cmOf(needM)} cm or more in front, which a wardrobe needs (the catalogue access rule).`
      : `Tight: a wardrobe needs ${cmOf(needM)} cm in front (the catalogue access rule), and ${cmOf(min.space.distM)} cm is left with the shutters open.`);
  }
  if (spec.origin === 'drawing' && spec.design) {
    const note = spec.design.cardConflict ?? spec.design.conflicts[0];
    if (note) lines.push(`Drawing conflict: ${note}`);
  }
  const footer = spec.origin === 'drawing'
    ? `Shutter thickness and handles are not in the drawing, not included. The opening angle is not in the drawing either: ${Math.round(spec.maxAngleRad / DEG)}° is the furthest a shutter sticks out.`
    : 'Catalogue size, not from a drawing. Shutter thickness and handles are not included. Furniture style is illustrative.';
  return {
    card: { title: `${item.label} · ${spec.origin === 'drawing' ? 'from the drawing' : 'catalogue size'}`, tone, headline, lines, footer },
    tone, minSpaceM: min ? min.space.distM : null, blocked,
  };
}

/** One sentence of furnish mode when a placed item sits in a shutter's swing, or null. */
export function swingNote(needCm: number): string {
  return `Wardrobe shutters need ${needCm} cm to open here.`;
}
