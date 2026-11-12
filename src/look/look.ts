// Owned by C11a. SPEC 16.5 "The controller": lighting, tone mapping, sun, sky, shadows, reflections, post-processing and the
// quality tier, behind one object. C11b (furniture models, character) and C11c (painterly) extend it through the hooks marked below.
import * as THREE from 'three';
import type { Viewer } from '../engine/viewer';
import type { Finishes, Grid, Layout } from '../types';
import { AssetLoader } from './assets';
import { buildAoField } from './floor-ao';
import { createLookMaterials } from './materials';
import type { LookMaterials } from './materials';
import { createPostChain } from './post';
import type { PostChain } from './post';
import { FpsWatch, FrameTimer, TIERS, lowerTier, loadSavedTier, readDevice, guessTier, saveTier, stepDown, tierFromQuery } from './quality';
import type { TierConfig } from './quality';
import { Reflections } from './reflect';
import { Sky, chooseBackdrop } from './sky';
import { sunState } from './sun';
import type { SunState } from './sun';
import { DEFAULT_HOUR, parseLookFile } from './types';
import type { LookFile, Tier } from './types';

export type { Tier } from './types';
export type { LookFile } from './types';

export type QualityMode = 'auto' | Tier;

export interface LookStats { tier: Tier; fps: number; drawCalls: number; triangles: number; textures: number; bytesLoaded: number }

export interface Look {
  readonly tier: Tier;
  setTier(t: Tier): Promise<void>;
  /** 6..19 */ setHour(h: number): void;
  setTrueColours(on: boolean): void;
  /** call after furniture changes; rebuilds the floor AO, the static shadow map and the cube map */
  refresh(grid: Grid): void;
  /** scan shown: tone mapping, post and glass off (rule 5) */
  setScanVisible(v: boolean): void;
  materials(): LookMaterials;
  stats(): LookStats;
  dispose(): void;

  // ---- additions to the SPEC interface (all optional for callers)
  /** resolves when the current tier's assets are in; replaced by a new promise whenever the tier changes */
  readonly ready: Promise<void>;
  readonly hour: number;
  readonly trueColours: boolean;
  /** 'auto' while the device guess and the frame-rate watchdog choose the tier */
  readonly quality: QualityMode;
  readonly tierConfig: TierConfig;
  readonly lookFile: LookFile | null;
  /** the layout's finishes, as sampled (or the defaults) */
  readonly finishes: Finishes;
  sun(): SunState;
  /** 'auto' re-runs the device guess and frame timing; a tier forces it */
  setQuality(q: QualityMode): Promise<void>;
  /** Hooks for the rest of the scene. Safe to call any time, any number of times. */
  attach(parts: LookAttachments): void;
  /** the new layout (the editor preview rebuilds its shell often) */
  setLayout(layout: Layout, grid?: Grid): void;
  /** fraction (0..1) of the screen the biggest window pane covers right now */
  windowFraction(): number;
  /** tell the look the buyer's own render happened outside it (the painterly mode, C11c) */
  onChange(cb: () => void): () => void;
  /** acceptance helpers (SPEC 16.8) */
  debug: LookDebug;
}

export interface LookAttachments {
  shell?: THREE.Object3D;
  /** parent of the furniture meshes; their shadow flags follow the tier. C11b: models are added under it. */
  furnitureRoot?: THREE.Object3D;
  /** the walking figure; it casts a real shadow on the high tier and its blob shadow is hidden then */
  character?: { object: THREE.Object3D; setBlobVisible(v: boolean): void };
}

export interface LookDebug {
  /** mean sRGB (0..255) of a rectangle in CSS pixels of the canvas, read right after a fresh render */
  sample(x0: number, y0: number, x1: number, y1: number): [number, number, number];
  /** luminance standard deviation (0..255 scale) of the same kind of rectangle */
  sampleStd(x0: number, y0: number, x1: number, y1: number): number;
  /** CSS px of a world point, or null when it is off screen or behind the camera */
  project(x: number, y: number, z: number): [number, number] | null;
  renderNow(): void;
  /** internals for inspection in a browser */
  reflections: unknown;
  readonly post: PostChain | null;
}

