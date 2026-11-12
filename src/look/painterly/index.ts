// Owned by C11c. SPEC 16.7: the painterly mode. THIS FILE IS A LAZY CHUNK: the buyer page imports it with `import()` when the
// buyer taps "Show as a painting", so none of it (nor the vendored painter) is downloaded before that.
//
// Behaviour (SPEC 16.7): the button freezes the walk-through camera and shows the painting. High tier: live, the buyer can drag to look
// round. Low and medium: ONE frame, shown as a still. "Save picture" downloads a PNG with a caption strip ("A painting of {title}.
// Illustrative."), "Back" returns to the walk-through, whose camera was never moved.
import * as THREE from 'three';
import type { Viewer } from '../../engine/viewer';
import type { Layout } from '../../types';
import type { Look } from '../look';
import { createPainting } from './adapter';
import type { Painting, PaintingStats } from './adapter';
import { captionFor, slug } from './caption';
import './painterly.css';

export { captionFor } from './caption';

export interface PaintingHost {
  viewer: Viewer;
  look: Look;
  shell: THREE.Object3D;
  furnitureRoot: THREE.Object3D;
  layout: Layout;
  /** the property's title, for the caption strip */
  title: string;
  /** where the overlay goes (the page body) */
  host: HTMLElement;
  /** the walking figure, painted into the picture (omit to leave him out) */
  character?: { object: THREE.Object3D; tone: number };
  /** the point the live view orbits (the person's head); the eye itself when it is already close */
  focus: THREE.Vector3;
  /** the buyer is now in the painting (true) or back (false): the page stops walking and hides its HUD */
  setBusy(on: boolean): void;
  toast(text: string): void;
}

export interface SavedPicture { dataUrl: string; width: number; height: number; stripPx: number; caption: string }

