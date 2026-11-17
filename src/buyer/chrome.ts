// Calm by default, reveal on intent (SPEC 2.7). At rest the walk shows a small identity pill and the prompt; everything else (the top bar, the room
// strip, the floor plan, the full identity card) comes in when the viewer reaches for it and steps away again. One setting, three levels:
// `auto` (this), `always` (everything pinned: demos, training) and `hidden` (nothing but the handle: the old clean view, a kiosk).
// The rules are a pure state machine (`createChromeMachine`, tested in tests/chrome-reveal.test.ts); `mountChrome` is the listeners and the timers.

export type ChromeLevel = 'auto' | 'always' | 'hidden';
/** The parts that come and go: the top row (view switch, camera, Tour, tools, Building), the room strip, the floor plan, the identity card. */
export type ChromeZone = 'top' | 'bottom' | 'map' | 'id';
export const CHROME_ZONES: readonly ChromeZone[] = ['top', 'bottom', 'map', 'id'];

export const REVEAL = {
  /** how long a panel stays after the pointer has left its zone and it, ms */
  graceMs: 600,
  /** the ease in and out (CSS reads the same numbers from tokens.css) */
  inMs: 180, outMs: 320,
  /** after a key (Tab or a shortcut) the chrome stays this long */
  keyMs: 4000,
  /** a tap on the empty scene, or on the handle, shows the chrome for this long without another touch */
  touchMs: 5000,
  /** the first visit: everything shown once, with the key-cap hints */
  firstRunMs: 4000,
} as const;

export interface ChromeFlags {
  top: boolean; bottom: boolean; map: boolean; id: boolean;
  /** the Walk / Doll house / Plan switch: with the top row, and on its own in the doll house and the plan */
  views: boolean;
  /** the small identity pill (gone only at level `hidden`) */
  pill: boolean;
  /** the thin handle at the top centre: the way in on a touch screen and at level `hidden` */
  handle: boolean;
}

export interface ChromeContext {
  /** the walk's own mode: the tools of Furnish and Measure stay while those are on */
  mode: 'walk' | 'furnish' | 'measure' | 'other';
  view: 'walk' | 'doll' | 'plan';
  /** a tour is playing: only its card (and the pill) shows */
  touring: boolean;
  /** a sheet or menu opened from the top row is open: the row stays */
  sheet: boolean;
}

export interface ChromeMachine {
  readonly level: ChromeLevel;
  setLevel(l: ChromeLevel, now: number): void;
  /** the pointer is a finger (no hover): a tap toggles, the handle shows */
  setTouch(on: boolean): void;
  readonly touch: boolean;
  /** the chrome has just been shown to the viewer: the first visit starts its few seconds here */
  begin(now: number, firstRun: boolean): void;
  /** where a mouse is: the edge zones it is in and the panel it is over (both hold their part open) */
  pointer(zones: readonly ChromeZone[], now: number): void;
  /** keyboard focus is inside this part (null: nowhere in the chrome) */
  focus(zone: ChromeZone | null, now: number): void;
  /** Tab or a shortcut */
  key(now: number): void;
  /** a touch tap on the empty scene: in, or out again */
  tap(now: number): void;
  /** a touch on the chrome itself keeps it */
  touched(now: number): void;
  /** the handle was pressed */
  handle(now: number): void;
  setContext(c: Partial<ChromeContext>): void;
  flags(now: number): ChromeFlags;
  /** when the flags will next change by time alone (ms, the same clock), or null */
  nextChange(now: number): number | null;
}

export function isChromeLevel(v: unknown): v is ChromeLevel { return v === 'auto' || v === 'always' || v === 'hidden'; }

/**
 * The level a link asks for. `chrome=auto|always|hidden` wins; the older parameters map onto it: `kiosk=1` is `hidden`, `autohide=0` (never
 * fade) is `always`, `autohide=<seconds>` is `auto` with that many seconds of linger after a touch or a key.
 */
export function parseChromeLevel(search: string): { level: ChromeLevel; lingerMs: number | null } {
  let q: URLSearchParams;
  try { q = new URLSearchParams(search); } catch { return { level: 'auto', lingerMs: null }; }
  const asked = q.get('chrome');
  const kiosk = q.get('kiosk') === '1' || q.get('kiosk') === 'true';
  const raw = q.get('autohide');
  const n = raw === null || raw.trim() === '' ? NaN : Number(raw);
  const hideOk = Number.isFinite(n) && n >= 0 && n <= 600;
  const lingerMs = hideOk && n > 0 ? Math.max(2, n) * 1000 : null;
  if (isChromeLevel(asked)) return { level: asked, lingerMs };
  if (kiosk) return { level: 'hidden', lingerMs };
  if (hideOk && n === 0) return { level: 'always', lingerMs: null };
  return { level: 'auto', lingerMs };
}

