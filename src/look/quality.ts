// Owned by C11a. SPEC 16.5 "Quality tiers": what each tier turns on, how the first guess is made, how the frame-rate
// watchdog steps down. Pure (no three): the browser reads are passed in, so the rules are unit-testable.
import type { Tier } from './types';

export interface TierConfig {
  tier: Tier;
  /** frames per second the tier must hold (SPEC section 10) */
  fpsTarget: number;
  pixelRatioCap: number;
  /** sun shadow: none, one static 1024 map re-rendered on change, or a 2048 soft map every frame */
  shadow: 'none' | 'static' | 'live';
  shadowMapSize: number;
  /** window view: the 2048 px picture (low), the same picture also lighting the room (medium), the 4096 px one (high) */
  hdri: 'backdrop' | '1k' | '2k';
  /** the HDRI also lights the room (PMREM environment) */
  environment: boolean;
  reflection: 'none' | 'cube' | 'planar';
  /** diffuse detail, roughness and the wood frame maps on top of the two normal maps */
  fullTextures: boolean;
  anisotropy: number;
  bloom: boolean;
  /** the `postprocessing` + `n8ao` chunks are loaded and the composer renders the frame */
  post: boolean;
  /** hemisphere light intensity (three units), see look.ts */
  hemiIntensity: number;
  /** IBL intensity when the environment is on */
  envIntensity: number;
  /** colour of the hemisphere's ground half. Medium and high have the HDRI bounce, low has to fake it, so its ground is lighter */
  groundColour: string;
  /** scales the hemisphere's sky half. Low darkens the sky half and lightens the ground half: floors stay under walls, a cheap stand-in for bounce light */
  skyScale: number;
  groundScale: number;
  /** pooled real point lights for the interior fixtures (tube, cove): none on low, which fakes them with a warm ambient lift */
  interiorLights: number;
  /** multiplies the sun's intensity: with no shadow map the sun lights every floor evenly, so low turns it down */
  sunScale: number;
}

export const TIERS: Record<Tier, TierConfig> = {
  low: {
    tier: 'low', fpsTarget: 30, pixelRatioCap: 1.0, shadow: 'none', shadowMapSize: 0, hdri: 'backdrop', environment: false,
    reflection: 'none', fullTextures: false, anisotropy: 4, bloom: false, post: false, hemiIntensity: 1.0, envIntensity: 0, groundColour: '#F4F0EA', skyScale: 0.74, groundScale: 2.4, sunScale: 0.1, interiorLights: 0,
  },
  medium: {
    tier: 'medium', fpsTarget: 50, pixelRatioCap: 1.5, shadow: 'static', shadowMapSize: 1024, hdri: '1k', environment: true,
    reflection: 'cube', fullTextures: true, anisotropy: 4, bloom: false, post: false, hemiIntensity: 1.25, envIntensity: 0.12, groundColour: '#D2CCC2', skyScale: 1, groundScale: 2.0, sunScale: 1, interiorLights: 2,
  },
  high: {
    tier: 'high', fpsTarget: 55, pixelRatioCap: 2.0, shadow: 'live', shadowMapSize: 2048, hdri: '2k', environment: true,
    reflection: 'planar', fullTextures: true, anisotropy: 8, bloom: true, post: true, hemiIntensity: 1.25, envIntensity: 0.12, groundColour: '#D2CCC2', skyScale: 1, groundScale: 2.0, sunScale: 1, interiorLights: 4,
  },
};

/** Which tone mapper rolls the light off. ACES is the default: AgX read muted and hazy and Neutral garish orange when compared by eye on the same flat (`?tonemap=agx|aces|neutral`). */
export type ToneMapperName = 'agx' | 'aces' | 'neutral';
export const DEFAULT_TONE_MAPPER: ToneMapperName = 'aces';
export function toneMapperFromQuery(search: string): ToneMapperName {
  try {
    const v = new URLSearchParams(search).get('tonemap');
    return v === 'agx' || v === 'aces' || v === 'neutral' ? v : DEFAULT_TONE_MAPPER;
  } catch { return DEFAULT_TONE_MAPPER; }
}

