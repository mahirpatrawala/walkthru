// The glass adapts to what is behind it (SPEC 2.7): over a bright room a panel is light glass with dark text, over a dark scene it is dark glass
// with light text, and it cross-fades between the two. The choice and the contrast arithmetic are pure (tests/glass-tone.test.ts checks AA for both
// variants at the worst backdrop each can meet); `mountGlassTone` samples a tiny copy of the 3D canvas a few times a second and writes
// `data-lens` on every panel, and moves the specular highlight with the pointer.

export type GlassTone = 'light' | 'dark';

/** The two variants, exactly as tokens.css paints them (kept in step by tests/glass-tone.test.ts, which reads the CSS). sRGB 0..255, alpha 0..1. */
export interface GlassVariant { fill: [number, number, number, number]; text: [number, number, number]; dimAlpha: number; onFill: [number, number, number, number] }
export const GLASS: Record<GlassTone, GlassVariant> = {
  light: { fill: [255, 255, 255, 0.2], text: [29, 23, 20], dimAlpha: 0.82, onFill: [255, 255, 255, 0.62] },
  dark: { fill: [18, 15, 14, 0.5], text: [255, 255, 255], dimAlpha: 0.84, onFill: [255, 255, 255, 0.2] },
};
/** Without blur (the low tier, a browser with no backdrop-filter) the fill carries the contrast alone. */
export const GLASS_FLAT: Record<GlassTone, GlassVariant> = {
  light: { ...GLASS.light, fill: [250, 247, 242, 0.84] },
  dark: { ...GLASS.dark, fill: [24, 20, 18, 0.82] },
};

/** Sheet glass (the panels that ask something): always light, ink text; thicker when the whole scene is dark. Fill alpha by the scene's variant, ink and muted text (brand.css). */
export const SHEET = { fill: [252, 249, 244] as const, alpha: { light: 0.78, dark: 0.9 } as Record<GlassTone, number>, ink: [43, 33, 28] as const, muted: [107, 94, 85] as const };
/** The contrast of a sheet's ink and muted text over a flat backdrop of luminance `l`, for the scene variant in force. */
export function sheetContrast(scene: GlassTone, l: number): { ink: number; muted: number } {
  const g = greyOf(l);
  const lp = luminance(...over([SHEET.fill[0], SHEET.fill[1], SHEET.fill[2], SHEET.alpha[scene]], [g, g, g]));
  return { ink: contrast(luminance(...SHEET.ink), lp), muted: contrast(luminance(...SHEET.muted), lp) };
}

/**
 * Backdrop luminance (0..1, relative, WCAG) at which a panel changes variant, with a gap so it does not flicker: it turns dark when the scene
 * behind it falls under `toDark` and light again when it rises over `toLight`.
 */
export const TONE_SWITCH = { toDark: 0.2, toLight: 0.29 } as const;

const lin = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
/** WCAG relative luminance of an sRGB colour (0..255 each). */
export function luminance(r: number, g: number, b: number): number { return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
/** WCAG contrast ratio of two luminances. */
export function contrast(l1: number, l2: number): number { const a = Math.max(l1, l2), b = Math.min(l1, l2); return (a + 0.05) / (b + 0.05); }
/** `top` (with alpha) over an opaque `under`, in sRGB as a browser composites. */
export function over(top: readonly [number, number, number, number], under: readonly [number, number, number]): [number, number, number] {
  const a = top[3];
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a)];
}
/** The grey (sRGB 0..255) that has this relative luminance. */
export function greyOf(l: number): number { const v = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055; return Math.max(0, Math.min(255, v * 255)); }

/** The variant for a backdrop of luminance `l`, given the one in force (hysteresis). */
export function chooseTone(l: number, current: GlassTone | null): GlassTone {
  if (!Number.isFinite(l)) return current ?? 'dark';
  if (current === 'dark') return l > TONE_SWITCH.toLight ? 'light' : 'dark';
  if (current === 'light') return l < TONE_SWITCH.toDark ? 'dark' : 'light';
  return l >= (TONE_SWITCH.toDark + TONE_SWITCH.toLight) / 2 ? 'light' : 'dark';
}

