// Owned by C11a. SPEC 16.5 "Outside the windows": the HDRI is the scene background and, on medium and high, the environment light.
import * as THREE from 'three';
import type { AssetLoader } from './assets';
import type { TierConfig } from './quality';
import { DEFAULT_FLOOR_NUMBER } from './types';
import type { Backdrop, LookFile } from './types';

export const BACKDROP_FILE: Record<Backdrop, string> = {
  rooftop_day: 'rooftop_day',
  rooftop_night: 'rooftop_night',
  sky: 'kloofendal_48d_partly_cloudy_puresky',
};

/**
 * `look.backdrop` if set; else floor 5 and up gives the rooftop at night from 16:00 and by day before it, below 5 gives the
 * pure sky. "True colours" always uses the pure sky (a rooftop skyline would be wrong below floor 5, and neutral is the point).
 */
export function chooseBackdrop(look: Pick<LookFile, 'backdrop' | 'floorNumber'> | null, hour: number, trueColours: boolean): Backdrop {
  if (trueColours) return 'sky';
  if (look?.backdrop) return look.backdrop;
  const floor = look?.floorNumber ?? DEFAULT_FLOOR_NUMBER;
  if (floor >= 5) return hour >= 16 ? 'rooftop_night' : 'rooftop_day';
  return 'sky';
}

export function backdropPath(b: Backdrop, hdri: TierConfig['hdri']): string {
  const n = BACKDROP_FILE[b];
  return hdri === 'backdrop' ? `hdri/${n}_bg.jpg` : `hdri/${n}_${hdri}.hdr`;
}

interface HdriMeta { peakAzimuthDeg: number; peakElevationDeg: number }

export class Sky {
  private key = '';
  private tex: THREE.Texture | null = null;
  private env: THREE.WebGLRenderTarget | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private meta: Record<string, HdriMeta> | null = null;
  private peakAz = 0;
  private token = 0;
  private sunAz = 0;
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
    const tex = path.endsWith('.jpg')
      ? await this.loader.texture(path, { srgb: true, anisotropy: 1 })
      : await this.loader.hdr(path);
    if (my !== this.token) return;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.wrapS = THREE.RepeatWrapping;
    tex.flipY = path.endsWith('.jpg') ? false : tex.flipY;
    if (path.endsWith('.jpg')) tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.env?.dispose();
    this.env = null;
    this.tex = tex;
    this.key = path;
    this.current = b;
    this.peakAz = this.meta[BACKDROP_FILE[b]]?.peakAzimuthDeg ?? 0;
    this.scene.background = tex;
    // the low backdrop is already tone-mapped at exposure 1.15; do not brighten it twice
    this.scene.backgroundIntensity = path.endsWith('.jpg') ? 1 / 1.15 : 1;
    this.applyEnv(cfg);
    this.rotate();
  }

  private applyEnv(cfg: TierConfig): void {
    if (!cfg.environment || !this.tex || this.tex.type === THREE.UnsignedByteType) {
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

  /** Lights, not picture: `on` false removes the environment (colour-true mode), true puts it back. */
  setEnvironmentIntensity(i: number): void { this.scene.environmentIntensity = i; }

  /** Turn the backdrop about Y so its brightest part sits in the direction of the sun (plan azimuth, atan2(z, x), degrees). */
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