export const TIER_ORDER: Tier[] = ['low', 'medium', 'high'];
export const TIER_STORAGE_KEY = 'walkthru:tier';

export const stepDown = (t: Tier): Tier => (t === 'high' ? 'medium' : 'low');
export const lowerTier = (a: Tier, b: Tier): Tier => (TIER_ORDER.indexOf(a) <= TIER_ORDER.indexOf(b) ? a : b);

/** Renderer strings that mean a weak GPU (SPEC 16.5). */
export const WEAK_GPU = /Mali-|Adreno \(TM\) [1-5]|PowerVR|SwiftShader|llvmpipe/i;

export interface DeviceInfo {
  /** `WEBGL_debug_renderer_info` UNMASKED_RENDERER_WEBGL, or '' */
  renderer: string;
  /** `navigator.deviceMemory` in GB when the browser reports it */
  deviceMemory?: number;
  hardwareConcurrency?: number;
  /** coarse pointer or touch support */
  touch: boolean;
}

/** The first guess, before any frame is timed. */
export function guessTier(d: DeviceInfo): Tier {
  if (WEAK_GPU.test(d.renderer)) return 'low';
  if (d.deviceMemory !== undefined && d.deviceMemory <= 4) return 'low';
  return d.touch ? 'medium' : 'high';
}

export function parseTier(v: string | null | undefined): Tier | null {
  return v === 'low' || v === 'medium' || v === 'high' ? v : null;
}

/** `?quality=low|medium|high` forces a tier. */
export function tierFromQuery(search: string): Tier | null {
  try { return parseTier(new URLSearchParams(search).get('quality')); } catch { return null; }
}

/** Reads the device facts in a browser. Safe to call anywhere: every read is guarded. */
export function readDevice(gl?: WebGLRenderingContext | WebGL2RenderingContext | null): DeviceInfo {
  let renderer = '';
  try {
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    }
  } catch { /* ignore */ }
  let touch = false;
  try { touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0; } catch { /* ignore */ }
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as { deviceMemory?: number; hardwareConcurrency?: number };
  return { renderer, deviceMemory: nav.deviceMemory, hardwareConcurrency: nav.hardwareConcurrency, touch };
}

export function loadSavedTier(storage: Pick<Storage, 'getItem'> | null): Tier | null {
  try { return parseTier(storage?.getItem(TIER_STORAGE_KEY)); } catch { return null; }
}
export function saveTier(storage: Pick<Storage, 'setItem'> | null, t: Tier): void {
  try { storage?.setItem(TIER_STORAGE_KEY, t); } catch { /* private mode */ }
}

/**
 * Frame-rate watchdog. Feed it real frame times; it answers true once the average over a window of `windowSec`
 * seconds is below the target. Frames longer than `ignoreAboveSec` (a hidden tab, a long asset upload) are skipped.
 */
export class FpsWatch {
  private t = 0;
  private n = 0;
  constructor(private target: number, private windowSec = 4, private ignoreAboveSec = 0.5) {}
  setTarget(fps: number): void { this.target = fps; this.reset(); }
  reset(): void { this.t = 0; this.n = 0; }
  /** true when the window just closed under target */
  frame(dtSec: number): boolean {
    if (dtSec <= 0 || dtSec > this.ignoreAboveSec) return false;
    this.t += dtSec;
    this.n += 1;
    if (this.t < this.windowSec) return false;
    const fps = this.n / this.t;
    this.reset();
    return fps < this.target;
  }
}

/** Average fps of timed frames; `null` until `count` frames have been seen. */
export class FrameTimer {
  private t = 0;
  private n = 0;
  constructor(private count = 40) {}
  frame(dtSec: number): number | null {
    if (dtSec <= 0 || dtSec > 0.5) return null;
    this.t += dtSec;
    this.n += 1;
    return this.n >= this.count ? this.n / this.t : null;
  }
}
