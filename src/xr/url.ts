// The address of the VR page. Pure. It never reads the path: the page is served at /vr today and from a `vr.` subdomain later.
//   ?scene=<id>[&room=<room id>]          one home, straight in
//   ?building=<id>&space=<space id>       a space of a building (see src/building/url.ts), opened as the one home its scene is
//   ?auto=1                               try to enter VR on the first tap or key press once the home is ready
//   ?debug                                the frame-time panel
//   ?xrfake=1                             the in-page emulator (checks without a headset)
//   ?quality=low|medium                   the look tier (low unless asked), ?scale=0.9 the framebuffer scale
import { parseBuildingUrl } from '../building/url';

export const SCENE_ID_RE = /^[a-z0-9-]{1,40}$/;

export type XrTarget =
  | { kind: 'scene'; scene: string; room?: string | null }
  | { kind: 'space'; building: string; space: string };

export interface XrUrl {
  target: XrTarget | null;
  /** `?building=<id>` with no space: the building's flats are listed on the landing page, nothing opens */
  building: string | null;
  auto: boolean;
  debug: boolean;
  fake: boolean;
  quality: 'low' | 'medium';
  /** the framebuffer scale asked for, or null for the default */
  scale: number | null;
}

const flag = (q: URLSearchParams, k: string): boolean => {
  if (!q.has(k)) return false;
  const v = (q.get(k) ?? '').trim().toLowerCase();
  return v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on';
};

export function parseXrUrl(search: string): XrUrl {
  const q = new URLSearchParams(search);
  const scene = (q.get('scene') ?? '').trim();
  const room = (q.get('room') ?? '').trim();
  const b = parseBuildingUrl(search);
  let target: XrTarget | null = null;
  if (SCENE_ID_RE.test(scene)) target = { kind: 'scene', scene, room: SCENE_ID_RE.test(room) ? room : null };
  else if (b?.space) target = { kind: 'space', building: b.building, space: b.space };
  const scaleRaw = Number(q.get('scale'));
  return {
    target,
    building: b && !b.space ? b.building : null,
    auto: flag(q, 'auto'),
    debug: flag(q, 'debug'),
    fake: flag(q, 'xrfake'),
    // the high tier needs a composer and shadow maps a headset cannot pay for: it is never offered
    quality: q.get('quality') === 'medium' ? 'medium' : 'low',
    scale: Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : null,
  };
}

/** The address that opens a target on this page: only the place changes, the display switches (`debug`, `quality`, `scale`, `xrfake`) stay as they are. */
export function xrUrl(target: XrTarget | null, carry = ''): string {
  const q = new URLSearchParams();
  if (target?.kind === 'scene') { q.set('scene', target.scene); if (target.room) q.set('room', target.room); }
  else if (target?.kind === 'space') { q.set('building', target.building); q.set('space', target.space); }
  if (carry) {
    const from = new URLSearchParams(carry);
    for (const k of ['debug', 'quality', 'scale', 'xrfake', 'auto']) { const v = from.get(k); if (v !== null && v.length <= 20) q.set(k, v); }
  }
  const s = q.toString();
  return s ? `?${s}` : '?';
}
