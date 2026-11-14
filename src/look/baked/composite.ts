// SPEC 16.14: the lightmap compositor. The baked components (sky, three suns, lamps, cove) are mixed into ONE half-float picture by one
// full-screen draw whenever the light changes (the hour, a preset, True colours). Every lightmapped surface then needs a single texture
// sample, whatever the time of day. Costs one draw at atlas size; nothing per frame.
import * as THREE from 'three';
import { COMPONENTS, COMPONENT_GAMMA } from './types';

const AO_INDEX = COMPONENTS.indexOf('ao');
import type { ComponentId } from './types';

export interface CompositorInput { texture: THREE.Texture; gain: number }

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;
const FRAG = /* glsl */ `
varying vec2 vUv;
${COMPONENTS.map((_, i) => `uniform sampler2D t${i}; uniform vec3 w${i}; uniform float g${i};`).join('\n')}
uniform vec3 uFill;
vec3 dec( sampler2D t, float g ) { vec3 c = texture2D( t, vUv ).rgb; return pow( c, vec3( ${COMPONENT_GAMMA.toFixed(1)} ) ) * g; }
void main() {
  vec3 e = uFill;
  if ( g${AO_INDEX} > 0.0 ) e *= dec( t${AO_INDEX}, g${AO_INDEX} );
${COMPONENTS.map((_, i) => (i === AO_INDEX ? '' : `  if ( g${i} > 0.0 && ( w${i}.r + w${i}.g + w${i}.b ) > 0.0 ) e += w${i} * dec( t${i}, g${i} );`)).join('\n')}
  gl_FragColor = vec4( e, 1.0 );
}`;

/** what the runtime needs from a compositor (a test can supply its own) */
export interface CompositorLike {
  readonly target: { texture: THREE.Texture };
  compose(weights: Partial<Record<ComponentId, [number, number, number]>>, fill?: [number, number, number]): void;
  dispose(): void;
}

export class Compositor implements CompositorLike {
  readonly target: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private black: THREE.DataTexture;
  private uniforms: Record<string, { value: unknown }> = {};
  private last = '';
  private fillV = new THREE.Vector3();

  constructor(private renderer: THREE.WebGLRenderer, readonly size: number, inputs: Partial<Record<ComponentId, CompositorInput>>) {
    this.black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.black.needsUpdate = true;
    COMPONENTS.forEach((c, i) => {
      this.uniforms[`t${i}`] = { value: inputs[c]?.texture ?? this.black };
      this.uniforms[`w${i}`] = { value: new THREE.Vector3(0, 0, 0) };
      this.uniforms[`g${i}`] = { value: inputs[c]?.gain ?? 0 };
    });
    this.uniforms.uFill = { value: this.fillV };
    this.material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    });
    this.target.texture.channel = 1;
  }

  /** Mixes the components with these rgb weights. Skips the draw when nothing changed. */
  compose(weights: Partial<Record<ComponentId, [number, number, number]>>, fill: [number, number, number] = [0, 0, 0]): void {
    const key = fill.map((v) => v.toFixed(4)).join(',') + '#' + COMPONENTS.map((c) => (weights[c] ?? [0, 0, 0]).map((v) => v.toFixed(4)).join(',')).join('|');
    if (key === this.last) return;
    this.last = key;
    this.fillV.set(fill[0], fill[1], fill[2]);
    COMPONENTS.forEach((c, i) => {
      const w = weights[c] ?? [0, 0, 0];
      (this.uniforms[`w${i}`].value as THREE.Vector3).set(w[0], w[1], w[2]);
    });
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    const prevXr = r.xr.enabled;
    r.xr.enabled = false;
    r.autoClear = false;
    r.setRenderTarget(this.target);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAuto;
    r.xr.enabled = prevXr;
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    this.black.dispose();
  }
}
