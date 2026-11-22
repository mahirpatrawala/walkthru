// Owned by C11a. SPEC 16.5 "Quality tiers": what each tier turns on, how the first guess is made, how the frame-rate
// watchdog steps down. Pure (no three): the browser reads are passed in, so the rules are unit-testable.
import type { Tier } from './types';
import { RATIO_FLOOR } from './resolution';

export interface TierConfig {
  tier: Tier;
  /** frames per second the tier must hold (SPEC section 10) */
  fpsTarget: number;
  /** the largest pixel ratio the tier draws at on a desktop; a phone or tablet is held to PHONE_RATIO_CAP (SPEC 16.18). The resolution governor walks down from here. */
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
  /** samples of the post composer's own multisampled buffer (SPEC 16.18): 0 on tiers without a composer; clamped to the GPU's MAX_SAMPLES */
  msaa: number;
  /** the `postprocessing` + `n8ao` chunks are loaded and the composer renders the frame: MSAA, ambient occlusion, grade. Medium has it too (a cheap half-resolution AO, no bloom), except on a phone or tablet, which keeps the plain renderer (SPEC 16.18) */
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
    reflection: 'none', fullTextures: false, anisotropy: 4, bloom: false, msaa: 0, post: false, hemiIntensity: 1.0, envIntensity: 0, groundColour: '#F4F0EA', skyScale: 0.74, groundScale: 2.4, sunScale: 0.1, interiorLights: 0,
  },
  medium: {
    tier: 'medium', fpsTarget: 50, pixelRatioCap: 2.0, shadow: 'static', shadowMapSize: 2048, hdri: '1k', environment: true,
    reflection: 'cube', fullTextures: true, anisotropy: 16, bloom: false, msaa: 4, post: true, hemiIntensity: 1.25, envIntensity: 0.12, groundColour: '#D2CCC2', skyScale: 1, groundScale: 2.0, sunScale: 1, interiorLights: 2,
  },
  high: {
    tier: 'high', fpsTarget: 55, pixelRatioCap: 2.0, shadow: 'live', shadowMapSize: 4096, hdri: '2k', environment: true,
    reflection: 'planar', fullTextures: true, anisotropy: 16, bloom: true, msaa: 4, post: true, hemiIntensity: 1.25, envIntensity: 0.12, groundColour: '#D2CCC2', skyScale: 1, groundScale: 2.0, sunScale: 1, interiorLights: 4,
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

/** true when the composer runs on this device: the tier asks for it, and on medium only a device with a mouse and keyboard gets it */
export function postWanted(cfg: Pick<TierConfig, 'post' | 'tier'>, touch: boolean): boolean {
  return cfg.post && (cfg.tier === 'high' || !touch);
}

/** Phones and tablets keep the old ceiling unless the governor's measurements say they can afford more (SPEC 16.18). */
export const PHONE_RATIO_CAP = 1.5;
/** The most anisotropic filtering any tier asks for; the renderer's own maximum is the other limit. */
export const MAX_ANISOTROPY = 16;

/**
 * The low tier on a desktop or laptop whose GPU is not a weak one (22 Nov 2026, SPEC 16.18): low drops shadows, the composer and the
 * environment, which is what the frame-rate watchdog was buying; it was also drawing at 1x, so a retina laptop the watchdog had once stepped
 * to low (remembered in `walkthru:tier`) looked soft and jagged for good. Low is cheap enough to start at the screen's own ratio there and
 * let the governor walk down (to 1 on this tier) if frames are slow. A phone, a tablet and a weak GPU keep 1.
 */
export const DESKTOP_LOW_RATIO_CAP = 2;

/** A desktop or laptop (mouse, no touch) whose GPU and memory do not read as weak: the first guess for it is high. */
export function capableDesktop(d: DeviceInfo): boolean {
  return !d.touch && guessTier(d) === 'high';
}

/** The largest pixel ratio a tier may draw at on this device: the tier's cap, held to the phone cap on a touch device; low on a capable desktop gets DESKTOP_LOW_RATIO_CAP. */
export function tierPixelCap(cfg: Pick<TierConfig, 'pixelRatioCap' | 'tier'>, touch: boolean, capable = false): number {
  if (touch) return Math.min(cfg.pixelRatioCap, PHONE_RATIO_CAP);
  if (cfg.tier === 'low' && capable) return Math.max(cfg.pixelRatioCap, DESKTOP_LOW_RATIO_CAP);
  return cfg.pixelRatioCap;
}

/** The lowest rung of the resolution ladder for a tier: 1.25 (RATIO_FLOOR) on medium and high, 1 on low, which has nothing cheaper left to give up. */
export function tierRatioFloor(cfg: Pick<TierConfig, 'tier'>): number {
  return cfg.tier === 'low' ? 1 : RATIO_FLOOR;
}

/** Anisotropy to ask for: the tier's request, never above the GPU's maximum or MAX_ANISOTROPY, and at least 1. */
export function clampAnisotropy(requested: number, gpuMax: number): number {
  return Math.max(1, Math.min(requested, MAX_ANISOTROPY, Number.isFinite(gpuMax) && gpuMax > 0 ? gpuMax : requested));
}

/** Samples for the composer's buffer: the tier's request limited to the GPU's MAX_SAMPLES, 0 when fewer than 2 are possible. */
export function clampSamples(requested: number, gpuMax: number): number {
  const n = Math.min(requested, Number.isFinite(gpuMax) ? gpuMax : 0);
  return n >= 2 ? Math.floor(n) : 0;
}

export const TIER_ORDER: Tier[] = ['low', 'medium', 'high'];
/**
 * v2 (22 Nov 2026): step-downs remembered under `walkthru:tier` were judged on windows that counted load hitches (SPEC 16.18), so a fast
 * laptop could be stepped to low by its first seconds of loading; the old key is not read, every device is judged once more.
 */
export const TIER_STORAGE_KEY = 'walkthru:tier.v2';

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
