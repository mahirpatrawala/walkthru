// Owned by C3. The in-game HUD: room chip, round buttons, prompt pill, verdict card, mode bar, toast, hint,
// joystick ring, debug text. Plain DOM, text always via textContent (labels come from property.json).
import type { CheckCard, Tone } from '../types';
import type { Hud } from './context';
import type { JoystickView } from '../engine/controls';

export type HudButtonId = 'person' | 'measure' | 'furnish' | 'rooms' | 'scan';
export interface HudHandlers {
  person(): void; measure(): void; furnish(): void; rooms(): void; scan(): void;
}
export type ScanButtonState = 'hidden' | 'loading' | 'on' | 'off';

export interface HudImpl extends Hud {
  readonly root: HTMLElement;
  setActive(id: HudButtonId, on: boolean): void;
  setScanButton(state: ScanButtonState, progress?: number): void;
  setDebug(text: string | null): void;
  /** like toast, but longer and lower (the first-visit control hint) */
  hint(text: string, ms?: number): void;
  setJoystick(j: JoystickView | undefined): void;
  setVisible(v: boolean): void;
  dispose(): void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string, parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

const SVG = (inner: string): string =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const ICONS: Record<HudButtonId, string> = {
  person: SVG('<circle cx="12" cy="7.5" r="3.4"/><path d="M5 20.5c.6-4 3.4-6.2 7-6.2s6.4 2.2 7 6.2"/>'),
  measure: SVG('<path d="M3.5 16.5 16.5 3.5l4 4-13 13z"/><path d="m7.5 12.5 2 2M10.5 9.5l1.6 1.6M13.5 6.5l2 2"/>'),
  furnish: SVG('<path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11"/><path d="M3.5 12.5a2 2 0 0 1 4 0V15h9v-2.5a2 2 0 0 1 4 0V18h-17z"/><path d="M6 18v2M18 18v2"/>'),
  rooms: SVG('<path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20"/><circle cx="4.5" cy="6.5" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17.5" r="1"/>'),
  scan: SVG('<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M12 8.2 15.6 10v4L12 15.8 8.4 14v-4z"/>'),
};
const LABELS: Record<HudButtonId, string> = {
  person: 'Your height', measure: 'Measure', furnish: 'Furnish', rooms: 'Rooms', scan: 'Scan',
};

export function createHud(parent: HTMLElement, handlers: HudHandlers): HudImpl {
  const root = el('div', 'wt-hud', undefined, parent);
  root.dataset.testid = 'hud';

  // top left: room chip
  const chip = el('div', 'wt-chip', undefined, root);
  chip.dataset.testid = 'room-chip';
  chip.hidden = true;

  // top centre: mode bar + toast
  const top = el('div', 'wt-top', undefined, root);
  const modeBar = el('div', 'wt-modebar', undefined, top);
  modeBar.dataset.testid = 'mode-bar';
  modeBar.hidden = true;
  const modeText = el('span', 'wt-modebar-text', undefined, modeBar);
  const modeClose = el('button', 'wt-modebar-x', '×', modeBar);
  modeClose.type = 'button';
  modeClose.setAttribute('aria-label', 'Close');
  modeClose.dataset.ui = '1';
  const toastEl = el('div', 'wt-toast', undefined, top);
  toastEl.dataset.testid = 'toast';
  toastEl.hidden = true;

  // top right: buttons
  const bar = el('div', 'wt-buttons', undefined, root);
  const buttons = {} as Record<HudButtonId, HTMLButtonElement>;
  (['person', 'measure', 'furnish', 'rooms', 'scan'] as HudButtonId[]).forEach((id) => {
    const b = el('button', 'wt-btn', undefined, bar);
    b.type = 'button';
    b.dataset.ui = '1';
    b.dataset.btn = id;
    b.setAttribute('aria-label', LABELS[id]);
    b.title = LABELS[id];
    b.innerHTML = ICONS[id];
    if (id === 'scan') {
      b.hidden = true;
      const t = el('span', 'wt-btn-sub', 'Scan', b);
      t.dataset.role = 'scan-label';
    }
    b.addEventListener('click', (e) => { e.stopPropagation(); handlers[id](); b.blur(); });
    buttons[id] = b;
  });

  // bottom: card + pill stack, and the mount slot for a mode's own UI
  const stack = el('div', 'wt-stack', undefined, root);
  const card = el('div', 'wt-card', undefined, stack);
  card.dataset.testid = 'card';
  card.hidden = true;
  const cardTitle = el('div', 'wt-card-title', undefined, card);
  const cardHead = el('div', 'wt-card-head', undefined, card);
  const cardLines = el('div', 'wt-card-lines', undefined, card);
  const cardFoot = el('div', 'wt-card-foot', undefined, card);
  const pill = el('button', 'wt-pill', undefined, stack);
  pill.type = 'button';
  pill.dataset.ui = '1';
  pill.dataset.testid = 'prompt';
  pill.hidden = true;
  let onActivate: (() => void) | null = null;
  pill.addEventListener('click', (e) => { e.stopPropagation(); onActivate?.(); });

  const slot = el('div', 'wt-slot', undefined, root);
  slot.dataset.ui = '1';
  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => { root.style.setProperty('--wt-slot-h', `${slot.offsetHeight}px`); })
    : null;
  ro?.observe(slot);

