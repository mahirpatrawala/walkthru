// Owned by C2. Stub from C0: signatures only (SPEC 7.1). Only this file may import Spark.
import type * as THREE from 'three';
import type { RawCloud, SceneTransform } from '../types';

export interface Viewer {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement;
  /** returns an unsubscribe function; dt in seconds, clamped to 0.05 */
  onFrame(cb: (dt: number) => void): () => void;
  /** creates the SparkRenderer on first use */
  loadSplat(url: string, transform: SceneTransform, onProgress?: (fraction: number) => void): Promise<SplatHandle>;
  fps: number;
  dispose(): void;
}
export interface SplatHandle {
  object: THREE.Object3D; setVisible(v: boolean): void; setTransform(t: SceneTransform): void;
  /** for the editor: iterate centres, any format */ readCloud(): RawCloud; dispose(): void;
}
export function createViewer(container: HTMLElement, opts: { hasSplat: boolean }): Viewer {
  throw new Error('not implemented: C2 createViewer');
}
