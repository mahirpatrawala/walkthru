// The walking mannequin (SPEC 4.6, "How the character applies them"). three only.
// Hierarchy: root (Group, world position, rotation.y = yaw) > tilt (Group) > the GLB scene (uniformly scaled).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { CHARACTER_URL, LIE_BACK_RATIO, SIT_HIP_BACK_RATIO, SIT_SEAT_RATIO } from '../types';
import type { LiePose, SeatPose, StandPose, Vec2 } from '../types';
import { loadPersonGLTF } from '../look/people';
import type { BodyKind, PersonTier } from '../look/people';
import { DEFAULT_TONE, clampTone, stylePerson } from '../look/people-materials';
import type { PersonLook } from '../look/people-materials';

export type CharacterState = 'idle' | 'walk' | 'jog' | 'sitting' | 'lying' | 'standing-at' | 'transition';

/** What the character looks like (SPEC 16.6.3). `tier` only matters for person bodies: low loads the lighter file. */
export interface Appearance { body: BodyKind; tone: number; tier: PersonTier }
export interface CharacterLoadOpts { body?: BodyKind; tone?: number; tier?: PersonTier }
/** SPEC 16.6.3: the three pose constants, measured per body (ratios of a 1.75 m body). The mannequin keeps the constants. */
export interface PoseK { seat: number; hipBack: number; back: number; /** lowest point of the body in the sitting clip, relative to the root */ floor: number }
export interface PersonMeasure {
  heightM: number;
  pelvis: { x: number; y: number; z: number };
  bboxMin: { x: number; y: number; z: number };
  bboxMax: { x: number; y: number; z: number };
  headToHeelM: number;
}

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
type ClipKey = keyof typeof CLIPS | 'lie';

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
  private model!: THREE.Object3D;
  private mixer!: THREE.AnimationMixer;
  private actions!: Record<ClipKey, THREE.AnimationAction>;
  private skinned: THREE.SkinnedMesh[] = [];
  private mainMat: THREE.MeshStandardMaterial[] = [];
  private jointMat: THREE.MeshStandardMaterial[] = [];
  private person: PersonLook | null = null;
  private readonly shadow: THREE.Mesh | null;
  /** Standing idle height of the unscaled GLB (SPEC 4.6: pose Idle_Loop at t = 0, skinned bounding box). */
  private h0 = 1;
  private poseK: PoseK = { seat: SIT_SEAT_RATIO, hipBack: SIT_HIP_BACK_RATIO, back: LIE_BACK_RATIO, floor: -Infinity };
  private appearanceNow: Appearance = { body: 'mannequin', tone: DEFAULT_TONE, tier: 'medium' };
  private loadToken = 0;
  private tint = '#E8823A';
  private hasLiePose = false;
  /** lying with straight legs is a little longer than the idle stance: scale the body so head-to-heel stays the chosen height */
  private lieScale = 1;
  private lastPoseSpec: { lie?: LiePose; sit?: SeatPose } = {};
  /**
   * Height of the seat surface under (x, z), or null. Lets a tall person sit with their knees raised instead of floating
   * above a low seat or sinking their feet into the floor. Set by the buyer page from the furniture store.
   */
  surfaceProbe: ((x: number, z: number) => number | null) | null = null;
  private kneeRad = 0;
  private kneeState = new Map<THREE.Bone, { base: THREE.Quaternion; out: THREE.Quaternion }>();
  private kneeBones: { thigh: THREE.Bone[]; calf: THREE.Bone[] } | null = null;
  /** called after a body swap, so the look can re-apply shadow flags to the new meshes */
  onRebind: (() => void) | null = null;

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
   * `opts.body` 'male' or 'female' loads a person body (SPEC 16.6) instead; `url` is then ignored.
   */
  static async load(url: string = CHARACTER_URL, opts: CharacterLoadOpts = {}): Promise<Character> {
    const body = opts.body ?? 'mannequin';
    const tier = opts.tier ?? 'medium';
    const gltf = body === 'mannequin' ? await Character.loadMannequin(url) : await loadPersonGLTF(body, tier);
    return new Character(gltf, { body, tone: clampTone(opts.tone), tier });
  }

  private static async loadMannequin(url: string): Promise<GLTF> {
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
    try {
      return await new GLTFLoader().parseAsync(buf, url.slice(0, url.lastIndexOf('/') + 1));
    } catch (err) {
      throw new Error(`Character: ${url} could not be parsed as glTF (${String(err)}).`);
    }
  }

  /** Builds a character from an already parsed glTF (also used by the headless tests). */
  static fromGLTF(gltf: GLTF, opts: CharacterLoadOpts = {}): Character {
    return new Character(gltf, { body: opts.body ?? 'mannequin', tone: clampTone(opts.tone), tier: opts.tier ?? 'medium' });
  }

  private constructor(gltf: GLTF, appearance: Appearance) {
    this.appearanceNow = { ...appearance };
    this.object = new THREE.Group();
    this.object.name = 'character';
    this.tilt = new THREE.Group();
    this.tilt.name = 'character-tilt';
    this.object.add(this.tilt);
    this.bind(gltf);
    this.tilt.add(this.model);

    this.shadow = Character.makeShadow();
    if (this.shadow) this.object.add(this.shadow);

    this.setHeight(REF_HEIGHT_M, '#E8823A');
  }

  /** Adopts a parsed glTF as the visible body: skinned meshes, materials, mixer, the six actions, h0 and the pose constants. */
  private bind(gltf: GLTF): void {
    this.model = gltf.scene;
    this.skinned = [];
    this.mainMat = [];
    this.jointMat = [];
    this.person = null;
    const kind = this.appearanceNow.body;
    this.model.traverse((o) => {
      const s = o as THREE.SkinnedMesh;
      if (!s.isSkinnedMesh) return;
      this.skinned.push(s);
      s.frustumCulled = false; // bounding spheres of skinned meshes go stale while animating
    });
    if (this.skinned.length === 0) {
      throw new Error('Character: the GLB contains no skinned mesh, so it cannot be animated.');
    }
    if (kind === 'mannequin') {
      for (const s of this.skinned) {
        // own materials, so tints never leak between instances
        const own = (s.material as THREE.Material).clone() as THREE.MeshStandardMaterial;
        s.material = own;
        (own.name === 'M_Joints' ? this.jointMat : this.mainMat).push(own);
      }
    } else {
      this.person = stylePerson(this.skinned, kind, this.appearanceNow.tone);
    }

    this.mixer = new THREE.AnimationMixer(this.model);
    const have = gltf.animations.map((a) => a.name);
    const missing = Object.values(CLIPS).filter((n) => !have.includes(n));
    if (missing.length > 0) {
      throw new Error(`Character: the GLB lacks animation clip(s) ${missing.join(', ')}. It has: ${have.join(', ')}.`);
    }
    const action = (key: keyof typeof CLIPS): THREE.AnimationAction => {
      const clip = gltf.animations.find((a) => a.name === CLIPS[key])!;
      return this.mixer.clipAction(clip);
    };
    const lieClip = gltf.animations.find((a) => a.name === 'Lie_Pose');
    this.actions = {
      idle: action('idle'), walk: action('walk'), jog: action('jog'),
      sitEnter: action('sitEnter'), sitIdle: action('sitIdle'), sitExit: action('sitExit'),
      // person bodies lie with straight legs (SPEC 16.6.3 / look/retarget.ts); the mannequin lies in its frozen idle
      lie: lieClip ? this.mixer.clipAction(lieClip) : action('idle'),
    };
    this.hasLiePose = !!lieClip;
    this.actions.sitEnter.setLoop(THREE.LoopOnce, 1);
    this.actions.sitEnter.clampWhenFinished = true;
    this.actions.sitExit.setLoop(THREE.LoopOnce, 1);
    this.actions.sitExit.clampWhenFinished = true;
    const mixer = this.mixer;
    mixer.addEventListener('finished', (e) => {
      // Sitting_Enter has run out: settle into the sitting loop
      if (mixer === this.mixer && (e as unknown as { action: THREE.AnimationAction }).action === this.actions.sitEnter && this.posed === 'sit') {
        this.play('sitIdle', FADE_S);
      }
    });

    // h0: pose Idle_Loop at t = 0 and read the skinned bounding box (every mesh: body, joints, hair, shoes).
    this.actions.idle.reset().play();
    this.mixer.update(0);
    this.h0 = this.measureHeight();
    this.currentClip = 'idle';
    if (!(this.h0 > 0.5 && this.h0 < 5)) {
      throw new Error(`Character: measured an implausible standing height of ${this.h0} m from the GLB.`);
    }
    this.kneeBones = null;
    this.kneeState = new Map();
    if (kind !== 'mannequin') {
      const bones = this.skinned[0].skeleton.bones;
      const pick = (re: RegExp): THREE.Bone[] => bones.filter((b) => re.test(b.name));
      const thigh = pick(/^thigh_[lr]$/i), calf = pick(/^calf_[lr]$/i);
      if (thigh.length === 2 && calf.length === 2) this.kneeBones = { thigh, calf };
    }
    this.poseK = kind === 'mannequin' ? { seat: SIT_SEAT_RATIO, hipBack: SIT_HIP_BACK_RATIO, back: LIE_BACK_RATIO, floor: -Infinity } : this.measurePoseK();
  }

  /**
   * SPEC 16.6.3: pose constants measured per body with the body scaled to 1.75 m, in the root's frame (the model stands
   * alone here, so its own frame is the root's). `seat`: lowest vertex of pelvis and thighs in Sitting_Idle_Loop;
   * `hipBack`: how far behind the root the pelvis bone sits in that clip; `back`: the rearmost point of the standing
   * torso (spine and pelvis: the idle clip puts one leg behind, and hair may rest on the bed); `floor`: the lowest
   * point of the body in the sitting clip, so a sitting body is never lowered through the floor.
   */
  private measurePoseK(): PoseK {
    const model = this.model;
    const before = model.scale.x;
    model.scale.setScalar(REF_HEIGHT_M / this.h0);
    const verts = (filter?: (s: THREE.SkinnedMesh) => boolean, boneRe?: RegExp): THREE.Vector3[] => {
      model.updateMatrixWorld(true);
      const out: THREE.Vector3[] = [];
      for (const s of this.skinned) {
        if (filter && !filter(s)) continue;
        s.skeleton.update();
        const p = s.geometry.attributes.position;
        const sw = s.geometry.attributes.skinWeight;
        const si = s.geometry.attributes.skinIndex;
        for (let i = 0; i < p.count; i++) {
          if (boneRe) {
            let best = 0, bw = -1;
            for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
            if (!boneRe.test(s.skeleton.bones[best].name)) continue;
          }
          const v = new THREE.Vector3();
          s.getVertexPosition(i, v);
          out.push(v.applyMatrix4(s.matrixWorld));
        }
      }
      return out;
    };
    const bodyOnly = (s: THREE.SkinnedMesh): boolean => s.name === 'skin' || s.name === 'top' || s.name === 'bottom' || s.name === 'shoes';
    // lying pose (or the idle stance for the mannequin): rearmost point of the torso and of the whole body, and its length
    this.mixer.stopAllAction();
    (this.hasLiePose ? this.actions.lie : this.actions.idle).reset().play();
    this.mixer.update(0);
    const torso = verts(bodyOnly, /pelvis|spine|hips/i);
    const all = verts(bodyOnly);
    const rearTorso = Math.min(...torso.map((v) => v.z));
    const rearAll = Math.min(...all.map((v) => v.z));
    // an arm may rest a little way into a soft mattress, the back may float a little above it: split the difference at 2.75 cm
    const rear = Math.min(rearTorso, rearAll + 0.0275);
    const full = verts();
    const lieLen = Math.max(...full.map((v) => v.y)) - Math.min(...full.map((v) => v.y));
    this.lieScale = this.hasLiePose ? Math.min(1.02, Math.max(0.98, REF_HEIGHT_M / lieLen)) : 1;
    // sitting: pelvis bone and the underside of pelvis and thighs
    this.mixer.stopAllAction();
    this.actions.sitIdle.reset().play();
    this.mixer.update(0);
    model.updateMatrixWorld(true);
    const pelvis = this.skinned[0].skeleton.bones.find((b) => /^(pelvis|DEF-hips)$/i.test(b.name));
    const pw = pelvis ? pelvis.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 0, -SIT_HIP_BACK_RATIO * REF_HEIGHT_M);
    const underside = Math.min(...verts(bodyOnly, /pelvis|thigh|hips/i).map((v) => v.y));
    const lowest = Math.min(...verts(bodyOnly).map((v) => v.y));
    // back to standing idle
    this.mixer.stopAllAction();
    this.actions.idle.reset().play();
    this.mixer.update(0);
    model.scale.setScalar(before);
    return { seat: underside / REF_HEIGHT_M, hipBack: -pw.z / REF_HEIGHT_M, back: -rear / REF_HEIGHT_M, floor: lowest / REF_HEIGHT_M };
  }

  /** The pose constants in use (ratios of height). The mannequin returns the SPEC constants. */
  get poseConstants(): PoseK {
    return { ...this.poseK };
  }
  get appearance(): Appearance {
    return { ...this.appearanceNow };
  }

  /**
   * Changes body, skin tone or detail tier (SPEC 16.6.3). A new body is fetched and swapped in place: position, yaw,
   * height, tint and what the character was doing are kept. A tone change alone needs no reload.
   */
  async setAppearance(a: Partial<Appearance>): Promise<void> {
    const next: Appearance = {
      body: a.body ?? this.appearanceNow.body,
      tone: a.tone === undefined ? this.appearanceNow.tone : clampTone(a.tone),
      tier: a.tier ?? this.appearanceNow.tier,
    };
    const cur = this.appearanceNow;
    // medium and high share one body file; only low has its own
    const file = (t: PersonTier): string => (t === 'low' ? 'low' : 'full');
    const reload = next.body !== cur.body || (next.body !== 'mannequin' && file(next.tier) !== file(cur.tier));
    if (!reload) {
      this.appearanceNow = next;
      this.person?.setTone(next.tone);
      return;
    }
    const token = ++this.loadToken;
    const gltf = next.body === 'mannequin' ? await Character.loadMannequin(CHARACTER_URL) : await loadPersonGLTF(next.body, next.tier);
    if (token !== this.loadToken) return; // a newer request replaced this one
    this.appearanceNow = next;
    this.swap(gltf);
  }

  private swap(gltf: GLTF): void {
    const old = { model: this.model, skinned: this.skinned, mixer: this.mixer };
    old.mixer.stopAllAction();
    old.mixer.uncacheRoot(old.model);
    old.model.removeFromParent();
    for (const s of old.skinned) {
      s.geometry.dispose();
      const mats = Array.isArray(s.material) ? s.material : [s.material];
      for (const m of mats) m.dispose();
      s.skeleton.dispose();
    }
    this.bind(gltf);
    this.tilt.add(this.model);
    this.applyHeight(this._heightM);
    this.setHeight(this._heightM, this.tint);
    this.restorePlayback();
    this.onRebind?.();
  }

  /** After a body swap: puts the new body back into whatever the old one was doing. */
  private restorePlayback(): void {
    const H = this._heightM;
    if (this._state === 'lying' && this.lastPoseSpec.lie) {
      const a = this.play(this.hasLiePose ? 'lie' : 'idle', 0, true);
      a.timeScale = 0;
      a.time = 0;
      this.object.position.y = this.lastPoseSpec.lie.surfaceY + this.poseK.back * H;
      return;
    }
    if (this._state === 'sitting' && this.lastPoseSpec.sit) {
      this.play('sitIdle', 0, true);
      const t = this.sitPlan(this.lastPoseSpec.sit);
      this.kneeRad = t.kneeRad;
      this.object.position.set(t.x, t.y, t.z);
      return;
    }
    if (this._state === 'walk') { this.play('walk', 0, true); return; }
    if (this._state === 'jog') { this.play('jog', 0, true); return; }
    this.play('idle', 0, true);
  }

  /**
   * Root position that puts this body's pelvis and seat where core/poses.ts intended for the mannequin, and how far the
   * knees are raised. A body whose butt-to-sole height is more than the seat is high keeps its feet on the floor by
   * raising the thighs (and swinging the shins back to vertical): up to 25 degrees, never through the floor.
   */
  private sitPlan(pose: SeatPose): { x: number; y: number; z: number; kneeRad: number } {
    const H = this._heightM;
    const yaw = pose.yawDeg * DEG;
    const back = (this.poseK.hipBack - SIT_HIP_BACK_RATIO) * H;
    const out = { x: pose.root.x + Math.sin(yaw) * back, z: pose.root.z + Math.cos(yaw) * back, y: 0, kneeRad: 0 };
    const seatY = pose.rootY + (SIT_SEAT_RATIO - this.poseK.seat) * H;
    const hipX = pose.root.x - Math.sin(yaw) * this.poseK.hipBack * H;
    const hipZ = pose.root.z - Math.cos(yaw) * this.poseK.hipBack * H;
    const probed = this.surfaceProbe ? this.surfaceProbe(hipX, hipZ) : null;
    // poses.ts clamps rootY at -0.02, so the seat height can only be recovered from it when it was not clamped
    const surface = probed ?? (pose.rootY > -0.02 + 1e-6 ? pose.rootY + SIT_SEAT_RATIO * H : null);
    if (!Number.isFinite(this.poseK.floor)) { out.y = seatY; return out; } // the mannequin: the SPEC constants, unchanged
    if (surface === null || !this.kneeBones) {
      out.y = Math.max(seatY, -this.poseK.floor * H);
      return out;
    }
    const gap = (this.poseK.seat - this.poseK.floor) * H; // underside of the buttocks down to the soles
    const need = Math.max(0, gap - surface + 0.01);
    const thighLen = 0.245 * H;
    out.kneeRad = Math.min(25 * DEG, Math.asin(Math.min(1, need / thighLen)));
    const rise = thighLen * Math.sin(out.kneeRad);
    out.y = Math.max(surface - this.poseK.seat * H, -this.poseK.floor * H - rise);
    return out;
  }

  private static readonly Q_A = new THREE.Quaternion();
  private static readonly Q_B = new THREE.Quaternion();
  private static readonly Q_C = new THREE.Quaternion();
  private static readonly AXIS_X = new THREE.Vector3(1, 0, 0);

  /** Raises the knees on top of the clip, in the model's own frame (X is sideways), blended in and out with the sit clips. */
  private applyKneeUp(): void {
    if (!this.kneeBones || this.kneeRad === 0) return;
    let blend = 0;
    const c = this.currentClip;
    if (c === 'sitIdle') blend = 1;
    else if (c === 'sitEnter' || c === 'sitExit') {
      const a = this.actions[c];
      const k = Math.min(1, Math.max(0, a.time / a.getClip().duration));
      const e = k * k * (3 - 2 * k);
      blend = c === 'sitEnter' ? e : 1 - e;
    }
    if (blend <= 0) return;
    const ang = this.kneeRad * blend;
    const { Q_A, Q_B, Q_C, AXIS_X } = Character;
    this.model.getWorldQuaternion(Q_C);
    const modelInv = Q_C.clone().invert();
    const apply = (bone: THREE.Bone, signedAng: number): void => {
      // The mixer only writes a bone when the clip value changed since the last frame, so a static clip would stack this
      // swing every frame. Keep the clip's value apart: when the bone still holds what we wrote, the mixer did not write.
      let st = this.kneeState.get(bone);
      if (!st) { st = { base: new THREE.Quaternion(), out: new THREE.Quaternion(NaN, NaN, NaN, NaN) }; this.kneeState.set(bone, st); }
      if (!bone.quaternion.equals(st.out)) st.base.copy(bone.quaternion);
      else bone.quaternion.copy(st.base);
      (bone.parent as THREE.Object3D).getWorldQuaternion(Q_A);
      Q_A.premultiply(modelInv); // parent rotation in the model frame
      Q_B.setFromAxisAngle(AXIS_X, signedAng); // the swing, in the model frame
      // local' = parent^-1 * swing * parent * local
      bone.quaternion.premultiply(Q_A).premultiply(Q_B).premultiply(Q_A.invert());
      st.out.copy(bone.quaternion);
      bone.updateMatrixWorld(true);
    };
    for (const t of this.kneeBones.thigh) apply(t, -ang);
    for (const k of this.kneeBones.calf) apply(k, ang);
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
    this.tint = tint;
    if (this.person) { this.person.setTop(tint); return; }
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
    this.model.scale.setScalar((m / this.h0) * (this.posed === 'lie' ? this.lieScale : 1));
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
    this.model.scale.setScalar((this._heightM / this.h0) * this.lieScale);
    this.lastPoseSpec = { lie: pose };
    this.setState('transition');
    const a = this.play(this.hasLiePose ? 'lie' : 'idle', FADE_S, true);
    a.timeScale = 0;
    a.time = 0;
    const target = {
      x: pose.feet.x, z: pose.feet.z,
      y: pose.surfaceY + this.poseK.back * this._heightM,
      tilt: -Math.PI / 2,
    };
    return this.moveTo(target, pose.yawDeg, LIE_IN_S, () => this.setState('lying'));
  }

  /** Sits (4.6): over 0.3 s the root moves to the seat spot, Sitting_Enter plays once, then Sitting_Idle_Loop. */
  sit(pose: SeatPose): Promise<void> {
    this.posed = 'sit';
    this.lastPoseSpec = { sit: pose };
    this.setState('transition');
    this.play('sitEnter', 0.15, true);
    const t = this.sitPlan(pose);
    this.kneeRad = t.kneeRad;
    return this.moveTo({ x: t.x, z: t.z, y: t.y, tilt: 0 }, pose.yawDeg, SIT_MOVE_S, () => this.setState('sitting'));
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
    if (was === 'lie') this.applyHeight(this._heightM); // back to the standing scale
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

  /** Names of the meshes that are drawn (the walkthru checks assert no `Mannequin` mesh is visible on a person). */
  visibleMeshNames(): string[] {
    const out: string[] = [];
    this.model.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.visible) out.push(m.name); });
    return out;
  }

  /**
   * SPEC 16.6.6 `__walkthru.person.measure()`: the skinned vertices of every mesh in world space. `headToHeelM` is the
   * extent along the body's own axis: vertical when upright, along the bed when lying.
   */
  measure(): PersonMeasure {
    // standing still, the idle clip breathes by a centimetre: the height is defined at Idle_Loop t = 0 (SPEC 4.6), so measure there
    const idle = this.actions.idle;
    const atIdle = this._state === 'idle' && this.currentClip === 'idle';
    const savedTime = idle.time;
    if (atIdle) { idle.time = 0; this.mixer.update(0); }
    const out = this.measureNow();
    if (atIdle) { idle.time = savedTime; this.mixer.update(0); }
    return out;
  }

  private measureNow(): PersonMeasure {
    this.object.updateMatrixWorld(true);
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const v = new THREE.Vector3();
    const yaw = this._yawDeg * DEG;
    const axis = this._state === 'lying' ? new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)) : new THREE.Vector3(0, 1, 0);
    let lo = Infinity, hi = -Infinity;
    for (const s of this.skinned) {
      s.skeleton.update();
      const p = s.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        s.getVertexPosition(i, v);
        v.applyMatrix4(s.matrixWorld);
        min.min(v); max.max(v);
        const d = v.dot(axis);
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
    }
    const pelvisBone = this.skinned[0].skeleton.bones.find((b) => /^(pelvis|DEF-hips)$/i.test(b.name));
    const pw = pelvisBone ? pelvisBone.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    return {
      heightM: max.y - min.y,
      pelvis: { x: pw.x, y: pw.y, z: pw.z },
      bboxMin: { x: min.x, y: min.y, z: min.z },
      bboxMax: { x: max.x, y: max.y, z: max.z },
      headToHeelM: hi - lo,
    };
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
    this.applyKneeUp();
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
