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
  const note = typeof r.note === 'string' && r.note.trim() ? r.note.trim().slice(0, 60) : null;
  return { url: abs, x: r.x, y: r.y, z: r.z, yawDeg: ((r.yawDeg % 360) + 360) % 360, ...(note ? { note } : {}) };
}

/** What the note over a picture says when its source names nothing (SPEC 16.2: a render is never passed off as a photograph). */
export const PANO_NOTE = 'Illustrative render';

/** The address of a scene's renderer manifest (`npm run pano`, written next to the pictures). */
export const panoManifestUrl = (sceneBase: string): string => `${sceneBase.replace(/\/?$/, '/')}panos/manifest.json`;

/**
 * The renderer's manifest (`public/scenes/<scene>/panos/manifest.json`, version 1, written by `npm run pano`) as `viewpointPanos`: view id ->
 * picture, the file for this device (`mobile` on a phone or the low tier, else `file`), the camera, the heading, and the manifest's `label` as the
 * note. Only an equirectangular, yaw-centred version 1 manifest is read; anything else gives nothing, with a warning. Entries whose id names no
 * view are kept out by `attachPanos` (the caller warns: `unmatchedPanos`).
 */
export function panosFromManifest(raw: unknown, sceneBase: string, opts: { mobile: boolean }): { panos: Record<string, PanoRef>; warnings: string[] } {
  const out: Record<string, PanoRef> = {};
  const warnings: string[] = [];
  const m = raw as { version?: unknown; projection?: unknown; centre?: unknown; label?: unknown; panos?: unknown } | null;
  if (!m || typeof m !== 'object') return { panos: out, warnings: ['the pictures\' manifest is not an object'] };
  if (m.version !== 1) return { panos: out, warnings: [`the pictures' manifest is version ${String(m.version)}, not 1`] };
  if (m.projection !== 'equirectangular' || m.centre !== 'yaw') return { panos: out, warnings: ['the pictures\' manifest is not equirectangular and centred on the heading'] };
  if (!Array.isArray(m.panos)) return { panos: out, warnings: ['the pictures\' manifest has no list of pictures'] };
  const note = typeof m.label === 'string' && m.label.trim() ? m.label.trim() : PANO_NOTE;
  const dir = `${sceneBase.replace(/\/?$/, '/')}panos/`;
  for (const e of m.panos as Record<string, unknown>[]) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string') { warnings.push('a picture with no id was left out'); continue; }
    const file = opts.mobile && typeof e.mobile === 'string' && e.mobile ? e.mobile : e.file;
    // a bare file name in the panos folder: no folders, no addresses (the manifest sits next to its pictures)
    if (typeof file !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpe?g|webp|png|avif)$/i.test(file)) { warnings.push(`picture "${e.id}" has no usable file`); continue; }
    if (typeof e.width === 'number' && typeof e.height === 'number' && Math.abs(e.width / e.height - 2) > 0.02) { warnings.push(`picture "${e.id}" is not twice as wide as high`); continue; }
    const p = parsePano({ url: dir + file, x: e.x, y: e.y, z: e.z, yawDeg: e.yaw, note }, null);
    if (!p) { warnings.push(`picture "${e.id}" has no camera or heading`); continue; }
    out[e.id] = p;
  }
  return { panos: out, warnings };
}

/** Picture ids that name no view (they are not shown: render from `scripts/export-viewpoints.ts --poses` so the ids line up). */
export function unmatchedPanos(views: readonly Viewpoint[], panos: Record<string, unknown>): string[] {
  const ids = new Set(views.map((v) => v.id));
  return Object.keys(panos).filter((k) => !ids.has(k));
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

/** The poses file of the panorama renderer (`npm run pano -- <scene> --poses <file>`): its pitch is up-positive, a view's is degrees below level. */
export function posesForRenderer(views: readonly Viewpoint[]): { id: string; x: number; y: number; z: number; yaw: number; pitch: number; label: string }[] {
  const r3 = (n: number): number => Math.round(n * 1000) / 1000;
  return views.map((v) => ({ id: v.id, x: r3(v.x), y: r3(v.eyeM), z: r3(v.z), yaw: r3(v.yawDeg), pitch: r3(-v.pitchDeg) || 0, label: v.name }));
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
