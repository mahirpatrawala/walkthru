// "Materials": the realistic-materials choice (Off, 1K, 2K; SPEC 16.21) as a tool of its own in the top bar, so it is found where the other tools are.
// The state lives in the look (look.realism, look.setRealism, look.onChange) and nowhere else: this popover and the row in the Light sheet are two views
// of it and cannot disagree. The button wears the level as a small badge and a pulse while texture sets download. It is part of the chrome: it sits in
// the top row, so it comes in with the top edge and stays while its popover is open (the popover counts as a sheet for chrome.ts).
import { REALISM_CHOICE, REALISM_LABEL, REALISM_LEVELS, REALISM_NOTE } from '../look/realistic';
import type { RealismLevel } from '../look/realistic';
import type { Look } from '../look/look';

const ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M10 4.5 11.6 9l4.4 1.6-4.4 1.6L10 16.7 8.4 12.2 4 10.6 8.4 9z"/><path d="M18 3.5v3M16.5 5h3M18.5 15.5v4M16.5 17.5h4"/></svg>';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** What the badge and the note say for a choice and what is drawn: "2K" chosen but drawn as 1K (the governor, a slow device) reads "1K". Pure, tested. */
export function materialsBadge(chosen: RealismLevel, effective: RealismLevel): { text: string; kept: boolean } {
  if (chosen === 'off') return { text: REALISM_CHOICE.off, kept: false };
  return { text: REALISM_CHOICE[effective], kept: effective !== chosen };
}

export function mountMaterialsTool(root: HTMLElement, tools: HTMLElement, look: Look): () => void {
  const btn = h('button', 'wt-btn wt-tool wt-mat-btn', undefined, tools);
  btn.type = 'button';
  btn.dataset.ui = '1';
  btn.dataset.btn = 'materials';
  btn.dataset.testid = 'materials-btn';
  btn.dataset.tip = REALISM_LABEL;
  btn.setAttribute('aria-label', REALISM_LABEL);
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = ICON;
  const badge = h('span', 'wt-mat-badge', undefined, btn);
  badge.dataset.testid = 'materials-badge';
  h('span', 'wt-tool-label', 'Materials', btn);

  const pop = h('div', 'wt-mat-pop', undefined, root);
  pop.dataset.ui = '1';
  pop.dataset.testid = 'materials-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', REALISM_LABEL);
  pop.hidden = true;
  const head = h('div', 'wt-mat-head', undefined, pop);
  h('b', undefined, REALISM_LABEL, head);
  const state = h('span', 'wt-mat-state', '', head);
  const seg = h('div', 'wt-look-seg wt-mat-seg', undefined, pop);
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', REALISM_LABEL);
  seg.dataset.testid = 'materials-seg';
  const levels = new Map<RealismLevel, HTMLButtonElement>();
  for (const lv of REALISM_LEVELS) {
    const b = h('button', 'wt-look-seg-b', REALISM_CHOICE[lv], seg);
    b.type = 'button';
    b.dataset.realism = lv;
    b.addEventListener('click', (e) => { e.stopPropagation(); look.setRealism(lv); sync(); b.blur(); });
    levels.set(lv, b);
  }
  const note = h('p', 'wt-look-note wt-mat-note', '', pop);
  note.dataset.testid = 'materials-note';
  const bar = h('div', 'wt-mat-progress', undefined, pop);
  bar.dataset.testid = 'materials-progress';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Loading the texture sets');
  const fill = h('i', undefined, undefined, bar);

  const sync = (): void => {
    const chosen = look.realism, eff = look.realismEffective;
    const b = materialsBadge(chosen, eff);
    badge.textContent = b.text;
    badge.classList.toggle('is-off', chosen === 'off');
    btn.dataset.level = chosen;
    btn.setAttribute('aria-label', `${REALISM_LABEL}: ${b.text}${b.kept ? ' (kept smooth on this device)' : ''}`);
    for (const [lv, el] of levels) { const on = lv === chosen; el.classList.toggle('is-on', on); el.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    const rp = look.realismProgress();
    const loading = chosen !== 'off' && rp.total > 0 && rp.done < rp.total;
    btn.classList.toggle('is-loading', loading);
    bar.hidden = !loading;
    const pct = rp.total ? Math.round((100 * rp.done) / rp.total) : 0;
    fill.style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', String(pct));
    state.textContent = loading ? `Loading ${pct}%` : b.kept ? `${b.text}, kept smooth` : '';
    note.textContent = REALISM_NOTE[chosen];
  };
  const place = (): void => {
    // under the button, right edges level, kept inside the window (a phone uses the bottom sheet of the CSS)
    const r = btn.getBoundingClientRect(), z = Number(getComputedStyle(document.documentElement).getPropertyValue('--wt-z')) || 1;
    const w = pop.offsetWidth * z || 300;
    const right = Math.max(12, window.innerWidth - Math.min(window.innerWidth - 12, Math.max(r.right, w + 12)));
    pop.style.top = `${Math.round(r.bottom + 10)}px`;
    pop.style.right = `${Math.round(right)}px`;
  };
  const setOpen = (on: boolean): void => {
    pop.hidden = !on;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) { sync(); place(); }
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(pop.hidden === true); btn.blur(); });
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); setOpen(false); } };
  const onPress = (e: Event): void => { if (!pop.hidden && e.target instanceof Node && !pop.contains(e.target) && !btn.contains(e.target)) setOpen(false); };
  const onResize = (): void => { if (!pop.hidden) place(); };
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('pointerdown', onPress, true);
  window.addEventListener('resize', onResize);
  const off = look.onChange(() => { sync(); });
  sync();
  return () => {
    off();
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onPress, true);
    window.removeEventListener('resize', onResize);
    btn.remove();
    pop.remove();
  };
}
