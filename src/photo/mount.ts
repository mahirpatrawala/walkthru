// C12f. SPEC 17.14: the one call the buyer page makes. Nothing but this file and its stylesheet loads with the page; the button
// appears only when the server says the feature is on and configured, and the rest (camera capture, the size check, the
// sheet) is a lazy chunk fetched on the first tap.
import type { Viewer } from '../engine/viewer';
import type { FurnitureItem, Layout } from '../types';
import { MAX_PER_VISIT, PHOTO_ENDPOINT } from './config';
import type { PhotoStatus } from './config';
import './photo.css';

export interface AiPhotoDeps {
  /** the HUD root: the button lives inside it, so it hides with the HUD */
  host: HTMLElement;
  viewer: Pick<Viewer, 'renderer' | 'scene' | 'camera' | 'canvas' | 'renderOverride'>;
  layout: Layout;
  items(): FurnitureItem[];
  /** runs `fn` with the walking figure hidden (the photo is of the room, not of the figure) */
  withoutCharacter<T>(fn: () => T): T;
  toast(text: string): void;
  /** the endpoint, for tests */
  endpoint?: string;
}
export interface AiPhotoHandle { readonly button: HTMLButtonElement | null; dispose(): void }

const KEY = 'walkthru:aiphoto:visit';
export const readVisitCount = (): number => { try { return Number(sessionStorage.getItem(KEY)) || 0; } catch { return 0; } };
export const storeVisitCount = (n: number): void => { try { sessionStorage.setItem(KEY, String(n)); } catch { /* private mode: the in-page count still holds */ } };

const ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6.5" width="18" height="13" rx="2.5"/><path d="M8.5 6.5 10 4h4l1.5 2.5"/><circle cx="12" cy="13" r="3.2"/></svg>';

/** Asks the server whether AI photo is on. Never throws: a dead endpoint just means no button. */
export async function fetchStatus(endpoint = PHOTO_ENDPOINT, f: typeof fetch = fetch): Promise<PhotoStatus | null> {
  try {
    const res = await f(endpoint, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    if (/^\s*</.test(text)) return null; // a static host answers with its index page
    const j = JSON.parse(text) as Partial<PhotoStatus>;
    return typeof j.enabled === 'boolean' ? { enabled: j.enabled, configured: !!j.configured, remainingToday: j.remainingToday } : null;
  } catch { return null; }
}

export function mountAiPhoto(d: AiPhotoDeps): AiPhotoHandle {
  let button: HTMLButtonElement | null = null;
  let disposed = false;
  let busy = false;
  let used = readVisitCount();
  const endpoint = d.endpoint ?? PHOTO_ENDPOINT;

  void fetchStatus(endpoint).then((st) => {
    if (disposed) return;
    if (!st || !st.enabled) return;
    if (!st.configured) { console.info('[walkthru] AI photo is switched on but no Gemini key is configured on the server.'); return; }
    const btn = document.createElement('button');
    button = btn;
    btn.type = 'button';
    btn.className = 'wt-aip-btn';
    btn.dataset.ui = '1';
    btn.dataset.testid = 'ai-photo';
    btn.setAttribute('aria-label', 'AI photo');
    const set = (busyNow: boolean): void => {
      btn.innerHTML = busyNow ? '<span class="wt-aip-spin" aria-hidden="true"></span><span>Making your photo…</span>' : `${ICON}<span>AI photo</span>`;
      btn.disabled = busyNow;
    };
    set(false);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.blur();
      if (busy) return;
      if (used >= MAX_PER_VISIT) { d.toast(`That is ${MAX_PER_VISIT} AI photos for this visit.`); return; }
      busy = true;
      set(true);
      void import('./session')
        .then((m) => m.takeAiPhoto({ ...d, endpoint, onSent: () => { used += 1; storeVisitCount(used); } }))
        .then((outcome) => { if (outcome === 'unavailable') { button?.remove(); button = null; } })
        .catch((err) => { console.warn('[walkthru] AI photo failed to start:', err); d.toast('AI photo is not available right now.'); })
        .finally(() => { busy = false; set(false); });
    });
    d.host.appendChild(btn);
  });

  return { get button() { return button; }, dispose() { disposed = true; button?.remove(); } };
}

