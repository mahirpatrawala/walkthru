// What the room bar, the minimap and the jump decide, without a DOM. Pure.
import type { Layout, RoomTag, Vec2 } from '../../types';
import { roomAt } from '../../core/layout-geom';
import { roomsSummary } from '../rooms';
import type { UnverifiedRooms } from '../store';

export interface RoomChip {
  id: string;
  label: string;
  /** the size line: the drawing's area, "Not measured" where it is not, "Shape guessed" for a room only partly on the drawing */
  area: string;
  /** the accessible name: the label and the size, with the reason a size is missing */
  title: string;
  /** a room only partly on the drawing has no place to stand: its chip says so and does nothing */
  goable: boolean;
  partial: boolean;
  unmeasured: boolean;
}

/**
 * One chip per room, from the same rows the Rooms sheet shows (SPEC 2.1), so the bar can never say a size the sheet does not.
 * An unverified size keeps the sheet's honesty: the chip says "Not measured", never a number.
 */
export function roomChips(layout: Layout, unverified: UnverifiedRooms = {}): RoomChip[] {
  const rows = roomsSummary(layout, unverified).rows;
  return rows.map((r) => {
    const unmeasured = !r.partial && !!unverified[r.id];
    const area = r.partial ? 'Shape guessed' : unmeasured ? 'Not measured' : r.text;
    return { id: r.id, label: r.label, area, title: `${r.label}, ${r.text}`, goable: !r.partial, partial: r.partial, unmeasured };
  });
}

/** The caption of a tour stop: name and size, as the HUD's room chip words it. */
export function chipCaption(c: RoomChip): string {
  return `${c.label} · ${c.area}`;
}

/** The room the walker is in now, or the one they were last in while they stand in a doorway or a wall. */
export function currentRoomId(layout: Layout, pos: Vec2, last: string | null): string | null {
  const r: RoomTag | null = roomAt(layout, pos);
  return r ? r.id : last;
}

/** A route longer than this is not walked to the end: a short walk, a fade, and the last stretch walked in (SPEC 2.6). */
export const SHORTCUT_FROM_M = 8;
/** How long the walk before the fade lasts, seconds, and how far from the standing spot the walk resumes, metres. */
export const SHORTCUT_WALK_S = 1.5;
export const SHORTCUT_LAST_M = 2;

/**
 * What a go-to does with a route of this length: 'walk' it all (up to `SHORTCUT_FROM_M`), 'shortcut' (walk a little, fade to a spot
 * `SHORTCUT_LAST_M` before the end, walk in), or 'fade' (no route at all: a plain jump to the standing spot).
 */
export function goPlan(lengthM: number | null): 'walk' | 'shortcut' | 'fade' {
  if (lengthM === null || !Number.isFinite(lengthM)) return 'fade';
  return lengthM <= SHORTCUT_FROM_M ? 'walk' : 'shortcut';
}

/** The point `distM` along a polyline from its start (clamped to its ends), and the way it was heading there. */
export function pointAlongRoute(points: readonly Vec2[], distM: number): Vec2 {
  let left = Math.max(0, distM);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= l || i === points.length - 1) { const k = l > 1e-9 ? Math.min(1, left / l) : 0; return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k }; }
    left -= l;
  }
  return { x: points[0].x, z: points[0].z };
}

export interface Rect { left: number; top: number; right: number; bottom: number }

/**
 * How far (px) the minimap must be lifted so it covers none of the things standing over it (a prompt pill, a card), given where it
 * would sit and where they are. Obstacles that do not overlap it sideways do not matter. 0 when nothing is in the way.
 */
export function liftAbove(map: Rect, obstacles: readonly Rect[], gap = 8): number {
  let lift = 0;
  for (const o of obstacles) {
    if (o.right <= map.left || o.left >= map.right) continue; // beside it
    if (o.bottom <= map.top) continue; // already above it
    // the obstacle reaches down into (or past) the map: the map goes above its top edge
    lift = Math.max(lift, map.bottom - o.top + gap);
  }
  return Math.max(0, lift);
}

/** The view cone's outline in plan units: an apex at the walker and an arc `radius` away, `halfDeg` either side of the heading (forward is (sin, cos), SPEC 3.1). */
export function conePath(at: Vec2, yawDeg: number, radius: number, halfDeg = 34, steps = 6): string {
  const pts: string[] = [`M${at.x.toFixed(3)},${at.z.toFixed(3)}`];
  for (let k = 0; k <= steps; k++) {
    const a = ((yawDeg - halfDeg + (2 * halfDeg * k) / steps) * Math.PI) / 180;
    pts.push(`L${(at.x + Math.sin(a) * radius).toFixed(3)},${(at.z + Math.cos(a) * radius).toFixed(3)}`);
  }
  return `${pts.join('')}Z`;
}

/** The nearest room to a tapped plan point: the room it is in, else the nearest outline within `maxM` (a tap just off a small room). */
export function roomNear(layout: Layout, p: Vec2, maxM: number, goableOnly = true): RoomTag | null {
  const inside = roomAt(layout, p);
  if (inside && (!goableOnly || !inside.partial)) return inside;
  let best: RoomTag | null = null, bestD = maxM;
  for (const r of layout.rooms) {
    if (goableOnly && r.partial) continue;
    for (let i = 0; i < r.polygon.length; i++) {
      const a = r.polygon[i], b = r.polygon[(i + 1) % r.polygon.length];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
      const d = Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
      if (d < bestD) { bestD = d; best = r; }
    }
  }
  return best;
}
