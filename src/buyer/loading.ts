// Owned by C3. B1: the loading screen, and the on-screen error states (SPEC 2.1).
import { el } from './hud';
import { CREDIT_TEXT, brandMarkEl } from '../brand/builder-brand';
import type { ShownBrand } from '../brand/builder-brand';

/** A small floor plan that draws itself, with a measuring line sliding under it (CSS in buyer.css). Fixed markup, no page data. */
const PLAN_ART =
  '<svg class="wt-screen-art" viewBox="0 0 148 112" aria-hidden="true" focusable="false">' +
  '<g class="wt-draw" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
  '<path pathLength="1" d="M14 14H134V86H14Z" stroke="#F3E7D3" stroke-width="4"/>' +
  '<path pathLength="1" d="M78 14V56H14M78 56H134M96 56V86" stroke="#F3E7D3" stroke-width="3"/>' +
  '<path pathLength="1" d="M34 14H58M104 14H122" stroke="#8FBFC4" stroke-width="5"/>' +
  '<path pathLength="1" d="M48 56a14 14 0 0 1 14-14M96 70a14 14 0 0 0-14-14" stroke="#F0906F" stroke-width="2.4"/>' +
  '</g>' +
  '<path class="wt-tape" d="M14 102H134M14 98v8M134 98v8" fill="none" stroke="#E6C072" stroke-width="2.6" stroke-linecap="round"/>' +
  '</svg>';

export interface LoadingScreen {
  setTitle(title: string, subtitle?: string): void;
  /** a builder's brand over the title: its logo and name, and the small credit (SPEC 18.15) */
  setBrand(brand: ShownBrand | null): void;
  /** the fine print under the tagline */
  setNote(text: string): void;
  setProgress(fraction: number, status?: string): void;
  /** the "not set up yet" page, with a link to the editor */
  showNotSetUp(sceneId: string): void;
  /** any other failure: a readable message and a reload button */
  showError(title: string, message: string): void;
  hide(): void;
  isShowingError(): boolean;
}

/** Shown until the layout is known; main.ts then swaps in `sizesNote(layout)` (it only names a phone video when colours were sampled). */
export const SIZES_NOTE = 'Sizes from the floor plan.';

export function createLoadingScreen(parent: HTMLElement): LoadingScreen {
  document.getElementById('wt-boot')?.remove(); // the static first-paint splash from index.html
  const screen = el('div', 'wt-screen', undefined, parent);
  screen.dataset.testid = 'loading';
  const card = el('div', 'wt-screen-card', undefined, screen);
  const art = el('div', undefined, undefined, card);
  art.innerHTML = PLAN_ART;
  const brandRow = el('div', 'wt-screen-brand', undefined, card);
  brandRow.dataset.testid = 'loading-brand';
  brandRow.hidden = true;
  const h1 = el('h1', undefined, 'firstbeam', card);
  const sub = el('p', 'wt-sub', 'Opening the home…', card);
  const bar = el('div', 'wt-progress', undefined, card);
  const fill = el('div', undefined, undefined, bar);
  const status = el('p', 'wt-status', '', card);
  const fine = el('p', 'wt-fine', SIZES_NOTE, card);
  let erroring = false;

  const toError = (title: string, body: string, actions: HTMLElement[]): void => {
    erroring = true;
    screen.classList.add('is-error');
    screen.classList.remove('is-hiding');
    screen.hidden = false;
    h1.textContent = title;
    sub.textContent = '';
    sub.hidden = true;
    // replace the fine print area with the message
    card.querySelectorAll('.wt-error-body, .wt-actions').forEach((n) => n.remove());
    el('p', 'wt-error-body', body, card);
    const row = el('div', 'wt-actions', undefined, card);
    for (const a of actions) row.appendChild(a);
  };

  const reloadBtn = (): HTMLElement => {
    const b = el('button', 'wt-link-btn', 'Try again');
    b.type = 'button';
    b.addEventListener('click', () => location.reload());
    return b;
  };

  return {
    setBrand(brand) {
      brandRow.replaceChildren();
      brandRow.hidden = !brand;
      screen.querySelector('.wt-screen-credit')?.remove();
      if (!brand) return;
      brandRow.appendChild(brandMarkEl(document, brand, 'wt-screen-logo'));
      el('span', undefined, brand.name, brandRow);
      if (brand.credit) el('p', 'wt-screen-credit', CREDIT_TEXT, screen);
    },
    setTitle(title, subtitle) {
      h1.textContent = title;
      sub.textContent = subtitle ?? '';
      sub.hidden = !subtitle;
    },
    setNote(text) {
      fine.textContent = text;
    },
    setProgress(f, text) {
      fill.style.width = `${Math.round(Math.min(1, Math.max(0, f)) * 100)}%`;
      if (text !== undefined) status.textContent = text;
    },
    showNotSetUp(sceneId) {
      const home = el('a', 'wt-link-btn', 'All homes');
      home.href = '/';
      // the editor is a broker tool that only saves on a development machine: the public site does not offer it
      if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
        const a = el('a', 'wt-link-btn is-secondary', 'Open the editor');
        a.href = `/editor.html?scene=${encodeURIComponent(sceneId)}`;
        toError('This home is not set up yet.', `There is no layout for "${sceneId}" yet. A broker can trace one in the editor.`, [home, a]);
      } else toError('This home is not available.', `There is no home called "${sceneId}" here.`, [home]);
    },
    showError(title, message) {
      toError(title, message, [reloadBtn()]);
    },
    hide() {
      if (erroring) return;
        screen.classList.add('is-hiding');
      setTimeout(() => { screen.hidden = true; }, 400);
    },
    isShowingError() {
      return erroring;
    },
  };
}
