// 360 degree pictures of the views (SPEC 2.10), rendered offline (Blender Cycles) and shown on arrival. Pure: the contract with the renderer,
// the reading of the JSON that attaches a picture to a view, and the mapping between a direction and a point of the picture.
//
// THE CONTRACT. A view's camera is at (x, eyeM, z) in the scene's three.js frame: metres, y up, the floor at y = 0. Its heading `yawDeg` looks along
// (sin yaw, 0, cos yaw); `pitchDeg` is how far below level the still is composed (a panorama is rendered level). The picture is equirectangular
// (twice as wide as high): its middle column looks along the heading, the column at 75 % of the width looks to the viewer's right, the top row
// straight up. `exportList` is what a render script reads (`npx tsx scripts/export-viewpoints.ts <sceneId>`, or `window.__walkthru.viewpoints.list()`
// under `?debug=1`).
import type { PanoRef, Viewpoint } from './compose';

const DEG = Math.PI / 180;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A picture reference from JSON, or null when it is not one. The address may be relative to the scene folder ("panos/living-1.jpg"). */
export function parsePano(raw: unknown, sceneBase: string | null = null): PanoRef | null {
  const r = raw as Partial<PanoRef> | null;
  if (!r || typeof r !== 'object' || typeof r.url !== 'string' || !r.url.trim()) return null;
  if (!isNum(r.x) || !isNum(r.y) || !isNum(r.z) || !isNum(r.yawDeg)) return null;
  const url = r.url.trim();
  if (/^\s*javascript:/i.test(url)) return null;
  const abs = /^(https?:|data:image\/|\/)/i.test(url) || !sceneBase ? url : `${sceneBase.replace(/\/?$/, '/')}${url}`;
  return { url: abs, x: r.x, y: r.y, z: r.z, yawDeg: ((r.yawDeg % 360) + 360) % 360 };
}

/** `viewpointPanos` of a scene or a space: `{ "<view id>": { url, x, y, z, yawDeg } }`, attached to the views with those ids (the others are left as they are). */
export function attachPanos(views: readonly Viewpoint[], raw: unknown, sceneBase: string | null = null): Viewpoint[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return views.slice();
  const map = raw as Record<string, unknown>;
  return views.map((v) => {
    const p = Object.prototype.hasOwnProperty.call(map, v.id) ? parsePano(map[v.id], sceneBase) : null;
    return p ? { ...v, pano: p } : v;
  });
}

export interface ExportedView { id: string; room: string; roomId: string; name: string; tab: string; x: number; y: number; z: number; yawDeg: number; pitchDeg: number; source: Viewpoint['source'] }

/** What a renderer needs of each view: where the camera is (metres, three.js frame, y up), its heading and the composed pitch, and the names. */
export function exportList(views: readonly Viewpoint[]): ExportedView[] {
  return views.map((v) => ({ id: v.id, room: v.roomLabel, roomId: v.roomId, name: v.name, tab: v.tabLabel, x: v.x, y: v.eyeM, z: v.z, yawDeg: v.yawDeg, pitchDeg: v.pitchDeg, source: v.source }));
}

/**
 * The turn (radians, about y) of a three.js SphereGeometry that was mirrored in x (`scale(-1, 1, 1)`, seen from inside) so that the middle of the
 * picture looks along `yawDeg`. Unturned, such a sphere's middle (u = 0.5) looks along -x.
 */
export function panoTurnRad(yawDeg: number): number {
  return (yawDeg + 90) * DEG;
}

/**
 * The world direction the point (u, v) of the picture is seen in (u 0..1 left to right, v 0..1 top to bottom), for a sphere set up by `panoTurnRad`.
 * It mirrors three's SphereGeometry (x = -cos(2 pi u) sin(pi v), y = cos(pi v), z = sin(2 pi u) sin(pi v)), the x mirror and the turn, so the tests can check
 * the picture lands where the renderer put it.
 */
export function panoDirection(u: number, v: number, yawDeg: number): { x: number; y: number; z: number } {
  const phi = 2 * Math.PI * u, theta = Math.PI * v;
  // three's sphere, then the mirror in x
  const x0 = Math.cos(phi) * Math.sin(theta), y0 = Math.cos(theta), z0 = Math.sin(phi) * Math.sin(theta);
  // turned about y by a: (x, z) -> (x cos a + z sin a, -x sin a + z cos a), three's rotation.y
  const a = panoTurnRad(yawDeg);
  return { x: x0 * Math.cos(a) + z0 * Math.sin(a), y: y0, z: -x0 * Math.sin(a) + z0 * Math.cos(a) };
}

/** Where a heading lands on the picture: u (0..1) of the column that looks along `dirYawDeg`, for a picture rendered looking along `panoYawDeg`. */
export function panoColumn(dirYawDeg: number, panoYawDeg: number): number {
  // turning to the right is a smaller yaw in the walk's frame (right of (sin y, cos y) is (-cos y, sin y), the heading y - 90)
  const right = (((panoYawDeg - dirYawDeg) % 360) + 540) % 360 - 180;
  return (((0.5 + right / 360) % 1) + 1) % 1;
}