  const hintEl = el('div', 'wt-hint', undefined, root);
  hintEl.hidden = true;
  const debugEl = el('pre', 'wt-debug', undefined, root);
  debugEl.hidden = true;
  const joyRing = el('div', 'wt-joy-ring', undefined, root);
  const joyKnob = el('div', 'wt-joy-knob', undefined, root);
  joyRing.hidden = joyKnob.hidden = true;

  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPrompt: string | null = null;
  let closeFn: (() => void) | null = null;
  modeClose.addEventListener('click', (e) => { e.stopPropagation(); closeFn?.(); });

  const hud: HudImpl = {
    root,
    setPrompt(text, cb) {
      onActivate = cb ?? null;
      if (text === lastPrompt) return;
      lastPrompt = text;
      if (text === null) { pill.hidden = true; return; }
      pill.textContent = text;
      pill.hidden = false;
    },
    showCard(c: CheckCard) {
      cardTitle.textContent = c.title;
      cardHead.textContent = c.headline;
      cardLines.replaceChildren(...c.lines.map((l) => el('div', 'wt-card-line', l)));
      cardFoot.textContent = c.footer ?? '';
      cardFoot.hidden = !c.footer;
      card.dataset.tone = c.tone satisfies Tone;
      card.hidden = false;
    },
    hideCard() {
      card.hidden = true;
    },
    setRoomChip(text) {
      if (text === null) { chip.hidden = true; return; }
      if (chip.textContent !== text) chip.textContent = text;
      chip.hidden = false;
    },
    setModeBar(text, onClose) {
      closeFn = onClose ?? null;
      if (text === null) { modeBar.hidden = true; return; }
      modeText.textContent = text;
      modeClose.hidden = !onClose;
      modeBar.hidden = false;
    },
    toast(text) {
      toastEl.textContent = text;
      toastEl.hidden = false;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
    },
    mount(node, slotName) {
      if (slotName !== 'bottom') throw new Error(`Hud.mount: unknown slot "${String(slotName)}"`);
      slot.appendChild(node);
      return () => { node.remove(); };
    },
    setActive(id, on) {
      buttons[id].classList.toggle('is-active', on);
      buttons[id].setAttribute('aria-pressed', on ? 'true' : 'false');
    },
    setScanButton(state, progress) {
      const b = buttons.scan;
      const label = b.querySelector('[data-role="scan-label"]');
      b.hidden = state === 'hidden';
      b.disabled = state === 'loading';
      b.classList.toggle('is-active', state === 'on');
      b.setAttribute('aria-pressed', state === 'on' ? 'true' : 'false');
      if (label) label.textContent = state === 'loading' ? `${Math.round((progress ?? 0) * 100)}%` : 'Scan';
    },
    setDebug(text) {
      if (text === null) { debugEl.hidden = true; return; }
      debugEl.textContent = text;
      debugEl.hidden = false;
    },
    hint(text, ms = 4000) {
      hintEl.textContent = text;
      hintEl.hidden = false;
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = setTimeout(() => { hintEl.hidden = true; }, ms);
    },
    setJoystick(j) {
      if (!j || !j.active) { joyRing.hidden = joyKnob.hidden = true; return; }
      joyRing.hidden = joyKnob.hidden = false;
      joyRing.style.left = `${j.originX}px`;
      joyRing.style.top = `${j.originY}px`;
      joyKnob.style.left = `${j.originX + j.x}px`;
      joyKnob.style.top = `${j.originY + j.y}px`;
    },
    setVisible(v) {
      root.style.display = v ? '' : 'none';
    },
    dispose() {
      ro?.disconnect();
      if (toastTimer) clearTimeout(toastTimer);
      if (hintTimer) clearTimeout(hintTimer);
      root.remove();
    },
  };
  return hud;
}
