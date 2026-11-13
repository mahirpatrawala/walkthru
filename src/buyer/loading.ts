// Owned by C3. B1: the loading screen, and the on-screen error states (SPEC 2.1).
import { el } from './hud';

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
  const screen = el('div', 'wt-screen', undefined, parent);
  screen.dataset.testid = 'loading';
  const card = el('div', 'wt-screen-card', undefined, screen);
  const h1 = el('h1', undefined, 'walkthru', card);
  const sub = el('p', 'wt-sub', 'Opening the home…', card);
  const bar = el('div', 'wt-progress', undefined, card);
  const fill = el('div', undefined, undefined, bar);
  const status = el('p', 'wt-status', '', card);
  el('p', 'wt-tagline', 'Walk around. Try a bed. Check the sizes.', card);
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
      toError('This home is not set up yet.', `There is no layout for "${sceneId}" yet. A broker can trace one in the editor.`, [a]);
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
