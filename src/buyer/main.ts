// Owned by C3. The buyer page: boot (B1 loading), height picker (B2), the walking loop (B3), debug hooks.
import * as THREE from 'three';
import { catalogItem, itemFromCatalog } from '../core/catalog';
import { circleFree, nearestFree } from '../core/grid-query';
import { carpetAreaM2, roomAt } from '../core/layout-geom';
import { validateLayout, validateProperty } from '../core/layout-validate';
import { rasterizeLayout } from '../core/layout-raster';
import { buildShell } from '../engine/shell';
import { createViewer } from '../engine/viewer';
import type { Viewer, SplatHandle } from '../engine/viewer';
import { Character } from '../engine/character';
import { rebuildFurnitureTier, setFurnitureDefaults } from '../engine/furniture';
import { applyDesigns, buildDecor, fetchDesigns } from '../look/designs';
import type { Decor } from '../look/designs';
import { furnitureKit } from '../look/furniture-materials';
import { prefetchPerson } from '../look/people';
import { tierFromQuery } from '../look/quality';
import { CHARACTER_URL } from '../types';
import { createLook, fetchLookFile } from '../look/look';
import type { Look } from '../look/look';
import { mountLookPanel } from '../look/look-panel';
import { createInput } from '../engine/controls';
import { FollowCamera } from '../engine/camera';
import { stepLocomotion } from '../engine/locomotion';
import { CHARACTER_RADIUS_M } from '../types';
import { loadPerson, savePerson } from './person-store';
import type { PropertyFile, Vec2 } from '../types';
import { ModeManager, createBuyerContext } from './context';
import type { BuyerContext, BuyerModeId } from './context';
import { createFurnishMode } from './furnish';
import { createGridOverlay } from './debug';
import type { GridOverlay } from './debug';
import { createHeightPicker } from './height';
import { createHud } from './hud';
import { createInteractions } from './interactions';
import { buildSeats } from './seats';
import { createWardrobes } from './wardrobe';
import { createLoadingScreen } from './loading';
import { createMeasureMode } from './measure';
import { createOverlays } from './overlays';
import { createRoomsSheet, sizesNote } from './rooms';
import { mountSceneTag, sceneTagText } from './scene-tag';
import {
  HINT_KEY, clampHeightCm, createFurnitureStore, distanceToBox, roomChipText, safeStorage,
  standardHeightNote, storageGet, storageSet, tintForHeightCm, unverifiedRoomsFromExtras,
} from './store';

const SCENE_ID_RE = /^[a-z0-9-]{1,40}$/;

// ---------------------------------------------------------------- loading the property

type PropertyResult = { kind: 'ok'; property: PropertyFile } | { kind: 'missing' };

async function fetchProperty(sceneId: string): Promise<PropertyResult> {
  if (!SCENE_ID_RE.test(sceneId)) return { kind: 'missing' };
  let res: Response;
  try {
    res = await fetch(`/scenes/${sceneId}/property.json`, { cache: 'no-cache' });
  } catch (err) {
    throw new Error(`Could not reach the server (${String(err)}).`);
  }
  if (res.status === 404) return { kind: 'missing' };
  if (!res.ok) throw new Error(`The server answered HTTP ${res.status} for this home.`);
  const text = await res.text();
  // a dev server answers a missing file with its index page
  if (/^\s*</.test(text)) return { kind: 'missing' };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('property.json is not valid JSON.');
  }
  return { kind: 'ok', property: validateProperty(json) };
}

/** The optional drawing-import sidecar: which rooms are not measured. Missing, HTML or broken means nothing is flagged. */
async function fetchExtras(sceneId: string): Promise<ReturnType<typeof unverifiedRoomsFromExtras>> {
  try {
    if (!SCENE_ID_RE.test(sceneId)) return {} as ReturnType<typeof unverifiedRoomsFromExtras>;
    const r = await fetch(`/scenes/${sceneId}/proposal-extras.json`, { cache: 'no-cache' });
    const t = r.ok ? await r.text() : '';
    if (t && !/^\s*</.test(t)) return unverifiedRoomsFromExtras(JSON.parse(t));
  } catch { /* optional */ }
  return {} as ReturnType<typeof unverifiedRoomsFromExtras>;
}

