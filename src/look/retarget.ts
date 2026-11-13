// Owned by C11b. SPEC 16.6.3 "Clips". Moves our six mannequin clips (authored on a Rigify-style T-pose rig, bones named
// `DEF-...`) onto another skeleton with Unreal-style names (`pelvis`, `upperarm_l`, ...). Pure: three's math and clips only.
//
// Two methods, chosen by the gate in `retargetClipsAuto`:
//  1. `retargetClips` (SPEC): rename the tracks and scale the hips position. Valid only when every mapped bone has the same
//     rest-pose world rotation as the mannequin's, to within 2 degrees (the starter man is at 0.0).
//  2. `retargetClipsWorld`: bake each clip on a 30 Hz grid. At every frame the target bone's world rotation is the
//     source bone's world rotation change since rest, applied to the target's own rest rotation:  Wt = Ws * Ws_rest^-1 * Wt_rest.
//     This is exact when the two rigs rest in the same pose (a T-pose here, tools/make_people.py puts the MPFB bodies in
//     it) and keeps the target's own bone rolls, spine curve and proportions. Hips motion is the source's world motion
//     scaled by the ratio of the two pelvis rest heights.
import * as THREE from 'three';

/**
 * `DEF-upper_arm.L` -> `upperarm_l`. null for names we do not map. three's glTF loader strips the dots from node names
 * (`DEF-upper_armL`), so both spellings are accepted.
 */
export function ueNameFor(def: string): string | null {
  if (!def.startsWith('DEF-')) return null;
  const n = def.slice(4).replace(/\./g, '');
  const fixed: Record<string, string> = { hips: 'pelvis', spine001: 'spine_01', spine002: 'spine_02', spine003: 'spine_03', neck: 'neck_01', head: 'head' };
  if (fixed[n]) return fixed[n];
  const m = /^(shoulder|upper_arm|forearm|hand|thigh|shin|foot|toe)([LR])$/.exec(n);
  if (m) {
    const part = { shoulder: 'clavicle', upper_arm: 'upperarm', forearm: 'lowerarm', hand: 'hand', thigh: 'thigh', shin: 'calf', foot: 'foot', toe: 'ball' }[m[1] as string]!;
    return `${part}_${m[2].toLowerCase()}`;
  }
  const f = /^f_(index|middle|pinky|ring)0([123])([LR])$/.exec(n) ?? /^(thumb)0([123])([LR])$/.exec(n);
  if (f) return `${f[1]}_0${f[2]}_${f[3].toLowerCase()}`;
  return null;
}

/** Source track bone name -> the target skeleton's bone name (matched case-insensitively). Bones the target lacks are left out. */
export function buildNameMap(sourceBones: string[], targetBones: string[]): Map<string, string> {
  const lower = new Map(targetBones.map((b) => [b.toLowerCase(), b]));
  const out = new Map<string, string>();
  for (const s of sourceBones) {
    const ue = ueNameFor(s);
    const t = ue ? lower.get(ue) : undefined;
    if (t) out.set(s, t);
  }
  return out;
}

/** Track name `DEF-hips.position` -> ['DEF-hips', 'position']. */
function splitTrack(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  return [name.slice(0, i), name.slice(i + 1)];
}

/** The SPEC method: renamed copies, hips position scaled by `hipsScale`, tracks with no target bone dropped. */
export function retargetClips(clips: THREE.AnimationClip[], nameMap: Map<string, string>, hipsScale: number): THREE.AnimationClip[] {
  return clips.map((clip) => {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const tr of clip.tracks) {
      const [bone, prop] = splitTrack(tr.name);
      const to = nameMap.get(bone);
      if (!to) continue;
      const copy = tr.clone();
      copy.name = `${to}.${prop}`;
      if (prop === 'position' && bone === 'DEF-hips') {
        const v = copy.values;
        for (let i = 0; i < v.length; i++) v[i] *= hipsScale;
      }
      tracks.push(copy);
    }
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  });
}

