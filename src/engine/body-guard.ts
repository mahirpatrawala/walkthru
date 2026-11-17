// The drawn body stays out of the walls (SPEC 4.12). three only; the geometry of the question is in src/core/body-fit.ts.
//
// Every frame, after the clips have posed the skeleton and only while something stands near the walker:
//   1. a few hundred points of the body's own skin (picked once per body: the outermost vertices of every bone, carried rigidly by that
//      bone) are placed in the world;
//   2. an arm that would touch something is held in, by as much as it would touch (swung down to the side, eased in and out);
//   3. a body that still has no room (standing, or walking where the passage is narrower than a stride) is drawn up (feet under the hips, upright)
//      by as much as it lacks: in a gap too tight for a stride it shuffles, it does not put a foot through the wall;
//   4. the drawn body is shifted on the floor, by the least that keeps every point a margin clear (`solveBodyFit`). The shift is applied the
//      frame it is needed (nothing is ever drawn through a wall while a filter catches up) and eased away when it is not.
// The collision spot (`Character.position`) is never touched: walking, doors, the camera and the tour all still see the same walker.
import * as THREE from 'three';
import { BODY_FIT_MARGIN_M, BODY_FIT_MAX_SHIFT_M, bandOf, fitResidual, sightField, sightPush, solveBodyFit } from '../core/body-fit';
import type { SightField } from '../core/body-fit';
import type { Grid } from '../types';

const FINGER = /(index|middle|pinky|ring|thumb)/i;
/** An arm that would be this far into the margin is held fully in; less, in proportion. */
const ARM_FULL_M = 0.05;
/** A body this short of room (after the shift and the arms) is drawn fully up; less, in proportion. */
const STANCE_FULL_M = 0.06;
/** How fast the arms come in and go back out, and the stance, seconds (time constants). */
const TUCK_IN_S = 0.07;
const TUCK_OUT_S = 0.3;
/** How fast a shift that is no longer needed goes away, seconds. */
const SHIFT_EASE_S = 0.18;
/** The furthest any clip reaches from the root, as a share of the body's height (the jog: 0.51), and so how much of the grid is looked at. */
const REACH_RATIO = 0.56;
/** A held-in arm hangs this far out from straight down, and its forearm this far forward, degrees. */
const ARM_OUT_DEG = 2.5;
const FOREARM_FWD_DEG = 8;

/**
 * A point of the skin: a vertex of the body, followed exactly as the renderer skins it (every one of its up to four bones with its weight, from its
 * own bind-space position). Carrying it rigidly with its main bone instead put it up to 35 cm from the drawn skin near a swinging hip or knee.
 */
interface Probe { bone: THREE.Bone; refs: { bone: THREE.Bone; inv: THREE.Matrix4; w: number }[]; base: THREE.Vector3; arm: -1 | 0 | 1; leg: boolean }
interface Kept { bone: THREE.Bone; base: THREE.Quaternion; out: THREE.Quaternion }
interface Arm { upper: THREE.Bone; fore: THREE.Bone; hand: THREE.Bone; side: 1 | -1 }
interface Leg { thigh: THREE.Bone; calf: THREE.Bone; foot: THREE.Bone }

const DIRS: THREE.Vector3[] = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) DIRS.push(new THREE.Vector3(x, y, z).normalize());

const V_A = new THREE.Vector3();
const V_B = new THREE.Vector3();
const V_C = new THREE.Vector3();
const V_D = new THREE.Vector3();
const Q_A = new THREE.Quaternion();
const Q_B = new THREE.Quaternion();
const Q_C = new THREE.Quaternion();
const Q_ID = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);
const DEG = Math.PI / 180;

export class BodyGuard {
  /** the grid the body is fitted to (walls, furniture, door leaves), or null for none. Set by whoever owns the walker. */
  grid: (() => Grid | null) | null = null;
  /** world shift of the drawn body from the collision spot, metres */
  readonly shift = { x: 0, z: 0 };
  /** what is still short after the shift, metres (diagnostics and tests) */
  residual = 0;
  /** how far each arm is held in, 0..1 (left, right), and how far the stance is drawn up */
  readonly arm: [number, number] = [0, 0];
  stance = 0;