// ---------------------------------------------------------------- page boot

const params = new URLSearchParams(location.search);
const sceneId = (params.get('scene') ?? 'test-flat-empty').trim();
const debug = params.get('debug') === '1';
const storage = safeStorage();
const isTouch = ((): boolean => {
  try { return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0; } catch { return false; }
})();

const loading = createLoadingScreen(document.body);
let booted = false;

function describe(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  return String(err);
}

function showFatalBanner(text: string): void {
  let b = document.querySelector<HTMLElement>('.wt-fatal');
  if (!b) {
    b = document.createElement('div');
    b.className = 'wt-fatal';
    b.addEventListener('click', () => { b!.hidden = true; });
    document.body.appendChild(b);
  }
  b.textContent = `${text}\n(tap to dismiss)`;
  b.hidden = false;
}

const BENIGN = /ResizeObserver loop/i;
window.addEventListener('error', (e) => {
  if (BENIGN.test(e.message)) return;
  console.error('[walkthru] uncaught error', e.error ?? e.message);
  const msg = e.error ? describe(e.error) : e.message;
  if (!booted) loading.showError('Something went wrong', msg);
  else showFatalBanner(msg);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[walkthru] unhandled rejection', e.reason);
  const msg = describe(e.reason);
  if (!booted) loading.showError('Something went wrong', msg);
  else showFatalBanner(msg);
});

/** Which body file to start fetching before the GL context says which tier this is: a guess, a wrong one only costs the lighter file. */
function guessedBodyTier(): 'low' | 'medium' {
  const forced = tierFromQuery(location.search);
  if (forced) return forced === 'low' ? 'low' : 'medium';
  const mem = (navigator as { deviceMemory?: number }).deviceMemory;
  return isTouch || (mem !== undefined && mem <= 4) ? 'low' : 'medium';
}

