// The doll house: the whole space seen from above, orbiting. Made when the camera starts to fly up from the walker and taken away completely when it has
// flown back down, so the walk never carries any of it. While it is on:
//   * the ceiling fades out and what hangs from it, or would stand in the way from above, is hidden (hanger.ts); the walls that stand between the camera and
//     the rooms are cut down to about a metre and follow the camera as it orbits, every wall wearing a clean cap (wall-cut.ts)
//   * the lighting is its own, set through the look's `setLightOverride` and crossed over from the viewer's own light during the flight (the hour, the fill,
//     the sun, the exposure all move together, so an evening or a night does not jump)
//   * the camera is a perspective orbit with damping, limited in polar angle, distance and pan (framing.ts), steered by orbit-input.ts, framed in the part of
//     the picture the panels leave free, and it flies from the walker's camera to the orbit pose with a smootherstep (the view machine's `flight`)
//   * a marker with a view cone lies on the floor where the walker stands, the rooms carry small names (a dot for a tiny room), a hovered piece glows with its
//     prompt, a tapped piece shows its card, a tapped floor takes the buyer there (mount.ts decides what "there" means), and Furnish works from above
// The viewer keeps one camera for everything (the look's passes hold on to it), so this module does what the debug free camera does: it sets that camera's
// pose after the walk's own camera has run each frame, and gives the walker's field of view back when it is done.
import * as THREE from 'three';
import type { Viewer } from '../../engine/viewer';
import type { Character } from '../../engine/character';
import type { PointerEvt } from '../../engine/controls';
import type { BuyerContext } from '../context';
import type { Look, LightOverride } from '../../look/look';
import type { CheckCard, FurnitureItem, Layout, Vec2 } from '../../types';
import { pointInPolygon, polygonArea } from '../../core/geometry';
import type { RoomChip } from '../nav/nav-model';
import { boundsCentre, boundsRadius, dampOrbit, dollFov, freeRect, initialOrbit, layoutBounds, orbitPosition } from './framing';
import type { Bounds, OrbitGoal, OrbitLimits, Panel } from './framing';
import { createHanger } from './hanger';
import type { Hanger } from './hanger';
import { createStage } from './stage';
import type { Stage } from './stage';
import { createMarker } from './marker';
import type { Marker } from './marker';
import { createOutline } from './outline';
import type { Outline } from './outline';
import { attachOrbitInput } from './orbit-input';
import type { OrbitInput } from './orbit-input';
import { coverage, isTinyRoom, labelPoint, placeLabels, showsArea } from './labels';
import type { LabelCandidate } from './labels';
import { createWallCut } from './wall-cut';
import type { WallCut } from './wall-cut';
import { smootherstep } from './view-modes';
import type { Flight } from './view-modes';

const DEG = Math.PI / 180;

/** The doll house's own light (three's units: a hemisphere of intensity pi lights a white surface at its own colour). A soft key with shadows, a restrained fill. */
export const DOLL_LIGHT = {
  hemi: 1.0, hemiSky: '#f6f8ff', hemiGround: '#cfc8bc',
  sun: 3.1, sunColour: '#fff1df', elevationDeg: 52, azimuthOffsetDeg: 30,
  env: 0.1, hour: 12, exposure: 0.76,
};
export const DOLL_BACKDROP = '#F4F5F8';

export interface FurnishHandle {
  active(): boolean;
  /** a press: true when it grabs the piece being placed (the drag is then Furnish's) */
  down(e: PointerEvt): boolean;
  move(e: PointerEvt): void;
  up(e: PointerEvt): void;
  tap(e: PointerEvt): void;
}

