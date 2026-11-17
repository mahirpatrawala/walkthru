// The VR page's logic: one renderer for the whole life of the page, one home at a time, a headset session on top. Everything the viewer does in the
// session goes through here: point and teleport (with a fade), snap turn, doors, the floating panel, swapping homes, leaving. The headset itself is a
// `XrDriver` (driver.ts), so this file runs the same on a real session and on the in-page emulator.
//
// Frames never stop while a home loads: the home's own scene is swapped for an empty black one, and the viewer's fade and a word of "Loading" are drawn
// in it. A headset that stops being given frames shows a frozen picture that does not follow the head, which is the one thing never to do.
import * as THREE from 'three';
import { createViewer } from '../engine/viewer';
import type { Viewer } from '../engine/viewer';
import { roomAt } from '../core/layout-geom';
import { DOOR_RAY_M } from './config';
import { FadeMachine } from './fade';
import { FrameStats, debugLines } from './frame-stats';
import { HomeError, loadHome } from './home';
import type { Home } from './home';
import { keyOfTarget, sceneOfTarget } from './catalogue';
import type { HomeEntry } from './catalogue';
import type { XrDriver, PointerFrame } from './driver';
import { VrPanel } from './panel';
import type { ButtonAction, PanelModel } from './panel-layout';
import { poseFacing, poseOver, cameraYawForSceneYaw, turnAbout } from './pose';
import { SnapTurn, aimTeleport, lineClear, snapDeltaYaw } from './teleport';
import type { V3 } from './teleport';
import { Visuals } from './visuals';
import type { BuildingFile } from '../building/types';
import { xrUrl } from './url';
import type { XrTarget, XrUrl } from './url';

export type AppPhase = 'boot' | 'idle' | 'loading' | 'ready' | 'presenting' | 'error';
export interface AppState {
  phase: AppPhase;
  /** can a session be started here: not known yet, yes, or no (the plain message and the link to the normal site) */
  xr: 'unknown' | 'yes' | 'no';
  target: XrTarget | null;
  homeKey: string | null;
  title: string;
  subtitle: string | null;
  progress: number;
  progressText: string;
  message: string | null;
  presenting: boolean;
  /** `?auto=1` and a home ready: the next tap or key press enters */
  waitingForGesture: boolean;
}

export interface AppOptions {
  container: HTMLElement;
  url: XrUrl;
  homes: HomeEntry[];
  buildings: ReadonlyMap<string, BuildingFile>;
  makeDriver(viewer: Viewer, root: THREE.Group): Promise<XrDriver>;
}

const isGesture = ['pointerdown', 'keydown', 'click'] as const;

export class VrApp {
  readonly viewer: Viewer;
  readonly vis: Visuals;
  readonly fade = new FadeMachine();
  readonly stats = new FrameStats();
  readonly panel: VrPanel;
  driver!: XrDriver;
  home: Home | null = null;
  homes: HomeEntry[];
  private readonly limbo = new THREE.Scene();
  private active: THREE.Scene;
  private readonly offFrame: () => void;
  private readonly snap = { left: new SnapTurn(), right: new SnapTurn(), none: new SnapTurn() };
  private activeHand: 'left' | 'right' | 'none' = 'right';
  private readonly raycaster = new THREE.Raycaster();
  private endOff: (() => void) | null = null;
  private subscribers = new Set<(s: AppState) => void>();
  private gestureListeners: { type: string; fn: () => void }[] = [];
  private lastT = 0;
  private lastCpu = 0;
  private debugClock = 0;
  private roomClock = 0;
  private needPlace = false;
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;
  private disposed = false;
  private previewT = 0;
  private target: XrTarget | null = null;
  private lastDebug: string[] = [];
  /** the pointer objects, in the order the driver returns frames */
  private pointerObjs: THREE.Object3D[] = [];
  state: AppState = { phase: 'boot', xr: 'unknown', target: null, homeKey: null, title: '', subtitle: null, progress: 0, progressText: '', message: null, presenting: false, waitingForGesture: false };

