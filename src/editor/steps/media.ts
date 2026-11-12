// Owned by C5. E1 Scene and media (SPEC 2.2): scene id and Load, three drop zones (floor plan, video or photos, 3D scan).
import type { EditorContext, EditorStep } from '../context';
import { asHost } from '../context';
import { clear, dropZone, h } from '../dom';
import { SCENE_ID_HINT, sceneIdValid } from '../save';
import { tentativePxPerM } from '../plan-helpers';
import { mountMediaPipeline } from '../../media/editor-hook';

const PLAN_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
const SCAN_FILES = ['scene.ply', 'scene.spz', 'scene.splat'];

let activeCtx: EditorContext | null = null;
let refreshPanel: (() => void) | null = null;
let unsubFrames: (() => void) | null = null;

/** Loads an image into an <img>; SVGs without a size fall back to 1000 px so the plan still has an extent. */
export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  try {
    await img.decode();
  } catch {
    throw new Error('The browser could not read that image.');
  }
  return img;
}

/**
 * HOOK (C9 media pipeline). Everything dropped into the "Video or photos" zone arrives here. Today it feeds the
 * in-browser FrameStore (a frame per second for video, photos as they are, nothing uploaded). The integrator will
 * route this to an upload endpoint (server-side frames and scan jobs) by replacing the body of this one function;
 * nothing else in the editor calls the FrameStore directly for dropped media.
 */
export async function onMediaDropped(files: File[]): Promise<void> {
  const ctx = activeCtx;
  if (!ctx) throw new Error('The editor is not ready yet.');
  const videos = files.filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name));
  const images = files.filter((f) => !videos.includes(f) && (f.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(f.name)));
  for (const v of videos) await ctx.frames.addVideo(v);
  if (images.length > 0) await ctx.frames.addImages(images);
}

function planExt(f: File): string | null {
  const m = f.name.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : '';
  if (PLAN_EXTS.includes(ext) || (ext === 'jpg')) return ext;
  if (f.type === 'image/png') return 'png';
  if (f.type === 'image/jpeg') return 'jpg';
  if (f.type === 'image/webp') return 'webp';
  if (f.type === 'image/svg+xml') return 'svg';
  return null;
}

/** Saves the plan as plan.<ext>, shows it as underlay at a tentative scale, and sends the broker to the Scale step. */
async function setPlanImage(ctx: EditorContext, file: File): Promise<void> {
  const host = asHost(ctx);
  const ext = planExt(file);
  if (!ext) { host.toast('Use a PNG, JPG, WebP or SVG for the floor plan.', 'error'); return; }
  const url = URL.createObjectURL(file);
  let img: HTMLImageElement;
  try {
    img = await loadImage(url);
  } catch (err) {
    URL.revokeObjectURL(url);
    host.toast(err instanceof Error ? err.message : String(err), 'error');
    return;
  }
  const w = img.naturalWidth || 1000;
  const h2 = img.naturalHeight || 1000;
  const name = `plan.${ext}`;
  let saved = true;
  try {
    await ctx.api.saveFile(name, file);
  } catch (err) {
    saved = false;
    host.toast(`${err instanceof Error ? err.message : String(err)} The plan is shown here, but it is not saved with the scene.`, 'warn');
  }
  ctx.draft.layout.underlay = {
    file: name,
    pxPerM: tentativePxPerM(w, h2),
    originPx: { x: w / 2, y: h2 / 2 },
    dimensions: [],
    disagreementPct: 0,
  };
  ctx.draft.layout.scaleSource = 'plan-dimensions';
  host.underlayImage = img;
  host.applyUnderlay();
  ctx.plan.setTool(null);
  host.fitPlan();
  ctx.commit();
  if (saved) host.toast(`Saved ${name}. Now set the scale.`, 'info');
  if (ctx.draft.layout.rooms.length > 0) host.toast('The rooms already drawn were kept. Redo the scale so they line up with this plan.', 'warn');
  host.goto('scale');
}

let unmountPipeline: (() => void) | null = null;

