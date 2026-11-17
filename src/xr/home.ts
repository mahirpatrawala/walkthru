// One home, built for the headset. The same pieces the walk of the normal site puts together (src/buyer/main.ts `boot`), without the person, the walker's
// camera, the HUD, the modes and the sheets: the shell, the look on the low tier with no composer, the furniture at the drawn sizes, the style's decor and
// fittings, the baked lighting where the home has it, and the real door leaves. Nothing is rescaled: every size is the drawing's.
//
// It owns its own `THREE.Scene` and lights, so a swap of homes is a swap of scenes in the one renderer the page keeps (the headset session is never
// interrupted: it keeps being given frames while a new home loads). `dispose()` takes down everything this made, newest first.
import * as THREE from 'three';
import { ceilingTrustFromExtras, setCeilingTrust, unverifiedRoomsFromExtras } from '../core/room-trust';
import { circleFree, nearestFree } from '../core/grid-query';
import { rasterizeLayout } from '../core/layout-raster';
import { validateLayout, validateProperty } from '../core/layout-validate';
import { fixturesToItems } from '../core/fixtures';
import { chooseSpawn } from '../core/spawn';
import { resolveStartRoom } from '../core/start-rooms';
import { spaceKindOf } from '../core/places';
import type { Door } from '../core/doors';
import { buildShell } from '../engine/shell';
import { setFurnitureDefaults } from '../engine/furniture';
import type { Viewer } from '../engine/viewer';
import { setGenCeiling } from '../look/gen/ceiling';
import { applyDesigns, buildDecor, fetchDesigns } from '../look/designs';
import type { Decor } from '../look/designs';
import { furnitureKit } from '../look/furniture-materials';
import { createLook, fetchLookFile } from '../look/look';
import type { Look } from '../look/look';
import { mountKit } from '../look/kit';
import type { KitHandle } from '../look/kit';
import { mountBaked } from '../look/baked/runtime';
import type { BakedHandle } from '../look/baked/runtime';
import { fetchDesignSheet } from '../look/design-sheet';
import { mountDesign } from '../look/design-mount';
import { PACKS } from '../look/packs';
import { createFittingRegistry } from '../look/fittings';
import { createLivedIn } from '../look/lived-in';
import type { LivedIn } from '../look/lived-in';
import { doorPanelFinish, getStyle, setSpaceKind, setStyle, trimColours } from '../look/style';
import { setModelsEnabled } from '../look/models/library';
import { modelsIdle } from '../look/models/load';
import { disposeTree } from '../building/dispose';
import { fetchFixtures } from '../buyer/fixtures-load';
import { fetchOutdoor } from '../outdoor/load';
import { createFurnitureStore } from '../buyer/store';
import { buildSeats } from '../buyer/seats';
import { mountDoors } from '../buyer/doors';
import type { DoorReading, Doors } from '../buyer/doors';
import { mountDoorLabels } from '../buyer/door-labels';
import { sceneOrigin } from '../buyer/scene-tag';
import { Driver } from '../buyer/nav/driver';
import { roomChips } from '../buyer/nav/nav-model';
import type { RoomChip } from '../buyer/nav/nav-model';
import type { BuyerContext } from '../buyer/context';
import type { Grid, Layout, PropertyFile, Vec2 } from '../types';
import { CHARACTER_RADIUS_M } from '../types';

export const SCENE_ID_RE = /^[a-z0-9-]{1,40}$/;
const BACKGROUND = '#EEF0F3';

export class HomeError extends Error {
  constructor(readonly kind: 'missing' | 'unsupported' | 'broken', message: string) { super(message); this.name = 'HomeError'; }
}

export interface Spot { x: number; z: number; yawDeg: number }

