// The "Upload your floor plan" card at the top of the start page. Only the markup and the file picking live here, so the start page stays light:
// the flow (reading, progress, problems, saving) is a lazy chunk fetched when a file is chosen, and the reader itself is a Web Worker fetched after that.
import './upload.css';
import { SUPPORTED_NOTE, PRIVACY_NOTE } from './problems';
import { SAMPLE_URL, el } from './dom';

export type Go = (url: string) => void;

export function renderUploadCard(parent: HTMLElement, go: Go): HTMLElement {
  const card = el('section', 'wu-card', undefined, parent);
  card.id = 'upload';
  card.dataset.testid = 'upload-card';
  const left = el('div', undefined, undefined, card);
  left.style.cssText = 'display:flex;flex-direction:column;gap:10px';
  el('h2', undefined, 'Upload your floor plan', left);
  el('p', 'wu-lead', 'See your own flat as a 3D home you can walk around, sit in and measure. It takes about a minute.', left);
  const kind = el('p', 'wu-kind', undefined, left);
  el('b', undefined, 'What works: ', kind);
  kind.append(SUPPORTED_NOTE);
  const priv = el('p', 'wu-private', PRIVACY_NOTE, left);
  priv.dataset.testid = 'upload-private';

  const right = el('div', undefined, undefined, card);
  right.style.cssText = 'display:flex;flex-direction:column;gap:12px;align-items:flex-start';
  const actions = el('div', 'wu-actions', undefined, right);
  const input = el('input', 'wu-file');
  input.type = 'file';
  input.accept = 'application/pdf,.pdf';
  input.dataset.testid = 'upload-input';
  input.setAttribute('aria-label', 'Choose a PDF floor plan');
  card.appendChild(input);
  const choose = el('button', 'wu-btn', 'Choose a PDF', actions);
  choose.type = 'button';
  choose.dataset.testid = 'upload-choose';
  choose.addEventListener('click', () => input.click());
  el('span', 'wu-hint', 'or drop it on this card', actions);
  const sample = el('button', 'wu-link', 'Try a sample plan', right);
  sample.type = 'button';
  sample.dataset.testid = 'upload-sample';
  el('span', 'wu-hint', 'A made-up flat, so you can see how it works without a file.', right);

  const status = el('div', 'wu-status', undefined, card);
  status.setAttribute('aria-live', 'polite');
  status.dataset.testid = 'upload-status';

  let running = false;
  const start = (source: File | 'sample' | File[]): void => {
    if (running) return;
    running = true;
    const idle = (): void => { running = false; input.value = ''; };
    void import('./flow').then((m) => m.runFlow({ status, go, source, done: idle })).catch(() => {
      status.replaceChildren();
      const p = el('div', 'wu-problem', undefined, status);
      el('h3', undefined, 'The reader could not start', p);
      el('p', undefined, 'The part that reads plans did not load. Check your connection, reload the page and try again.', p);
      idle();
    });
  };
  input.addEventListener('change', () => { const f = [...(input.files ?? [])]; if (f.length) start(f); });
  sample.addEventListener('click', () => start('sample'));
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('is-over'); });
  card.addEventListener('dragleave', () => card.classList.remove('is-over'));
  card.addEventListener('drop', (e) => { e.preventDefault(); card.classList.remove('is-over'); const f = [...(e.dataTransfer?.files ?? [])]; if (f.length) start(f); });
  void SAMPLE_URL;
  return card;
}