// ---------------------------------------------------------------- rest poses

export interface RestBone {
  name: string;
  parent: string | null;
  /** local rest rotation */
  q: THREE.Quaternion;
  /** world rest rotation (includes any ancestors above the bones) */
  wq: THREE.Quaternion;
  /** world rest position */
  wp: THREE.Vector3;
  /** world matrix of the parent (identity for a root) */
  parentWorld: THREE.Matrix4;
}
export type RestRig = Map<string, RestBone>;

/** Reads a rig's rest pose from loaded objects (every Object3D below `root` whose name is in `only`, or all when omitted). */
export function readRest(root: THREE.Object3D, only?: Set<string>): RestRig {
  root.updateWorldMatrix(true, true);
  const out: RestRig = new Map();
  root.traverse((o) => {
    if (o === root || (only && !only.has(o.name)) || out.has(o.name)) return;
    if ((o as THREE.Mesh).isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh) return;
    const wq = new THREE.Quaternion();
    const wp = new THREE.Vector3();
    o.matrixWorld.decompose(wp, wq, new THREE.Vector3());
    let parent: THREE.Object3D | null = o.parent;
    while (parent && only && !only.has(parent.name)) parent = parent.parent;
    out.set(o.name, {
      name: o.name, parent: parent && parent !== root && (!only || only.has(parent.name)) ? parent.name : null,
      q: o.quaternion.clone(), wq, wp,
      parentWorld: o.parent ? o.parent.matrixWorld.clone() : new THREE.Matrix4(),
    });
  });
  return out;
}

/** Largest rest-world-rotation difference, in degrees, over the mapped bones. The gate for the rename method is 2. */
export function maxRestDiffDeg(source: RestRig, target: RestRig, nameMap: Map<string, string>): number {
  let worst = 0;
  for (const [s, t] of nameMap) {
    const a = source.get(s), b = target.get(t);
    if (!a || !b) continue;
    worst = Math.max(worst, (a.wq.angleTo(b.wq) * 180) / Math.PI);
  }
  return worst;
}

export const RENAME_GATE_DEG = 2;

/** Rename when the gate allows, the world-space bake otherwise. */
export function retargetClipsAuto(
  clips: THREE.AnimationClip[], source: RestRig, target: RestRig, nameMap: Map<string, string>,
): { clips: THREE.AnimationClip[]; method: 'rename' | 'world'; maxRestDiffDeg: number } {
  const diff = maxRestDiffDeg(source, target, nameMap);
  const hips = source.get('DEF-hips'), pelvis = target.get(nameMap.get('DEF-hips') ?? 'pelvis');
  const scale = hips && pelvis ? pelvis.wp.y / hips.wp.y : 1;
  if (diff <= RENAME_GATE_DEG) return { clips: retargetClips(clips, nameMap, scale), method: 'rename', maxRestDiffDeg: diff };
  return { clips: retargetClipsWorld(clips, source, target, nameMap), method: 'world', maxRestDiffDeg: diff };
}

// ---------------------------------------------------------------- the world-space bake

const BAKE_FPS = 30;

