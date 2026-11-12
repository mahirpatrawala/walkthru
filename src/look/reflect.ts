// Owned by C11a. SPEC 16.5 "Floor reflections": the signature of an Indian flat.
//  medium: one static 128 px cube map from 1.2 m above the largest room's centre, re-rendered on demand.
//  high:   a planar reflection (mirrored camera, half-resolution target) sampled in the floor shader with a 5-tap blur and
//          Fresnel weighting 0.04 to 0.55. All floors are at y = 0, so one mirrored camera serves every room.
import * as THREE from 'three';
import type { Viewer } from '../engine/viewer';
import type { Layout } from '../types';
import type { LookMaterials, ReflectionMode } from './materials';

/** centre of the room with the largest bounding box area, for the cube capture */
export function largestRoomCentre(layout: Layout): { x: number; z: number } {
  let best = { x: 0, z: 0 };
  let area = -1;
  for (const r of layout.rooms) {
    if (r.polygon.length < 3 || r.roomType === 'balcony') continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of r.polygon) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const a = (x1 - x0) * (z1 - z0);
    if (a > area) { area = a; best = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 }; }
  }
  return best;
}

export class Reflections {
  private mode: ReflectionMode = 'none';
  private cubeRT: THREE.WebGLCubeRenderTarget | null = null;
  private planarRT: THREE.WebGLRenderTarget | null = null;
  private cubeCam: THREE.CubeCamera | null = null;
  private readonly mirror = new THREE.PerspectiveCamera();
  private centre: { x: number; z: number };
  /** things hidden while a reflection is captured (floors, thresholds, the figure) */
  private hideList: () => THREE.Object3D[] = () => [];
  private offResize: (() => void) | null = null;

  constructor(private readonly viewer: Viewer, private readonly materials: LookMaterials, layout: Layout) {
    this.centre = largestRoomCentre(layout);
  }

  setLayout(layout: Layout): void { this.centre = largestRoomCentre(layout); }
  setHideList(fn: () => THREE.Object3D[]): void { this.hideList = fn; }

  setMode(m: ReflectionMode): void {
    if (m === this.mode) return;
    this.mode = m;
    if (m === 'cube') {
      if (!this.cubeRT) {
        this.cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
        this.cubeCam = new THREE.CubeCamera(0.05, 60, this.cubeRT);
      }
      this.materials.setReflection('cube', { cube: this.cubeRT.texture });
      this.updateCube();
    } else if (m === 'planar') {
      this.ensurePlanar();
      this.materials.setReflection('planar', { planar: this.planarRT!.texture });
      this.offResize ??= this.viewer.onResize(() => this.ensurePlanar());
    } else {
      this.materials.setReflection('none', {});
    }
  }

  private ensurePlanar(): void {
    const size = this.viewer.renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, Math.round(size.x / 2));
    const h = Math.max(2, Math.round(size.y / 2));
    if (!this.planarRT) {
      this.planarRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      this.materials.setReflection(this.mode, { planar: this.planarRT.texture });
    } else if (this.planarRT.width !== w || this.planarRT.height !== h) {
      this.planarRT.setSize(w, h);
    }
    this.materials.shared.reflSize.value.set(w, h);
  }

  /** Re-render the static cube map (after assets load, the hour changes, or furniture moves). */
  updateCube(): void {
    if (this.mode !== 'cube' || !this.cubeCam) return;
    const { renderer, scene } = this.viewer;
    const hidden = this.hideList().filter((o) => o.visible);
    for (const o of hidden) o.visible = false;
    this.cubeCam.position.set(this.centre.x, 1.2, this.centre.z);
    this.cubeCam.updateMatrixWorld(true);
    const prev = renderer.getRenderTarget();
    // a texture cannot be sampled while it is the render target (GL feedback loop: every draw would fail)
    const shared = this.materials.shared;
    const held = shared.cube.value;
    shared.cube.value = null;
    this.cubeCam.update(renderer, scene);
    shared.cube.value = held;
    renderer.setRenderTarget(prev);
    for (const o of hidden) o.visible = true;
  }

  /** Planar: call once per frame before the main render. */
  updatePlanar(): void {
    if (this.mode !== 'planar' || !this.planarRT) return;
    const { renderer, scene, camera } = this.viewer;
    const m = this.mirror;
    m.fov = camera.fov; m.aspect = camera.aspect; m.near = camera.near; m.far = camera.far;
    m.updateProjectionMatrix();
    const pos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(camera.matrixWorld);
    m.position.set(pos.x, -pos.y, pos.z);
    m.up.set(up.x, -up.y, up.z);
    m.lookAt(pos.x + fwd.x, -(pos.y + fwd.y), pos.z + fwd.z);
    m.updateMatrixWorld(true);
    this.materials.shared.reflVP.value.multiplyMatrices(m.projectionMatrix, m.matrixWorldInverse);

    const hidden = this.hideList().filter((o) => o.visible);
    for (const o of hidden) o.visible = false;
    const prev = renderer.getRenderTarget();
    const shared = this.materials.shared;
    const held = shared.planar.value; // not sampled while it is the render target (GL feedback loop)
    shared.planar.value = null;
    renderer.setRenderTarget(this.planarRT);
    renderer.clear();
    renderer.render(scene, m);
    renderer.setRenderTarget(prev);
    shared.planar.value = held;
    for (const o of hidden) o.visible = true;
  }

  dispose(): void {
    this.offResize?.();
    this.cubeRT?.dispose();
    this.planarRT?.dispose();
    this.materials.setReflection('none', { cube: null, planar: null });
  }
}
