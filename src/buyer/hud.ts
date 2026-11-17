// Owned by C3. The in-game HUD: room chip, round buttons, prompt pill, verdict card, mode bar, toast, hint,
// joystick ring, debug text. Plain DOM, text always via textContent (labels come from property.json).
import type { CheckCard, Tone } from '../types';
import { CREDIT_TEXT, brandMarkEl } from '../brand/builder-brand';
import type { ShownBrand } from '../brand/builder-brand';
import type { Hud } from './context';
import type { JoystickView } from '../engine/controls';
import { CHROME_LEVEL_LABEL, nextChromeLevel } from './chrome';
import type { ChromeFlags, ChromeLevel } from './chrome';
import { UNITS_EVENT, UNITS_KEY, identityLines, loadUnits } from './identity';
import type { AreaUnits } from './identity';

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
export type ViewsMode = 'walk' | 'doll' | 'plan';
export interface ViewsApi { mode(): ViewsMode; set(m: ViewsMode): void; onChange(cb: (m: ViewsMode) => void): (() => void) | void }
export type ScanButtonState = 'hidden' | 'loading' | 'on' | 'off';

export interface HudImpl extends Hud {
  readonly root: HTMLElement;
  setActive(id: HudButtonId, on: boolean): void;
  setScanButton(state: ScanButtonState, progress?: number): void;
  /** the place's own name ("Flat 204 · 3 BHK · 1,117 sq ft") and, in a building, its level ("Level 2"): the pill says the first two parts, the card the rest */
  setPlace(text: string | null, level?: string | null): void;
  /** a builder's brand on this building: its logo where the generic icon was, its name over the place, and the small credit (SPEC 18.15) */
  setBrand(brand: ShownBrand | null): void;
  /** which half of the first / third person toggle is lit */
  setView(v: HudView): void;
  /** wires the Walk / Doll house / Plan control to the views module; with none, only Walk is offered (and the control hides itself) */
  bindViews(api: ViewsApi | undefined): void;
  /** the Share button's feedback */
  readonly shareButton: HTMLButtonElement;
  /** calm by default (SPEC 2.7, src/buyer/chrome.ts): which parts of the chrome are in, and the level in force */
  setChrome(f: ChromeFlags, level: ChromeLevel): void;
  /** the handle (the thin pill at the top centre) was pressed */
  onHandle(cb: () => void): void;
  /** the Controls tool asks for the next level */
  onChromeLevel(cb: (next: ChromeLevel) => void): void;
  /** called once, the first time the chrome is shown to the viewer */
  onShown(cb: () => void): void;
  /** a warning that must be seen once (a sample scene, a size that is not measured): its own brief pill under the top row. The same words are not shown twice in a visit. */
  notice(text: string, ms?: number): void;
  /** the unit areas are shown in */
  units(): AreaUnits;
  /** the container a module puts its own tool in (it is decorated with a label and put in order) */
  readonly tools: HTMLElement;
  /** the corner slot top right ("Building" in a building, "All homes" in a lone home) */
  readonly exit: HTMLElement;
  setDebug(text: string | null): void;
  /** like toast, but longer and lower */
  hint(text: string, ms?: number): void;
  /** the first-visit controls: a few key-caps above the room strip, gone at the first input (or with the first visit's few seconds) */
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
  auto: SVG('<rect x="3.5" y="5" width="17" height="12" rx="3"/><path d="M8 9h8" stroke-dasharray="1.5 2.6"/><path d="M8.5 20h7"/>'),
  always: SVG('<rect x="3.5" y="5" width="17" height="12" rx="3"/><path d="M7 9h10M7 13h6"/><path d="M8.5 20h7"/>'),
  hidden: SVG('<rect x="3.5" y="5" width="17" height="12" rx="3"/><path d="M8.5 20h7"/>'),
  walk: SVG('<circle cx="13" cy="4.5" r="1.8"/><path d="M12 8.5l-2.5 4 3 2.5 .5 5M12 8.5l3 2.5 2.5 .5M9.5 12.5l-2 4"/>'),
  doll: SVG('<path d="M12 3.5 20 8v8l-8 4.5L4 16V8z"/><path d="M4 8l8 4.5L20 8M12 12.5v8"/>'),
  plan: SVG('<path d="M4 4h16v16H4z"/><path d="M4 12h7M11 4v8M15 12v8M11 16h4"/>'),
};
/** the order of the tools, left to right; anything a module adds that is not here goes last. Keys are the short labels. */
const TOOL_ORDER = ['Flats', 'Rooms', 'Measure', 'Furnish', 'Light', 'Materials', 'You', 'Scan', 'Share', 'Fullscreen', 'Controls'];
/** short labels for buttons other modules add (their accessible names stay as they are) */
const SHORT_LABEL: Record<string, string> = { 'Light and look': 'Light', 'Building map': 'Building', 'Take a tour of this home, room by room': 'Tour' };
const LABELS_KEY = 'walkthru:hud:labels-seen';
/** warnings already shown in this visit (a building shows "Sample building" once, not at every door) */
const noticed = new Set<string>();

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

