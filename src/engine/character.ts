// The walking mannequin (SPEC 4.6, "How the character applies them"). three only.
// Hierarchy: root (Group, world position, rotation.y = yaw) > tilt (Group) > the GLB scene (uniformly scaled).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { CHARACTER_URL, LIE_BACK_RATIO } from '../types';
import type { LiePose, SeatPose, StandPose, Vec2 } from '../types';

export type CharacterState = 'idle' | 'walk' | 'jog' | 'sitting' | 'lying' | 'standing-at' | 'transition';

const DEG = Math.PI / 180;

/** The six Universal Animation Library clips the character uses. */
const CLIPS = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  jog: 'Jog_Fwd_Loop',
  sitEnter: 'Sitting_Enter',
  sitIdle: 'Sitting_Idle_Loop',
  sitExit: 'Sitting_Exit',
} as const;
type ClipKey = keyof typeof CLIPS;

const FADE_S = 0.2;
const LIE_IN_S = 0.6;
const LIE_OUT_S = 0.5;
const SIT_MOVE_S = 0.3;
const STAND_MOVE_S = 0.3;
/** Sitting_Exit plays this much faster than authored so getting up does not feel laggy. */
const SIT_EXIT_SPEED = 1.5;
const WALK_MPS = 1.4;
const JOG_MPS = 2.8;
const REF_HEIGHT_M = 1.75;

function ease(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}
function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}
/** Signed shortest angular difference, degrees, in (-180, 180]. */
function angleDiff(from: number, to: number): number {
  let d = (((to - from) % 360) + 540) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}
function normDeg(a: number): number {
  return ((a % 360) + 360) % 360;
}

interface Tween {
  t: number;
  dur: number;
  run: (k: number) => void;
  done: () => void;
  resolve: () => void;
}

type Posed = 'lie' | 'sit' | 'stand' | null;

export class Character {
  /** The root group. Add this to the scene. */
  readonly object: THREE.Group;

  private readonly tilt: THREE.Group;
  private readonly model: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions: Record<ClipKey, THREE.AnimationAction>;
  private readonly skinned: THREE.SkinnedMesh[];
  private readonly mainMat: THREE.MeshStandardMaterial[] = [];
  private readonly jointMat: THREE.MeshStandardMaterial[] = [];
  private readonly shadow: THREE.Mesh | null;
  /** Standing idle height of the unscaled GLB (SPEC 4.6: pose Idle_Loop at t = 0, skinned bounding box). */
  private readonly h0: number;

  private _heightM = REF_HEIGHT_M;
  private _state: CharacterState = 'idle';
  private _yawDeg = 0;
  private posed: Posed = null;
  private currentClip: ClipKey | null = null;
  private tween: Tween | null = null;
  private shadowWanted = true;

