// Owned by C11a. SPEC 16.5 high tier: render -> N8AO -> exposure + bloom + Neutral tone mapping -> SMAA.
// `postprocessing` and `n8ao` are loaded with dynamic import() here and nowhere else, so they never reach a phone.
import * as THREE from 'three';
import type { Viewer } from '../engine/viewer';

export interface PostChain {
  render(dt: number): void;
  setExposure(e: number): void;
  setBloom(on: boolean): void;
  setAO(on: boolean): void;
  dispose(): void;
}

export async function createPostChain(viewer: Viewer, init: { exposure: number; bloom: boolean }): Promise<PostChain> {
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

  class ExposureEffect extends pp.Effect {
    constructor(e: number) {
      super('ExposureEffect', 'uniform float exposure;\nvoid mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) { outputColor = vec4(inputColor.rgb * exposure, inputColor.a); }',
        { uniforms: new Map<string, THREE.Uniform>([['exposure', new THREE.Uniform(e)]]) });
    }
    set exposure(v: number) { (this.uniforms.get('exposure') as THREE.Uniform).value = v; }
  }
  const exposure = new ExposureEffect(init.exposure);
  // threshold 0.9, intensity 0.35: windows and the sun patch glow slightly, nothing else
  const bloom = new pp.BloomEffect({ luminanceThreshold: 0.9, luminanceSmoothing: 0.1, intensity: init.bloom ? 0.35 : 0, mipmapBlur: true });
  const tone = new pp.ToneMappingEffect({ mode: pp.ToneMappingMode.NEUTRAL });
  composer.addPass(new pp.EffectPass(camera, exposure, bloom, tone));
  composer.addPass(new pp.EffectPass(camera, new pp.SMAAEffect()));

  const off = viewer.onResize((w, h) => composer.setSize(w, h, false));
  return {
    render: (dt) => composer.render(dt),
    setExposure: (e) => { exposure.exposure = e; },
    setBloom: (on) => { bloom.intensity = on ? 0.35 : 0; },
    setAO: (on) => { ao.enabled = on; },
    dispose() { off(); composer.dispose(); },
  };
}