/** `createInterpolant` exists on every track but is missing from three's type declarations. */
function interpolantOf(tr: THREE.KeyframeTrack): THREE.Interpolant {
  return (tr as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
}

/** Bone order with parents first. */
function order(rig: RestRig): RestBone[] {
  const done = new Set<string>();
  const out: RestBone[] = [];
  const visit = (b: RestBone): void => {
    if (done.has(b.name)) return;
    done.add(b.name);
    const p = b.parent ? rig.get(b.parent) : undefined;
    if (p) visit(p);
    out.push(b);
  };
  for (const b of rig.values()) visit(b);
  return out;
}

export function retargetClipsWorld(
  clips: THREE.AnimationClip[], source: RestRig, target: RestRig, nameMap: Map<string, string>,
): THREE.AnimationClip[] {
  const srcOrder = order(source);
  const tgtOrder = order(target);
  // frame correction per mapped bone pair: C = Ws_rest^-1 * Wt_rest, so Wt = Ws * C
  const toSource = new Map<string, string>();
  const corr = new Map<string, THREE.Quaternion>();
  for (const [s, t] of nameMap) {
    const a = source.get(s), b = target.get(t);
    if (!a || !b) continue;
    toSource.set(t, s);
    corr.set(t, a.wq.clone().invert().multiply(b.wq));
  }
  const hipsSrcName = [...nameMap.keys()].find((k) => k === 'DEF-hips');
  const hipsTgtName = hipsSrcName ? nameMap.get(hipsSrcName)! : null;
  const hipsSrc = hipsSrcName ? source.get(hipsSrcName) : undefined;
  const hipsTgt = hipsTgtName ? target.get(hipsTgtName) : undefined;
  const hipsScale = hipsSrc && hipsTgt ? hipsTgt.wp.y / hipsSrc.wp.y : 1;
  const srcParentWorldQ = new Map<string, THREE.Quaternion>();
  const rootParentQ = (b: RestBone): THREE.Quaternion => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(b.parentWorld));
  for (const b of srcOrder) srcParentWorldQ.set(b.name, b.parent ? new THREE.Quaternion() : rootParentQ(b));

  const out: THREE.AnimationClip[] = [];
  const tmp = new THREE.Quaternion();
  for (const clip of clips) {
    const rot = new Map<string, THREE.Interpolant>();
    let hipsPos: THREE.Interpolant | null = null;
    for (const tr of clip.tracks) {
      const [bone, prop] = splitTrack(tr.name);
      if (prop === 'quaternion' && source.has(bone)) rot.set(bone, interpolantOf(tr));
      if (prop === 'position' && bone === hipsSrcName) hipsPos = interpolantOf(tr);
    }
    const steps = Math.max(1, Math.ceil(clip.duration * BAKE_FPS));
    const times = new Float32Array(steps + 1);
    for (let i = 0; i <= steps; i++) times[i] = (clip.duration * i) / steps;
    const rotVals = new Map<string, Float32Array>();
    for (const [t] of corr) rotVals.set(t, new Float32Array((steps + 1) * 4));
    const posVals = new Float32Array((steps + 1) * 3);
    const srcWorld = new Map<string, THREE.Quaternion>();
    const tgtWorld = new Map<string, THREE.Quaternion>();
    const hipsParentInv = hipsTgt ? hipsTgt.parentWorld.clone().invert() : new THREE.Matrix4();
    const srcHipsParent = hipsSrc ? hipsSrc.parentWorld : new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (let i = 0; i <= steps; i++) {
      const t = times[i];
      for (const b of srcOrder) {
        const it = rot.get(b.name);
        let local = b.q;
        if (it) { const r = it.evaluate(t) as unknown as ArrayLike<number>; local = tmp.set(r[0], r[1], r[2], r[3]).clone(); }
        const parent = b.parent ? srcWorld.get(b.parent)! : srcParentWorldQ.get(b.name)!;
        srcWorld.set(b.name, parent.clone().multiply(local));
      }
      for (const b of tgtOrder) {
        const s = toSource.get(b.name);
        const parent = b.parent ? tgtWorld.get(b.parent)! : rootParentQ(b);
        let world: THREE.Quaternion;
        let local: THREE.Quaternion;
        if (s) {
          world = srcWorld.get(s)!.clone().multiply(corr.get(b.name)!);
          local = parent.clone().invert().multiply(world);
          const dst = rotVals.get(b.name)!;
          dst[i * 4] = local.x; dst[i * 4 + 1] = local.y; dst[i * 4 + 2] = local.z; dst[i * 4 + 3] = local.w;
        } else {
          local = b.q;
          world = parent.clone().multiply(local);
        }
        tgtWorld.set(b.name, world);
      }
      if (hipsPos && hipsSrc && hipsTgt) {
        const v = hipsPos.evaluate(t) as unknown as ArrayLike<number>;
        p.set(v[0], v[1], v[2]).applyMatrix4(srcHipsParent);
        p.sub(hipsSrc.wp).multiplyScalar(hipsScale).add(hipsTgt.wp).applyMatrix4(hipsParentInv);
        posVals[i * 3] = p.x; posVals[i * 3 + 1] = p.y; posVals[i * 3 + 2] = p.z;
      }
    }
    const tracks: THREE.KeyframeTrack[] = [];
    for (const [name, vals] of rotVals) tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, Array.from(times), Array.from(vals)));
    if (hipsPos && hipsTgtName) tracks.push(new THREE.VectorKeyframeTrack(`${hipsTgtName}.position`, Array.from(times), Array.from(posVals)));
    out.push(new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  return out;
}

