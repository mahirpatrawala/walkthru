// C12e. SPEC 17.9: the editor step "Check the drawing". Upload a drawing set (PDF, JPG, PNG, several files), watch the job run, then
// work through the queue: conflicts first, then unverified values by impact. Each value shows the drawing crop with its source box
// outlined next to the value, how it was read and how sure we are. One click confirms, or type a value to correct it. There is no
// bulk confirm for unverified values (SPEC 17.1): the only "confirm all" is for values already verified against the drawing's scale.
// Every decision is saved (review.json) and the writer re-runs, so the buyer files and the 3D preview follow at once.
//
// Keys: Down/J and Up/K move, Enter confirms, C types a correction, 1 and 2 choose a side of a conflict, Escape leaves a field.
import './review.css';
import { setEditorUnverified, unverifiedRoomsFromExtras } from '../core/room-trust';
import { clear, dropZone, h } from '../editor/dom';
import { asHost } from '../editor/context';
import type { EditorContext, EditorHost, EditorStep } from '../editor/context';
import { applyProposal, proposalToPatch } from '../editor/save';
import { boxInCrop, boxToPx, cropRegion, turnOf } from './page-geometry';
import type { PageMeta, PagesFile } from './page-geometry';
import { describeDecision, parseCorrection, progressOf, progressText, RANK_NAMES, buildRows } from './review-model';
import type { Decision, ReviewFile, ReviewRow, UnderstandingDoc } from './review-model';
import { NO_VISION_NOTICE, VISION_NOTICE, VISION_NOTICE_TITLE } from './notice';

interface Loaded { doc: UnderstandingDoc; pages: PagesFile; review: ReviewFile; visionAvailable: boolean }
interface JobView { jobId: string; state: string; stages: { id: string; label: string; state: string; fraction: number; message?: string }[]; overall: number; error?: string; lastSeq: number; events: { type: string; message?: string }[]; result: { path: string; needLook: number; verified: number; conflicts: number; pages: number; vision: { used: boolean } } | null }

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp';
// the step's memory between visits (the editor unmounts a step when you leave it)
const memo: { scene: string; done: boolean } = { scene: '', done: false };

const STATE_LABEL: Record<string, string> = { verified: 'Matches the drawing', needs: 'Not checked', conflict: 'Disagrees', confirmed: 'Confirmed', corrected: 'Corrected', rejected: 'Not in the drawing' };

export const step: EditorStep = {
  id: 'review', title: 'Check the drawing', optional: true,
  mount(panel, ctx) { teardown = mountReview(panel, ctx); },
  unmount() { teardown?.(); teardown = null; },
  isDone(ctx) { return memo.scene === ctx.sceneId && memo.done; },
};
let teardown: (() => void) | null = null;

