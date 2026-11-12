// Owned by C5. E4 Openings (SPEC 2.2): pick a preset, click a room edge to place it centred on the click; select one to
// edit width, sill and head, drag it along its edge, or delete it.
import type { Layout, Opening, Vec2 } from '../../types';
import type { EditorStep, PlanTool } from '../context';
import { asHost } from '../context';
import { clear, h } from '../dom';
import {
  OPENING_PRESETS, SNAP_PX, clampOpening, distanceToOpening, edgePoint, moveOpening, placeOpening,
} from '../plan-helpers';
import type { OpeningPreset } from '../plan-helpers';

/** Places a preset at a click. Returns the new opening (already pushed into the layout) or null when no edge is near. */
export function placeOpeningInDraft(layout: Layout, click: Vec2, preset: OpeningPreset, maxDistM: number, preferRoomId?: string | null): Opening | null {
  const o = placeOpening(layout, click, preset, maxDistM, preferRoomId);
  if (o) layout.openings.push(o);
  return o;
}

/** The opening under a point (within `maxDistM`), nearest first. */
export function openingAt(layout: Layout, pt: Vec2, maxDistM: number): Opening | null {
  let best: Opening | null = null;
  let bestD = maxDistM;
  for (const o of layout.openings) {
    const d = distanceToOpening(layout, o, pt);
    if (d <= bestD) { bestD = d; best = o; }
  }
  return best;
}

const TYPE_NAMES = { door: 'Door', opening: 'Opening', window: 'Window' } as const;

