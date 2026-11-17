// The real thing: a WebXR `immersive-vr` session on the page's one renderer. `local-floor`, so the viewer's real floor is the home's floor and their real eye
// height is their eye height. The viewer is moved by offsetting the reference space (src/xr/pose.ts), so the camera and the controllers are always in
// home coordinates and nothing in the home moves. Not testable without a headset: the fake driver stands in for it in the checks.
import * as THREE from 'three';
import { DEFAULT_FRAMEBUFFER_SCALE, FOVEATION, MAX_FRAMEBUFFER_SCALE, MIN_FRAMEBUFFER_SCALE, TARGET_HZ } from './config';
import type { HeadReading, PointerFrame, XrDriver } from './driver';
import { IDENTITY_POSE, cameraYawOf, referenceOffset, toLocal } from './pose';
import type { Pose } from './pose';

/** a DOM EventTarget (the session) or three's EventDispatcher (a controller): both add and remove a listener by name */
interface Target { addEventListener(type: string, fn: (e: unknown) => void): void; removeEventListener(type: string, fn: (e: unknown) => void): void }
type Listener = { target: Target; type: string; fn: (e: unknown) => void };

interface Slot {
  controller: THREE.Group;
  source: XRInputSource | null;
  down: boolean;
  wasDown: boolean;
  menuWas: boolean;
  squeezeEdge: boolean;
  frame: PointerFrame;
}

export function xrAvailable(): boolean { return typeof navigator !== 'undefined' && !!navigator.xr; }

