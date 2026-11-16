// Owned by C3. The buyer page: boot (B1 loading), height picker (B2), the walking loop (B3), debug hooks.
import { ceilingTrustFromExtras, setCeilingTrust } from '../core/room-trust';
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
import { fixturesToItems } from '../core/fixtures';
import { setGenCeiling } from '../look/gen/ceiling';
import { fetchFixtures } from './fixtures-load';
import { fetchOutdoor, ownedEdges } from '../outdoor/load';
import type { OutdoorMount } from '../outdoor/mount';
import { applyDesigns, buildDecor, fetchDesigns } from '../look/designs';
import type { Decor } from '../look/designs';
import { furnitureKit } from '../look/furniture-materials';
import { prefetchPerson } from '../look/people';
import { tierFromQuery } from '../look/quality';
import { CHARACTER_URL } from '../types';
import { createLook, fetchLookFile } from '../look/look';
import { mountKit } from '../look/kit';
import { mountBaked } from '../look/baked/runtime';
import type { BakedHandle } from '../look/baked/runtime';
import type { KitHandle } from '../look/kit';
import { fetchDesignSheet } from '../look/design-sheet';
import { mountDesign } from '../look/design-mount';
import { PACKS } from '../look/packs';
import { doorPanelColour, finishNote, getStyle, onStyleChange, setStyle } from '../look/style';
import { resolveItemLook } from '../look/furniture-real';
import { modelNote } from '../look/models/apply';
import { setModelsEnabled } from '../look/models/library';
import { modelStats, modelsIdle } from '../look/models/load';
import type { Look } from '../look/look';
import { mountLookPanel } from '../look/look-panel';
import { createInput } from '../engine/controls';
import { FollowCamera } from '../engine/camera';
import { resetLocomotion, stepLocomotion } from '../engine/locomotion';
import { CHARACTER_RADIUS_M } from '../types';
import { BODY_DEFAULT_CM, bodyFrom, clampPersonHeight, loadPerson, loadView, savePerson, saveView, tintForPerson } from './person-store';
import type { ViewMode } from './person-store';
import type { PersonBody } from '../look/people';
import type { PropertyFile, Vec2 } from '../types';
import { ModeManager, createBuyerContext } from './context';
import type { BuyerContext, BuyerModeId } from './context';
import { createFurnishMode } from './furnish';
import { mountLayoutChip, syncHosted } from './layout-chip';
import { createFittingRegistry } from '../look/fittings';
import { createFittingsApi } from './fittings-api';
import { editNote } from './resize';
import { SHARE_PARAM } from './my-layout';
import { chooseSpawn } from '../core/spawn';
import { resolveStartRoom } from '../core/start-rooms';
import { spaceKindOf } from '../core/places';
import { createGridOverlay } from './debug';
import type { GridOverlay } from './debug';
import { createHeightPicker } from './height';
import { createHud } from './hud';
import { createInteractions } from './interactions';
import { buildSeats } from './seats';
import { createWardrobes } from './wardrobe';
import { mountDoors } from './doors';
import { createLoadingScreen } from './loading';
import type { LoadingScreen } from './loading';
import { beginGuard } from '../building/guard';
import { disposeTree } from '../building/dispose';
import type { MountedSpace, SpaceHost, SpaceSession } from '../building/space-host';
import { mountAiPhoto } from '../photo/mount';
import { createMeasureMode } from './measure';
import { mountPeople } from './people';
import type { MountedPeople } from './people';
import type { PersonSpec } from './people/manager';
import { createOverlays } from './overlays';
import { createRoomsSheet, sizesNote } from './rooms';
import { mountHomeLink } from './home-link';
import { mountSceneTag, sceneOrigin, sceneTagText } from './scene-tag';
import { isLocalHomeId } from '../upload/tag';
import { createLivedIn, mountLivedInToggle } from '../look/lived-in';
import type { LivedIn } from '../look/lived-in';
import { mountPartialBadge, partialRoomInView } from './partial-badge';
import {
  HINT_KEY, createFurnitureStore, distanceToBox, roomChipText, safeStorage,
  standardHeightNote, storageGet, storageSet, unverifiedRoomsFromExtras,
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
    if (t && !/^\s*</.test(t)) { const ex = JSON.parse(t); setCeilingTrust(ceilingTrustFromExtras(ex)); return unverifiedRoomsFromExtras(ex); }
  } catch { /* optional */ }
  return {} as ReturnType<typeof unverifiedRoomsFromExtras>;
}

// ---------------------------------------------------------------- page boot

const params = new URLSearchParams(location.search);
setModelsEnabled(params.get('models') !== 'off'); // ?models=off: the generated furniture and decor only (SPEC 16.15)
// src/buyer/entry.ts only loads this file when ?scene= names a home (or ?building=&space= a space of a building, which mounts spaces itself
// through `boot`); with neither, the start page opens instead
const initialSceneId = (params.get('scene') ?? '').trim();
const initialRoom = params.get('room');
const debug = params.get('debug') === '1';
const storage = safeStorage();
const isTouch = ((): boolean => {
  try { return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0; } catch { return false; }
})();

