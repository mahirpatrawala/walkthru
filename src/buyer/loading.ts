// Owned by C3. B1: the loading screen, and the on-screen error states (SPEC 2.1).
import { el } from './hud';

/** Lines under the progress bar while a home loads. A light touch of humour, shown one at a time; the factual status line stays above them. */
export const LOADING_LINES = [
  'Measuring twice, cutting never…',
  'Asking the walls how thick they are…',
  'Checking the sofa will fit through the door…',
  'Placing the tulsi where it gets some sun…',
  'Counting the steps from door to balcony…',
  'Waiting for the lift to arrive…',
];

/** A small floor plan that draws itself, with a measuring line sliding under it (CSS in buyer.css). Fixed markup, no page data. */
const PLAN_ART =
  '<svg class="wt-screen-art" viewBox="0 0 148 112" aria-hidden="true" focusable="false">' +
  '<g class="wt-draw" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
  '<path pathLength="1" d="M14 14H134V86H14Z" stroke="#2B211C" stroke-width="4"/>' +
  '<path pathLength="1" d="M78 14V56H14M78 56H134M96 56V86" stroke="#2B211C" stroke-width="3"/>' +
  '<path pathLength="1" d="M34 14H58M104 14H122" stroke="#1E6B73" stroke-width="5"/>' +
  '<path pathLength="1" d="M48 56a14 14 0 0 1 14-14M96 70a14 14 0 0 0-14-14" stroke="#B2472B" stroke-width="2.4"/>' +
  '</g>' +
  '<path class="wt-tape" d="M14 102H134M14 98v8M134 98v8" fill="none" stroke="#E3A33A" stroke-width="2.6" stroke-linecap="round"/>' +
  '</svg>';

export interface LoadingScreen {
  setTitle(title: string, subtitle?: string): void;
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
  const h1 = el('h1', undefined, 'walkthru', card);
  const sub = el('p', 'wt-sub', 'Opening the home…', card);
  const bar = el('div', 'wt-progress', undefined, card);
  const fill = el('div', undefined, undefined, bar);
  const status = el('p', 'wt-status', '', card);
  const tagline = el('p', 'wt-tagline', LOADING_LINES[0], card);
  tagline.dataset.testid = 'loading-tagline';
  let lineNo = 0;
  const lineTimer = setInterval(() => {
    tagline.classList.add('is-swapping');
    setTimeout(() => { lineNo = (lineNo + 1) % LOADING_LINES.length; tagline.textContent = LOADING_LINES[lineNo]; tagline.classList.remove('is-swapping'); }, 300);
  }, 2600);
  const fine = el('p', 'wt-fine', SIZES_NOTE, card);
  let erroring = false;

  const toError = (title: string, body: string, actions: HTMLElement[]): void => {
    erroring = true;
    clearInterval(lineTimer);
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
      const a = el('a', 'wt-link-btn', 'Open the editor');
      a.href = `/editor.html?scene=${encodeURIComponent(sceneId)}`;
      const home = el('a', 'wt-link-btn is-secondary', 'All homes');
      home.href = '/';
      toError('This home is not set up yet.', `There is no layout for "${sceneId}" yet. A broker can trace one in the editor.`, [a, home]);
    },
    showError(title, message) {
      toError(title, message, [reloadBtn()]);
    },
    hide() {
      if (erroring) return;
      clearInterval(lineTimer);
      screen.classList.add('is-hiding');
      setTimeout(() => { screen.hidden = true; }, 400);
    },
    isShowingError() {
      return erroring;
    },
  };
}
