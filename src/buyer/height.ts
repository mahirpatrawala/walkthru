// Owned by C3. B2: "How tall are you?" (SPEC 2.1). Changes apply live to the character behind the sheet.
import { formatHeight } from '../core/units';
import { HEIGHT_MAX_CM, HEIGHT_MIN_CM, HEIGHT_PRESETS_CM, HEIGHT_TINTS } from '../types';
import { el } from './hud';
import { clampHeightCm, nearestPresetIndex, tintForHeightCm } from './store';

export interface HeightPicker {
  open(first: boolean): void;
  close(): void;
  isOpen(): boolean;
  /** keep the picker's display in step when the height is set from outside */
  sync(cm: number): void;
}

export function createHeightPicker(
  parent: HTMLElement,
  opts: { getCm(): number; onChange(cm: number): void; onClose(): void },
): HeightPicker {
  const modal = el('div', 'wt-modal', undefined, parent);
  modal.dataset.testid = 'height-picker';
  modal.hidden = true;
  const sheet = el('div', 'wt-sheet', undefined, modal);
  el('h2', undefined, 'How tall are you?', sheet);

  const chips = el('div', 'wt-chips', undefined, sheet);
  const chipBtns = HEIGHT_PRESETS_CM.map((cm, i) => {
    const b = el('button', 'wt-chip-btn', undefined, chips);
    b.type = 'button';
    b.dataset.cm = String(cm);
    b.style.setProperty('--tint', HEIGHT_TINTS[i]);
    el('span', 'wt-swatch', undefined, b);
    el('span', undefined, `${cm} cm`, b);
    b.addEventListener('click', () => set(cm));
    return b;
  });

  const stepper = el('div', 'wt-stepper', undefined, sheet);
  const minus = el('button', 'wt-step-btn', '−', stepper);
  minus.type = 'button';
  minus.setAttribute('aria-label', 'One centimetre shorter');
  const value = el('div', 'wt-step-val', undefined, stepper);
  value.dataset.testid = 'height-value';
  const plus = el('button', 'wt-step-btn', '+', stepper);
  plus.type = 'button';
  plus.setAttribute('aria-label', 'One centimetre taller');
  const go = el('button', 'wt-go', 'Start walking', sheet);
  go.type = 'button';

  let cm = clampHeightCm(opts.getCm());
  let opened = false;

  function render(): void {
    value.textContent = formatHeight(cm);
    value.style.setProperty('--tint', tintForHeightCm(cm));
    chipBtns.forEach((b, i) => b.classList.toggle('is-on', HEIGHT_PRESETS_CM[i] === cm));
    minus.disabled = cm <= HEIGHT_MIN_CM;
    plus.disabled = cm >= HEIGHT_MAX_CM;
    sheet.style.setProperty('--tint', HEIGHT_TINTS[nearestPresetIndex(cm)]);
  }
  function set(next: number): void {
    const v = clampHeightCm(next);
    if (v === cm) return;
    cm = v;
    render();
    opts.onChange(cm);
  }
  minus.addEventListener('click', () => set(cm - 1));
  plus.addEventListener('click', () => set(cm + 1));
  // hold to repeat
  for (const [btn, d] of [[minus, -1], [plus, 1]] as const) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = (): void => { if (timer) { clearTimeout(timer); timer = null; } };
    const tick = (): void => { set(cm + d); timer = setTimeout(tick, 70); };
    btn.addEventListener('pointerdown', () => { stop(); timer = setTimeout(tick, 450); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
  }

  const onKey = (e: KeyboardEvent): void => {
    if (modal.hidden) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); set(cm - 1); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); set(cm + 1); }
  };
  window.addEventListener('keydown', onKey, true);
  go.addEventListener('click', () => close());

  function open(first: boolean): void {
    cm = clampHeightCm(opts.getCm());
    go.textContent = first && !opened ? 'Start walking' : 'Done';
    opened = true;
    render();
    modal.hidden = false;
    go.focus({ preventScroll: true });
  }
  function close(): void {
    if (modal.hidden) return;
    modal.hidden = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
    opts.onClose();
  }
  render();

  return {
    open, close,
    isOpen: () => !modal.hidden,
    sync(next) { cm = clampHeightCm(next); render(); },
  };
}
