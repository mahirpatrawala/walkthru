// Owned by C3. Measure mode (SPEC 2.1): tap two points on the shell or furniture, get a line, dots and a label.
// A third tap starts over. Walking stays on, so this mode never touches locomotion.
import { formatLength } from '../core/units';
import type { Vec3 } from '../types';
import type { BuyerContext, BuyerMode, OverlayHandle } from './context';

export const MEASURE_COLOR = '#2F6BFF';
const TAG = 'measure';

export const MEASURE_TEXT = {
  first: 'Tap the first point',
  second: 'Tap the second point',
  again: 'Tap to measure again',
} as const;

/** Distance in metres and the label ("2.43 m · 8 ft 0 in", under 1 m "62 cm · 2 ft 0 in"). */
export function measureResult(a: Vec3, b: Vec3): { meters: number; label: string } {
  const meters = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  return { meters, label: formatLength(meters) };
}

export interface MeasureMode extends BuyerMode {
  /** the points measured so far (0, 1 or 2) */
  points(): Vec3[];
  /** feed a point directly (debug hook and tests); same as a tap that hit it */
  addPoint(p: Vec3): void;
  /** the last completed measurement */
  last(): { meters: number; label: string } | null;
}

export function createMeasureMode(ctx: BuyerContext): MeasureMode {
  let pts: Vec3[] = [];
  let handles: OverlayHandle[] = [];
  let off: (() => void) | null = null;
  let lastResult: { meters: number; label: string } | null = null;
  let active = false;

  const exit = (): void => { ctx.setMode('walk'); };

  const clearDrawing = (): void => {
    for (const h of handles) h.remove();
    handles = [];
    ctx.overlays.clear(TAG);
  };

  const reset = (): void => {
    clearDrawing();
    pts = [];
    ctx.hud.setModeBar(MEASURE_TEXT.first, exit);
  };

  const addPoint = (p: Vec3): void => {
    if (pts.length >= 2) reset();
    pts.push({ x: p.x, y: p.y, z: p.z });
    if (pts.length === 1) {
      handles.push(ctx.overlays.line(pts[0], pts[0], '', MEASURE_COLOR, TAG));
      ctx.hud.setModeBar(MEASURE_TEXT.second, exit);
    } else {
      clearDrawing();
      lastResult = measureResult(pts[0], pts[1]);
      handles.push(ctx.overlays.line(pts[0], pts[1], lastResult.label, MEASURE_COLOR, TAG));
      ctx.hud.setModeBar(MEASURE_TEXT.again, exit);
    }
  };

  return {
    id: 'measure',
    enter() {
      active = true;
      lastResult = null;
      reset();
      off = ctx.input.onTap((e) => {
        if (!active) return;
        const hit = ctx.raycast(e);
        if (!hit) return;
        addPoint(hit.point);
      });
    },
    exit() {
      active = false;
      off?.();
      off = null;
      clearDrawing();
      pts = [];
      ctx.hud.setModeBar(null);
    },
    update() { /* nothing per frame */ },
    points: () => pts.map((p) => ({ ...p })),
    addPoint,
    last: () => (lastResult ? { ...lastResult } : null),
  };
}
