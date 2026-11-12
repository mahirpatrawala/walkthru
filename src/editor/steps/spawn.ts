// Owned by C6. E8 Spawn and save (SPEC 2.2): click the plan for the spawn point, drag from it for the facing direction, set the
// title and subtitle. Save and "Open as buyer" live in the top bar (C5), so this panel lists what is still missing before Save works.
import { CHARACTER_RADIUS_M } from '../../types';
import type { Grid, PropertyFile, Vec2 } from '../../types';
import { circleFree, nearestFree } from '../../core/grid-query';
import type { EditorContext, EditorHost, EditorStep, PlanTool } from '../context';
import { asHost } from '../context';
import { clear, h } from '../dom';
import { SPAWN_MESSAGE } from '../save';

export { SPAWN_MESSAGE };

/** A drag shorter than this sets the point only and leaves the facing alone. */
export const MIN_FACING_DRAG_M = 0.15;

/** Heading of the drag from the spawn point, in degrees [0, 360), 1 decimal. Yaw 0 faces +Z (3.1). */
export function yawFromDrag(from: Vec2, to: Vec2): number | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.hypot(dx, dz) < MIN_FACING_DRAG_M) return null;
  let yaw = (Math.atan2(dx, dz) * 180) / Math.PI;
  if (yaw < 0) yaw += 360;
  yaw = Math.round(yaw * 10) / 10;
  return yaw >= 360 ? 0 : yaw;
}

/** True when the character (radius 0.22 m) fits at the spawn point on the grid. */
export function spawnIsFree(grid: Grid, spawn: { x: number; z: number }): boolean {
  return circleFree(grid, spawn.x, spawn.z, CHARACTER_RADIUS_M);
}

/** Null when the spawn point is fine, else the message the step shows. */
export function spawnProblem(grid: Grid, spawn: { x: number; z: number }): string | null {
  return spawnIsFree(grid, spawn) ? null : SPAWN_MESSAGE;
}

/** `createEmptyProperty` puts the spawn at exactly (0, 0) with yaw 0, which nobody picks on purpose: treat it as not set yet. */
export function spawnIsSet(spawn: PropertyFile['spawn']): boolean {
  return !(spawn.x === 0 && spawn.z === 0 && spawn.yawDeg === 0);
}

/** The nearest spot the character fits, searched up to 3 m around the point. */
export function nearestSpawn(grid: Grid, spawn: { x: number; z: number }): Vec2 | null {
  return nearestFree(grid, spawn.x, spawn.z, CHARACTER_RADIUS_M, 3);
}

function r2(n: number): number { return Math.round(n * 100) / 100; }

function maybeHost(ctx: EditorContext): EditorHost | null {
  try { return asHost(ctx); } catch { return null; }
}

