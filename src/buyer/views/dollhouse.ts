// The doll house: the whole space seen from above, orbiting. Made when the camera starts to fly up from the walker and taken away completely when it has
// flown back down, so the walk never carries any of it. While it is on:
//   * the ceiling fades out and what hangs from it, or would stand in the way from above, is hidden (hanger.ts); every wall gets a clean cap (stage.ts)
//   * the lighting is its own: a soft key from above and the front, a fill, shadows where the tier has them, set through the look's `setLightOverride`
//   * the camera is a perspective orbit with damping, limited in polar angle, distance and pan (framing.ts), steered by orbit-input.ts, and it flies
//     from the walker's camera to the orbit pose with a smootherstep (the view machine's `flight`)
//   * a marker with a view cone shows where the walker stands, the rooms carry small floating names, a hovered piece glows with its prompt, a tapped
//     piece shows its card, a tapped floor takes the buyer there (mount.ts decides what "there" means)
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
import { boundsCentre, boundsRadius, dampOrbit, dollFov, initialOrbit, layoutBounds, orbitPosition } from './framing';
import type { Bounds, OrbitGoal, OrbitLimits } from './framing';
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
import { labelPoint, placeLabels } from './labels';
import type { LabelCandidate } from './labels';
import { smootherstep } from './view-modes';
import type { Flight } from './view-modes';

const DEG = Math.PI / 180;

/** The doll house's own light (three's units: a hemisphere of intensity pi lights a white surface at its own colour). */
export const DOLL_LIGHT = {
  hemi: 2.35, hemiSky: '#fbfcff', hemiGround: '#e9e4da',
  sun: 1.9, sunColour: '#fff3e4', elevationDeg: 58, azimuthOffsetDeg: 28,
  env: 0.16, hour: 12,
} as const;
export const DOLL_BACKDROP = '#ECEEF2';

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
  /** an open-air space keeps its own ground and has no ceiling to fade */
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
  /** the tier: gates what costs (labels' occlusion tests are cheap; the outline is a second draw of one piece) */
  tier(): 'low' | 'medium' | 'high';
}

export interface Dollhouse {
  /** per frame, after the walk's own camera has run: `flight` comes from the view machine */
  update(dt: number, flight: Flight, planCover?: number): void;
  /** the doll house is up (resources exist) */
  readonly on: boolean;
  /** the camera has arrived and the orbit answers the buyer */
  readonly steady: boolean;
  /** the orbit as it is now, for the checks and the harness */
  debug(): { goal: OrbitGoal; limits: OrbitLimits | null; hovered: string | null; selected: string | null; hanger: ReturnType<Hanger['stats']> | null; cameraDistance: number };
  /** re-frame the whole space (a double tap on the picture, a button, a new mode) */
  reset(): void;
  /** put the orbit at a pose (checks): angles in degrees */
  setOrbit(p: Partial<{ theta: number; elevationDeg: number; dist: number; tx: number; tz: number }>, instant?: boolean): void;
  /** deselects the tapped piece and hides its card */
  clearSelection(): void;
  dispose(): void;
}