async function boot(): Promise<void> {
  // C11b: the body, its clips and the drawing's designs download while the layout and the look start up
  const early = loadPerson(storage);
  prefetchPerson(early.body, guessedBodyTier());
  const designsP = fetchDesigns(sceneId);
  // the small optional JSON files go out together with property.json instead of one after another
  const lookFileP = fetchLookFile(sceneId);
  const extrasP = fetchExtras(sceneId);
  loading.setProgress(0.05, 'Loading the layout…');
  const result = await fetchProperty(sceneId);
  if (result.kind === 'missing') {
    loading.showNotSetUp(sceneId);
    return;
  }
  const property = result.property;
  document.title = `${property.title} · walkthru`;
  loading.setTitle(property.title, property.subtitle);
  loading.setNote(sizesNote(property.layout));
  loading.setProgress(0.12, 'Building the rooms…');
  const layout = property.layout;
  // Optional drawing-import sidecar: rooms whose size came from a label, not measured walls, must not show a
  // confident area. Missing file (or a dev server's index page) means nothing is flagged.
  const unverifiedRooms = await extrasP;
  if (layout.rooms.length === 0) {
    loading.showError('This home has no rooms yet.', 'The layout is empty. A broker can trace the rooms in the editor.');
    return;
  }
  const check = validateLayout(layout);
  for (const w of check.warnings) console.warn(`[walkthru] layout warning: ${w}`);
  for (const e of check.errors) console.error(`[walkthru] layout error: ${e}`);

  // ---- viewer, shell, grid
  const app = document.getElementById('app');
  if (!app) throw new Error('index.html has no #app element.');
  let viewer: Viewer;
  try {
    viewer = createViewer(app, { hasSplat: !!property.splat });
  } catch (err) {
    loading.showError('Could not start 3D.', `${describe(err)}\nTry another browser, or turn on hardware acceleration.`);
    return;
  }
  // the look (C11a): lights, tone mapping, materials, backdrop. It never blocks boot: assets arrive after first paint.
  let look: Look | null = null;
  try {
    look = await createLook(viewer, layout, await lookFileP, { hasSplat: !!property.splat });
  } catch (err) {
    console.warn('[walkthru] the look could not start, using the plain scene:', err);
  }
  const shell = buildShell(layout, look ? { materials: look.materials() } : undefined);
  viewer.scene.add(shell);
  const furnitureRoot = new THREE.Group();
  furnitureRoot.name = 'furniture';
  viewer.scene.add(furnitureRoot);
  const baseGrid = rasterizeLayout(layout);
  // C11b: the real-looking furniture at the same exact sizes (SPEC 16.6.5). A scene's drawing (designs.json) may set drawn
  // heights and finish details; boxes are never changed. Textures arrive after first paint.
  const designs = await designsP;
  const startTier = look?.tier ?? 'medium';
  setFurnitureDefaults({ style: 'real', tier: startTier });
  void furnitureKit.setTier(startTier).catch((err) => console.warn('[walkthru] furniture textures not loaded', err));
  const initialItems = applyDesigns(property.furniture, designs);
  const store = createFurnitureStore({ sceneId, baseGrid, initial: initialItems, parent: furnitureRoot, storage });
  const decor: Decor[] = buildDecor(designs, store.all(), startTier);
  for (const d of decor) furnitureRoot.add(d.group);
  // the drawing's chairs are sittable and block the walk grid (src/buyer/seats.ts)
  const seats = buildSeats(designs, store.all());
  store.setTemporary('seats', seats.obstacles());
  if (look) {
    const lk = look;
    lk.attach({ shell, furnitureRoot });
    lk.refresh(store.grid());
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    store.onChange(() => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { refreshTimer = null; lk.refresh(store.grid()); }, 80);
    });
  }
  loading.setProgress(0.3, 'Loading the walker…');

  // ---- character
  let person = loadPerson(storage);
  let character: Character;
  try {
    // SPEC 16.6: a person body; the mannequin is the fallback when a body file is missing (route C)
    try {
      character = await Character.load(CHARACTER_URL, { body: person.body, tone: person.tone, tier: startTier });
    } catch (err) {
      console.error('[walkthru] the person body could not be loaded, using the mannequin:', err);
      character = await Character.load();
    }
  } catch (err) {
    loading.showError('Could not load the walking figure.', describe(err));
    return;
  }
  viewer.scene.add(character.object);
  if (property.splat) character.setShadowVisible(false); // SPEC 12 risk 2: no alpha-blended shadow against a splat
  look?.attach({ character: { object: character.object, setBlobVisible: (v) => character.setShadowVisible(v && !property.splat) } });
  // the sofa seat height lets a tall person sit with raised knees instead of floating (look/character: sitPlan)
  character.surfaceProbe = (x, z) => {
    for (const it of store.all()) if (it.kind === 'sofa' && distanceToBox({ x, z }, it.box) <= 0.05) return it.surfaceHeightM;
    return seats.surfaceAt({ x, z });
  };
  character.onRebind = () => look?.refresh(store.grid());
  if (look) {
    // a tier change rebuilds the furniture for it and swaps the body between its full and low files
    let seenTier = startTier;
    look.onChange(() => {
      const t = look!.tier;
      if (t === seenTier) return;
      seenTier = t;
      void furnitureKit.setTier(t).then(() => {
        rebuildFurnitureTier(furnitureRoot, t);
        for (const d of decor) d.rebuild(t);
        look!.refresh(store.grid());
      });
      void character.setAppearance({ tier: t }).catch((err) => console.warn('[walkthru] body for this tier not loaded', err));
    });
  }
  loading.setProgress(0.85, 'Almost there…');

  // ---- HUD, input, camera, overlays, modes, context
  const input = createInput(viewer.canvas);
  const camera = new FollowCamera(viewer.camera, () => store.grid(), layout.wallHeightM);
  const overlays = createOverlays(viewer.scene);
  const modes = new ModeManager();

  let picker: ReturnType<typeof createHeightPicker>;
  let rooms: ReturnType<typeof createRoomsSheet>;
  let scanHandle: SplatHandle | null = null;
  let scanVisible = false;

  const hud = createHud(document.body, {
    person: () => picker.open(false),
    measure: () => toggleMode('measure'),
    furnish: () => toggleMode('furnish'),
    rooms: () => rooms.toggle(),
    scan: () => setScan(!scanVisible),
  });
  hud.setVisible(false);
  const tagText = sceneTagText(property);
  if (tagText) mountSceneTag(hud.root, tagText);
  // C11c: the painterly mode is a lazy chunk, fetched only when the buyer taps "Show as a painting"
  type PaintSession = import('../look/painterly/index').PaintingSession;
  let painting: PaintSession | null = null;
  let paintOpening = false;
  async function openPainterly(): Promise<PaintSession | null> {
    if (!look || painting?.active || paintOpening) return painting;
    paintOpening = true;
    hud.root.querySelector<HTMLElement>('.wt-look-x')?.click();
    try {
      const mod = await import('../look/painterly/index');
      const head = new THREE.Vector3(character.position.x, Math.max(0.5, character.heightM * 0.8), character.position.z);
      const s = await mod.openPainting({
        viewer, look, shell, furnitureRoot, layout, title: property.title, host: document.body, focus: head,
        character: { object: character.object, tone: character.appearance.tone },
        setBusy: (on) => { paintBusy = on; hud.setVisible(!on); },
        toast: (t) => hud.toast(t),
      });
      painting = s.active ? s : null;
      return s;
    } catch (err) {
      console.warn('[walkthru] painterly mode could not start:', err);
      hud.toast('The painting is not available on this device.');
      paintBusy = false;
      hud.setVisible(true);
      return null;
    } finally {
      paintOpening = false;
    }
  }
  let paintBusy = false;
  if (look) mountLookPanel(hud.root, look, { toast: (t) => hud.toast(t), onPainterly: () => { void openPainterly(); } });

  const ctx: BuyerContext = createBuyerContext({ viewer, property, character, input, camera, hud, overlays, furniture: store, shell, furnitureRoot, modes });
  // openable wardrobes (drawn from designs.json, or catalogue): shutters, swing arcs, walking space
  const wardrobes = createWardrobes({ ctx, store, designs, parent: furnitureRoot });
  const interactions = createInteractions(ctx, { wardrobe: wardrobes, seats, cardNote: (item) => standardHeightNote(item, designs) });
  modes.register({ id: 'walk', enter() {}, exit() {}, update() {} });
  modes.register(interactions.mode);
  modes.register(createMeasureMode(ctx));
  modes.registerLazy('furnish', () => createFurnishMode(ctx));
  modes.onError = (id, err) => {
    const m = describe(err);
    console.warn(`[walkthru] mode "${id}" unavailable:`, err);
    hud.toast(/not implemented/i.test(m) ? 'Furnishing is not available in this build yet.' : `Could not open ${id} mode: ${m}`);
  };
  modes.onChange((id, prev) => {
    hud.setActive('measure', id === 'measure');
    hud.setActive('furnish', id === 'furnish');
    if (prev === 'furnish') { input.setInteractKeyMode('interact'); input.claimPointer(null); }
    if (id === 'walk') hud.setModeBar(null);
  });

  function toggleMode(id: BuyerModeId): void {
    if (blocking()) return;
    modes.set(modes.id === id ? 'walk' : id);
  }

  // ---- height
  function applyHeight(cm: number): number {
    const v = clampHeightCm(cm);
    character.setHeight(v / 100, tintForHeightCm(v));
    person = { ...person, heightCm: v };
    savePerson(storage, person);
    picker?.sync(v);
    interactions.refresh();
    return v;
  }
  /** body and skin tone (SPEC 16.6.4); the new body is fetched only now, and swapped in place */
  function applyPerson(next: { body: 'male' | 'female'; tone: number }): Promise<void> {
    person = { ...person, body: next.body, tone: next.tone };
    savePerson(storage, person);
    picker?.syncPerson(next);
    return character.setAppearance({ body: next.body, tone: next.tone }).then(() => {
      character.setHeight(heightCm / 100, tintForHeightCm(heightCm));
      interactions.refresh();
    });
  }
  let heightCm = person.heightCm;
  character.setHeight(heightCm / 100, tintForHeightCm(heightCm));

  const blocking = (): boolean => picker.isOpen() || rooms.isOpen() || paintBusy;

  picker = createHeightPicker(document.body, {
    getCm: () => heightCm,
    onChange: (cm) => { heightCm = applyHeight(cm); },
    person: { get: () => ({ body: person.body, tone: person.tone }), onChange: (p) => { void applyPerson(p); } },
    onClose: () => {
      savePerson(storage, person);
      hud.setVisible(true);
      if (storageGet(storage, HINT_KEY) === null) {
        storageSet(storage, HINT_KEY, '1');
        hud.hint(isTouch ? 'Left thumb to walk · right thumb to look' : 'WASD to walk · drag to look · E to interact', 4000);
      }
    },
  });
  rooms = createRoomsSheet(document.body, layout, () => { /* nothing to resume */ }, unverifiedRooms);

  // ---- spawn
  {
    const sp = property.spawn;
    let at: Vec2 = { x: sp.x, z: sp.z };
    const g = store.grid();
    if (!circleFree(g, at.x, at.z, CHARACTER_RADIUS_M)) {
      const free = nearestFree(g, at.x, at.z, CHARACTER_RADIUS_M, 4);
      if (free) at = free; else console.warn('[walkthru] the spawn point is not on a free cell and none is near it');
    }
    character.position = at;
    character.yawDeg = sp.yawDeg;
    camera.yawDeg = sp.yawDeg;
    camera.setTarget(at, character.heightM);
  }

  // ---- input events
  input.on('interact', () => { if (!blocking()) void interactions.interact(); });
  input.on('measure', () => toggleMode('measure'));
  input.on('furnish', () => toggleMode('furnish'));
  input.on('cancel', () => {
    if (blocking()) return;
    const m = modes.id;
    if (m === 'pose') void interactions.getUp();
    else if (m === 'measure' || m === 'furnish') modes.set('walk');
    else interactions.hideDims();
  });

  // ---- scan overlay (optional, loads in the background)
  function setScan(v: boolean): void {
    if (!scanHandle || !property.splat) return;
    scanVisible = v;
    scanHandle.setVisible(v);
    shell.visible = !(property.splat.mode === 'replace' && v);
    look?.setScanVisible(v); // rule 5 of SPEC 16.2: with a scan shown the look steps back
    hud.setScanButton(v ? 'on' : 'off');
  }
  async function loadScan(): Promise<void> {
    const splat = property.splat;
    if (!splat) return;
    hud.setScanButton('loading', 0);
    const url = `/scenes/${sceneId}/${splat.file}`;
    try {
      try {
        const head = await fetch(url, { method: 'HEAD' });
        const type = head.headers.get('content-type') ?? '';
        if (head.status === 404 || (head.ok && /text\/html/i.test(type))) throw new Error(`the scan file ${splat.file} was not found`);
      } catch (err) {
        if (err instanceof Error && /was not found/.test(err.message)) throw err;
        // HEAD refused or the network hiccuped: let the loader try
      }
      scanHandle = await viewer.loadSplat(url, splat.transform, (f) => hud.setScanButton('loading', f));
      setScan(true);
    } catch (err) {
      console.warn('[walkthru] scan not loaded:', err);
      hud.setScanButton('hidden');
      hud.toast('The 3D scan could not be loaded. Showing the clean layout.');
    }
  }
  void loadScan();

  // ---- debug overlay
  let gridOverlay: GridOverlay | null = null;
  let gridDirty = false;
  if (debug) {
    gridOverlay = createGridOverlay(viewer.scene, store.grid());
    store.onChange(() => { gridDirty = true; });
  }

  // ---- the frame loop
  const ZERO_LOOK = { dx: 0, dy: 0, zoom: 0 };
  let chipClock = 0;
  let lastChip: string | null | undefined;
  let debugClock = 0;
  let gridClock = 0;
  viewer.onFrame((dt) => {
    const look = input.takeLook();
    const blocked = blocking();
    if (blocked) {
      if (character.state === 'walk' || character.state === 'jog') character.setLocomotion(0, false);
    } else if (modes.id !== 'pose') {
      stepLocomotion(character, input, camera.viewYawDeg, store.grid(), dt);
    }
    modes.update(dt);
    interactions.update(dt);
    wardrobes.update(dt);
    character.update(dt);
    camera.setTarget(character.position, character.heightM);
    camera.update(dt, blocked ? ZERO_LOOK : look);
    // below a 0.7 m boom the character is hidden, above 0.8 m it comes back (SPEC 2.4)
    if (camera.boom < 0.7) character.setVisible(false);
    else if (camera.boom > 0.8) character.setVisible(true);
    hud.setJoystick(input.joystick);

    chipClock += dt;
    if (chipClock > 0.1) {
      chipClock = 0;
      const text = roomChipText(layout, character.position, unverifiedRooms);
      if (text !== lastChip) { lastChip = text; hud.setRoomChip(text); }
    }
    if (gridOverlay) {
      gridClock += dt;
      if (gridDirty && gridClock > 0.25) { gridDirty = false; gridClock = 0; gridOverlay.update(store.grid()); }
      debugClock += dt;
      if (debugClock > 0.25) {
        debugClock = 0;
        const s = snapshot();
        hud.setDebug(
          `fps ${s.fps.toFixed(0)}  mode ${s.mode}  state ${s.charState}\n` +
          `pos ${s.pos.x.toFixed(2)}, ${s.pos.z.toFixed(2)}  yaw ${s.yawDeg.toFixed(0)}  boom ${s.boom.toFixed(2)}\n` +
          `room ${s.room ?? '-'}  height ${s.heightCm} cm`,
        );
      }
    }
  });

  // ---- debug hooks
  function snapshot() {
    const pos = character.position;
    const room = roomAt(layout, pos);
    const near = interactions.nearest();
    return {
      pos,
      yawDeg: ((character.yawDeg % 360) + 360) % 360,
      mode: modes.id,
      room: room ? room.label : null,
      fps: viewer.fps,
      boom: camera.boom,
      charState: character.state,
      heightCm,
      pose: interactions.pose(),
      nearest: near ? { id: near.item.id, kind: near.item.kind, distM: near.distM } : null,
      pickerOpen: picker.isOpen(),
      scan: scanHandle ? (scanVisible ? 'shown' : 'hidden') : (property.splat ? 'loading-or-failed' : 'none'),
      items: store.all().map((i) => ({ id: i.id, kind: i.kind, source: i.source })),
      carpetAreaM2: carpetAreaM2(layout),
    };
  }
  function teleport(x: number, z: number): ReturnType<typeof snapshot> {
    const g = store.grid();
    const to: Vec2 = circleFree(g, x, z, CHARACTER_RADIUS_M) ? { x, z } : (nearestFree(g, x, z, CHARACTER_RADIUS_M, 3) ?? { x, z });
    const apply = (tries: number): void => {
      if (interactions.pose()) { interactions.cancelTo(to); return; }
      if (character.state === 'transition' && tries > 0) { setTimeout(() => apply(tries - 1), 50); return; }
      character.position = to;
      character.object.position.y = 0;
      character.setLocomotion(0, false);
    };
    apply(40);
    return snapshot();
  }

  const api = {
    ctx,
    /** Moves the character to (x, z) (nearest free spot if blocked). While posed the release takes up to ~0.7 s. */
    teleport,
    state: snapshot,
    /** E on the nearest item (or get up). Resolves with 'lie' | 'sit' | 'stand' | 'dims' | 'getup' | 'none'. */
    interact: () => interactions.interact(),
    /** End the current pose. Resolves when the character stands again. */
    getUp: () => interactions.getUp(),
    /** Set the body height in cm (140..200), as the picker would. Returns the height applied. */
    setHeight: (cm: number) => { heightCm = applyHeight(cm); return heightCm; },
    /** Close the height picker ("Start walking"). */
    start: () => { picker.close(); return snapshot(); },
    openHeightPicker: () => { picker.open(false); },
    setMode: (id: BuyerModeId) => { modes.set(id); return modes.id; },
    /** Camera heading in degrees (the walk direction of W). */
    setYaw: (deg: number) => { camera.yawDeg = deg; character.yawDeg = deg; },
    /** Place a catalogue item (virtual) for checks, e.g. addItem('bed-king', 1.06, 3.415, 90). Returns its id. */
    addItem: (catalogId: string, cx: number, cz: number, yawDeg = 0) => {
      const spec = catalogItem(catalogId);
      const item = itemFromCatalog(catalogId, { cx, cz, w: spec.footprint.w, d: spec.footprint.d, yawDeg }, 'virtual');
      store.add(item);
      return item.id;
    },
    removeItem: (id: string) => { store.remove(id); },
    /** Measure mode, two ray-free points: measure({x,y,z}, {x,y,z}) returns the label. */
    measure: (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => {
      modes.set('measure');
      const m = modes.active() as unknown as { addPoint(p: typeof a): void; last(): { label: string; meters: number } | null };
      m.addPoint(a);
      m.addPoint(b);
      return m.last();
    },
    /** Pixel position on screen of a world point, for clicking in automated checks. */
    project: (x: number, y: number, z: number) => {
      const v = new THREE.Vector3(x, y, z).project(viewer.camera);
      const r = viewer.canvas.getBoundingClientRect();
      return { clientX: r.left + ((v.x + 1) / 2) * r.width, clientY: r.top + ((1 - v.y) / 2) * r.height, behind: v.z > 1 };
    },
    store,
    grid: () => store.grid(),
    /** SPEC 16.6.6 hooks: who is walking. `set` resolves when the new body is in. */
    person: {
      get: () => ({ ...person, appearance: character.appearance, poseConstants: character.poseConstants }),
      set: async (p: { body?: 'male' | 'female'; tone?: number; heightCm?: number }) => {
        await applyPerson({ body: p.body ?? person.body, tone: p.tone ?? person.tone });
        if (p.heightCm !== undefined) heightCm = applyHeight(p.heightCm);
        return { ...person };
      },
      measure: () => character.measure(),
      meshNames: () => character.visibleMeshNames(),
      /** the character itself, for the acceptance scripts */
      character,
    },
    decor,
    seats,
    /** open-wardrobe hooks for the acceptance scripts */
    wardrobe: wardrobes.debug,
    /** SPEC 16.8 hooks. `ready` is the current tier's asset promise (a getter, so it follows tier changes). */
    look: look && {
      instance: look,
      stats: () => look.stats(),
      setTier: (t: 'low' | 'medium' | 'high') => look.setTier(t),
      setHour: (h: number) => look.setHour(h),
      setTrueColours: (on: boolean) => look.setTrueColours(on),
      /** painterly mode (C11c): true opens the painting (resolves with the session), false goes back */
      paint: async (on: boolean) => {
        if (on) return openPainterly();
        painting?.back();
        painting = null;
        return null;
      },
      get painting(): PaintSession | null { return painting?.active ? painting : null; },
      sample: (x0: number, y0: number, x1: number, y1: number) => look.debug.sample(x0, y0, x1, y1),
      sampleStd: (x0: number, y0: number, x1: number, y1: number) => look.debug.sampleStd(x0, y0, x1, y1),
      project: (x: number, y: number, z: number) => look.debug.project(x, y, z),
      get ready(): Promise<void> { return look.ready; },
    },
  };
  (window as unknown as { __walkthru: typeof api }).__walkthru = api;

  // ---- go
  loading.setProgress(1, 'Ready');
  booted = true;
  loading.hide();
  picker.open(true);
}

boot().catch((err) => {
  console.error('[walkthru] boot failed', err);
  loading.showError('Could not open this home.', describe(err));
});