export interface Home {
  sceneId: string;
  title: string;
  subtitle: string | null;
  layout: Layout;
  scene: THREE.Scene;
  look: Look | null;
  rooms: RoomChip[];
  /** where the viewer first stands (the room asked for, else the walk's default start) */
  spawn: Spot;
  /** a room's standing spot (the walk's smart spawn on the grid with every leaf open), or null for a room with no place to stand */
  spotIn(roomId: string): Spot | null;
  /** the live walk grid: walls, furniture, chairs and every door leaf where it stands now */
  grid(): Grid;
  /** the viewer's place on the floor plan, for the doors (a leaf is never closed on someone standing in it) */
  setWalker(p: Vec2): void;
  /** the door leaves' root objects, for picking */
  doorRoots(): THREE.Object3D[];
  /** which door a picked object belongs to */
  doorIdOf(o: THREE.Object3D | null): string | null;
  door(id: string): Door | null;
  /** "Open door" or "Close door" */
  doorPrompt(id: string): string | null;
  /** does what the prompt says; resolves when the leaf stands still */
  toggleDoor(id: string): Promise<DoorReading | null>;
  /** a door's centre in the home, metres (for the line-of-sight check and the marker) */
  doorCentre(id: string): { x: number; y: number; z: number } | null;
  /** debug and checks */
  doors: Doors;
  stats(): { geometries: number; textures: number; programs: number; calls: number; triangles: number };
  ready: Promise<void>;
  dispose(): void;
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    const t = await r.text();
    if (!t || /^\s*</.test(t)) return null;
    return JSON.parse(t);
  } catch { return null; }
}

async function fetchProperty(sceneId: string): Promise<PropertyFile> {
  if (!SCENE_ID_RE.test(sceneId)) throw new HomeError('missing', 'That is not a home on this site.');
  let res: Response;
  try { res = await fetch(`/scenes/${sceneId}/property.json`, { cache: 'no-cache' }); } catch (err) { throw new HomeError('broken', `Could not reach the server (${String(err)}).`); }
  if (res.status === 404) throw new HomeError('missing', 'This home is not set up.');
  if (!res.ok) throw new HomeError('broken', `The server answered HTTP ${res.status} for this home.`);
  const text = await res.text();
  if (/^\s*</.test(text)) throw new HomeError('missing', 'This home is not set up.');
  try { return validateProperty(JSON.parse(text)); } catch (err) { throw new HomeError('broken', err instanceof Error ? err.message : 'property.json is not valid.'); }
}

const withTimeout = (p: Promise<unknown>, ms: number): Promise<void> => new Promise((res) => { const t = setTimeout(res, ms); void p.then(() => { clearTimeout(t); res(); }, () => { clearTimeout(t); res(); }); });

export interface LoadHomeOptions {
  quality: 'low' | 'medium';
  /** the room to start in */
  room?: string | null;
  /** the style pack a building's space opens in */
  pack?: string | null;
  /** the door leaves say what stopped them here (a toast in the headset) */
  toast?: (text: string) => void;
  progress?: (fraction: number, text: string) => void;
  /** how long to wait for pictures and models after the geometry is up, ms */
  settleMs?: number;
}