interface LabelEl { el: HTMLDivElement; chip: RoomChip; /** candidate places for the tag, best first: the middle of the room, then four more inside it */ spots: THREE.Vector3[]; at: THREE.Vector3; weight: number; w: number; h: number; occlusion: number; shown: number }

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

  let hanger: Hanger | null = null;
  let stage: Stage | null = null;
  let marker: Marker | null = null;
  let outline: Outline | null = null;
  let input: OrbitInput | null = null;
  let labels: LabelEl[] = [];
  let labelRoot: HTMLDivElement | null = null;
  let tip: HTMLDivElement | null = null;

  let savedFov = cam.fov;
  let savedBackground: THREE.Scene['background'] = null;
  let savedCursor = '';
  let charWasVisible = true;
  let lightsSaved: { hemiC: THREE.Color; hemiG: THREE.Color; hemiI: number; sunC: THREE.Color; sunI: number; sunPos: THREE.Vector3; tgt: THREE.Vector3; visible: boolean; env: number } | null = null;
  let sweepClock = 0;
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

  const keyAzimuth = (): number => (limits ? home.theta : 0) + DOLL_LIGHT.azimuthOffsetDeg * DEG;
  const itemOf = (id: string | null): FurnitureItem | null => (id ? ctx.furniture.all().find((i) => i.id === id) ?? null : null);

  // ---------------------------------------------------------------- light

  function keyDirection(): THREE.Vector3 {
    const el = DOLL_LIGHT.elevationDeg * DEG, az = keyAzimuth();
    return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
  }
  function lightValues(l: { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight; scene: THREE.Scene; shadows: boolean; tier: string }): void {
    if (!bounds) return;
    const c = boundsCentre(bounds), r = boundsRadius(bounds);
    l.hemi.color.set(DOLL_LIGHT.hemiSky); l.hemi.groundColor.set(DOLL_LIGHT.hemiGround); l.hemi.intensity = DOLL_LIGHT.hemi;
    l.sun.visible = true;
    l.sun.color.set(DOLL_LIGHT.sunColour);
    // no shadow map (the low tier): the sun would flood every floor the same, so it gives way to the fill
    l.sun.intensity = DOLL_LIGHT.sun * (l.shadows ? 1 : 0.62);
    l.sun.target.position.copy(c);
    l.sun.target.updateMatrixWorld();
    l.sun.position.copy(c).addScaledVector(keyDirection(), r * 1.5);
    const sc = l.sun.shadow.camera;
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = r * 0.4; sc.far = r * 2.8;
    sc.updateProjectionMatrix();
    l.sun.shadow.bias = -0.0004; l.sun.shadow.normalBias = 0.03;
    l.sun.castShadow = l.shadows;
    if (l.scene.environment) l.scene.environmentIntensity = DOLL_LIGHT.env;
  }
  const override: LightOverride = {
    hour: DOLL_LIGHT.hour, bakedOff: true, noReflection: true,
    apply: (l) => { if (!look?.trueColours) lightValues({ ...l, tier: l.cfg.tier }); },
  };
  function applyLight(): void {
    if (look) { look.setLightOverride(override); return; }
    // no look (the plain viewer): set the two lights by hand and remember what they were
    const { hemi, sun } = viewer.lights;
    lightsSaved = { hemiC: hemi.color.clone(), hemiG: hemi.groundColor.clone(), hemiI: hemi.intensity, sunC: sun.color.clone(), sunI: sun.intensity, sunPos: sun.position.clone(), tgt: sun.target.position.clone(), visible: sun.visible, env: viewer.scene.environmentIntensity };
    lightValues({ hemi, sun, scene: viewer.scene, shadows: false, tier: 'low' });
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

  // ---------------------------------------------------------------- build and tear down

  function frame(): void {
    if (!bounds) return;
    const aspect = cam.aspect > 0 ? cam.aspect : 1.6;
    const fov = dollFov(aspect);
    const r = initialOrbit(bounds, { fovVDeg: fov, aspect, entrance: d.entrance, margin: aspect < 1 ? 1.3 : 1.12 });
    limits = r.limits;
    home = r.goal;
  }
  function fovBase(): number { return ctx.camera.firstPerson ? 70 : (cam.aspect < 1 ? 70 : 60); }

  function build(): void {
    if (on || !bounds || disposed) return;
    on = true;
    steady = false;
    savedFov = cam.fov;
    savedBackground = viewer.scene.background;
    charWasVisible = d.character.object.visible;
    frame();
    goal = { ...home };
    cur = { ...home };
    hanger = hasRoof ? createHanger({ scene: viewer.scene, wallH: layout.wallHeightM, furnitureRoot: d.furnitureRoot, renderer: viewer.renderer }) : null;
    stage = createStage({ scene: viewer.scene, layout, bounds, capEdgesSkip: d.skipEdges, keyAzimuth: keyAzimuth(), ground: !d.outdoor });
    marker = createMarker(viewer.scene);
    outline = createOutline(viewer.scene);
    if (!d.outdoor) { viewer.scene.background = new THREE.Color(DOLL_BACKDROP); applyLight(); }
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
    hanger?.release(); hanger = null;
    for (const l of labels) l.el.remove();
    labels = [];
    labelRoot?.remove(); labelRoot = null;
    tip?.remove(); tip = null;
    if (!d.outdoor) { restoreLight(); viewer.scene.background = savedBackground; }
    viewer.canvas.style.cursor = savedCursor;
    // the walker's own field of view and body come back; the walk's camera sets its own pose next frame
    cam.fov = savedFov > 0 ? savedFov : fovBase();
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
    labels = [];
    for (const room of layout.rooms) {
      const chip = byId.get(room.id);
      if (!chip || room.polygon.length < 3) continue;
      const el = document.createElement('div');
      el.className = `wt-views-label${chip.partial ? ' is-partial' : ''}`;
      const name = document.createElement('span'); name.className = 'wt-views-label-name'; name.textContent = chip.label;
      const area = document.createElement('span'); area.className = 'wt-views-label-area'; area.textContent = chip.area;
      el.append(name, area);
      el.style.opacity = '0';
      labelRoot.appendChild(el);
      const p = labelPoint(room.polygon);
      const xs = room.polygon.map((q) => q.x), zs = room.polygon.map((q) => q.z);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2, hx = (Math.max(...xs) - Math.min(...xs)) * 0.32, hz = (Math.max(...zs) - Math.min(...zs)) * 0.32;
      const spots = [p, { x: cx + hx, z: cz }, { x: cx - hx, z: cz }, { x: cx, z: cz + hz }, { x: cx, z: cz - hz }]
        .filter((q, i) => i === 0 || pointInPolygon(q, room.polygon))
        .map((q) => new THREE.Vector3(q.x, 0.12, q.z));
      labels.push({ el, chip, spots, at: spots[0].clone(), weight: Math.abs(polygonArea(room.polygon)), w: 0, h: 0, occlusion: 1, shown: 0 });
    }
  }

  function updateLabels(dt: number, visible: boolean): void {
    if (!labelRoot) return;
    const rect = viewer.canvas.getBoundingClientRect();
    const cands: LabelCandidate[] = [];
    const camPos = cam.position;
    for (const l of labels) {
      if (l.w === 0) { l.w = l.el.offsetWidth || 90; l.h = l.el.offsetHeight || 34; }
      proj.copy(l.at).project(cam);
      const ok = visible && proj.z > -1 && proj.z < 1 && Math.abs(proj.x) < 1.02 && Math.abs(proj.y) < 1.02;
      l.el.style.transform = `translate(${((proj.x + 1) / 2) * rect.width - l.w / 2}px, ${((1 - proj.y) / 2) * rect.height - l.h / 2}px)`;
      cands.push({ id: l.chip.id, sx: ((proj.x + 1) / 2) * rect.width, sy: ((1 - proj.y) / 2) * rect.height, ok, w: l.w, h: l.h, dist: camPos.distanceTo(l.at), weight: l.weight });
    }
    const placed = placeLabels(cands, { near: cur.dist * 1.0, far: cur.dist * 1.55 });
    for (let i = 0; i < labels.length; i++) {
      const l = labels[i];
      const want = placed[i].opacity * l.occlusion;
      l.shown += (want - l.shown) * (1 - Math.exp(-dt * 12));
      l.el.style.opacity = l.shown < 0.01 ? '0' : l.shown.toFixed(2);
    }
  }

  /** a room name goes where its room can be seen: the middle, else another place in it that no wall hides from here, else it is left out */
  function updateOcclusion(): void {
    const targets = [d.shell];
    const camPos = cam.position;
    const dir = new THREE.Vector3();
    for (const l of labels) {
      let found: THREE.Vector3 | null = null;
      for (const spot of l.spots) {
        dir.copy(spot).sub(camPos);
        const dist = dir.length();
        caster.set(camPos, dir.normalize());
        caster.far = dist - 0.05;
        const hit = caster.intersectObjects(targets, true).some((h) => !h.object.name.startsWith('ceiling:') && (h.object as THREE.Mesh).isMesh);
        if (!hit) { found = spot; break; }
      }
      if (found) { l.at.copy(found); l.occlusion = 1; } else l.occlusion = 0;
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
      hanger?.apply(flight.raw);
      sweepClock += dt;
      if (sweepClock > 0.5) { sweepClock = 0; hanger?.sweep(); }
      applyCamera(dt, flight);
      // the body stays out of the picture once the flight is under way; the marker says where it stands
      if (flight.dir === -1 && flight.raw < 0.4) d.character.setVisible(charWasVisible);
      else if (flight.raw > 0.08) d.character.setVisible(false);
      if (marker) {
        const k = smootherstep(Math.min(1, flight.raw * 1.6));
        marker.setVisible(k > 0.02);
        marker.set(d.character.position.x, d.character.position.z, ctx.camera.viewYawDeg, cur.dist * 0.04 * k);
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
      return { goal: { ...goal }, limits, hovered: hoveredId, selected: selectedId, hanger: hanger?.stats() ?? null, cameraDistance: cur.dist };
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
    clearSelection,
    dispose() {
      if (disposed) return;
      teardown();
      disposed = true;
    },
  };
}
