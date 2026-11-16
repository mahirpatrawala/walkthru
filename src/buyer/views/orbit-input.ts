// Mouse, trackpad and touch for the doll house's orbit camera. It sits in front of the walk's own input while the doll house is on (a capture listener on the
// canvas's parent, stopping what it takes), so a drag orbits instead of turning the walker, a wheel zooms the orbit, and the walking keys do nothing.
//   mouse: drag = orbit, right drag / middle drag / shift drag = pan, wheel = zoom, a click = tap, moving over = hover
//   touch: one finger = orbit, two fingers = pan and pinch-zoom, a short touch = tap
//   keys:  the walk's keys are swallowed; Escape goes back to the walk
import type { PointerEvt } from '../../engine/controls';
import { orbitBy, panBy, zoomBy, zoomByFactor } from './framing';
import type { OrbitGoal, OrbitLimits } from './framing';

const TAP_MS = 320;
const TAP_PX = 9;
/** keys the walk would act on; the doll house swallows them so a stray W does not move the walker out of sight */
const SWALLOW = new Set(['w', 'a', 's', 'd', 'e', 'q', 'r', 'm', 'f', 'v', ' ', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);

/** the keys Furnish listens to (rotate, measure, furnish): they go through while Furnish is on */
const FURNISH_KEYS = new Set(['q', 'e', 'r', 'f']);

export interface OrbitInputDeps {
  canvas: HTMLCanvasElement;
  getGoal(): OrbitGoal;
  setGoal(g: OrbitGoal): void;
  limits(): OrbitLimits;
  fovDeg(): number;
  /** the orbit may be steered now (not while the camera is flying in) */
  enabled(): boolean;
  onTap(e: PointerEvt): void;
  /** the pointer is over the picture at `e`, or has left it (null) */
  onHover(e: PointerEvt | null): void;
  onEscape(): void;
  /** the buyer took hold of the camera: hover and tap states may clear */
  onGrab?(): void;
  /** Furnish from above: a press it takes (it drags the piece being placed) is not an orbit; its moves and its release are its own */
  claim?: { down(e: PointerEvt): boolean; move(e: PointerEvt): void; up(e: PointerEvt): void };
  /** while true the keys Furnish uses (rotate, delete) go through to the walk's input */
  keysThrough?(): boolean;
}

export interface OrbitInput { dispose(): void }

interface P { x: number; y: number; sx: number; sy: number; t0: number; type: string; button: number; shift: boolean; moved: boolean; claimed: boolean }

export function attachOrbitInput(d: OrbitInputDeps): OrbitInput {
  const { canvas } = d;
  const host = canvas.parentElement ?? canvas;
  const pointers = new Map<number, P>();
  let pinch: { dist: number; mx: number; my: number } | null = null;
  let disposed = false;

  const evt = (type: PointerEvt['type'], e: { clientX: number; clientY: number }): PointerEvt => {
    const r = canvas.getBoundingClientRect();
    return { type, clientX: e.clientX, clientY: e.clientY, ndcX: ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, ndcY: -(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1) };
  };
  const vh = (): number => canvas.getBoundingClientRect().height || 800;

  const mine = (e: Event): boolean => e.target === canvas;
  const take = (e: Event): void => { e.stopPropagation(); };

  const onDown = (e: PointerEvent): void => {
    if (!mine(e) || disposed) return;
    take(e);
    if (e.pointerType === 'mouse' && e.button > 2) return;
    const taken = pointers.size === 0 && (e.pointerType !== 'mouse' || e.button === 0) && !!d.claim && d.claim.down(evt('down', e));
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), type: e.pointerType, button: e.button, shift: e.shiftKey, moved: false, claimed: taken });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer has nothing to capture */ }
    if (taken) return;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }
    d.onGrab?.();
  };

  const onMove = (e: PointerEvent): void => {
    if (disposed) return;
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (mine(e) && e.pointerType === 'mouse' && e.buttons === 0) { take(e); d.onHover(evt('move', e)); }
      return;
    }
    take(e);
    if (p.claimed) { d.claim?.move(evt('move', e)); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (!p.moved && Math.hypot(p.x - p.sx, p.y - p.sy) > TAP_PX) { p.moved = true; d.onHover(null); }
    if (!d.enabled()) return;
    const lim = d.limits();
    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      let g = d.getGoal();
      if (pinch.dist > 8 && dist > 8) g = zoomByFactor(g, dist / pinch.dist, lim);
      g = panBy(g, mx - pinch.mx, my - pinch.my, vh(), d.fovDeg(), lim);
      d.setGoal(g);
      pinch = { dist, mx, my };
      return;
    }
    if (!p.moved) return;
    const panning = p.type === 'mouse' && (p.button === 2 || p.button === 1 || e.shiftKey);
    d.setGoal(panning ? panBy(d.getGoal(), dx, dy, vh(), d.fovDeg(), lim) : orbitBy(d.getGoal(), dx, dy, vh(), lim));
  };

  const onUp = (e: PointerEvent): void => {
    if (disposed) return;
    const p = pointers.get(e.pointerId);
    if (!p) return;
    take(e);
    if (p.claimed) { d.claim?.up(evt('up', e)); pointers.delete(e.pointerId); try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ } return; }
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (pointers.size < 2) pinch = null;
    if (e.type === 'pointerup' && !p.moved && performance.now() - p.t0 <= TAP_MS && (p.type !== 'mouse' || p.button === 0) && pointers.size === 0) d.onTap(evt('up', e));
  };

  const onWheel = (e: WheelEvent): void => {
    if (!mine(e) || disposed) return;
    take(e);
    e.preventDefault();
    if (!d.enabled()) return;
    // a mouse wheel notch is about 100 in pixel mode; a trackpad pinch arrives as ctrl + wheel with small deltas
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 100;
    const notches = (e.deltaY / unit) * (e.ctrlKey ? 2.4 : 1);
    d.setGoal(zoomBy(d.getGoal(), Math.max(-4, Math.min(4, notches)), d.limits()));
    d.onGrab?.();
  };

  const onLeave = (e: PointerEvent): void => { if (mine(e) && e.pointerType === 'mouse') d.onHover(null); };
  const noMenu = (e: Event): void => { e.preventDefault(); };

  const typing = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (disposed || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (d.keysThrough?.()) return; /* Furnish answers Escape itself */ if (e.type === 'keydown') { e.stopPropagation(); d.onEscape(); } return; }
    if (d.keysThrough?.() && FURNISH_KEYS.has(k)) return;
    if (SWALLOW.has(k)) e.stopPropagation();
  };

  const opts = { capture: true } as const;
  host.addEventListener('pointerdown', onDown as EventListener, opts);
  host.addEventListener('pointermove', onMove as EventListener, opts);
  host.addEventListener('pointerup', onUp as EventListener, opts);
  host.addEventListener('pointercancel', onUp as EventListener, opts);
  host.addEventListener('pointerleave', onLeave as EventListener, opts);
  host.addEventListener('wheel', onWheel as EventListener, { capture: true, passive: false });
  canvas.addEventListener('contextmenu', noMenu);
  window.addEventListener('keydown', onKey, opts);
  window.addEventListener('keyup', onKey, opts);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      host.removeEventListener('pointerdown', onDown as EventListener, opts);
      host.removeEventListener('pointermove', onMove as EventListener, opts);
      host.removeEventListener('pointerup', onUp as EventListener, opts);
      host.removeEventListener('pointercancel', onUp as EventListener, opts);
      host.removeEventListener('pointerleave', onLeave as EventListener, opts);
      host.removeEventListener('wheel', onWheel as EventListener, { capture: true } as EventListenerOptions);
      canvas.removeEventListener('contextmenu', noMenu);
      window.removeEventListener('keydown', onKey, opts);
      window.removeEventListener('keyup', onKey, opts);
      pointers.clear();
    },
  };
}
