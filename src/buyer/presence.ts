// A walk on a screen nobody holds (SPEC 2.7.4): when the display is a kiosk, a long idle starts the tour by itself and loops it until someone
// touches the screen. The chrome's own coming and going is src/buyer/chrome.ts (calm by default, reveal on intent); this file reads the level a
// link asks for and runs the idle tour.
// Parameters: `?chrome=auto|always|hidden`, `?kiosk=1` (no height picker, chrome hidden, attract mode after 90 s), `?idle=<seconds>` (attract mode
// after that long, on its own or with kiosk), `?autohide=<seconds>` (the older switch: 0 = `always`, a number = `auto` with that linger).
// Pure rule in `parsePresence`, the timers in `mountPresence`.
import { parseChromeLevel } from './chrome';
import type { ChromeLevel } from './chrome';

export interface PresenceConfig {
  kiosk: boolean;
  /** seconds of no input before the tour starts by itself, or null for never */
  attractAfterS: number | null;
  /** how much of the chrome shows (src/buyer/chrome.ts) */
  chrome: ChromeLevel;
  /** seconds the chrome stays after a touch or a key, or null for the default */
  lingerS: number | null;
}

export const DEFAULT_ATTRACT_S = 90;

const num = (v: string | null, lo: number, hi: number): number | null => {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

export function parsePresence(search: string): PresenceConfig {
  const q = new URLSearchParams(search);
  const kiosk = q.get('kiosk') === '1' || q.get('kiosk') === 'true';
  const idle = num(q.get('idle'), 3, 3600);
  const c = parseChromeLevel(search);
  return { kiosk, attractAfterS: idle ?? (kiosk ? DEFAULT_ATTRACT_S : null), chrome: c.level, lingerS: c.lingerMs === null ? null : c.lingerMs / 1000 };
}

export interface PresenceDeps {
  /** the HUD root (the look sheet's close button is found in it) */
  root: HTMLElement;
  cfg: PresenceConfig;
  /** the walker is free to be shown to: walk mode, no sheet that needs an answer */
  free(): boolean;
  /** starts the looping tour; resolves when it ends (it only ends when stopped) */
  startTour(): Promise<unknown>;
  /** ends the tour and any walk on its own */
  stopTour(): void;
  /** a tour or an auto-walk is running */
  touring(): boolean;
}

export interface Presence { dispose(): void; /** debug: seconds since the last input */ idleS(): number; attracting(): boolean; wake(): void }

export function mountPresence(d: PresenceDeps): Presence {
  let last = performance.now();
  let attract = false;
  let lastX = -1, lastY = -1;
  const idleS = (): number => (performance.now() - last) / 1000;
  const wake = (): void => { last = performance.now(); };
  const stopAttract = (): void => { if (!attract) return; attract = false; d.stopTour(); };
  const closeSheets = (): void => {
    // every sheet answers Escape (the people sheets, Rooms, the lift, the map, the height picker); the look sheet has a close button
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    d.root.querySelector<HTMLElement>('.wt-look-x')?.click();
  };
  // a press, a key or the wheel ends an attract tour and wakes the chrome; a mouse move only wakes the chrome
  const onPress = (): void => { stopAttract(); wake(); };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    if (Math.hypot(e.clientX - lastX, e.clientY - lastY) < 4) return;
    lastX = e.clientX; lastY = e.clientY;
    wake();
  };
  const press: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  for (const k of press) window.addEventListener(k, onPress, { capture: true, passive: true });
  window.addEventListener('pointermove', onMove, { capture: true, passive: true });
  const timer = setInterval(() => {
    const idle = idleS();
    const { attractAfterS } = d.cfg;
    if (attractAfterS !== null && !attract && idle >= attractAfterS && !d.touring()) {
      closeSheets();
      if (!d.free()) { setTimeout(() => { if (!attract && idleS() >= attractAfterS && d.free()) begin(); }, 400); return; }
      begin();
    }
  }, 500);
  function begin(): void {
    attract = true;
    void d.startTour().finally(() => { if (attract && !d.touring()) attract = false; });
  }
  return {
    dispose() {
      clearInterval(timer);
      for (const k of press) window.removeEventListener(k, onPress, { capture: true } as EventListenerOptions);
      window.removeEventListener('pointermove', onMove, { capture: true } as EventListenerOptions);
    },
    idleS,
    attracting: () => attract,
    wake,
  };
}
