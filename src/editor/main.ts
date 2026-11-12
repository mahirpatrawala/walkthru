// Owned by C5. The editor page: step list, plan canvas, 3D preview, step panel, validation, Save and "Open as buyer".
// SPEC 2.2. The object handed to every step is an EditorHost (context.ts); C6 and C7 steps only use the EditorContext part.
import './editor.css';
import { createGrid } from '../core/grid-codec';
import { rasterizeLayout, stampFurniture } from '../core/layout-raster';
import { createEmptyProperty, validateLayout, validateProperty } from '../core/layout-validate';
import { GRID_VOID } from '../types';
import type { Grid, PropertyFile } from '../types';
import type { EditorContext, EditorHost, EditorStep, Selection, Validation } from './context';
import { clear, h } from './dom';
import { createFrameStore } from './frames';
import { createPlanCanvas } from './plan-canvas';
import { createPreview } from './preview';
import {
  SCENE_ID_HINT, createApi, extrasWarnings, fetchSceneJson, replaceDraft, sceneIdValid, saveDraft,
} from './save';
import type { SaveOutcome } from './save';
import { step as media, loadImage } from './steps/media';
import { step as scale } from './steps/scale';
import { step as rooms } from './steps/rooms';
import { step as openings } from './steps/openings';
import { step as finishes } from './steps/finishes';
import { step as furniture } from './steps/furniture';
import { step as scan } from './steps/scan';
import { step as spawn } from './steps/spawn';

/** E1 to E8 in order (SPEC 2.2). finishes, furniture, spawn are C6; scan is C7. */
export const STEPS: EditorStep[] = [media, scale, rooms, openings, finishes, furniture, scan, spawn];

declare global {
  interface Window { __editor?: unknown }
}

