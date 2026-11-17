// The in-page emulator (`?xrfake=1`): a stand-in for a headset so the page's logic can be checked in an ordinary browser. It is not WebXR. There is no
// stereo, no session and no `renderer.xr`: the camera is placed from the pose and a scripted head, and the two hands are scripted pointers. Everything
// above the driver (teleport, snap turn, doors, the panel, the swap of homes, the teardown) runs the same code it runs on a headset.
// Loaded lazily, only when the address asks for it. Exposes `window.__xrfake` for the checks.
import * as THREE from 'three';
import type { HeadReading, PointerFrame, XrDriver } from './driver';
import { IDENTITY_POSE, toWorld } from './pose';
import type { Pose } from './pose';
import type { V3 } from './teleport';

interface Hand {
  id: 'left' | 'right';
  origin: V3;
  dir: V3;
  tracked: boolean;
  down: boolean;
  pressQueued: boolean;
  releaseQueued: boolean;
  menuQueued: boolean;
  stickX: number;
  stickY: number;
  obj: THREE.Object3D;
  wasDown: boolean;
}

const norm = (v: V3): V3 => { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };

export interface FakeApi {
  /** the head in the play space: where the viewer stands in the room they are in, and how they are turned (a camera yaw in radians, 0 looks down -z) */
  head(h: { x?: number; y?: number; z?: number; yaw?: number; pitch?: number }): void;
  /** points a hand from `from` toward `to`, both in the home */
  aim(hand: 'left' | 'right', from: V3, to: V3): void;
  /** holds a hand along a direction from a point */
  aimDir(hand: 'left' | 'right', from: V3, dir: V3): void;
  /** a click: down at the next frame, up at the one after */
  trigger(hand: 'left' | 'right'): void;
  press(hand: 'left' | 'right'): void;
  release(hand: 'left' | 'right'): void;
  stick(hand: 'left' | 'right', x: number, y: number): void;
  /** B or Y */
  menu(hand: 'left' | 'right'): void;
  /** the pose and the head as the page last read them */
  state(): { pose: Pose; head: HeadReading; presenting: boolean; frames: number; hands: { id: string; origin: V3; dir: V3; tracked: boolean }[] };
  untrack(hand: 'left' | 'right'): void;
}

