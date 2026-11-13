// Owned by C11a. SPEC 16.5 "The controller": lighting, tone mapping, sun, sky, shadows, reflections, post-processing and the
// quality tier, behind one object. C11b (furniture models, character) and C11c (painterly) extend it through the hooks marked below.
import * as THREE from 'three';
import type { Viewer } from '../engine/viewer';
import type { Finishes, Grid, Layout } from '../types';
import { AssetLoader } from './assets';
import { buildAoField } from './floor-ao';
import { DEFAULT_PRESET, PRESET_HOURS, TRUE_GRADE, clampDayHour, gradeAt, parsePreset, presetOfHour } from './grade';
import type { Grade, InteriorLightKind, LookPreset } from './grade';
import { InteriorLights } from './interior';
import { createLookMaterials } from './materials';
import type { LookMaterials } from './materials';
import { createPostChain } from './post';
import type { PostChain } from './post';
import { FpsWatch, FrameTimer, TIERS, lowerTier, loadSavedTier, readDevice, guessTier, saveTier, stepDown, tierFromQuery, toneMapperFromQuery } from './quality';
import type { TierConfig, ToneMapperName } from './quality';
import { Reflections } from './reflect';
import { Sky, chooseBackdrop } from './sky';
import { sunState } from './sun';
import type { SunState } from './sun';
import { parseLookFile } from './types';
import type { LookFile, Tier } from './types';

export type { Tier } from './types';
export type { LookFile } from './types';
export type { LookPreset, InteriorLightKind } from './grade';

export type QualityMode = 'auto' | Tier;

export interface LookStats { tier: Tier; fps: number; drawCalls: number; triangles: number; textures: number; bytesLoaded: number }

export interface Look {
  readonly tier: Tier;
  setTier(t: Tier): Promise<void>;
  /** 6..21 (the sun is modelled to 19:00, after that it is Night) */ setHour(h: number): void;
  /** morning, afternoon, evening or night (an hour of the same slider); leaves True colours */
  setPreset(p: LookPreset): void;
  /** the preset the hour sits on, or null between two of them */
  readonly preset: LookPreset | null;
  /** the grade in force: exposure, sky, light colours, how far the interior lights are on */
  grade(): Grade;
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
  /** C11c: while `fn` is set it draws every frame instead of the look's own render path (the painting). `null` hands the frame back. */
  holdFrame(fn: ((dt: number) => void) | null): void;
  /**
   * Interior lights (SPEC 16.5). A fixture is any object whose `userData.walkthruLight` is 'tube' | 'cove' | 'fan' | 'lamp'.
   * Meshes have their emissive intensity driven, THREE.Lights their intensity, and a small pool of real point lights follows the
   * walker to the nearest fixtures. This call tags `obj` for you and rescans.
   */
  registerInteriorLight(obj: THREE.Object3D, kind: InteriorLightKind): void;
  /** rescan the scene parts for tagged fixtures (attach(), refresh() and setLayout() do it too) */
  refreshInteriorLights(): void;
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
  interior: InteriorLights;
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
/** SPEC 16.5: hemisphere "intensity 1.0" in the spec's units. three's lights are scaled by pi, so 1.0 shows a surface at its own colour. */
const TRUE_COLOUR_HEMI = Math.PI;
const EXPOSURE_TRUE = 1.0;
/** the hemisphere intensities in grade.ts are for this tier value (medium and high); low is scaled from it */
const HEMI_REFERENCE = 1.25;

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
  const toneMapper: ToneMapperName = toneMapperFromQuery(typeof location !== 'undefined' ? location.search : '');
  const queryPreset = (() => { try { return parsePreset(new URLSearchParams(location.search).get('preset')); } catch { return null; } })();
  let hour = clampDayHour(lookFile?.hour ?? PRESET_HOURS[queryPreset ?? lookFile?.preset ?? DEFAULT_PRESET]);
  let grade: Grade = gradeAt(hour);
  let skyKey = '';
  const interior = new InteriorLights(scene, layout);
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
  let held: ((dt: number) => void) | null = null;

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

  function shadowsOn(): boolean {
    return cfg.shadow !== 'none' && !trueColours && !scanVisible;
  }

  function needsShadowRefresh(): void {
    if (cfg.shadow === 'static') renderer.shadowMap.needsUpdate = true;
  }

  const threeToneMapping = (): THREE.ToneMapping => (toneMapper === 'aces' ? THREE.ACESFilmicToneMapping : toneMapper === 'neutral' ? THREE.NeutralToneMapping : THREE.AgXToneMapping);
  const tmp = new THREE.Color();
  const floorLinear = new THREE.Color();
  const WARM_AMBIENT = new THREE.Color('#FFD2A0');