/** The level after this one, for the one button that steps through them. */
export function nextChromeLevel(l: ChromeLevel): ChromeLevel { return l === 'auto' ? 'always' : l === 'always' ? 'hidden' : 'auto'; }
export const CHROME_LEVEL_LABEL: Record<ChromeLevel, string> = {
  auto: 'Controls: appear when you reach for them',
  always: 'Controls: always shown',
  hidden: 'Controls: hidden. The handle at the top brings them back',
};

/**
 * The edge zones a pointer at (x, y) is in, for a window of w x h and a design unit of `u` px: the top edge (the row and a little under it), the
 * bottom edge (the room strip) and the bottom left corner (the floor plan, a larger patch than the edge).
 */
export function edgeZones(x: number, y: number, w: number, h: number, u = 1): ChromeZone[] {
  if (!(w > 0 && h > 0) || x < 0 || y < 0 || x > w || y > h) return [];
  const out: ChromeZone[] = [];
  if (y <= Math.min(h * 0.22, 84 * u)) out.push('top');
  if (y >= h - Math.min(h * 0.2, 88 * u)) out.push('bottom');
  if (x <= Math.min(w * 0.3, 250 * u) && y >= h - Math.min(h * 0.36, 230 * u)) out.push('map');
  return out;
}

/** Keys that walk, look or act on the thing in front of you never bring the chrome in; Tab and the shortcuts do. */
const QUIET_KEYS = new Set(['w', 'a', 's', 'd', 'e', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'control', 'alt', 'meta', 'capslock', 'escape', 'enter']);
export function isRevealKey(key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}): boolean {
  if (mods.ctrl || mods.meta || mods.alt) return false;
  if (key === 'Tab') return true;
  const k = key.toLowerCase();
  if (QUIET_KEYS.has(k)) return false;
  return k.length === 1 && /[a-z0-9?/]/.test(k);
}

export function createChromeMachine(opts: { level?: ChromeLevel; touch?: boolean; lingerMs?: number | null } = {}): ChromeMachine {
  let level: ChromeLevel = opts.level ?? 'auto';
  let touch = !!opts.touch;
  const keyMs = opts.lingerMs ?? REVEAL.keyMs;
  const touchMs = opts.lingerMs ?? REVEAL.touchMs;
  const ctx: ChromeContext = { mode: 'walk', view: 'walk', touring: false, sheet: false };
  /** held open by the pointer (edge or panel) and by focus */
  const held: Record<ChromeZone, boolean> = { top: false, bottom: false, map: false, id: false };
  let focused: ChromeZone | null = null;
  /** each part stays until this time after it was let go */
  const until: Record<ChromeZone, number> = { top: 0, bottom: 0, map: 0, id: 0 };
  /** everything stays until this time (a key, a tap, the handle, the first visit) */
  let allUntil = 0;

  const openBy = (z: ChromeZone, now: number): boolean => held[z] || focused === z || now < until[z];
  const release = (z: ChromeZone, now: number): void => { until[z] = Math.max(until[z], now + REVEAL.graceMs); };

  const m: ChromeMachine = {
    get level() { return level; },
    setLevel(l, now) {
      if (l === level) return;
      level = l;
      // the button that set it is in the top row: leave the row a moment so the change is seen, then the new level rules
      allUntil = l === 'hidden' ? 0 : allUntil;
      if (l === 'hidden') { for (const z of CHROME_ZONES) { held[z] = false; until[z] = z === 'top' ? now + 1200 : 0; } }
    },
    setTouch(on) { touch = on; if (on) for (const z of CHROME_ZONES) held[z] = false; },
    get touch() { return touch; },
    begin(now, firstRun) { if (firstRun && level !== 'hidden') allUntil = Math.max(allUntil, now + REVEAL.firstRunMs); },
    pointer(zones, now) {
      for (const z of CHROME_ZONES) {
        // at `hidden` an edge brings nothing in, but a panel that is already in stays while the pointer is on it
        const on = zones.includes(z) && (level !== 'hidden' || openBy(z, now) || now < allUntil);
        if (held[z] && !on) release(z, now);
        held[z] = on;
      }
    },
    focus(zone, now) {
      if (focused && focused !== zone) release(focused, now);
      focused = zone;
    },
    key(now) { allUntil = Math.max(allUntil, now + keyMs); },
    tap(now) {
      if (!touch) return;
      const open = now < allUntil;
      allUntil = open ? 0 : now + touchMs;
      if (open) for (const z of CHROME_ZONES) until[z] = 0;
    },
    touched(now) { if (now < allUntil) allUntil = now + touchMs; },
    handle(now) { allUntil = now + touchMs; },
    setContext(c) { Object.assign(ctx, c); },
    flags(now) {
      const all = now < allUntil;
      const want = (z: ChromeZone): boolean => level === 'always' && z !== 'id' ? true : all && z !== 'id' ? true : openBy(z, now);
      let top = want('top'), bottom = want('bottom'), map = want('map');
      const id = openBy('id', now);
      if (ctx.sheet) top = true;
      if (ctx.mode === 'furnish' || ctx.mode === 'measure') top = true;
      if (ctx.touring) top = bottom = map = false;
      const views = top || (ctx.view !== 'walk' && !ctx.touring);
      return { top, bottom, map, id, views, pill: level !== 'hidden' || top || id, handle: (touch || level === 'hidden') && !top };
    },
    nextChange(now) {
      let t = Infinity;
      if (allUntil > now) t = allUntil;
      for (const z of CHROME_ZONES) if (until[z] > now && !held[z] && focused !== z) t = Math.min(t, until[z]);
      return Number.isFinite(t) ? t : null;
    },
  };
  return m;
}