export async function loadHome(sceneId: string, base: Viewer, o: LoadHomeOptions): Promise<Home> {
  const cleanup: Array<() => void> = [];
  const progress = o.progress ?? (() => {});
  let disposed = false;
  const teardown = (): void => {
    if (disposed) return;
    disposed = true;
    for (const fn of cleanup.splice(0).reverse()) { try { fn(); } catch (err) { console.warn('[walkthru-vr] clean-up step failed', err); } }
  };
  try {
    return await build();
  } catch (err) {
    teardown();
    throw err;
  }

  async function build(): Promise<Home> {
    setModelsEnabled(true);
    progress(0.04, 'Reading the home');
    const designsP = fetchDesigns(sceneId);
    const sheetP = fetchDesignSheet(sceneId);
    const lookFileP = fetchLookFile(sceneId);
    const extrasP = fetchJson(`/scenes/${sceneId}/proposal-extras.json`);
    const fixturesP = fetchFixtures(sceneId);
    const outdoorP = fetchOutdoor(sceneId);
    const property = await fetchProperty(sceneId);
    { const k = spaceKindOf(property); if (k !== 'home' || property.spaceKind) property.spaceKind = k; }
    const outdoorFile = await outdoorP;
    if (outdoorFile || property.spaceKind === 'pool' || property.spaceKind === 'garden') throw new HomeError('unsupported', 'Open-air spaces are not in VR yet. Open this one on the normal site.');
    const extras = await extrasP;
    let unverified: ReturnType<typeof unverifiedRoomsFromExtras> = {};
    if (extras) { setCeilingTrust(ceilingTrustFromExtras(extras)); unverified = unverifiedRoomsFromExtras(extras); } else setCeilingTrust({ known: true });
    const layout = property.layout;
    if (layout.rooms.length === 0) throw new HomeError('broken', 'This home has no rooms yet.');
    for (const w of validateLayout(layout).warnings) console.warn(`[walkthru-vr] layout warning: ${w}`);

    // ---- the scene and its two lights, as the normal viewer makes them
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb8b0a8, 1.0);
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(3, 6, 2);
    scene.add(hemi, sun);
    // The look believes this is a viewer of its own. The two things it must not do in a headset are made no-ops: install the composer as the render path, and change
    // the pixel ratio (the headset's layer has its own size). Everything else goes to the page's one viewer.
    const lookViewer = Object.create(base, {
      scene: { value: scene }, lights: { value: { hemi, sun } },
      setRenderOverride: { value: () => {} }, setPixelRatioCap: { value: () => {} },
      renderOverride: { get: () => null },
    }) as Viewer;
    cleanup.push(() => { disposeTree(scene); scene.clear(); });
    progress(0.1, 'Lighting');
    let look: Look | null = null;
    try {
      look = await createLook(lookViewer, layout, await lookFileP, { tier: o.quality, post: false, storage: null, hasSplat: false });
    } catch (err) { console.warn('[walkthru-vr] the look could not start, using the plain scene:', err); }
    if (look) { const l0 = look; cleanup.push(() => l0.dispose()); }
    if (disposed) throw new HomeError('broken', 'cancelled');

    progress(0.2, 'Building the rooms');
    const shell = buildShell(layout, look ? { materials: look.materials() } : {});
    cleanup.push(() => disposeTree(shell));
    scene.add(shell);
    const furnitureRoot = new THREE.Group();
    furnitureRoot.name = 'furniture';
    scene.add(furnitureRoot);
    cleanup.push(() => disposeTree(furnitureRoot));
    const baseGrid = rasterizeLayout(layout);
    const designs = await designsP;
    const tier = look?.tier ?? 'low';
    setFurnitureDefaults({ style: 'real', tier });
    setGenCeiling(layout.wallHeightM);
    void furnitureKit.setTier(tier).catch((err) => console.warn('[walkthru-vr] furniture textures not loaded', err));
    const sheet = await sheetP;
    {
      const picked = o.pack ?? null;
      const packId: string | undefined = picked && picked !== 'designer' && PACKS.some((p) => p.id === picked) ? picked : undefined;
      setSpaceKind(property.spaceKind);
      setStyle({ packId, sheet });
    }
    const ownIds = new Set(property.furniture.map((f) => f.id));
    const fixtureItems = fixturesToItems(await fixturesP, layout, property.furniture).filter((f) => !ownIds.has(f.id));
    const initialItems = applyDesigns([...property.furniture, ...fixtureItems], designs);
    progress(0.35, 'Furnishing');
    const store = createFurnitureStore({ sceneId, baseGrid, initial: initialItems, parent: furnitureRoot, storage: null, shareCode: null, ceilingM: layout.wallHeightM });
    cleanup.push(() => store.dispose());
    const registry = createFittingRegistry();
    const decor: Decor[] = buildDecor(designs, store.all(), tier);
    for (const d of decor) furnitureRoot.add(d.group);
    cleanup.push(() => { for (const d of decor) disposeTree(d.group); });
    const seats = buildSeats(designs, store.all());
    store.setTemporary('seats', seats.obstacles());
    if (look) { look.attach({ shell, furnitureRoot }); look.refresh(store.grid()); }

    // the style's room finishes, the kit of fittings, the designer's decor
    let kit: KitHandle | null = null;
    const design = mountDesign({
      scene, layout, shell, look, store, tier, registry,
      beforeRestyle: () => { kit?.dispose(); kit = null; },
      afterRestyle: () => { kit = mountKit({ viewer: lookViewer, layout, shell, look, store, registry, outdoor: false, ...(property.spaceKind && property.spaceKind !== 'home' ? { shared: property.spaceKind } : {}) }); },
    });
    cleanup.push(() => { design.dispose(); kit?.dispose(); kit = null; });
    const livedIn: LivedIn = createLivedIn({
      parent: furnitureRoot, layout, store, storage: null, tier, registry,
      omit: () => (getStyle().pack.classic ? [] : ['curtain', 'rug', 'cushion']),
      models: () => (getStyle().pack.classic ? null : getStyle().pack.models ?? null),
      defaultOn: ['sample', 'brochure'].includes(sceneOrigin({ id: property.id, subtitle: property.subtitle })),
    });
    cleanup.push(() => livedIn.dispose());

    // the baked lighting of this home, where it has one (a low-tier set is half the pictures)
    let baked: BakedHandle | null = null;
    if (look) {
      baked = mountBaked({ look, scene, renderer: base.renderer, sceneId, layout });
      cleanup.push(() => { baked?.dispose(); baked = null; });
    }

    // ---- the doors: the real leaves of the normal walk, driven by the viewer's place on the floor plan
    progress(0.6, 'Hanging the doors');
    const walker = { position: { x: 0, z: 0 } as Vec2 };
    const ctx = { viewer: base, character: walker, hud: { toast: (t: string) => o.toast?.(t), showCard() {}, hideCard() {} } } as unknown as BuyerContext;
    // the start: inside the chosen room, as the normal walk picks it
    const g0 = store.grid();
    const room = resolveStartRoom(layout, o.room ?? null, unverified);
    const smart = room ? chooseSpawn(layout, room.id, g0) : null;
    const sp = smart ?? property.spawn;
    let at: Vec2 = { x: sp.x, z: sp.z };
    if (!circleFree(g0, at.x, at.z, CHARACTER_RADIUS_M)) at = nearestFree(g0, at.x, at.z, CHARACTER_RADIUS_M, 4) ?? at;
    const spawn: Spot = { x: at.x, z: at.z, yawDeg: sp.yawDeg };
    walker.position = { x: spawn.x, z: spawn.z };
    const doors = mountDoors({ ctx, store, layout });
    cleanup.push(() => { doors.dispose(); delete (window as unknown as { __walkthruDoors?: unknown }).__walkthruDoors; });
    const styleDoors = (): void => { doors.setPanelFinish(doorPanelFinish()); doors.setHandleColour(trimColours().handle); };
    styleDoors();
    {
      const labels = mountDoorLabels(scene, layout, property.spaceKind ?? 'home');
      cleanup.push(() => labels.dispose());
    }

    const staticGrid = (): Grid => store.gridExcludingTemporary(['doors']);
    const driver = new Driver({
      layout, character: { position: walker.position, yawDeg: 0, setLocomotion() {} }, camera: { yawDeg: 0 },
      staticGrid, liveGrid: () => store.grid(), leaves: () => doors.route.leaves(), openDoor: (id) => doors.route.open(id),
      jump: async () => {}, reducedMotion: () => true,
    });
    const spots = new Map<string, Spot | null>();

    const roots: THREE.Object3D[] = [];
    scene.traverse((ob) => { if (ob.userData.doorId && ob.name.startsWith('door:')) roots.push(ob); });
    const doorRootsNow = (): THREE.Object3D[] => (roots.length ? roots : (scene.traverse((ob) => { if (ob.userData.doorId && ob.name.startsWith('door:')) roots.push(ob); }), roots));

    const settle = withTimeout(Promise.all([look?.ready ?? Promise.resolve(), modelsIdle(), baked ? baked.ready : Promise.resolve()]), o.settleMs ?? 12000);
    progress(0.8, 'Hanging the pictures');
    await settle;
    if (disposed) throw new HomeError('broken', 'cancelled');
    progress(1, 'Ready');

    const rooms = roomChips(layout, unverified);
    const home: Home = {
      sceneId, title: property.title, subtitle: property.subtitle ?? null, layout, scene, look, rooms, spawn,
      spotIn(roomId) {
        if (spots.has(roomId)) return spots.get(roomId) ?? null;
        const r = layout.rooms.find((q) => q.id === roomId);
        const s = r && !r.partial ? driver.spotIn(roomId) : null;
        spots.set(roomId, s);
        return s;
      },
      grid: () => store.grid(),
      setWalker(p) { walker.position = p; },
      doorRoots: doorRootsNow,
      doorIdOf(ob) { for (let n: THREE.Object3D | null = ob; n; n = n.parent) { const id = n.userData?.doorId as string | undefined; if (id) return id; } return null; },
      door: (id) => doors.debug.door(id),
      doorPrompt: (id) => doors.debug.read(id)?.prompt ?? null,
      toggleDoor(id) {
        const r = doors.debug.read(id);
        if (!r) return Promise.resolve(null);
        return r.prompt === 'Close door' ? doors.debug.close(id) : doors.debug.open(id);
      },
      doorCentre(id) {
        const d = doors.debug.door(id);
        if (!d) return null;
        const m = (d.u0 + d.u1) / 2;
        return { x: d.edgeA.x + d.dir.x * m + d.out.x * (d.depth / 2), y: Math.min(1.2, d.headM / 2), z: d.edgeA.z + d.dir.z * m + d.out.z * (d.depth / 2) };
      },
      doors,
      stats() { const i = base.renderer.info; return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0, calls: i.render.calls, triangles: i.render.triangles }; },
      ready: settle,
      dispose: teardown,
    };
    return home;
  }
}
