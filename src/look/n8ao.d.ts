// Type shim for n8ao 2.0.1, which ships no declarations. Only what src/look/post.ts calls.
declare module 'n8ao' {
  import type { Camera, Scene } from 'three';
  import type { Pass } from 'postprocessing';
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number; distanceFalloff: number; intensity: number; halfRes: boolean; gammaCorrection: boolean;
      aoSamples: number; denoiseSamples: number; denoiseRadius: number;
      [key: string]: unknown;
    };
  }
}
