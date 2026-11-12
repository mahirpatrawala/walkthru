// Owned by C5. E2 Scale (SPEC 2.2): click the two ends of a printed dimension on the plan, type it; do it twice.
import type { Px } from '../../types';
import { parseLength } from '../../core/units';
import { pxToWorld, scaleFromDimensions, worldToPx } from '../../core/plan-scale';
import type { EditorContext, EditorStep, PlanTool } from '../context';
import { asHost } from '../context';
import { clear, h } from '../dom';
import { rescaleDraft } from '../plan-helpers';

export const INDIAN_STANDARDS_HINT =
  'No dimensions? Use Indian standards. Door frame height 2.1 m. Main door 0.90 m wide, bedroom door 0.80 m, bathroom door 0.75 m. ' +
  'Floor tiles are 600 × 600, 800 × 800 or 600 × 1200 mm: count them.';

/** The sentence under the dimension list. Exact wording is in SPEC 2.2 E2. */
export function scaleMessage(count: number, pxPerM: number, disagreementPct: number): { text: string; bad: boolean } {
  const base = `${pxPerM.toFixed(1)} px per metre.`;
  if (count === 0) return { text: 'Not set yet.', bad: false };
  if (count === 1) return { text: `${base} Add a second dimension, ideally across the other way, to check it.`, bad: false };
  if (disagreementPct > 3) {
    return { text: `These two disagree by ${disagreementPct.toFixed(1)}%. Check what you typed, or the plan image may be stretched.`, bad: true };
  }
  return { text: `${base} The ${count === 2 ? 'two' : count} dimensions agree within ${disagreementPct.toFixed(1)}%.`, bad: false };
}

/**
 * Adds or removes dimensions and re-derives the plan scale. Rooms, openings, furniture and the spawn point stay glued to the
 * image by rescaling about the world origin (the image centre). Returns the new state, or null when there is no plan.
 */
export function setDimensions(ctx: EditorContext, dims: { a: Px; b: Px; lengthM: number }[]): { pxPerM: number; disagreementPct: number } | null {
  const u = ctx.draft.layout.underlay;
  if (!u) return null;
  const { pxPerM, disagreementPct } = scaleFromDimensions(dims);
  if (pxPerM > 0) {
    rescaleDraft(ctx.draft, u.pxPerM / pxPerM);
    u.pxPerM = pxPerM;
  }
  u.dimensions = dims;
  u.disagreementPct = disagreementPct;
  ctx.draft.layout.scaleSource = 'plan-dimensions';
  asHost(ctx).applyUnderlay();
  ctx.commit();
  return { pxPerM: u.pxPerM, disagreementPct };
}

let removeLayer: (() => void) | null = null;
let activeTool: PlanTool | null = null;

