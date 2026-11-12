// Owned by C9. SPEC 14.8: the editor's media panel. C5 calls mountMediaPipeline(panel, ctx) once inside its step's mount().
import type { EditorContext } from '../editor/context';
import { roomAt } from '../core/layout-geom';
import type { Vec2 } from '../types';
import { cancelJob, fetchSceneFile, getJob, listJobs, loadManifest, loadPins, savePins, sceneUrl, startJob, uploadMedia } from './client';
import './media.css';
import { MAX_CAPTION, headingDeg, matchFromPin, suggestPinPose } from './pins';
import type { JobStatus, MediaManifest, PhotoPin, StageId } from './types';

const STAGE_WORDS: Record<StageId, string> = {
  probe: 'Reading the video', frames: 'Picking frames', photos: 'Preparing photos', features: 'Finding features',
  matching: 'Matching frames', mapping: 'Working out the camera path', select: 'Choosing the best piece',
  training: 'Building the scan', publish: 'Saving',
};
const PIN_COLOUR = '#2F6BFF';
const GRAB_M = 0.45;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function mountMediaPipeline(panel: HTMLElement, ctx: EditorContext): () => void {
  const root = el('div', 'wt-media');
  root.append(el('h3', undefined, 'Video and photos'));

  // ---- 1. drop zone
  const drop = el('label', 'wt-media-drop', 'Drop the WhatsApp video and photos here');
  const input = el('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'video/*,image/*,.mp4,.mov,.m4v,.webm,.jpg,.jpeg,.png,.webp,.heic';
  drop.append(input);
  const optRow = el('label', 'wt-media-opt');
  const extra = el('input');
  extra.type = 'checkbox';
  optRow.append(extra, document.createTextNode('Also scan smaller pieces (slower)'));
  root.append(drop, optRow);

  // ---- 2. progress
  const progress = el('div');
  progress.hidden = true;
  const bar = el('div', 'wt-media-bar');
  const fill = el('div');
  bar.append(fill);
  const stageLine = el('div', 'wt-media-row');
  const stageText = el('span');
  const cancelBtn = el('button', undefined, 'Cancel');
  cancelBtn.type = 'button';
  stageLine.append(stageText, cancelBtn);
  progress.append(bar, stageLine);
  root.append(progress);

  // ---- 3. result
  const result = el('div');
  root.append(result);
  const pinsBox = el('div');
  root.append(pinsBox);
  panel.append(root);

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let jobId: string | null = null;
  let since = 0;
  let manifest: MediaManifest | null = null;
  let pins: PhotoPin[] = [];
  let selectedId: string | null = null;
  let removeLayer: (() => void) | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let dragging: { id: string; mode: 'move' | 'turn' } | null = null;

  const line = (text: string, cls = ''): void => { result.append(el('div', `wt-media-line ${cls}`.trim(), text)); };

  // ================================================================ upload and job
  async function handleFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    result.replaceChildren();
    progress.hidden = false;
    cancelBtn.hidden = true;
    try {
      const ids: string[] = [];
      for (let i = 0; i < files.length; i++) {
        stageText.textContent = `Uploading ${i + 1} of ${files.length}`;
        fill.style.width = `${(i / files.length) * 100}%`;
        ids.push((await uploadMedia(ctx.sceneId, files[i])).uploadId);
      }
      const { jobId: id } = await startJob(ctx.sceneId, ids, { patchProperty: false, trainExtraFragmentsMin: extra.checked ? 60 : 0 });
      attach(id);
    } catch (e) {
      progress.hidden = true;
      line((e as Error).message, 'wt-media-error');
    }
  }

  function attach(id: string): void {
    jobId = id;
    since = 0;
    progress.hidden = false;
    cancelBtn.hidden = false;
    void poll();
  }

  async function poll(): Promise<void> {
    if (disposed || !jobId) return;
    let st: JobStatus;
    try {
      st = await getJob(ctx.sceneId, jobId, since);
    } catch (e) {
      stageText.textContent = (e as Error).message;
      timer = setTimeout(() => { void poll(); }, 2000);
      return;
    }
    since = st.lastSeq;
    fill.style.width = `${Math.round(st.overall * 100)}%`;
    const running = st.stages.find((s) => s.state === 'running');
    stageText.textContent = st.state === 'queued' ? 'Waiting for another job to finish' : running ? STAGE_WORDS[running.id] : STAGE_WORDS.publish;
    if (st.state === 'queued' || st.state === 'running') {
      timer = setTimeout(() => { void poll(); }, 1000);
      return;
    }
    progress.hidden = true;
    jobId = null;
    if (st.state === 'done') await showResult(true);
    else if (st.state === 'cancelled') line('Cancelled.');
    else {
      line(st.error ?? 'The job failed.', 'wt-media-error');
      const retry = el('button', undefined, 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => { result.replaceChildren(); input.click(); });
      result.append(retry);
    }
  }

  cancelBtn.addEventListener('click', () => {
    if (jobId) void cancelJob(ctx.sceneId, jobId).catch(() => { /* the poll shows the outcome */ });
  });

  // ================================================================ result
  /** `apply`: a job that just finished in this session feeds the editor. A job found on mount only reports. */
  async function showResult(apply: boolean): Promise<void> {
    result.replaceChildren();
    manifest = await loadManifest(ctx.sceneId);
    if (!manifest) { await loadPinsUi(); return; }
    const r = manifest;
    if (apply && r.frames.length > 0) {
      try {
        const files = await Promise.all(r.frames.map((f) => fetchSceneFile(ctx.sceneId, f.file)));
        await ctx.frames.addImages(files);
        line(`${r.frames.length} frames ready for colour sampling.`);
      } catch (e) {
        line(`Frames could not be loaded: ${(e as Error).message}`, 'wt-media-error');
      }
    } else if (r.frames.length > 0) {
      line(`${r.frames.length} frames were saved from the last run.`);
    }
    line(r.splatReason);
    if (r.splat && apply && ctx.draft.splat === undefined) {
      ctx.draft.splat = r.splat;
      ctx.commit();
      line('Go to the Scan step to line it up with the plan.');
    }
    const c = r.fragments[0]?.coverage;
    if (c) line(`Scan covers ${c.secondsCovered} s of ${c.secondsTotal} s (${c.registeredFrames} of ${c.totalFrames} frames).`);
    for (const w of r.warnings) line(w, 'wt-media-warn');
    await loadPinsUi();
  }

  // ================================================================ photo pins
  function queueSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      savePins(ctx.sceneId, { version: 1, pins }).catch((e: Error) => { pinsBox.prepend(el('div', 'wt-media-error', `Pins were not saved: ${e.message}`)); });
    }, 250);
  }

  async function loadPinsUi(): Promise<void> {
    try {
      pins = (await loadPins(ctx.sceneId)).pins;
    } catch {
      pins = [];
    }
    if (!manifest) manifest = await loadManifest(ctx.sceneId);
    // recompute the automatic suggestion (the splat may have been pinned since)
    let changed = false;
    for (const p of pins) {
      if (p.placedBy || !p.suggested) continue;
      const match = manifest ? matchFromPin(p, manifest.frames) : null;
      const s = suggestPinPose(p, match, manifest?.cameras ?? [], ctx.draft.splat, ctx.draft.layout);
      if (JSON.stringify(s) !== JSON.stringify(p.suggested)) { p.suggested = s; changed = true; }
    }
    if (changed) queueSave();
    renderPins();
    if (!removeLayer && pins.length > 0) removeLayer = ctx.plan.addLayer(drawLayer);
    ctx.plan.refresh();
  }

  function roomLabelOf(id: string | null): string {
    return (id && ctx.draft.layout.rooms.find((r) => r.id === id)?.label) || 'this room';
  }

  const selected = (): PhotoPin | undefined => pins.find((p) => p.id === selectedId);

  function renderPins(): void {
    pinsBox.replaceChildren();
    if (pins.length === 0) return;
    pinsBox.append(el('div', 'wt-media-line', 'Photo pins: click a photo, then click the plan where it was taken. Drag from the pin to set the direction it faces.'));
    const row = el('div', 'wt-media-thumbs');
    for (const p of pins) {
      const b = el('button', `wt-media-thumb${p.id === selectedId ? ' wt-sel' : ''}${p.at ? ' wt-placed' : ''}`);
      b.type = 'button';
      b.title = p.caption ?? p.id;
      const img = el('img');
      img.src = sceneUrl(ctx.sceneId, p.thumb);
      img.alt = '';
      b.append(img);
      b.addEventListener('click', () => select(p.id));
      row.append(b);
    }
    pinsBox.append(row);
    const p = selected();
    if (!p) return;
    const detail = el('div', 'wt-media-detail');
    const cap = el('input');
    cap.type = 'text';
    cap.maxLength = MAX_CAPTION;
    cap.placeholder = 'Caption (optional)';
    cap.value = p.caption ?? '';
    cap.addEventListener('input', () => { if (cap.value) p.caption = cap.value; else delete p.caption; queueSave(); });
    detail.append(cap);
    const s = p.suggested;
    if (s && !p.placedBy) {
      if (s.at) {
        const use = el('button', undefined, `Use suggestion (${roomLabelOf(s.roomId)})`);
        use.type = 'button';
        use.addEventListener('click', () => {
          p.at = s.at; p.yawDeg = s.yawDeg; p.roomId = s.roomId; p.placedBy = 'auto';
          queueSave(); renderPins(); ctx.plan.refresh();
        });
        detail.append(use);
      } else if (s.frame) {
        const pair = el('div', 'wt-media-pair');
        const a = el('img'); a.src = sceneUrl(ctx.sceneId, p.thumb); a.alt = 'Your photo';
        const bimg = el('img'); bimg.src = sceneUrl(ctx.sceneId, s.frame); bimg.alt = 'Matching video frame';
        pair.append(a, bimg);
        detail.append(el('div', undefined, 'The closest video frame is on the right. Place the pin by eye.'), pair);
      }
    }
    if (p.at) {
      const clear = el('button', undefined, 'Take off the plan');
      clear.type = 'button';
      clear.addEventListener('click', () => { p.at = null; p.yawDeg = null; p.roomId = null; p.placedBy = null; queueSave(); renderPins(); ctx.plan.refresh(); });
      detail.append(clear);
    }
    pinsBox.append(detail);
  }

  function select(id: string): void {
    selectedId = id;
    renderPins();
    ctx.plan.setTool({
      cursor: 'crosshair',
      onDown(w: Vec2) {
        const p = selected();
        if (!p) return;
        if (p.at && Math.hypot(w.x - p.at.x, w.z - p.at.z) <= GRAB_M) {
          dragging = { id: p.id, mode: 'turn' };
        } else {
          p.at = { x: w.x, z: w.z };
          p.roomId = roomAt(ctx.draft.layout, w)?.id ?? null;
          p.placedBy = 'broker';
          dragging = { id: p.id, mode: 'turn' };
        }
        ctx.plan.refresh();
      },
      onMove(w: Vec2) {
        const p = dragging && pins.find((x) => x.id === dragging!.id);
        if (!p || !p.at) return;
        const dx = w.x - p.at.x, dz = w.z - p.at.z;
        if (Math.hypot(dx, dz) > 0.12) { p.yawDeg = Math.round(headingDeg(dx, dz)); ctx.plan.refresh(); }
      },
      onUp() {
        if (dragging) { dragging = null; queueSave(); renderPins(); }
      },
      onKey(e: KeyboardEvent) { if (e.key === 'Escape') { selectedId = null; ctx.plan.setTool(null); renderPins(); ctx.plan.refresh(); } },
      cancel() { dragging = null; },
    });
  }

  /** Camera glyph with a direction wedge for placed pins; a dashed ring at the suggested spot for the selected one. */
  function drawLayer(g: CanvasRenderingContext2D, c: { worldToScreen(v: Vec2): { x: number; y: number }; pxPerMetreOnScreen(): number }): void {
    const m = c.pxPerMetreOnScreen();
    for (const p of pins) {
      if (!p.placedBy && p.suggested?.at && p.id === selectedId) {
        const s = c.worldToScreen(p.suggested.at);
        g.save(); g.setLineDash([4, 3]); g.strokeStyle = PIN_COLOUR; g.lineWidth = 2;
        g.beginPath(); g.arc(s.x, s.y, Math.max(8, 0.3 * m), 0, Math.PI * 2); g.stroke(); g.restore();
      }
      if (!p.at) continue;
      const s = c.worldToScreen(p.at);
      const r = Math.max(7, 0.22 * m);
      const sel = p.id === selectedId;
      g.save();
      g.translate(s.x, s.y);
      if (p.yawDeg !== null) {
        // yaw 0 faces +Z, which is down the screen on the plan
        const a = (p.yawDeg * Math.PI) / 180;
        const fx = Math.sin(a), fy = Math.cos(a);
        g.fillStyle = 'rgba(47,107,255,0.35)';
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo((fx * 2.6 * r) + (-fy * 1.2 * r), (fy * 2.6 * r) + (fx * 1.2 * r));
        g.lineTo((fx * 2.6 * r) - (-fy * 1.2 * r), (fy * 2.6 * r) - (fx * 1.2 * r));
        g.closePath(); g.fill();
      }
      g.fillStyle = '#fff'; g.strokeStyle = PIN_COLOUR; g.lineWidth = sel ? 3 : 2;
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = PIN_COLOUR;
      g.fillRect(-r * 0.5, -r * 0.3, r, r * 0.6); // camera body
      g.beginPath(); g.arc(0, 0, r * 0.22, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
      g.restore();
    }
  }

  // ================================================================ wiring
  input.addEventListener('change', () => { void handleFiles([...(input.files ?? [])]); input.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('wt-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('wt-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('wt-over');
    void handleFiles([...(e.dataTransfer?.files ?? [])]);
  });

  // pick up a job that is already running, else show the last result
  void (async () => {
    try {
      const jobs = await listJobs(ctx.sceneId);
      if (disposed) return;
      const live = jobs.find((j) => j.state === 'running' || j.state === 'queued');
      if (live) { attach(live.jobId); await loadPinsUi(); return; }
    } catch { /* the dev API is not running: the panel stays usable for nothing, but must not crash */ }
    if (!disposed) await showResult(false);
  })();

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    if (saveTimer) { clearTimeout(saveTimer); void savePins(ctx.sceneId, { version: 1, pins }).catch(() => { /* leaving anyway */ }); }
    removeLayer?.();
    ctx.plan.setTool(null);
    root.remove();
  };
}
