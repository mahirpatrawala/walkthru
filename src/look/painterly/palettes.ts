// Owned by C11c. SPEC 16.7 palettes.ts (pure: no three, no DOM, runs under Node).
// The painter wants every surface as three mixes: light, middle, shadow. The middle mix IS the sampled colour (SPEC 16.2 rule 2
// holds in the painting too); the light is the colour in OKLCH at lightness +0.08, the shadow at -0.14 with chroma x 1.1.
// Colours here are the values the painter puts on the canvas, i.e. display (sRGB) values in 0..1: the painter never tone-maps.

export type RGB = [number, number, number];

export interface PaintMix {
  /** lit passages */ l: RGB;
  /** half-tone: the sampled colour itself */ m: RGB;
  /** shade */ s: RGB;
  /** the thing's own colour (the kit uses it for a lamp's light; here it is the sampled colour too) */ own: RGB;
}

export const LIGHT_DL = 0.08;
export const SHADOW_DL = -0.14;
export const SHADOW_CHROMA = 1.1;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0.5, 0.5, 0.5];
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export function rgbToHex(c: RGB): string {
  return '#' + c.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');
}

const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toSrgb = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/** sRGB (0..1) to OKLCH: L 0..1, C >= 0, h in radians. */
export function rgbToOklch(rgb: RGB): { L: number; C: number; h: number } {
  const [r, g, b] = rgb.map(toLinear) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}

function oklchToLinear(L: number, C: number, h: number): RGB {
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (c: RGB): boolean => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH to sRGB (0..1). A colour outside the sRGB gamut keeps its lightness and hue and loses chroma until it fits. */
export function oklchToRgb(L: number, C: number, h: number): RGB {
  const Lc = clamp01(L);
  let lin = oklchToLinear(Lc, C, h);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear(Lc, mid, h))) lo = mid; else hi = mid;
    }
    lin = oklchToLinear(Lc, lo, h);
  }
  return lin.map((v) => clamp01(toSrgb(clamp01(v)))) as RGB;
}

/** The three mixes of one sampled colour (hex or 0..1 sRGB). `m` is the input, unchanged. */
export function paintMix(input: string | RGB): PaintMix {
  const rgb: RGB = typeof input === 'string' ? hexToRgb(input) : [clamp01(input[0]), clamp01(input[1]), clamp01(input[2])];
  const { L, C, h } = rgbToOklch(rgb);
  // a colour with no chroma has no hue to keep: the shift is then only in lightness
  const light = oklchToRgb(L + LIGHT_DL, C, h);
  const shade = oklchToRgb(Math.max(0.02, L + SHADOW_DL), C * SHADOW_CHROMA, h);
  return { l: light, m: [...rgb] as RGB, s: shade, own: [...rgb] as RGB };
}

/**
 * A set of palettes keyed by colour: surfaces that share a colour share a palette (the kit builds GLSL constant arrays from it,
 * so fewer names is a smaller shader). `name(hex)` is stable for a hex and case-insensitive.
 */
export class PaletteSet {
  private readonly byHex = new Map<string, string>();
  private readonly out: Record<string, PaintMix & { glow?: boolean | number }> = {};

  /** the palette for a sampled colour; made on first use */
  name(hex: string): string {
    const key = rgbToHex(hexToRgb(hex)).slice(1);
    let n = this.byHex.get(key);
    if (!n) {
      n = `c${key}`;
      this.byHex.set(key, n);
      this.out[n] = paintMix(`#${key}`);
    }
    return n;
  }

  /** a palette that glows by itself (window glass): the light mix is shown whole, no shading */
  glow(name: string, hex: string, steady = true): string {
    if (!this.out[name]) {
      const mix = paintMix(hex);
      this.out[name] = { ...mix, l: mix.m, glow: steady ? 2 : 1 };
    }
    return name;
  }

  get size(): number { return Object.keys(this.out).length; }

  /** the object `createKit` takes as `palettes` */
  palettes(): Record<string, PaintMix & { glow?: boolean | number }> { return this.out; }
}
