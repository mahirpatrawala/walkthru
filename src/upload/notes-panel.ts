// On the walking page, an uploaded home says what it is: the tag under the room chip ("Read automatically from your upload, not checked by a
// person") and, one tap away, "What we could not read" and where the printed sizes and drawn walls disagree. Loaded only for uploaded homes.
import './notes.css';
import type { UploadNotes } from './honesty';
import { tagFor } from './honesty';
import { SAMPLE_UPLOAD_TAG } from './tag';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

export function mountUploadNote(hudRoot: HTMLElement, notes: UploadNotes, homeId: string, madeUp: boolean): () => void {
  const tag = hudRoot.querySelector<HTMLElement>('.wt-scene-tag');
  if (tag) {
    tag.classList.add('wt-upload-tag');
    tag.dataset.ui = '1';
    tag.textContent = madeUp ? SAMPLE_UPLOAD_TAG : tagFor(notes.checkedByYou);
  }
  const count = notes.unread.length + notes.conflicts.length;
  const more = el('button', 'wt-upload-more', count > 0 ? `What we could not read (${count})` : 'About this home', tag ?? hudRoot);
  more.type = 'button';
  more.dataset.testid = 'upload-notes-open';
  more.dataset.ui = '1';

  const back = el('div', 'wt-rooms', undefined, document.body);
  back.hidden = true;
  back.dataset.testid = 'upload-notes';
  const card = el('div', 'wt-rooms-card wt-upload-sheet', undefined, back);
  const head = el('div', 'wt-rooms-head', undefined, card);
  el('h2', undefined, 'About this home', head);
  const x = el('button', 'wt-x', '×', head);
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');
  el('p', undefined, madeUp
    ? 'This is a made-up sample plan, read automatically in your browser. Nobody checked it.'
    : 'firstbeam read your plan automatically, in your browser. Nobody checked it, so treat sizes as the drawing’s, not as measured on site.', card);
  el('h3', undefined, 'What we could not read', card);
  if (notes.unread.length === 0) el('p', undefined, 'Nothing the reader flagged.', card);
  else { const ul = el('ul', undefined, undefined, card); for (const u of notes.unread) el('li', undefined, u, ul); }
  if (notes.conflicts.length) {
    el('h3', undefined, 'Printed size and drawn walls disagree', card);
    const ul = el('ul', undefined, undefined, card);
    for (const c of notes.conflicts) el('li', undefined, c, ul);
  }
  const p = el('p', undefined, undefined, card);
  const a = el('a', undefined, 'Check the drawing', p);
  a.href = `/?check=${encodeURIComponent(homeId)}`;
  p.append(' to confirm room names and sizes yourself. This plan stays on this device.');

  const close = (): void => { back.hidden = true; };
  const openIt = (): void => { back.hidden = false; };
  more.addEventListener('click', openIt);
  x.addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  const onKey = (e: KeyboardEvent): void => { if (!back.hidden && e.key === 'Escape') { e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  return () => { window.removeEventListener('keydown', onKey, true); back.remove(); more.remove(); };
}