export const step: EditorStep = {
  id: 'scale',
  title: 'Scale',
  mount(panel, ctx) {
    panel.className = 'panel-body step-scale';
    const hint = h('div', { class: 'hint', text: INDIAN_STANDARDS_HINT });
    const u0 = ctx.draft.layout.underlay;
    if (!u0) {
      clear(panel);
      panel.append(
        h('p', { text: 'No floor plan image, so there is nothing to scale. The plan canvas is a blank metric grid: big squares are 1 m, small ones 0.5 m. Go to Rooms and draw.' }),
        hint,
      );
      return;
    }

    let picked: Px[] = [];
    let hover: Px | null = null;
    const msg = h('p', { class: 'small' });
    const list = h('ul', { class: 'dimlist' });
    const lengthInput = h('input', { type: 'text', placeholder: `13'1"   4 m   400 cm   4000 mm   4.0`, autocomplete: 'off', spellcheck: false });
    const err = h('p', { class: 'err small' });
    const addBtn = h('button', { class: 'btn primary', text: 'Add dimension' });
    const form = h('div', { class: 'form' },
      h('label', { class: 'field' }, h('span', { text: 'Length printed on the plan' }), lengthInput),
      addBtn,
    );
    const status = h('p', { class: 'muted small' });

    const underlay = () => ctx.draft.layout.underlay!;

    const render = (): void => {
      const u = underlay();
      clear(list);
      u.dimensions.forEach((d, i) => {
        const px = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
        list.append(h('li', {},
          h('span', { text: `${i + 1}. ${d.lengthM.toFixed(3)} m over ${px.toFixed(0)} px` }),
          h('button', { class: 'btn small', text: 'Remove', onclick: () => {
            const next = u.dimensions.filter((_, k) => k !== i);
            setDimensions(ctx, next);
            render();
          } }),
        ));
      });
      const m = scaleMessage(u.dimensions.length, u.pxPerM, u.disagreementPct);
      msg.textContent = m.text;
      msg.className = m.bad ? 'err small' : 'small';
      form.style.display = picked.length === 2 ? 'block' : 'none';
      status.textContent = picked.length === 0
        ? 'Click one end of a dimension printed on the plan.'
        : picked.length === 1 ? 'Now click the other end.' : 'Now type its length.';
      ctx.plan.refresh();
    };

    const commitDimension = (): void => {
      err.textContent = '';
      if (picked.length !== 2) return;
      const len = parseLength(lengthInput.value);
      if (len === null) { err.textContent = 'Could not read that length. Try 13\'1", 4 m, 400 cm, 4000 mm or 4.0.'; return; }
      const u = underlay();
      if (Math.hypot(picked[1].x - picked[0].x, picked[1].y - picked[0].y) < 4) { err.textContent = 'Those two points are too close together.'; return; }
      setDimensions(ctx, [...u.dimensions, { a: picked[0], b: picked[1], lengthM: len }]);
      picked = [];
      lengthInput.value = '';
      render();
    };
    addBtn.addEventListener('click', commitDimension);
    lengthInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitDimension(); });

    const tool: PlanTool = {
      cursor: 'crosshair',
      onDown(w) {
        const u = underlay();
        if (picked.length >= 2) picked = [];
        picked.push(worldToPx(w, u));
        err.textContent = '';
        render();
        if (picked.length === 2) lengthInput.focus();
      },
      onMove(w) { hover = worldToPx(w, underlay()); },
      onKey(e) { if (e.key === 'Escape') { picked = []; render(); } },
      cancel() { picked = []; },
      draw(g, c) {
        const u = underlay();
        const toS = (p: Px): Px => c.worldToScreen(pxToWorld(p, u));
        const pts = [...picked];
        g.lineWidth = 2;
        g.strokeStyle = '#d97706';
        g.fillStyle = '#d97706';
        if (pts.length === 1 && hover) {
          const a = toS(pts[0]);
          const b = toS(hover);
          g.setLineDash([5, 4]);
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
          g.setLineDash([]);
        }
        if (pts.length === 2) {
          const a = toS(pts[0]);
          const b = toS(pts[1]);
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        }
        for (const p of pts) { const s = toS(p); g.beginPath(); g.arc(s.x, s.y, 4.5, 0, Math.PI * 2); g.fill(); }
      },
    };
    activeTool = tool;
    ctx.plan.setTool(tool);

    // the dimensions already typed stay visible
    removeLayer?.();
    removeLayer = ctx.plan.addLayer((g, c) => {
      const u = ctx.draft.layout.underlay;
      if (!u) return;
      g.lineWidth = 2;
      g.strokeStyle = '#2563eb';
      g.fillStyle = '#2563eb';
      g.font = '600 11px system-ui, sans-serif';
      g.textAlign = 'center';
      u.dimensions.forEach((d, i) => {
        const a = c.worldToScreen(pxToWorld(d.a, u));
        const b = c.worldToScreen(pxToWorld(d.b, u));
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        for (const s of [a, b]) { g.beginPath(); g.arc(s.x, s.y, 3.5, 0, Math.PI * 2); g.fill(); }
        g.fillText(`${i + 1}: ${d.lengthM.toFixed(2)} m`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 8);
      });
    });

    clear(panel);
    panel.append(
      h('p', { text: 'Click the two ends of a dimension printed on the plan, then type it. Do it twice, ideally one across and one down.' }),
      status, form, err, h('h3', { text: 'Dimensions' }), list, msg, hint,
    );
    render();
  },
  unmount() {
    removeLayer?.();
    removeLayer = null;
    activeTool = null;
  },
  isDone(ctx) {
    const u = ctx.draft.layout.underlay;
    return !u || u.dimensions.length >= 1;
  },
};

/** For automation: the tool of the mounted step. */
export function currentScaleTool(): PlanTool | null {
  return activeTool;
}
