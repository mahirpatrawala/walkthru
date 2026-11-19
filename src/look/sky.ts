// Owned by C11a. SPEC 16.5 "Outside the windows". By default the view out of the window is a plain graded sky with a soft haze at
// the horizon, made here (no picture, no buildings: a flat is not allowed to show a city it does not have). It is an equirectangular
// texture used as the scene background, so it is sampled per view direction (at infinity) and never stretched on the pane, and on
// medium and high the same texture, blurred by PMREM, is the environment light. Only when look.json names a `backdrop` (a broker's
// choice) is the old picture used instead (scripts/derive-look-assets.ts).
import * as THREE from 'three';
import type { AssetLoader } from './assets';
import type { TierConfig } from './quality';
import type { Backdrop, LookFile } from './types';
import type { Grade } from './grade';

export const BACKDROP_FILE: Record<Backdrop, string> = {
  rooftop_day: 'view_day',   // a flat on a high floor, by day
  rooftop_night: 'view_dusk', // the same view after sunset
  sky: 'view_sky',           // below the 5th floor, and True colours
};

/**
 * The broker's own `backdrop` from look.json, else null: the plain graded sky. "True colours" always uses the plain sky.
 * (Before the look-light work a floor 5 and up flat got an invented city here; nothing is invented any more.)
 */
export function chooseBackdrop(look: Pick<LookFile, 'backdrop'> | null, _hour: number, trueColours: boolean): Backdrop | null {
  if (trueColours) return null;
  return look?.backdrop ?? null;
}

/** low and medium use the 2048 x 1024 picture, high the 4096 x 2048 one */
export function backdropPath(b: Backdrop, hdri: TierConfig['hdri']): string {
  return `hdri/${BACKDROP_FILE[b]}_bg${hdri === '2k' ? '4k' : ''}.jpg`;
}

/** What the backdrop may reach on screen (before exposure): kept under the 0.9 bloom threshold so a window never blows out. */
export const BACKDROP_PEAK = 0.82;

interface HdriMeta { peakAzimuthDeg: number }

const SKY_W = 256;
const SKY_H = 128;
/** SPEC 16.24: the 2K sky is 1024 x 512, so its environment (PMREM of a quarter of the width) is a 256 cube, the size of a room probe */
export const SKY_RICH_W = 1024;
export const SKY_RICH_H = 512;
const smoothstep = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The plain sky as linear half-float pixels (equirectangular, row 0 = straight down). Zenith to mid to horizon going down, a soft
 * haze below the horizon (no hard line), and a broad warm glow `sunElevationDeg` up at azimuth 0 (the Sky turns it to the sun).
 * Pure, so it is unit-tested.
 */
export function skyPixels(g: Grade['sky'], sunElevationDeg: number, w = SKY_W, h = SKY_H, rich = false): Float32Array {
  const out = new Float32Array(w * h * 4);
  const el0 = (Math.max(2, sunElevationDeg) * Math.PI) / 180;
  for (let j = 0; j < h; j++) {
    const el = ((j + 0.5) / h) * Math.PI - Math.PI / 2;
    const s = Math.abs(el) / (Math.PI / 2);
    const base: number[] = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      let c: number;
      if (el >= 0) {
        c = g.horizon[k] + (g.mid[k] - g.horizon[k]) * smoothstep(0, 0.14, s);
        c += (g.zenith[k] - c) * smoothstep(0.1, 0.85, s);
      } else {
        c = g.horizon[k] + (g.ground[k] - g.horizon[k]) * smoothstep(0, 0.2, s);
      }
      base[k] = c;
    }
    for (let i = 0; i < w; i++) {
      const az = ((i + 0.5) / w - 0.5) * 2 * Math.PI;
      // angle between this direction and the glow's centre
      const cosd = Math.sin(el) * Math.sin(el0) + Math.cos(el) * Math.cos(el0) * Math.cos(az);
      const d = Math.acos(Math.min(1, Math.max(-1, cosd)));
      const lobe = 0.34 * Math.exp(-Math.pow(d / 0.62, 2)) + 0.66 * Math.exp(-Math.pow(d / 0.2, 2));
      // the glow only lifts the sky above the horizon
      const lift = g.glowIntensity * lobe * smoothstep(-0.05, 0.12, el);
      const o = (j * w + i) * 4;
      for (let k = 0; k < 3; k++) out[o + k] = base[k] + g.glow[k] * lift * 0.9;
      out[o + 3] = 1;
    }
  }
  if (rich) richSky(out, g, w, h, el0);
  return out;
}