  constructor(readonly opts: AppOptions) {
    this.homes = opts.homes;
    this.viewer = createViewer(opts.container, { hasSplat: false });
    this.vis = new Visuals(this.viewer.camera);
    this.limbo.background = new THREE.Color(0x000000);
    this.limbo.add(this.vis.root);
    this.active = this.limbo;
    this.panel = new VrPanel({ title: '', subtitle: '', rooms: [], homes: [], currentHomeKey: null, currentRoomId: null, roomPage: 0, homePage: 0 });
    this.vis.root.add(this.panel.group);
    this.viewer.setRenderOverride(() => {
      this.viewer.renderer.info.reset();
      this.viewer.renderer.render(this.active, this.viewer.camera);
    });
    this.offFrame = this.viewer.onFrame((dt) => this.tick(dt));
  }

  // ------------------------------------------------------------------ state

  onState(cb: (s: AppState) => void): () => void { this.subscribers.add(cb); cb(this.state); return () => { this.subscribers.delete(cb); }; }
  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const cb of [...this.subscribers]) { try { cb(this.state); } catch (err) { console.error('[walkthru-vr] a state listener threw', err); } }
  }

  async init(): Promise<void> {
    try {
      this.driver = await this.opts.makeDriver(this.viewer, this.vis.root);
      this.vis.dress(this.driver.pointerObjects());
      this.pointerObjs = this.driver.pointerObjects();
      this.vis.setPointersVisible(false);
      const ok = await this.driver.supported();
      this.set({ xr: ok ? 'yes' : 'no', phase: 'idle' });
    } catch (err) {
      console.warn('[walkthru-vr] the headset check failed', err);
      this.set({ xr: 'no', phase: 'idle' });
    }
  }

  // ------------------------------------------------------------------ homes

  private entryFor(t: XrTarget): HomeEntry | undefined {
    const key = keyOfTarget(t);
    return this.homes.find((h) => h.key === key) ?? this.homes.find((h) => h.sceneId === sceneOfTarget(t, this.opts.buildings));
  }

  /** Opens a home from the landing page (or the address). Resolves when it is ready or has failed. Calls queue: only the last one asked for stays. */
  openHome(t: XrTarget): Promise<void> {
    const n = ++this.seq;
    const run = this.queue.then(() => (n === this.seq ? this.load(t, false) : undefined));
    this.queue = run.catch(() => {});
    return run;
  }

  /** Builds `t`, swaps it in for the current home and puts the viewer at its start. */
  private async load(t: XrTarget, inSession: boolean): Promise<void> {
    if (this.disposed) return;
    const sceneId = sceneOfTarget(t, this.opts.buildings);
    const entry = this.entryFor(t);
    if (!sceneId) { this.set({ phase: 'error', message: 'That place is not in this building.', target: t }); return; }
    this.removeGestureListeners();
    this.unmount();
    this.set({ phase: 'loading', target: t, homeKey: entry?.key ?? null, title: entry?.label ?? '', subtitle: entry?.sub ?? null, progress: 0, progressText: 'Starting', message: null, waitingForGesture: false });
    this.vis.setLoading(inSession ? `Loading ${entry?.label ?? 'the home'}` : null);
    const pack = t.kind === 'space' ? this.opts.buildings.get(t.building)?.levels.flatMap((l) => l.spaces).find((s) => s.id === t.space)?.pack ?? null : null;
    try {
      const home = await loadHome(sceneId, this.viewer, {
        quality: this.opts.url.quality, room: t.kind === 'scene' ? t.room ?? null : null, pack,
        toast: (text) => this.say(text),
        progress: (f, text) => this.set({ progress: f, progressText: text }),
      });
      if (this.disposed) { home.dispose(); return; }
      this.mount(home, t, entry);
      if (inSession) this.placeAtSpawn();
      this.vis.setLoading(null);
      try { history.replaceState(null, '', xrUrl(t, location.search)); } catch { /* an address that cannot be rewritten */ }
      this.set({ phase: this.driver?.isPresenting() ? 'presenting' : 'ready', title: home.title, subtitle: home.subtitle, progress: 1, message: null });
      if (!this.driver?.isPresenting()) this.armAuto();
    } catch (err) {
      this.vis.setLoading(null);
      const msg = err instanceof HomeError ? err.message : `Could not open this home. ${err instanceof Error ? err.message : String(err)}`;
      console.error('[walkthru-vr] could not open the home', err);
      this.set({ phase: 'error', message: msg });
      this.panel.update({ status: msg });
    }
  }

  private mount(home: Home, t: XrTarget, entry: HomeEntry | undefined): void {
    this.home = home;
    this.target = t;
    this.active = home.scene;
    home.scene.add(this.vis.root);
    this.panel.update(this.panelModel(home, entry?.key ?? null, null));
    this.set({ target: t, homeKey: entry?.key ?? null });
  }

  /** Takes the home down: the page's own things go to the empty scene first, then everything the home made is given back. */
  private unmount(): void {
    const h = this.home;
    this.panel.hide();
    this.vis.setArc(null, null);
    this.vis.setDoor(null, '', null);
    this.limbo.add(this.vis.root);
    this.active = this.limbo;
    this.home = null;
    h?.dispose();
  }

  private panelModel(home: Home, key: string | null, currentRoomId: string | null): Partial<PanelModel> {
    return {
      title: home.title, subtitle: home.subtitle ?? '',
      rooms: home.rooms.map((r) => ({ id: r.id, label: r.label, area: r.area, goable: r.goable })),
      homes: this.homes.map((h) => ({ key: h.key, label: h.label, sub: h.sub })),
      currentHomeKey: key, currentRoomId, roomPage: 0, homePage: 0, status: null,
    };
  }

  // ------------------------------------------------------------------ the session

  async enter(): Promise<void> {
    if (!this.home || !this.driver || this.driver.isPresenting() || this.disposed) return;
    this.removeGestureListeners();
    this.set({ message: null, waitingForGesture: false });
    try {
      await this.driver.start();
    } catch (err) {
      console.warn('[walkthru-vr] the session was refused', err);
      this.set({ message: 'The headset did not start VR. Try again, or check that the browser may use VR.', phase: this.home ? 'ready' : 'idle' });
      this.armAuto();
      return;
    }
    this.stats.reset();
    this.endOff?.();
    this.endOff = this.driver.onEnd(() => this.sessionEnded());
    this.vis.setPointersVisible(true);
    this.vis.setFade(1);
    this.fade.startFromBlack();
    this.needPlace = true;
    this.set({ phase: 'presenting', presenting: true });
  }

  async exit(): Promise<void> {
    if (!this.driver?.isPresenting()) return;
    await this.driver.stop();
  }

  /** The session is over, from the viewer's side or the system's: everything of the session goes, the home stays for the landing page's preview. */
  private sessionEnded(): void {
    this.endOff?.(); this.endOff = null;
    this.panel.hide();
    this.fade.reset();
    this.vis.rest();
    this.vis.setPointersVisible(false);
    for (const k of ['left', 'right', 'none'] as const) this.snap[k].reset();
    this.needPlace = false;
    this.stats.reset();
    this.set({ phase: this.home ? 'ready' : 'idle', presenting: false, message: null });
    this.armAuto();
  }

  private placeAtSpawn(): void {
    const home = this.home;
    if (!home || !this.driver.isPresenting()) return;
    const l = this.driver.head().local;
    this.driver.setPose(poseFacing(l, l.yaw, { x: home.spawn.x, z: home.spawn.z }, home.spawn.yawDeg));
  }

  // ------------------------------------------------------------------ ?auto=1

  private armAuto(): void {
    if (!this.opts.url.auto || this.state.xr !== 'yes' || !this.home || this.gestureListeners.length || this.driver?.isPresenting()) return;
    const go = (): void => { void this.enter(); };
    for (const type of isGesture) { window.addEventListener(type, go); this.gestureListeners.push({ type, fn: go }); }
    this.set({ waitingForGesture: true });
  }
  private removeGestureListeners(): void {
    for (const l of this.gestureListeners.splice(0)) window.removeEventListener(l.type, l.fn);
  }

  // ------------------------------------------------------------------ the frame

  private say(text: string): void {
    if (this.driver?.isPresenting()) { const h = this.driver.head(); this.vis.toast(text, h.world, h.forward); }
    else this.set({ message: text });
  }

  private tick(dt: number): void {
    if (this.disposed || !this.driver) return;
    const t0 = performance.now();
    const dtMs = this.lastT ? t0 - this.lastT : 0;
    this.lastT = t0;
    this.stats.push(dtMs, this.lastCpu);
    this.driver.beginFrame();
    const presenting = this.driver.isPresenting();
    this.fade.update(dt);
    this.vis.setFade(this.fade.alpha);
    this.vis.update(dt);
    if (presenting) {
      const head = this.driver.head();
      if (this.needPlace) { this.needPlace = false; this.placeAtSpawn(); }
      if (this.home) {
        this.home.setWalker({ x: head.world.x, z: head.world.z });
        this.interact(head.world, head.forward);
        this.roomClock += dt;
        if (this.panel.isOpen && this.roomClock > 0.25) {
          this.roomClock = 0;
          const r = roomAt(this.home.layout, { x: head.world.x, z: head.world.z });
          if ((r?.id ?? null) !== this.panel.current.currentRoomId) this.panel.update({ currentRoomId: r?.id ?? null });
        }
      }
    } else this.preview(dt);
    this.debugClock += dt;
    if (this.debugClock > 0.5) { this.debugClock = 0; this.refreshDebug(presenting); }
    this.lastCpu = performance.now() - t0;
  }

  /** On the landing page: the view from where the viewer would start, turning slowly. */
  private preview(dt: number): void {
    const home = this.home;
    if (!home) return;
    this.previewT += dt;
    const cam = this.viewer.camera;
    cam.position.set(home.spawn.x, 1.6, home.spawn.z);
    cam.rotation.set(-0.04, cameraYawForSceneYaw(home.spawn.yawDeg) + Math.sin(this.previewT * 0.18) * 0.55, 0, 'YXZ');
    cam.updateMatrixWorld(true);
  }

  private refreshDebug(presenting: boolean): void {
    if (!this.opts.url.debug) return;
    const inf = this.viewer.renderer.info;
    const lines = debugLines(this.stats.summary(), {
      calls: inf.render.calls, triangles: inf.render.triangles, geometries: inf.memory.geometries, textures: inf.memory.textures,
      hz: this.driver.hz(), presenting, scale: this.driver.scale(),
    });
    this.lastDebug = lines;
    if (!presenting) return;
    this.vis.debug.mesh.visible = true;
    this.vis.debug.draw((ctx, w, h) => {
      ctx.fillStyle = 'rgba(15, 12, 10, 0.82)'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#E3A33A'; ctx.font = "700 30px 'Avenir Next', system-ui, sans-serif"; ctx.textBaseline = 'middle';
      lines.forEach((l, i) => { ctx.fillText(l, 22, 40 + i * 54); });
    });
  }
  debugLinesNow(): string[] { return this.lastDebug; }

  // ------------------------------------------------------------------ the viewer's hands

  private interact(head: V3, forward: V3): void {
    const home = this.home!;
    const frames = this.driver.frames();
    const busy = this.fade.busy;
    for (const f of frames) {
      if (!f.tracked) continue;
      if (f.menuPressed || f.triggerPressed) this.activeHand = f.hand;
      if (f.menuPressed && !busy) this.togglePanel(head, forward);
      const k = this.snap[f.hand].update(f.stickX);
      if (k !== 0 && !busy) this.driver.setPose(turnAbout(this.driver.pose, { x: head.x, z: head.z }, snapDeltaYaw(k)));
    }
    let used = frames.findIndex((f) => f.tracked && f.hand === this.activeHand);
    if (used < 0) used = frames.findIndex((f) => f.tracked);
    frames.forEach((f, i) => { if (i !== used) this.vis.setLine(this.pointerObjs[i] ?? this.dummyObj, null); });
    if (used < 0) { this.vis.setArc(null, null); this.vis.setDoor(null, '', null); return; }
    this.point(frames[used], this.pointerObjs[used], head, busy, home);
  }
  private readonly dummyObj = new THREE.Object3D();

  private togglePanel(head: V3, forward: V3): void {
    if (this.panel.isOpen) { this.panel.hide(); return; }
    const home = this.home;
    if (home) { const r = roomAt(home.layout, { x: head.x, z: head.z }); this.panel.update({ currentRoomId: r?.id ?? null }); }
    this.panel.show(head, forward);
  }

  private point(f: PointerFrame, obj: THREE.Object3D, head: V3, busy: boolean, home: Home): void {
    const ray = { origin: f.origin, dir: f.dir };
    if (this.panel.isOpen) {
      this.vis.setArc(null, null); this.vis.setDoor(null, '', null);
      const hit = this.panel.pointAt(ray);
      this.vis.setLine(obj, hit ? hit.distM : 1.6, hit?.button?.enabled ? 0xe3a33a : 0xfffdf8);
      if (f.triggerPressed && hit?.button && !busy) {
        const act = this.panel.press(hit.button);
        this.driver.haptic(f.hand, 0.3, 25);
        if (act) this.panelAction(act);
      }
      return;
    }
    const door = this.pickDoor(ray, home);
    if (door) {
      this.vis.setArc(null, null);
      this.vis.setLine(obj, door.distM, 0xe3a33a);
      this.vis.setDoor(door.point, home.doorPrompt(door.id) ?? 'Door', head);
      if (f.triggerPressed && !busy) { void home.toggleDoor(door.id); this.driver.haptic(f.hand, 0.5, 40); }
      return;
    }
    this.vis.setDoor(null, '', null);
    this.vis.setLine(obj, null);
    const aim = aimTeleport(home.grid(), home.layout, f.origin, f.dir);
    const landing = aim.end.kind === 'floor' && aim.check ? { point: aim.end.point, ok: aim.check.ok } : null;
    this.vis.setArc(aim.end.points, landing);
    if (f.triggerPressed && !busy) {
      if (aim.check?.ok) { this.driver.haptic(f.hand, 0.4, 30); void this.teleportTo({ x: aim.check.x, z: aim.check.z }); }
      else if (aim.check) this.say(aim.check.reason === 'blocked' ? 'Something is in the way there.' : 'You can only go to the floor of a room.');
    }
  }

  private pickDoor(ray: { origin: V3; dir: V3 }, home: Home): { id: string; point: V3; distM: number } | null {
    const roots = home.doorRoots();
    if (roots.length === 0) return null;
    this.raycaster.set(new THREE.Vector3(ray.origin.x, ray.origin.y, ray.origin.z), new THREE.Vector3(ray.dir.x, ray.dir.y, ray.dir.z));
    this.raycaster.far = DOOR_RAY_M;
    for (const h of this.raycaster.intersectObjects(roots, true)) {
      const id = home.doorIdOf(h.object);
      if (!id) continue;
      // a door behind a wall is not offered
      if (!lineClear(home.grid(), ray.origin, h.point, 0.3)) return null;
      return { id, point: { x: h.point.x, y: h.point.y, z: h.point.z }, distM: h.distance };
    }
    return null;
  }

  /** Fades out, moves the viewer so their head is over `spot` (turning them to face `yawDeg` when given, else keeping the way they face), fades in. */
  teleportTo(spot: { x: number; z: number }, yawDeg?: number): Promise<void> {
    return this.fade.go(() => {
      if (!this.driver.isPresenting()) return;
      const l = this.driver.head().local;
      const to = { x: spot.x, z: spot.z };
      this.driver.setPose(yawDeg === undefined ? poseOver(this.driver.pose.yaw, l, to) : poseFacing(l, l.yaw, to, yawDeg));
    });
  }

  private panelAction(a: ButtonAction): void {
    const home = this.home;
    switch (a.type) {
      case 'close': this.panel.hide(); break;
      case 'exit': this.panel.hide(); void this.exit(); break;
      case 'room': {
        if (!home) return;
        const s = home.spotIn(a.id);
        if (!s) { this.say('There is no place to stand in that room.'); return; }
        this.panel.hide();
        void this.teleportTo({ x: s.x, z: s.z }, s.yawDeg);
        break;
      }
      case 'home': {
        const e = this.homes.find((h) => h.key === a.key);
        if (e) void this.switchHome(e);
        break;
      }
      case 'page': break;
    }
  }

  /** Swaps this home for another without leaving the session: black, the old home down, the new one up, the viewer at its start, clear. */
  async switchHome(e: HomeEntry): Promise<void> {
    const prev = this.target;
    this.panel.hide();
    await this.fade.go(async () => {
      this.seq++;
      await this.load(e.target, true);
      if (this.state.phase === 'error' && prev && this.driver.isPresenting()) {
        // the new home would not open: the one the viewer was in comes back, and they are told
        const msg = this.state.message;
        await this.load(prev, true);
        if (msg) this.say(msg);
      }
    });
  }

  // ------------------------------------------------------------------ teardown

  /** Handles still held by this page: listeners on the session, controllers and window. For the teardown check. */
  listenerCount(): number { return (this.driver?.listenerCount() ?? 0) + this.gestureListeners.length; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeGestureListeners();
    this.endOff?.(); this.endOff = null;
    this.offFrame();
    this.unmount();
    this.fade.reset();
    this.panel.dispose();
    this.vis.dispose();
    this.driver?.dispose();
    this.viewer.setRenderOverride(null);
    this.viewer.dispose();
    this.viewer.renderer.forceContextLoss();
    this.subscribers.clear();
  }
}