  /** the vignette is a CSS gradient over the canvas: free on every tier, and it never touches the canvas pixels */
  const vignette = opts.backdrop === false || typeof document === 'undefined' || !viewer.canvas.parentElement ? null : (() => {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.dataset.testid = 'look-vignette';
    el.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1;opacity:0;transition:opacity .4s;background:radial-gradient(ellipse 78% 74% at 50% 50%, rgba(36,18,6,0) 52%, rgba(36,18,6,.95) 100%)';
    viewer.canvas.parentElement.insertBefore(el, viewer.canvas.nextSibling);
    return el;
  })();

  /** the sky the window shows: the plain graded one (or the broker's own backdrop picture from look.json) */
  function syncSky(force = false): void {
    if (opts.backdrop === false || scanVisible) return;
    const bd = chooseBackdrop(lookFile, hour, trueColours);
    const key = bd ? `pic|${bd}|${cfg.hdri}` : `plain|${trueColours ? 'true' : hour.toFixed(2)}|${cfg.environment}`;
    if (!force && key === skyKey) return;
    skyKey = key;
    if (bd) void sky.show(bd, cfg).catch((e) => console.warn('[walkthru] backdrop not loaded', e));
    else sky.showPlain(grade.sky, grade.night ? 14 : sun.elevationDeg, cfg);
  }

