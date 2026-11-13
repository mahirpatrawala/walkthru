// A rooms-that-are-only-partly-on-the-drawing label: shown while the walker is in one, or looking into one. Pure view rule + a small
// DOM badge mounted in the HUD's top-centre stack. Kept out of hud.ts and main.ts so HUD changes elsewhere merge cleanly.
import { GRID_FREE, GRID_VOID, GRID_TALL_CM } from '../types';
import type { Grid, Layout, RoomTag, Vec2 } from '../types';
import { cellValue } from '../core/grid-codec';
import { roomAt } from '../core/layout-geom';
import { PARTIAL_NOTE } from './store';

/** Yaw offsets (degrees) tried when looking for a partial room ahead, centre first. */
const LOOK_OFFSETS = [0, -18, 18, -36, 36];

/**
 * The partial room the walker stands in, else the first one in sight along the view heading (the ray stops at a wall or a tall item,
 * and passes through doorways). Null when no room of the layout is partial or none is in view. `yawDeg` is the walk heading
 * (forward is x = sin, z = cos).
 */
export function partialRoomInView(layout: Layout, grid: Grid, pos: Vec2, yawDeg: number, maxM = 7): RoomTag | null {
  if (!layout.rooms.some((r) => r.partial)) return null;
  const here = roomAt(layout, pos);
  if (here?.partial) return here;
  for (const off of LOOK_OFFSETS) {
    const a = ((yawDeg + off) * Math.PI) / 180;
    const dx = Math.sin(a), dz = Math.cos(a);
    for (let d = 0.3; d <= maxM; d += 0.1) {
      const p = { x: pos.x + dx * d, z: pos.z + dz * d };
      const v = cellValue(grid, p.x, p.z);
      if (v === GRID_VOID || v >= GRID_TALL_CM) break;
      if (v !== GRID_FREE) continue;
      const r = roomAt(layout, p);
      if (r?.partial) return r;
    }
  }
  return null;
}

export interface PartialBadge { update(room: RoomTag | null): void; remove(): void }

/** Mounts the badge at the end of the HUD's top-centre stack. */
export function mountPartialBadge(hudRoot: HTMLElement): PartialBadge {
  const badge = document.createElement('div');
  badge.className = 'wt-partial-badge';
  badge.dataset.testid = 'partial-badge';
  badge.hidden = true;
  (hudRoot.querySelector('.wt-top') ?? hudRoot).appendChild(badge);
  let last: string | null = null;
  return {
    update(room) {
      const text = room ? PARTIAL_NOTE : null;
      if (text === last) return;
      last = text;
      badge.hidden = !text;
      if (text) { badge.textContent = text; badge.title = room?.partial?.reason ?? ''; }
    },
    remove() { badge.remove(); },
  };
}
