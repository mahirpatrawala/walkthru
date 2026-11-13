// Keyboard, mouse and touch input (SPEC 2.3). DOM only, no three.
//
// Desktop: WASD or arrows walk (relative to the camera), Shift jogs, drag with the left button looks, the wheel
// zooms, E interacts, M measure, F furnish, Q / E rotate by 15 degrees, R rotates by 90, Esc cancels.
// Touch: a floating joystick under the left thumb (60 px radius, push past 85% to jog), drag on the right half to
// look, pinch to zoom. A tap is pointer down and up within 250 ms and 8 px.

export interface PointerEvt { type: 'down' | 'move' | 'up'; ndcX: number; ndcY: number; clientX: number; clientY: number }

/** What the joystick is doing right now, for a HUD that wants to draw it (client pixels). */
export interface JoystickView { active: boolean; originX: number; originY: number; x: number; y: number; radius: number }

export interface Input {
  /** -1..1; moveY +1 = forward */
  moveX: number; moveY: number; jog: boolean;
  /** consume accumulated look drag (px) and zoom (wheel notches / pinch) since the last call */
  takeLook(): { dx: number; dy: number; zoom: number };
  on(evt: 'interact' | 'cancel' | 'measure' | 'furnish' | 'rotate-left' | 'rotate-right' | 'rotate-90', cb: () => void): () => void;
  onTap(cb: (e: PointerEvt) => void): () => void;
  /** claimant returns true on 'down' to receive that pointer's moves and up instead of the look drag */
  claimPointer(fn: ((e: PointerEvt) => boolean) | null): void;
  /** in 'rotate' mode the E key emits 'rotate-right' instead of 'interact' (furnish mode) */
  setInteractKeyMode(mode: 'interact' | 'rotate'): void;
  dispose(): void;
  /** Extra (not in the base contract): the joystick, so the HUD can draw it. Absent on test doubles. */
  readonly joystick?: JoystickView;
}

type KeyEvt = Parameters<Input['on']>[0];

const JOYSTICK_RADIUS_PX = 60;
const JOG_THRESHOLD = 0.85;
const TAP_MS = 250;
const TAP_PX = 8;
/** Pinch distance that counts as one zoom notch, px. */
const PINCH_PX_PER_NOTCH = 40;
/** Two touches that land this close together, within PINCH_WINDOW_MS, are a pinch, not a thumb on each side. */
const PINCH_START_PX = 150;
const PINCH_WINDOW_MS = 450;
/** Elements that keep their own clicks: input never reacts to pointers that start on them. */
const UI_SELECTOR = 'button, a, input, select, textarea, label, [data-ui]';

interface PointerState {
  role: 'joystick' | 'look' | 'claimed';
  startX: number; startY: number; startT: number;
  lastX: number; lastY: number;
  moved: boolean;
}

class InputImpl implements Input {
  moveX = 0;
  moveY = 0;
  jog = false;
  readonly joystick: JoystickView = { active: false, originX: 0, originY: 0, x: 0, y: 0, radius: JOYSTICK_RADIUS_PX };

  private readonly el: HTMLElement;
  private readonly keys = new Set<string>();
  private shiftDown = false;
  private joyId: number | null = null;
  private joyX = 0;
  private joyY = 0;
  private joyMag = 0;
  private readonly pointers = new Map<number, PointerState>();
  private readonly lastPos = new Map<number, { x: number; y: number }>();
  private pinchDist: number | null = null;
  private look = { dx: 0, dy: 0, zoom: 0 };
  private readonly listeners = new Map<KeyEvt, Set<() => void>>();
  private readonly tapListeners = new Set<(e: PointerEvt) => void>();
  private claim: ((e: PointerEvt) => boolean) | null = null;
  private interactMode: 'interact' | 'rotate' = 'interact';
  private readonly cleanups: Array<() => void> = [];

