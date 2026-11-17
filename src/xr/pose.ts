// Where the viewer stands in the home, and how that is told to the headset. Pure: plain numbers, no three.
//
// The headset reports the head and the hands in its own play space (`local-floor`: the real floor is y = 0, the origin is where the viewer
// started). The home is in metres in its own frame, floor at y = 0 as well (SPEC 3.1). A `Pose` says how the play space sits in the home:
// turned about the vertical by `yaw` (radians, three's sense: positive turns the play space counter-clockwise seen from above), then moved to
// (x, 0, z). So  world = R(yaw) * local + (x, z).  Moving the viewer never moves the home and never changes its size.
//
// The headset is told the same thing as a reference-space offset: the pose of the new space's origin in the old one, which is the inverse,
// so a point at `local` in the old space reads as R(yaw) * local + P in the new one (the world).

export interface V2 { x: number; z: number }
export interface Pose { x: number; z: number; yaw: number }

export const IDENTITY_POSE: Pose = { x: 0, z: 0, yaw: 0 };

/** Rotates (x, z) about +Y by `yaw` (three's right-handed rotation about Y). */
export function rotateY(v: V2, yaw: number): V2 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: v.x * c + v.z * s, z: -v.x * s + v.z * c };
}

export const toWorld = (pose: Pose, local: V2): V2 => { const r = rotateY(local, pose.yaw); return { x: r.x + pose.x, z: r.z + pose.z }; };
export const toLocal = (pose: Pose, world: V2): V2 => rotateY({ x: world.x - pose.x, z: world.z - pose.z }, -pose.yaw);

/** The pose that keeps the play space turned as it is, with the head (at `headLocal` in the play space) standing over the floor point `target`. */
export function poseOver(yaw: number, headLocal: V2, target: V2): Pose {
  const r = rotateY(headLocal, yaw);
  return { x: target.x - r.x, z: target.z - r.z, yaw };
}

/** A snap turn: the view turns by `delta` about the head, which stays where it is in the home. */
export function turnAbout(pose: Pose, headWorld: V2, delta: number): Pose {
  const hl = toLocal(pose, headWorld);
  return poseOver(pose.yaw + delta, hl, headWorld);
}

/** Wraps an angle to (-pi, pi]. */
export function wrapPi(a: number): number {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  else if (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}

/** The heading a camera has when it looks along (fx, fz): three's camera looks down -z, a positive yaw turns it counter-clockwise from above. */
export const cameraYawOf = (fx: number, fz: number): number => Math.atan2(-fx, -fz);
/** A home's heading in degrees (SPEC 3.1: forward is (sin yaw, cos yaw)) as the yaw a camera has when it looks that way. */
export const cameraYawForSceneYaw = (sceneYawDeg: number): number => (sceneYawDeg * Math.PI) / 180 + Math.PI;

/**
 * Stands the viewer over `target` looking along the home heading `sceneYawDeg`. `headLocalYaw` is the heading of the head in the play space (how the
 * viewer is really turned), `headLocal` where it is. Used by "go to this room": the room's standing spot comes with the way to face.
 */
export function poseFacing(headLocal: V2, headLocalYaw: number, target: V2, sceneYawDeg: number): Pose {
  const yaw = wrapPi(cameraYawForSceneYaw(sceneYawDeg) - headLocalYaw);
  return poseOver(yaw, headLocal, target);
}

/** The reference-space offset that puts the play space at `pose`: a position and a quaternion (x, y, z, w) for an `XRRigidTransform`. */
export function referenceOffset(pose: Pose): { position: { x: number; y: number; z: number }; orientation: { x: number; y: number; z: number; w: number } } {
  const p = rotateY({ x: pose.x, z: pose.z }, -pose.yaw);
  const h = -pose.yaw / 2;
  return { position: { x: -p.x, y: 0, z: -p.z }, orientation: { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) } };
}

/** The inverse of `referenceOffset`, for the checks: a point read in the offset space, back to the old one. */
export function applyOffsetInverse(off: ReturnType<typeof referenceOffset>, p: V2): V2 {
  // the offset's rotation is about Y by -yaw (the pose's yaw): its inverse turns by +yaw
  const yaw = -2 * Math.atan2(off.orientation.y, off.orientation.w);
  return rotateY({ x: p.x - off.position.x, z: p.z - off.position.z }, yaw);
}