export interface DollhouseDeps {
  viewer: Viewer;
  layout: Layout;
  look: Look | null;
  character: Character;
  ctx: BuyerContext;
  /** where the room names are put */
  labelHost: HTMLElement;
  shell: THREE.Object3D;
  furnitureRoot: THREE.Object3D;
  /** an open-air space has no ceiling to fade */
  outdoor: boolean;
  /** which way the entrance faces (plan direction, outward), when the drawing shows one */
  entrance: Vec2 | null;
  skipEdges?: ReadonlySet<string>;
  chips: readonly RoomChip[];
  /** the prompt a hovered piece shows ("Sit on the bed"), and the card a tapped one shows */
  promptFor(item: FurnitureItem): string | null;
  cardFor(item: FurnitureItem): CheckCard;
  /** a tap on a room's floor: where, and which room (null when the floor belongs to none) */
  onFloorTap(p: Vec2, roomId: string | null): void;
  onEscape(): void;
  /** Furnish from above: while it is on, a press on the piece being placed drags it and a tap selects, through Furnish's own session */
  furnish?: FurnishHandle;
  /** the tier: gates what costs (labels' occlusion tests are cheap; the outline is a second draw of one piece) */
  tier(): 'low' | 'medium' | 'high';
}

export interface Dollhouse {
  /** per frame, after the walk's own camera has run: `flight` comes from the view machine, `planCover` is how far the plan covers the picture */
  update(dt: number, flight: Flight, planCover?: number): void;
  /** the doll house is up (resources exist) */
  readonly on: boolean;
  /** the camera has arrived and the orbit answers the buyer */
  readonly steady: boolean;
  /** the orbit as it is now, for the checks and the harness */
  debug(): { goal: OrbitGoal; limits: OrbitLimits | null; hovered: string | null; selected: string | null; hanger: ReturnType<Hanger['stats']> | null; cut: ReturnType<WallCut['stats']> | null; free: { left: number; top: number; right: number; bottom: number } | null; cameraDistance: number };
  /** re-frame the whole space (a double tap on the picture, a button, a new mode) */
  reset(): void;
  /** put the orbit at a pose (checks): angles in degrees */
  setOrbit(p: Partial<{ theta: number; elevationDeg: number; dist: number; tx: number; tz: number }>, instant?: boolean): void;
  /** change the doll house's light while it is on (checks): the same keys as DOLL_LIGHT */
  setLight(p: Partial<Record<keyof typeof DOLL_LIGHT, number | string>>): void;
  /** deselects the tapped piece and hides its card */
  clearSelection(): void;
  dispose(): void;
}

interface LabelEl {
  el: HTMLDivElement; nameEl: HTMLSpanElement; areaEl: HTMLSpanElement; chip: RoomChip;
  /** candidate places for the tag in the room, best (the middle) first */
  spots: THREE.Vector3[]; boxes: { cx: number; cz: number; w: number; d: number }[];
  at: THREE.Vector3; weight: number; tiny: boolean; areaM2: number;
  w: number; h: number; sx: number; sy: number; visibleNow: boolean; shown: number; expanded: boolean; hovered: boolean; found: boolean;
}