  constructor(el: HTMLElement) {
    this.el = el;
    el.style.touchAction = 'none';
    el.style.userSelect = 'none';
    (el.style as unknown as Record<string, string>).webkitUserSelect = 'none';
    (el.style as unknown as Record<string, string>).webkitTouchCallout = 'none';

    const add = <T extends Event>(target: EventTarget, type: string, fn: (e: T) => void, opts?: AddEventListenerOptions): void => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    add<KeyboardEvent>(window, 'keydown', (e) => this.onKeyDown(e));
    add<KeyboardEvent>(window, 'keyup', (e) => this.onKeyUp(e));
    add<Event>(window, 'blur', () => this.releaseAll());
    add<Event>(document, 'visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    add<PointerEvent>(el, 'pointerdown', (e) => this.onPointerDown(e));
    add<PointerEvent>(el, 'pointermove', (e) => this.onPointerMove(e));
    add<PointerEvent>(el, 'pointerup', (e) => this.onPointerEnd(e, true));
    add<PointerEvent>(el, 'pointercancel', (e) => this.onPointerEnd(e, false));
    add<WheelEvent>(el, 'wheel', (e) => this.onWheel(e), { passive: false });
    add<Event>(el, 'contextmenu', (e) => e.preventDefault());
    // iOS Safari would otherwise zoom the page on pinch
    for (const g of ['gesturestart', 'gesturechange', 'gestureend']) add<Event>(el, g, (e) => e.preventDefault());
  }

  // ---------------------------------------------------------------- public

  takeLook(): { dx: number; dy: number; zoom: number } {
    const out = this.look;
    this.look = { dx: 0, dy: 0, zoom: 0 };
    return out;
  }

  on(evt: KeyEvt, cb: () => void): () => void {
    let set = this.listeners.get(evt);
    if (!set) this.listeners.set(evt, (set = new Set()));
    set.add(cb);
    return () => { set!.delete(cb); };
  }

  onTap(cb: (e: PointerEvt) => void): () => void {
    this.tapListeners.add(cb);
    return () => { this.tapListeners.delete(cb); };
  }

  claimPointer(fn: ((e: PointerEvt) => boolean) | null): void {
    this.claim = fn;
  }

  setInteractKeyMode(mode: 'interact' | 'rotate'): void {
    this.interactMode = mode;
  }

  dispose(): void {
    for (const c of this.cleanups.splice(0)) c();
    this.releaseAll();
    this.listeners.clear();
    this.tapListeners.clear();
    this.claim = null;
  }

  // ---------------------------------------------------------------- keyboard

  private static editable(t: EventTarget | null): boolean {
    const n = t as HTMLElement | null;
    if (!n || !n.tagName) return false;
    const tag = n.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || n.isContentEditable === true;
  }

  private emit(evt: KeyEvt): void {
    const set = this.listeners.get(evt);
    if (!set) return;
    for (const cb of [...set]) {
      try { cb(); } catch (err) { console.error(`[walkthru] input handler for "${evt}" threw`, err); }
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.shiftDown = e.shiftKey;
    if (InputImpl.editable(e.target) || e.ctrlKey || e.metaKey || e.altKey) { this.recompute(); return; }
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    switch (k) {
      case 'w': case 'ArrowUp': this.keys.add('f'); break;
      case 's': case 'ArrowDown': this.keys.add('b'); break;
      case 'a': case 'ArrowLeft': this.keys.add('l'); break;
      case 'd': case 'ArrowRight': this.keys.add('r'); break;
      case 'e': if (this.interactMode === 'rotate') this.emit('rotate-right'); else if (!e.repeat) this.emit('interact'); break;
      case 'q': this.emit('rotate-left'); break;
      case 'r': if (!e.repeat) this.emit('rotate-90'); break;
      case 'm': if (!e.repeat) this.emit('measure'); break;
      case 'f': if (!e.repeat) this.emit('furnish'); break;
      case 'Escape': if (!e.repeat) this.emit('cancel'); break;
      default: break;
    }
    if (k.startsWith('Arrow')) e.preventDefault();
    this.recompute();
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.shiftDown = e.shiftKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    switch (k) {
      case 'w': case 'ArrowUp': this.keys.delete('f'); break;
      case 's': case 'ArrowDown': this.keys.delete('b'); break;
      case 'a': case 'ArrowLeft': this.keys.delete('l'); break;
      case 'd': case 'ArrowRight': this.keys.delete('r'); break;
      default: break;
    }
    this.recompute();
  }

  private releaseAll(): void {
    this.keys.clear();
    this.shiftDown = false;
    this.joyId = null;
    this.joyX = this.joyY = this.joyMag = 0;
    this.joystick.active = false;
    this.pointers.clear();
    this.lastPos.clear();
    this.pinchDist = null;
    this.recompute();
  }

  /** Joystick wins while a thumb is down; otherwise the keys. */
  private recompute(): void {
    if (this.joyId !== null) {
      this.moveX = this.joyX;
      this.moveY = this.joyY;
      this.jog = this.joyMag > JOG_THRESHOLD || this.shiftDown;
      return;
    }
    let x = (this.keys.has('r') ? 1 : 0) - (this.keys.has('l') ? 1 : 0);
    let y = (this.keys.has('f') ? 1 : 0) - (this.keys.has('b') ? 1 : 0);
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.moveX = x;
    this.moveY = y;
    this.jog = this.shiftDown;
  }

  // ---------------------------------------------------------------- pointers

  private evt(type: PointerEvt['type'], e: PointerEvent): PointerEvt {
    const r = this.el.getBoundingClientRect();
    const w = r.width || 1;
    const h = r.height || 1;
    return {
      type, clientX: e.clientX, clientY: e.clientY,
      ndcX: ((e.clientX - r.left) / w) * 2 - 1,
      ndcY: -(((e.clientY - r.top) / h) * 2 - 1),
    };
  }

  private capture(e: PointerEvent): void {
    try { this.el.setPointerCapture(e.pointerId); } catch { /* not capturable (synthetic or already gone): moves still arrive over the element */ }
  }

  private onPointerDown(e: PointerEvent): void {
    const t = e.target as Element | null;
    if (t && typeof t.closest === 'function' && t.closest(UI_SELECTOR)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.capture(e);
    const base = { startX: e.clientX, startY: e.clientY, startT: performance.now(), lastX: e.clientX, lastY: e.clientY, moved: false };

    if (this.claim) {
      let taken = false;
      try { taken = this.claim(this.evt('down', e)); } catch (err) { console.error('[walkthru] pointer claimant threw', err); }
      if (taken) { this.pointers.set(e.pointerId, { ...base, role: 'claimed' }); return; }
    }

    // a pinch started near the middle of the screen must not turn one finger into a joystick: when a touch lands next to a
    // fresh one that has not moved, both become look fingers (one thumb on each side stays walk + look)
    if (e.pointerType !== 'mouse') {
      const now = performance.now();
      for (const [id, q] of this.pointers) {
        if (q.role === 'claimed' || now - q.startT > PINCH_WINDOW_MS || Math.hypot(q.lastX - q.startX, q.lastY - q.startY) > 12) continue;
        if (Math.hypot(e.clientX - q.lastX, e.clientY - q.lastY) > PINCH_START_PX) continue;
        if (q.role === 'joystick') {
          this.joyId = null;
          this.joyX = this.joyY = this.joyMag = 0;
          this.joystick.active = false;
          this.recompute();
          q.role = 'look';
          this.lastPos.set(id, { x: q.lastX, y: q.lastY });
        }
        this.pointers.set(e.pointerId, { ...base, role: 'look' });
        this.lastPos.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.pinchDist = null;
        return;
      }
    }

    const r = this.el.getBoundingClientRect();
    const leftHalf = e.clientX < r.left + r.width / 2;
    if (e.pointerType !== 'mouse' && leftHalf && this.joyId === null) {
      this.joyId = e.pointerId;
      this.joyX = this.joyY = this.joyMag = 0;
      Object.assign(this.joystick, { active: true, originX: e.clientX, originY: e.clientY, x: 0, y: 0 });
      this.pointers.set(e.pointerId, { ...base, role: 'joystick' });
      this.recompute();
      return;
    }
    this.pointers.set(e.pointerId, { ...base, role: 'look' });
    this.lastPos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.pinchDist = null;
  }

  private lookPointers(): number[] {
    const ids: number[] = [];
    for (const [id, p] of this.pointers) if (p.role === 'look') ids.push(id);
    return ids;
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) > TAP_PX) p.moved = true;

    if (p.role === 'claimed') {
      try { this.claim?.(this.evt('move', e)); } catch (err) { console.error('[walkthru] pointer claimant threw', err); }
      return;
    }
    if (p.role === 'joystick') {
      const dx = e.clientX - this.joystick.originX;
      const dy = e.clientY - this.joystick.originY;
      const len = Math.hypot(dx, dy);
      const k = len > JOYSTICK_RADIUS_PX ? JOYSTICK_RADIUS_PX / len : 1;
      this.joyX = (dx * k) / JOYSTICK_RADIUS_PX;
      this.joyY = (-dy * k) / JOYSTICK_RADIUS_PX; // screen y is down, forward is up
      this.joyMag = Math.min(1, len / JOYSTICK_RADIUS_PX);
      this.joystick.x = dx * k;
      this.joystick.y = dy * k;
      this.recompute();
      return;
    }

    // look: one finger or the mouse drags; two look fingers pinch
    this.lastPos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ids = this.lookPointers();
    if (ids.length >= 2) {
      const a = this.lastPos.get(ids[0]);
      const b = this.lastPos.get(ids[1]);
      if (a && b) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDist !== null) this.look.zoom += (this.pinchDist - d) / PINCH_PX_PER_NOTCH; // fingers closing zooms out
        this.pinchDist = d;
      }
    } else {
      this.look.dx += e.clientX - p.lastX;
      this.look.dy += e.clientY - p.lastY;
    }
    p.lastX = e.clientX;
    p.lastY = e.clientY;
  }

  private onPointerEnd(e: PointerEvent, isUp: boolean): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    this.lastPos.delete(e.pointerId);
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* already released */ }

    if (p.role === 'claimed') {
      try { this.claim?.(this.evt('up', e)); } catch (err) { console.error('[walkthru] pointer claimant threw', err); }
      return;
    }
    if (p.role === 'joystick') {
      this.joyId = null;
      this.joyX = this.joyY = this.joyMag = 0;
      this.joystick.active = false;
      this.recompute();
    }
    if (this.lookPointers().length < 2) this.pinchDist = null;

    if (isUp && !p.moved && performance.now() - p.startT <= TAP_MS) {
      const evt = this.evt('up', e);
      for (const cb of [...this.tapListeners]) {
        try { cb(evt); } catch (err) { console.error('[walkthru] tap handler threw', err); }
      }
    }
  }

  private onWheel(e: WheelEvent): void {
    const t = e.target as Element | null;
    if (t && typeof t.closest === 'function' && t.closest(UI_SELECTOR)) return;
    e.preventDefault();
    // one mouse-wheel notch is deltaY 100 in pixel mode, 3 in line mode
    const notches = e.deltaMode === 1 ? e.deltaY / 3 : e.deltaY / 100;
    this.look.zoom += Math.max(-3, Math.min(3, notches));
  }
}

export function createInput(el: HTMLElement): Input {
  if (typeof window === 'undefined' || !el) {
    throw new Error('createInput: needs a browser window and an element to listen on');
  }
  return new InputImpl(el);
}