// ---------------------------------------------------------------- lying

/** Name of the one-frame clip a person body lies in. */
export const LIE_CLIP = 'Lie_Pose';

/**
 * A body lying on its back needs straight legs, but Idle_Loop starts with one foot stepped back (the mannequin's lying test
 * lets that leg sink 20 cm into the mattress). `Lie_Pose` is the first frame of the retargeted Idle_Loop with both legs
 * set back to the rig's rest pose (straight, feet together). Empty when there is no Idle_Loop.
 */
export function liePoseClip(clips: THREE.AnimationClip[], target: RestRig, nameMap: Map<string, string>): THREE.AnimationClip[] {
  const idle = clips.find((c) => c.name === 'Idle_Loop');
  if (!idle) return [];
  const legs = new Set<string>();
  for (const t of nameMap.values()) if (/^(thigh|calf|foot|ball)_[lr]$/i.test(t)) legs.add(t);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const tr of idle.tracks) {
    const i = tr.name.lastIndexOf('.');
    const bone = tr.name.slice(0, i);
    const prop = tr.name.slice(i + 1);
    const size = tr.getValueSize();
    let first = Array.from(tr.values.slice(0, size));
    if (prop === 'quaternion' && legs.has(bone)) {
      const rest = target.get(bone)?.q;
      if (rest) first = [rest.x, rest.y, rest.z, rest.w];
    }
    const Track = prop === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    tracks.push(new Track(tr.name, [0, 1], [...first, ...first]));
  }
  return [new THREE.AnimationClip(LIE_CLIP, 1, tracks)];
}

// ---------------------------------------------------------------- idles

/** Names of the two one-shot idle clips a person body gets (SPEC 16.6.3): glance round the room, reach forward to open a door. */
export const LOOK_CLIP = 'Look_Around';
export const REACH_CLIP = 'Reach_Forward';

interface Edit {
  /** target bone name */
  bone: string;
  /** world axis the bone is swung about (the rest pose is a T-pose with Y up and Z forward, so X is sideways) */
  axis: THREE.Vector3;
  /** degrees at time t seconds */
  deg: (t: number) => number;
}

/** Smooth 0 to 1 to 0 envelope: ramp up over `up`, hold until `hold`, ramp down by `end`. */
function envelope(t: number, up: number, hold: number, end: number): number {
  if (t <= 0 || t >= end) return 0;
  const s = (x: number): number => x * x * (3 - 2 * x);
  if (t < up) return s(t / up);
  if (t <= hold) return 1;
  return s(1 - (t - hold) / (end - hold));
}

/**
 * A copy of `idle` (looped for `duration` seconds, baked at 30 Hz) with extra rotations on a few bones. Every track of the
 * idle is kept, because a clip that left a bone out would let it drift to its bind pose while the clip is blended in.
 * An edit swings the bone about a world axis: local' = parentWorld^-1 * R(axis, angle) * parentWorld * local, with the
 * parent taken at its rest pose (the idle only sways a little).
 */
