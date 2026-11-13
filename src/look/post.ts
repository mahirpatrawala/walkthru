// Owned by C11a. SPEC 16.5 high tier: render -> N8AO -> exposure + white balance + bloom + tone mapping + grade (split tone) -> SMAA.
// `postprocessing` and `n8ao` are loaded with dynamic import() here and nowhere else, so they never reach a phone.
import * as THREE from 'three';
import type { Viewer } from '../engine/viewer';

export type { ToneMapperName } from './quality';
import type { Rgb } from './grade';
import type { ToneMapperName } from './quality';

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
}

export interface PostChain {
  render(dt: number): void;
  setExposure(e: number): void;
  setGrade(g: PostGrade): void;
  setBloom(intensity: number): void;
  /** false = linear (True colours: nothing is rolled off or graded) */
  setToneMapping(on: boolean, mapper?: ToneMapperName): void;
  setAO(on: boolean): void;
  dispose(): void;
}

export async function createPostChain(viewer: Viewer, init: { exposure: number; bloom: boolean; mapper: ToneMapperName }): Promise<PostChain> {
  const [pp, n8] = await Promise.all([import('postprocessing'), import('n8ao')]);
  const { renderer, scene, camera } = viewer;
  const size = renderer.getSize(new THREE.Vector2());

  const composer = new pp.EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.setSize(size.x, size.y, false);
  const renderPass = new pp.RenderPass(scene, camera);
  composer.addPass(renderPass);

  // screen-space AO for wall-to-wall corners and furniture detail: half resolution, radius 0.6 m, intensity 1.6
  const ao = new n8.N8AOPostPass(scene, camera, size.x, size.y);
  ao.configuration.aoRadius = 0.6;
  ao.configuration.distanceFalloff = 0.3;
  ao.configuration.intensity = 1.6;
  ao.configuration.halfRes = true;
  // N8AO's defaults (16 samples, 8 denoise samples) cost about 8 ms at 2880 x 1800 on an M2; these keep it near 3 ms
  ao.configuration.aoSamples = 6;
  ao.configuration.denoiseSamples = 4;
  ao.configuration.denoiseRadius = 8;
  ao.configuration.gammaCorrection = false;
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
      super('GradeEffect', `uniform float sat;\nuniform float contrast;\nuniform vec3 shadowTint;\nuniform vec3 highlightTint;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, sat);
  c *= mix(shadowTint, highlightTint, smoothstep(0.04, 0.6, l));
  c = max((c - 0.18) * contrast + 0.18, 0.0);
  outputColor = vec4(c, inputColor.a);
}`,
        { uniforms: new Map<string, THREE.Uniform>([['sat', new THREE.Uniform(1)], ['contrast', new THREE.Uniform(1)], ['shadowTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))], ['highlightTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))]]) });
    }
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
  composer.addPass(new pp.EffectPass(camera, new pp.SMAAEffect()));

  const off = viewer.onResize((w, h) => composer.setSize(w, h, false));
  let graded = false;
  return {
    render: (dt) => composer.render(dt),
    setExposure: (e) => { exposure.exposure = e; },
    setGrade: (g) => {
      graded = true;
      exposure.exposure = g.exposure;
      exposure.setWb(g.whiteBalance);
      grade.set(g.saturation, g.contrast, g.shadowTint, g.highlightTint);
      bloom.intensity = g.bloom;
    },
    setBloom: (v) => { bloom.intensity = v; },
    setToneMapping: (on, mapper = init.mapper) => {
      tone.mode = on ? modeOf(mapper) : pp.ToneMappingMode.LINEAR;
      if (!on) { exposure.setWb([1, 1, 1]); grade.set(1, 1, [1, 1, 1], [1, 1, 1]); bloom.intensity = 0; }
      else if (!graded) bloom.intensity = init.bloom ? 0.35 : 0;
    },
    setAO: (on) => { ao.enabled = on; },
    dispose() { off(); composer.dispose(); },
  };
}