export class WebXrDriver implements XrDriver {
  readonly kind = 'webxr' as const;
  private session: XRSession | null = null;
  private base: XRReferenceSpace | null = null;
  private presenting = false;
  private listeners: Listener[] = [];
  private endCbs = new Set<() => void>();
  private slots: Slot[] = [];
  private current: Pose = { ...IDENTITY_POSE };
  /** the pose the frame in progress was computed under (setPose changes `current`, which applies to the next frame) */
  private framePose: Pose = { ...IDENTITY_POSE };
  private rate: number | null = null;
  private scaleUsed: number | null = null;
  private headCache: HeadReading = { world: { x: 0, y: 1.6, z: 0 }, forward: { x: 0, y: 0, z: -1 }, local: { x: 0, y: 1.6, z: 0, yaw: 0 } };

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly root: THREE.Group, private readonly opts: { scale?: number | null } = {}) {
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      root.add(controller);
      this.slots.push({
        controller, source: null, down: false, wasDown: false, menuWas: false, squeezeEdge: false,
        frame: { id: `c${i}`, hand: 'none', tracked: false, isHand: false, origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: -1 }, triggerDown: false, triggerPressed: false, menuPressed: false, stickX: 0, stickY: 0 },
      });
    }
  }

  get pose(): Pose { return this.current; }

  async supported(): Promise<boolean> {
    if (!xrAvailable()) return false;
    try { return await navigator.xr!.isSessionSupported('immersive-vr'); } catch { return false; }
  }

  private on(target: unknown, type: string, fn: (e: unknown) => void): void {
    (target as Target).addEventListener(type, fn);
    this.listeners.push({ target: target as Target, type, fn });
  }
  listenerCount(): number { return this.listeners.length; }

  async start(): Promise<void> {
    if (this.session) return;
    const session = await navigator.xr!.requestSession('immersive-vr', { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'] });
    const xr = this.renderer.xr;
    const scale = Math.min(MAX_FRAMEBUFFER_SCALE, Math.max(MIN_FRAMEBUFFER_SCALE, this.opts.scale ?? DEFAULT_FRAMEBUFFER_SCALE));
    try {
      xr.enabled = true;
      xr.setReferenceSpaceType('local-floor');
      xr.setFramebufferScaleFactor(scale);
      xr.setFoveation(FOVEATION);
      this.on(session, 'end', () => this.ended());
      for (let i = 0; i < this.slots.length; i++) this.hook(i);
      await xr.setSession(session);
    } catch (err) {
      this.ended();
      try { await session.end(); } catch { /* already over */ }
      throw err;
    }
    this.session = session;
    this.scaleUsed = scale;
    this.base = xr.getReferenceSpace() as XRReferenceSpace;
    this.presenting = true;
    this.current = { ...IDENTITY_POSE };
    this.framePose = { ...IDENTITY_POSE };
    // 72 Hz is what a Quest runs at by default; ask for it when the headset lists it (some default to 90 or 120)
    try {
      const rates = session.supportedFrameRates;
      if (rates && Array.from(rates).includes(TARGET_HZ)) { await session.updateTargetFrameRate(TARGET_HZ); this.rate = TARGET_HZ; }
      else this.rate = typeof session.frameRate === 'number' ? session.frameRate : null;
    } catch { /* the headset keeps its own rate */ }
  }

  private hook(i: number): void {
    const slot = this.slots[i];
    const c = slot.controller;
    this.on(c, 'connected', (e) => {
      const data = (e as unknown as { data?: XRInputSource }).data ?? null;
      slot.source = data;
      slot.frame.hand = data?.handedness === 'left' || data?.handedness === 'right' ? data.handedness : 'none';
      slot.frame.isHand = !!data?.hand;
    });
    this.on(c, 'disconnected', () => { slot.source = null; slot.frame.tracked = false; slot.down = false; });
    this.on(c, 'selectstart', () => { slot.down = true; });
    this.on(c, 'selectend', () => { slot.down = false; });
    // a hand has no face buttons: its squeeze opens the panel
    this.on(c, 'squeezestart', () => { if (slot.source?.hand) slot.squeezeEdge = true; });
  }

  private ended(): void {
    if (!this.presenting && !this.session && this.listeners.length === 0) return;
    this.presenting = false;
    this.session = null;
    this.base = null;
    for (const l of this.listeners.splice(0)) l.target.removeEventListener(l.type, l.fn);
    for (const s of this.slots) { s.source = null; s.down = false; s.wasDown = false; s.frame.tracked = false; }
    try { this.renderer.xr.setReferenceSpace(null as unknown as XRReferenceSpace); } catch { /* the manager has already let go */ }
    this.renderer.xr.enabled = false;
    this.current = { ...IDENTITY_POSE };
    this.framePose = { ...IDENTITY_POSE };
    for (const cb of [...this.endCbs]) { try { cb(); } catch (err) { console.error('[walkthru-vr] an end callback threw', err); } }
  }

  async stop(): Promise<void> {
    const s = this.session;
    if (!s) return;
    try { await s.end(); } catch { /* ended already */ }
    this.ended();
  }

  isPresenting(): boolean { return this.presenting; }
  onEnd(cb: () => void): () => void { this.endCbs.add(cb); return () => { this.endCbs.delete(cb); }; }
  hz(): number | null { return this.rate; }
  scale(): number | null { return this.scaleUsed; }

  beginFrame(): void { this.framePose = this.current; }

  setPose(p: Pose): void {
    this.current = { x: p.x, z: p.z, yaw: p.yaw };
    if (!this.base) return;
    const o = referenceOffset(p);
    this.renderer.xr.setReferenceSpace(this.base.getOffsetReferenceSpace(new XRRigidTransform(o.position, new DOMPoint(o.orientation.x, o.orientation.y, o.orientation.z, o.orientation.w))));
  }

  private readonly e = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly f = new THREE.Vector3();

  head(): HeadReading {
    if (!this.presenting) return this.headCache;
    const cam = this.renderer.xr.getCamera();
    this.e.copy(cam.position);
    this.f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const fl = this.f.length() || 1;
    const world = { x: this.e.x, y: this.e.y, z: this.e.z };
    const forward = { x: this.f.x / fl, y: this.f.y / fl, z: this.f.z / fl };
    const l = toLocal(this.framePose, world);
    this.headCache = { world, forward, local: { x: l.x, y: world.y, z: l.z, yaw: cameraYawOf(forward.x, forward.z) - this.framePose.yaw } };
    return this.headCache;
  }

  frames(): PointerFrame[] {
    for (const s of this.slots) {
      const f = s.frame;
      const c = s.controller;
      f.tracked = !!s.source && c.visible !== false;
      if (!f.tracked) { f.triggerDown = false; f.triggerPressed = false; f.menuPressed = false; f.stickX = 0; f.stickY = 0; s.wasDown = false; continue; }
      // the controller's own matrix is this frame's pose in home coordinates (the root has no transform)
      c.matrix.decompose(this.e, this.q, this.f);
      f.origin.x = this.e.x; f.origin.y = this.e.y; f.origin.z = this.e.z;
      this.f.set(0, 0, -1).applyQuaternion(this.q);
      f.dir.x = this.f.x; f.dir.y = this.f.y; f.dir.z = this.f.z;
      const gp = s.source?.gamepad;
      const pad = gp && gp.mapping === 'xr-standard' ? gp : gp ?? null;
      const trig = s.down || !!pad?.buttons[0]?.pressed;
      f.triggerPressed = trig && !s.wasDown;
      f.triggerDown = trig;
      s.wasDown = trig;
      // xr-standard: buttons 4 and 5 are A/B (right) or X/Y (left); the thumbstick is axes 2 and 3
      const menu = !!pad?.buttons[5]?.pressed;
      f.menuPressed = (menu && !s.menuWas) || s.squeezeEdge;
      s.menuWas = menu;
      s.squeezeEdge = false;
      f.stickX = pad?.axes[2] ?? 0;
      f.stickY = pad?.axes[3] ?? 0;
    }
    return this.slots.map((s) => s.frame);
  }

  pointerObjects(): THREE.Object3D[] { return this.slots.map((s) => s.controller); }

  haptic(hand: string, strength: number, ms: number): void {
    for (const s of this.slots) {
      if (s.frame.hand !== hand) continue;
      try {
        const act = (s.source?.gamepad as (Gamepad & { hapticActuators?: { pulse?: (v: number, d: number) => Promise<boolean> }[] }) | null | undefined)?.hapticActuators?.[0];
        void act?.pulse?.(strength, ms);
      } catch { /* no haptics */ }
    }
  }

  dispose(): void {
    void this.stop();
    for (const l of this.listeners.splice(0)) l.target.removeEventListener(l.type, l.fn);
    for (const s of this.slots) this.root.remove(s.controller);
    this.endCbs.clear();
  }
}
