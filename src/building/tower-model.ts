// The tower of the inventory picker (SPEC 22.3): where each unit's box stands, the colour of a unit by status, the orbit camera and the label words. Pure: no
// DOM, no three, so it is tested on its own. Boxes in metres, x east, z south, y up; the tower stands on y = 0.
import type { UnitStatus } from '../inventory/types';
import type { Unit } from './units';

export interface Cell { unit: Unit; x: number; y: number; z: number; w: number; h: number; d: number }
export interface TowerGeometry {
  cells: Cell[];
  /** the whole tower's box, for the camera */
  box: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
  /** the solid base under the first unit floor (the lobby and the clubhouse level); null when the tower starts on the ground */
  base: { w: number; d: number; h: number } | null;
  floors: number;
  perFloor: number;
}

/**
 * The unit boxes of one floor stand side by side in one row (two rows from nine a floor), a hand's width apart, so a unit reads as a unit and every
 * unit of a one-row floor shows its face from the front or the back: a tap on the tower can reach any of them.
 */
export function towerGeometry(units: readonly Unit[], opts: { floorH?: number; firstFloor?: number; gap?: number; unitW?: number; unitD?: number } = {}): TowerGeometry {
  const floorH = opts.floorH ?? 3.1, gap = opts.gap ?? 0.6, uw = opts.unitW ?? 7.2, ud = opts.unitD ?? 11;
  const floorsList = [...new Set(units.map((u) => u.floor))].sort((a, b) => a - b);
  const perFloor = Math.max(1, ...floorsList.map((f) => units.filter((u) => u.floor === f).length));
  const cols = perFloor <= 8 ? perFloor : Math.ceil(perFloor / 2), rows = Math.ceil(perFloor / cols);
  const W = cols * uw + (cols - 1) * gap, D = rows * ud + (rows - 1) * gap;
  const lowest = floorsList[0] ?? 1;
  const base = opts.firstFloor !== undefined && opts.firstFloor > 1 ? { w: W + 6, d: D + 6, h: Math.min(2, opts.firstFloor - 1) * floorH } : null;
  const y0 = base ? base.h : 0;
  const cells: Cell[] = [];
  for (const f of floorsList) {
    const on = units.filter((u) => u.floor === f);
    on.forEach((unit, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      cells.push({ unit, x: -W / 2 + c * (uw + gap) + uw / 2, y: y0 + (f - lowest) * floorH + (floorH - 0.25) / 2, z: -D / 2 + r * (ud + gap) + ud / 2, w: uw, h: floorH - 0.25, d: ud });
    });
  }
  const top = y0 + floorsList.length * floorH;
  return { cells, box: { x0: -W / 2, x1: W / 2, y0: 0, y1: top, z0: -D / 2, z1: D / 2 }, base, floors: floorsList.length, perFloor };
}

// ---------------------------------------------------------------- colour

export type TowerColour = [number, number, number];
/** Linear-ish sRGB triples 0..1 for the instance colours. Status colours are never the only signal: the list and the card say it in words. */
export const COLOURS = {
  neutral: [0.93, 0.88, 0.8] as TowerColour,
  available: [0.30, 0.62, 0.45] as TowerColour,
  sold: [0.78, 0.38, 0.27] as TowerColour,
  unknown: [0.72, 0.70, 0.67] as TowerColour,
  selected: [0.98, 0.78, 0.30] as TowerColour,
  base: [0.82, 0.78, 0.72] as TowerColour,
};

/** The colour of a unit's box: its status when the tower is coloured by status, a quiet cream otherwise. A unit with no status is grey, never green. */
export function cellColour(status: UnitStatus | undefined | null, byStatus: boolean, selected: boolean, hovered: boolean): TowerColour {
  const c = selected ? COLOURS.selected : byStatus ? (status === 'available' ? COLOURS.available : status === 'sold' ? COLOURS.sold : COLOURS.unknown) : COLOURS.neutral;
  return hovered && !selected ? (c.map((v) => Math.min(1, v * 1.12 + 0.05)) as TowerColour) : c;
}

// ---------------------------------------------------------------- the orbit camera

export interface Orbit { yaw: number; pitch: number; dist: number }
export const PITCH_MIN = 0.12, PITCH_MAX = 1.2;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The tower's size and the first orbit, from the south-west corner a little above. `distFor` is how far back the camera must stand for the whole tower (and a margin) to fit a vertical field of view `fovDeg` at `aspect`. */
export function framing(g: TowerGeometry): { radius: number; target: { x: number; y: number; z: number }; orbit: Orbit; distFor(fovDeg: number, aspect: number): number } {
  const { x0, x1, y1, z0, z1 } = g.box;
  const radius = Math.hypot(x1 - x0, y1, z1 - z0) / 2;
  const half = y1 / 2, wide = Math.hypot(x1 - x0, z1 - z0) / 2;
  const distFor = (fovDeg: number, aspect: number): number => {
    const t = Math.tan((fovDeg * Math.PI) / 360);
    return Math.max((half * 1.1) / t, (wide * 1.15) / (t * Math.min(1, aspect))) + wide * 0.35;
  };
  return { radius, target: { x: 0, y: y1 * 0.5, z: 0 }, orbit: { yaw: -0.62, pitch: 0.3, dist: radius * 2.4 }, distFor };
}
/** `fit` is the distance that frames the tower: the camera may come in to half of it and go out to one and a half times. */
export const clampOrbit = (o: Orbit, fit: number): Orbit => ({ yaw: o.yaw, pitch: clamp(o.pitch, PITCH_MIN, PITCH_MAX), dist: clamp(o.dist, fit * 0.45, fit * 1.5) });
/** where the camera stands for an orbit about `target` */
export function orbitPosition(o: Orbit, target: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const cp = Math.cos(o.pitch);
  return { x: target.x + Math.sin(o.yaw) * cp * o.dist, y: target.y + Math.sin(o.pitch) * o.dist, z: target.z + Math.cos(o.yaw) * cp * o.dist };
}
/** a drag of (dx, dy) px turns the tower: a full canvas width is about a half turn */
export function dragOrbit(o: Orbit, dx: number, dy: number, width: number, fit: number): Orbit {
  const k = Math.PI / Math.max(200, width);
  return clampOrbit({ ...o, yaw: o.yaw - dx * k, pitch: o.pitch + dy * k }, fit);
}

/** "2 BHK" from "2 BHK · 644 sq ft": the type's short label for a chip. */
export const shortType = (name: string): string => name.split(' · ')[0].trim();