export interface ToneContrast { text: number; dim: number; selected: number }
/** The contrast of a variant's text, its dim text and its selected capsule's text over a flat backdrop of luminance `l`. */
export function toneContrast(v: GlassVariant, l: number): ToneContrast {
  const g = greyOf(l);
  const panel = over(v.fill, [g, g, g]);
  const lp = luminance(...panel);
  const dimC = over([v.text[0], v.text[1], v.text[2], v.dimAlpha], panel);
  const cap = over(v.onFill, panel);
  return { text: contrast(luminance(...v.text), lp), dim: contrast(luminance(...dimC), lp), selected: contrast(luminance(...v.text), luminance(...cap)) };
}

/** The backdrops a variant can stand over once the switch has settled: a light panel never sees under `toDark`, a dark one never over `toLight`. */
export function toneRange(t: GlassTone): [number, number] { return t === 'light' ? [TONE_SWITCH.toDark, 1] : [0, TONE_SWITCH.toLight]; }

/** A fallback when the canvas cannot be read: the hour of the look (a home is bright by day and dark at night). */
export function toneFromHour(hour: number): GlassTone { const h = ((hour % 24) + 24) % 24; return h >= 6.5 && h < 18.5 ? 'light' : 'dark'; }

/** The mean luminance of the cells of a `gw x gh` RGBA grid under a rect given in 0..1 of the window. Cells with no alpha (nothing drawn) are skipped; none at all gives null. */
export function sampleRect(data: ArrayLike<number>, gw: number, gh: number, r: { x0: number; y0: number; x1: number; y1: number }): number | null {
  const cx0 = Math.max(0, Math.min(gw - 1, Math.floor(r.x0 * gw))), cx1 = Math.max(cx0, Math.min(gw - 1, Math.ceil(r.x1 * gw) - 1));
  const cy0 = Math.max(0, Math.min(gh - 1, Math.floor(r.y0 * gh))), cy1 = Math.max(cy0, Math.min(gh - 1, Math.ceil(r.y1 * gh) - 1));
  let sum = 0, n = 0;
  for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
    const i = (y * gw + x) * 4;
    if (data[i + 3] === 0) continue;
    sum += luminance(data[i], data[i + 1], data[i + 2]); n++;
  }
  return n ? sum / n : null;
}

// ---------------------------------------------------------------- the page side

/** Every element that wears the glass: the sampler gives each its own `data-lens` (`data-tone` is the verdict cards' good, warn, bad). */
export const GLASS_PANELS = '.wt-glass, .wt-seg, .wt-tools, .wt-tourslot, .wt-pill, .wt-exit .wt-btn, .wt-nav-strip, .wt-partial-badge, .wt-layout-chip, .wt-handle, .wt-views-tip, .wt-views-plan-ctl, .wt-views-plan-hint, .wto-pill button';

export interface GlassToneDeps {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  /** the look's hour, the fallback when the canvas reads empty */
  hour(): number | null;
  /** no blur on this device (the low tier): the flat fill is used */
  flat(): boolean;
}
export interface MountedGlassTone {
  /** call at the end of a rendered frame (the drawing buffer is only readable then) */
  afterFrame(): void;
  /** debug: the last whole-scene luminance and how long the last sample took, ms */
  stats(): { luminance: number | null; ms: number; tone: GlassTone; samples: number };
  /** read again at the next frame (a panel just came in, a sheet just opened) */
  kick(): void;
  /** debug (the harness measures the cost of the blur): force the blurred or the flat material, null gives the device its own back */
  force(mode: 'blur' | 'flat' | null): void;
  dispose(): void;
}

const GW = 32, GH = 20, EVERY_MS = 380;
/** The longest a read may back off to on a device where it is slow: a panel's variant is never older than this once the scene has drawn (it was 25 reads' worth, which on software GL left the first, default variant on screen for half a minute). */
export const BACKOFF_MAX_MS = 2500;

