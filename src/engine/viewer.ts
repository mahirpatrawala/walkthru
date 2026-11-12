// The renderer, scene, lights and frame loop (SPEC 2, "Rendering"). Only this file imports Spark.
import * as THREE from 'three';
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

const BACKGROUND = '#EEF0F3';
const MAX_DT = 0.05;

function applyTransform(obj: THREE.Object3D, t: SceneTransform): void {
  obj.quaternion.set(t.rotation[0], t.rotation[1], t.rotation[2], t.rotation[3]);
  obj.scale.setScalar(t.scale);
  obj.position.set(t.position[0], t.position[1], t.position[2]);
  obj.updateMatrix();
}

function isTouchDevice(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

/**
 * Builds the renderer in `container`. `antialias` is on unless the scene has a splat (Spark needs it off).
 * sRGB output, no tone mapping, pixel ratio min(dpr, 2) on desktop and min(dpr, 1.5) on touch devices, one
 * HemisphereLight and one DirectionalLight, no shadow maps. FOV 60, or 70 in portrait.
 */
export function createViewer(container: HTMLElement, opts: { hasSplat: boolean }): Viewer {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !opts.hasSplat });
  } catch (err) {
    throw new Error(`createViewer: could not start WebGL (${String(err)}). Try another browser or enable hardware acceleration.`);
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = false;
  const touch = isTouchDevice();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2));

  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.style.outline = 'none';
  container.appendChild(canvas);
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.error('[walkthru] WebGL context lost. Reload the page if the view stays blank.');
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a8, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.set(3, 6, 2);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
  camera.position.set(2, 2, 6);

  function resize(): void {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 70 : 60;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(container);
  window.addEventListener('resize', resize);

  const callbacks = new Set<(dt: number) => void>();
  const viewer: Viewer = {
    renderer, scene, camera, canvas,
    fps: 0,
    onFrame(cb) {
      callbacks.add(cb);
      return () => { callbacks.delete(cb); };
    },
    async loadSplat(url, transform, onProgress) {
      return loadSplatInto(url, transform, onProgress);
    },
    dispose() {
      renderer.setAnimationLoop(null);
      ro?.disconnect();
      window.removeEventListener('resize', resize);
      callbacks.clear();
      sparkRenderer?.dispose?.();
      renderer.dispose();
      canvas.remove();
    },
  };

  // ---- frame loop
  let last = 0;
  let acc = 0;
  let frames = 0;
  renderer.setAnimationLoop((now: number) => {
    const dtRaw = last === 0 ? 0 : (now - last) / 1000;
    last = now;
    const dt = Math.min(MAX_DT, Math.max(0, dtRaw));
    acc += dtRaw;
    frames += 1;
    if (acc >= 0.5) {
      viewer.fps = frames / acc;
      acc = 0;
      frames = 0;
    }
    for (const cb of [...callbacks]) {
      try { cb(dt); } catch (err) { console.error('[walkthru] frame callback threw', err); }
    }
    renderer.render(scene, camera);
  });

  // ---- splats (Spark is imported lazily so scenes without a scan never download it)
  type SparkModule = typeof import('@sparkjsdev/spark');
  let sparkRenderer: InstanceType<SparkModule['SparkRenderer']> | null = null;

  async function loadSplatInto(url: string, transform: SceneTransform, onProgress?: (f: number) => void): Promise<SplatHandle> {
    let spark: SparkModule;
    try {
      spark = await import('@sparkjsdev/spark');
    } catch (err) {
      throw new Error(`loadSplat: could not load the Spark renderer (${String(err)})`);
    }
    if (!sparkRenderer) {
      sparkRenderer = new spark.SparkRenderer({ renderer });
      scene.add(sparkRenderer);
    }
    const mesh = new spark.SplatMesh({
      url,
      onProgress: (ev: ProgressEvent) => {
        if (onProgress && ev.lengthComputable && ev.total > 0) onProgress(Math.min(1, ev.loaded / ev.total));
      },
    });
    applyTransform(mesh, transform);
    scene.add(mesh);
    try {
      await mesh.initialized;
    } catch (err) {
      scene.remove(mesh);
      mesh.dispose();
      throw new Error(`loadSplat: could not load the scan ${url} (${String(err)})`);
    }
    onProgress?.(1);

    return {
      object: mesh,
      setVisible(v: boolean) { mesh.visible = v; },
      setTransform(t: SceneTransform) { applyTransform(mesh, t); },
      readCloud(): RawCloud {
        const n = mesh.packedSplats?.numSplats ?? mesh.splats?.getNumSplats() ?? 0;
        const positions = new Float32Array(n * 3);
        const opacity = new Uint8Array(n);
        const rgb = new Uint8Array(n * 3);
        let count = 0;
        mesh.forEachSplat((i, centre, _scales, _quat, op, colour) => {
          if (i >= n) return;
          positions[i * 3] = centre.x; positions[i * 3 + 1] = centre.y; positions[i * 3 + 2] = centre.z;
          opacity[i] = Math.round(Math.min(1, Math.max(0, op)) * 255);
          rgb[i * 3] = Math.round(Math.min(1, Math.max(0, colour.r)) * 255);
          rgb[i * 3 + 1] = Math.round(Math.min(1, Math.max(0, colour.g)) * 255);
          rgb[i * 3 + 2] = Math.round(Math.min(1, Math.max(0, colour.b)) * 255);
          count = Math.max(count, i + 1);
        });
        return { count, positions: positions.subarray(0, count * 3), opacity: opacity.subarray(0, count), rgb: rgb.subarray(0, count * 3) };
      },
      dispose() {
        scene.remove(mesh);
        mesh.dispose();
      },
    };
  }

  return viewer;
}