// ---------------------------------------------------------------- the page side

export interface ChromeDeps {
  /** the HUD root: zones are the elements inside it that carry `data-zone` */
  root: HTMLElement;
  machine: ChromeMachine;
  /** what the walk is doing now */
  context(): ChromeContext;
  /** the flags changed (or the level did) */
  apply(f: ChromeFlags, level: ChromeLevel): void;
  /** the design unit in px (`--wt-z`) */
  unit(): number;
}

export interface MountedChrome {
  readonly machine: ChromeMachine;
  setLevel(l: ChromeLevel): void;
  /** the chrome was shown to the viewer (after the picker): the first visit's few seconds start now. Returns true on a first visit. */
  begin(): boolean;
  /** a tap on the empty scene (the walk's own tap handler calls it when the tap hit nothing) */
  sceneTap(): void;
  /** the handle was pressed */
  openFromHandle(): void;
  /** re-reads the context now (a mode or a view just changed) */
  sync(): void;
  flags(): ChromeFlags;
  dispose(): void;
}

const SEEN_KEY = 'walkthru:chrome:seen';

export function mountChrome(d: ChromeDeps): MountedChrome {
  const m = d.machine;
  const now = (): number => performance.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = '';
  const zoneOf = (n: EventTarget | null): ChromeZone | null => {
    const e = n instanceof Element ? n.closest<HTMLElement>('[data-zone]') : null;
    const z = e?.dataset.zone;
    return z === 'top' || z === 'bottom' || z === 'map' || z === 'id' ? z : null;
  };
  const sync = (): void => {
    const t = now();
    m.setContext(d.context());
    const f = m.flags(t);
    const sig = `${m.level}${f.top ? 1 : 0}${f.bottom ? 1 : 0}${f.map ? 1 : 0}${f.id ? 1 : 0}${f.views ? 1 : 0}${f.pill ? 1 : 0}${f.handle ? 1 : 0}`;
    if (sig !== last) { last = sig; d.apply(f, m.level); }
    if (timer) { clearTimeout(timer); timer = null; }
    const next = m.nextChange(t);
    if (next !== null) timer = setTimeout(sync, Math.max(16, next - t + 8));
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') { if (!m.touch) m.setTouch(true); return; }
    if (m.touch) m.setTouch(false);
    const zones = edgeZones(e.clientX, e.clientY, window.innerWidth, window.innerHeight, d.unit());
    const over = zoneOf(e.target);
    if (over && !zones.includes(over)) zones.push(over);
    m.pointer(zones, now());
    sync();
  };
  const onLeave = (): void => { m.pointer([], now()); sync(); };
  const onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    if (!m.touch) m.setTouch(true);
    if (e.target instanceof Element && e.target.closest('[data-zone], .wt-handle')) m.touched(now());
    sync();
  };
  const onFocus = (): void => {
    const a = document.activeElement;
    // only a focus the keyboard made counts (a click leaves focus on a button until it blurs itself)
    let kb = false;
    try { kb = !!a && a !== document.body && (a as HTMLElement).matches(':focus-visible'); } catch { kb = false; }
    m.focus(kb ? zoneOf(a) : null, now());
    sync();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (!isRevealKey(e.key, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey })) return;
    m.key(now());
    sync();
  };
  window.addEventListener('pointermove', onMove, { capture: true, passive: true });
  window.addEventListener('pointerdown', onDown, { capture: true, passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);
  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', onFocus);
  window.addEventListener('keydown', onKey, true);
  // a mode, a view, a sheet or a tour changes without an event of ours: a slow poll keeps the flags honest
  const poll = setInterval(sync, 250);
  sync();
  return {
    machine: m,
    setLevel(l) { m.setLevel(l, now()); sync(); },
    begin() {
      let first = false;
      try { first = localStorage.getItem(SEEN_KEY) !== '1'; if (first) localStorage.setItem(SEEN_KEY, '1'); } catch { first = false; }
      m.begin(now(), first);
      sync();
      return first && m.level !== 'hidden';
    },
    sceneTap() { m.tap(now()); sync(); },
    openFromHandle() { m.handle(now()); sync(); },
    sync,
    flags: () => m.flags(now()),
    dispose() {
      clearInterval(poll);
      if (timer) clearTimeout(timer);
      window.removeEventListener('pointermove', onMove, { capture: true } as EventListenerOptions);
      window.removeEventListener('pointerdown', onDown, { capture: true } as EventListenerOptions);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onFocus);
      window.removeEventListener('keydown', onKey, true);
    },
  };
}
