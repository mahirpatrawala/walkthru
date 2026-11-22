// Owned by C11a. SPEC 16.5 high tier: render -> N8AO -> exposure + white balance + bloom + tone mapping + grade (split tone) -> SMAA.
// `postprocessing` and `n8ao` are loaded with dynamic import() here and nowhere else, so they never reach a phone.
import * as THREE from 'three';
import type { Viewer } from '../engine/viewer';

export type { ToneMapperName } from './quality';
import type { Rgb } from './grade';
import type { ToneMapperName } from './quality';
import { clampSamples } from './quality';

/** what the high tier grades with (per preset, from grade.ts) */
export interface PostGrade {
  exposure: number;
  /** linear multiplier applied before tone mapping: the preset's white balance */
  whiteBalance: Rgb;
  saturation: number;
  contrast: number;
  /** linear tints blended by luminance after tone mapping: cool shadows, warm highlights (the ochre and teal of the look) */
  shadowTint: Rgb;
  highlightTint: Rgb;
  /** bloom intensity (windows, the sun patch and lights glow; the threshold keeps everything else out) */
  bloom: number;
  /** SPEC 16.27: the tone curve (grade.ts `curveOf`): pivot and shoulder in linear, `white` 0..1 how far the tone mapper's white lands on the shoulder. Absent: the 16.26 curve */
  pivot?: number; shoulder?: number; white?: number;
}

/** How the frame is smoothed and sharpened (SPEC 16.18). `msaa` is the composer's own multisampled buffer; `smaa` stays as a switch for comparisons. */
export interface PostOptions { exposure: number; bloom: boolean; mapper: ToneMapperName; msaa?: number; /** the cost of the ambient occlusion: `cheap` (medium) is half resolution with fewer samples */ ao?: 'full' | 'cheap'; smaa?: boolean; sharpen?: number }

export interface PostChain {
  /** samples the composer's buffer really has (0 = none, the frame is not multisampled) */
  readonly samples: number;
  render(dt: number): void;
  setExposure(e: number): void;
  setGrade(g: PostGrade): void;
  setBloom(intensity: number): void;
  /** false = linear (True colours: nothing is rolled off or graded) */
  setToneMapping(on: boolean, mapper?: ToneMapperName): void;
  setAO(on: boolean): void;
  /** debug: move the contrast curve's pivot and highlight shoulder (linear) while tuning by eye */
  setCurve(pivot: number, shoulder: number, white?: number): void;
  /** 1 = the usual strength; a bake that already has the corner shade asks for less (SPEC 16.14) */
  setAoStrength(k: number): void;
  /** SPEC 16.24: the 2K level draws the occlusion at full resolution with more samples (soft contact shadows under objects), 20 and 8 against 10 and 6 */
  setUltra(on: boolean): void;
  dispose(): void;
}

/** the strength of the screen-space occlusion before any scaling (a bake that has corner shade asks for less) */
const AO_BASE = 0.95;
/** the grade's contrast turns about this linear value (SPEC 16.26): about the mean of a lit interior, not 18% grey, so the walls (above it) go brighter and the shadows and corners (below it) go deeper.
 *  0.42 until SPEC 16.27: with the day exposure at 1.24 every white wall sat in the shoulder above it, where a wall lit twice as much as another read only 4 % brighter (sRGB 206 to 230 across a room).
 *  The day exposure is now 1.1 and the pivot 0.3, so walls sit on the steep part of the curve and the fall-off from a window shows. */
export const CONTRAST_PIVOT = 0.3;
/** the most luminance the contrast curve ever gives (linear; 0.98 is sRGB 253; the tone mapper's white lands on it): the highlight shoulder. 0.9 until SPEC 16.27, which capped the window, a sun patch and the wall beside it at the same grey-white */
export const CONTRAST_SHOULDER = 0.98;
const VIBRANCE = 0.3;
/** SPEC 16.26: at the 2K level the occlusion is drawn at full resolution with more samples, so it can afford to be stronger: furniture sits on the floor and corners have depth */
const ULTRA_AO_GAIN = 2.2;