/** The pieces of the identity card a brand changes. */
export interface IdentityParts { card: HTMLElement; icon: HTMLElement; name: HTMLElement; /** the column of lines: the credit goes at its foot */ text: HTMLElement; credit: HTMLElement | null }
/**
 * A builder's brand on the identity card (SPEC 18.15): its logo where the generic icon was, its name over the place, and the small
 * "powered by walkthru" line at the foot of the card unless the brand turns it off. Null puts the plain card back.
 */
export function showIdentityBrand(doc: Document, p: IdentityParts, brand: ShownBrand | null, plainIcon: (icon: HTMLElement) => void): void {
  p.card.classList.toggle('has-brand', !!brand);
  p.icon.replaceChildren();
  p.credit?.remove();
  p.credit = null;
  p.name.hidden = !brand;
  p.name.textContent = brand?.name ?? '';
  if (!brand) { plainIcon(p.icon); return; }
  const mark = brandMarkEl(doc, brand, 'wt-id-logo');
  mark.setAttribute('data-testid', 'brand-logo');
  p.icon.appendChild(mark);
  if (brand.credit) {
    const credit = doc.createElement('div');
    credit.className = 'wt-credit';
    credit.textContent = CREDIT_TEXT;
    credit.setAttribute('data-testid', 'brand-credit');
    p.text.appendChild(credit);
    p.credit = credit;
  }
}

