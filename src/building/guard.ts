// A space of a building is taken down and the next one built in the same page, so everything a space put on the page has to come off
// it again. Most of the walk's modules clean up after themselves (dispose); this is the safety net for the rest, and for anything
// another change adds later: while a guard is on, every listener added to `window` or `document`, every timer and every element added to
// the body is recorded, and `release` takes them all off again. Only used when a building drives the walk; a lone home is untouched.
export interface Guard {
  /** removes what the space added; safe to call twice */
  release(): void;
  counts(): { listeners: number; timers: number; nodes: number };
}

type Rec = { target: EventTarget; type: string; fn: EventListenerOrEventListenerObject; opts?: boolean | AddEventListenerOptions };

const realSetTimeout = window.setTimeout.bind(window);
const realSetInterval = window.setInterval.bind(window);
const realClearTimeout = window.clearTimeout.bind(window);
const realClearInterval = window.clearInterval.bind(window);
const realRaf = window.requestAnimationFrame.bind(window);
const realCancelRaf = window.cancelAnimationFrame.bind(window);
const realWinAdd = window.addEventListener.bind(window);
const realWinRemove = window.removeEventListener.bind(window);
const realDocAdd = document.addEventListener.bind(document);
const realDocRemove = document.removeEventListener.bind(document);

/** Timers the building's own code starts while a guard is on (the transition curtain, the lift) must not be swept with the space's. */
export const bypass = { setTimeout: realSetTimeout, setInterval: realSetInterval, clearTimeout: realClearTimeout, clearInterval: realClearInterval };

let active: { listeners: Rec[]; timeouts: Set<number>; intervals: Set<number>; rafs: Set<number> } | null = null;
let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  const w = window as unknown as Record<string, unknown>;
  w.addEventListener = (type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions): void => {
    realWinAdd(type, fn, opts);
    active?.listeners.push({ target: window, type, fn, opts });
  };
  document.addEventListener = (type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions): void => {
    realDocAdd(type, fn, opts);
    active?.listeners.push({ target: document, type, fn, opts });
  };
  w.setTimeout = (fn: TimerHandler, ms?: number, ...args: unknown[]): number => {
    const g = active;
    if (!g || typeof fn !== 'function') return realSetTimeout(fn as never, ms, ...args);
    const id: number = realSetTimeout(() => { g.timeouts.delete(id); (fn as (...a: unknown[]) => void)(...args); }, ms);
    g.timeouts.add(id);
    return id;
  };
  w.setInterval = (fn: TimerHandler, ms?: number, ...args: unknown[]): number => {
    const id: number = realSetInterval(fn as never, ms, ...args);
    active?.intervals.add(id);
    return id;
  };
  w.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const g = active;
    if (!g) return realRaf(cb);
    const id: number = realRaf((t) => { g.rafs.delete(id); cb(t); });
    g.rafs.add(id);
    return id;
  };
}

/**
 * Runs `fn` with no guard recording, and marks any element it adds to the body as kept: for the building's own screens (the loading
 * screen of the next space, the lift's curtain), which are made while the old space is still up and must outlive it.
 */
export function exempt<T>(fn: () => T): T {
  const was = active;
  active = null;
  const before = new Set<Node>(Array.from(document.body.children));
  try { return fn(); } finally {
    active = was;
    for (const n of Array.from(document.body.children)) if (!before.has(n)) (n as HTMLElement).dataset.wtKeep = '1';
  }
}

/** Starts recording. One guard at a time: a new one is begun only after the last was released. */
export function beginGuard(): Guard {
  install();
  if (active) throw new Error('beginGuard: the last space was not released');
  const mine = { listeners: [] as Rec[], timeouts: new Set<number>(), intervals: new Set<number>(), rafs: new Set<number>() };
  active = mine;
  const keep = new Set<Node>(Array.from(document.body.children));
  let done = false;
  const stray = (): Node[] => Array.from(document.body.children).filter((n) => !keep.has(n) && !(n as HTMLElement).dataset?.wtKeep);
  return {
    release() {
      if (done) return;
      done = true;
      if (active === mine) active = null;
      for (const r of mine.listeners) {
        if (r.target === window) realWinRemove(r.type, r.fn, r.opts);
        else realDocRemove(r.type, r.fn, r.opts);
      }
      for (const id of mine.timeouts) realClearTimeout(id);
      for (const id of mine.intervals) realClearInterval(id);
      for (const id of mine.rafs) realCancelRaf(id);
      for (const n of stray()) (n as ChildNode).remove();
      mine.listeners.length = 0; mine.timeouts.clear(); mine.intervals.clear(); mine.rafs.clear();
    },
    counts: () => ({ listeners: mine.listeners.length, timers: mine.timeouts.size + mine.intervals.size, nodes: stray().length }),
  };
}