export const step: EditorStep = {
  id: 'openings',
  title: 'Openings',
  mount(panel, ctx) {
    const host = asHost(ctx);
    const draft = ctx.draft;
    const plan = ctx.plan;
    panel.className = 'panel-body step-openings';
    let armed: OpeningPreset | null = OPENING_PRESETS[1];
    let ghost: Opening | null = null;
    let dragging = false;
    const body = h('div');

    const maxDist = (): number => (SNAP_PX * 1.5) / plan.pxPerMetreOnScreen();

    const placeTool = (preset: OpeningPreset): PlanTool => ({
      cursor: 'copy',
      onMove(w) { ghost = placeOpening(draft.layout, w, preset, maxDist(), host.selection.roomId); },
      onDown(w) {
        const o = placeOpeningInDraft(draft.layout, w, preset, maxDist(), host.selection.roomId);
        if (!o) { host.toast('Click on a wall of a room to place it.', 'warn'); return; }
        ghost = null;
        host.select({ openingId: o.id });
        armed = null;
        ctx.commit();
        useSelectTool();
        render();
      },
      onKey(e) { if (e.key === 'Escape') { armed = null; ghost = null; useSelectTool(); render(); } },
      cancel() { ghost = null; },
      draw(g, c) {
        if (!ghost) return;
        const room = draft.layout.rooms.find((r) => r.id === ghost!.roomId);
        if (!room) return;
        const a = c.worldToScreen(edgePoint(room, ghost.edge, ghost.centreM - ghost.widthM / 2));
        const b = c.worldToScreen(edgePoint(room, ghost.edge, ghost.centreM + ghost.widthM / 2));
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
        g.lineCap = 'round'; g.lineWidth = 6; g.strokeStyle = 'rgba(29,78,216,0.55)'; g.stroke();
      },
    });

    const selectTool = (): PlanTool => ({
      cursor: 'pointer',
      onDown(w) {
        const o = openingAt(draft.layout, w, maxDist());
        host.select({ openingId: o?.id ?? null });
        dragging = !!o;
        ctx.commit();
        render();
      },
      onMove(w, e) {
        if (!dragging || !(e.buttons & 1)) return;
        const id = host.selection.openingId;
        const i = draft.layout.openings.findIndex((q) => q.id === id);
        if (i < 0) return;
        draft.layout.openings[i] = moveOpening(draft.layout, draft.layout.openings[i], w);
        ctx.commit();
      },
      onUp() { if (dragging) { dragging = false; render(); } },
    });

    function useSelectTool(): void { plan.setTool(selectTool()); }
    function arm(p: OpeningPreset): void {
      armed = p;
      host.select({ openingId: null });
      plan.setTool(placeTool(p));
      render();
    }

    function numberField(label: string, value: number, apply: (v: number) => void): HTMLElement {
      const input = h('input', { type: 'number', step: '0.05', min: '0', value: String(+value.toFixed(3)) });
      input.addEventListener('change', () => {
        const v = parseFloat(input.value);
        if (Number.isFinite(v) && v >= 0) { apply(v); ctx.commit(); render(); }
      });
      return h('label', { class: 'field' }, h('span', { text: label }), input);
    }

    function render(): void {
      clear(body);
      body.append(h('p', { class: 'muted small', text: 'Pick a preset, then click a wall on the plan: it is placed centred on the click. A door between two rooms is placed once, on either room\'s edge. It cuts through both walls.' }));
      body.append(h('div', { class: 'presets' }, ...OPENING_PRESETS.map((p) =>
        h('button', { class: `btn${armed?.id === p.id ? ' on' : ''}`, onclick: () => arm(p) },
          h('strong', { text: p.label }), h('span', { class: 'muted small', text: ` ${p.widthM.toFixed(2)} m${p.sillM > 0 ? `, sill ${p.sillM.toFixed(2)}` : ''}` })))));
      body.append(h('button', { class: `btn${armed ? '' : ' on'}`, text: 'Select, drag or edit', onclick: () => { armed = null; useSelectTool(); render(); } }));

      const sel = draft.layout.openings.find((o) => o.id === host.selection.openingId) ?? null;
      if (sel) {
        const room = draft.layout.rooms.find((r) => r.id === sel.roomId);
        const update = (patch: Partial<Opening>): void => {
          const i = draft.layout.openings.findIndex((o) => o.id === sel.id);
          if (i >= 0) draft.layout.openings[i] = clampOpening(draft.layout, { ...draft.layout.openings[i], ...patch });
        };
        body.append(h('div', { class: 'card' },
          h('h3', { text: `${TYPE_NAMES[sel.type]} on ${room?.label ?? sel.roomId}, edge ${sel.edge + 1}` }),
          numberField('Width (m)', sel.widthM, (v) => update({ widthM: Math.max(0.1, v) })),
          numberField('Sill (m above the floor)', sel.sillM, (v) => update({ sillM: v })),
          numberField('Head (m above the floor)', sel.headM, (v) => update({ headM: Math.max(v, sel.sillM + 0.1) })),
          h('p', { class: 'muted small', text: 'Drag it along its edge on the plan.' }),
          h('button', { class: 'btn small', text: 'Delete', onclick: () => {
            draft.layout.openings = draft.layout.openings.filter((o) => o.id !== sel.id);
            host.select({ openingId: null });
            ctx.commit(); render();
          } }),
        ));
      }

      body.append(h('h3', { text: `Openings (${draft.layout.openings.length})` }));
      const list = h('ul', { class: 'roomlist' });
      for (const o of draft.layout.openings) {
        const room = draft.layout.rooms.find((r) => r.id === o.roomId);
        const li = h('li', { class: o.id === host.selection.openingId ? 'on' : '' },
          h('span', { class: 'grow' }, h('strong', { text: `${TYPE_NAMES[o.type]} ${o.widthM.toFixed(2)} m` }), h('br'),
            h('span', { class: 'muted small', text: `${room?.label ?? o.roomId}, edge ${o.edge + 1}` })));
        li.addEventListener('click', () => { host.select({ openingId: o.id }); armed = null; useSelectTool(); ctx.commit(); render(); });
        list.append(li);
      }
      if (draft.layout.openings.length === 0) list.append(h('li', { class: 'muted', text: 'No openings yet.' }));
      body.append(list);
    }

    clear(panel);
    panel.append(body);
    plan.setTool(placeTool(armed!));
    render();
  },
  unmount() {},
  isDone(ctx) {
    return ctx.draft.layout.openings.length > 0;
  },
};