// ---- 2K: a better sky. Soft cumulus (fractal noise on a plane overhead, thinned to nothing at the horizon so it never smears), a horizon haze, and a sun with a
// tight bright core on top of the broad glow. No buildings, no trees, nothing a flat does not have (16.2): only clouds and light.
const hash2 = (x: number, y: number): number => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number): number {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < 5; i++) { s += a * vnoise(x * f + i * 17.3, y * f - i * 9.1); a *= 0.5; f *= 2.03; }
  return s;
}
/** the cloud cover of a sky of w x h, 0..1 per texel, computed once per size (the noise does not move with the hour) */
const cloudCache = new Map<string, Float32Array>();
export function cloudField(w: number, h: number): Float32Array {
  const key = `${w}x${h}`;
  let f = cloudCache.get(key);
  if (f) return f;
  f = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const el = ((j + 0.5) / h) * Math.PI - Math.PI / 2;
    if (el < 0.03) continue;
    for (let i = 0; i < w; i++) {
      const az = ((i + 0.5) / w - 0.5) * 2 * Math.PI;
      // project onto a plane overhead: the clouds get smaller toward the horizon, as they do
      const k = 1 / (Math.sin(el) + 0.22);
      const px = Math.cos(el) * Math.cos(az) * k, pz = Math.cos(el) * Math.sin(az) * k;
      const n = fbm(px * 1.15 + 3.1, pz * 1.15 - 7.7);
      f[j * w + i] = smoothstep(0.5, 0.74, n) * smoothstep(0.03, 0.2, el);
    }
  }
  cloudCache.set(key, f);
  return f;
}
function richSky(out: Float32Array, g: Grade['sky'], w: number, h: number, el0: number): void {
  const cover = cloudField(w, h);
  const lum = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  // clouds take the light of the sky they sit in: brighter than the mid sky where lit, a shade darker where thick
  const L = Math.max(0.02, lum(g.mid)), lit = [g.mid[0] * 0.5 + L * 0.9, g.mid[1] * 0.5 + L * 0.9, g.mid[2] * 0.5 + L * 0.9];
  for (let j = 0; j < h; j++) {
    const el = ((j + 0.5) / h) * Math.PI - Math.PI / 2;
    for (let i = 0; i < w; i++) {
      const o = (j * w + i) * 4;
      const az = ((i + 0.5) / w - 0.5) * 2 * Math.PI;
      const c = cover[j * w + i];
      if (c > 0.001) {
        // the lit edge of a cloud is the thin side of it; the thick middle is a shade darker; the side toward the sun takes its glow
        const cosd = Math.sin(el) * Math.sin(el0) + Math.cos(el) * Math.cos(el0) * Math.cos(az);
        const sunSide = Math.max(0, cosd) ** 3;
        const body = 1 - 0.28 * smoothstep(0.55, 1, c);
        for (let k = 0; k < 3; k++) {
          const cloud = lit[k] * body + g.glow[k] * 0.35 * sunSide;
          out[o + k] += (cloud - out[o + k]) * Math.min(0.92, c * 1.1);
        }
      }
      // a clear sun with a core, over the haze
      const cosd = Math.sin(el) * Math.sin(el0) + Math.cos(el) * Math.cos(el0) * Math.cos(az);
      const d = Math.acos(Math.min(1, Math.max(-1, cosd)));
      if (d < 0.05 && el > 0) {
        const core = smoothstep(0.05, 0.012, d) * (1 - 0.85 * c);
        for (let k = 0; k < 3; k++) out[o + k] += g.glow[k] * 5 * core;
      }
      // a thin haze right at the horizon, lighter than the sky above it
      const hz = Math.exp(-Math.pow(el / 0.07, 2));
      for (let k = 0; k < 3; k++) out[o + k] += (g.horizon[k] * 1.06 - out[o + k]) * 0.35 * hz;
    }
  }
}

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
  private cfg: TierConfig | null = null;
  private picture = false;
  /** the plain sky's texture, kept so a changed grade only rewrites its pixels */
  private plainTex: THREE.DataTexture | null = null;
  private envStale = true;
  /** the broker's backdrop that is currently shown (null = the plain graded sky) */
  current: Backdrop | null = null;

  constructor(private readonly scene: THREE.Scene, private readonly renderer: THREE.WebGLRenderer, private readonly loader: AssetLoader) {}

  /** Shows the plain graded sky. Cheap: rewrites 32 k pixels; on medium and high the environment is rebuilt from it. */
  showPlain(g: Grade['sky'], sunElevationDeg: number, cfg: TierConfig, rich = false): void {
    this.token++;
    this.cfg = cfg;
    // a NEW texture every time: three converts an equirect background to a cube map once per texture object and never again
    const W = rich ? SKY_RICH_W : SKY_W, H = rich ? SKY_RICH_H : SKY_H;
    const px = skyPixels(g, sunElevationDeg, W, H, rich);
    const data = new Uint16Array(px.length);
    for (let i = 0; i < px.length; i++) data[i] = THREE.DataUtils.toHalfFloat(px[i]);
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    const old = this.plainTex;
    this.plainTex = t;
    this.picture = false;
    this.current = null;
    this.key = 'plain';
    this.tex = this.plainTex;
    this.peakAz = 0;
    this.scene.background = t;
    this.scene.backgroundIntensity = 1;
    this.envStale = true;
    this.applyEnv(cfg);
    this.rotate();
    old?.dispose();
  }

  /** Loads and shows the broker's backdrop picture. A newer call wins; an older one that lands late is discarded. */
  async show(b: Backdrop, cfg: TierConfig): Promise<void> {
    this.cfg = cfg;
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
    this.picture = true;
    this.current = b;
    this.peakAz = this.meta[BACKDROP_FILE[b]]?.peakAzimuthDeg ?? 0;
    this.scene.background = tex;
    this.envStale = true;
    this.applyIntensity();
    this.applyEnv(cfg);
    this.rotate();
  }

  /** a picture backdrop is shown at BACKDROP_PEAK after exposure, whatever the exposure is; the plain sky is tone mapped like the room */
  setExposure(e: number): void { this.exposure = e; this.applyIntensity(); }
  private applyIntensity(): void { this.scene.backgroundIntensity = this.picture ? BACKDROP_PEAK / this.exposure : 1; }

  private applyEnv(cfg: TierConfig): void {
    if (!cfg.environment || !this.tex) {
      this.scene.environment = null;
      return;
    }
    if (!this.env || this.envStale) {
      this.pmrem ??= new THREE.PMREMGenerator(this.renderer);
      this.env?.dispose();
      this.env = this.pmrem.fromEquirectangular(this.tex);
      this.envStale = false;
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
    this.plainTex?.dispose();
    this.plainTex = null;
    if (this.scene.background === this.tex) this.scene.background = null;
    this.scene.environment = null;
  }
}

