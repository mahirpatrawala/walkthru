// Owned by C3. B2: "How tall are you?" (SPEC 2.1). Changes apply live to the character behind the sheet.
import { formatHeight } from '../core/units';
import { HEIGHT_MAX_CM, HEIGHT_MIN_CM, HEIGHT_PRESETS_CM, HEIGHT_TINTS } from '../types';
import { SKIN_TONES, SKIN_TONE_NAMES } from '../look/people-materials';
import { el } from './hud';
import { clampHeightCm, nearestPresetIndex, tintForHeightCm } from './store';

export interface HeightPicker {
  open(first: boolean): void;
  close(): void;
  isOpen(): boolean;
  /** keep the picker's display in step when the height is set from outside */
  sync(cm: number): void;
  /** keep the body and skin tone in step when they are set from outside */
  syncPerson(p: { body: 'male' | 'female'; tone: number }): void;
}

/** SPEC 16.6.4: the body and skin tone half of the picker. Absent (the editor, old callers) = height only. */
export interface PersonOptions {
  get(): { body: 'male' | 'female'; tone: number };
  onChange(p: { body: 'male' | 'female'; tone: number }): void;
}

export function createHeightPicker(
  parent: HTMLElement,
  opts: { getCm(): number; onChange(cm: number): void; onClose(): void; person?: PersonOptions },
): HeightPicker {
  const modal = el('div', 'wt-modal', undefined, parent);
  modal.dataset.testid = 'height-picker';
  modal.hidden = true;
  const sheet = el('div', 'wt-sheet', undefined, modal);
  el('h2', undefined, opts.person ? "Who's walking?" : 'How tall are you?', sheet);

  // body: two cards. Each shows a still of that body (no second renderer, so a phone pays nothing for it).
  const cards: { body: 'male' | 'female'; btn: HTMLButtonElement }[] = [];
  const toneBtns: HTMLButtonElement[] = [];
  let person = opts.person ? opts.person.get() : { body: 'male' as const, tone: 2 };
  if (opts.person) {
    const row = el('div', 'wt-cards', undefined, sheet);
    for (const body of ['male', 'female'] as const) {
      const b = el('button', 'wt-card', undefined, row);
      b.type = 'button';
      b.dataset.body = body;
      const img = el('img', 'wt-card-img', undefined, b) as HTMLImageElement;
      img.src = `/characters/thumb-${body === 'male' ? 'm' : 'f'}.jpg`;
      img.alt = '';
      img.width = 96; img.height = 120;
      img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
      el('span', undefined, body === 'male' ? 'Male' : 'Female', b);
      b.addEventListener('click', () => setPerson({ ...person, body }));
      cards.push({ body, btn: b });
    }
    const tones = el('div', 'wt-tones', undefined, sheet);
    tones.setAttribute('role', 'group');
    tones.setAttribute('aria-label', 'Skin tone');
    SKIN_TONES.forEach((hex, i) => {
      const b = el('button', 'wt-tone', undefined, tones);
      b.type = 'button';
      b.dataset.tone = String(i);
      b.style.setProperty('--c', hex);
      b.setAttribute('aria-label', SKIN_TONE_NAMES[i]);
      b.title = SKIN_TONE_NAMES[i];
      b.addEventListener('click', () => setPerson({ ...person, tone: i }));
      toneBtns.push(b);
    });
  }
  function setPerson(next: { body: 'male' | 'female'; tone: number }): void {
    if (next.body === person.body && next.tone === person.tone) return;
    person = next;
    renderPerson();
    opts.person?.onChange(person);
  }
  function renderPerson(): void {
    for (const c of cards) c.btn.classList.toggle('is-on', c.body === person.body);
    toneBtns.forEach((b, i) => b.classList.toggle('is-on', i === person.tone));
  }

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
    if (opts.person) { person = opts.person.get(); renderPerson(); }
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
  renderPerson();

  return {
    open, close,
    isOpen: () => !modal.hidden,
    sync(next) { cm = clampHeightCm(next); render(); },
    syncPerson(p) { person = p; renderPerson(); },
  };
}
