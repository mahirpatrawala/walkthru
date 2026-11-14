// Owned by C11a. SPEC 16.5 "look-panel.ts": one HUD button (a sun) opening a small sheet with the time slider, the
// "True colours" switch, the quality picker, the sampled-colour swatches and the illustrative labels.
import { LOOK_PRESETS, PRESET_LABEL, dayPartLabel } from './grade';
import type { LookPreset } from './grade';
import { formatHour } from './sun';
import type { Look, QualityMode } from './look';
import { HOUR_MAX, HOUR_MIN, LABEL_FURNITURE, LABEL_LIGHTING, LABEL_VIEW } from './types';
import './look.css';

export interface LookPanelOpts {
  /** shown for the first-time "View outside is illustrative." toast */
  toast?(text: string): void;
  /** C11c: when given, a "Painting" button appears and calls it */
  onPainterly?(): void;
  /** where the round button goes; default: the `.wt-buttons` column inside `host`, else `host` */
  buttonHost?: HTMLElement;
  /** the Style picker (SPEC 16.13): packs, and the designer's look when the home has a design sheet */
  style?: StylePickerOpts;
}

export interface StylePickerOpts {
  options(): { id: string; label: string; hint?: string }[];
  current(): string;
  choose(id: string): void;
  onChange(cb: () => void): () => void;
  /** the decor label ("Curtains, rugs ... are typical styling"), null when the home has no decor */
  note(): string | null;
  /** 'designer-renders' (etc) while the designer's look is on, else null */
  designerSource(): string | null;
  packName(): string;
  classic(): boolean;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const SUN_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>';

const QUALITY_LABEL: Record<QualityMode, string> = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' };

export function mountLookPanel(host: HTMLElement, look: Look, opts: LookPanelOpts = {}): () => void {
  const buttonHost = opts.buttonHost ?? host.querySelector<HTMLElement>('.wt-buttons') ?? host;
  const btn = h('button', 'wt-btn', undefined, buttonHost);
  btn.type = 'button';
  btn.dataset.ui = '1';
  btn.dataset.btn = 'look';
  btn.setAttribute('aria-label', 'Light and look');
  btn.setAttribute('aria-pressed', 'false');
  btn.title = 'Light and look';
  btn.innerHTML = SUN_ICON;

  const sheet = h('div', 'wt-look-sheet', undefined, host);
  sheet.dataset.ui = '1';
  sheet.dataset.testid = 'look-panel';
  sheet.hidden = true;
  const head = h('div', 'wt-look-head', undefined, sheet);
  h('h2', undefined, 'Light and look', head);
  const close = h('button', 'wt-look-x', '×', head);
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');

  // time of day
  const timeRow = h('div', 'wt-look-row', undefined, sheet);
  h('span', 'wt-look-k', 'Time of day', timeRow);
  const timeText = h('span', 'wt-look-v', '', timeRow);
  const presetRow = h('div', 'wt-look-seg', undefined, sheet);
  presetRow.setAttribute('role', 'group');
  presetRow.setAttribute('aria-label', 'Time of day presets');
  presetRow.dataset.testid = 'look-presets';
  const presetButtons = new Map<LookPreset, HTMLButtonElement>();
  for (const p of LOOK_PRESETS) {
    const b = h('button', 'wt-look-seg-b', PRESET_LABEL[p], presetRow);
    b.type = 'button';
    b.dataset.preset = p;
    b.addEventListener('click', () => { look.setPreset(p); sync(); });
    presetButtons.set(p, b);
  }
  const slider = h('input', 'wt-look-slider', undefined, sheet);
  slider.type = 'range';
  slider.min = String(HOUR_MIN);
  slider.max = String(HOUR_MAX);
  slider.step = '0.25';
  slider.setAttribute('aria-label', 'Time of day');
  const sunLabel = h('p', 'wt-look-note', '', sheet);
  sunLabel.dataset.testid = 'look-sun-label';

  // true colours
  const tcRow = h('label', 'wt-look-switch', undefined, sheet);
  const tc = h('input', undefined, undefined, tcRow);
  tc.type = 'checkbox';
  tc.setAttribute('role', 'switch');
  tc.dataset.testid = 'look-true-colours';
  const tcText = h('span', undefined, undefined, tcRow);
  h('b', undefined, 'True colours', tcText);
  h('small', undefined, look.finishes.source === 'sampled'
    ? 'Neutral white light, so surfaces show the colours measured from the video.'
    : 'Neutral white light, so surfaces show their plain colours. This home has no colours measured from a video.', tcText);

  // quality
  const qRow = h('div', 'wt-look-row', undefined, sheet);
  h('span', 'wt-look-k', 'Quality', qRow);
  const qNote = h('span', 'wt-look-v', '', qRow);
  const seg = h('div', 'wt-look-seg', undefined, sheet);
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Quality');
  const segButtons = new Map<QualityMode, HTMLButtonElement>();
  (['auto', 'low', 'medium', 'high'] as QualityMode[]).forEach((q) => {
    const b = h('button', 'wt-look-seg-b', QUALITY_LABEL[q], seg);
    b.type = 'button';
    b.dataset.quality = q;
    b.addEventListener('click', () => { void look.setQuality(q); });
    segButtons.set(q, b);
  });

  // style packs
  let syncStyle = (): void => {};
  let offStyle: (() => void) | null = null;
  if (opts.style) {
    const st = opts.style;
    const sRow = h('div', 'wt-look-row', undefined, sheet);
    h('span', 'wt-look-k', 'Style', sRow);
    const sNote = h('span', 'wt-look-v', '', sRow);
    const sSeg = h('div', 'wt-look-seg wt-look-styles', undefined, sheet);
    sSeg.setAttribute('role', 'group');
    sSeg.setAttribute('aria-label', 'Style');
    sSeg.dataset.testid = 'look-styles';
    const sNoteP = h('p', 'wt-look-note', '', sheet);
    sNoteP.dataset.testid = 'look-style-note';
    syncStyle = (): void => {
      sSeg.textContent = '';
      for (const o of st.options()) {
        const b = h('button', 'wt-look-seg-b', o.label, sSeg);
        b.type = 'button';
        b.dataset.style = o.id;
        if (o.hint) b.title = o.hint;
        const on = o.id === st.current();
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.addEventListener('click', () => { st.choose(o.id); });
      }
      const src = st.designerSource();
      sNote.textContent = src ? "Designer's look" : st.packName();
      sNoteP.textContent = st.classic()
        ? 'Classic: the plain furniture style. Sizes are exact.'
        : src === 'designer-renders' ? "Finishes are from the designer's renders. Sizes are exact. Wall and floor colours are the style's, not measured."
          : `Typical finishes from the ${st.packName()} style pack, not from your drawing. Sizes are exact. Wall and floor colours are the style's, not measured.`;
    };
    offStyle = st.onChange(() => { syncStyle(); setTimeout(() => { sync(); }, 0); });
    syncStyle();
  }

  if (opts.onPainterly) {
    const p = h('button', 'wt-look-paint', 'Show as a painting', sheet);
    p.type = 'button';
    p.addEventListener('click', () => { opts.onPainterly?.(); });
  }

  // sampled colours
  const swatches = h('div', 'wt-look-swatches', undefined, sheet);
  const mkSwatch = (label: string, colour: string): void => {
    const s = h('div', 'wt-look-swatch', undefined, swatches);
    const chip = h('span', 'wt-look-chip', undefined, s);
    chip.style.background = colour;
    const t = h('span', undefined, undefined, s);
    h('b', undefined, label, t);
    h('small', undefined, colour.toUpperCase(), t);
  };
  const finishes = look.finishes;
  const fromVideo = finishes.source === 'sampled';
  mkSwatch(fromVideo ? 'Wall colour from the video' : 'Wall colour (default, not measured)', finishes.wallColor);
  mkSwatch(fromVideo ? 'Floor colour from the video' : 'Floor colour (default, not measured)', finishes.floorColor);

  // the illustrative labels (SPEC 16.2 rule 4)
  const labels = h('div', 'wt-look-labels', undefined, sheet);
  h('p', undefined, LABEL_VIEW, labels).dataset.testid = 'look-label-view';
  const sunNote = h('p', undefined, '', labels);
  sunNote.dataset.testid = 'look-label-sun';
  h('p', undefined, LABEL_FURNITURE, labels).dataset.testid = 'look-label-furniture';
  const lightNote = h('p', undefined, LABEL_LIGHTING, labels);
  lightNote.dataset.testid = 'look-label-lighting';
  lightNote.hidden = true;
  const designNote = h('p', undefined, '', labels);
  designNote.dataset.testid = 'look-label-design';

  const sync = (): void => {
    const hr = look.hour;
    slider.value = String(hr);
    timeText.textContent = `${formatHour(hr)} · ${dayPartLabel(hr)}`;
    for (const [p, b] of presetButtons) {
      const on = !look.trueColours && look.preset === p;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const label = look.sun().label;
    sunLabel.textContent = look.trueColours ? 'Sun is off in True colours.' : label;
    sunNote.textContent = label;
    lightNote.hidden = !look.bakedActive;
    tc.checked = look.trueColours;
    slider.disabled = look.trueColours;
    for (const [q, b] of segButtons) {
      const on = q === look.quality;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    designNote.textContent = opts.style?.note() ?? '';
    designNote.hidden = !designNote.textContent;
    qNote.textContent = look.quality === 'auto' ? `Auto (${QUALITY_LABEL[look.tier]})` : QUALITY_LABEL[look.tier];
  };

  slider.addEventListener('input', () => { look.setHour(parseFloat(slider.value)); sync(); });
  tc.addEventListener('change', () => { look.setTrueColours(tc.checked); sync(); });

  const setOpen = (on: boolean): void => {
    sheet.hidden = !on;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) sync();
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!!sheet.hidden); btn.blur(); });
  close.addEventListener('click', (e) => { e.stopPropagation(); setOpen(false); });
  const off = look.onChange(() => { if (!sheet.hidden) sync(); });
  sync();

  // "View outside is illustrative." the first time a window fills more than 8% of the screen (3 seconds)
  let toasted = false;
  const timer = setInterval(() => {
    if (toasted || !opts.toast) return;
    if (look.windowFraction() > 0.08) { toasted = true; opts.toast(LABEL_VIEW); }
  }, 400);

  return () => {
    clearInterval(timer);
    offStyle?.();
    off();
    btn.remove();
    sheet.remove();
  };
}
