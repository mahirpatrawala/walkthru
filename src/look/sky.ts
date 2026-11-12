// Owned by C11a. SPEC 16.5 "Outside the windows": the view out of the window is an equirectangular picture used as the scene
// background, so it is sampled per view direction (at infinity) and never stretched on the pane. On medium and high the same
// picture, blurred by PMREM, is the environment light. The picture is made by scripts/derive-look-assets.ts: a Poly Haven sky
// over an illustrated hazy city. It is not the property's view, and the look panel says so.
import * as THREE from 'three';
import type { AssetLoader } from './assets';
import type { TierConfig } from './quality';
import { DEFAULT_FLOOR_NUMBER } from './types';
import type { Backdrop, LookFile } from './types';

export const BACKDROP_FILE: Record<Backdrop, string> = {
  rooftop_day: 'view_day',   // a flat on a high floor, by day
  rooftop_night: 'view_dusk', // the same view after sunset
  sky: 'view_sky',           // below the 5th floor, and True colours
};

/** from this hour the day view gives way to dusk (sunset is about 18:30) */
export const DUSK_HOUR = 17.5;

/**
 * `look.backdrop` if set; else floor 5 and up gives the city by day, and dusk from 17:30; below 5 gives the pure sky.
 * "True colours" always uses the pure sky.
 */
export function chooseBackdrop(look: Pick<LookFile, 'backdrop' | 'floorNumber'> | null, hour: number, trueColours: boolean): Backdrop {
  if (trueColours) return 'sky';
  if (look?.backdrop) return look.backdrop;
  const floor = look?.floorNumber ?? DEFAULT_FLOOR_NUMBER;
  if (floor >= 5) return hour >= DUSK_HOUR ? 'rooftop_night' : 'rooftop_day';
  return 'sky';
}

/** low and medium use the 2048 x 1024 picture, high the 4096 x 2048 one */
export function backdropPath(b: Backdrop, hdri: TierConfig['hdri']): string {
  return `hdri/${BACKDROP_FILE[b]}_bg${hdri === '2k' ? '4k' : ''}.jpg`;
}

/** What the backdrop may reach on screen (before exposure): kept under the 0.9 bloom threshold so a window never blows out. */
export const BACKDROP_PEAK = 0.82;

interface HdriMeta { peakAzimuthDeg: number }

export class Sky {
  private key = '';
  private tex: THREE.Texture | null = null;
  private env: THREE.WebGLRenderTarget | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private meta: Record<string, HdriMeta> | null = null;
  private peakAz = 0;
  private token = 0;
  private sunAz = 0;
  private exposure = 1;
  /** the backdrop that is currently shown (null until the first load lands) */
  current: Backdrop | null = null;

  constructor(private readonly scene: THREE.Scene, private readonly renderer: THREE.WebGLRenderer, private readonly loader: AssetLoader) {}

  /** Loads and shows a backdrop. A newer call wins; an older one that lands late is discarded. */
  async show(b: Backdrop, cfg: TierConfig): Promise<void> {
    const path = backdropPath(b, cfg.hdri);
    if (this.key === path) { this.applyEnv(cfg); return; }
    const my = ++this.token;
    if (!this.meta) {
      try { this.meta = await this.loader.json<Record<string, HdriMeta>>('hdri/meta.json'); } catch { this.meta = {}; }
    }
    const tex = await this.loader.texture(path, { srgb: true, anisotropy: 1 });
    if (my !== this.token) return;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.flipY = false;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this.env?.dispose();
    this.env = null;
    this.tex = tex;
    this.key = path;
    this.current = b;
    this.peakAz = this.meta[BACKDROP_FILE[b]]?.peakAzimuthDeg ?? 0;
    this.scene.background = tex;
    this.applyIntensity();
    this.applyEnv(cfg);
    this.rotate();
  }

  /** the backdrop is shown at BACKDROP_PEAK after exposure, whatever the exposure is */
  setExposure(e: number): void { this.exposure = e; this.applyIntensity(); }
  private applyIntensity(): void { this.scene.backgroundIntensity = BACKDROP_PEAK / this.exposure; }

  private applyEnv(cfg: TierConfig): void {
    if (!cfg.environment || !this.tex) {
      this.scene.environment = null;
      return;
    }
    if (!this.env) {
      this.pmrem ??= new THREE.PMREMGenerator(this.renderer);
      this.env = this.pmrem.fromEquirectangular(this.tex);
    }
    this.scene.environment = this.env.texture;
    this.scene.environmentIntensity = cfg.envIntensity;
  }

  /** Turn the picture about Y so its brightest part sits in the direction of the sun (plan azimuth, atan2(z, x), degrees). */
  setSunAzimuth(planAzimuthDeg: number): void {
    this.sunAz = planAzimuthDeg;
    this.rotate();
  }

  private rotate(): void {
    // turning an equirect image by +theta about Y moves a direction's atan2(z, x) by -theta
    const theta = ((this.peakAz - this.sunAz) * Math.PI) / 180;
    this.scene.backgroundRotation.set(0, theta, 0);
    this.scene.environmentRotation.set(0, theta, 0);
  }

  /** forget the picture when the tier changes (the next show() reloads the right size) */
  reset(): void {
    this.token++;
    this.env?.dispose();
    this.env = null;
    this.key = '';
  }

  dispose(): void {
    this.reset();
    this.pmrem?.dispose();
    this.pmrem = null;
    if (this.scene.background === this.tex) this.scene.background = null;
    this.scene.environment = null;
  }
}