function mountReview(panel: HTMLElement, ctx: EditorContext): () => void {
  const host: EditorHost = asHost(ctx);
  const cols = panel.closest('.cols');
  cols?.classList.add('review-wide');
  panel.classList.add('review');
  const sceneId = (): string => host.sceneId;
  const api = (p: string): string => `/api/scenes/${encodeURIComponent(sceneId())}/understand${p}`;

  // ---------------------------------------------------------------- state
  let data: Loaded | null = null;
  let rows: ReviewRow[] = [];
  let selId: string | null = null;
  let files: { file: File; id?: string }[] = [];
  let visionOn = false;
  let noticeTick = false;
  let job: JobView | null = null;
  let polling = false;
  let busy = false;
  let alive = true;
  let stamp = Date.now();
  /** a quarter turn the broker added to a page whose lettering lies sideways (per page, this visit) */
  const extraTurn = new Map<number, number>();
  const turnFor = (meta: PageMeta): 0 | 90 | 180 | 270 => ((turnOf(meta) + (extraTurn.get(meta.n) ?? 0)) % 360) as 0 | 90 | 180 | 270;

  const upload = h('div', { class: 'card rv-upload' });
  const jobBox = h('div', { class: 'rv-job' });
  const summary = h('div', { class: 'rv-summary' });
  const current = h('div', { class: 'rv-current', tabIndex: 0 });
  const queue = h('div', { class: 'rv-queue' });
  const checked = h('div', { class: 'rv-checked' });
  const keys = h('p', { class: 'muted small rv-keys', text: 'Keys: Down and Up move, Enter confirms, C types a correction, 1 and 2 pick a side of a disagreement.' });
  panel.append(upload, jobBox, summary, current, keys, queue, checked);

  // ---------------------------------------------------------------- data
  async function load(): Promise<void> {
    try {
      const res = await fetch(api('/review'), { cache: 'no-store' });
      if (!res.ok) { data = null; rows = []; }
      else data = (await res.json()) as Loaded;
    } catch { data = null; rows = []; }
    if (data) rows = buildRows(data.doc, data.review);
    memo.scene = sceneId();
    memo.done = !!data && rows.length > 0 && progressOf(rows).conflicts === 0;
    if (data && !rows.some((r) => r.id === selId)) selId = firstOpen()?.id ?? rows[0]?.id ?? null;
    stamp = Date.now();
    renderAll();
  }
  const firstOpen = (): ReviewRow | undefined => rows.find((r) => r.baseStatus !== 'verified' && !r.decision);
  const queueRows = (): ReviewRow[] => rows.filter((r) => r.baseStatus !== 'verified');

  async function put(review: ReviewFile): Promise<void> {
    if (!data) return;
    busy = true; renderCurrent();
    try {
      const res = await fetch(api('/review'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(review) });
      const body = (await res.json()) as { error?: string; changed?: Changed; proposal?: unknown; extras?: unknown };
      if (!res.ok) { host.toast(body.error ?? 'Could not save that.', 'error'); return; }
      data.review = review;
      rows = buildRows(data.doc, review);
      memo.done = progressOf(rows).conflicts === 0;
      syncDraft(body.changed, body.proposal, body.extras);
    } catch (e) { host.toast(`Could not save that: ${(e as Error).message}`, 'error'); }
    finally { busy = false; renderAll(); }
  }

  interface Changed { rooms: string[]; openings: string[]; items: string[]; removedOpenings: string[]; removedItems: string[]; wallHeight: boolean }
  /** The broker's corrections reach the live draft by id, so the plan and the 3D preview change now; Save then writes property.json. */
  function syncDraft(ch: Changed | undefined, proposalRaw: unknown, extras: unknown): void {
    setEditorUnverified(unverifiedRoomsFromExtras(extras));
    const proposal = proposalRaw as { rooms?: { id: string; polygon: { x: number; z: number }[] }[]; openings?: { id: string; roomId: string; widthM: number; centreM: number; type: string; sillM: number; headM: number }[]; wallHeightM?: number } | undefined;
    const draft = host.draft;
    if (ch && proposal && draft.layout.rooms.length > 0) {
      for (const id of ch.rooms) {
        const src = proposal.rooms?.find((r) => r.id === id);
        const dst = draft.layout.rooms.find((r) => r.id === id);
        if (src && dst && src.polygon.length === dst.polygon.length) dst.polygon = src.polygon.map((p) => ({ x: p.x, z: p.z }));
      }
      const touched = new Set([...ch.openings]);
      for (const o of proposal.openings ?? []) if (ch.rooms.includes(o.roomId)) touched.add(o.id);
      for (const id of touched) {
        const src = proposal.openings?.find((o) => o.id === id);
        const dst = draft.layout.openings.find((o) => o.id === id);
        if (src && dst) { dst.widthM = src.widthM; dst.centreM = src.centreM; dst.sillM = src.sillM; dst.headM = src.headM; dst.type = src.type as typeof dst.type; }
      }
      if (ch.removedOpenings.length) draft.layout.openings = draft.layout.openings.filter((o) => !ch.removedOpenings.includes(o.id));
      const ex = extras as { furniture?: { id: string; box: { w: number; d: number }; heightM: number; surfaceHeightM: number }[] } | undefined;
      for (const id of ch.items) {
        const src = ex?.furniture?.find((f) => f.id === id);
        const dst = draft.furniture.find((f) => f.id === id);
        if (src && dst) { dst.box = { ...dst.box, w: src.box.w, d: src.box.d }; dst.heightM = src.heightM; dst.surfaceHeightM = src.surfaceHeightM; }
      }
      if (ch.removedItems.length) draft.furniture = draft.furniture.filter((f) => !ch.removedItems.includes(f.id));
      if (ch.wallHeight && typeof proposal.wallHeightM === 'number') draft.layout.wallHeightM = proposal.wallHeightM;
    }
    host.commit();
  }

  /** Put the machine's proposal into the editor (what "Load proposal" in Rooms does), with the unverified flags. */
  async function loadIntoEditor(confirmReplace: boolean): Promise<void> {
    let raw: unknown = null, extras: unknown = null;
    try {
      const res = await fetch(api('/outputs'), { cache: 'no-store' });
      if (res.ok) { const b = (await res.json()) as { proposal: unknown; extras: unknown }; raw = b.proposal; extras = b.extras; }
    } catch { /* below */ }
    if (!raw) { host.toast('The proposal could not be read.', 'error'); return; }
    let patch;
    try { patch = proposalToPatch(raw, extras); } catch (e) { host.toast(e instanceof Error ? e.message : String(e), 'error'); return; }
    const n = host.draft.layout.rooms.length;
    if (confirmReplace && n > 0 && !window.confirm(`Replace the ${n} room${n === 1 ? '' : 's'} already drawn with this drawing?`)) return;
    applyProposal(host.draft, patch);
    host.setImportNotes(patch.notes);
    setEditorUnverified(unverifiedRoomsFromExtras(extras));
    host.select({ roomId: null, openingId: null });
    host.fitPlan();
    host.commit();
    host.toast(`Loaded ${patch.rooms.length} rooms and ${patch.openings.length} openings from the drawing.`, 'info');
    renderAll();
  }

  // ---------------------------------------------------------------- upload and the job
  let uploadOpen = false;
  function renderUpload(): void {
    clear(upload);
    const have = !!data;
    if (have && !uploadOpen && !files.length && !(job && ['queued', 'running'].includes(job.state))) {
      upload.append(h('div', { class: 'rv-row' }, h('strong', { class: 'grow', text: 'Drawing set read' }), h('button', { class: 'btn small', text: 'Read a different set', onclick: () => { uploadOpen = true; renderUpload(); } })));
      return;
    }
    upload.append(h('h3', { text: have ? 'Read a different drawing set' : 'Drawing set' }));
    if (!have) upload.append(h('p', { class: 'muted small', text: 'Any architect or designer drawing, a builder brochure or a phone photo of a plan. PDF, JPG or PNG, as many files as the set has. Nothing is final until you check it here.' }));
    upload.append(dropZone({ title: 'Drop the drawing set here', hint: 'PDF, JPG or PNG, several files are fine', accept: ACCEPT, multiple: true, onFiles: (f) => { files = [...files, ...f.map((file) => ({ file }))]; renderUpload(); } }));
    if (files.length) {
      upload.append(h('ul', { class: 'rv-files' }, ...files.map((f, i) => h('li', {}, h('span', { text: `${f.file.name} (${Math.max(1, Math.round(f.file.size / 1024))} KB)` }), h('button', { class: 'btn small', text: 'Remove', onclick: () => { files = files.filter((_, k) => k !== i); renderUpload(); } })))));
      const avail = data?.visionAvailable ?? lastVision;
      const visionBox = h('input', { type: 'checkbox', checked: visionOn && avail, disabled: !avail, onchange: (e: Event) => { visionOn = (e.target as HTMLInputElement).checked; if (!visionOn) noticeTick = false; renderUpload(); } });
      upload.append(h('label', { class: 'rv-vision' }, visionBox, h('span', { text: ' Use AI to read pictures of plans' })));
      if (!avail) upload.append(h('p', { class: 'muted small', text: NO_VISION_NOTICE + ' (No model key was found, so pictures cannot be read yet.)' }));
      else if (visionOn) {
        upload.append(h('div', { class: 'rv-notice' }, h('strong', { text: VISION_NOTICE_TITLE }), h('p', { class: 'small', text: VISION_NOTICE }),
          h('label', {}, h('input', { type: 'checkbox', checked: noticeTick, onchange: (e: Event) => { noticeTick = (e.target as HTMLInputElement).checked; renderUpload(); } }), h('span', { text: ' I understand, send small pieces of the drawing' }))));
      } else upload.append(h('p', { class: 'muted small', text: NO_VISION_NOTICE }));
      const running = job && (job.state === 'queued' || job.state === 'running');
      upload.append(h('button', { class: 'btn primary', text: 'Read the drawing set', disabled: !!running || (visionOn && !noticeTick), onclick: () => void start() }));
    }
  }
  let lastVision = false;

  async function start(): Promise<void> {
    if (!files.length) return;
    try {
      for (const f of files) {
        const res = await fetch(api(''), { method: 'POST', body: f.file });
        const body = (await res.json()) as { uploadId?: string; error?: string };
        if (!res.ok || !body.uploadId) { host.toast(body.error ?? 'An upload failed.', 'error'); return; }
        f.id = body.uploadId;
      }
      const res = await fetch(api('/run'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uploadIds: files.map((f) => f.id), vision: visionOn, noticeAccepted: noticeTick }) });
      const body = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !body.jobId) { host.toast(body.error ?? 'Could not start.', 'error'); return; }
      files = [];
      job = null;
      void poll(body.jobId);
    } catch (e) { host.toast(`Could not reach the dev server: ${(e as Error).message}`, 'error'); }
  }

  async function poll(jobId?: string): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      while (alive) {
        const res = await fetch(api(`/status${jobId ? `?job=${jobId}` : ''}`), { cache: 'no-store' });
        if (!res.ok) break;
        const body = (await res.json()) as { job: JobView | null; visionAvailable: boolean; hasUnderstanding: boolean };
        lastVision = body.visionAvailable;
        job = body.job;
        renderJob(); renderUpload();
        if (!job || !['queued', 'running'].includes(job.state)) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    } finally { polling = false; }
    if (job?.state === 'done') {
      await load();
      if (host.draft.layout.rooms.length === 0) await loadIntoEditor(false);
    } else if (job?.state === 'failed') host.toast(job.error ?? 'The drawing could not be read.', 'error');
    renderAll();
  }

  function renderJob(): void {
    clear(jobBox);
    if (!job || job.state === 'done' && data) return;
    const running = job.state === 'queued' || job.state === 'running';
    jobBox.append(h('div', { class: 'card' },
      h('strong', { text: running ? 'Reading the drawing set' : job.state === 'failed' ? 'It could not be read' : job.state === 'cancelled' ? 'Cancelled' : 'Done' }),
      h('div', { class: 'rv-bar' }, h('div', { class: 'rv-bar-fill', style: `width:${Math.round(job.overall * 100)}%` })),
      h('ul', { class: 'rv-stages' }, ...job.stages.map((s) => h('li', { class: s.state }, h('span', { text: `${s.state === 'done' ? '✓' : s.state === 'running' ? '…' : s.state === 'failed' ? '✗' : '·'} ${s.label}` }), s.message ? h('span', { class: 'muted small', text: ` ${s.message}` }) : null))),
      job.error ? h('p', { class: 'err', text: job.error }) : null,
      ...job.events.filter((e) => e.type === 'warning').slice(-3).map((e) => h('p', { class: 'muted small', text: e.message })),
      running ? h('button', { class: 'btn small', text: 'Cancel', onclick: () => { void fetch(api(`/jobs/${job!.jobId}`), { method: 'DELETE' }); } }) : null));
  }

  // ---------------------------------------------------------------- the queue
  const queueIndex = (): number => queueRows().findIndex((r) => r.id === selId);
  function select(id: string, focus = false): void {
    selId = id;
    renderCurrent(); renderQueue();
    const row = rows.find((r) => r.id === id);
    if (row?.target.kind === 'room' && host.draft.layout.rooms.some((r) => r.id === (row.target as { roomId: string }).roomId)) host.select({ roomId: row.target.roomId });
    else if (row?.target.kind === 'opening' && host.draft.layout.openings.some((o) => o.id === (row.target as { openingId: string }).openingId)) host.select({ openingId: row.target.openingId });
    current.scrollIntoView({ block: 'start' });
    if (focus) current.focus();
  }
  function move(dir: 1 | -1): void {
    const q = queueRows(); if (!q.length) return;
    const i = Math.max(0, Math.min(q.length - 1, (queueIndex() < 0 ? (dir === 1 ? -1 : q.length) : queueIndex()) + dir));
    select(q[i].id, true);
  }
  function nextOpenAfter(id: string): string | null {
    const q = queueRows(); const i = q.findIndex((r) => r.id === id);
    const after = [...q.slice(i + 1), ...q.slice(0, i + 1)].find((r) => !r.decision);
    return after?.id ?? null;
  }

  async function decide(row: ReviewRow, d: Decision | null): Promise<void> {
    if (!data || busy) return;
    const next = d ? nextOpenAfter(row.id) : row.id;
    const decisions = { ...data.review.decisions };
    if (d) decisions[row.id] = d; else delete decisions[row.id];
    await put({ version: 1, decisions });
    if (next) selId = next;
    renderAll();
    if (next) select(next, true);
  }
  const now = (): string => new Date().toISOString();
  const confirm = (row: ReviewRow): Promise<void> => decide(row, { action: 'confirm', at: now() });
  async function correct(row: ReviewRow, text: string, input: HTMLInputElement, err: HTMLElement): Promise<void> {
    const p = parseCorrection(row, text);
    if (!p.ok) { err.textContent = p.error; input.classList.add('bad'); return; }
    await decide(row, { action: 'correct', value: p.value, at: now() });
  }

  // ---------------------------------------------------------------- drawing crops
  function cropFor(row: ReviewRow, source: ReviewRow['source'], label?: string): HTMLElement {
    const meta = data?.pages.pages.find((p) => p.n === source.page);
    const wrap = h('figure', { class: 'rv-crop' });
    if (!meta) { wrap.append(h('p', { class: 'muted small', text: 'No picture of this page.' })); return wrap; }
    const { region, box } = cropRegion(meta, source.bbox);
    const turn = turnFor(meta);
    const img = h('img', { alt: 'The part of the drawing this value was read from', src: `${api('/crop')}?page=${meta.n}&rect=${region.join(',')}&w=720&turn=${turn}&t=${stamp}`, draggable: false });
    const holder = h('div', { class: 'rv-img' }, img);
    if (box) {
      const f = boxInCrop(region, box, turn);
      holder.append(h('div', { class: 'rv-hl', style: `left:${(f[0] * 100).toFixed(2)}%;top:${(f[1] * 100).toFixed(2)}%;width:${((f[2] - f[0]) * 100).toFixed(2)}%;height:${((f[3] - f[1]) * 100).toFixed(2)}%` }));
    }
    holder.addEventListener('click', () => openPage(meta, source.bbox));
    holder.title = 'Click to see the whole page';
    wrap.append(holder, h('figcaption', { class: 'muted small' }, `${label ? `${label}, ` : ''}page ${meta.n}${box ? '' : ', location not known'} `, h('button', { class: 'btn small', text: 'Turn', title: 'Turn the picture a quarter turn if the writing lies sideways', onclick: () => { extraTurn.set(meta.n, ((extraTurn.get(meta.n) ?? 0) + 90) % 360); stamp = Date.now(); renderCurrent(); } })));
    void row;
    return wrap;
  }

  /** The whole page, zoomable (wheel) and draggable, with the source box outlined (SPEC 17.9, left side). */
  function openPage(meta: PageMeta, bbox: [number, number, number, number]): void {
    const turn = turnFor(meta);
    const px = boxToPx(meta, bbox);
    const inner = h('div', { class: 'rv-page-inner' });
    const img = h('img', { src: `${api(`/page/${meta.n}.png`)}?w=2600&turn=${turn}&t=${stamp}`, draggable: false });
    inner.append(img);
    if (px) {
      const f = boxInCrop([0, 0, meta.w, meta.h], px, turn);
      inner.append(h('div', { class: 'rv-hl', style: `left:${f[0] * 100}%;top:${f[1] * 100}%;width:${(f[2] - f[0]) * 100}%;height:${(f[3] - f[1]) * 100}%` }));
    }
    let scale = 1, tx = 0, ty = 0;
    const apply = (): void => { inner.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
    const shade = h('div', { class: 'rv-page' }, inner, h('button', { class: 'btn rv-page-close', text: 'Close (Esc)', onclick: () => close() }), h('span', { class: 'rv-page-hint', text: 'Wheel to zoom, drag to move' }));
    const close = (): void => { shade.remove(); window.removeEventListener('keydown', onKey, true); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    shade.addEventListener('wheel', (e) => { e.preventDefault(); const k = e.deltaY < 0 ? 1.15 : 1 / 1.15; scale = Math.max(0.5, Math.min(12, scale * k)); apply(); }, { passive: false });
    let drag: { x: number; y: number; tx: number; ty: number } | null = null;
    shade.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('button')) return; drag = { x: e.clientX, y: e.clientY, tx, ty }; shade.setPointerCapture(e.pointerId); });
    shade.addEventListener('pointermove', (e) => { if (drag) { tx = drag.tx + e.clientX - drag.x; ty = drag.ty + e.clientY - drag.y; apply(); } });
    shade.addEventListener('pointerup', () => { drag = null; });
    document.body.append(shade);
    // start zoomed on the box when there is one
    img.addEventListener('load', () => {
      if (!px) return;
      const f = boxInCrop([0, 0, meta.w, meta.h], px, turn);
      const W = shade.clientWidth, H = shade.clientHeight;
      const iw = img.clientWidth, ih = img.clientHeight;
      scale = Math.max(1, Math.min(6, 0.4 / Math.max(f[2] - f[0], (f[3] - f[1]) * (ih / iw) * (W / H))));
      const cx = ((f[0] + f[2]) / 2 - 0.5) * iw, cy = ((f[1] + f[3]) / 2 - 0.5) * ih;
      tx = -cx * scale; ty = -cy * scale; apply();
    });
  }

  // ---------------------------------------------------------------- rendering
  function renderSummary(): void {
    clear(summary);
    if (!data) return;
    const p = progressOf(rows);
    summary.append(
      h('div', { class: 'rv-count' }, h('strong', { text: progressText(p) }), h('span', { class: 'muted', text: p.open ? `  ${p.open} still need a look` : '  nothing left to check' })),
      h('div', { class: 'rv-bar' }, h('div', { class: 'rv-bar-fill', style: `width:${p.total ? Math.round((100 * p.checked) / p.total) : 100}%` })),
      h('p', { class: `small ${p.conflicts ? 'err' : 'muted'}`, text: p.conflicts ? `${p.conflicts} disagreement${p.conflicts === 1 ? '' : 's'} to settle before this step is done. Values you do not check stay out of what the buyer is told.` : `${p.verified} value${p.verified === 1 ? '' : 's'} already match the drawing's own scale. Values you do not check stay out of what the buyer is told.` }),
      h('button', { class: 'btn small', text: 'Load this drawing into the editor', title: 'Replace the editor\'s rooms with the drawing\'s', onclick: () => void loadIntoEditor(true) }),
    );
  }

  function renderCurrent(): void {
    clear(current);
    const row = rows.find((r) => r.id === selId);
    if (!data) { current.append(h('p', { class: 'muted', text: 'Upload a drawing set above and the values that need your eye will be listed here.' })); return; }
    if (!row) { current.append(h('p', { class: 'ok', text: 'Nothing to check in this drawing.' })); return; }
    const conflict = row.baseStatus === 'conflict';
    const head = h('div', { class: 'rv-head' }, h('strong', { text: row.title }), h('span', { class: `chip ${row.state}`, text: STATE_LABEL[row.state] }));
    const crops = h('div', { class: `rv-crops${conflict && row.alternatives.some((a) => a.source && (a.source.page !== row.source.page || a.source.bbox.join() !== row.source.bbox.join())) ? ' two' : ''}` }, cropFor(row, row.source, 'drawing'));
    const other = row.alternatives.find((a) => a.source && (a.source.page !== row.source.page || a.source.bbox.join() !== row.source.bbox.join()));
    if (conflict && other?.source) crops.append(cropFor(row, other.source, 'other reading'));
    const meta = h('dl', { class: 'rv-meta' },
      h('dt', { text: 'Read as' }), h('dd', { class: 'val', text: row.display }),
      h('dt', { text: 'How' }), h('dd', { text: row.how }),
      h('dt', { text: 'Sure' }), h('dd', { text: `${Math.round(row.confidence * 100)}% (only for ordering this list, never a fact)` }),
      ...(row.conflict ? [h('dt', { text: 'Problem' }), h('dd', { class: 'err', text: row.conflict })] : []));
    current.append(head, crops, meta);

    if (row.decision) {
      current.append(h('p', { class: 'rv-done' }, h('strong', { text: describeDecision(row) }), ' ', h('button', { class: 'btn small', text: 'Undo', disabled: busy, onclick: () => void decide(row, null) })));
      return;
    }
    const actions = h('div', { class: 'rv-actions' });
    if (conflict) {
      const choices = [{ label: row.display, confirm: true, value: row.value as unknown }, ...row.alternatives.map((a) => ({ label: a.display, confirm: false, value: a.value }))];
      actions.append(...choices.map((c, i) => h('div', { class: 'rv-choice' }, h('div', { class: 'small', text: i === 0 ? `Main reading, ${row.primaryHow}` : `Other reading, ${row.alternatives[i - 1]?.how ?? 'from the drawing'}` }), h('div', { class: 'val', text: c.label }),
        h('button', { class: 'btn', text: `Use this one (${i + 1})`, disabled: busy, 'data-choice': String(i + 1), onclick: () => void decide(row, c.confirm ? { action: 'confirm', at: now() } : { action: 'correct', value: c.value, at: now() }) }))));
    } else {
      actions.append(h('button', { class: 'btn primary', text: 'Confirm (Enter)', disabled: busy, 'data-act': 'confirm', onclick: () => void confirm(row) }));
    }
    const err = h('span', { class: 'err small' });
    const input = h('input', { type: 'text', class: 'rv-input', placeholder: row.input === 'size' ? "12'0\" x 10'6\" or 3.6 x 3.2 m" : row.input === 'count' ? 'a whole number' : row.input === 'hinge' ? 'left, right or outer-edges' : row.input === 'opening' ? "2'8\" or 0.8 m (or window 1.2 m)" : "9'6\" or 2.9 m", 'aria-label': 'Type the correct value' });
    input.addEventListener('input', () => { input.classList.remove('bad'); err.textContent = ''; });
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); void correct(row, input.value, input, err); } else if (e.key === 'Escape') { input.blur(); current.focus(); } });
    actions.append(h('div', { class: 'rv-correct' }, h('label', { class: 'small', text: 'Or type the right value (C)' }), h('div', { class: 'rv-row' }, input, h('button', { class: 'btn', text: 'Correct', disabled: busy, 'data-act': 'correct', onclick: () => void correct(row, input.value, input, err) })), err),
      h('button', { class: 'btn small', text: 'Not in the drawing', disabled: busy, title: 'This value is not on the drawing. A door, a window or a piece of furniture is left out of the flat.', onclick: () => void decide(row, { action: 'reject', at: now() }) }));
    current.append(actions);
  }

  function renderQueue(): void {
    clear(queue);
    if (!data) return;
    const q = queueRows();
    let rank = -1;
    for (const r of q) {
      if (r.rank !== rank) {
        rank = r.rank;
        const n = q.filter((x) => x.rank === rank);
        queue.append(h('h4', { class: `rv-rank${rank === 0 ? ' conflict' : ''}`, text: `${RANK_NAMES[rank]} (${n.filter((x) => !x.decision).length} of ${n.length} open)` }));
      }
      queue.append(h('button', { class: `rv-q ${r.state}${r.id === selId ? ' on' : ''}`, onclick: () => select(r.id), 'data-state': r.state },
        h('span', { class: 'dot' }), h('span', { class: 'rv-q-title', text: r.title }), h('span', { class: 'rv-q-val muted small', text: r.decision ? describeDecision(r) : r.display.split(' · ')[0] })));
    }
  }

  function renderChecked(): void {
    clear(checked);
    if (!data) return;
    const ver = rows.filter((r) => r.baseStatus === 'verified');
    if (!ver.length) return;
    const byPage = new Map<number, ReviewRow[]>();
    for (const r of ver) byPage.set(r.source.page, [...(byPage.get(r.source.page) ?? []), r]);
    const open = ver.filter((r) => !r.decision);
    const det = h('details', {}, h('summary', { text: `Checked against the drawing (${ver.length})` }),
      h('p', { class: 'muted small', text: 'These were read from the drawing and agree with its own scale, so they need no action. Confirming them here is optional.' }));
    for (const [page, list] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
      const todo = list.filter((r) => !r.decision);
      det.append(h('div', { class: 'rv-page-group' }, h('strong', { class: 'small', text: `Page ${page}: ${list.length} value${list.length === 1 ? '' : 's'}` }),
        h('button', { class: 'btn small', text: `Confirm all on page ${page} that match the drawing's scale`, disabled: busy || !todo.length, onclick: () => void bulkVerified(todo) })));
      det.append(h('ul', { class: 'rv-vlist' }, ...list.slice(0, 40).map((r) => h('li', {}, h('span', { class: 'dot ok' }), ` ${r.title}: ${r.display.split(' · ')[0]}`, r.decision ? h('span', { class: 'muted small', text: ' (confirmed)' }) : null))));
    }
    void open;
    checked.append(det);
  }
  /** SPEC 17.9: offered only for rows that are already `verified`. Unverified values never go through here. */
  async function bulkVerified(list: ReviewRow[]): Promise<void> {
    if (!data || busy) return;
    const decisions = { ...data.review.decisions };
    for (const r of list) if (r.baseStatus === 'verified' && !r.decision) decisions[r.id] = { action: 'confirm', at: now() };
    await put({ version: 1, decisions });
  }

  function renderAll(): void { renderUpload(); renderJob(); renderSummary(); renderCurrent(); renderQueue(); renderChecked(); }

  // ---------------------------------------------------------------- keyboard
  const onKey = (e: KeyboardEvent): void => {
    if (!alive || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (document.querySelector('.rv-page')) return;
    if (!panel.contains(t) && t !== document.body) return;
    const row = rows.find((r) => r.id === selId);
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' && row && !row.decision && row.baseStatus !== 'conflict' && !(t instanceof HTMLButtonElement)) { e.preventDefault(); void confirm(row); }
    else if ((e.key === 'c' || e.key === 'C') && row && !row.decision) { e.preventDefault(); current.querySelector<HTMLInputElement>('.rv-input')?.focus(); }
    else if ((e.key === '1' || e.key === '2') && row && !row.decision && row.baseStatus === 'conflict') { e.preventDefault(); current.querySelector<HTMLButtonElement>(`[data-choice="${e.key}"]`)?.click(); }
  };
  window.addEventListener('keydown', onKey);

  // ---------------------------------------------------------------- go
  renderAll();
  void (async () => {
    try {
      const res = await fetch(api('/status'), { cache: 'no-store' });
      if (res.ok) {
        const body = (await res.json()) as { job: JobView | null; visionAvailable: boolean; hasUnderstanding: boolean };
        lastVision = body.visionAvailable; job = body.job;
        if (job && ['queued', 'running'].includes(job.state)) void poll(job.jobId);
        if (body.hasUnderstanding) { await load(); if (alive && data && host.draft.layout.rooms.length === 0) await loadIntoEditor(false); } else renderAll();
      }
    } catch { /* the dev API is not there: the step says so below */ }
    if (!alive) return;
    if (!data && !job) upload.append(h('p', { class: 'muted small', text: 'This step needs the dev server (npm run dev).' }));
  })();

  return () => {
    alive = false;
    window.removeEventListener('keydown', onKey);
    document.querySelector('.rv-page')?.remove();
    cols?.classList.remove('review-wide');
    panel.classList.remove('review');
  };
}