export const step: EditorStep = {
  id: 'media',
  title: 'Scene and media',
  mount(panel, ctx) {
    activeCtx = ctx;
    const host = asHost(ctx);
    panel.className = 'panel-body step-media';

    const idInput = h('input', { type: 'text', value: ctx.sceneId, spellcheck: false, autocomplete: 'off', maxLength: 40 });
    const msg = h('p', { class: 'muted small' });
    const doLoad = async (): Promise<void> => {
      const id = idInput.value.trim();
      if (!sceneIdValid(id)) { msg.textContent = SCENE_ID_HINT; msg.className = 'err small'; return; }
      msg.textContent = 'Loading...';
      msg.className = 'muted small';
      const r = await host.loadScene(id);
      if (r.error) { msg.textContent = r.error; msg.className = 'err small'; return; }
      msg.textContent = r.found ? `Loaded ${id}/property.json.` : `No property.json for "${id}" yet. Starting a new scene.`;
      msg.className = 'muted small';
    };
    idInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void doLoad(); });
    const loadBtn = h('button', { class: 'btn', text: 'Load', onclick: () => void doLoad() });

    const planInfo = h('p', { class: 'muted small' });
    const framesInfo = h('p', { class: 'muted small' });
    const scanInfo = h('p', { class: 'muted small' });

    const planZone = dropZone({
      title: 'Floor plan image (best)',
      hint: 'PNG, JPG, WebP or SVG. Saved into the scene folder as plan.<ext>.',
      accept: 'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg',
      onFiles: (files) => { void setPlanImage(ctx, files[0]).then(update); },
    });
    const mediaZone = dropZone({
      title: 'Video or photos',
      hint: 'An MP4 or images. One frame per second (60 at most) is grabbed in this browser, for reference and colour sampling. Nothing is uploaded or saved.',
      accept: 'video/*,image/*,.mp4,.mov,.m4v,.webm,.jpg,.jpeg,.png,.webp',
      multiple: true,
      onFiles: (files) => {
        framesInfo.textContent = 'Reading the media...';
        onMediaDropped(files).then(
          () => update(),
          (err) => { host.toast(err instanceof Error ? err.message : String(err), 'error'); update(); },
        );
      },
    });

    const update = (): void => {
      const u = ctx.draft.layout.underlay;
      planInfo.textContent = u ? `Plan in use: ${u.file}${u.dimensions.length === 0 ? '. Scale not set yet.' : '.'}` : 'No floor plan. Without one you draw on a blank metric grid (1 m squares).';
      const n = ctx.frames.frames.length;
      framesInfo.textContent = n > 0 ? `${n} frame${n === 1 ? '' : 's'} in memory. They stay in this browser and are gone when you reload.` : 'No frames yet.';
    };
    unsubFrames?.();
    unsubFrames = ctx.frames.onChange(update);
    refreshPanel = update;
    update();

    const checkScan = async (): Promise<void> => {
      scanInfo.textContent = 'Looking for a scan...';
      const found: string[] = [];
      for (const f of SCAN_FILES) if (await ctx.api.exists(f)) found.push(f);
      scanInfo.textContent = found.length > 0
        ? `Found: ${found.join(', ')}. Step 7 aligns it to the layout.`
        : `Not found. To add one, put ${SCAN_FILES.join(', ')} in public/scenes/${ctx.sceneId}/ (optional).`;
    };
    void checkScan();

    clear(panel);
    panel.append(
      h('h3', { text: 'Scene' }),
      h('label', { class: 'field' }, h('span', { text: 'Scene id' }), h('div', { class: 'row' }, idInput, loadBtn)),
      msg,
      planZone, planInfo,
      mediaZone, framesInfo,
      h('div', { class: 'drop static' }, h('strong', { text: '3D scan (optional)' }), scanInfo),
    );
    unmountPipeline = mountMediaPipeline(panel, ctx); // C9: server-side frames + scan jobs + photo pins
  },
  unmount() {
    unmountPipeline?.();
    unmountPipeline = null;
    activeCtx = null;
    refreshPanel = null;
    unsubFrames?.();
    unsubFrames = null;
  },
  isDone(ctx) {
    const l = ctx.draft.layout;
    return sceneIdValid(ctx.sceneId) && (!!l.underlay || ctx.frames.frames.length > 0 || l.rooms.length > 0);
  },
};

/** For tests and automation: re-render the info lines. */
export function refreshMediaPanel(): void {
  refreshPanel?.();
}
