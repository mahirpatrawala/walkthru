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
  /** the two scene lights (SPEC 16.5): the look drives these instead of adding duplicates */
  lights: { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight };
  /** When set, the frame loop calls it instead of `renderer.render(scene, camera)` (post-processing). `null` restores the default. */
  setRenderOverride(fn: ((dt: number) => void) | null): void;
  readonly renderOverride: ((dt: number) => void) | null;
  /** Caps the device pixel ratio (the look sets it per quality tier) and resizes. */
  setPixelRatioCap(cap: number): void;
  /** re-reads the container size */
  resize(): void;
  /** returns an unsubscribe function; called after the renderer was resized */
  onResize(cb: (w: number, h: number) => void): () => void;
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
 * A building opens one space after another in the same page. The renderer (and so the WebGL context, the compiled programs and the canvas)
 * is made once and handed to each space's viewer in turn: a texture or geometry that two spaces share would otherwise keep a listener on
 * every renderer that ever drew it. Held while a shared viewer is alive or waiting for the next space.
 */
let sharedGL: { renderer: THREE.WebGLRenderer; canvas: HTMLCanvasElement; antialias: boolean; container: HTMLElement } | null = null;

/** Lets go of the shared renderer for good (the page is leaving buildings, or the next space needs another kind of context). */
export function releaseSharedRenderer(): void {
  if (!sharedGL) return;
  sharedGL.renderer.setAnimationLoop(null);
  sharedGL.renderer.dispose();
  sharedGL.renderer.forceContextLoss();
  sharedGL.canvas.remove();
  sharedGL = null;
}

/**
 * Builds the renderer in `container`. `antialias` is on unless the scene has a splat (Spark needs it off).
 * sRGB output, no tone mapping, pixel ratio min(dpr, 2) on desktop and min(dpr, 1.5) on touch devices, one
 * HemisphereLight and one DirectionalLight, no shadow maps. FOV 60, or 70 in portrait.
 * `shared`: reuse the renderer and canvas of the last shared viewer (a building's spaces); `dispose` then leaves them for the next one.
 */
export function createViewer(container: HTMLElement, opts: { hasSplat: boolean; shared?: boolean }): Viewer {
  const antialias = !opts.hasSplat;
  const share = opts.shared === true;
  let renderer: THREE.WebGLRenderer;
  let canvas: HTMLCanvasElement;
  let disposed = false;
  if (share && sharedGL && sharedGL.antialias === antialias && sharedGL.container === container && sharedGL.canvas.isConnected) {
    renderer = sharedGL.renderer;
    canvas = sharedGL.canvas;
  } else {
    if (share) releaseSharedRenderer();
    try {
      renderer = new THREE.WebGLRenderer({ antialias });
    } catch (err) {
      throw new Error(`createViewer: could not start WebGL (${String(err)}). Try another browser or enable hardware acceleration.`);
    }
    canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.style.outline = 'none';
    container.appendChild(canvas);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (disposed) return; // we let go of it ourselves
      console.error('[walkthru] WebGL context lost. Reload the page if the view stays blank.');
    });
    if (share) sharedGL = { renderer, canvas, antialias, container };
  }
  // the state every viewer starts from (a shared renderer may have been left otherwise by the last space)
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = false;
  renderer.info.autoReset = true;
  const touch = isTouchDevice();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  const hemi = new THREE.HemisphereLight(0xffffff, 0xb8b0a8, 1.0);
  scene.add(hemi);
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
    const fovFor = camera.userData.fovFor as ((aspect: number) => number) | undefined; // first person asks for its own (SPEC 16.18)
    camera.fov = fovFor ? fovFor(camera.aspect) : camera.aspect < 1 ? 70 : 60;
    camera.updateProjectionMatrix();
    for (const cb of [...resizeCbs]) {
      try { cb(w, h); } catch (err) { console.error('[walkthru] resize callback threw', err); }
    }
  }
  const resizeCbs = new Set<(w: number, h: number) => void>();
  resize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(container);
  window.addEventListener('resize', resize);

  const callbacks = new Set<(dt: number) => void>();
  let renderOverride: ((dt: number) => void) | null = null;
  const viewer: Viewer = {
    renderer, scene, camera, canvas,
    fps: 0,
    lights: { hemi, sun },
    get renderOverride() { return renderOverride; },
    setRenderOverride(fn) { renderOverride = fn; },
    setPixelRatioCap(cap) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
      resize();
    },
    resize,
    onResize(cb) {
      resizeCbs.add(cb);
      return () => { resizeCbs.delete(cb); };
    },
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
      resizeCbs.clear();
      sparkRenderer?.dispose?.();
      if (share) return; // the renderer and the canvas wait for the next space (releaseSharedRenderer ends it)
      disposed = true;
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
    if (renderOverride) {
      try {
        renderOverride(dt);
      } catch (err) {
        console.error('[walkthru] render override threw, using the plain renderer', err);
        renderOverride = null;
        renderer.render(scene, camera);
      }
    } else {
      renderer.render(scene, camera);
    }
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