export function mountGlassTone(d: GlassToneDeps): MountedGlassTone {
  const doc = d.root.ownerDocument;
  const html = doc.documentElement;
  const supports = typeof CSS !== 'undefined' && (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'));
  let reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* no matchMedia */ }
  const small = doc.createElement('canvas');
  small.width = GW; small.height = GH;
  let g2: CanvasRenderingContext2D | null = null;
  try { g2 = small.getContext('2d', { willReadFrequently: true }); } catch { g2 = null; }
  let lastAt = 0, lastMs = 0, lastL: number | null = null, samples = 0;
  let global: GlassTone = 'dark';
  const tones = new WeakMap<Element, GlassTone>();

  let forced: 'blur' | 'flat' | null = null;
  const setFlat = (): void => { html.dataset.glass = forced ?? (!supports || d.flat() ? 'flat' : 'blur'); };
  setFlat();

  const planTone = (): number | null => {
    const plan = d.root.parentElement?.querySelector<HTMLElement>('.wt-views-plan:not([hidden])') ?? doc.querySelector<HTMLElement>('.wt-views-plan:not([hidden])');
    if (!plan) return null;
    const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(plan).backgroundColor);
    if (!m) return null;
    const [r, g, b] = m[1].split(',').map((s) => parseFloat(s));
    return luminance(r, g, b);
  };

  function afterFrame(): void {
    const t = performance.now();
    // a few times a second where the read is cheap; where it is not (software GL reads the whole canvas back) it backs off so it never takes more than about 4% of the time
    if (t - lastAt < Math.min(BACKOFF_MAX_MS, Math.max(EVERY_MS, lastMs * 25))) return;
    lastAt = t;
    setFlat();
    let data: Uint8ClampedArray | null = null;
    const plan = planTone();
    if (plan === null && g2) {
      try {
        g2.clearRect(0, 0, GW, GH);
        g2.drawImage(d.canvas, 0, 0, GW, GH);
        data = g2.getImageData(0, 0, GW, GH).data;
      } catch { data = null; }
    }
    const whole = plan ?? (data ? sampleRect(data, GW, GH, { x0: 0, y0: 0, x1: 1, y1: 1 }) : null);
    const hour = d.hour();
    lastL = whole;
    // nothing drawn yet (the first frames): the default variant stands, and the next frame reads again instead of waiting a whole interval
    if (whole === null && samples === 0) lastAt = 0;
    global = whole !== null ? chooseTone(whole, global) : hour !== null ? toneFromHour(hour) : global;
    if (d.root.dataset.lens !== global) d.root.dataset.lens = global;
    if (html.dataset.glassTone !== global) html.dataset.glassTone = global;
    const W = window.innerWidth || 1, H = window.innerHeight || 1;
    for (const el of doc.querySelectorAll<HTMLElement>(GLASS_PANELS)) {
      let tone = global;
      if (plan === null && data) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const l = sampleRect(data, GW, GH, { x0: r.left / W, y0: r.top / H, x1: r.right / W, y1: r.bottom / H });
          if (l !== null) tone = chooseTone(l, tones.get(el) ?? null);
        } else tone = tones.get(el) ?? global;
      }
      tones.set(el, tone);
      if (el.dataset.lens !== tone) el.dataset.lens = tone;
    }
    samples++;
    lastMs = performance.now() - t;
  }

  // the specular highlight leans toward the pointer (off with reduced motion: the highlight stays where the tokens put it)
  let raf = 0, px = 0, py = 0, lit: HTMLElement | null = null;
  const paint = (): void => {
    raf = 0;
    const el = (doc.elementFromPoint(px, py) as Element | null)?.closest<HTMLElement>('[data-lens]') ?? null;
    if (lit && lit !== el) { lit.style.removeProperty('--wt-mx'); lit.style.removeProperty('--wt-my'); }
    lit = el && el !== d.root ? el : null;
    if (!lit) return;
    const r = lit.getBoundingClientRect();
    lit.style.setProperty('--wt-mx', `${Math.round(px - r.left)}px`);
    lit.style.setProperty('--wt-my', `${Math.round(py - r.top)}px`);
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    px = e.clientX; py = e.clientY;
    if (!raf) raf = requestAnimationFrame(paint);
  };
  if (!reduced) window.addEventListener('pointermove', onMove, { passive: true });

  return {
    afterFrame,
    stats: () => ({ luminance: lastL, ms: lastMs, tone: global, samples }),
    kick() { lastAt = 0; lastMs = Math.min(lastMs, 8); },
    force(mode) { forced = mode; setFlat(); },
    dispose() {
      if (!reduced) window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
      delete html.dataset.glassTone;
    },
  };
}