  /**
   * Loads the GLB. Fails with a readable message (and no silent fallback) when the file is missing, is not a GLB
   * (Vite answers a missing file with index.html), has no skinned mesh, or lacks one of the six clips.
   */
  static async load(url: string = CHARACTER_URL): Promise<Character> {
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new Error(`Character: could not fetch ${url} (${String(err)}). Is the dev server running?`);
    }
    if (!res.ok) {
      throw new Error(`Character: ${url} answered HTTP ${res.status}. Run "npm run fetch:assets" to download mannequin.glb.`);
    }
    const buf = await res.arrayBuffer();
    const magic = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(4, buf.byteLength)));
    if (magic !== 'glTF') {
      throw new Error(
        `Character: ${url} is not a GLB file (it starts with "${magic}"). ` +
        'The server probably returned a web page: run "npm run fetch:assets" to download mannequin.glb.',
      );
    }
    let gltf: GLTF;
    try {
      gltf = await new GLTFLoader().parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1));
    } catch (err) {
      throw new Error(`Character: ${url} could not be parsed as glTF (${String(err)}).`);
    }
    return Character.fromGLTF(gltf);
  }

  /** Builds a character from an already parsed glTF (also used by the headless tests). */
  static fromGLTF(gltf: GLTF): Character {
    return new Character(gltf);
  }

  private constructor(gltf: GLTF) {
    this.model = gltf.scene;
    this.skinned = [];
    this.model.traverse((o) => {
      const s = o as THREE.SkinnedMesh;
      if (!s.isSkinnedMesh) return;
      this.skinned.push(s);
      s.frustumCulled = false; // bounding spheres of skinned meshes go stale while animating
      // own materials, so tints never leak between instances
      const own = (s.material as THREE.Material).clone() as THREE.MeshStandardMaterial;
      s.material = own;
      (own.name === 'M_Joints' ? this.jointMat : this.mainMat).push(own);
    });
    if (this.skinned.length === 0) {
      throw new Error('Character: the GLB contains no skinned mesh, so it cannot be animated.');
    }

    this.mixer = new THREE.AnimationMixer(this.model);
    const have = gltf.animations.map((a) => a.name);
    const missing = Object.values(CLIPS).filter((n) => !have.includes(n));
    if (missing.length > 0) {
      throw new Error(`Character: the GLB lacks animation clip(s) ${missing.join(', ')}. It has: ${have.join(', ')}.`);
    }
    const action = (key: ClipKey): THREE.AnimationAction => {
      const clip = gltf.animations.find((a) => a.name === CLIPS[key])!;
      return this.mixer.clipAction(clip);
    };
    this.actions = {
      idle: action('idle'), walk: action('walk'), jog: action('jog'),
      sitEnter: action('sitEnter'), sitIdle: action('sitIdle'), sitExit: action('sitExit'),
    };
    this.actions.sitEnter.setLoop(THREE.LoopOnce, 1);
    this.actions.sitEnter.clampWhenFinished = true;
    this.actions.sitExit.setLoop(THREE.LoopOnce, 1);
    this.actions.sitExit.clampWhenFinished = true;
    this.mixer.addEventListener('finished', (e) => {
      // Sitting_Enter has run out: settle into the sitting loop
      if ((e as unknown as { action: THREE.AnimationAction }).action === this.actions.sitEnter && this.posed === 'sit') {
        this.play('sitIdle', FADE_S);
      }
    });

    // h0: pose Idle_Loop at t = 0 and read the skinned bounding box (both meshes: body and joints).
    this.actions.idle.reset().play();
    this.mixer.update(0);
    this.h0 = this.measureHeight();
    this.currentClip = 'idle';
    if (!(this.h0 > 0.5 && this.h0 < 5)) {
      throw new Error(`Character: measured an implausible standing height of ${this.h0} m from the GLB.`);
    }

    this.object = new THREE.Group();
    this.object.name = 'character';
    this.tilt = new THREE.Group();
    this.tilt.name = 'character-tilt';
    this.object.add(this.tilt);
    this.tilt.add(this.model);

    this.shadow = Character.makeShadow();
    if (this.shadow) this.object.add(this.shadow);

    this.setHeight(REF_HEIGHT_M, '#E8823A');
  }

  // ---------------------------------------------------------------- state

  get state(): CharacterState {
    return this._state;
  }

  get heightM(): number {
    return this._heightM;
  }
  set heightM(m: number) {
    this.applyHeight(m);
  }

  /** World position on the floor plane. Setting it does not change the height above the floor. */
  get position(): Vec2 {
    return { x: this.object.position.x, z: this.object.position.z };
  }
  set position(p: Vec2) {
    this.object.position.x = p.x;
    this.object.position.z = p.z;
  }

  get yawDeg(): number {
    return this._yawDeg;
  }
  set yawDeg(d: number) {
    this._yawDeg = d;
    this.object.rotation.y = d * DEG;
  }

  /**
   * Rescales so the standing idle figure is exactly `m` tall, and tints it. The tint is the body colour; the joint
   * spheres get a darker shade of it. A pose already in progress keeps its old size: ask for the pose again.
   */
  setHeight(m: number, tint: string): void {
    this.applyHeight(m);
    const body = new THREE.Color(tint);
    for (const mat of this.mainMat) mat.color.copy(body);
    const joint = body.clone().multiplyScalar(0.55);
    for (const mat of this.jointMat) mat.color.copy(joint);
  }

  private applyHeight(m: number): void {
    if (!(m > 0.3 && m < 3)) {
      console.error(`[walkthru] Character.setHeight: ignoring implausible height ${m}`);
      return;
    }
    this._heightM = m;
    this.model.scale.setScalar(m / this.h0);
    if (this.shadow) this.shadow.scale.setScalar(m / REF_HEIGHT_M);
  }

  /** The blob under the feet is the only alpha-blended mesh (SPEC 12 risk 2). Drop it in splat scenes. */
  setShadowVisible(v: boolean): void {
    this.shadowWanted = v;
    this.syncShadow();
  }

  setVisible(v: boolean): void {
    this.object.visible = v;
  }

  private syncShadow(): void {
    if (!this.shadow) return;
    const onFloor = this._state === 'idle' || this._state === 'walk' || this._state === 'jog' || this._state === 'standing-at';
    this.shadow.visible = this.shadowWanted && onFloor;
  }

  private setState(s: CharacterState): void {
    this._state = s;
    this.syncShadow();
  }

  // ---------------------------------------------------------------- locomotion

  /** speed in m/s; 0 = idle. Ignored while posed. */
  setLocomotion(speed: number, jog: boolean): void {
    if (this._state !== 'idle' && this._state !== 'walk' && this._state !== 'jog') return;
    if (!(speed > 0.02)) {
      this.setState('idle');
      this.play('idle', FADE_S);
      return;
    }
    const scale = this._heightM / REF_HEIGHT_M;
    if (jog) {
      this.setState('jog');
      this.play('jog', FADE_S).timeScale = clampTs(speed / (JOG_MPS * scale));
    } else {
      this.setState('walk');
      this.play('walk', FADE_S).timeScale = clampTs(speed / (WALK_MPS * scale));
    }
  }

  // ---------------------------------------------------------------- poses

  /**
   * Lies supine along the item (4.6): idle frozen at t = 0, then over 0.6 s the root moves to the feet spot, lifted
   * by LIE_BACK_RATIO * H above the surface, and the tilt group rotates to -90 degrees about X, so the head ends up
   * H metres toward -a with the face up. Resolves when the pose is reached.
   */
  lie(pose: LiePose): Promise<void> {
    this.posed = 'lie';
    this.setState('transition');
    const a = this.play('idle', FADE_S, true);
    a.timeScale = 0;
    a.time = 0;
    const target = {
      x: pose.feet.x, z: pose.feet.z,
      y: pose.surfaceY + LIE_BACK_RATIO * this._heightM,
      tilt: -Math.PI / 2,
    };
    return this.moveTo(target, pose.yawDeg, LIE_IN_S, () => this.setState('lying'));
  }

  /** Sits (4.6): over 0.3 s the root moves to the seat spot, Sitting_Enter plays once, then Sitting_Idle_Loop. */
  sit(pose: SeatPose): Promise<void> {
    this.posed = 'sit';
    this.setState('transition');
    this.play('sitEnter', 0.15, true);
    return this.moveTo({ x: pose.root.x, z: pose.root.z, y: pose.rootY, tilt: 0 }, pose.yawDeg, SIT_MOVE_S, () => this.setState('sitting'));
  }

  /** Stands facing the item, in Idle_Loop. */
  standAt(pose: StandPose): Promise<void> {
    this.posed = 'stand';
    this.setState('transition');
    this.play('idle', FADE_S, true);
    return this.moveTo({ x: pose.root.x, z: pose.root.z, y: 0, tilt: 0 }, pose.yawDeg, STAND_MOVE_S, () => this.setState('standing-at'));
  }

  /**
   * Leaves any pose, ending upright at `to` in Idle_Loop. The caller picks `to` (4.6: `nearestFree` on the live
   * grid), the character has no grid of its own. When not posed it just places the character at `to`.
   */
  release(to: Vec2): Promise<void> {
    const was = this.posed;
    this.posed = null;
    if (was === null) {
      this.cancelTween();
      this.position = to;
      this.object.position.y = 0;
      this.tilt.rotation.x = 0;
      return Promise.resolve();
    }
    this.setState('transition');
    const target = { x: to.x, z: to.z, y: 0, tilt: 0 };
    const finish = (): void => {
      this.setState('idle');
      this.play('idle', FADE_S, true);
    };
    if (was === 'lie') {
      this.play('idle', FADE_S, true);
      return this.moveTo(target, this._yawDeg, LIE_OUT_S, finish);
    }
    if (was === 'sit') {
      const exit = this.play('sitExit', 0.1, true);
      exit.timeScale = SIT_EXIT_SPEED;
      const dur = this.actions.sitExit.getClip().duration / SIT_EXIT_SPEED;
      // stand up first, then slide out of the seat over the last 60 % of the clip
      return this.moveTo(target, this._yawDeg, dur, finish, (k) => Math.min(1, Math.max(0, (k - 0.4) / 0.6)));
    }
    return this.moveTo(target, this._yawDeg, 0.25, finish);
  }

  /** Cancels any running tween (resolving its promise) and tweens root position, tilt and yaw to the target. */
  private moveTo(
    target: { x: number; z: number; y: number; tilt: number }, yawDeg: number, dur: number,
    done: () => void, shape: (k: number) => number = ease,
  ): Promise<void> {
    this.cancelTween();
    const from = {
      x: this.object.position.x, y: this.object.position.y, z: this.object.position.z,
      tilt: this.tilt.rotation.x, yaw: this._yawDeg,
    };
    const dYaw = angleDiff(from.yaw, yawDeg);
    return new Promise<void>((resolve) => {
      this.tween = {
        t: 0, dur,
        run: (k) => {
          const s = shape(k);
          this.object.position.set(lerp(from.x, target.x, s), lerp(from.y, target.y, s), lerp(from.z, target.z, s));
          this.tilt.rotation.x = lerp(from.tilt, target.tilt, s);
          this.yawDeg = k >= 1 ? normDeg(yawDeg) : from.yaw + dYaw * ease(k);
        },
        done, resolve,
      };
    });
  }

  private cancelTween(): void {
    if (!this.tween) return;
    const old = this.tween;
    this.tween = null;
    old.resolve(); // nobody is left waiting on a pose that was replaced
  }

  // ---------------------------------------------------------------- animation plumbing

  /** Cross-fades to the clip. `restart` replays it from its start even if it is already the current clip. */
  private play(key: ClipKey, fade: number, restart = false): THREE.AnimationAction {
    const next = this.actions[key];
    if (this.currentClip === key && !restart) return next;
    const prev = this.currentClip ? this.actions[this.currentClip] : null;
    next.reset();
    next.enabled = true;
    next.timeScale = 1; // reset() keeps timeScale, and lie() freezes the idle clip with 0
    next.setEffectiveWeight(1);
    if (prev && prev !== next) {
      next.fadeIn(fade);
      prev.fadeOut(fade);
    }
    next.play();
    this.currentClip = key;
    return next;
  }

  private measureHeight(): number {
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const s of this.skinned) {
      s.skeleton.update();
      s.computeBoundingBox();
      if (s.boundingBox) box.union(s.boundingBox.clone().applyMatrix4(s.matrixWorld));
    }
    return box.max.y - box.min.y;
  }

  /** Advances animation and pose tweens. Call once per frame with the frame time in seconds. */
  update(dt: number): void {
    if (this.tween) {
      const tw = this.tween;
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.run(k);
      if (k >= 1) {
        this.tween = null;
        tw.done();
        tw.resolve();
      }
    }
    this.mixer.update(dt);
  }

  /** Frees the clones this character made. The shared GLB geometry goes with it. */
  dispose(): void {
    this.cancelTween();
    this.mixer.stopAllAction();
    this.object.removeFromParent();
    for (const s of this.skinned) {
      s.geometry.dispose();
      (s.material as THREE.Material).dispose();
      s.skeleton.dispose();
    }
    if (this.shadow) {
      this.shadow.geometry.dispose();
      const m = this.shadow.material as THREE.MeshBasicMaterial;
      m.map?.dispose();
      m.dispose();
    }
  }

  // ---------------------------------------------------------------- contact shadow

  /** A soft dark disc just above the floor. Needs a canvas, so it is skipped under Node. */
  private static makeShadow(): THREE.Mesh | null {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d');
    if (!g) return null;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), mat);
    mesh.name = 'contact-shadow';
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.012;
    mesh.renderOrder = 1;
    return mesh;
  }
}

function clampTs(v: number): number {
  return Math.min(3, Math.max(0.25, v));
}
