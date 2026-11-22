// "Check the drawing", client side. After an upload the visitor sees what the reader found before walking: room names and sizes, each marked as
// matching the drawing, not checked or in conflict, with Looks right and Fix size (the broker review's own rows and parsers, src/understand/review-model.ts),
// the list of what could not be read, and where printed sizes and drawn walls disagree. Skippable: "Skip this step" goes straight to the start-room picker.
// Every decision rebuilds the home and saves it, so nothing is lost if the page is closed.
import { unverifiedRoomsFromExtras } from '../core/room-trust';
import { roomTypeOf } from '../import/labels';
import { planSvg } from '../start/plan-svg';
import type { PlanLayout } from '../start/manifest';
import { BRAND_MARK } from '../brand/mark';
import { applyReview } from '../understand/review-apply';
import { buildRows, emptyReview, parseCorrection } from '../understand/review-model';
import type { ReviewFile, ReviewRow } from '../understand/review-model';
import { buildHome } from './home';
import { notesFor, tagFor } from './honesty';
import { SAMPLE_UPLOAD_TAG } from './tag';
import { el } from './dom';
import { openStore } from './store';
import type { HomeStore, StoredHome } from './store';

type Go = (url: string) => void;

/** The home as it stands after the visitor's decisions and names: pure, so a test can run it. */
export function rebuild(rec: StoredHome, review: ReviewFile, renames: Record<string, string>, title: string): StoredHome {
  const d = rec.data;
  const applied = applyReview(d.base, d.doc, review);
  let renamed = 0;
  for (const r of applied.proposal.rooms) {
    const n = renames[r.id]?.trim();
    if (!n || n === r.label) continue;
    renamed++;
    r.label = n;
    const t = roomTypeOf(n);
    if (t !== 'other') r.roomType = t;
    const f = applied.extras.rooms.find((x) => x.id === r.id);
    if (f) { f.label = n; if (t !== 'other') f.roomType = t; }
  }
  const subtitle = d.property.subtitle ?? 'Read from an uploaded plan';
  const property = buildHome(rec.id, applied.proposal, applied.extras, title.trim() || d.property.title, subtitle);
  const partial = property.layout.rooms.filter((r) => r.partial).map((r) => ({ label: r.label, reason: r.partial!.reason }));
  const checked = Object.keys(review.decisions).length + renamed;
  const notes = notesFor(applied.extras, unverifiedRoomsFromExtras(applied.extras), partial, checked);
  return { ...rec, review, renames, data: { ...d, property, extras: applied.extras, designs: applied.designs, notes } };
}

const STATE: Record<string, { text: string; cls: string }> = {
  verified: { text: 'Matches the drawing', cls: 'is-ok' },
  confirmed: { text: 'Confirmed by you', cls: 'is-ok' },
  corrected: { text: 'Corrected by you', cls: 'is-ok' },
  needs: { text: 'Not checked', cls: '' },
  conflict: { text: 'Disagrees', cls: 'is-bad' },
  rejected: { text: 'Not in the drawing', cls: '' },
};