export async function createPostChain(viewer: Viewer, init: PostOptions): Promise<PostChain> {
  const [pp, n8] = await Promise.all([import('postprocessing'), import('n8ao')]);
  const { renderer, scene, camera } = viewer;
  const size = renderer.getSize(new THREE.Vector2());

  // Real MSAA on the composer's own buffer: the renderer's `antialias` only covers its default framebuffer, which the composer never draws to.
  // SMAA on top of 4 samples only softened the frame, so it is off unless asked for (`?aa=smaa`).
  const gl = renderer.getContext() as WebGL2RenderingContext;
  let maxSamples = 0;
  try { maxSamples = Number(gl.getParameter(gl.MAX_SAMPLES)) || 0; } catch { /* WebGL1 or a lost context: no multisampling */ }
  const samples = clampSamples(init.msaa ?? 4, maxSamples);
  const composer = new pp.EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: samples });
  composer.setSize(size.x, size.y, false);
  const renderPass = new pp.RenderPass(scene, camera);
  composer.addPass(renderPass);

  // screen-space AO for wall-to-wall corners and furniture detail: half resolution, radius 0.6 m, intensity 1.6
  const ao = new n8.N8AOPostPass(scene, camera, size.x, size.y);
  ao.configuration.aoRadius = 0.35;
  ao.configuration.distanceFalloff = 0.5;
  ao.configuration.intensity = AO_BASE;
  ao.configuration.halfRes = true;
  // N8AO's defaults (16 samples, 8 denoise samples) cost about 8 ms at 2880 x 1800 on an M2; these keep it near 3 ms
  ao.configuration.aoSamples = init.ao === 'cheap' ? 6 : 10;
  ao.configuration.denoiseSamples = init.ao === 'cheap' ? 5 : 6;
  ao.configuration.denoiseRadius = 5;
  ao.configuration.gammaCorrection = false;
  // `?ao=off` for comparisons
  let aoOff = false;
  try { aoOff = new URLSearchParams(location.search).get('ao') === 'off'; } catch { /* no location */ }
  if (aoOff) ao.enabled = false;
  composer.addPass(ao);

  // before tone mapping: exposure and the preset's white balance
  class ExposureEffect extends pp.Effect {
    constructor(e: number) {
      super('ExposureEffect', 'uniform float exposure;\nuniform vec3 wb;\nvoid mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) { outputColor = vec4(inputColor.rgb * exposure * wb, inputColor.a); }',
        { uniforms: new Map<string, THREE.Uniform>([['exposure', new THREE.Uniform(e)], ['wb', new THREE.Uniform(new THREE.Vector3(1, 1, 1))]]) });
    }
    set exposure(v: number) { (this.uniforms.get('exposure') as THREE.Uniform).value = v; }
    setWb(c: Rgb) { ((this.uniforms.get('wb') as THREE.Uniform).value as THREE.Vector3).set(c[0], c[1], c[2]); }
  }
  // after tone mapping: saturation, contrast about mid grey, and the split tone (cool in the shadows, warm in the lights)
  class GradeEffect extends pp.Effect {
    constructor() {
      super('GradeEffect', `uniform float CONTRAST_PIVOT;\nuniform float CONTRAST_SHOULDER;\nuniform float CURVE_WHITE;\nconst float VIBRANCE = ${VIBRANCE.toFixed(3)};\nuniform float sat;\nuniform float contrast;\nuniform vec3 shadowTint;\nuniform vec3 highlightTint;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // vibrance: a surface that already has colour (oak, terracotta) takes a further boost, a pale wall does not, so the white balance of the walls is not undone
  float ch = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(l), c, sat + VIBRANCE * smoothstep(0.06, 0.22, ch));
  c *= mix(shadowTint, highlightTint, smoothstep(0.04, 0.6, l));
  // contrast on the luminance, not on each channel: a per-channel S-curve turned the oak floor's joints and the dark of a screen saturated red
  float l1 = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // above the pivot a curve that leaves the pivot at the contrast's slope and flattens towards CONTRAST_SHOULDER (a sunlit floor keeps its colour and a white cabinet its shape instead of clipping), below it a power curve through the same point with the same slope: shadows deepen but a dark floor never crushes to black
  // SPEC 16.27: the shoulder is normalised so that the tone mapper's white (1.0) lands on CONTRAST_SHOULDER; before, it landed 15 % short of it and every white (a wall, a window, a sun patch) topped out at sRGB 235
  float lkK = contrast / (CONTRAST_SHOULDER - CONTRAST_PIVOT);
  float lkN = mix(1.0, 1.0 - exp(-(1.0 - CONTRAST_PIVOT) * lkK), CURVE_WHITE);
  float l2 = l1 > CONTRAST_PIVOT ? CONTRAST_PIVOT + (CONTRAST_SHOULDER - CONTRAST_PIVOT) * (1.0 - exp(-(l1 - CONTRAST_PIVOT) * lkK)) / lkN : CONTRAST_PIVOT * pow(max(l1, 0.0) / CONTRAST_PIVOT, contrast);
  c *= l1 > 1e-4 ? l2 / l1 : 1.0;
  outputColor = vec4(c, inputColor.a);
}`,
        { uniforms: new Map<string, THREE.Uniform>([['CONTRAST_PIVOT', new THREE.Uniform(CONTRAST_PIVOT)], ['CONTRAST_SHOULDER', new THREE.Uniform(CONTRAST_SHOULDER)], ['CURVE_WHITE', new THREE.Uniform(1)], ['sat', new THREE.Uniform(1)], ['contrast', new THREE.Uniform(1)], ['shadowTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))], ['highlightTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))]]) });
    }
    curve(pivot: number, shoulder: number, white = 1) { (this.uniforms.get('CONTRAST_PIVOT') as THREE.Uniform).value = pivot; (this.uniforms.get('CONTRAST_SHOULDER') as THREE.Uniform).value = shoulder; (this.uniforms.get('CURVE_WHITE') as THREE.Uniform).value = white; }
    set(sat: number, contrast: number, sh: Rgb, hi: Rgb) {
      (this.uniforms.get('sat') as THREE.Uniform).value = sat;
      (this.uniforms.get('contrast') as THREE.Uniform).value = contrast;
      ((this.uniforms.get('shadowTint') as THREE.Uniform).value as THREE.Vector3).set(sh[0], sh[1], sh[2]);
      ((this.uniforms.get('highlightTint') as THREE.Uniform).value as THREE.Vector3).set(hi[0], hi[1], hi[2]);
    }
  }
  const exposure = new ExposureEffect(init.exposure);
  const grade = new GradeEffect();
  // threshold 0.95 with a soft knee: windows, lights and the sun patch glow slightly, nothing else
  const bloom = new pp.BloomEffect({ luminanceThreshold: 0.95, luminanceSmoothing: 0.25, intensity: init.bloom ? 0.35 : 0, mipmapBlur: true, radius: 0.7 });
  const modeOf = (m: ToneMapperName): number => (m === 'aces' ? pp.ToneMappingMode.ACES_FILMIC : m === 'neutral' ? pp.ToneMappingMode.NEUTRAL : pp.ToneMappingMode.AGX);
  const tone = new pp.ToneMappingEffect({ mode: modeOf(init.mapper) });
  composer.addPass(new pp.EffectPass(camera, exposure, bloom, tone, grade));
  if (init.smaa || samples === 0) composer.addPass(new pp.EffectPass(camera, new pp.SMAAEffect()));
  // Contrast-adaptive sharpening (the idea of AMD's CAS): each pixel is pushed away from the mean of its four neighbours, by less where the
  // neighbourhood already spans a wide range, and never past the neighbourhood's own min and max, so it cannot ring on a dark edge against a
  // bright wall. One extra full-screen pass, nine texture reads.
  const sharpenAmount = init.sharpen ?? 0;
  let sharpen: InstanceType<typeof pp.Effect> | null = null;
  if (sharpenAmount > 0) {
    class SharpenEffect extends pp.Effect {
      constructor(a: number) {
        super('SharpenEffect', `uniform float amount;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 t = texelSize;
  vec3 c = inputColor.rgb;
  vec3 n = texture2D(inputBuffer, uv + vec2(0.0, -t.y)).rgb, s = texture2D(inputBuffer, uv + vec2(0.0, t.y)).rgb;
  vec3 e = texture2D(inputBuffer, uv + vec2(t.x, 0.0)).rgb, w = texture2D(inputBuffer, uv + vec2(-t.x, 0.0)).rgb;
  vec3 mn = min(min(min(n, s), min(e, w)), c), mx = max(max(max(n, s), max(e, w)), c);
  vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-3)), 0.0, 1.0));
  vec3 k = -amp * amount;
  vec3 r = (c + (n + s + e + w) * k) / (1.0 + 4.0 * k);
  outputColor = vec4(clamp(r, mn, mx), inputColor.a);
}`, { attributes: pp.EffectAttribute.CONVOLUTION, uniforms: new Map<string, THREE.Uniform>([['amount', new THREE.Uniform(a)]]) });
      }
    }
    sharpen = new SharpenEffect(sharpenAmount * 0.125);
    composer.addPass(new pp.EffectPass(camera, sharpen));
  }

  const off = viewer.onResize((w, h) => composer.setSize(w, h, false));
  let graded = false;
  let aoK = 1;
  let ultra = false;
  return {
    samples,
    render: (dt) => composer.render(dt),
    setExposure: (e) => { exposure.exposure = e; },
    setGrade: (g) => {
      graded = true;
      exposure.exposure = g.exposure;
      exposure.setWb(g.whiteBalance);
      grade.set(g.saturation, g.contrast, g.shadowTint, g.highlightTint);
      grade.curve(g.pivot ?? 0.42, g.shoulder ?? 0.9, g.white ?? 0);
      bloom.intensity = g.bloom;
    },
    setBloom: (v) => { bloom.intensity = v; },
    setToneMapping: (on, mapper = init.mapper) => {
      tone.mode = on ? modeOf(mapper) : pp.ToneMappingMode.LINEAR;
      if (!on) { exposure.setWb([1, 1, 1]); grade.set(1, 1, [1, 1, 1], [1, 1, 1]); grade.curve(0.42, 0.9, 0); bloom.intensity = 0; }
      else if (!graded) bloom.intensity = init.bloom ? 0.35 : 0;
    },
    setAO: (on) => { ao.enabled = on && !aoOff; },
    setCurve: (p, sh, wh) => grade.curve(p, sh, wh),
    setAoStrength: (k) => { aoK = k; ao.configuration.intensity = AO_BASE * aoK * (ultra ? ULTRA_AO_GAIN : 1); },
    setUltra: (on) => {
      ultra = on;
      ao.configuration.intensity = AO_BASE * aoK * (ultra ? ULTRA_AO_GAIN : 1);
      ao.configuration.halfRes = !on;
      ao.configuration.aoSamples = on ? 20 : init.ao === 'cheap' ? 6 : 10;
      ao.configuration.denoiseSamples = on ? 8 : init.ao === 'cheap' ? 5 : 6;
      ao.configuration.aoRadius = on ? 0.28 : 0.35;
    },
    dispose() { off(); composer.dispose(); },
  };
}