export function createDollhouse(d: DollhouseDeps): Dollhouse {
  const { viewer, layout, look, ctx } = d;
  const cam = viewer.camera;
  const bounds: Bounds | null = layoutBounds(layout);
  const hasRoof = !d.outdoor;
  let on = false;
  let steady = false;
  let disposed = false;
  let goal: OrbitGoal = { tx: 0, ty: 0, tz: 0, theta: 0, phi: 0.7, dist: 10 };
  let cur: OrbitGoal = goal;
  let limits: OrbitLimits | null = null;
  let home: OrbitGoal = goal;
  let free: { left: number; top: number; right: number; bottom: number } | null = null;
  let offset = { x: 0, y: 0 };

  let hanger: Hanger | null = null;
  let wallCut: WallCut | null = null;
  let stage: Stage | null = null;
  let marker: Marker | null = null;
  let outline: Outline | null = null;
  let input: OrbitInput | null = null;
  let labels: LabelEl[] = [];
  let labelRoot: HTMLDivElement | null = null;
  let tip: HTMLDivElement | null = null;

  let savedFov = cam.fov;
  let savedPortrait = false;
  let savedBackground: THREE.Scene['background'] = null;
  let backgroundSet = false;
  let savedCursor = '';
  let charWasVisible = true;
  let lightsSaved: { hemiC: THREE.Color; hemiG: THREE.Color; hemiI: number; sunC: THREE.Color; sunI: number; sunPos: THREE.Vector3; tgt: THREE.Vector3; visible: boolean; env: number } | null = null;
  let sweepClock = 0;
  let keyClock = 0;
  let hoverClock = 0;
  let occludeClock = 0;
  let hoverEvt: PointerEvt | null = null;
  let hoverClient: { x: number; y: number } | null = null;
  let hoveredId: string | null = null;
  let selectedId: string | null = null;
  const offResize: Array<() => void> = [];

  const walkPos = new THREE.Vector3();
  const walkQuat = new THREE.Quaternion();
  const dollPos = new THREE.Vector3();
  const dollQuat = new THREE.Quaternion();
  const lookTarget = new THREE.Vector3();
  const lookM = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0);
  const proj = new THREE.Vector3();
  const caster = new THREE.Raycaster();

  /** the bearing the key light follows: the camera's, a little after it, so the faces the viewer looks at are the lit ones from whichever side they orbit to */
  let keyBase = 0;
  const keyAzimuth = (): number => keyBase + DOLL_LIGHT.azimuthOffsetDeg * DEG;
  const itemOf = (id: string | null): FurnitureItem | null => (id ? ctx.furniture.all().find((i) => i.id === id) ?? null : null);

  // ---------------------------------------------------------------- light

  /** 0 = the viewer's own light, 1 = the doll house's: moves with the flight */
  let mixK = 0;
  function keyDirection(): THREE.Vector3 {
    const el = DOLL_LIGHT.elevationDeg * DEG, az = keyAzimuth();
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
  }
  const tmpC = new THREE.Color();
  /** lights as the look (or the plain viewer) set them, moved `mixK` of the way to the doll house's */
  function lightValues(l: { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight; scene: THREE.Scene; shadows: boolean }): void {
    if (!bounds) return;
    const k = mixK;
    const c = boundsCentre(bounds), r = boundsRadius(bounds);
    const scale = d.outdoor ? 1.25 : 1;
    l.hemi.color.lerp(tmpC.set(DOLL_LIGHT.hemiSky), k);
    l.hemi.groundColor.lerp(tmpC.set(DOLL_LIGHT.hemiGround), k);
    l.hemi.intensity += (DOLL_LIGHT.hemi * scale - l.hemi.intensity) * k;
    // no shadow map (the low tier): the sun would flood every floor the same, so it gives way to the fill
    const sunI = DOLL_LIGHT.sun * scale * (l.shadows ? 1 : 0.62);
    if (k > 0.02) l.sun.visible = true;
    l.sun.color.lerp(tmpC.set(DOLL_LIGHT.sunColour), k);
    l.sun.intensity += (sunI - l.sun.intensity) * k;
    if (k > 0.5) {
      l.sun.target.position.copy(c);
      l.sun.target.updateMatrixWorld();
      l.sun.position.copy(c).addScaledVector(keyDirection(), r * 1.5);
      const sc = l.sun.shadow.camera;
      sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = r * 0.4; sc.far = r * 2.8;
      sc.updateProjectionMatrix();
      l.sun.shadow.bias = -0.0004; l.sun.shadow.normalBias = 0.03;
      l.sun.castShadow = l.shadows;
    }
    if (l.scene.environment) l.scene.environmentIntensity += (DOLL_LIGHT.env - l.scene.environmentIntensity) * k;
  }
  const override: LightOverride = {
    // the hour moves from the viewer's own to noon with the flight (the grade, the sun, the exposure all follow it), so there is no jump
    get hour() { return (look?.hour ?? DOLL_LIGHT.hour) + (DOLL_LIGHT.hour - (look?.hour ?? DOLL_LIGHT.hour)) * mixK; },
    get bakedOff() { return mixK > 0.5; },
    get noReflection() { return mixK > 0.5; },
    get noDaylight() { return mixK > 0.5; },
    get exposureScale() { return 1 + (DOLL_LIGHT.exposure - 1) * mixK; },
    holdSky: true,
    apply: (l) => { if (!look?.trueColours) lightValues(l); },
  };
  function applyLight(): void {
    if (look) { look.setLightOverride(override); return; }
    // no look (the plain viewer): set the two lights by hand and remember what they were
    const { hemi, sun } = viewer.lights;
    if (!lightsSaved) lightsSaved = { hemiC: hemi.color.clone(), hemiG: hemi.groundColor.clone(), hemiI: hemi.intensity, sunC: sun.color.clone(), sunI: sun.intensity, sunPos: sun.position.clone(), tgt: sun.target.position.clone(), visible: sun.visible, env: viewer.scene.environmentIntensity };
    const s = lightsSaved;
    hemi.color.copy(s.hemiC); hemi.groundColor.copy(s.hemiG); hemi.intensity = s.hemiI; sun.color.copy(s.sunC); sun.intensity = s.sunI;
    lightValues({ hemi, sun, scene: viewer.scene, shadows: false });
  }
  function restoreLight(): void {
    if (look) { look.setLightOverride(null); return; }
    const s = lightsSaved;
    if (!s) return;
    const { hemi, sun } = viewer.lights;
    hemi.color.copy(s.hemiC); hemi.groundColor.copy(s.hemiG); hemi.intensity = s.hemiI;
    sun.color.copy(s.sunC); sun.intensity = s.sunI; sun.position.copy(s.sunPos); sun.target.position.copy(s.tgt); sun.visible = s.visible; sun.castShadow = false;
    viewer.scene.environmentIntensity = s.env;
    lightsSaved = null;
  }
  function setMix(k: number): void {
    if (Math.abs(k - mixK) < 1e-4) return;
    mixK = k;
    applyLight();
    // the backdrop is a colour from the middle of the flight (the sky picture is only ever seen through a window from inside)
    if (k > 0.3 && !backgroundSet) { viewer.scene.background = new THREE.Color(DOLL_BACKDROP); backgroundSet = true; }
    else if (k <= 0.3 && backgroundSet) { viewer.scene.background = savedBackground; backgroundSet = false; }
  }

  // ---------------------------------------------------------------- the picture the panels leave free

  function measurePanels(): Panel[] {
    const out: Panel[] = [];
    const sel = '.wt-id, .wt-topbar, .wt-nav-map, .wt-nav-bar, .wt-slot > *';
    d.labelHost.ownerDocument.querySelectorAll<HTMLElement>(sel).forEach((e) => {
      if (e.hidden || e.closest('[hidden]')) return;
      const r = e.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    });
    return out;
  }

  function frame(): void {
    if (!bounds) return;
    const W = Math.max(1, viewer.canvas.clientWidth), H = Math.max(1, viewer.canvas.clientHeight);
    const aspect = cam.aspect > 0 ? cam.aspect : 1.6;
    const fov = dollFov(aspect);
    free = freeRect(measurePanels(), W, H);
    const fill = { x: (free.right - free.left) / W, y: (free.bottom - free.top) / H };
    offset = { x: (free.left + free.right) / 2 - W / 2, y: (free.top + free.bottom) / 2 - H / 2 };
    const r = initialOrbit(bounds, { fovVDeg: fov, aspect, entrance: d.entrance, margin: 1.06, fill });
    limits = r.limits;
    home = r.goal;
  }
  function fovBase(): number { return ctx.camera.firstPerson ? 70 : (cam.aspect < 1 ? 70 : 60); }

  // ---------------------------------------------------------------- build and tear down

  function build(): void {
    if (on || !bounds || disposed) return;
    on = true;
    steady = false;
    savedFov = cam.fov;
    savedPortrait = cam.aspect < 1;
    savedBackground = viewer.scene.background;
    backgroundSet = false;
    charWasVisible = d.character.object.visible;
    frame();
    goal = { ...home };
    cur = { ...home };
    keyBase = home.theta;
    hanger = hasRoof ? createHanger({ scene: viewer.scene, wallH: layout.wallHeightM, furnitureRoot: d.furnitureRoot, renderer: viewer.renderer }) : null;
    wallCut = createWallCut({ scene: viewer.scene, shell: d.shell, layout, skipEdges: d.skipEdges, furnitureRoot: d.furnitureRoot, renderer: viewer.renderer });
    stage = createStage({ scene: viewer.scene, layout, bounds, keyAzimuth: keyAzimuth(), ground: true, shadow: !d.outdoor, backdrop: DOLL_BACKDROP });
    marker = createMarker(viewer.scene);
    outline = createOutline(viewer.scene);
    mixK = 0;
    applyLight();
    buildLabels();
    tip = document.createElement('div');
    tip.className = 'wt-views-tip';
    tip.hidden = true;
    tip.setAttribute('aria-hidden', 'true');
    d.labelHost.appendChild(tip);
    savedCursor = viewer.canvas.style.cursor;
    viewer.canvas.style.cursor = 'grab';
    input = attachOrbitInput({
      canvas: viewer.canvas,
      getGoal: () => goal,
      setGoal: (g) => { goal = g; },
      limits: () => limits ?? initialOrbit(bounds, { fovVDeg: 42, aspect: 1.6 }).limits,
      fovDeg: () => cam.fov,
      enabled: () => steady,
      onTap: (e) => { if (steady) tap(e); },
      onHover: (e) => { hoverEvt = e; hoverClient = e ? { x: e.clientX, y: e.clientY } : null; if (!e) setHover(null); },
      onEscape: () => d.onEscape(),
      onGrab: () => { setHover(null); },
      claim: d.furnish ? { down: (e) => steady && d.furnish!.active() && d.furnish!.down(e), move: (e) => d.furnish!.move(e), up: (e) => d.furnish!.up(e) } : undefined,
      keysThrough: () => !!d.furnish?.active(),
    });
    offResize.push(viewer.onResize(() => { if (on) { const g = goal; frame(); goal = g; } }));
  }

  function teardown(): void {
    if (!on) return;
    on = false;
    steady = false;
    input?.dispose(); input = null;
    for (const f of offResize.splice(0)) f();
    clearSelection();
    setHover(null);
    outline?.dispose(); outline = null;
    marker?.dispose(); marker = null;
    stage?.dispose(); stage = null;
    wallCut?.release(); wallCut = null;
    hanger?.release(); hanger = null;
    for (const l of labels) l.el.remove();
    labels = [];
    labelRoot?.remove(); labelRoot = null;
    tip?.remove(); tip = null;
    restoreLight();
    mixK = 0;
    if (backgroundSet) { viewer.scene.background = savedBackground; backgroundSet = false; }
    viewer.canvas.style.cursor = savedCursor;
    // the walker's own field of view and body come back; the walk's camera sets its own pose next frame
    const portraitNow = cam.aspect < 1;
    cam.fov = portraitNow !== savedPortrait || !(savedFov > 0) ? fovBase() : savedFov;
    cam.clearViewOffset();
    cam.updateProjectionMatrix();
    d.character.setVisible(charWasVisible);
  }

  // ---------------------------------------------------------------- room names

  function buildLabels(): void {
    labelRoot = document.createElement('div');
    labelRoot.className = 'wt-views-labels';
    labelRoot.setAttribute('aria-hidden', 'true');
    d.labelHost.appendChild(labelRoot);
    const byId = new Map(d.chips.map((c) => [c.id, c]));
    const all = ctx.furniture.all();
    labels = [];
    for (const room of layout.rooms) {
      const chip = byId.get(room.id);
      if (!chip || room.polygon.length < 3) continue;
      const el = document.createElement('div');
      el.className = `wt-views-label${chip.partial ? ' is-partial' : ''}`;
      const nameEl = document.createElement('span'); nameEl.className = 'wt-views-label-name'; nameEl.textContent = chip.label;
      const areaEl = document.createElement('span'); areaEl.className = 'wt-views-label-area'; areaEl.textContent = chip.area;
      el.append(nameEl, areaEl);
      el.style.opacity = '0';
      areaEl.hidden = true;
      labelRoot.appendChild(el);
      const xs = room.polygon.map((q) => q.x), zs = room.polygon.map((q) => q.z);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const spots: Vec2[] = [labelPoint(room.polygon)];
      for (const fx of [0.5, 0.25, 0.75]) for (const fz of [0.5, 0.25, 0.75]) {
        const q = { x: x0 + (x1 - x0) * fx, z: z0 + (z1 - z0) * fz };
        if (pointInPolygon(q, room.polygon)) spots.push(q);
      }
      const boxes = all.filter((i) => pointInPolygon({ x: i.box.cx, z: i.box.cz }, room.polygon)).map((i) => ({ cx: i.box.cx, cz: i.box.cz, w: i.box.w, d: i.box.d }));
      const areaM2 = Math.abs(polygonArea(room.polygon));
      const v = spots.map((q) => new THREE.Vector3(q.x, 0.12, q.z));
      labels.push({ el, nameEl, areaEl, chip, spots: v, boxes, at: v[0].clone(), weight: areaM2, tiny: isTinyRoom(areaM2) || chip.partial, areaM2, w: 0, h: 0, sx: 0, sy: 0, visibleNow: false, shown: 0, expanded: false, hovered: false, found: true });
    }
  }

  function updateLabels(dt: number, visible: boolean): void {
    if (!labelRoot) return;
    const rect = viewer.canvas.getBoundingClientRect();
    const cands: LabelCandidate[] = [];
    const camPos = cam.position;
    for (const l of labels) {
      // the pointer is on this tag: a dot opens, and a name shows its size
      l.hovered = !!hoverClient && Math.abs(hoverClient.x - rect.left - l.sx) < Math.max(l.w, 16) / 2 + 6 && Math.abs(hoverClient.y - rect.top - l.sy) < Math.max(l.h, 16) / 2 + 6 && l.shown > 0.2;
      const close = showsArea(false, cur.dist, home.dist);
      const dot = l.tiny && !l.hovered && !close;
      const withArea = l.hovered || close;
      if (dot !== !!l.el.classList.contains('is-dot') || withArea !== l.expanded) {
        l.el.classList.toggle('is-dot', dot);
        l.areaEl.hidden = !withArea || dot;
        l.expanded = withArea;
        l.w = 0;
      }
      if (l.w === 0) { l.w = l.el.offsetWidth || (dot ? 12 : 8 + l.chip.label.length * 6.5); l.h = l.el.offsetHeight || (dot ? 12 : 22); }
      proj.copy(l.at).project(cam);
      const ok = visible && l.found && proj.z > -1 && proj.z < 1 && Math.abs(proj.x) < 1.02 && Math.abs(proj.y) < 1.02;
      l.sx = ((proj.x + 1) / 2) * rect.width;
      l.sy = ((1 - proj.y) / 2) * rect.height;
      l.el.style.transform = `translate(${l.sx - l.w / 2}px, ${l.sy - l.h / 2}px)`;
      cands.push({ id: l.chip.id, sx: l.sx, sy: l.sy, ok, w: l.w, h: l.h, dist: camPos.distanceTo(l.at), weight: l.hovered ? 1e9 : l.weight });
    }
    const placed = placeLabels(cands, { near: cur.dist * 1.0, far: cur.dist * 1.7, gap: 2 });
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      const want = placed[i].opacity;
      l.shown += (want - l.shown) * (1 - Math.exp(-dt * 12));
      l.el.style.opacity = l.shown < 0.01 ? '0' : l.shown.toFixed(2);
    }
  }

  /** a room name goes where its room can be seen and nothing stands: of the places in it no wall hides from here, the one with the least furniture under it */
  function updateOcclusion(): void {
    const targets = [d.shell];
    const camPos = cam.position;
    const dir = new THREE.Vector3();
    const seeSpot = (spot: THREE.Vector3): boolean => {
      dir.copy(spot).sub(camPos);
      const dist = dir.length();
      caster.set(camPos, dir.normalize());
      caster.far = dist - 0.05;
      return !caster.intersectObjects(targets, true).some((h) => !h.object.name.startsWith('ceiling:') && (h.object as THREE.Mesh).isMesh);
    };
    for (const l of labels) {
      // visible spots, tested from the least crowded: a few rays a room
      const ranked = l.spots.map((s, i) => ({ i, cov: coverage(s.x, s.z, l.boxes) })).sort((a, b) => a.cov - b.cov || a.i - b.i);
      let chosen = -1;
      for (const r of ranked) { if (seeSpot(l.spots[r.i])) { chosen = r.i; break; } }
      l.found = chosen >= 0;
      if (chosen >= 0) l.at.copy(l.spots[chosen]);
    }
  }

  // ---------------------------------------------------------------- hover, tap

  function setHover(id: string | null): void {
    if (id === hoveredId) return;
    hoveredId = id;
    syncOutline();
    if (!id && tip) tip.hidden = true;
    viewer.canvas.style.cursor = on ? (id ? 'pointer' : 'grab') : savedCursor;
  }
  function syncOutline(): void {
    if (!outline) return;
    const roots: THREE.Object3D[] = [];
    for (const id of new Set([selectedId, hoveredId])) {
      const m = id ? ctx.furniture.mesh(id) : undefined;
      if (m) roots.push(m);
    }
    outline.set(roots.length ? roots : null);
  }
  function clearSelection(): void {
    if (selectedId === null) return;
    selectedId = null;
    ctx.hud.hideCard();
    syncOutline();
  }

  function pieceAt(e: PointerEvt): FurnitureItem | null {
    const hit = ctx.pickAt?.(e) ?? null;
    if (!hit || hit.kind !== 'item') return null;
    return itemOf(hit.id);
  }

  function tap(e: PointerEvt): void {
    if (d.furnish?.active()) { d.furnish.tap(e); return; } // Furnish selects and moves through its own session
    const item = pieceAt(e);
    if (item) {
      selectedId = item.id;
      ctx.hud.showCard(d.cardFor(item));
      syncOutline();
      if (tip) tip.hidden = true;
      return;
    }
    if (selectedId) clearSelection();
    const hit = ctx.raycast(e);
    if (hit) {
      const name = hit.object.name;
      if (name.startsWith('floor:') || name.startsWith('threshold:')) {
        const rid = typeof hit.object.userData.roomId === 'string' ? (hit.object.userData.roomId as string) : null;
        d.onFloorTap({ x: hit.point.x, z: hit.point.z }, rid);
      }
      return; // a wall, a cap, a frame: nothing to go to
    }
    if (d.outdoor) {
      const p = ctx.raycastFloor(e);
      if (p) d.onFloorTap(p, null);
    }
  }

  function updateHover(dt: number): void {
    hoverClock += dt;
    if (hoverClock < 0.06) return;
    hoverClock = 0;
    if (d.furnish?.active()) { if (hoveredId) setHover(null); return; }
    if (!steady || !hoverEvt) { if (!hoverEvt && hoveredId) setHover(null); return; }
    const item = pieceAt(hoverEvt);
    setHover(item ? item.id : null);
    if (tip) {
      const text = item ? d.promptFor(item) ?? item.label : null;
      if (item && text && hoverClient) {
        tip.textContent = text;
        tip.hidden = false;
        const r = viewer.canvas.getBoundingClientRect();
        tip.style.transform = `translate(${Math.round(hoverClient.x - r.left)}px, ${Math.round(hoverClient.y - r.top)}px)`;
      } else tip.hidden = true;
    }
  }

  // ---------------------------------------------------------------- the camera

  function applyCamera(dt: number, flight: Flight): void {
    cur = dampOrbit(cur, goal, dt);
    const p = orbitPosition(cur);
    dollPos.set(p.x, p.y, p.z);
    lookTarget.set(cur.tx, cur.ty, cur.tz);
    lookM.lookAt(dollPos, lookTarget, UP);
    dollQuat.setFromRotationMatrix(lookM);
    const a = flight.amount;
    const aspect = cam.aspect > 0 ? cam.aspect : 1.6;
    if (a < 1) {
      // the walk's camera has just run: its pose is the start (or the end, flying back down)
      walkPos.copy(cam.position);
      walkQuat.copy(cam.quaternion);
      cam.position.lerpVectors(walkPos, dollPos, a);
      cam.quaternion.slerpQuaternions(walkQuat, dollQuat, a);
      cam.fov = savedFov + (dollFov(aspect) - savedFov) * a;
    } else {
      cam.position.copy(dollPos);
      cam.quaternion.copy(dollQuat);
      cam.fov = dollFov(aspect);
    }
    // the model sits in the part of the picture the panels leave free: the view is shifted, by the flight's share of that shift
    const W = Math.max(1, viewer.canvas.clientWidth), H = Math.max(1, viewer.canvas.clientHeight);
    cam.setViewOffset(W, H, -offset.x * a, -offset.y * a, W, H);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  return {
    update(dt, flight, planCover = 0) {
      if (disposed) return;
      if (flight.raw > 0 && !on) build();
      if (!on) return;
      if (flight.raw === 0 && !flight.moving) { teardown(); return; }
      steady = flight.amount >= 1;
      setMix(flight.amount);
      hanger?.apply(flight.raw);
      sweepClock += dt;
      if (sweepClock > 0.5) { sweepClock = 0; hanger?.sweep(); }
      applyCamera(dt, flight);
      // the key swings round with the camera (at most four times a second: on the one-shot shadow map of the medium tier each swing is one shadow pass)
      keyClock += dt;
      if (keyClock > 0.25 && Math.abs(Math.atan2(Math.sin(cur.theta - keyBase), Math.cos(cur.theta - keyBase))) > 0.12) { keyClock = 0; keyBase = cur.theta; const k = mixK; mixK = -1; setMix(k); }
      // the walls that stand between the camera and the rooms come down once the ceiling is going, and follow the camera as it orbits
      wallCut?.update(dt, smootherstep((flight.raw - 0.4) / 0.6), { x: Math.sin(cur.theta), z: Math.cos(cur.theta) });
      // the body stays out of the picture once the flight is under way; the marker says where it stands
      if (flight.dir === -1 && flight.raw < 0.4) d.character.setVisible(charWasVisible);
      else if (flight.raw > 0.08) d.character.setVisible(false);
      if (marker) {
        const k = smootherstep(Math.min(1, flight.raw * 1.6));
        marker.setVisible(k > 0.02);
        marker.set(d.character.position.x, d.character.position.z, ctx.camera.viewYawDeg, cur.dist * 0.042 * k);
      }
      // the name tags' wall tests are a few rays each: twice as seldom on the low tier
      occludeClock += dt;
      if (occludeClock > (d.tier() === 'low' ? 0.5 : 0.2)) { occludeClock = 0; updateOcclusion(); }
      updateLabels(dt, flight.amount > 0.6 && planCover < 0.05);
      if (planCover > 0.05 && tip) tip.hidden = true;
      updateHover(dt);
      if (outline?.active) {
        const s = viewer.renderer.getPixelRatio();
        outline.update(viewer.canvas.clientWidth, viewer.canvas.clientHeight, s);
      }
    },
    get on() { return on; },
    get steady() { return steady; },
    debug() {
      return { goal: { ...goal }, limits, hovered: hoveredId, selected: selectedId, hanger: hanger?.stats() ?? null, cut: wallCut?.stats() ?? null, free, cameraDistance: cur.dist };
    },
    reset() { frame(); goal = { ...home }; },
    setOrbit(p, instant) {
      goal = {
        ...goal,
        ...(p.theta !== undefined ? { theta: p.theta * DEG } : {}),
        ...(p.elevationDeg !== undefined ? { phi: (90 - p.elevationDeg) * DEG } : {}),
        ...(p.dist !== undefined ? { dist: p.dist } : {}),
        ...(p.tx !== undefined ? { tx: p.tx } : {}),
        ...(p.tz !== undefined ? { tz: p.tz } : {}),
      };
      if (instant) cur = { ...goal };
    },
    setLight(p) {
      Object.assign(DOLL_LIGHT, p);
      if (on) { const k = mixK; mixK = -1; setMix(k); }
    },
    clearSelection,
    dispose() {
      if (disposed) return;
      teardown();
      disposed = true;
    },
  };
}