/** Reads the optional look.json of a scene. Missing, HTML (a dev server's index page) or broken: null. */
export async function fetchLookFile(sceneId: string): Promise<LookFile | null> {
  try {
    const res = await fetch(`/scenes/${sceneId}/look.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const text = await res.text();
    if (/^\s*</.test(text)) return null;
    return parseLookFile(JSON.parse(text));
  } catch {
    return null;
  }
}

const OLD_BACKGROUND = '#EEF0F3';
/** daylight white for the fill light: D65 to D55, a touch warm so shade reads white, not blue */
const SKY_DAYLIGHT = new THREE.Color('#F6F3EE');
const SKY_WARM = new THREE.Color('#FFD9B0');
/** SPEC 16.5: hemisphere "intensity 1.0" in the spec's units. three's lights are scaled by pi, so 1.0 shows a surface at its own colour. */
const TRUE_COLOUR_HEMI = Math.PI;
const EXPOSURE_DEFAULT = 1.3;
const EXPOSURE_TRUE = 1.0;
/** the sun's output in three units per unit of sunIntensity() */
const SUN_GAIN = 4.4;

export async function createLook(viewer: Viewer, layoutIn: Layout, lookFileIn: LookFile | null, opts: { tier?: Tier; storage?: Storage | null; hasSplat?: boolean; /** false keeps the flat background colour (the editor's orbit preview) */ backdrop?: boolean } = {}): Promise<Look> {
  const { renderer, scene, camera } = viewer;
  let layout = layoutIn;
  const lookFile = lookFileIn;
  const loader = new AssetLoader();
  const materials = createLookMaterials({ wallHeightM: layout.wallHeightM });
  const sky = new Sky(scene, renderer, loader);
  const reflections = new Reflections(viewer, materials, layout);
  const listeners = new Set<() => void>();
  const notify = (): void => { for (const cb of [...listeners]) { try { cb(); } catch (e) { console.error('[walkthru] look listener threw', e); } } };

  let storage: Storage | null = opts.storage ?? null;
  if (opts.storage === undefined) { try { storage = window.localStorage; } catch { storage = null; } }

  // ---- state
  const forced = opts.tier ?? tierFromQuery(typeof location !== 'undefined' ? location.search : '');
  const device = readDevice(renderer.getContext());
  let tier: Tier = forced ?? lowerTier(guessTier(device), loadSavedTier(storage) ?? 'high');
  let quality: QualityMode = forced ?? 'auto';
  let cfg: TierConfig = TIERS[tier];
  let hour = lookFile?.hour ?? DEFAULT_HOUR;
  let trueColours = false;
  let scanVisible = false;
  let post: PostChain | null = null;
  let postLoading: Promise<void> | null = null;
  let postFailed = false;
  // Spark registers its shader chunk the first time it renders. A composer that compiles the scene before that fails with
  // "Cannot resolve #include <splatDefines>", so on a scene with a scan the post chain waits until the scan has been shown once.
  let postAllowed = !opts.hasSplat;
  let sun = sunState(layout, lookFile, hour);
  let disposed = false;
  let grid: Grid | null = null;
  let parts: LookAttachments = {};
  let readyPromise: Promise<void> = Promise.resolve();
  let loadingTier = false;
  let steppedDown = false;
  let cubeTimer: ReturnType<typeof setTimeout> | null = null;

  renderer.info.autoReset = false;
  const sunLight = viewer.lights.sun;
  const hemi = viewer.lights.hemi;
  scene.add(sunLight.target);
  const oldLights = {
    hemiColour: hemi.color.clone(), hemiGround: hemi.groundColor.clone(), hemiIntensity: hemi.intensity,
    sunIntensity: sunLight.intensity, sunPosition: sunLight.position.clone(), sunColour: sunLight.color.clone(),
    background: scene.background,
  };

  // ---- lighting

  function bounds(): { centre: THREE.Vector3; radius: number } {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const r of layout.rooms) for (const p of r.polygon) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    if (!isFinite(x0)) { x0 = -2; x1 = 2; z0 = -2; z1 = 2; }
    const centre = new THREE.Vector3((x0 + x1) / 2, layout.wallHeightM / 2, (z0 + z1) / 2);
    const radius = Math.hypot((x1 - x0) / 2 + 0.3, (z1 - z0) / 2 + 0.3, layout.wallHeightM / 2 + 0.2);
    return { centre, radius };
  }

  function fitShadow(): void {
    const { centre, radius } = bounds();
    const dir = new THREE.Vector3(...sun.toSun).normalize();
    sunLight.target.position.copy(centre);
    sunLight.target.updateMatrixWorld();
    sunLight.position.copy(centre).addScaledVector(dir, radius * 1.5);
    const cam = sunLight.shadow.camera;
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
    cam.near = radius * 0.4; cam.far = radius * 2.8;
    cam.updateProjectionMatrix();
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.03;
  }

  function skyColour(): THREE.Color {
    return SKY_DAYLIGHT.clone().lerp(SKY_WARM, sun.warmth);
  }

  function shadowsOn(): boolean {
    return cfg.shadow !== 'none' && !trueColours && !scanVisible;
  }

  function needsShadowRefresh(): void {
    if (cfg.shadow === 'static') renderer.shadowMap.needsUpdate = true;
  }

  function applyLighting(): void {
    sun = sunState(layout, lookFile, hour);
    if (scanVisible) {
      // rule 5: exactly as before C11
      hemi.color.copy(oldLights.hemiColour); hemi.groundColor.copy(oldLights.hemiGround); hemi.intensity = oldLights.hemiIntensity;
      sunLight.color.copy(oldLights.sunColour); sunLight.intensity = oldLights.sunIntensity; sunLight.position.copy(oldLights.sunPosition);
      sunLight.target.position.set(0, 0, 0);
      sunLight.castShadow = false;
      scene.environment = null;
      scene.background = new THREE.Color(OLD_BACKGROUND);
      scene.backgroundIntensity = 1;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.shadowMap.enabled = false;
      return;
    }
    if (trueColours) {
      hemi.color.set('#ffffff'); hemi.groundColor.set('#ffffff'); hemi.intensity = TRUE_COLOUR_HEMI;
      sunLight.visible = false; sunLight.intensity = 0; sunLight.castShadow = false;
      scene.environmentIntensity = 0;
    } else {
      hemi.color.copy(skyColour()).multiplyScalar(cfg.skyScale); hemi.groundColor.set(cfg.groundColour).multiplyScalar(cfg.groundScale); hemi.intensity = cfg.hemiIntensity;
      sunLight.visible = true;
      sunLight.color.setRGB(sun.colour[0], sun.colour[1], sun.colour[2]);
      sunLight.intensity = sun.intensity * SUN_GAIN * cfg.sunScale;
      scene.environmentIntensity = cfg.envIntensity;
      sunLight.castShadow = shadowsOn();
      fitShadow();
    }
    const exposure = trueColours ? EXPOSURE_TRUE : EXPOSURE_DEFAULT;
    // "True colours" is no tone mapping at all: nothing in it is brighter than its own colour, so surfaces show it exactly
    renderer.toneMapping = post || trueColours ? THREE.NoToneMapping : THREE.NeutralToneMapping;
    renderer.toneMappingExposure = exposure;
    post?.setExposure(exposure);
    post?.setToneMapping(!trueColours);
    sky.setExposure(exposure);
    sky.setSunAzimuth(sun.planAzimuthDeg);
    needsShadowRefresh();
  }

  /** Recompile the materials that depend on shadow settings. Only our own roots: Spark's splat material must not be touched
   *  (its shader chunk is gone after the first compile, a second compile fails). */
  function setMaterialsDirty(): void {
    const roots = [parts.shell, parts.furnitureRoot, parts.character?.object].filter((o): o is THREE.Object3D => !!o);
    for (const root of roots) {
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
      });
    }
  }

  function applyShadowFlags(): void {
    const on = cfg.shadow !== 'none';
    parts.furnitureRoot?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = on; m.receiveShadow = on; }
    });
    const live = cfg.shadow === 'live' && !scanVisible;
    if (parts.character) {
      parts.character.object.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) m.castShadow = live; });
      parts.character.setBlobVisible(!live);
    }
  }

  function applyTier(): void {
    const prevType = renderer.shadowMap.type;
    const wasEnabled = renderer.shadowMap.enabled;
    viewer.setPixelRatioCap(cfg.pixelRatioCap);
    renderer.shadowMap.enabled = shadowsOn();
    // SPEC-GAP: 16.5 names PCFSoftShadowMap for high, but three 0.186 removed it (PCFShadowMap is the soft one now); high widens the filter instead
    renderer.shadowMap.type = THREE.PCFShadowMap;
    sunLight.shadow.radius = cfg.shadow === 'live' ? 3 : 1.5;
    renderer.shadowMap.autoUpdate = cfg.shadow === 'live';
    if (cfg.shadow !== 'none') {
      if (sunLight.shadow.mapSize.x !== cfg.shadowMapSize) {
        sunLight.shadow.mapSize.set(cfg.shadowMapSize, cfg.shadowMapSize);
        sunLight.shadow.map?.dispose();
        sunLight.shadow.map = null;
      }
    }
    if (prevType !== renderer.shadowMap.type || wasEnabled !== renderer.shadowMap.enabled) setMaterialsDirty();
    materials.configure(cfg, { trueColours });
    reflections.setHideList(() => {
      const hide: THREE.Object3D[] = [];
      parts.shell?.traverse((o) => { if (o.name.startsWith('floor:') || o.name.startsWith('threshold:')) hide.push(o); });
      return hide;
    });
    applyLighting();
    applyShadowFlags();
    applyRenderPath();
    notify();
  }

  function applyRenderPath(): void {
    const wantPost = cfg.post && !scanVisible && !postFailed && postAllowed;
    const wantReflection = scanVisible ? 'none' : cfg.reflection;
    if (wantPost) {
      if (post) viewer.setRenderOverride(renderFrame);
      else if (!postLoading) {
        postLoading = createPostChain(viewer, { exposure: trueColours ? EXPOSURE_TRUE : EXPOSURE_DEFAULT, bloom: cfg.bloom })
          .then((p) => {
            if (disposed || !TIERS[tier].post) { p.dispose(); return; }
            post = p;
            syncAo();
            applyLighting();
            applyRenderPath();
          })
          .catch((err) => { postFailed = true; console.warn('[walkthru] post-processing could not start, using the plain renderer', err); })
          .finally(() => { postLoading = null; });
      }
    } else {
      if (post && !cfg.post) { post.dispose(); post = null; }
      if (post && scanVisible) { /* keep the chain, just do not use it */ }
    }
    const usePost = !!post && wantPost;
    if (usePost || wantReflection === 'planar') viewer.setRenderOverride(renderFrame);
    else viewer.setRenderOverride(null);
    renderer.toneMapping = scanVisible || usePost || trueColours ? THREE.NoToneMapping : THREE.NeutralToneMapping;
    reflections.setMode(wantReflection);
  }

  /** N8AO costs about 1.5 ms per megapixel of drawing buffer on an M2: 8 ms at 2880 x 1800. Past 2.5 megapixels the high tier keeps the
   *  grid AO and drops the screen-space pass rather than miss its 55 fps target. */
  const SSAO_MAX_PIXELS = 2.5e6;
  function syncAo(): void {
    if (!post) return;
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    post.setAO(s.x * s.y <= SSAO_MAX_PIXELS);
  }
  const offAo = viewer.onResize(() => syncAo());

  function renderFrame(dt: number): void {
    if (cfg.reflection === 'planar' && !scanVisible && !trueColours) reflections.updatePlanar();
    if (post && cfg.post && !scanVisible) post.render(dt);
    else renderer.render(scene, camera);
  }

  // ---- assets

  function loadForTier(): Promise<void> {
    const my = tier;
    loadingTier = true;
    const p = (async () => {
      sky.reset();
      const jobs: Promise<unknown>[] = [
        opts.backdrop === false ? Promise.resolve() : sky.show(chooseBackdrop(lookFile, hour, trueColours), cfg).catch((e) => console.warn('[walkthru] backdrop not loaded', e)),
        materials.loadTextures(loader, cfg).catch((e) => console.warn('[walkthru] textures not loaded', e)),
      ];
      if (cfg.post) {
        applyRenderPath();
        if (postLoading) jobs.push(postLoading);
      }
      await Promise.all(jobs);
      if (disposed || my !== tier) return;
      materials.configure(cfg, { trueColours });
      applyLighting();
      needsShadowRefresh();
      reflections.updateCube();
      notify();
    })().finally(() => { if (my === tier) loadingTier = false; });
    return p;
  }

  async function switchTier(t: Tier): Promise<void> {
    if (disposed) return;
    tier = t;
    cfg = TIERS[t];
    if (!cfg.post && post) { post.dispose(); post = null; }
    applyTier();
    readyPromise = loadForTier();
    if (grid) rebuildAo(grid);
    await readyPromise;
  }

  // ---- ambient occlusion from the collision grid

  function rebuildAo(g: Grid): void {
    materials.setFloorAO(buildAoField(g));
    materials.setCeilingAO(buildAoField(g, { minObstacleCm: Math.max(21, layout.wallHeightM * 100 - 30) }));
  }

  function scheduleCube(): void {
    if (cfg.reflection !== 'cube') return;
    if (cubeTimer) clearTimeout(cubeTimer);
    cubeTimer = setTimeout(() => { cubeTimer = null; if (!disposed) reflections.updateCube(); }, 150);
  }

  // ---- auto tier: the first guess is timed, then a watchdog steps down once

  const watch = new FpsWatch(cfg.fpsTarget);
  let bench: FrameTimer | null = null;
  let lastNow = 0;
  const offFrame = viewer.onFrame(() => {
    renderer.info.reset();
    const now = performance.now();
    const dt = lastNow ? (now - lastNow) / 1000 : 0;
    lastNow = now;
    if (disposed || quality !== 'auto' || loadingTier || document.hidden) { bench = null; watch.reset(); return; }
    if (bench) {
      const fps = bench.frame(dt);
      if (fps !== null) {
        bench = null;
        if (fps < cfg.fpsTarget && tier !== 'low') {
          steppedDown = true;
          void switchTier(stepDown(tier)).then(() => { bench = new FrameTimer(40); });
        }
      }
      return;
    }
    if (!steppedDown && tier !== 'low' && watch.frame(dt)) {
      steppedDown = true;
      const next = stepDown(tier);
      saveTier(storage, next);
      void switchTier(next);
    }
  });

  // ---- the object

  const look: Look = {
    get tier() { return tier; },
    get ready() { return readyPromise; },
    get hour() { return hour; },
    get trueColours() { return trueColours; },
    get quality() { return quality; },
    get tierConfig() { return cfg; },
    get lookFile() { return lookFile; },
    get finishes() { return layout.finishes; },
    sun: () => sun,
    async setTier(t) {
      quality = t;
      bench = null;
      await switchTier(t);
    },
    async setQuality(q) {
      quality = q;
      steppedDown = false;
      watch.reset();
      if (q === 'auto') {
        const t = lowerTier(guessTier(device), loadSavedTier(storage) ?? 'high');
        watch.setTarget(TIERS[t].fpsTarget);
        await switchTier(t);
        bench = new FrameTimer(40);
      } else {
        await switchTier(q);
      }
    },
    setHour(h) {
      hour = Math.min(19, Math.max(6, h));
      applyLighting();
      if (opts.backdrop !== false) void sky.show(chooseBackdrop(lookFile, hour, trueColours), cfg).catch(() => {});
      scheduleCube();
      notify();
    },
    setTrueColours(on) {
      trueColours = on;
      materials.configure(cfg, { trueColours });
      applyTier();
      if (opts.backdrop !== false) void sky.show(chooseBackdrop(lookFile, hour, trueColours), cfg).then(() => { applyLighting(); }).catch(() => {});
      scheduleCube();
    },
    refresh(g) {
      grid = g;
      rebuildAo(g);
      applyShadowFlags();
      needsShadowRefresh();
      scheduleCube();
    },
    setScanVisible(v) {
      if (scanVisible === v) return;
      scanVisible = v;
      if (!v && opts.hasSplat) postAllowed = true;
      materials.setPlain(v);
      applyTier();
      notify();
    },
    materials: () => materials,
    stats() {
      const info = renderer.info;
      return {
        tier, fps: viewer.fps, drawCalls: info.render.calls, triangles: info.render.triangles,
        textures: info.memory.textures, bytesLoaded: loader.bytes,
      };
    },
    attach(p) {
      parts = { ...parts, ...p };
      applyShadowFlags();
      needsShadowRefresh();
    },
    setLayout(l, g) {
      layout = l;
      materials.setWallHeight(l.wallHeightM);
      reflections.setLayout(l);
      if (g) { grid = g; rebuildAo(g); }
      applyLighting();
      scheduleCube();
    },
    windowFraction() {
      const panes = parts.shell?.getObjectByName('panes') as THREE.Mesh | undefined;
      if (!panes || !panes.visible) return 0;
      const pos = panes.geometry.getAttribute('position');
      camera.updateMatrixWorld();
      let best = 0;
      const v = new THREE.Vector3();
      for (let q = 0; q + 5 < pos.count; q += 6) {
        let x0 = 2, x1 = -2, y0 = 2, y1 = -2, behind = false;
        for (let k = 0; k < 6; k++) {
          v.fromBufferAttribute(pos, q + k).project(camera);
          if (v.z > 1 || v.z < -1) { behind = true; break; }
          x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
        }
        if (behind) continue;
        const w = Math.max(0, Math.min(1, x1) - Math.max(-1, x0));
        const h = Math.max(0, Math.min(1, y1) - Math.max(-1, y0));
        best = Math.max(best, (w * h) / 4);
      }
      return best;
    },
    onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    debug: {
      reflections,
      get post() { return post; },
      renderNow() {
        if (viewer.renderOverride) viewer.renderOverride(0.016);
        else renderer.render(scene, camera);
      },
      sample(x0, y0, x1, y1) {
        const px = readRect(x0, y0, x1, y1);
        let r = 0, g = 0, b = 0;
        const n = px.length / 4;
        for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
        return [r / n, g / n, b / n];
      },
      sampleStd(x0, y0, x1, y1) {
        const px = readRect(x0, y0, x1, y1);
        const n = px.length / 4;
        let s = 0, s2 = 0;
        for (let i = 0; i < px.length; i += 4) { const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; s += l; s2 += l * l; }
        const m = s / n;
        return Math.sqrt(Math.max(0, s2 / n - m * m));
      },
      project(x, y, z) {
        camera.updateMatrixWorld();
        const v = new THREE.Vector3(x, y, z).project(camera);
        if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
        const r = viewer.canvas.getBoundingClientRect();
        return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
      },
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offFrame();
      offAo();
      if (cubeTimer) clearTimeout(cubeTimer);
      viewer.setRenderOverride(null);
      post?.dispose();
      post = null;
      reflections.dispose();
      sky.dispose();
      materials.dispose();
      loader.dispose();
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.shadowMap.enabled = false;
      renderer.info.autoReset = true;
      sunLight.castShadow = false;
      scene.remove(sunLight.target);
      hemi.color.copy(oldLights.hemiColour); hemi.groundColor.copy(oldLights.hemiGround); hemi.intensity = oldLights.hemiIntensity;
      sunLight.color.copy(oldLights.sunColour); sunLight.intensity = oldLights.sunIntensity; sunLight.position.copy(oldLights.sunPosition);
      scene.background = oldLights.background;
      scene.environment = null;
      listeners.clear();
    },
  };

  /** Re-renders, then reads a rectangle of the default framebuffer (valid until the browser composites). */
  function readRect(x0: number, y0: number, x1: number, y1: number): Uint8Array {
    look.debug.renderNow();
    const canvas = viewer.canvas;
    const sx = canvas.width / canvas.clientWidth;
    const sy = canvas.height / canvas.clientHeight;
    const gx0 = Math.max(0, Math.floor(Math.min(x0, x1) * sx));
    const gx1 = Math.min(canvas.width, Math.ceil(Math.max(x0, x1) * sx));
    const gy0 = Math.max(0, Math.floor(Math.min(y0, y1) * sy));
    const gy1 = Math.min(canvas.height, Math.ceil(Math.max(y0, y1) * sy));
    const w = Math.max(1, gx1 - gx0);
    const h = Math.max(1, gy1 - gy0);
    const out = new Uint8Array(w * h * 4);
    const gl = renderer.getContext();
    gl.readPixels(gx0, canvas.height - gy1, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }

  // ---- start
  applyTier();
  readyPromise = loadForTier();
  if (quality === 'auto') void readyPromise.then(() => { if (!disposed && quality === 'auto') { watch.setTarget(cfg.fpsTarget); bench = new FrameTimer(40); } });
  return look;
}
