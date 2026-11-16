// The landing hero's camera: a small orthographic camera that turns about the building's vertical axis, tilts, zooms and pans, and
// the few rules the picture is drawn by (which faces look at the camera, what is in front of what). Pure maths: no DOM, no canvas.
// Plan coordinates are the app's: x east, z south, y up. On the screen x runs right and y runs down.

export interface Camera {
  /** radians about the vertical: the camera stands at (sin yaw, cos yaw) on the plan, looking back at the pivot */
  yaw: number;
  /** radians above the horizon: 0 is a side elevation, PI / 2 a plan */
  elev: number;
  /** 1 fits the building in the frame at every yaw */
  zoom: number;
  /** a shift of the picture, in frame widths and heights */
  panX: number; panY: number;
}
export const ELEV_MIN = (15 * Math.PI) / 180, ELEV_MAX = (70 * Math.PI) / 180;
export const ZOOM_MIN = 0.7, ZOOM_MAX = 2.6, PAN_MAX = 0.3;

const TAU = Math.PI * 2;
/** An angle brought into (-PI, PI]. */
export const wrapAngle = (a: number): number => { const r = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; return r === -Math.PI ? Math.PI : r; };
/** The shortest signed turn from a to b. */
export const turnTo = (a: number, b: number): number => wrapAngle(b - a);

export function clampCamera(c: Camera): Camera {
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, c.zoom));
  // there is nothing to pan to until the picture is larger than its frame
  const room = PAN_MAX * Math.max(0, Math.min(1, (zoom - 0.85) / 0.6));
  return {
    yaw: wrapAngle(c.yaw), elev: Math.max(ELEV_MIN, Math.min(ELEV_MAX, c.elev)), zoom,
    panX: Math.max(-room, Math.min(room, c.panX)), panY: Math.max(-room, Math.min(room, c.panY)),
  };
}
/** Turning and tilting compose by adding: a drag of (a then b) is a drag of (a + b). */
export const orbit = (c: Camera, dYaw: number, dElev: number): Camera => clampCamera({ ...c, yaw: c.yaw + dYaw, elev: c.elev + dElev });

/** What is drawn: a cylinder of radius `radius` round the pivot's vertical axis, from the ground to `height`. */
export interface Subject { pivot: { x: number; z: number }; radius: number; height: number }
export interface Frame { w: number; h: number }

/**
 * Pixels per metre at zoom 1: the largest scale at which the subject's cylinder is inside the frame (less `margin` of it on every
 * side) whichever way it is turned, at the tilt `elev`. So turning the building never pushes it out of its frame.
 */
export function fitScale(s: Subject, f: Frame, elev: number, margin = 0.06): number {
  const wide = 2 * s.radius, tall = 2 * s.radius * Math.sin(elev) + s.height * Math.cos(elev);
  return Math.max(0.01, Math.min((f.w * (1 - 2 * margin)) / Math.max(wide, 1e-6), (f.h * (1 - 2 * margin)) / Math.max(tall, 1e-6)));
}

/** A point on the screen and how near the camera it is (larger is nearer). */
export type Projected = [x: number, y: number, depth: number];
export type Project = (x: number, y: number, z: number) => Projected;

/** The projection for one frame. `scale` is `fitScale` at the resting tilt, so a tilt does not also resize the picture. */
export function projector(c: Camera, s: Subject, f: Frame, scale: number): Project {
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), ce = Math.cos(c.elev), se = Math.sin(c.elev);
  const k = scale * c.zoom, ox = f.w * (0.5 + c.panX), oy = f.h * (0.5 + c.panY), mid = s.height / 2;
  return (x, y, z) => {
    const dx = x - s.pivot.x, dz = z - s.pivot.z, dy = y - mid;
    // across the screen, and towards the camera along the ground
    const across = dx * cy - dz * sy, toward = dx * sy + dz * cy;
    return [ox + across * k, oy + (toward * se - dy * ce) * k, toward * ce + dy * se];
  };
}

/** The unit vector on the plan that points from the pivot towards the camera. */
export const towardCamera = (c: Camera): { x: number; z: number } => ({ x: Math.sin(c.yaw), z: Math.cos(c.yaw) });
/** A wall whose outward normal is (nx, nz) shows its outside to the camera. (The camera is always above, so every roof shows.) */
export const facesCamera = (c: Camera, nx: number, nz: number): boolean => nx * Math.sin(c.yaw) + nz * Math.cos(c.yaw) > 1e-6;

/**
 * Far to near, for the painter. The order is stable: two things at the same depth keep the order they were given in, so a picture
 * does not flicker between two orders from one frame to the next.
 */
export function farToNear<T>(items: readonly T[], depth: (t: T) => number): T[] {
  return items.map((t, i) => ({ t, d: depth(t), i })).sort((a, b) => a.d - b.d || a.i - b.i).map((e) => e.t);
}

/** One step of a glide that slows down: the speed left after `dt` seconds with a half-life of `halfLife`. */
export const coast = (speed: number, dt: number, halfLife = 0.28): number => speed * Math.pow(0.5, dt / halfLife);
