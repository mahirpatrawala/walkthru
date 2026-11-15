// What happens after a file is chosen: check it, read it in the worker with visible progress, then either save the home and open "Check the drawing"
// or say plainly why not. Lazy chunk (fetched on the first file). Nothing is ever left on a spinner: every path ends in a result or a problem box.
import { startRead, titleFromName } from './client';
import type { ReadJob } from './client';
import { el, SAMPLE_URL } from './dom';
import { newLocalId, openStore } from './store';
import { problem } from './problems';
import type { Problem } from './problems';
import type { Progress } from './read-core';
import { LIMITS } from './problems';

export interface FlowArgs {
  status: HTMLElement;
  go: (url: string) => void;
  source: File | File[] | 'sample';
  /** called when the card can take another file */
  done: () => void;
}

const STEPS: { id: Progress['stage']; label: string }[] = [
  { id: 'open', label: 'Open the PDF' },
  { id: 'read', label: 'Find walls, rooms, doors and sizes' },
  { id: 'build', label: 'Build your home' },
];

export function showProblem(host: HTMLElement, p: Problem, again: () => void, sample: (() => void) | null): void {
  host.replaceChildren();
  const box = el('div', 'wu-problem', undefined, host);
  box.dataset.testid = 'upload-problem';
  box.dataset.code = p.code;
  box.setAttribute('role', 'alert');
  el('h3', undefined, p.title, box);
  el('p', undefined, p.detail, box);
  if (p.tips.length) { const ul = el('ul', undefined, undefined, box); for (const t of p.tips) el('li', undefined, t, ul); }
  const row = el('div', 'wu-actions', undefined, box);
  const b = el('button', 'wu-btn is-quiet', 'Choose another file', row);
  b.type = 'button';
  b.addEventListener('click', again);
  if (sample) { const s = el('button', 'wu-link', 'Try the sample plan', row); s.type = 'button'; s.addEventListener('click', sample); }
}

export async function runFlow(a: FlowArgs): Promise<void> {
  const { status } = a;
  status.replaceChildren();
  let file: File;
  let isSample = false;
  if (a.source === 'sample') {
    isSample = true;
    try {
      const res = await fetch(SAMPLE_URL, { cache: 'no-cache' });
      const bytes = await res.arrayBuffer();
      if (!res.ok || res.headers.get('content-type')?.includes('text/html')) throw new Error('missing');
      file = new File([bytes], 'Sample plan.pdf', { type: 'application/pdf' });
    } catch {
      showProblem(status, problem('failed', { detail: 'The sample plan could not be loaded. Check your connection and try again.' }), () => a.done(), null);
      a.done();
      return;
    }
  } else if (Array.isArray(a.source)) {
    if (a.source.length !== 1) { showProblem(status, problem('several-files'), () => { status.replaceChildren(); a.done(); }, null); a.done(); return; }
    file = a.source[0];
  } else file = a.source;

  const id = newLocalId();
  const title = isSample ? 'Sample plan (made-up flat)' : titleFromName(file.name);
  const run = el('div', 'wu-run', undefined, status);
  run.dataset.testid = 'upload-progress';
  el('h3', undefined, isSample ? 'Reading the sample plan' : 'Reading your plan', run);
  const list = el('ul', 'wu-steps', undefined, run);
  const items = new Map<Progress['stage'], HTMLElement>();
  for (const s of STEPS) items.set(s.id, el('li', undefined, s.label, list));
  const bar = el('div', 'wu-bar is-wait', undefined, run);
  const fill = el('div', undefined, undefined, bar);
  const time = el('p', 'wu-time', 'Starting…', run);
  time.dataset.testid = 'upload-time';
  const cancel = el('button', 'wu-link', 'Cancel', run);
  cancel.type = 'button';
  const t0 = performance.now();
  let stage: Progress['stage'] = 'open';
  let message = 'Starting';
  const paint = (): void => {
    let before = true;
    for (const s of STEPS) {
      const li = items.get(s.id)!;
      li.classList.toggle('is-now', s.id === stage);
      li.classList.toggle('is-done', before && s.id !== stage);
      if (s.id === stage) before = false;
    }
    time.textContent = `${message} · ${((performance.now() - t0) / 1000).toFixed(0)} s of at most ${LIMITS.maxSeconds}`;
  };
  const tick = setInterval(paint, 500);
  paint();

  const retry = (): void => { status.replaceChildren(); a.done(); };
  const job: ReadJob = startRead(file, id, title, isSample ? 'Made-up sample plan, read in your browser' : undefined, (p) => {
    stage = p.stage; message = p.message;
    // the file is read in one long step that cannot report from inside: the bar slides then, and fills at the ends
    const wait = p.stage === 'read' || (p.stage === 'open' && p.fraction < 0.05);
    bar.classList.toggle('is-wait', wait);
    fill.style.width = `${Math.round(p.fraction * 100)}%`;
    paint();
  });
  cancel.addEventListener('click', () => { job.cancel(); });
  const out = await job.result;
  clearInterval(tick);
  if (!out.ok) {
    if (out.problem.detail === 'Stopped.') { retry(); return; }
    showProblem(status, out.problem, retry, isSample ? null : () => { a.done(); void runFlow({ ...a, source: 'sample' }); });
    a.done();
    return;
  }
  out.data.seconds.wall = Math.round(performance.now() - t0) / 1000;
  try {
    await openStore().put({ id, createdAt: new Date().toISOString(), source: isSample ? 'sample' : 'file', data: out.data });
  } catch { /* the store never throws; a failure keeps the in-memory copy */ }
  a.done();
  a.go(`/?check=${encodeURIComponent(id)}`);
}