  private probes: Probe[] = [];
  private pts = new Float32Array(0);
  private kept: Kept[] = [];
  private arms: Arm[] = [];
  private legs: Leg[] = [];
  private pelvis: THREE.Bone | null = null;
  private lift = 0;
  /** the first frame after a reset (a teleport, a new body): the held-in arms and the stance go to where they are needed at once, they are not eased in from a pose that was never drawn */
  private snap = true;
  private last: { grid: Grid; x: number; z: number; r: number; field: SightField } | null = null;

  constructor(private readonly root: THREE.Object3D, private readonly carrier: THREE.Object3D, private readonly shadow: THREE.Object3D | null) {}

  /** Picks the skin points and finds the arm and leg bones of a newly bound body. */
  rebuild(skinned: THREE.SkinnedMesh[]): void {
    this.probes = [];
    this.kept = [];
    this.arms = [];
    this.legs = [];
    this.pelvis = null;
    this.last = null;
    this.reset();
    const canon = (b: THREE.Bone): THREE.Bone => {
      let c: THREE.Object3D = b;
      while (FINGER.test(c.name) && c.parent && (c.parent as THREE.Bone).isBone) c = c.parent;
      return c as THREE.Bone;
    };
    // per bone, per direction: the vertex furthest that way in the rest pose
    const best = new Map<THREE.Bone, { score: Float32Array; at: THREE.Vector3[]; src: { s: THREE.SkinnedMesh; k: number }[] }>();
    const m = new THREE.Vector3();
    for (const s of skinned) {
      const pos = s.geometry.attributes.position, si = s.geometry.attributes.skinIndex, sw = s.geometry.attributes.skinWeight;
      if (!pos || !si || !sw) continue;
      const bones = s.skeleton.bones;
      for (let k = 0; k < pos.count; k++) {
        let w = sw.getX(k), j = si.getX(k);
        if (sw.getY(k) > w) { w = sw.getY(k); j = si.getY(k); }
        if (sw.getZ(k) > w) { w = sw.getZ(k); j = si.getZ(k); }
        if (sw.getW(k) > w) { w = sw.getW(k); j = si.getW(k); }
        const raw = bones[j];
        if (!raw) continue;
        const bone = canon(raw);
        let e = best.get(bone);
        if (!e) {
          const idx = bones.indexOf(bone);
          if (idx < 0) continue;
          e = { score: new Float32Array(DIRS.length).fill(-Infinity), at: DIRS.map(() => new THREE.Vector3()), src: DIRS.map(() => ({ s, k })) };
          best.set(bone, e);
        }
        m.fromBufferAttribute(pos, k).applyMatrix4(s.bindMatrix);
        for (let d = 0; d < DIRS.length; d++) {
          const sc = m.dot(DIRS[d]);
          if (sc > e.score[d]) { e.score[d] = sc; e.at[d].copy(m); e.src[d] = { s, k }; }
        }
      }
    }
    const all = skinned[0]?.skeleton.bones ?? [];
    const find = (re: RegExp): THREE.Bone | undefined => all.find((b) => re.test(b.name));
    for (const [side, re] of [[1, /(_l|L)$/], [-1, /(_r|R)$/]] as const) {
      const named = (part: RegExp): THREE.Bone | undefined => all.find((b) => part.test(b.name) && re.test(b.name) && !FINGER.test(b.name));
      const upper = named(/upper_?arm/i), fore = named(/lowerarm|forearm/i), hand = named(/hand/i);
      if (upper && fore && hand) this.arms.push({ upper, fore, hand, side });
      const thigh = named(/thigh/i), calf = named(/calf|shin/i), foot = named(/foot/i);
      if (thigh && calf && foot) this.legs.push({ thigh, calf, foot });
    }
    this.pelvis = find(/^(pelvis|DEF-hips)$/i) ?? null;
    const armOf = (b: THREE.Bone): -1 | 0 | 1 => {
      const i = this.arms.findIndex((a) => a.upper === b || a.fore === b || a.hand === b);
      return i < 0 ? -1 : (i as 0 | 1);
    };
    const legBones = new Set(this.legs.flatMap((l) => [l.thigh, l.calf, l.foot, ...l.foot.children]));
    const seen = new Set<string>();
    for (const [bone, e] of best) {
      for (let d = 0; d < DIRS.length; d++) {
        if (!isFinite(e.score[d])) continue;
        const p = e.at[d];
        const key = `${bone.uuid}:${Math.round(p.x * 500)}:${Math.round(p.y * 500)}:${Math.round(p.z * 500)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const { s: mesh, k } = e.src[d];
        const si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
        const refs: Probe['refs'] = [];
        for (let c = 0; c < 4; c++) {
          const w = [sw.getX(k), sw.getY(k), sw.getZ(k), sw.getW(k)][c];
          const j = [si.getX(k), si.getY(k), si.getZ(k), si.getW(k)][c];
          if (w > 1e-4 && mesh.skeleton.bones[j]) refs.push({ bone: mesh.skeleton.bones[j], inv: mesh.skeleton.boneInverses[j], w });
        }
        const tot = refs.reduce((a, r) => a + r.w, 0) || 1;
        for (const r of refs) r.w /= tot;
        this.probes.push({ bone, refs, base: p.clone(), arm: armOf(bone), leg: legBones.has(bone) });
      }
    }
    this.pts = new Float32Array(this.probes.length * 3);
    for (const a of this.arms) for (const b of [a.upper, a.fore]) this.kept.push({ bone: b, base: new THREE.Quaternion(), out: new THREE.Quaternion(NaN, NaN, NaN, NaN) });
    for (const l of this.legs) for (const b of [l.thigh, l.calf, l.foot]) this.kept.push({ bone: b, base: new THREE.Quaternion(), out: new THREE.Quaternion(NaN, NaN, NaN, NaN) });
  }

  /** How many skin points the body is checked with. */
  get pointCount(): number {
    return this.probes.length;
  }

  /** Drops the shift and the held-in pose at once (a teleport, a pose, a new body). */
  reset(): void {
    this.shift.x = 0; this.shift.z = 0;
    this.arm[0] = 0; this.arm[1] = 0;
    this.stance = 0;
    this.lift = 0;
    this.residual = 0;
    this.snap = true;
    this.place();
  }

  /**
   * Run once per frame after the mixer. `active` is false while the body is posed (sitting, lying, standing at something, on its way there):
   * the shift and the held-in pose then ease away. `standing` is kept for callers and tests: a body that lacks room is drawn up whether it stands or walks.
   */
  update(dt: number, active: boolean, standing: boolean, heightM: number): void {
    // the mixer writes a bone only when its clip value changed: where last frame's swing is still there, put the clip's value back first
    for (const k of this.kept) {
      if (k.bone.quaternion.equals(k.out)) k.bone.quaternion.copy(k.base);
      else k.base.copy(k.bone.quaternion);
      k.out.set(NaN, NaN, NaN, NaN);
    }
    const grid = active ? this.grid?.() ?? null : null;
    const x = this.root.position.x, z = this.root.position.z;
    let field: SightField | null = null;
    if (grid && this.probes.length > 0) {
      const r = REACH_RATIO * heightM + BODY_FIT_MAX_SHIFT_M + BODY_FIT_MARGIN_M + grid.cellM;
      if (!this.last || this.last.grid !== grid || this.last.x !== x || this.last.z !== z || this.last.r !== r) this.last = { grid, x, z, r, field: sightField(grid, x, z, r) };
      field = this.last.field;
      if (!field.valid || field.open) field = null;
    }
    const idle = !field && this.arm[0] < 0.002 && this.arm[1] < 0.002 && this.stance < 0.002;
    if (idle) {
      this.snap = false;
      this.arm[0] = this.arm[1] = this.stance = 0;
      this.lift = 0;
      this.residual = 0;
      const k = dt > 0 ? Math.exp(-dt / SHIFT_EASE_S) : 1;
      this.shift.x *= k; this.shift.z *= k;
      if (Math.hypot(this.shift.x, this.shift.z) < 1e-4) { this.shift.x = 0; this.shift.z = 0; }
      this.place();
      return;
    }
    // the points are placed with the body on its collision spot; the shift is worked out from there
    this.carrier.position.x = 0; this.carrier.position.z = 0;
    this.root.updateMatrixWorld(true);

    // 2. the arms: by how much each would touch, standing on the spot
    const want: [number, number] = [0, 0];
    if (field) {
      for (const pr of this.probes) {
        if (pr.arm < 0) continue;
        worldOf(pr, V_A);
        const d = sightPush(field, bandOf(V_A.y - this.root.position.y), V_A.x, V_A.z, BODY_FIT_MARGIN_M);
        const side = pr.arm as 0 | 1;
        if (d > want[side]) want[side] = d;
      }
    }
    for (let i = 0; i < 2; i++) {
      const goal = Math.min(1, want[i] / ARM_FULL_M);
      this.arm[i] = this.snap ? goal : ease(this.arm[i], goal, dt);
      if (this.arm[i] > 0.002 && this.arms[i]) this.tuckArm(this.arms[i], this.arm[i]);
    }

    // 3. the stance: what a standing body still lacks with its arms in
    let lack = 0;
    if (field && this.legs.length === 2) {
      this.collect();
      const fit = solveBodyFit(field, this.pts, this.probes.length, BODY_FIT_MARGIN_M, 0, 0);
      lack = fit.residual;
    }
    const stanceGoal = Math.min(1, lack / STANCE_FULL_M);
    this.stance = this.snap ? stanceGoal : ease(this.stance, stanceGoal, dt);
    if (this.stance > 0.002 && this.legs.length === 2) this.drawUp(this.stance);
    else this.lift = 0;

    // 4. the shift
    const k = dt > 0 ? Math.exp(-dt / SHIFT_EASE_S) : 1;
    if (field) {
      this.collect();
      const fit = solveBodyFit(field, this.pts, this.probes.length, BODY_FIT_MARGIN_M, this.shift.x * k, this.shift.z * k);
      this.shift.x = fit.x; this.shift.z = fit.z;
      this.residual = fit.residual;
    } else {
      this.shift.x *= k; this.shift.z *= k;
      this.residual = 0;
    }
    this.snap = false;
    this.place();
  }

  /** The deepest any skin point is past the margin as the body is drawn now, metres (tests). */
  measure(): number {
    if (!this.last || !this.last.field.valid) return 0;
    const sx = this.carrier.position.x, sz = this.carrier.position.z;
    this.carrier.position.x = 0; this.carrier.position.z = 0;
    this.root.updateMatrixWorld(true);
    this.collect();
    this.carrier.position.x = sx; this.carrier.position.z = sz;
    this.root.updateMatrixWorld(true);
    return fitResidual(this.last.field, this.pts, this.probes.length, BODY_FIT_MARGIN_M, this.shift.x, this.shift.z);
  }

  private collect(): void {
    const y0 = this.root.position.y;
    for (let i = 0; i < this.probes.length; i++) {
      const pr = this.probes[i];
      worldOf(pr, V_A);
      this.pts[3 * i] = V_A.x;
      this.pts[3 * i + 1] = V_A.z;
      this.pts[3 * i + 2] = bandOf(V_A.y - y0);
    }
  }

  /** writes the shift (world metres) into the carrier group, which lives in the root's turned frame */
  private place(): void {
    const yaw = this.root.rotation.y;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const lx = this.shift.x * c - this.shift.z * s, lz = this.shift.x * s + this.shift.z * c;
    this.carrier.position.x = lx; this.carrier.position.z = lz;
    this.carrier.position.y = this.lift;
    if (this.shadow) { this.shadow.position.x = lx; this.shadow.position.z = lz; }
  }

  /** swings `bone` so that the line to `child` points along `dir` (world), by weight `w`; the bone's subtree follows */
  private aim(bone: THREE.Bone, child: THREE.Object3D, dir: THREE.Vector3, w: number): void {
    bone.getWorldPosition(V_A);
    child.getWorldPosition(V_B).sub(V_A).normalize();
    Q_A.setFromUnitVectors(V_B, dir);
    Q_B.copy(Q_ID).slerp(Q_A, w);
    this.swing(bone, Q_B);
  }

  /** turns `bone` by the world rotation `q`: local' = parent^-1 * q * parent * local */
  private swing(bone: THREE.Bone, q: THREE.Quaternion): void {
    (bone.parent as THREE.Object3D).getWorldQuaternion(Q_C);
    bone.quaternion.premultiply(Q_C).premultiply(q).premultiply(Q_C.invert());
    const k = this.kept.find((e) => e.bone === bone);
    if (k) k.out.copy(bone.quaternion);
    bone.updateMatrixWorld(true);
  }

  private tuckArm(a: Arm, w: number): void {
    this.root.getWorldQuaternion(Q_A);
    const out = ARM_OUT_DEG * DEG;
    V_C.set(a.side * Math.sin(out), -Math.cos(out), 0).applyQuaternion(Q_A).normalize();
    const upper = V_C.clone();
    const f = FOREARM_FWD_DEG * DEG;
    V_C.set(a.side * Math.sin(out), -Math.cos(f), Math.sin(f)).applyQuaternion(Q_A).normalize();
    const fore = V_C.clone();
    this.aim(a.upper, a.fore, upper, w);
    this.aim(a.fore, a.hand, fore, w);
  }

  /** feet under the hips, legs straight, the feet kept flat and where they point: by weight `w`. The body is lifted so the feet stay on the floor. */
  private drawUp(w: number): void {
    let drop = 0;
    for (const l of this.legs) {
      l.foot.getWorldPosition(V_D);
      const before = V_D.y;
      l.foot.getWorldQuaternion(Q_A);
      const footWorld = Q_A.clone();
      this.aim(l.thigh, l.calf, DOWN, w);
      this.aim(l.calf, l.foot, DOWN, w);
      // the foot keeps the way it lay on the floor
      (l.foot.parent as THREE.Object3D).getWorldQuaternion(Q_C);
      l.foot.quaternion.copy(Q_C.invert().multiply(footWorld));
      const k = this.kept.find((e) => e.bone === l.foot);
      if (k) k.out.copy(l.foot.quaternion);
      l.foot.updateMatrixWorld(true);
      l.foot.getWorldPosition(V_D);
      drop += (before - V_D.y) / this.legs.length;
    }
    // straight legs are longer than slanted ones: the drawn body rises by what the feet went down
    this.lift = drop;
    this.carrier.position.y = drop;
    this.root.updateMatrixWorld(true);
  }
}

const V_W = new THREE.Vector3();
/** where the renderer draws the probe's vertex now (the bones' world matrices must be current) */
function worldOf(pr: Probe, out: THREE.Vector3): THREE.Vector3 {
  out.set(0, 0, 0);
  for (const r of pr.refs) out.addScaledVector(V_W.copy(pr.base).applyMatrix4(r.inv).applyMatrix4(r.bone.matrixWorld), r.w);
  return out;
}

function ease(now: number, goal: number, dt: number): number {
  if (!(dt > 0)) return now;
  const tau = goal > now ? TUCK_IN_S : TUCK_OUT_S;
  const next = goal + (now - goal) * Math.exp(-dt / tau);
  return Math.abs(next - goal) < 1e-3 ? goal : next;
}