  function applyLighting(): void {
    sun = sunState(layout, lookFile, hour);
    grade = trueColours ? TRUE_GRADE : gradeAt(hour);
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
      interior.setGrade(TRUE_GRADE);
      if (vignette) vignette.style.opacity = '0';
      return;
    }
    if (trueColours) {
      hemi.color.set('#ffffff'); hemi.groundColor.set('#ffffff'); hemi.intensity = TRUE_COLOUR_HEMI;
      sunLight.visible = false; sunLight.intensity = 0; sunLight.castShadow = false;
      scene.environmentIntensity = 0;
    } else {
      const g = grade;
      // sky half: the preset's sky light. Ground half: bounce off the floor, so it carries the floor's own colour and the sun's tint
      floorLinear.set(layout.finishes.floorColor);
      tmp.setRGB(g.sunColour[0], g.sunColour[1], g.sunColour[2]);
      hemi.color.setRGB(g.hemiSky[0], g.hemiSky[1], g.hemiSky[2]).multiplyScalar(cfg.skyScale);
      hemi.groundColor.setRGB(g.hemiGround[0], g.hemiGround[1], g.hemiGround[2]);
      if (!g.night) hemi.groundColor.lerp(tmp.multiply(floorLinear).multiplyScalar(1.4), 0.25);
      hemi.groundColor.multiplyScalar(cfg.groundScale);
      hemi.intensity = g.hemiIntensity * (cfg.hemiIntensity / HEMI_REFERENCE);
      // tiers with no grade pass (low and medium: no post chain) get the sun's warmth through the sky half of the ambient instead
      if (!post && !g.night) hemi.color.lerp(tmp.setRGB(g.sunColour[0], g.sunColour[1], g.sunColour[2]), cfg.shadow === 'none' ? 0.3 : 0.18);
      // a tier with no pooled lights fakes the lamps with a warm lift of the ambient
      // the room lights are on at night: every tier gets a warm ambient fill (a lit Indian room is evenly bright, tube lights are
      // diffuse); tiers with pooled point lights need less of it because the pools add the local pools of light
      const lamps = Math.max(g.interior.tube, g.interior.cove);
      if (lamps > 0) {
        const pooled = cfg.interiorLights > 0;
        hemi.color.lerp(WARM_AMBIENT, (pooled ? 0.25 : 0.35) * lamps);
        hemi.groundColor.lerp(WARM_AMBIENT, (pooled ? 0.25 : 0.3) * lamps);
        hemi.intensity *= 1 + (pooled ? 2.2 : 2.8) * lamps;
      }
      const sunOn = !g.night && g.sunIntensity > 0.01;
      sunLight.visible = sunOn;
      sunLight.color.setRGB(g.sunColour[0], g.sunColour[1], g.sunColour[2]);
      sunLight.intensity = g.sunIntensity * cfg.sunScale;
      scene.environmentIntensity = cfg.envIntensity * g.envScale;
      sunLight.castShadow = shadowsOn() && sunOn;
      fitShadow();
    }
    // low is a touch brighter: with no sun patch and no real lights it has less to show
    const exposure = grade.exposure * (cfg.tier === 'low' && !trueColours ? 1.12 : 1);
    // "True colours" is no tone mapping at all: nothing in it is brighter than its own colour, so surfaces show it exactly
    renderer.toneMapping = post || trueColours ? THREE.NoToneMapping : threeToneMapping();
    renderer.toneMappingExposure = exposure;
    post?.setToneMapping(!trueColours, toneMapper);
    if (post && !trueColours) post.setGrade({ exposure, whiteBalance: grade.post.whiteBalance, saturation: grade.post.saturation, contrast: grade.post.contrast, shadowTint: grade.post.shadowTint, highlightTint: grade.post.highlightTint, bloom: cfg.bloom ? grade.post.bloom : 0 });
    else post?.setExposure(exposure);
    sky.setExposure(exposure);
    sky.setSunAzimuth(sun.planAzimuthDeg);
    syncSky();
    interior.setGrade(grade);
    // look-kit's fixtures (mountKit) switch on with the evening and the night: tube and fan at the tube level, cove at its own
    const kit = (globalThis as { __walkthruKit?: { setLit?: (kind: string, on: boolean) => void } }).__walkthruKit;
    if (kit?.setLit) { const on = !trueColours && !scanVisible; kit.setLit('tube', on && grade.interior.tube > 0.2); kit.setLit('fan', on && grade.interior.tube > 0.2); kit.setLit('cove', on && grade.interior.cove > 0.2); }
    // low tiers have no post chain to carry the vignette, so it is the CSS one on all of them
    if (vignette) vignette.style.opacity = trueColours ? '0' : String(grade.vignette);
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
    sunLight.shadow.radius = cfg.shadow === 'live' ? 4 : 2;
    renderer.shadowMap.autoUpdate = cfg.shadow === 'live';
    if (cfg.shadow !== 'none') {
      if (sunLight.shadow.mapSize.x !== cfg.shadowMapSize) {
        sunLight.shadow.mapSize.set(cfg.shadowMapSize, cfg.shadowMapSize);
        sunLight.shadow.map?.dispose();
        sunLight.shadow.map = null;
      }
    }
    if (prevType !== renderer.shadowMap.type || wasEnabled !== renderer.shadowMap.enabled) setMaterialsDirty();
    interior.setPoolSize(cfg.interiorLights);
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
        postLoading = createPostChain(viewer, { exposure: trueColours ? EXPOSURE_TRUE : grade.exposure, bloom: cfg.bloom, mapper: toneMapper })
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
    renderer.toneMapping = scanVisible || usePost || trueColours ? THREE.NoToneMapping : threeToneMapping();
    reflections.setMode(wantReflection);
    if (held) viewer.setRenderOverride(held);
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
      skyKey = '';
      const jobs: Promise<unknown>[] = [
        materials.loadTextures(loader, cfg).catch((e) => console.warn('[walkthru] textures not loaded', e)),
      ];
      if (cfg.post) {
        applyRenderPath();
        if (postLoading) jobs.push(postLoading);
      }
      await Promise.all(jobs);
      if (disposed || my !== tier) return;
      materials.configure(cfg, { trueColours });
      syncSky(true);
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
  const offFrame = viewer.onFrame((frameDt) => {
    renderer.info.reset();
    if (!disposed && !scanVisible) interior.update(frameDt, { x: camera.position.x, z: camera.position.z });
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
    get preset() { return presetOfHour(hour); },
    grade: () => grade,
    setHour(h) {
      hour = clampDayHour(h);
      applyLighting();
      scheduleCube();
      notify();
    },
    setPreset(p) {
      if (trueColours) look.setTrueColours(false);
      look.setHour(PRESET_HOURS[p]);
    },
    setTrueColours(on) {
      trueColours = on;
      materials.configure(cfg, { trueColours });
      applyTier();
      scheduleCube();
      notify();
    },
    registerInteriorLight(obj, kind) { interior.register(obj, kind); interior.scan(true); },
    refreshInteriorLights() { interior.scan(true); },
    refresh(g) {
      grid = g;
      rebuildAo(g);
      applyShadowFlags();
      needsShadowRefresh();
      scheduleCube();
      interior.scan(true);
    },
    setScanVisible(v) {
      if (scanVisible === v) return;
      scanVisible = v;
      skyKey = '';
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
      interior.setRoots([parts.shell, parts.furnitureRoot]);
      applyShadowFlags();
      needsShadowRefresh();
    },
    setLayout(l, g) {
      layout = l;
      materials.setWallHeight(l.wallHeightM);
      reflections.setLayout(l);
      interior.setLayout(l);
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
    holdFrame(fn) {
      held = fn;
      if (vignette) vignette.style.display = fn ? 'none' : '';
      applyRenderPath();
    },
    debug: {
      reflections,
      get post() { return post; },
      interior,
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
      interior.dispose();
      vignette?.remove();
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