export function idleVariant(name: string, idle: THREE.AnimationClip, target: RestRig, duration: number, edits: Edit[]): THREE.AnimationClip {
  const steps = Math.ceil(duration * BAKE_FPS);
  const times = Array.from({ length: steps + 1 }, (_, i) => (duration * i) / steps);
  const parentInv = (bone: string): THREE.Quaternion => {
    const b = target.get(bone);
    const p = b?.parent ? target.get(b.parent) : undefined;
    return (p ? p.wq : new THREE.Quaternion()).clone().invert();
  };
  const tracks: THREE.KeyframeTrack[] = [];
  const q = new THREE.Quaternion();
  const swing = new THREE.Quaternion();
  for (const tr of idle.tracks) {
    const [bone, prop] = splitTrack(tr.name);
    const it = interpolantOf(tr);
    const size = tr.getValueSize();
    const mine = prop === 'quaternion' ? edits.filter((e) => e.bone === bone) : [];
    const vals = new Float32Array((steps + 1) * size);
    for (let i = 0; i <= steps; i++) {
      const r = it.evaluate(times[i] % idle.duration) as unknown as ArrayLike<number>;
      for (let k = 0; k < size; k++) vals[i * size + k] = r[k];
      if (mine.length === 0) continue;
      q.set(r[0], r[1], r[2], r[3]);
      for (const e of mine) {
        const pw = parentInv(bone);
        swing.setFromAxisAngle(e.axis, (e.deg(times[i]) * Math.PI) / 180);
        // pw is parentWorld^-1: local' = pw * swing * pw^-1 * local
        q.premultiply(pw.clone().invert()).premultiply(swing).premultiply(pw);
      }
      vals[i * size] = q.x; vals[i * size + 1] = q.y; vals[i * size + 2] = q.z; vals[i * size + 3] = q.w;
    }
    const Track = prop === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    tracks.push(new Track(tr.name, times, Array.from(vals)));
  }
  return new THREE.AnimationClip(name, duration, tracks);
}

/**
 * The two idle clips every person gets, built from the retargeted Idle_Loop: `Look_Around` turns the head (and a little of
 * the neck and chest) to one side, then the other, and back; `Reach_Forward` lifts the right arm forward and bends the
 * elbow, as when opening a wardrobe door. Empty when the rig lacks the bones.
 */
export function idleVariants(clips: THREE.AnimationClip[], target: RestRig, nameMap: Map<string, string>): THREE.AnimationClip[] {
  const idle = clips.find((c) => c.name === 'Idle_Loop');
  if (!idle) return [];
  const has = (n: string): boolean => target.has(n);
  const need = ['neck_01', 'head', 'spine_03', 'upperarm_r', 'lowerarm_r'];
  if (!need.every(has)) return [];
  void nameMap;
  const Y = new THREE.Vector3(0, 1, 0);
  const X = new THREE.Vector3(1, 0, 0);
  const keys: [number, number][] = [[0, 0], [0.9, 1], [1.7, 1], [2.7, -1], [3.4, -1], [4.3, 0], [4.4, 0]];
  const look = (t: number): number => {
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
      if (t <= t1) { const k = (t - t0) / (t1 - t0); return v0 + (v1 - v0) * k * k * (3 - 2 * k); }
    }
    return 0;
  };
  const L = 4.4;
  const lookClip = idleVariant(LOOK_CLIP, idle, target, L, [
    { bone: 'spine_03', axis: Y, deg: (t) => 6 * look(t) },
    { bone: 'neck_01', axis: Y, deg: (t) => 22 * look(t) },
    { bone: 'head', axis: Y, deg: (t) => 22 * look(t) },
  ]);
  const R = 1.9;
  const up = (t: number): number => envelope(t, 0.45, 1.25, R);
  const reachClip = idleVariant(REACH_CLIP, idle, target, R, [
    { bone: 'upperarm_r', axis: X, deg: (t) => -62 * up(t) },
    { bone: 'lowerarm_r', axis: X, deg: (t) => -38 * up(t) },
    { bone: 'spine_02', axis: X, deg: (t) => 4 * up(t) },
  ]);
  return [lookClip, reachClip];
}