export const step: EditorStep = {
  id: 'spawn',
  title: 'Spawn and save',
  mount(panel, ctx) {
    const draft = ctx.draft;
    const plan = ctx.plan;
    const host = maybeHost(ctx);
    panel.className = 'panel-body step-spawn';
    const body = h('div');
    let dragging = false;

    const tool: PlanTool = {
      cursor: 'crosshair',
      onDown(w) {
        dragging = true;
        draft.spawn = { x: r2(w.x), z: r2(w.z), yawDeg: draft.spawn.yawDeg };
      },
      onMove(w, e) {
        if (!dragging || !(e.buttons & 1)) return;
        const yaw = yawFromDrag(draft.spawn, w);
        if (yaw !== null) draft.spawn = { ...draft.spawn, yawDeg: yaw };
      },
      onUp(w) {
        if (!dragging) return;
        dragging = false;
        const yaw = yawFromDrag(draft.spawn, w);
        if (yaw !== null) draft.spawn = { ...draft.spawn, yawDeg: yaw };
        ctx.commit();
        render();
      },
      cancel() { dragging = false; },
      draw(g, c) {
        if (draft.layout.rooms.length === 0 || !spawnIsSet(draft.spawn)) return;
        const free = spawnIsFree(ctx.grid(), draft.spawn);
        const p = c.worldToScreen({ x: draft.spawn.x, z: draft.spawn.z });
        const r = CHARACTER_RADIUS_M * c.pxPerMetreOnScreen();
        g.beginPath();
        g.arc(p.x, p.y, Math.max(r, 5), 0, Math.PI * 2);
        g.lineWidth = 2;
        g.strokeStyle = free ? '#16a34a' : '#dc2626';
        g.fillStyle = free ? 'rgba(22,163,74,0.18)' : 'rgba(220,38,38,0.22)';
        g.fill();
        g.stroke();
      },
    };

    function checklist(): HTMLElement {
      const v = host ? host.validation() : { errors: [], warnings: [], importNotes: [] };
      const problem = spawnIsSet(draft.spawn) ? spawnProblem(ctx.grid(), draft.spawn) : SPAWN_MESSAGE;
      const rows: { ok: boolean; text: string }[] = [
        { ok: draft.layout.rooms.length > 0, text: draft.layout.rooms.length > 0 ? `${draft.layout.rooms.length} room${draft.layout.rooms.length === 1 ? '' : 's'} drawn` : 'Draw at least one room' },
        { ok: v.errors.length === 0, text: v.errors.length === 0 ? 'No layout errors' : `${v.errors.length} layout error${v.errors.length === 1 ? '' : 's'} to fix (listed below the panel)` },
        { ok: problem === null, text: problem === null ? 'Spawn point is on the floor' : problem },
      ];
      return h('ul', { class: 'msgs' }, ...rows.map((r) => h('li', { class: r.ok ? 'ok' : 'err', text: `${r.ok ? '✓' : '✗'} ${r.text}` })));
    }

    function render(): void {
      clear(body);
      body.append(h('p', { class: 'muted small', text: 'Click the plan for the spawn point, then drag from it for the way the buyer faces on arrival.' }));

      const set = spawnIsSet(draft.spawn);
      const problem = set ? spawnProblem(ctx.grid(), draft.spawn) : SPAWN_MESSAGE;
      body.append(h('div', { class: 'card' },
        h('h3', { text: 'Spawn point' }),
        set
          ? h('p', { class: 'small', text: `x ${draft.spawn.x.toFixed(2)} m, z ${draft.spawn.z.toFixed(2)} m, facing ${Math.round(draft.spawn.yawDeg)}°` })
          : h('p', { class: 'muted small', text: 'Not set yet.' }),
        problem ? h('p', { class: 'err small', text: problem }) : h('p', { class: 'ok small', text: 'On a free spot.' }),
        set && problem
          ? h('button', { class: 'btn small', text: 'Move to the nearest free spot', onclick: () => {
              const q = nearestSpawn(ctx.grid(), draft.spawn);
              if (!q) { host?.toast('No free spot within 3 m. Click somewhere inside a room.', 'warn'); return; }
              draft.spawn = { x: r2(q.x), z: r2(q.z), yawDeg: draft.spawn.yawDeg };
              ctx.commit();
              render();
            } })
          : null));

      const title = h('input', { type: 'text', value: draft.title, placeholder: 'e.g. 2 BHK in Powai' }) as HTMLInputElement;
      title.addEventListener('change', () => { draft.title = title.value.trim(); ctx.commit(); render(); });
      const subtitle = h('input', { type: 'text', value: draft.subtitle ?? '', placeholder: 'e.g. Hiranandani Gardens, 11th floor' }) as HTMLInputElement;
      subtitle.addEventListener('change', () => {
        const t = subtitle.value.trim();
        if (t) draft.subtitle = t; else delete draft.subtitle;
        ctx.commit();
        render();
      });
      body.append(
        h('label', { class: 'field' }, h('span', { text: 'Title' }), title),
        h('label', { class: 'field' }, h('span', { text: 'Subtitle' }), subtitle));

      body.append(h('h3', { text: 'Before you save' }), checklist());
      body.append(h('p', { class: 'muted small', text: 'Save and Open as buyer are in the bar at the top. Save checks all of this, writes public/scenes/' + ctx.sceneId + '/property.json and also downloads the file.' }));
    }

    clear(panel);
    panel.append(body);
    plan.setTool(tool);
    render();
  },
  unmount() {},
  isDone(ctx) {
    const d = ctx.draft;
    if (d.layout.rooms.length === 0 || !spawnIsSet(d.spawn)) return false;
    try { return spawnIsFree(ctx.grid(), d.spawn); } catch { return false; }
  },
};