export class FakeDriver implements XrDriver {
  readonly kind = 'fake' as const;
  private presenting = false;
  private current: Pose = { ...IDENTITY_POSE };
  private framePose: Pose = { ...IDENTITY_POSE };
  private endCbs = new Set<() => void>();
  private headLocal = { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 };
  private hands: Hand[] = [];
  private frameCount = 0;
  private saved: { fov: number; near: number } | null = null;
  private lastHead: HeadReading = { world: { x: 0, y: 1.6, z: 0 }, forward: { x: 0, y: 0, z: -1 }, local: { x: 0, y: 1.6, z: 0, yaw: 0 } };

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly root: THREE.Group) {
    for (const id of ['left', 'right'] as const) {
      const obj = new THREE.Object3D();
      obj.name = `fake-controller-${id}`;
      root.add(obj);
      this.hands.push({
        id, origin: { x: id === 'left' ? -0.25 : 0.25, y: 1.15, z: -0.3 }, dir: { x: 0, y: 0, z: -1 }, tracked: true, down: false,
        pressQueued: false, releaseQueued: false, menuQueued: false, stickX: 0, stickY: 0, obj, wasDown: false,
      });
    }
    (window as unknown as { __xrfake?: FakeApi }).__xrfake = this.api();
  }

  get pose(): Pose { return this.current; }

  async supported(): Promise<boolean> { return true; }
  listenerCount(): number { return 0; }

  async start(): Promise<void> {
    if (this.presenting) return;
    this.saved = { fov: this.camera.fov, near: this.camera.near };
    this.presenting = true;
    this.current = { ...IDENTITY_POSE };
    this.framePose = { ...IDENTITY_POSE };
  }

  async stop(): Promise<void> {
    if (!this.presenting) return;
    this.presenting = false;
    if (this.saved) { this.camera.fov = this.saved.fov; this.camera.near = this.saved.near; this.camera.updateProjectionMatrix(); this.saved = null; }
    for (const cb of [...this.endCbs]) { try { cb(); } catch (err) { console.error('[walkthru-vr] an end callback threw', err); } }
  }

  isPresenting(): boolean { return this.presenting; }
  onEnd(cb: () => void): () => void { this.endCbs.add(cb); return () => { this.endCbs.delete(cb); }; }
  hz(): number | null { return 72; }
  scale(): number | null { return null; }
  haptic(): void {}

  beginFrame(): void {
    this.frameCount++;
    this.framePose = this.current;
    if (!this.presenting) return;
    // the camera: the scripted head, carried by the pose
    const h = this.headLocal;
    const w = toWorld(this.current, { x: h.x, z: h.z });
    const cam = this.camera;
    if (Math.abs(cam.fov - 90) > 1e-6) { cam.fov = 90; cam.near = 0.05; cam.updateProjectionMatrix(); }
    cam.position.set(w.x, h.y, w.z);
    cam.rotation.set(h.pitch, h.yaw + this.current.yaw, 0, 'YXZ');
    cam.updateMatrixWorld(true);
    for (const hand of this.hands) {
      hand.obj.position.set(hand.origin.x, hand.origin.y, hand.origin.z);
      // a controller points down its own -z
      hand.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(hand.dir.x, hand.dir.y, hand.dir.z));
      hand.obj.visible = hand.tracked;
      hand.obj.updateMatrixWorld(true);
    }
  }

  setPose(p: Pose): void { this.current = { x: p.x, z: p.z, yaw: p.yaw }; }

  head(): HeadReading {
    const h = this.headLocal;
    const w = toWorld(this.framePose, { x: h.x, z: h.z });
    const yaw = h.yaw + this.framePose.yaw;
    const cp = Math.cos(h.pitch);
    const forward = { x: -Math.sin(yaw) * cp, y: Math.sin(h.pitch), z: -Math.cos(yaw) * cp };
    this.lastHead = { world: { x: w.x, y: h.y, z: w.z }, forward, local: { x: h.x, y: h.y, z: h.z, yaw: h.yaw } };
    return this.lastHead;
  }

  frames(): PointerFrame[] {
    return this.hands.map((h) => {
      let pressed = false;
      if (h.pressQueued) { h.pressQueued = false; h.down = true; pressed = true; }
      else if (h.releaseQueued) { h.releaseQueued = false; h.down = false; }
      const menu = h.menuQueued; h.menuQueued = false;
      h.wasDown = h.down;
      return { id: h.id, hand: h.id, tracked: h.tracked && this.presenting, isHand: false, origin: { ...h.origin }, dir: { ...h.dir }, triggerDown: h.down, triggerPressed: pressed, menuPressed: menu, stickX: h.stickX, stickY: h.stickY };
    });
  }

  pointerObjects(): THREE.Object3D[] { return this.hands.map((h) => h.obj); }

  private api(): FakeApi {
    const hand = (id: 'left' | 'right'): Hand => this.hands.find((h) => h.id === id)!;
    return {
      head: (h) => { Object.assign(this.headLocal, { x: h.x ?? this.headLocal.x, y: h.y ?? this.headLocal.y, z: h.z ?? this.headLocal.z, yaw: h.yaw ?? this.headLocal.yaw, pitch: h.pitch ?? this.headLocal.pitch }); },
      aim: (id, from, to) => { const h = hand(id); h.origin = { ...from }; h.dir = norm({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }); h.tracked = true; },
      aimDir: (id, from, dir) => { const h = hand(id); h.origin = { ...from }; h.dir = norm(dir); h.tracked = true; },
      trigger: (id) => { const h = hand(id); h.pressQueued = true; setTimeout(() => { h.releaseQueued = true; }, 40); },
      press: (id) => { hand(id).pressQueued = true; },
      release: (id) => { hand(id).releaseQueued = true; },
      stick: (id, x, y) => { const h = hand(id); h.stickX = x; h.stickY = y; },
      menu: (id) => { hand(id).menuQueued = true; },
      untrack: (id) => { hand(id).tracked = false; },
      state: () => ({
        pose: { ...this.current }, head: this.head(), presenting: this.presenting, frames: this.frameCount,
        hands: this.hands.map((h) => ({ id: h.id, origin: { ...h.origin }, dir: { ...h.dir }, tracked: h.tracked })),
      }),
    };
  }

  dispose(): void {
    this.presenting = false;
    this.endCbs.clear();
    for (const h of this.hands) this.root.remove(h.obj);
    delete (window as unknown as { __xrfake?: FakeApi }).__xrfake;
  }
}