export function createHud(parent: HTMLElement, handlers: HudHandlers): HudImpl {
  const root = el('div', 'wt-hud', undefined, parent);
  root.dataset.testid = 'hud';

  // one row at the top, a grid so nothing can overlap: [identity] ... [views][camera][Tour][tools] ... [Building]
  const toprow = el('div', 'wt-toprow', undefined, root);
  // top left: the identity pill (at rest: the mark and ONE line) and, on intent, its card: the place and its area, the level and the room you stand in,
  // the quiet note (scene-tag.ts), the credit, the unit switch and Share
  const idWrap = el('div', 'wt-id-wrap', undefined, toprow);
  idWrap.dataset.zone = 'id';
  const idPill = el('button', 'wt-id-pill wt-glass', undefined, idWrap);
  idPill.type = 'button';
  idPill.dataset.ui = '1';
  idPill.dataset.testid = 'identity-pill';
  idPill.setAttribute('aria-expanded', 'false');
  const idIcon = el('span', 'wt-id-icon', undefined, idPill);
  idIcon.innerHTML = EXTRA_ICONS.place;
  const idLine = el('span', 'wt-id-line', undefined, idPill);
  idLine.dataset.testid = 'identity-line';
  const id = el('div', 'wt-id wt-glass', undefined, idWrap);
  id.dataset.testid = 'identity';
  id.id = `wt-id-${Math.random().toString(36).slice(2, 7)}`;
  idPill.setAttribute('aria-controls', id.id);
  const idText = el('div', 'wt-id-text', undefined, id);
  const brandName = el('div', 'wt-id-brand', undefined, idText);
  brandName.dataset.testid = 'brand-name';
  brandName.hidden = true;
  const brandParts: IdentityParts = { card: idWrap, icon: idIcon, name: brandName, text: idText, credit: null };
  const place = el('div', 'wt-id-place', undefined, idText);
  place.dataset.testid = 'place';
  place.hidden = true;
  const chip = el('div', 'wt-chip', undefined, idText);
  chip.dataset.testid = 'room-chip';
  chip.hidden = true;
  const idFoot = el('div', 'wt-id-foot', undefined, id);
  const unitSeg = el('div', 'wt-id-units', undefined, idFoot);
  unitSeg.setAttribute('role', 'group');
  unitSeg.setAttribute('aria-label', 'Areas in');
  let units: AreaUnits = loadUnits(location.search, () => localStorage.getItem(UNITS_KEY));
  const unitBtns = {} as Record<AreaUnits, HTMLButtonElement>;
  (['sqft', 'm2'] as AreaUnits[]).forEach((u) => {
    const b = el('button', 'wt-id-unit', u === 'sqft' ? 'sq ft' : 'm²', unitSeg);
    b.type = 'button'; b.dataset.ui = '1'; b.dataset.units = u;
    b.setAttribute('aria-label', u === 'sqft' ? 'Show areas in square feet' : 'Show areas in square metres');
    b.addEventListener('click', (e) => { e.stopPropagation(); setUnits(u); });
    unitBtns[u] = b;
  });
  const idShare = el('button', 'wt-id-share', undefined, idFoot);
  idShare.type = 'button'; idShare.dataset.ui = '1'; idShare.dataset.testid = 'identity-share';
  idShare.setAttribute('aria-label', 'Share: copy a link to this place and view');
  idShare.innerHTML = EXTRA_ICONS.share;
  el('span', undefined, 'Share', idShare);
  idShare.addEventListener('click', (e) => { e.stopPropagation(); handlers.share?.(); idShare.blur(); });
  // what the pill and the card say: the place, its level, the room (identity.ts), in the unit chosen
  let placeText: string | null = null, levelText: string | null = null, roomText: string | null = null;
  const renderIdentity = (): void => {
    const l = identityLines(placeText ?? '', levelText, roomText, units);
    idLine.textContent = l.pill;
    idPill.hidden = !placeText;
    idPill.setAttribute('aria-label', `${l.pill}. About this place`);
    place.hidden = !placeText;
    if (place.textContent !== l.place) place.textContent = l.place;
    chip.hidden = l.where === null;
    if (l.where !== null && chip.textContent !== l.where) chip.textContent = l.where;
    for (const u of ['sqft', 'm2'] as AreaUnits[]) { unitBtns[u].classList.toggle('is-on', u === units); unitBtns[u].setAttribute('aria-pressed', u === units ? 'true' : 'false'); }
    if (l.warn) hud.notice(l.warn);
    queueFit();
  };
  const setUnits = (u: AreaUnits): void => {
    if (u === units) return;
    units = u;
    try { localStorage.setItem(UNITS_KEY, u); } catch { /* private mode: the choice lasts this visit */ }
    renderIdentity();
    try { window.dispatchEvent(new CustomEvent(UNITS_EVENT, { detail: u })); } catch { /* no CustomEvent */ }
  };
  // a press on the pill keeps the card open (a finger cannot hover); a press anywhere else lets it go
  let idPinned = false;
  const setIdPinned = (on: boolean): void => { idPinned = on; applyChrome(); };
  idPill.addEventListener('click', (e) => { e.stopPropagation(); setIdPinned(!idPinned); });
  const onDocPress = (e: Event): void => { if (idPinned && !(e.target instanceof Node && idWrap.contains(e.target))) setIdPinned(false); };
  document.addEventListener('pointerdown', onDocPress, true);

  // Share lives with the tools (and in the card)
  const shareBtn = document.createElement('button');
  shareBtn.className = 'wt-btn wt-tool';
  shareBtn.type = 'button';
  shareBtn.dataset.ui = '1';
  shareBtn.dataset.btn = 'share';
  shareBtn.dataset.testid = 'share';
  shareBtn.title = 'Share: copy a link to this place and view';
  shareBtn.setAttribute('aria-label', 'Share: copy a link to this place and view');
  shareBtn.innerHTML = EXTRA_ICONS.share;
  el('span', 'wt-tool-label', 'Share', shareBtn);
  shareBtn.addEventListener('click', (e) => { e.stopPropagation(); handlers.share?.(); shareBtn.blur(); });

  // top centre: the view control and the tools, one glass bar (a column down the right edge on a phone)
  const topbar = el('div', 'wt-topbar', undefined, toprow);
  topbar.dataset.zone = 'top';
  // the three views (Walk, Doll house, Plan): shown once the views module is there; until then Walk is the only one, so the control hides
  const seg = el('div', 'wt-seg wt-views wt-glass', undefined, topbar);
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'View');
  seg.hidden = true;
  el('i', 'wt-seg-thumb', undefined, seg);
  const modeBtns = {} as Record<ViewsMode, HTMLButtonElement>;
  (['walk', 'doll', 'plan'] as ViewsMode[]).forEach((m) => {
    const label = m === 'walk' ? 'Walk' : m === 'doll' ? 'Doll house' : 'Plan';
    const b = el('button', 'wt-seg-btn', undefined, seg);
    b.type = 'button'; b.dataset.ui = '1'; b.dataset.mode = m;
    b.setAttribute('aria-label', label);
    b.dataset.tip = label;
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
  el('i', 'wt-seg-thumb', undefined, eye);
  const segBtns = {} as Record<HudView, HTMLButtonElement>;
  (['third', 'first'] as HudView[]).forEach((v) => {
    const label = v === 'third' ? 'Third person' : 'First person';
    const b = el('button', 'wt-seg-btn', undefined, eye);
    b.type = 'button';
    b.dataset.ui = '1';
    b.dataset.view = v;
    b.setAttribute('aria-label', label);
    b.dataset.tip = label;
    b.setAttribute('aria-pressed', v === 'third' ? 'true' : 'false');
    b.innerHTML = EXTRA_ICONS[v];
    el('span', 'wt-tool-label', label, b);
    b.addEventListener('click', (e) => { e.stopPropagation(); handlers.view?.(v); b.blur(); });
    segBtns[v] = b;
  });
  segBtns.third.classList.add('is-on');
  let viewsOff: (() => void) | void = undefined;
  const syncViews = (m: ViewsMode): void => {
    for (const k of ['walk', 'doll', 'plan'] as ViewsMode[]) { modeBtns[k].classList.toggle('is-on', k === m); modeBtns[k].setAttribute('aria-pressed', k === m ? 'true' : 'false'); }
    eye.hidden = m !== 'walk';
    syncThumbs();
    queueFit();
  };
  /** the selected segment is a brighter capsule that slides between the options */
  const syncThumb = (g: HTMLElement): void => {
    const thumb = g.querySelector<HTMLElement>('.wt-seg-thumb');
    const on = g.querySelector<HTMLElement>('.wt-seg-btn.is-on');
    if (!thumb) return;
    if (!on || g.hidden) { thumb.style.opacity = '0'; return; }
    thumb.style.opacity = '';
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.height = `${on.offsetHeight}px`;
    thumb.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
  };
  const syncThumbs = (): void => { syncThumb(seg); syncThumb(eye); };
  // the primary action has its own capsule: the Tour (src/buyer/nav puts its button in the tools; it is moved here)
  const tourSlot = el('div', 'wt-tourslot wt-glass', undefined, topbar);
  tourSlot.hidden = true;
  const bar = el('div', 'wt-buttons wt-tools wt-glass', undefined, topbar);
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Tools');
  bar.dataset.testid = 'tools';
  // on a phone the tools are one row that scrolls sideways: `data-end` says it has reached its end, and until then its right edge fades (buyer.css)
  const syncEnd = (): void => { bar.dataset.end = bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 2 ? '1' : '0'; };
  bar.addEventListener('scroll', syncEnd, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncEnd).observe(bar);
  // ...and the row is cut half way through a button (a half icon peeking in at the edge says "more this way"; a fade alone read as a soft edge)
  const peek = (): void => {
    let phone = false;
    try { phone = window.matchMedia('(max-width: 760px), (pointer: coarse) and (max-height: 520px) and (min-width: 761px)').matches; } catch { /* no matchMedia */ }
    const parent = bar.parentElement;
    if (!phone || !parent) { if (bar.style.maxWidth) bar.style.maxWidth = ''; return; }
    // a button that is only an icon (the Flats button carries its name and is wider): the width of the last one
    const btns = [...bar.querySelectorAll<HTMLElement>('.wt-btn, .wt-tool')].filter((b) => b.offsetWidth > 0);
    const icon = btns[btns.length - 1];
    const cell = (icon?.offsetWidth ?? 44) + 2;
    const labelled = btns.reduce((sum, b) => sum + Math.max(0, b.offsetWidth - (icon?.offsetWidth ?? 44)), 0);
    // what the row has: the whole group's width on a phone held upright (the tools are on a row of their own), what the view switch, the camera and the Tour leave when held sideways
    const row = parent.clientWidth;
    const sibs = [...parent.children].filter((c) => c !== bar && (c as HTMLElement).offsetWidth > 0) as HTMLElement[];
    const used = sibs.reduce((sum, c) => sum + c.offsetWidth + 6, 0);
    const avail = used + 8 + 9 * 46 > row ? row : row - used;
    const want = bar.scrollWidth;
    if (want <= avail + 1) { if (bar.style.maxWidth) bar.style.maxWidth = ''; return; }
    const n = Math.max(1, Math.floor((avail - 8 - labelled) / cell - 0.35));
    const w = `${Math.round(8 + labelled + (n + 0.5) * cell)}px`;
    if (bar.style.maxWidth !== w) bar.style.maxWidth = w;
  };
  if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(() => { peek(); }); ro.observe(topbar); ro.observe(bar); }
  window.addEventListener('resize', peek);
  if (typeof MutationObserver !== 'undefined') new MutationObserver(() => { peek(); syncEnd(); }).observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  const buttons = {} as Record<HudButtonId, HTMLButtonElement>;
  (['rooms', 'measure', 'furnish', 'person', 'scan'] as HudButtonId[]).forEach((bid) => {
    const b = el('button', 'wt-btn wt-tool', undefined, bar);
    b.type = 'button';
    b.dataset.ui = '1';
    b.dataset.btn = bid;
    b.setAttribute('aria-label', NAMES[bid]);
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
  bar.appendChild(shareBtn);
  // the chrome's level (auto, always, hidden) and full screen: always last, handled here
  let level: ChromeLevel = 'auto';
  let levelCb: ((next: ChromeLevel) => void) | null = null;
  const levelBtn = el('button', 'wt-btn wt-tool', undefined, bar);
  levelBtn.type = 'button'; levelBtn.dataset.ui = '1'; levelBtn.dataset.btn = 'chrome'; levelBtn.dataset.testid = 'chrome-level';
  levelBtn.innerHTML = EXTRA_ICONS.auto;
  const levelLabel = el('span', 'wt-tool-label', 'Controls', levelBtn);
  const syncLevelBtn = (): void => {
    levelBtn.innerHTML = EXTRA_ICONS[level];
    levelBtn.appendChild(levelLabel);
    levelBtn.dataset.level = level;
    const next = nextChromeLevel(level);
    const name = `${CHROME_LEVEL_LABEL[level]}. Press for: ${next === 'auto' ? 'automatic' : next === 'always' ? 'always shown' : 'hidden'}`;
    levelBtn.setAttribute('aria-label', name);
    levelBtn.dataset.tip = name;
  };
  syncLevelBtn();
  levelBtn.addEventListener('click', (e) => { e.stopPropagation(); levelCb?.(nextChromeLevel(level)); levelBtn.blur(); });
  const fsBtn = el('button', 'wt-btn wt-tool', undefined, bar);
  fsBtn.type = 'button'; fsBtn.dataset.ui = '1'; fsBtn.dataset.btn = 'fullscreen';
  fsBtn.setAttribute('aria-label', 'Full screen'); fsBtn.dataset.tip = 'Full screen';
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
    fsBtn.dataset.tip = on ? 'Leave full screen' : 'Full screen';
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
  const exit = el('div', 'wt-exit', undefined, toprow);
  exit.dataset.testid = 'exit';
  exit.dataset.zone = 'top';
  // the handle: a thin pill at the top centre, the way in on a touch screen and at level `hidden`
  const handle = el('button', 'wt-handle', undefined, root);
  handle.type = 'button'; handle.dataset.ui = '1'; handle.dataset.testid = 'chrome-handle';
  handle.setAttribute('aria-label', 'Show the controls');
  handle.hidden = true;
  let handleCb: (() => void) | null = null;
  handle.addEventListener('click', (e) => { e.stopPropagation(); handleCb?.(); handle.blur(); });

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
  const noticeEl = el('div', 'wt-notice wt-glass', undefined, top);
  noticeEl.dataset.testid = 'notice';
  noticeEl.setAttribute('role', 'status');
  noticeEl.hidden = true;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

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
      // the Tour is the primary action: it has its own capsule beside the tools
      if (b.dataset.btn === 'tour') { tourSlot.appendChild(b); tourSlot.hidden = false; continue; }
      b.classList.add('wt-tool');
      // one tooltip, ours: an icon-only button says what it is on hover and on focus
      if (!b.dataset.tip) b.dataset.tip = b.getAttribute('aria-label') ?? b.title ?? '';
      if (b.title) b.removeAttribute('title');
      if (!b.querySelector('.wt-tool-label')) {
        const name = b.getAttribute('aria-label') ?? b.title ?? '';
        const sub = b.querySelector('.wt-btn-sub');
        if (sub && b.dataset.btn !== 'scan') sub.remove();
        el('span', 'wt-tool-label', SHORT_LABEL[name] ?? name, b);
      }
    }
    const left = ([...bar.children] as HTMLElement[]);
    const sorted = left.slice().sort((x, y) => rankOf(x) - rankOf(y));
    if (sorted.some((k, i) => k !== left[i])) for (const k of sorted) bar.appendChild(k);
    sorting = false;
    queueFit();
  };
  // no overlap at any width: the row is a grid, and before the identity pill is squeezed the labels collapse to icons, then the buttons tighten
  let fitQueued = false;
  const fit = (): void => {
    fitQueued = false;
    if (root.style.display === 'none') return;
    const over = (): boolean => toprow.scrollWidth > toprow.clientWidth + 1 || idLine.scrollWidth > idLine.clientWidth + 1 || idWrap.clientWidth < idPill.offsetWidth;
    let n = 0;
    toprow.dataset.fit = '0';
    while (n < 3 && over()) { n++; toprow.dataset.fit = String(n); }
    syncThumbs();
  };
  function queueFit(): void {
    if (fitQueued) return;
    fitQueued = true;
    (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (f: () => void) => setTimeout(f, 0))(fit);
  }
  const fitObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => queueFit()) : null;
  fitObserver?.observe(toprow);
  fitObserver?.observe(bar);
  // the Tour button leaves with its space: the capsule goes with it
  const tourObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => { tourSlot.hidden = tourSlot.children.length === 0; queueFit(); }) : null;
  tourObserver?.observe(tourSlot, { childList: true });
  const toolsObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(decorate) : null;
  toolsObserver?.observe(bar, { childList: true });
  decorate();
  // first visit: on a phone the tools are icons, so show their names for a few seconds once, when the chrome first appears (not while it is loading)
  let labelsPending = true;
  try { labelsPending = localStorage.getItem(LABELS_KEY) !== '1'; } catch { labelsPending = false; }
  const showLabelsOnce = (): void => {
    if (!labelsPending) return;
    labelsPending = false;
    bar.classList.add('is-labelled');
    setTimeout(() => bar.classList.remove('is-labelled'), 7000);
    try { localStorage.setItem(LABELS_KEY, '1'); } catch { /* ignore */ }
  };

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
    ? new ResizeObserver(() => {
      // the height of what is IN the slot (a bare slot is 12 px of padding and margin, which pushed the phone's tools 12 px up off the room strip)
      const filled = [...slot.children].some((c) => [...c.children].some((g) => g.getBoundingClientRect().height > 0));
      root.style.setProperty('--wt-slot-h', `${filled ? slot.offsetHeight : 0}px`);
    })
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

  // calm by default: the parts that are in carry `is-in` (the CSS eases them); the level is on the root for the rest
  let flags: ChromeFlags = { top: true, bottom: true, map: true, id: false, views: true, pill: true, handle: false };
  let shownCb: (() => void) | null = null;
  let shown = false;
  function applyChrome(): void {
    const idIn = flags.id || idPinned;
    root.dataset.chrome = level;
    root.classList.toggle('rv-top', flags.top);
    root.classList.toggle('rv-bottom', flags.bottom);
    root.classList.toggle('rv-map', flags.map);
    root.classList.toggle('rv-id', idIn);
    root.classList.toggle('rv-views', flags.views);
    root.classList.toggle('rv-pill', flags.pill || idIn);
    idPill.setAttribute('aria-expanded', idIn ? 'true' : 'false');
    handle.hidden = !flags.handle;
  }
  applyChrome();

  const hud: HudImpl = {
    root,
    tools: bar,
    exit,
    setBrand(brand) { showIdentityBrand(document, brandParts, brand, (icon) => { icon.innerHTML = EXTRA_ICONS.place; }); },
    setPlace(text, lv = null) {
      placeText = text === '' ? null : text;
      levelText = lv || null;
      renderIdentity();
    },
    setView(v) {
      for (const k of ['third', 'first'] as HudView[]) {
        segBtns[k].classList.toggle('is-on', k === v);
        segBtns[k].setAttribute('aria-pressed', k === v ? 'true' : 'false');
      }
      syncThumb(eye);
    },
    bindViews(api) {
      if (typeof viewsOff === 'function') viewsOff();
      viewsOff = undefined;
      seg.hidden = !api;
      if (!api) { eye.hidden = false; queueFit(); return; }
      for (const m of ['walk', 'doll', 'plan'] as ViewsMode[]) modeBtns[m].onclick = (e) => { e.stopPropagation(); api.set(m); modeBtns[m].blur(); };
      syncViews(api.mode());
      viewsOff = api.onChange(syncViews);
    },
    shareButton: shareBtn,
    setChrome(f, l) {
      flags = f;
      if (l !== level) { level = l; syncLevelBtn(); }
      applyChrome();
    },
    onHandle(cb) { handleCb = cb; },
    onChromeLevel(cb) { levelCb = cb; },
    onShown(cb) { shownCb = cb; if (shown) cb(); },
    notice(text, ms = 6000) {
      if (!text || noticed.has(text)) return;
      noticed.add(text);
      noticeEl.textContent = text;
      noticeEl.hidden = false;
      if (noticeTimer) clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => { noticeEl.hidden = true; }, ms);
    },
    units: () => units,
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
      if (text === roomText) return;
      roomText = text;
      renderIdentity();
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
      chipsTimer = setTimeout(off, 4500);
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
      if (v) { showLabelsOnce(); queueFit(); if (!shown) { shown = true; shownCb?.(); } }
    },
    dispose() {
      ro?.disconnect();
      toolsObserver?.disconnect();
      fitObserver?.disconnect();
      tourObserver?.disconnect();
      document.removeEventListener('pointerdown', onDocPress, true);
      if (noticeTimer) clearTimeout(noticeTimer);
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
