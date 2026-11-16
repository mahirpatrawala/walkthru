// Owned by C3. The in-game HUD: room chip, round buttons, prompt pill, verdict card, mode bar, toast, hint,
// joystick ring, debug text. Plain DOM, text always via textContent (labels come from property.json).
import type { CheckCard, Tone } from '../types';
import type { Hud } from './context';
import type { JoystickView } from '../engine/controls';

export type HudButtonId = 'person' | 'measure' | 'furnish' | 'rooms' | 'scan';
export type HudView = 'third' | 'first';
export interface HudHandlers {
  person(): void; measure(): void; furnish(): void; rooms(): void; scan(): void;
  /** the secondary toggle: Third person / First person (Walk only) */
  view?(v: HudView): void;
  /** Share: copy a link that reopens this place and view */
  share?(): void;
}
/** The three views (src/buyer/views, another branch): `ctx.views`. Absent until that branch is merged; the bar then shows Walk only. */
export type ViewMode = 'walk' | 'doll' | 'plan';
export interface ViewsApi { mode(): ViewMode; set(m: ViewMode): void; onChange(cb: (m: ViewMode) => void): (() => void) | void }
export type ScanButtonState = 'hidden' | 'loading' | 'on' | 'off';

export interface HudImpl extends Hud {
  readonly root: HTMLElement;
  setActive(id: HudButtonId, on: boolean): void;
  setScanButton(state: ScanButtonState, progress?: number): void;
  /** the place's own name, the first line of the identity card ("Sample Tower, Level 2") */
  setPlace(text: string | null): void;
  /** which half of the first / third person toggle is lit */
  setView(v: HudView): void;
  /** wires the Walk / Doll house / Plan control to the views module; with none, only Walk is offered (and the control hides itself) */
  bindViews(api: ViewsApi | undefined): void;
  /** the Share button's feedback */
  readonly shareButton: HTMLButtonElement;
  /** clean view: the chrome steps away, one small way back stays (SPEC 2.7) */
  setClean(on: boolean): void;
  isClean(): boolean;
  /** the chrome fades on its own after a few seconds without input (presence.ts); any input brings it back */
  setIdle(on: boolean): void;
  /** the container a module puts its own tool in (it is decorated with a label and put in order) */
  readonly tools: HTMLElement;
  /** the corner slot top right ("Building" in a building, "All homes" in a lone home) */
  readonly exit: HTMLElement;
  setDebug(text: string | null): void;
  /** like toast, but longer and lower */
  hint(text: string, ms?: number): void;
  /** the first-visit controls: a few key-caps above the room strip, gone at the first input (or after 14 s) */
  showControlsHint(touch: boolean): void;
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
  person: 'You', measure: 'Measure', furnish: 'Furnish', rooms: 'Rooms', scan: 'Scan',
};
/** the accessible name where it says more than the short label */
const NAMES: Record<HudButtonId, string> = {
  person: 'Who is walking, and how tall', measure: 'Measure', furnish: 'Furnish', rooms: 'Rooms', scan: 'Scan',
};
const EXTRA_ICONS = {
  third: SVG('<circle cx="12" cy="6.5" r="2.8"/><path d="M6.5 20v-5.2A5.5 5.5 0 0 1 12 9.5a5.5 5.5 0 0 1 5.5 5.3V20"/>'),
  first: SVG('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  fullscreen: SVG('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  windowed: SVG('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  clean: SVG('<rect x="3.5" y="5" width="17" height="12" rx="2"/><path d="M8.5 20h7M12 17v3"/>'),
  back: SVG('<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/>'),
  place: SVG('<path d="M4 20V9.5L12 4l8 5.5V20z"/><path d="M10 20v-5h4v5"/>'),
  share: SVG('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  walk: SVG('<circle cx="13" cy="4.5" r="1.8"/><path d="M12 8.5l-2.5 4 3 2.5 .5 5M12 8.5l3 2.5 2.5 .5M9.5 12.5l-2 4"/>'),
  doll: SVG('<path d="M12 3.5 20 8v8l-8 4.5L4 16V8z"/><path d="M4 8l8 4.5L20 8M12 12.5v8"/>'),
  plan: SVG('<path d="M4 4h16v16H4z"/><path d="M4 12h7M11 4v8M15 12v8M11 16h4"/>'),
};
/** the order of the tools, left to right; anything a module adds that is not here goes last. Keys are the short labels. */
const TOOL_ORDER = ['Tour', 'Flats', 'Rooms', 'Measure', 'Furnish', 'Light', 'You', 'Scan', 'Clean view', 'Fullscreen'];
/** short labels for buttons other modules add (their accessible names stay as they are) */
const SHORT_LABEL: Record<string, string> = { 'Light and look': 'Light', 'Building map': 'Building', 'Take a tour of this home, room by room': 'Tour' };
const LABELS_KEY = 'walkthru:hud:labels-seen';

/**
 * Whether a drag on the card throws it away, and which way it leaves: far enough (30% of its width sideways, 45% of its height
 * down) or a quick flick of at least 24 px. Upward drags never dismiss. dx, dy in px (dy >= 0 is down), dt in ms.
 */
export function swipeOutcome(dx: number, dy: number, dt: number, width: number, height: number): { x: -1 | 0 | 1; y: 0 | 1 } | null {
  const down = Math.max(0, dy);
  const far = Math.abs(dx) > width * 0.3 || down > height * 0.45;
  const fast = Math.hypot(dx, down) / Math.max(1, dt) > 0.6 && (Math.abs(dx) > 24 || down > 24);
  if (!far && !fast) return null;
  return Math.abs(dx) > down ? { x: dx < 0 ? -1 : 1, y: 0 } : { x: 0, y: 1 };
}

export function createHud(parent: HTMLElement, handlers: HudHandlers): HudImpl {
  const root = el('div', 'wt-hud', undefined, parent);
  root.dataset.testid = 'hud';

  // top left: the identity card. Line 1 the place, line 2 where you stand (room and area), line 3 the quiet note (scene-tag.ts)
  const id = el('div', 'wt-id wt-glass', undefined, root);
  id.dataset.testid = 'identity';
  const idIcon = el('span', 'wt-id-icon', undefined, id);
  idIcon.innerHTML = EXTRA_ICONS.place;
  const idText = el('div', 'wt-id-text', undefined, id);
  const place = el('div', 'wt-id-place', undefined, idText);
  place.dataset.testid = 'place';
  place.hidden = true;
  const chip = el('div', 'wt-chip', undefined, idText);
  chip.dataset.testid = 'room-chip';
  chip.hidden = true;
  const shareBtn = el('button', 'wt-id-share', undefined, id);
  shareBtn.type = 'button';
  shareBtn.dataset.ui = '1';
  shareBtn.dataset.testid = 'share';
  shareBtn.title = 'Copy a link to this place and view';
  shareBtn.setAttribute('aria-label', 'Share: copy a link to this place and view');
  shareBtn.innerHTML = EXTRA_ICONS.share;
  el('span', 'wt-tool-label', 'Share', shareBtn);
  shareBtn.addEventListener('click', (e) => { e.stopPropagation(); handlers.share?.(); shareBtn.blur(); });

  // top centre: the view control and the tools, one glass bar (a column down the right edge on a phone)
  const topbar = el('div', 'wt-topbar', undefined, root);
  // the three views (Walk, Doll house, Plan): shown once the views module is there; until then Walk is the only one, so the control hides
  const seg = el('div', 'wt-seg wt-views wt-glass', undefined, topbar);
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'View');
  seg.hidden = true;
  const modeBtns = {} as Record<ViewMode, HTMLButtonElement>;
  (['walk', 'doll', 'plan'] as ViewMode[]).forEach((m) => {
    const label = m === 'walk' ? 'Walk' : m === 'doll' ? 'Doll house' : 'Plan';
    const b = el('button', 'wt-seg-btn', undefined, seg);
    b.type = 'button'; b.dataset.ui = '1'; b.dataset.mode = m;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', m === 'walk' ? 'true' : 'false');
    b.innerHTML = EXTRA_ICONS[m];
    el('span', 'wt-tool-label', label, b);
    b.classList.toggle('is-on', m === 'walk');
    modeBtns[m] = b;
  });
  // the secondary toggle, Walk only: look at yourself or through your own eyes
  const eye = el('div', 'wt-seg wt-eye wt-glass', undefined, topbar);
  eye.setAttribute('role', 'group');
  eye.setAttribute('aria-label', 'Camera');
  const segBtns = {} as Record<HudView, HTMLButtonElement>;
  (['third', 'first'] as HudView[]).forEach((v) => {
    const label = v === 'third' ? 'Third person' : 'First person';
    const b = el('button', 'wt-seg-btn', undefined, eye);
    b.type = 'button';
    b.dataset.ui = '1';
    b.dataset.view = v;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', v === 'third' ? 'true' : 'false');
    b.innerHTML = EXTRA_ICONS[v];
    el('span', 'wt-tool-label', label, b);
    b.addEventListener('click', (e) => { e.stopPropagation(); handlers.view?.(v); b.blur(); });
    segBtns[v] = b;
  });
  segBtns.third.classList.add('is-on');
  let viewsOff: (() => void) | void = undefined;
  const syncViews = (m: ViewMode): void => {
    for (const k of ['walk', 'doll', 'plan'] as ViewMode[]) { modeBtns[k].classList.toggle('is-on', k === m); modeBtns[k].setAttribute('aria-pressed', k === m ? 'true' : 'false'); }
    eye.hidden = m !== 'walk';
  };
  const bar = el('div', 'wt-buttons wt-tools wt-glass', undefined, topbar);
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Tools');
  bar.dataset.testid = 'tools';
  const buttons = {} as Record<HudButtonId, HTMLButtonElement>;
  (['rooms', 'measure', 'furnish', 'person', 'scan'] as HudButtonId[]).forEach((bid) => {
    const b = el('button', 'wt-btn wt-tool', undefined, bar);
    b.type = 'button';
    b.dataset.ui = '1';
    b.dataset.btn = bid;
    b.setAttribute('aria-label', NAMES[bid]);
    b.title = NAMES[bid];
    b.innerHTML = ICONS[bid];
    el('span', 'wt-tool-label', LABELS[bid], b);
    if (bid === 'scan') {
      b.hidden = true;
      const t = el('span', 'wt-btn-sub', 'Scan', b);
      t.dataset.role = 'scan-label';
    }
    b.addEventListener('click', (e) => { e.stopPropagation(); handlers[bid](); b.blur(); });
    buttons[bid] = b;
  });
  // clean view and full screen: always last, handled here
  let clean = false;
  const cleanBtn = el('button', 'wt-btn wt-tool', undefined, bar);
  cleanBtn.type = 'button'; cleanBtn.dataset.ui = '1'; cleanBtn.dataset.btn = 'clean';
  cleanBtn.setAttribute('aria-label', 'Clean view: hide the controls'); cleanBtn.title = 'Clean view: hide the controls';
  cleanBtn.innerHTML = EXTRA_ICONS.clean;
  el('span', 'wt-tool-label', 'Clean view', cleanBtn);
  const fsBtn = el('button', 'wt-btn wt-tool', undefined, bar);
  fsBtn.type = 'button'; fsBtn.dataset.ui = '1'; fsBtn.dataset.btn = 'fullscreen';
  fsBtn.setAttribute('aria-label', 'Full screen'); fsBtn.title = 'Full screen';
  fsBtn.innerHTML = EXTRA_ICONS.fullscreen;
  const fsLabel = el('span', 'wt-tool-label', 'Fullscreen', fsBtn);
  const fsApi = (): { can: boolean; on: boolean } => {
    const d = document as Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean };
    return { can: !!(document.fullscreenEnabled || d.webkitFullscreenEnabled), on: !!(document.fullscreenElement || d.webkitFullscreenElement) };
  };
  const syncFs = (): void => {
    const { can, on } = fsApi();
    fsBtn.hidden = !can;
    fsBtn.innerHTML = on ? EXTRA_ICONS.windowed : EXTRA_ICONS.fullscreen;
    fsLabel.textContent = on ? 'Exit full screen' : 'Fullscreen';
    fsBtn.appendChild(fsLabel);
    fsBtn.setAttribute('aria-label', on ? 'Leave full screen' : 'Full screen');
    fsBtn.title = on ? 'Leave full screen' : 'Full screen';
    fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  fsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const d = document as Document & { webkitExitFullscreen?: () => void };
    const r = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      if (fsApi().on) (document.exitFullscreen ?? d.webkitExitFullscreen)?.call(document);
      else (r.requestFullscreen ?? r.webkitRequestFullscreen)?.call(r);
    } catch { /* a browser that refuses: the button does nothing */ }
    fsBtn.blur();
  });
  document.addEventListener('fullscreenchange', syncFs);
  syncFs();

  // top right: the way back to where you came from ("Building", or "All homes" for a lone home): a module puts its link here
  const exit = el('div', 'wt-exit', undefined, root);
  exit.dataset.testid = 'exit';
  // clean view: the one small way back
  const cleanBack = el('button', 'wt-clean-back wt-glass', undefined, root);
  cleanBack.type = 'button'; cleanBack.dataset.ui = '1'; cleanBack.dataset.testid = 'clean-back';
  cleanBack.setAttribute('aria-label', 'Show the controls');
  cleanBack.innerHTML = EXTRA_ICONS.back;
  el('span', 'wt-tool-label', 'Controls', cleanBack);
  cleanBack.hidden = true;

  // mode bar and toast: centred under the bar
  const top = el('div', 'wt-top', undefined, root);
  const modeBar = el('div', 'wt-modebar wt-glass', undefined, top);
  modeBar.dataset.testid = 'mode-bar';
  modeBar.hidden = true;
  const modeText = el('span', 'wt-modebar-text', undefined, modeBar);
  const modeClose = el('button', 'wt-modebar-x', '×', modeBar);
  modeClose.type = 'button';
  modeClose.setAttribute('aria-label', 'Close');
  modeClose.dataset.ui = '1';
  const toastEl = el('div', 'wt-toast wt-glass', undefined, top);
  toastEl.dataset.testid = 'toast';
  toastEl.setAttribute('role', 'status');
  toastEl.hidden = true;

  // every tool, whoever adds it, gets a short label and its place in the order (a button another module appends is decorated here)
  const rankOf = (b: HTMLElement): number => {
    const l = b.querySelector('.wt-tool-label')?.textContent ?? '';
    const i = TOOL_ORDER.indexOf(l);
    return i < 0 ? TOOL_ORDER.length : i;
  };
  let sorting = false;
  const decorate = (): void => {
    if (sorting) return;
    sorting = true;
    const kids = [...bar.children] as HTMLElement[];
    for (const b of kids) {
      if (!(b instanceof HTMLButtonElement || b instanceof HTMLAnchorElement)) continue;
      b.classList.add('wt-tool');
      if (!b.querySelector('.wt-tool-label')) {
        const name = b.getAttribute('aria-label') ?? b.title ?? '';
        const sub = b.querySelector('.wt-btn-sub');
        if (sub && b.dataset.btn !== 'scan') sub.remove();
        el('span', 'wt-tool-label', SHORT_LABEL[name] ?? name, b);
      }
    }
    const sorted = kids.slice().sort((x, y) => rankOf(x) - rankOf(y));
    if (sorted.some((k, i) => k !== kids[i])) for (const k of sorted) bar.appendChild(k);
    sorting = false;
  };
  const toolsObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(decorate) : null;
  toolsObserver?.observe(bar, { childList: true });
  decorate();
  // first visit: on a phone the tools are icons, so show their names for a few seconds once
  {
    let seen = true;
    try { seen = localStorage.getItem(LABELS_KEY) === '1'; } catch { /* no storage: skip the hint */ }
    if (!seen) {
      bar.classList.add('is-labelled');
      setTimeout(() => bar.classList.remove('is-labelled'), 7000);
      try { localStorage.setItem(LABELS_KEY, '1'); } catch { /* ignore */ }
    }
  }

  // bottom: card + pill stack, and the mount slot for a mode's own UI
  const stack = el('div', 'wt-stack', undefined, root);
  const card = el('div', 'wt-card wt-glass', undefined, stack);
  card.dataset.testid = 'card';
  card.hidden = true;
  const cardTitle = el('div', 'wt-card-title', undefined, card);
  const cardHead = el('div', 'wt-card-head', undefined, card);
  const cardLines = el('div', 'wt-card-lines', undefined, card);
  const cardFoot = el('div', 'wt-card-foot', undefined, card);
  // the card can be swiped away (left, right or down) or closed with its button; the same card stays away until it is hidden
  // by its owner (standing up, walking off), so getting on the bed again shows it afresh
  const cardClose = el('button', 'wt-card-close', '×', card);
  cardClose.type = 'button';
  cardClose.setAttribute('aria-label', 'Close');
  let cardSig = '';
  let dismissedSig: string | null = null;
  const dismissCard = (dx = 0, dy = 1): void => {
    dismissedSig = cardSig;
    card.style.transition = 'transform 160ms ease-in, opacity 160ms ease-in';
    card.style.transform = `translate(${dx * 120}%, ${dy * 140}%)`;
    card.style.opacity = '0';
    setTimeout(() => { card.hidden = true; card.style.transition = ''; card.style.transform = ''; card.style.opacity = ''; }, 170);
  };
  cardClose.addEventListener('click', (e) => { e.stopPropagation(); dismissCard(); });
  {
    let id = -1, x0 = 0, y0 = 0, dx = 0, dy = 0, t0 = 0;
    const end = (cancel: boolean): void => {
      if (id < 0) return;
      id = -1;
      const out = cancel ? null : swipeOutcome(dx, dy, Math.max(1, performance.now() - t0), card.offsetWidth, card.offsetHeight);
      if (out) dismissCard(out.x, out.y);
      else { card.style.transition = 'transform 140ms ease-out, opacity 140ms ease-out'; card.style.transform = ''; card.style.opacity = ''; setTimeout(() => { card.style.transition = ''; }, 150); }
    };
    card.addEventListener('pointerdown', (e) => {
      if (e.target === cardClose || (e.pointerType === 'mouse' && e.button !== 0)) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = dy = 0; t0 = performance.now();
      try { card.setPointerCapture(id); } catch { /* a synthetic pointer has nothing to capture */ }
      e.stopPropagation();
    });
    card.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      dx = e.clientX - x0; dy = Math.max(0, e.clientY - y0);
      const horizontal = Math.abs(dx) > dy;
      card.style.transform = horizontal ? `translateX(${dx}px)` : `translateY(${dy}px)`;
      card.style.opacity = String(Math.max(0.25, 1 - (horizontal ? Math.abs(dx) / card.offsetWidth : dy / (card.offsetHeight * 1.2))));
      e.stopPropagation();
    });
    card.addEventListener('pointerup', (e) => { if (e.pointerId === id) end(false); });
    card.addEventListener('pointercancel', (e) => { if (e.pointerId === id) end(true); });
  }
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

  const hintEl = el('div', 'wt-hint wt-glass', undefined, root);
  hintEl.setAttribute('role', 'status');
  hintEl.hidden = true;
  const chipsEl = el('div', 'wt-hint-chips', undefined, root);
  chipsEl.hidden = true;
  let chipsTimer: ReturnType<typeof setTimeout> | null = null;
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

  const setClean = (on: boolean): void => {
    clean = on;
    root.classList.toggle('is-clean', on);
    cleanBack.hidden = !on;
    cleanBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  cleanBtn.addEventListener('click', (e) => { e.stopPropagation(); setClean(true); cleanBtn.blur(); });
  cleanBack.addEventListener('click', (e) => { e.stopPropagation(); setClean(false); });

  const hud: HudImpl = {
    root,
    tools: bar,
    exit,
    setPlace(text) {
      place.hidden = text === null || text === '';
      if (text !== null && place.textContent !== text) place.textContent = text;
    },
    setView(v) {
      for (const k of ['third', 'first'] as HudView[]) {
        segBtns[k].classList.toggle('is-on', k === v);
        segBtns[k].setAttribute('aria-pressed', k === v ? 'true' : 'false');
      }
    },
    bindViews(api) {
      if (typeof viewsOff === 'function') viewsOff();
      viewsOff = undefined;
      seg.hidden = !api;
      if (!api) { eye.hidden = false; return; }
      for (const m of ['walk', 'doll', 'plan'] as ViewMode[]) modeBtns[m].onclick = (e) => { e.stopPropagation(); api.set(m); modeBtns[m].blur(); };
      syncViews(api.mode());
      viewsOff = api.onChange(syncViews);
    },
    shareButton: shareBtn,
    setClean,
    isClean: () => clean,
    setIdle(on) { root.classList.toggle('is-idle', on); },
    setPrompt(text, cb) {
      onActivate = cb ?? null;
      if (text === lastPrompt) return;
      lastPrompt = text;
      if (text === null) { pill.hidden = true; return; }
      pill.textContent = text;
      pill.dataset.key = 'E';
      pill.hidden = false;
    },
    showCard(c: CheckCard) {
      cardTitle.textContent = c.title;
      cardHead.textContent = c.headline;
      cardLines.replaceChildren(...c.lines.map((l) => el('div', 'wt-card-line', l)));
      cardFoot.textContent = c.footer ?? '';
      cardFoot.hidden = !c.footer;
      card.dataset.tone = c.tone satisfies Tone;
      cardSig = [c.title, c.headline, ...c.lines, c.footer ?? ''].join('\n');
      if (cardSig === dismissedSig) return; // swiped away: stays away until its owner hides it
      dismissedSig = null;
      card.hidden = false;
    },
    hideCard() {
      card.hidden = true;
      dismissedSig = null;
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
    showControlsHint(touch) {
      chipsEl.replaceChildren();
      const items: [string, string][] = touch
        ? [['Left thumb', 'walk'], ['Right thumb', 'look around'], ['Tap a door', 'to go through']]
        : [['W A S D', 'walk'], ['Drag', 'look around'], ['E', 'open a door or sit'], ['Click a door', 'to go through']];
      for (const [k, t] of items) {
        const c = el('div', 'wt-hint-chip wt-glass', undefined, chipsEl);
        el('b', undefined, k, c);
        el('span', undefined, t, c);
      }
      chipsEl.hidden = false;
      const off = (): void => {
        chipsEl.hidden = true;
        window.removeEventListener('keydown', off, true);
        window.removeEventListener('pointerdown', off, true);
        if (chipsTimer) clearTimeout(chipsTimer);
      };
      window.addEventListener('keydown', off, true);
      window.addEventListener('pointerdown', off, true);
      if (chipsTimer) clearTimeout(chipsTimer);
      chipsTimer = setTimeout(off, 14000);
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
      toolsObserver?.disconnect();
      if (typeof viewsOff === 'function') viewsOff();
      document.removeEventListener('fullscreenchange', syncFs);
      if (toastTimer) clearTimeout(toastTimer);
      if (hintTimer) clearTimeout(hintTimer);
      if (chipsTimer) clearTimeout(chipsTimer);
      root.remove();
    },
  };
  return hud;
}
