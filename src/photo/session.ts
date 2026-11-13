// C12f. SPEC 17.14: one "AI photo" from tap to result. Lazy chunk (mount.ts imports it on the first tap).
// capture the view -> draw the guide -> ask the server -> size-check the answer against the app's own geometry -> label it
// in the pixels -> show it in a sheet over the 3D view (never instead of it). A failed check retries once.
import { FAIL_MESSAGE, PHOTO_LABEL, SEND_LONG_SIDE, nearestAspect } from './config';
import type { PhotoRequest, PhotoResponse } from './config';
import { checkFaithful, CHECK, lumaOf } from './edges';
import type { Gray } from './edges';
import { buildPhotoGeometry, cropToAspect, drawGuide, sampleView } from './geometry';
import type { SamplePoint } from './geometry';
import { labelPresent, stampLabel } from './label';
import type { AiPhotoDeps } from './mount';

export interface SessionDeps extends AiPhotoDeps { endpoint: string; onSent(): void }
export type SessionOutcome = 'shown' | 'failed' | 'unavailable' | 'cap' | 'nothing-to-check' | 'error';

export interface Capture { w: number; h: number; gray: Gray; points: SamplePoint[]; request: PhotoRequest }

const dataB64 = (url: string): string => url.slice(url.indexOf(',') + 1);

function canvas2d(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('no 2D canvas');
  return { c, g };
}

/** The current view, cropped to an aspect the image model returns, plus the guide for it. */
export function captureView(d: AiPhotoDeps): Capture {
  const { viewer } = d;
  const cw = viewer.canvas.width, ch = viewer.canvas.height;
  const asp = nearestAspect(cw, ch);
  const crop = cropToAspect(cw, ch, asp.ratio);
  const sx = Math.round(crop.u0 * cw), sy = Math.round(crop.v0 * ch);
  const sw = Math.round(crop.uw * cw), sh = Math.round(crop.vh * ch);
  const long = Math.min(SEND_LONG_SIDE, Math.max(sw, sh));
  const outW = asp.ratio >= 1 ? long : Math.round(long * asp.ratio);
  const outH = asp.ratio >= 1 ? Math.round(long / asp.ratio) : long;

  const { c, g } = canvas2d(outW, outH);
  // draw the frame in the same task as the render: the GL buffer is not kept after the frame
  d.withoutCharacter(() => {
    if (viewer.renderOverride) viewer.renderOverride(0);
    else viewer.renderer.render(viewer.scene, viewer.camera);
    g.drawImage(viewer.canvas, sx, sy, sw, sh, 0, 0, outW, outH);
  });
  const frame = g.getImageData(0, 0, outW, outH);
  const frameB64 = dataB64(c.toDataURL('image/jpeg', 0.86));

  const geom = buildPhotoGeometry(d.layout, d.items());
  const sampled = sampleView(geom, viewer.camera, crop, outW, outH);
  const guide = canvas2d(outW, outH);
  const gd = new ImageData(drawGuide(outW, outH, sampled.lines, Math.max(2, Math.round(outW / 400))) as Uint8ClampedArray<ArrayBuffer>, outW, outH);
  guide.g.putImageData(gd, 0, 0);
  const guideB64 = dataB64(guide.c.toDataURL('image/png'));

  return {
    w: outW, h: outH, gray: lumaOf(frame.data, outW, outH), points: sampled.points,
    request: { frame: frameB64, guide: guideB64, frameMime: 'image/jpeg', guideMime: 'image/png', aspect: asp.label },
  };
}

async function ask(endpoint: string, req: PhotoRequest): Promise<{ status: number; body: PhotoResponse | null }> {
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
    let body: PhotoResponse | null = null;
    try { body = (await res.json()) as PhotoResponse; } catch { /* not JSON */ }
    return { status: res.status, body };
  } catch { return { status: 0, body: null }; }
}

export interface Decoded { w: number; h: number; rgba: Uint8ClampedArray }
export async function decodeImage(b64: string, mime: string): Promise<Decoded> {
  const img = new Image();
  img.src = `data:${mime};base64,${b64}`;
  await img.decode();
  const { g } = canvas2d(img.naturalWidth, img.naturalHeight);
  g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
  return { w: id.width, h: id.height, rgba: id.data };
}

function toBlobUrl(rgba: Uint8ClampedArray, w: number, h: number): Promise<string> {
  const { c, g } = canvas2d(w, h);
  g.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('could not encode'))), 'image/jpeg', 0.92));
}

function sheet(build: (card: HTMLElement) => void, failCard: boolean): { close(): void } {
  const root = document.createElement('div');
  root.className = 'wt-aip-sheet';
  root.dataset.ui = '1';
  root.dataset.testid = 'ai-photo-sheet';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  const card = document.createElement('div');
  card.className = failCard ? 'wt-aip-card is-fail' : 'wt-aip-card';
  root.appendChild(card);
  build(card);
  const row = document.createElement('div');
  row.className = 'wt-aip-row';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wt-aip-close';
  btn.textContent = 'Close';
  row.appendChild(btn);
  card.appendChild(row);
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = (): void => { window.removeEventListener('keydown', onKey, true); root.remove(); };
  btn.addEventListener('click', close);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(root);
  btn.focus({ preventScroll: true });
  return { close };
}

async function showResult(url: string): Promise<void> {
  const img = document.createElement('img');
  img.className = 'wt-aip-img';
  img.src = url;
  img.alt = PHOTO_LABEL;
  img.dataset.testid = 'ai-photo-img';
  await img.decode().catch(() => undefined); // the sheet opens with the picture already in it
  sheet((card) => {
    const cap = document.createElement('p');
    cap.className = 'wt-aip-cap';
    cap.dataset.testid = 'ai-photo-caption';
    cap.textContent = PHOTO_LABEL;
    card.append(img, cap);
  }, false);
}

function showFailure(): void {
  sheet((card) => {
    const p = document.createElement('p');
    p.className = 'wt-aip-fail';
    p.dataset.testid = 'ai-photo-fail';
    p.textContent = FAIL_MESSAGE;
    card.appendChild(p);
  }, true);
}

/** One whole photo. Resolves with what happened; the UI is already updated. */
export async function takeAiPhoto(d: SessionDeps): Promise<SessionOutcome> {
  let cap: Capture;
  try { cap = captureView(d); } catch (err) { console.warn('[walkthru] AI photo capture failed:', err); d.toast('AI photo is not available on this device.'); return 'error'; }
  if (cap.points.length < CHECK.minPoints * 2) {
    d.toast('Turn to face a corner or some furniture, then try again.');
    return 'nothing-to-check';
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 0) d.onSent();
    const { status, body } = await ask(d.endpoint, cap.request);
    if (status === 404 || status === 503) { d.toast('AI photo is not available right now.'); return 'unavailable'; }
    if (status === 429 && body && !body.ok) { d.toast(body.message); return 'cap'; }
    if (!body || !body.ok) { d.toast('The photo service did not answer. Try again.'); return 'error'; }
    let out: Decoded;
    try { out = await decodeImage(body.image, body.mime); } catch { continue; }
    const verdict = checkFaithful(cap.gray, lumaOf(out.rgba, out.w, out.h), cap.points);
    if (!verdict.ok) { console.info('[walkthru] AI photo refused by the size check:', verdict.reason, verdict.failedGroup ?? ''); continue; }
    stampLabel(out.rgba, out.w, out.h);
    if (!labelPresent(out.rgba, out.w, out.h)) continue; // never show a photo that does not carry its label
    await showResult(await toBlobUrl(out.rgba, out.w, out.h));
    return 'shown';
  }
  showFailure();
  return 'failed';
}