function boot(): void {
  const root = document.getElementById('editor');
  if (!root) throw new Error('editor.html has no #editor element');
  const params = new URLSearchParams(location.search);
  const urlScene = params.get('scene');
  const startId = urlScene && sceneIdValid(urlScene) ? urlScene : 'new-flat';

  // ---------------------------------------------------------------- page frame
  const title = h('span', { class: 'brand', text: 'walkthru editor' });
  const sceneLabel = h('span', { class: 'scene-label' });
  const status = h('span', { class: 'status muted small' });
  const previewBtn = h('button', { class: 'btn', text: '3D preview', title: 'Swap the plan for the live 3D shell' });
  const fitBtn = h('button', { class: 'btn', text: 'Fit plan' });
  // SPEC-GAP: 2.2 puts Save and "Open as buyer" in E8, whose panel belongs to C6. They live in the top bar here so they work with the E8 stub.
  const saveBtn = h('button', { class: 'btn primary', text: 'Save' });
  const openBtn = h('button', { class: 'btn', text: 'Open as buyer' });
  const header = h('header', { class: 'topbar' }, title, sceneLabel, status, h('span', { class: 'grow' }), previewBtn, fitBtn, saveBtn, openBtn);

  const stepList = h('ol', { class: 'steps' });
  const side = h('nav', { class: 'side' }, h('h2', { text: 'Steps' }), stepList);

  const planHost = h('div', { class: 'plan-host' });
  const previewHost = h('div', { class: 'preview-host' });
  previewHost.style.display = 'none';
  const strip = h('div', { class: 'strip' });
  const stage = h('main', { class: 'stage' }, h('div', { class: 'views' }, planHost, previewHost), strip);

  const panelTitle = h('h2', { class: 'panel-title' });
  const panel = h('div', { class: 'panel-body' });
  const validationBox = h('div', { class: 'validation' });
  const right = h('aside', { class: 'right' }, panelTitle, panel, validationBox);

  const toasts = h('div', { class: 'toasts' });
  root.append(header, h('div', { class: 'cols' }, side, stage, right), toasts);

  // ---------------------------------------------------------------- state
  const draft: PropertyFile = createEmptyProperty(startId);
  const selection: Selection = { roomId: null, openingId: null };
  let importNotes: string[] = [];
  let saveErrors: string[] = [];
  let gridCache: Grid | null = null;
  let dirty = false;
  let current: EditorStep | null = null;

  const plan = createPlanCanvas(planHost, () => draft, () => selection);
  const frames = createFrameStore();
  const preview = createPreview(previewHost, () => draft);

  function toast(text: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
    const t = h('div', { class: `toast ${kind}`, text });
    toasts.append(t);
    setTimeout(() => t.remove(), kind === 'error' ? 12000 : 6000);
    t.addEventListener('click', () => t.remove());
  }

  function validation(): Validation {
    let errors: string[] = [];
    let warnings: string[] = [];
    try {
      const v = validateLayout(draft.layout);
      errors = v.errors;
      warnings = v.warnings;
    } catch (err) {
      errors = [`Could not check the layout: ${err instanceof Error ? err.message : String(err)}`];
    }
    const u = draft.layout.underlay;
    if (u && u.dimensions.length === 0) warnings = [...warnings, 'The floor plan has no scale yet, so room sizes are wrong. Do the Scale step.'];
    return { errors, warnings, importNotes };
  }

  function grid(): Grid {
    if (gridCache) return gridCache;
    try {
      gridCache = stampFurniture(rasterizeLayout(draft.layout), draft.furniture);
    } catch (err) {
      console.warn('[walkthru] could not rasterise the draft layout:', err);
      gridCache = createGrid(0, 0, 1, 1, GRID_VOID);
    }
    return gridCache;
  }

  // ---------------------------------------------------------------- steps and panel
  function renderSteps(): void {
    clear(stepList);
    STEPS.forEach((s, i) => {
      let done = false;
      try { done = s.isDone(host); } catch { done = false; }
      const li = h('li', { class: `${s === current ? 'on' : ''}${done ? ' done' : ''}` },
        h('button', { class: 'stepbtn', onclick: () => goto(s.id) },
          h('span', { class: 'tick', text: done ? '✓' : String(i + 1) }),
          h('span', { text: s.title }),
          s.optional ? h('span', { class: 'muted small', text: ' optional' }) : null));
      stepList.append(li);
    });
  }

  function renderValidation(): void {
    clear(validationBox);
    const v = validation();
    const all = [
      ...saveErrors.map((t) => ({ t, k: 'err' })),
      ...v.errors.map((t) => ({ t, k: 'err' })),
      ...v.warnings.map((t) => ({ t, k: 'warn' })),
      ...v.importNotes.map((t) => ({ t, k: 'note' })),
    ];
    if (all.length === 0) {
      validationBox.append(h('p', { class: 'ok small', text: draft.layout.rooms.length === 0 ? 'Nothing to check yet.' : 'No problems found.' }));
      return;
    }
    const groups: [string, string][] = [['err', 'Fix before saving'], ['warn', 'Check these'], ['note', 'From the drawing import']];
    for (const [k, heading] of groups) {
      const items = all.filter((x) => x.k === k);
      if (items.length === 0) continue;
      validationBox.append(h('h3', { class: k, text: `${heading} (${items.length})` }), h('ul', { class: `msgs ${k}` }, ...items.map((x) => h('li', { text: x.t }))));
    }
  }

  function updateHeader(): void {
    sceneLabel.textContent = host.sceneId;
    status.textContent = dirty ? 'unsaved changes' : '';
    document.title = `${host.sceneId} · walkthru editor`;
  }

  function goto(stepId: string): void {
    const next = STEPS.find((s) => s.id === stepId);
    if (!next) throw new Error(`No editor step "${stepId}". Steps: ${STEPS.map((s) => s.id).join(', ')}`);
    if (current) {
      try { current.unmount(); } catch (err) { console.error('[walkthru] step unmount threw', err); }
    }
    plan.setTool(null);
    plan.endSession();
    host.showPreview(false);
    current = next;
    clear(panel);
    panel.className = 'panel-body';
    panelTitle.textContent = `${STEPS.indexOf(next) + 1}. ${next.title}${next.optional ? ' (optional)' : ''}`;
    plan.beginSession();
    try {
      next.mount(panel, host);
    } catch (err) {
      console.error('[walkthru] step mount threw', err);
      clear(panel);
      panel.append(h('p', { class: 'err', text: `This step failed to open: ${err instanceof Error ? err.message : String(err)}` }));
    }
    renderSteps();
  }

  // ---------------------------------------------------------------- the host object
  function commit(): void {
    gridCache = null;
    dirty = true;
    // drop a selection whose target is gone
    if (selection.roomId && !draft.layout.rooms.some((r) => r.id === selection.roomId)) selection.roomId = null;
    if (selection.openingId && !draft.layout.openings.some((o) => o.id === selection.openingId)) selection.openingId = null;
    saveErrors = [];
    plan.refresh();
    preview.markDirty();
    renderSteps();
    renderValidation();
    updateHeader();
  }

  const api = createApi(() => host.sceneId);

  const host: EditorHost = {
    sceneId: startId,
    draft,
    commit,
    grid,
    plan,
    frames,
    get viewer() { return preview.viewer(); },
    api,
    selection,
    underlayImage: null,

    setSceneId(id) {
      host.sceneId = id;
      draft.id = id;
      try {
        const u = new URL(location.href);
        u.searchParams.set('scene', id);
        history.replaceState(null, '', u);
      } catch { /* file:// or odd embeds */ }
      updateHeader();
    },

    async loadScene(id) {
      if (!sceneIdValid(id)) return { found: false, error: SCENE_ID_HINT };
      const raw = await fetchSceneJson(id, 'property.json');
      let next: PropertyFile;
      let found = false;
      if (raw) {
        try {
          next = validateProperty(raw);
          found = true;
        } catch (err) {
          return { found: true, error: err instanceof Error ? err.message : String(err) };
        }
      } else {
        next = createEmptyProperty(id);
      }
      next.id = id;
      replaceDraft(draft, next);
      host.setSceneId(id);
      selection.roomId = null;
      selection.openingId = null;
      const extras = await fetchSceneJson(id, 'proposal-extras.json');
      importNotes = extrasWarnings(extras);
      host.underlayImage = null;
      const u = draft.layout.underlay;
      if (u) {
        try {
          host.underlayImage = await loadImage(`/scenes/${id}/${u.file}?t=${Date.now()}`);
        } catch {
          toast(`The plan image ${u.file} could not be loaded. Drop it again in step 1.`, 'warn');
        }
      }
      host.applyUnderlay();
      host.fitPlan();
      commit();
      dirty = false;
      updateHeader();
      if (current) goto(current.id);
      return { found };
    },

    select(sel) {
      if (sel.roomId !== undefined) selection.roomId = sel.roomId;
      if (sel.openingId !== undefined) selection.openingId = sel.openingId;
      plan.redraw();
    },
    validation,
    setImportNotes(notes) {
      importNotes = notes;
      renderValidation();
    },
    applyUnderlay() {
      const u = draft.layout.underlay;
      if (host.underlayImage && u) plan.setUnderlayImage(host.underlayImage, { pxPerM: u.pxPerM, originPx: u.originPx, opacity: 0.9 });
      else plan.setUnderlayImage(null);
    },
    fitPlan() { plan.fit(); },
    showPreview(on) {
      preview.show(on);
      planHost.style.display = on ? 'none' : 'block';
      previewBtn.classList.toggle('on', on);
      if (!on) plan.redraw();
    },
    previewVisible: () => preview.isVisible(),
    goto,
    toast,
  };

  // ---------------------------------------------------------------- frame strip (reference for colour sampling)
  const shown = new WeakSet<ImageBitmap>();
  function renderStrip(): void {
    strip.style.display = frames.frames.length > 0 ? 'flex' : 'none';
    for (const bmp of frames.frames) {
      if (shown.has(bmp)) continue;
      shown.add(bmp);
      const c = document.createElement('canvas');
      const k = 72 / Math.max(bmp.width, bmp.height);
      c.width = Math.max(1, Math.round(bmp.width * k));
      c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
      c.title = `Frame ${frames.frames.indexOf(bmp) + 1}. Click to enlarge.`;
      c.addEventListener('click', () => lightbox(bmp));
      strip.append(c);
    }
    renderSteps();
  }
  function lightbox(bmp: ImageBitmap): void {
    const big = document.createElement('canvas');
    big.width = bmp.width;
    big.height = bmp.height;
    big.getContext('2d')?.drawImage(bmp, 0, 0);
    const shade = h('div', { class: 'lightbox' }, big);
    shade.addEventListener('click', () => shade.remove());
    document.body.append(shade);
  }
  frames.onChange(renderStrip);
  renderStrip();

  // ---------------------------------------------------------------- header buttons
  previewBtn.addEventListener('click', () => host.showPreview(!preview.isVisible()));
  fitBtn.addEventListener('click', () => plan.fit());
  async function save(opts?: { download?: boolean }): Promise<SaveOutcome> {
    const out = await saveDraft(draft, grid(), api, opts);
    saveErrors = out.errors;
    if (!out.errors.length) {
      if (out.apiError) toast(`${out.apiError} The file was downloaded instead.`, 'warn');
      else { dirty = false; toast(`Saved public/scenes/${host.sceneId}/property.json.`, 'info'); }
    } else {
      toast(`Not saved: ${out.errors.length} problem${out.errors.length === 1 ? '' : 's'} to fix. See the list on the right.`, 'error');
    }
    renderValidation();
    updateHeader();
    return out;
  }
  saveBtn.addEventListener('click', () => { void save(); });
  openBtn.addEventListener('click', () => {
    if (dirty && !window.confirm('There are unsaved changes. The buyer view shows the last saved version. Open it anyway?')) return;
    window.open(`/?scene=${encodeURIComponent(host.sceneId)}`, '_blank');
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------------------------------------------------------------- start
  window.__editor = {
    /** the live draft (same object the steps mutate) */
    get draft() { return draft; },
    steps: STEPS,
    ctx: host as EditorContext,
    host,
    goto,
    commit,
    save,
    validation,
    grid,
    loadScene: host.loadScene,
    preview: { show: (on: boolean) => host.showPreview(on), stats: () => preview.stats() },
    get current() { return current?.id ?? null; },
  };

  renderValidation();
  updateHeader();
  goto('media');
  if (urlScene && sceneIdValid(urlScene)) {
    void host.loadScene(urlScene).then((r) => {
      if (r.error) toast(r.error, 'error');
      else if (r.found) goto(draft.layout.rooms.length > 0 ? 'rooms' : 'media');
    });
  } else if (urlScene) {
    toast(`Scene id "${urlScene}" is not valid. ${SCENE_ID_HINT}`, 'error');
  }
}

boot();