export async function renderCheck(root: HTMLElement, id: string, go: Go, store: HomeStore = openStore()): Promise<void> {
  root.replaceChildren();
  root.scrollTop = 0;
  let rec = await store.get(id);
  const top = el('div', 'ws-top', undefined, root);
  const back = el('a', 'ws-back', '← All homes', top);
  back.href = '/';
  back.addEventListener('click', (e) => { if (e.button === 0 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go('/'); } });
  const brand = el('span', 'wt-brand', undefined, top);
  brand.innerHTML = `${BRAND_MARK}<span>firstbeam</span>`; // a fixed string from src/brand/mark.ts
  if (!rec) {
    const box = el('div', 'ws-empty', undefined, root);
    el('h1', undefined, 'This plan is not on this device', box);
    el('p', undefined, 'Uploaded plans stay in the browser that read them. Open firstbeam in that browser, or upload the plan again.', box);
    return;
  }
  document.title = 'Check the drawing · firstbeam';
  let current: StoredHome = rec;
  let review: ReviewFile = rec.review ?? emptyReview();
  const renames: Record<string, string> = { ...(rec.renames ?? {}) };
  let title = rec.data.property.title;
  const open = new Set<string>(); // rows whose "Fix size" field is open

  const wrap = el('div', 'wc', undefined, root);
  wrap.dataset.testid = 'check-drawing';
  const planBox = el('div', 'wc-plan', undefined, wrap);
  const side = el('div', 'wc-side', undefined, wrap);

  const persist = (): void => { void store.put(current).catch(() => {}); };
  const apply = (): void => { current = rebuild(current, review, renames, title); persist(); paint(); };

  function paint(): void {
    const p = current.data.property;
    const unverified = unverifiedRoomsFromExtras(current.data.extras);
    planBox.innerHTML = planSvg(p.layout as PlanLayout, unverified, { idPrefix: 'chk', title: `Floor plan of ${p.title}` }).svg; // escaped markup from plan-svg.ts
    side.replaceChildren();
    const tag = el('span', 'wc-tag', current.source === 'sample' ? SAMPLE_UPLOAD_TAG : tagFor(current.data.notes.checkedByYou), side);
    tag.dataset.testid = 'check-tag';
    el('h1', undefined, 'Check the drawing', side);
    el('p', 'wc-lead', 'We read your plan on this device. Look the rooms over before you walk. Anything we could not confirm stays marked “not measured”. You can skip this step.', side);
    const s = current.data.seconds;
    const t = el('p', 'wc-time', `Read in ${(s.wall ?? s.total).toFixed(1)} s on this device (open ${s.open.toFixed(1)} s, read ${s.read.toFixed(1)} s, build ${s.build.toFixed(1)} s) · ${current.data.pages} page${current.data.pages === 1 ? '' : 's'}`, side);
    t.dataset.testid = 'check-timing';

    const nameLabel = el('label', 'wc-name', 'Name of this home', side);
    const nameIn = el('input', undefined, undefined, nameLabel);
    nameIn.value = title; nameIn.maxLength = 60; nameIn.dataset.testid = 'check-title';
    nameIn.addEventListener('change', () => { title = nameIn.value; apply(); });

    el('h2', undefined, 'Rooms', side);
    const rows = buildRows(current.data.doc, review).filter((r) => r.kind === 'room-size');
    const list = el('div', 'wc-rooms', undefined, side);
    for (const row of rows) list.appendChild(roomRow(row));
    if (rows.length === 0) el('p', 'wc-lead', 'No room sizes to check.', list);

    if (current.data.notes.conflicts.length) {
      const box = el('div', 'wc-box is-conflict', undefined, side);
      box.dataset.testid = 'check-conflicts';
      el('h2', undefined, 'Printed size and drawn walls disagree', box);
      const ul = el('ul', 'wc-list', undefined, box);
      for (const c of current.data.notes.conflicts) el('li', undefined, c, ul);
    }
    const unread = el('div', 'wc-box', undefined, side);
    unread.dataset.testid = 'check-unread';
    el('h2', undefined, 'What we could not read', unread);
    if (current.data.notes.unread.length === 0) el('p', 'wc-lead', 'Nothing the reader flagged.', unread);
    else { const ul = el('ul', 'wc-list', undefined, unread); for (const u of current.data.notes.unread) el('li', undefined, u, ul); }

    const bar = el('div', 'wc-bar', undefined, side);
    const go1 = el('button', 'wu-btn', 'Choose where to start', bar);
    go1.type = 'button'; go1.dataset.testid = 'check-continue';
    go1.addEventListener('click', () => go(`/?home=${encodeURIComponent(id)}`));
    const skip = el('button', 'wu-link', 'Skip this step', bar);
    skip.type = 'button'; skip.dataset.testid = 'check-skip';
    skip.addEventListener('click', () => go(`/?home=${encodeURIComponent(id)}`));
  }

  function roomRow(row: ReviewRow): HTMLElement {
    const roomId = row.target.kind === 'room' ? row.target.roomId : '';
    const st = STATE[row.state] ?? STATE.needs;
    const box = el('div', `wc-row${row.state === 'conflict' ? ' is-conflict' : ''}${row.decision ? ' is-done' : ''}`);
    box.dataset.room = roomId;
    const topRow = el('div', 'wc-row-top', undefined, box);
    const nameIn = el('input', undefined, undefined, topRow);
    nameIn.value = current.data.property.layout.rooms.find((r) => r.id === roomId)?.label ?? row.title.replace(/ · size$/, '');
    nameIn.maxLength = 40; nameIn.setAttribute('aria-label', 'Room name');
    nameIn.addEventListener('change', () => { renames[roomId] = nameIn.value; apply(); });
    el('span', `wc-badge ${st.cls}`, st.text, topRow);
    el('div', 'wc-size', row.display, box);
    // the broker model's own sentence can name the same size twice when the reader redrew the room at the printed size: the notes say it properly
    const roomName = current.data.property.layout.rooms.find((r) => r.id === roomId)?.label ?? '';
    const said = row.state === 'conflict' ? current.data.notes.conflicts.find((c) => c.startsWith(`${roomName}:`) || c.includes(`Room "${roomName}"`)) : undefined;
    el('div', 'wc-how', row.decision ? (row.decision.action === 'correct' ? 'typed by you' : 'confirmed by you') : said ?? row.conflict ?? row.how, box);
    const acts = el('div', 'wc-acts', undefined, box);
    if (!row.decision && row.baseStatus !== 'verified') {
      const ok = el('button', 'wu-btn is-quiet', 'Looks right', acts);
      ok.type = 'button';
      ok.addEventListener('click', () => { review = { ...review, decisions: { ...review.decisions, [row.id]: { action: 'confirm', at: new Date().toISOString() } } }; apply(); });
    }
    if (row.decision) {
      const undo = el('button', 'wu-btn is-quiet', 'Undo', acts);
      undo.type = 'button';
      undo.addEventListener('click', () => { const d = { ...review.decisions }; delete d[row.id]; review = { ...review, decisions: d }; apply(); });
    } else {
      const fix = el('button', 'wu-btn is-quiet', 'Fix size', acts);
      fix.type = 'button';
      fix.addEventListener('click', () => { if (open.has(row.id)) open.delete(row.id); else open.add(row.id); paint(); });
    }
    if (open.has(row.id) && !row.decision) {
      const form = el('form', 'wc-fix', undefined, box);
      const inp = el('input', undefined, undefined, form);
      inp.placeholder = `e.g. 12'0" x 10'6" or 3.6 x 3.2 m`;
      inp.setAttribute('aria-label', 'Correct size');
      const apBtn = el('button', 'wu-btn is-quiet', 'Use this size', form);
      apBtn.type = 'submit';
      const err = el('div', 'wc-err', undefined, box);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const parsed = parseCorrection(row, inp.value);
        if (!parsed.ok) { err.textContent = parsed.error; return; }
        open.delete(row.id);
        review = { ...review, decisions: { ...review.decisions, [row.id]: { action: 'correct', value: parsed.value, at: new Date().toISOString() } } };
        apply();
      });
    }
    return box;
  }

  paint();
}