export interface PaintingSession {
  readonly mode: 'live' | 'still';
  readonly stats: PaintingStats;
  readonly caption: string;
  /** frames drawn so far in live mode */
  readonly frames: number;
  /** the painting's own camera (a copy: the walk-through's is never moved) */
  readonly camera: THREE.PerspectiveCamera;
  /** a PNG with the caption strip; `download` also hands it to the browser as a file */
  save(download?: boolean): Promise<SavedPicture>;
  /** returns to the walk-through */
  back(): void;
  readonly active: boolean;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/** The picture with the caption strip under it, as a 2D canvas. `source` is the GL canvas (drawn in the same task as the render) or a copy of it. */
export function composeWithCaption(source: CanvasImageSource, w: number, h2: number, caption: string): { canvas: HTMLCanvasElement; stripPx: number } {
  const stripPx = Math.round(Math.max(44, h2 * 0.06));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h2 + stripPx;
  const g = c.getContext('2d');
  if (!g) throw new Error('This browser cannot save the picture (no 2D canvas).');
  g.drawImage(source, 0, 0, w, h2);
  g.fillStyle = '#f2eadb';
  g.fillRect(0, h2, w, stripPx);
  g.fillStyle = '#3a3128';
  g.textBaseline = 'middle';
  let size = Math.round(stripPx * 0.42);
  g.font = `${size}px Georgia, 'Times New Roman', serif`;
  while (g.measureText(caption).width > w - stripPx && size > 10) { size -= 1; g.font = `${size}px Georgia, 'Times New Roman', serif`; }
  g.fillText(caption, Math.round(stripPx * 0.5), h2 + stripPx / 2);
  return { canvas: c, stripPx };
}

export async function openPainting(host: PaintingHost): Promise<PaintingSession> {
  const { viewer, look } = host;
  const { renderer, canvas } = viewer;
  const caption = captionFor(host.title);
  const live = look.tier === 'high';

  const root = h('div', 'wt-paint', undefined, host.host);
  root.dataset.testid = 'painting';
  const cap = h('div', 'wt-paint-cap', undefined, root);
  h('b', undefined, 'Painting', cap);
  cap.append(' · Illustrative');
  const busy = h('div', 'wt-paint-busy', 'Mixing paint…', root);
  host.setBusy(true);

  const restoreCap = look.tierConfig.pixelRatioCap;
  let painting: Painting | null = null;
  let active = true;
  let frames = 0;
  let stillCanvas: HTMLCanvasElement | null = null;
  let offResize: (() => void) | null = null;
  const prevOnShaderError = renderer.debug.onShaderError;
  let shaderFailed = false;

  const cam = new THREE.PerspectiveCamera().copy(viewer.camera, false);
  cam.updateMatrixWorld(true);

  const teardown = (): void => {
    if (!active) return;
    active = false;
    offResize?.();
    look.holdFrame(null);
    renderer.debug.onShaderError = prevOnShaderError;
    painting?.dispose();
    painting = null;
    stillCanvas = null;
    if (live) viewer.setPixelRatioCap(restoreCap);
    root.remove();
    window.removeEventListener('keydown', onKey);
    host.setBusy(false);
  };
  const fail = (err: unknown): void => {
    console.warn('[walkthru] the painting could not be made:', err);
    teardown();
    host.toast('The painting is not available on this device.');
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') session.back(); };
  window.addEventListener('keydown', onKey);

  const session: PaintingSession = {
    mode: live ? 'live' : 'still',
    get stats() { return painting?.stats ?? lastStats; },
    caption,
    get frames() { return frames; },
    camera: cam,
    get active() { return active; },
    async save(download = false) {
      if (!active) throw new Error('The painting is closed.');
      let source: CanvasImageSource;
      let w: number;
      let hh: number;
      if (live && painting) {
        // drawn and copied in one task: the canvas is still valid right after the render
        painting.render(cam, 0);
        source = canvas; w = canvas.width; hh = canvas.height;
        const { canvas: out, stripPx } = composeWithCaption(source, w, hh, caption);
        return finish(out, stripPx, w, hh);
      }
      if (!stillCanvas) throw new Error('There is no painting to save yet.');
      source = stillCanvas; w = stillCanvas.width; hh = stillCanvas.height;
      const { canvas: out, stripPx } = composeWithCaption(source, w, hh, caption);
      return finish(out, stripPx, w, hh);

      function finish(out: HTMLCanvasElement, stripPx: number, ww: number, h2: number): SavedPicture {
        const dataUrl = out.toDataURL('image/png');
        if (download) {
          out.toBlob((blob) => {
            if (!blob) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `painting-${slug(host.title)}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          }, 'image/png');
        }
        return { dataUrl, width: ww, height: h2 + stripPx, stripPx, caption };
      }
    },
    back() { teardown(); },
  };
  let lastStats: PaintingStats = { person: null, strokes: 0, palettes: 0, furnitureMeshes: 0, shellTriangles: 0, buildMs: 0 };

  try {
    // let "Mixing paint" show before the heavy work starts
    await nextFrame();
    await nextFrame();
    if (!active) return session;
    if (live) viewer.setPixelRatioCap(Math.min(restoreCap, 1.25));
    renderer.debug.onShaderError = () => { shaderFailed = true; };
    painting = createPainting(renderer, { shell: host.shell, furnitureRoot: host.furnitureRoot, layout: host.layout, character: host.character }, {
      sun: look.sun(), samples: 4, shadeSize: live ? 2048 : 1536,
    });
    lastStats = painting.stats;
    const p = painting;
    offResize = viewer.onResize(() => p.resize());
    p.resize();

    // the first frame compiles the painter's shaders: it may take a second or two
    look.holdFrame(() => { /* hold: nothing else draws while the painting is made */ });
    p.render(cam, 0);
    frames++;
    if (shaderFailed) throw new Error('the painter’s shaders did not compile');

    busy.remove();
    const bar = h('div', 'wt-paint-bar', undefined, root);
    const save = h('button', 'wt-paint-btn is-primary', 'Save picture', bar);
    save.type = 'button';
    save.dataset.testid = 'paint-save';
    const back = h('button', 'wt-paint-btn', 'Back', bar);
    back.type = 'button';
    back.dataset.testid = 'paint-back';
    save.addEventListener('click', () => { void session.save(true).catch((e) => host.toast(String(e instanceof Error ? e.message : e))); });
    back.addEventListener('click', () => session.back());

    if (live) {
      // ---- live: drag to look round, wheel to move closer or further
      h('div', 'wt-paint-hint', 'Drag to look around · scroll to zoom', root);
      const fwd = new THREE.Vector3();
      cam.getWorldDirection(fwd);
      let radius = Math.min(10, Math.max(0, cam.position.distanceTo(host.focus)));
      if (radius < 0.35) radius = 0;
      const pivot = cam.position.clone().addScaledVector(fwd, radius);
      let yaw = Math.atan2(fwd.x, fwd.z);
      let pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
      const apply = (): void => {
        const cp = Math.cos(pitch);
        fwd.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
        cam.position.copy(pivot).addScaledVector(fwd, -radius);
        cam.lookAt(cam.position.x + fwd.x, cam.position.y + fwd.y, cam.position.z + fwd.z);
        cam.updateMatrixWorld(true);
      };
      let drag: { id: number; x: number; y: number } | null = null;
      const down = (e: PointerEvent): void => { if (!active || e.button > 0) return; drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
      const move = (e: PointerEvent): void => {
        if (!drag || drag.id !== e.pointerId) return;
        yaw -= (e.clientX - drag.x) * 0.0055;
        pitch = THREE.MathUtils.clamp(pitch + (e.clientY - drag.y) * 0.0045, -1.3, 1.3);
        drag.x = e.clientX; drag.y = e.clientY;
        apply();
      };
      const up = (e: PointerEvent): void => { if (drag && drag.id === e.pointerId) drag = null; };
      const wheel = (e: WheelEvent): void => {
        if (!active) return;
        e.preventDefault();
        radius = THREE.MathUtils.clamp((radius || 0.5) * Math.exp(e.deltaY * 0.0012), 0, 14);
        if (radius < 0.3) radius = 0;
        apply();
      };
      canvas.addEventListener('pointerdown', down);
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      canvas.addEventListener('wheel', wheel, { passive: false });
      const prevTeardownOff = offResize;
      offResize = () => {
        prevTeardownOff?.();
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        canvas.removeEventListener('wheel', wheel);
      };
      look.holdFrame((dt) => {
        if (!painting) return;
        painting.render(cam, dt);
        frames++;
      });
    } else {
      // ---- low and medium: one frame, kept as a picture, and the painter's memory handed back at once
      const still = h('canvas', 'wt-paint-still', undefined, root);
      still.width = canvas.width;
      still.height = canvas.height;
      still.dataset.testid = 'painting-still';
      p.render(cam, 0);
      const g = still.getContext('2d');
      if (!g) throw new Error('no 2D canvas');
      g.drawImage(canvas, 0, 0);
      stillCanvas = still;
      lastStats = p.stats;
      painting?.dispose();
      painting = null;
      root.insertBefore(still, cap);
    }
  } catch (err) {
    fail(err);
  }
  return session;
}
