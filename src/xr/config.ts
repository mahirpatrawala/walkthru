// The numbers and switches of the VR page in one place. Pure: nothing here touches the DOM or three.

/** Snap turn: one flick of the thumbstick turns the view this many degrees (SPEC 21). No smooth turning, ever by default. */
export const SNAP_TURN_DEG = 30;
/** The thumbstick must pass this to count as a flick, and fall back under SNAP_RELEASE before the next one counts. */
export const SNAP_PRESS = 0.7;
export const SNAP_RELEASE = 0.3;

/** The fade that covers every teleport and every swap of home, seconds. Short: long enough that the jump is not seen, short enough not to be felt. */
export const FADE_OUT_S = 0.14;
export const FADE_IN_S = 0.2;

/** The arc of the teleport ray: launch speed (m/s) and gravity (m/s^2). 45 degrees reaches about 5.7 m, a level ray about 3.7 m from a hand held at 1.2 m. */
export const ARC_SPEED = 7.5;
export const ARC_GRAVITY = 9.8;
export const ARC_STEP_S = 0.045;
export const ARC_MAX_S = 2.2;

/** How far a pointer reaches a door, and the panel, metres. */
export const DOOR_RAY_M = 3.6;
export const PANEL_RAY_M = 6;

/** A headset is a phone-class GPU: the low tier, the baked lighting, foveated, a little under native resolution. */
export const DEFAULT_FRAMEBUFFER_SCALE = 0.9;
export const MIN_FRAMEBUFFER_SCALE = 0.5;
export const MAX_FRAMEBUFFER_SCALE = 1.2;
export const FOVEATION = 1;
/** The refresh rate asked for when the headset offers it. */
export const TARGET_HZ = 72;
export const FRAME_BUDGET_MS = 1000 / TARGET_HZ;

/** The panel, in metres in the world, and its picture in pixels (1 px = 1 mm). */
export const PANEL_W_M = 1.4;
export const PANEL_H_M = 0.86;
export const PANEL_PX_PER_M = 1000;
export const PANEL_DISTANCE_M = 1.15;

/** The site the "normal site" link goes to. A `vr.` subdomain sets <meta name="wt-main-site" content="https://..."> in vr.html. */
export function mainSiteBase(doc: { querySelector(sel: string): { getAttribute(n: string): string | null } | null } | null = typeof document !== 'undefined' ? document : null): string {
  const v = doc?.querySelector('meta[name="wt-main-site"]')?.getAttribute('content')?.trim();
  return v ? v.replace(/\/+$/, '') : '';
}

/** Where the normal site opens this home (or its start page). */
export function mainSiteUrl(base: string, target: { scene?: string; building?: string; space?: string } | null): string {
  if (!target) return `${base}/`;
  if (target.building && target.space) return `${base}/?building=${encodeURIComponent(target.building)}&space=${encodeURIComponent(target.space)}`;
  if (target.scene) return `${base}/?scene=${encodeURIComponent(target.scene)}`;
  return `${base}/`;
}
