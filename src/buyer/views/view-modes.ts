// The three ways to look at a scene: Walk (the default, exactly the walk as it always was), Doll house (the whole space seen from above,
// orbiting) and Plan (a flat 2D drawing). This file is the pure state machine: which mode is wanted, how far the camera has flown
// between the walker and the doll house, how far the plan has faded in, the `?view=` address. No DOM, no three, so it is unit-tested.

export type ViewMode = 'walk' | 'dollhouse' | 'plan';
export const VIEW_MODES: readonly ViewMode[] = ['walk', 'dollhouse', 'plan'];
export const VIEW_LABELS: Record<ViewMode, string> = { walk: 'Walk', dollhouse: 'Doll house', plan: 'Plan' };
export const DEFAULT_VIEW: ViewMode = 'walk';
export const VIEW_PARAM = 'view';

/** Seconds the camera takes to fly between the walker and the doll house pose. */
export const FLIGHT_S = 0.9;
/** Seconds the plan takes to fade in over the 3D view and out again. */
export const PLAN_FADE_S = 0.28;

export function isViewMode(v: unknown): v is ViewMode {
  return v === 'walk' || v === 'dollhouse' || v === 'plan';
}

/** The mode a query string asks for: `?view=dollhouse|plan|walk`. Anything else (and no parameter) is Walk. */
export function parseViewParam(search: string): ViewMode {
  try {
    const v = (new URLSearchParams(search).get(VIEW_PARAM) ?? '').trim().toLowerCase();
    if (v === 'doll' || v === 'dollhouse' || v === 'doll-house') return 'dollhouse';
    return isViewMode(v) ? v : DEFAULT_VIEW;
  } catch { return DEFAULT_VIEW; }
}

/** `href` with `?view=` set to `mode` (the parameter is left out for Walk, the default, so an ordinary link stays clean). Every other parameter is kept as it was. */
export function withViewParam(href: string, mode: ViewMode): string {
  try {
    const u = new URL(href, 'http://x.invalid');
    if (mode === DEFAULT_VIEW) u.searchParams.delete(VIEW_PARAM); else u.searchParams.set(VIEW_PARAM, mode);
    const q = u.searchParams.toString();
    return `${u.pathname}${q ? `?${q}` : ''}${u.hash}`;
  } catch { return href; }
}

/** 0..1 eased with zero speed and zero acceleration at both ends. */
export function smootherstep(k: number): number {
  const x = Math.min(1, Math.max(0, k));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export interface Flight {
  /** 0 = the walker's camera, 1 = the doll house pose (eased) */
  amount: number;
  /** 0..1 progress before easing */
  raw: number;
  /** the camera is between the two poses right now */
  moving: boolean;
  /** which way it is going: 1 up to the doll house, -1 down to the walker, 0 at rest */
  dir: -1 | 0 | 1;
}

export interface ViewMachine {
  /** the mode asked for (the target: the camera may still be on its way) */
  mode(): ViewMode;
  /** asks for a mode; false when it is the mode already asked for */
  set(mode: ViewMode, opts?: { instant?: boolean }): boolean;
  /** advances the clock by `dt` seconds (any size: it is not tied to the frame rate) */
  tick(dt: number): void;
  flight(): Flight;
  /** 0..1 how far the plan covers the 3D view (eased) */
  planAmount(): number;
  /** the doll house is (partly) on: the ceiling is faded or gone, the light is its own */
  dollhouseOn(): boolean;
  /** the 3D view is not visible at all (the plan covers it): the frame loop may rest */
  rendering3D(): boolean;
  onChange(cb: (mode: ViewMode, prev: ViewMode) => void): () => void;
}

export function createViewMachine(initial: ViewMode = DEFAULT_VIEW, opts: { flightS?: number; planFadeS?: number } = {}): ViewMachine {
  const flightS = Math.max(0.01, opts.flightS ?? FLIGHT_S);
  const planS = Math.max(0.01, opts.planFadeS ?? PLAN_FADE_S);
  let mode: ViewMode = initial;
  // the raw flight progress and where it is heading
  let p = initial === 'dollhouse' ? 1 : 0;
  let pTarget = p;
  let plan = initial === 'plan' ? 1 : 0;
  const listeners = new Set<(m: ViewMode, prev: ViewMode) => void>();

  const flightTargetFor = (m: ViewMode): number => (m === 'dollhouse' ? 1 : m === 'walk' ? 0 : p >= 0.5 ? 1 : 0);

  return {
    mode: () => mode,
    set(next, o) {
      if (next === mode) return false;
      const prev = mode;
      mode = next;
      pTarget = flightTargetFor(next);
      // Plan from a flight half done carries on to the nearer end, out of sight
      if (o?.instant) { p = pTarget; plan = next === 'plan' ? 1 : 0; }
      for (const cb of [...listeners]) { try { cb(mode, prev); } catch (e) { console.error('[walkthru] view listener threw', e); } }
      return true;
    },
    tick(dt) {
      const d = Math.max(0, dt);
      if (p !== pTarget) { const step = d / flightS; p = pTarget > p ? Math.min(pTarget, p + step) : Math.max(pTarget, p - step); }
      const planTarget = mode === 'plan' ? 1 : 0;
      if (plan !== planTarget) { const step = d / planS; plan = planTarget > plan ? Math.min(planTarget, plan + step) : Math.max(planTarget, plan - step); }
    },
    flight() {
      return { amount: smootherstep(p), raw: p, moving: p !== pTarget, dir: p === pTarget ? 0 : pTarget > p ? 1 : -1 };
    },
    planAmount: () => smootherstep(plan),
    dollhouseOn: () => p > 0,
    rendering3D: () => plan < 1 || mode !== 'plan',
    onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };
}

/** What the rest of the page sees of the view modes (`ctx.views`, and on `window.__walkthru` under `?debug`): the top bar's segmented control reads and writes through it. */
export interface ViewsApi {
  mode(): ViewMode;
  set(mode: ViewMode): void;
  onChange(cb: (mode: ViewMode, prev: ViewMode) => void): () => void;
}