// a building makes its own loading screens (src/building/walk.ts hands each space one through the host); a lone home makes its one here
let loading: LoadingScreen = params.get('building') ? (undefined as unknown as LoadingScreen) : createLoadingScreen(document.body);
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
  if (!booted) loading?.showError('Something went wrong', msg);
  else showFatalBanner(msg);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[walkthru] unhandled rejection', e.reason);
  const msg = describe(e.reason);
  if (!booted) loading?.showError('Something went wrong', msg);
  else showFatalBanner(msg);
});

/** Which body file to start fetching before the GL context says which tier this is: a guess, a wrong one only costs the lighter file. */
function guessedBodyTier(): 'low' | 'medium' {
  const forced = tierFromQuery(location.search);
  if (forced) return forced === 'low' ? 'low' : 'medium';
  const mem = (navigator as { deviceMemory?: number }).deviceMemory;
  return isTouch || (mem !== undefined && mem <= 4) ? 'low' : 'medium';
}

/**
 * Opens one home. With `host` (a space of a building) it can be taken down again: it returns a session whose `dispose` removes everything
 * the space put on the page, and the next space is booted in the same page. Without a host it is the lone home it always was.
 */
export async function boot(sceneId: string, requestedRoom: string | null, host: SpaceHost | null = null): Promise<SpaceSession | null> {
  booted = false;
  if (host) loading = host.loading;
  const guard = host ? beginGuard() : null;
  const cleanup: Array<() => void> = [];
  let probeViewer: Viewer | null = null;
  let disposed = false;
  /** debug: what the renderer held when the space began to come down, to set against what it held after every explicit dispose (the leak check) */
  let heldBefore: { geometries: number; textures: number; programs: number } | null = null;
  /** takes everything this boot made down again: its own disposers newest first, then whatever the guard saw added to the page */
  function teardown(): void {
    if (disposed) return;
    disposed = true;
    try { const i = probeViewer?.renderer.info; if (i) heldBefore = { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 }; } catch { /* debug only */ }
    for (const fn of cleanup.splice(0).reverse()) { try { fn(); } catch (err) { console.warn('[walkthru] clean-up step failed', err); } }
    try { guard?.release(); } catch (err) { console.warn('[walkthru] guard release failed', err); }
  }
  const failed = (): null => { teardown(); return null; };
  // an uploaded plan (`?scene=local-...`) is a home in this browser's own store: its files are answered from there, nothing is fetched (src/upload/local-fetch.ts)
  let uploaded: Awaited<ReturnType<typeof import('../upload/local-fetch').installLocalScene>> = null;
  if (isLocalHomeId(sceneId)) {
    uploaded = await (await import('../upload/local-fetch')).installLocalScene(sceneId);
    if (!uploaded) { loading.showError('This plan is not on this device', 'Uploaded plans stay in the browser that read them. Open Walkthru in that browser, or upload the plan again from the start page.'); return failed(); }
  }
  if (host) setCeilingTrust({ known: true }); // a space with no import sidecar must not inherit the last one's ceiling note
  // C11b: the body, its clips and the drawing's designs download while the layout and the look start up
  const early = loadPerson(storage);
  prefetchPerson(early.body, guessedBodyTier());
  const designsP = fetchDesigns(sceneId);
  const sheetP = fetchDesignSheet(sceneId);
  // the small optional JSON files go out together with property.json instead of one after another
  const lookFileP = fetchLookFile(sceneId);
  const extrasP = fetchExtras(sceneId);
  const fixturesP = fetchFixtures(sceneId);
  const outdoorP = fetchOutdoor(sceneId); // an open-air space (SPEC 19): the pool deck, the garden
  loading.setProgress(0.05, 'Loading the layout…');
  const result = await fetchProperty(sceneId);
  if (result.kind === 'missing') {
    loading.showNotSetUp(sceneId);
    return failed();
  }
  const property = result.property;
  // what kind of space this is: the scene's own `spaceKind`, or `?spaceKind=gym` (a debug override) so the catalogue can be tried without a building
  { const k = spaceKindOf(property, location.search); if (k !== 'home' || property.spaceKind) property.spaceKind = k; }
  document.title = `${property.title} · walkthru`;
  loading.setTitle(property.title, property.subtitle);
  loading.setNote(sizesNote(property.layout));
  loading.setProgress(0.12, 'Building the rooms…');
  const layout = property.layout;
  // Optional drawing-import sidecar: rooms whose size came from a label, not measured walls, must not show a
  // confident area. Missing file (or a dev server's index page) means nothing is flagged.
  const unverifiedRooms = await extrasP;
  const outdoorFile = await outdoorP;
  if (outdoorFile) setCeilingTrust({ known: true }); // an open-air space has no ceiling: no ceiling-height checks, no "ceiling not measured" note
  if (layout.rooms.length === 0) {
    loading.showError('This home has no rooms yet.', 'The layout is empty. A broker can trace the rooms in the editor.');
    return failed();
  }
  const check = validateLayout(layout);
  for (const w of check.warnings) console.warn(`[walkthru] layout warning: ${w}`);
  for (const e of check.errors) console.error(`[walkthru] layout error: ${e}`);

  // ---- viewer, shell, grid
  const app = document.getElementById('app');
  if (!app) throw new Error('index.html has no #app element.');
  let viewer: Viewer;
  try {
    viewer = createViewer(app, { hasSplat: !!property.splat, shared: !!host });
  } catch (err) {
    loading.showError('Could not start 3D.', `${describe(err)}\nTry another browser, or turn on hardware acceleration.`);
    return failed();
  }
  probeViewer = viewer;
  cleanup.push(() => {
    // last to go: everything below is registered after it and taken down first
    disposeTree(viewer.scene); // anything still hanging in the scene (a module that does not dispose its own parts)
    if (host) {
      const i = viewer.renderer.info;
      (window as unknown as { __walkthruTeardown?: unknown }).__walkthruTeardown = { before: heldBefore, after: { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 } };
    }
    viewer.dispose();
  });
  // the look (C11a): lights, tone mapping, materials, backdrop. It never blocks boot: assets arrive after first paint.
  let look: Look | null = null;
  try {
    const lookFile0 = await lookFileP;
    // an open-air space says which way north is (outdoor.json), so the sun has a real path across it; a look.json of its own wins
    const lookFile = outdoorFile?.northDeg !== undefined && lookFile0?.northDeg === undefined ? { ...(lookFile0 ?? { version: 1 as const }), northDeg: ((outdoorFile.northDeg % 360) + 360) % 360 } : lookFile0;
    look = await createLook(viewer, layout, lookFile, { hasSplat: !!property.splat, outdoor: !!outdoorFile });
  } catch (err) {
    console.warn('[walkthru] the look could not start, using the plain scene:', err);
  }
  if (look) {
    const lk0 = look;
    cleanup.push(() => lk0.dispose());
    // the time of day and colour mode the viewer chose stay with them from space to space
    if (host?.carry?.hour !== undefined) lk0.setHour(host.carry.hour);
    if (host?.carry?.trueColours !== undefined) lk0.setTrueColours(host.carry.trueColours);
  }
  const shell = buildShell(layout, { ...(look ? { materials: look.materials() } : {}), ...(outdoorFile ? { outdoor: { skipEdges: ownedEdges(outdoorFile) } } : {}) });
  cleanup.push(() => { disposeTree(shell); });
  viewer.scene.add(shell);
  const furnitureRoot = new THREE.Group();
  furnitureRoot.name = 'furniture';
  viewer.scene.add(furnitureRoot);
  cleanup.push(() => { disposeTree(furnitureRoot); });
  const baseGrid = rasterizeLayout(layout);
  // C11b: the real-looking furniture at the same exact sizes (SPEC 16.6.5). A scene's drawing (designs.json) may set drawn
  // heights and finish details; boxes are never changed. Textures arrive after first paint.
  const designs = await designsP;
  const startTier = look?.tier ?? 'medium';
  setFurnitureDefaults({ style: 'real', tier: startTier });
  setGenCeiling(layout.wallHeightM); // a hung swing's chains and hooks go up to this home's ceiling
  void furnitureKit.setTier(startTier).catch((err) => console.warn('[walkthru] furniture textures not loaded', err));
  // the style (SPEC 16.13): the designer's sheet when the home has one, else the default pack; the viewer's last pick wins (?style= for checks)
  const styleKey = `walkthru:style:${host?.styleScope ?? sceneId}`;
  const sheet = await sheetP;
  {
    const picked = params.get('style') ?? storageGet(storage, styleKey) ?? host?.space.pack ?? null;
    const packId: string | undefined = picked && picked !== 'designer' && PACKS.some((p) => p.id === picked) ? picked : undefined;
    setStyle({ packId, sheet });
  }
  // the sanitary and kitchen fixtures the drawing reader recognised, at their drawn place (src/core/fixtures.ts)
  const ownIds = new Set(property.furniture.map((f) => f.id));
  const fixtureItems = fixturesToItems(await fixturesP, layout, property.furniture).filter((f) => !ownIds.has(f.id));
  const initialItems = applyDesigns([...property.furniture, ...fixtureItems], designs);
  const store = createFurnitureStore({ sceneId, baseGrid, initial: initialItems, parent: furnitureRoot, storage, shareCode: host ? null : params.get(SHARE_PARAM), ceilingM: layout.wallHeightM });
  cleanup.push(() => store.dispose());
  // fittings (AC, fan, curtains, plants, the drawing's chairs ...): each planner reports what it built here, and a tap or the furnish card edits the overlay the store keeps
  const fittingRegistry = createFittingRegistry();
  const fittings = createFittingsApi({ registry: fittingRegistry, store, layout });
  const decor: Decor[] = buildDecor(designs, store.all(), startTier);
  for (const d of decor) furnitureRoot.add(d.group);
  cleanup.push(() => { for (const d of decor) disposeTree(d.group); });
  // the drawing's chairs are sittable and block the walk grid (src/buyer/seats.ts)
  const seats = buildSeats(designs, store.all());
  store.setTemporary('seats', seats.obstacles());
  syncHosted(store, decor, seats, (records) => fittingRegistry.set('seats', records)); // decor and chairs at a piece that My layout hides go with it (and follow one that it moves)
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
  // the open-air parts: ground, boundaries, water, plants (SPEC 19). They need the store (the water stops the walker) and the look (tier, hour).
  let outdoor: OutdoorMount | null = null;
  if (outdoorFile) {
    const om = await import('../outdoor/mount');
    outdoor = await om.mountOutdoor({ scene: viewer.scene, layout, file: outdoorFile, look, tier: startTier });
    const o0 = outdoor;
    cleanup.push(() => o0.dispose());
    look?.refresh(store.grid());
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
    return failed();
  }
  viewer.scene.add(character.object);
  cleanup.push(() => { viewer.scene.remove(character.object); character.dispose(); });
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
        design?.rebuild(t);
        livedIn?.setTier(t);
        for (const d of decor) d.rebuild(t);
        look!.refresh(store.grid());
      });
      void character.setAppearance({ tier: t }).catch((err) => console.warn('[walkthru] body for this tier not loaded', err));
    });
  }
  loading.setProgress(0.85, 'Almost there…');

  // ---- HUD, input, camera, overlays, modes, context
  const input = createInput(viewer.canvas);
  cleanup.push(() => input.dispose());
  const camera = new FollowCamera(viewer.camera, () => store.grid(), layout.wallHeightM);
  if (outdoorFile) camera.setOpenAir(true); // no ceiling: a longer boom and a higher start
  const overlays = createOverlays(viewer.scene);
  cleanup.push(() => overlays.dispose());
  const modes = new ModeManager();

  let picker: ReturnType<typeof createHeightPicker>;
  let rooms: ReturnType<typeof createRoomsSheet>;
  let scanHandle: SplatHandle | null = null;
  let livedIn: LivedIn | null = null;
  let scanVisible = false;

  const hud = createHud(document.body, {
    person: () => picker.open(false),
    measure: () => toggleMode('measure'),
    furnish: () => toggleMode('furnish'),
    rooms: () => rooms.toggle(),
    scan: () => setScan(!scanVisible),
  });
  hud.setVisible(false);
  cleanup.push(() => hud.dispose());
  const tagText = host ? host.tagText : sceneTagText(property);
  if (tagText) mountSceneTag(hud.root, tagText);
  if (uploaded) { const up = uploaded; void import('../upload/notes-panel').then((m) => m.mountUploadNote(hud.root, up.data.notes, sceneId, up.source === 'sample')); }
  mountHomeLink(hud.root);
  const partialBadge = mountPartialBadge(hud.root);
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
  // the Style picker (SPEC 16.13): the designer's look when the home has a sheet, then the packs
  let design: ReturnType<typeof mountDesign> | null = null;
  const stylePicker = {
    options: () => [
      ...(sheet ? [{ id: 'designer', label: "Designer's look" }] : []),
      ...PACKS.filter((p) => !(sheet && p.id === sheet.pack)).map((p) => ({ id: p.id, label: p.name, hint: p.blurb })),
    ],
    current: (): string => (getStyle().designerLook ? 'designer' : getStyle().pack.id),
    choose: (id: string): void => {
      storageSet(storage, styleKey, id);
      setStyle(id === 'designer' && sheet ? { packId: sheet.pack } : { packId: id });
    },
    onChange: onStyleChange,
    note: (): string | null => design?.note() ?? null,
    designerSource: (): string | null => (getStyle().designerLook ? sheet?.source ?? null : null),
    packName: (): string => getStyle().pack.name,
    classic: (): boolean => !!getStyle().pack.classic,
  };
  if (look) cleanup.push(mountLookPanel(hud.root, look, { toast: (t) => hud.toast(t), onPainterly: () => { void openPainterly(); }, style: stylePicker }));
  // the people a buyer adds (src/buyer/people): mounted below, once the walker, the store and the HUD exist
  let people: MountedPeople | null = null;
  // C12f: the optional AI photo (SPEC 17.14). The button exists only if the server says the feature is on; nothing else loads until it is tapped.
  // never for an uploaded plan: a picture of the view would leave the device, and an upload is promised to stay on it
  if (!uploaded) cleanup.push(mountAiPhoto({
    host: hud.root, viewer, layout, items: () => store.all(), toast: (t) => hud.toast(t),
    withoutCharacter: (fn) => { const was = character.object.visible; character.setVisible(false); livedIn?.setSuppressed(true); people?.people.setSuppressed(true); try { return fn(); } finally { character.setVisible(was); livedIn?.setSuppressed(!!scanHandle && scanVisible); people?.people.setSuppressed(false); } },
  }).dispose);

  const ctx: BuyerContext = createBuyerContext({ viewer, property, character, input, camera, hud, overlays, furniture: store, shell, furnitureRoot, modes, unverifiedRooms, fittings, extraTargets: () => people?.people.objects() ?? [] });
  // openable wardrobes (drawn from designs.json, or catalogue): shutters, swing arcs, walking space
  const wardrobes = createWardrobes({ ctx, store, designs, parent: furnitureRoot });
  cleanup.push(() => wardrobes.dispose());
  const doors = mountDoors({ ctx, store, layout, looks: host?.doorLooks });
  cleanup.push(() => { doors.dispose(); delete (window as unknown as { __walkthruDoors?: unknown }).__walkthruDoors; });
  doors.setPanelColour(doorPanelColour());
  cleanup.push(onStyleChange(() => { doors.setPanelColour(doorPanelColour()); })); // a real leaf in every door: swings, blocks the walk grid, prompts "Open door" (src/buyer/doors.ts)
  const interactions = createInteractions(ctx, { wardrobe: wardrobes, seats, editNote: (item) => { const d = store.drawnItem(item.id); return d && store.isOriginal(item.id) ? editNote(d, item) : null; }, cardNote: (item) => standardHeightNote(item, designs) ?? (getStyle().pack.classic ? null : finishNote(resolveItemLook(item), getStyle().pack.name) + modelNote(item.id)) });
  modes.register({ id: 'walk', enter() {}, exit() {}, update() {} });
  modes.register(interactions.mode);
  modes.register(createMeasureMode(ctx));
  modes.registerLazy('furnish', () => createFurnishMode(ctx, { designedIds: new Set(Object.keys(designs?.items ?? {})) }));
  cleanup.push(() => { try { modes.set('walk'); } catch { /* the space is going */ } }); // a mode left open (furnish, measure) closes with its own clean-up
  mountLayoutChip(hud.root, store, () => { if (!blocking() && modes.id !== 'furnish') modes.set('furnish'); });
  if (store.fromLink()) {
    try { const u = new URL(location.href); u.searchParams.delete(SHARE_PARAM); history.replaceState(null, '', u.toString()); } catch { /* ignore */ }
    setTimeout(() => hud.toast('Opened a shared layout. Reset it any time from Furnish.'), 1200);
  }
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
    const v = clampPersonHeight(person.body, cm);
    character.setHeight(v / 100, tintForPerson(person.body, v));
    person = { ...person, heightCm: v };
    savePerson(storage, person);
    picker?.sync(v);
    interactions.refresh();
    return v;
  }
  /** body and skin tone (SPEC 16.6.4); the new body is fetched only now, and swapped in place */
  function applyPerson(next: { body: PersonBody; tone: number }): Promise<void> {
    // another person starts at their own height (a child is not 175 cm); the buyer can change it from there
    const changed = next.body !== person.body;
    heightCm = changed ? BODY_DEFAULT_CM[next.body] : heightCm;
    person = { ...person, body: next.body, tone: next.tone, heightCm };
    savePerson(storage, person);
    picker?.syncPerson(next);
    picker?.sync(heightCm);
    return character.setAppearance({ body: next.body, tone: next.tone }).then(() => {
      character.setHeight(heightCm / 100, tintForPerson(person.body, heightCm));
      interactions.refresh();
    });
  }
  let heightCm = person.heightCm;
  character.setHeight(heightCm / 100, tintForPerson(person.body, heightCm));

  // ---- view (SPEC 16.6.8): see yourself (the follow camera, the default) or look through your own eyes (no body in shot)
  let view: ViewMode = loadView(storage);
  const eyeNow = new THREE.Vector3();
  let lastCharState = character.state;
  function applyView(v: ViewMode, announce = true): void {
    view = v;
    saveView(storage, v);
    camera.firstPerson = v === 'first';
    if (v === 'first') character.setVisible(false);
    picker?.syncView(v);
    if (announce) hud.hint(v === 'first' ? 'First person · V to see yourself' : 'See yourself · V for first person', 2500);
  }

  let extBlock = false; // a building's own panel (the lift's floor list, the map) is open
  // the people a buyer adds: bodies of their own that block the walk like a body, kept in "My layout" (src/buyer/people)
  people = mountPeople({
    ctx, hud, store, seats, modes, storage, sceneId, shareCode: host ? null : params.get(SHARE_PARAM),
    tier: () => look?.tier ?? 'medium',
    surfaceProbe: (x, z) => character.surfaceProbe?.(x, z) ?? null,
    onBodies: () => baked?.rescan(),
    otherBlocking: () => picker.isOpen() || rooms.isOpen() || paintBusy,
    walker: {
      position: () => character.position,
      yawDeg: () => character.yawDeg,
      heightCm: () => heightCm,
      body: () => ({ body: person.body, tone: person.tone }),
      poseOn: () => interactions.pose()?.itemId ?? null,
      state: () => character.state,
      getUp: () => interactions.getUp(),
      swapTo: async (p) => {
        await applyPerson({ body: p.body, tone: p.tone });
        heightCm = applyHeight(p.heightCm);
        resetLocomotion(character);
        character.position = p.at;
        character.yawDeg = p.yawDeg;
        character.object.position.y = 0;
        camera.setTarget(p.at, character.heightM);
      },
    },
  });
  cleanup.push(() => { people?.ui.dispose(); people?.people.dispose(); people = null; }); // their bodies, sheets and timers go with the space (their records stay in My layout)
  const blocking = (): boolean => picker.isOpen() || rooms.isOpen() || paintBusy || extBlock || people!.ui.blocking();

  picker = createHeightPicker(document.body, {
    getCm: () => heightCm,
    onChange: (cm) => { heightCm = applyHeight(cm); },
    person: { get: () => ({ body: person.body, tone: person.tone }), onChange: (p) => { void applyPerson(p); } },
    view: { get: () => view, onChange: (v) => applyView(v) },
    addPerson: { ...people.ui.addOption(), onClick: () => { picker.close(); people!.ui.openAdd(); } },
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
  rooms.setPeopleNote(people.ui.note());
  people.people.onChange(() => rooms.setPeopleNote(people!.ui.note()));
  // look-kit: typical Indian-flat fittings (decor only, labelled, 'Plain' removes them). The style's room finishes are applied first (the kit's
  // floors read them), and the kit is taken off and put back whenever the style changes them.
  let kit: KitHandle | null = null;
  design = mountDesign({
    scene: viewer.scene, layout, shell, look, store, tier: startTier, registry: fittingRegistry,
    beforeRestyle: () => { kit?.dispose(); kit = null; },
    afterRestyle: () => { kit = mountKit({ viewer, layout, shell, look, store, registry: fittingRegistry, ...(host?.bare || outdoorFile || (host && host.space.kind !== 'home') ? { plain: true } : {}) }); }, // a lobby, a corridor or a gym has no flat fittings (window grills, switchboards, fans) by default
  });
  cleanup.push(() => { design?.dispose(); kit?.dispose(); kit = null; });
  // a new style rebuilds the furniture and the openable wardrobes' shutters (the decor and rooms are rebuilt by mountDesign itself)
  cleanup.push(onStyleChange(() => {
    rebuildFurnitureTier(furnitureRoot, look?.tier ?? startTier);
    wardrobes.restyle();
    livedIn?.replan();
    look?.refresh(store.grid());
  }));
  // optional "Lived-in" decor (SPEC 16.6.7): a switch in the look sheet, a label in the rooms sheet; on by default only for made-up sample homes
  livedIn = createLivedIn({ parent: furnitureRoot, layout, store, storage, tier: startTier, registry: fittingRegistry, omit: () => (getStyle().pack.classic ? [] : ['curtain', 'rug']), models: () => (getStyle().pack.classic ? null : getStyle().pack.models ?? null), defaultOn: !host?.bare && !outdoorFile && sceneOrigin({ id: property.id, subtitle: property.subtitle, hasSplat: !!property.splat }) === 'sample' }); mountLivedInToggle(hud.root, livedIn, rooms);
  cleanup.push(() => { livedIn?.dispose(); });

  // SPEC 16.14: the baked lighting of this home, if it has one. Loads after first paint; a home with no bake renders as it always did.
  let baked: BakedHandle | null = null;
  if (look && params.get('bake') !== 'off' && !property.splat && !outdoorFile) {
    baked = mountBaked({ look, scene: viewer.scene, renderer: viewer.renderer, sceneId, layout, extraDynamic: () => [character.object, ...people!.people.objects()] });
    cleanup.push(() => { baked?.dispose(); baked = null; });
    const lk = look;
    store.onChange(() => { setTimeout(() => baked?.rescan(), 150); });
    lk.onChange(() => baked?.rescan());
  }

  // ---- spawn
  // The buyer starts inside the chosen room (?room=, else the default: the largest bedroom or living room), just in from its
  // main door and facing into it. property.spawn is only the fallback for a layout with no room to stand in.
  {
    const g = store.grid();
    const room = resolveStartRoom(layout, requestedRoom, unverifiedRooms);
    const smart = room ? chooseSpawn(layout, room.id, g) : null;
    // a building lands the walker just inside the door they came through; otherwise the room's own start
    const sp = host?.arrival?.(layout, g) ?? smart ?? property.spawn;
    let at: Vec2 = { x: sp.x, z: sp.z };
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
  camera.firstPerson = view === 'first';
  input.on('view', () => { if (!blocking()) applyView(view === 'first' ? 'third' : 'first'); });
  input.on('interact', () => { if (!blocking()) void interactions.interact(); });
  input.on('measure', () => toggleMode('measure'));
  input.on('furnish', () => toggleMode('furnish'));
  // a tap on any piece or fitting while walking opens it in Furnish with that thing selected: its size, and move, resize, replace, change look or remove
  input.onTap((e) => {
    if (blocking() || modes.id !== 'walk') return;
    if (host?.tapClaim?.(e)) return; // a tap on a building's portal door or lift is the portal's, not a piece to select
    // the same hit-test as in Furnish: the nearest thing under the tap, furniture, fitting or an added person
    const hit = ctx.pickAt?.(e) ?? null;
    if (people!.ui.handleTap(e, hit)) return; // placing a person, or a person was tapped
    if (!hit || hit.kind === 'person') return;
    if (hit.kind === 'item' && !store.all().some((i) => i.id === hit.id)) return;
    if (!modes.set('furnish')) return;
    const session = (modes.active() as { session?: { select(id: string | null): void; selectFitting(id: string | null): void } } | undefined)?.session;
    if (hit.kind === 'fitting') session?.selectFitting(hit.id); else session?.select(hit.id);
  });
  input.on('cancel', () => {
    if (blocking()) return;
    if (people!.ui.placing() || people!.ui.selected()) { people!.ui.cancel(); return; } // Esc puts a person down, or closes their card
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
    livedIn?.setSuppressed(v); // and the added decor steps back with it
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
      if (disposed) { scanHandle.dispose(); scanHandle = null; return; }
      cleanup.push(() => { scanHandle?.dispose(); scanHandle = null; });
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
    cleanup.push(() => gridOverlay?.dispose());
    store.onChange(() => { gridDirty = true; });
  }

  // ---- the frame loop
  const ZERO_LOOK = { dx: 0, dy: 0, zoom: 0 };
  let freeCam: { pos: [number, number, number]; target: [number, number, number]; fov?: number; up?: [number, number, number] } | null = null;
  let chipClock = 0;
  let lastChip: string | null | undefined;
  let debugClock = 0;
  let gridClock = 0;
  // debug only (SPEC 16.6.8): freeze the simulation and advance it in exact steps, so a frame sequence has even spacing
  const motionDebug = { paused: false, steps: 0, dt: 1 / 30, trace: null as null | { cam: number[]; char: number[] }[] };
  cleanup.push(viewer.onFrame((frameDt) => {
    if (disposed) return;
    if (!motionDebug.paused) { tick(frameDt); return; }
    while (motionDebug.steps > 0) { motionDebug.steps--; tick(motionDebug.dt); }
  }));
  function tick(dt: number): void {
    const look = input.takeLook();
    const blocked = blocking();
    if (blocked) {
      if (character.state === 'walk' || character.state === 'jog') character.setLocomotion(0, false);
      resetLocomotion(character); // a sheet that opens mid-stride stops the walker; it does not glide on when the sheet closes
    } else if (modes.id !== 'pose') {
      stepLocomotion(character, input, camera.viewYawDeg, people!.people.walkGrid(store.grid()), dt);
    } else resetLocomotion(character);
    modes.update(dt);
    interactions.update(dt);
    wardrobes.update(dt);
    character.update(dt);
    camera.setTarget(character.position, character.heightM);
    if (camera.firstPerson) {
      camera.setEye(character.eyePosition(eyeNow, dt));
      // sitting down or lying down, the view turns to face the way the seat or the bed points
      const st = character.state;
      if (st !== lastCharState && (st === 'sitting' || st === 'lying')) camera.turnTo(character.yawDeg, 0.6);
      lastCharState = st;
    } else lastCharState = character.state;
    camera.update(dt, blocked ? ZERO_LOOK : look);
    if (freeCam) {
      // debug only (screenshots from a chosen viewpoint): the follow camera is overridden after it has run
      viewer.camera.position.set(freeCam.pos[0], freeCam.pos[1], freeCam.pos[2]);
      viewer.camera.up.set(...(freeCam.up ?? [0, 1, 0]));
      viewer.camera.lookAt(freeCam.target[0], freeCam.target[1], freeCam.target[2]);
      if (freeCam.fov && viewer.camera.fov !== freeCam.fov) { viewer.camera.fov = freeCam.fov; viewer.camera.updateProjectionMatrix(); }
      viewer.camera.updateMatrixWorld(true);
      character.setVisible(false);
    }
    if (motionDebug.trace) {
      const c = viewer.camera.position, p = character.object.position;
      motionDebug.trace.push({ cam: [c.x, c.y, c.z], char: [p.x, p.y, p.z] });
    }
    people!.people.update(dt);
    people!.ui.update(dt);
    // below a 0.7 m boom the character is hidden, above 0.8 m it comes back (SPEC 2.4)
    if (camera.boom < 0.7) character.setVisible(false);
    else if (camera.boom > 0.8) character.setVisible(true);
    hud.setJoystick(input.joystick);

    chipClock += dt;
    if (chipClock > 0.1) {
      chipClock = 0;
      const text = roomChipText(layout, character.position, unverifiedRooms);
      if (text !== lastChip) { lastChip = text; hud.setRoomChip(text); }
      partialBadge.update(partialRoomInView(layout, store.grid(), character.position, camera.viewYawDeg));
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
  }

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
    /** Debug (screenshots): a fixed camera at `pos` looking at `target`; `null` gives the follow camera back. The HUD is hidden while it is on. */
    freeCam: (pos: [number, number, number] | null, target?: [number, number, number], fov?: number, up?: [number, number, number]) => {
      freeCam = pos && target ? { pos, target, fov, up } : null;
      hud.setVisible(!freeCam);
    },
    /** Debug (motion captures): `pause(true, dt)` freezes the simulation, `step(n)` runs n frames of `dt` seconds, `trace(true)` records camera and character per frame. */
    /** SPEC 16.6.8: 'third' (see yourself) or 'first' (your own eyes). `set` returns the view now in force. */
    view: { get: () => view, set: (v: ViewMode) => { applyView(v === 'first' ? 'first' : 'third', false); return view; } },
    motion: {
      pause: (on: boolean, dt = 1 / 30) => { motionDebug.paused = on; motionDebug.dt = dt; motionDebug.steps = 0; },
      step: (n: number) => { motionDebug.steps += n; },
      pending: () => motionDebug.steps,
      trace: (on: boolean) => { if (on) { motionDebug.trace = []; return []; } const t = motionDebug.trace ?? []; motionDebug.trace = null; return t; },
    },
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
    fittings,
    grid: () => store.grid(),
    /** SPEC 16.6.6 hooks: who is walking. `set` resolves when the new body is in. */
    person: {
      get: () => ({ ...person, appearance: character.appearance, poseConstants: character.poseConstants }),
      set: async (p: { body?: PersonBody | 'male' | 'female'; tone?: number; heightCm?: number }) => {
        await applyPerson({ body: bodyFrom(p.body ?? person.body), tone: p.tone ?? person.tone });
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
    /** the people a buyer added (src/buyer/people): the model, and the sheets and card */
    people: { get model() { return people!.people; }, get ui() { return people!.ui; } },
    /** SPEC 16.14: the offline bake dumps the scene as built (loaded on demand, never part of a first load) */
    bake: {
      get handle() { return baked; },
      // library models (SPEC 16.15) arrive after first paint: the dump waits for them, so the bake lights what the viewer sees
      exportScene: async () => { await modelsIdle(); return (await import('../look/baked/export')).exportScene({ scene: viewer.scene, sceneId, wallHeightM: layout.wallHeightM }); },
    },
    /** the CC0 model library (SPEC 16.15): files fetched so far, and a promise for when nothing is loading */
    models: { stats: modelStats, idle: modelsIdle, lived: () => livedIn?.pieces() ?? [] },
    /** open-wardrobe hooks for the acceptance scripts */
    wardrobe: wardrobes.debug,
    /** SPEC 16.8 hooks. `ready` is the current tier's asset promise (a getter, so it follows tier changes). */
    look: look && {
      instance: look,
      stats: () => look.stats(),
      setTier: (t: 'low' | 'medium' | 'high') => look.setTier(t),
      setHour: (h: number) => look.setHour(h),
      setPreset: (p: 'morning' | 'afternoon' | 'evening' | 'night') => look.setPreset(p),
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
  if (disposed) return null; // the building moved on while this space was still loading
  host?.onMounted({
    sceneId, property, layout, ctx, hud, viewer, doors, look, blocked: blocking, block: (on) => { extBlock = on; }, people: people!.people,
    onDispose: (fn) => { cleanup.push(fn); },
  });
  loading.setProgress(1, 'Ready');
  booted = true;
  loading.hide();
  if (!host || host.first) picker.open(true);
  else hud.setVisible(true); // the walker is already chosen: straight into the space
  return {
    sceneId,
    dispose: teardown,
    carry: () => (look ? { hour: look.hour, trueColours: look.trueColours } : {}),
    // the people who were following the walker leave this space's layout and come out of the portal with them
    takeFollowers: () => {
      const pp = people?.people;
      if (!pp) return [];
      const out: PersonSpec[] = [];
      for (const r of pp.list()) if (pp.isFollowing(r.id)) { out.push({ body: r.body, tone: r.tone, heightCm: r.heightCm }); pp.remove(r.id); }
      return out;
    },
  };
}

// a lone home (or a building's space opened by ?scene=): boot it here. A building (`?building=`) is driven by src/building/walk.ts, which boots each space itself.
if (!params.get('building')) {
  boot(initialSceneId, initialRoom).catch((err) => {
    console.error('[walkthru] boot failed', err);
    loading.showError('Could not open this home.', describe(err));
  });
}
