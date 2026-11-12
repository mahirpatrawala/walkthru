// Owned by C9. SPEC 14.4 / 14.8. Pure: pins file validation, nearest-frame match, pose suggestion.
import type { Layout, SplatOverlay, Vec2, Vec3 } from '../types';
import { roomAt } from '../core/layout-geom';
import { rotateY } from '../core/geometry';
import { descriptorScore, NO_MATCH_SCORE } from './frame-metrics';
import type { ImageDescriptor } from './frame-metrics';
import type { FrameCamera, FrameInfo, PhotoPin, PhotoPinsFile } from './types';

export const MAX_PINS = 500;
export const MAX_CAPTION = 60;
export const CAMERA_MATCH_SEC = 0.5;

/** A photo's nearest editor frame, when it is close enough to count. */
export interface FrameMatch { frame: string; timeSec: number; score: number }

export function emptyPins(): PhotoPinsFile { return { version: 1, pins: [] }; }

/** A file name that is safe to put under a folder: basename only, [A-Za-z0-9._-], at most 80 characters. */
export function sanitiseFileName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  let s = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
  if (s.length > 80) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 8 ? s.slice(dot) : '';
    s = s.slice(0, 80 - ext.length) + ext;
  }
  return s || 'file';
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const PHOTO_PATH_RE = /^media\/photos\/[A-Za-z0-9._-]{1,80}$/;

function fail(path: string, msg: string): never { throw new Error(`photo-pins.json: ${path} ${msg}`); }

function parseVec2(v: unknown, path: string): Vec2 | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v) || !isNum(v.x) || !isNum(v.z)) return fail(path, 'must be null or { x, z } in metres');
  return { x: v.x, z: v.z };
}
function parseNullableNum(v: unknown, path: string): number | null {
  if (v === null || v === undefined) return null;
  if (!isNum(v)) return fail(path, 'must be a number or null');
  return v;
}
function parseNullableStr(v: unknown, path: string): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return fail(path, 'must be text or null');
  return v;
}

/** Throws an Error with a readable message. Returns a clean copy (unknown fields dropped). */
export function validatePinsFile(json: unknown): PhotoPinsFile {
  if (!isObj(json)) return fail('the file', 'must be a JSON object');
  if (json.version !== 1) fail('version', 'must be 1');
  if (!Array.isArray(json.pins)) return fail('pins', 'must be a list');
  if (json.pins.length > MAX_PINS) fail('pins', `may hold at most ${MAX_PINS} photos`);
  const seen = new Set<string>();
  const pins: PhotoPin[] = json.pins.map((raw, i) => {
    const p = `pins[${i}]`;
    if (!isObj(raw)) return fail(p, 'must be an object');
    if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return fail(`${p}.id`, 'must be 1 to 40 letters, digits, - or _');
    if (seen.has(raw.id)) return fail(`${p}.id`, `"${raw.id}" appears twice`);
    seen.add(raw.id);
    for (const key of ['file', 'thumb'] as const) {
      const v = raw[key];
      if (typeof v !== 'string' || !PHOTO_PATH_RE.test(v) || v.includes('..')) return fail(`${p}.${key}`, 'must be a file under media/photos/');
    }
    if (!isNum(raw.width) || !isNum(raw.height) || raw.width <= 0 || raw.height <= 0) fail(`${p}.width`, 'and height must be positive numbers');
    const placedBy = raw.placedBy ?? null;
    if (placedBy !== null && placedBy !== 'broker' && placedBy !== 'auto') fail(`${p}.placedBy`, 'must be broker, auto or null');
    const pin: PhotoPin = {
      id: raw.id, file: raw.file as string, thumb: raw.thumb as string,
      width: raw.width as number, height: raw.height as number,
      at: parseVec2(raw.at, `${p}.at`),
      yawDeg: parseNullableNum(raw.yawDeg, `${p}.yawDeg`),
      roomId: parseNullableStr(raw.roomId, `${p}.roomId`),
      placedBy,
    };
    if (raw.caption !== undefined) {
      if (typeof raw.caption !== 'string') fail(`${p}.caption`, 'must be text');
      if (raw.caption.length > MAX_CAPTION) fail(`${p}.caption`, `may be at most ${MAX_CAPTION} characters`);
      if (raw.caption !== '') pin.caption = raw.caption;
    }
    if (raw.suggested !== undefined && raw.suggested !== null) {
      const s = raw.suggested;
      if (!isObj(s)) return fail(`${p}.suggested`, 'must be an object');
      const source = s.source;
      if (source !== 'frame-pose' && source !== 'frame-only' && source !== 'none') fail(`${p}.suggested.source`, 'is not recognised');
      if (!isNum(s.score)) fail(`${p}.suggested.score`, 'must be a number');
      pin.suggested = {
        at: parseVec2(s.at, `${p}.suggested.at`),
        yawDeg: parseNullableNum(s.yawDeg, `${p}.suggested.yawDeg`),
        roomId: parseNullableStr(s.roomId, `${p}.suggested.roomId`),
        frame: parseNullableStr(s.frame, `${p}.suggested.frame`),
        score: s.score as number,
        source: source as 'frame-pose' | 'frame-only' | 'none',
      };
    }
    return pin;
  });
  return { version: 1, pins };
}

/** The frame with the smallest descriptor score, and that score. Null when there are no frames. */
export function nearestFrame(photo: ImageDescriptor, frames: ImageDescriptor[]): { index: number; score: number } | null {
  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < frames.length; i++) {
    const score = descriptorScore(photo, frames[i]);
    if (!best || score < best.score) best = { index: i, score };
  }
  return best;
}

export function isMatch(score: number): boolean { return score <= NO_MATCH_SCORE; }

/** The match a stored pin points at: its suggested frame looked up in the manifest's frames. */
export function matchFromPin(pin: PhotoPin, frames: FrameInfo[]): FrameMatch | null {
  const s = pin.suggested;
  if (!s || !s.frame) return null;
  const f = frames.find((x) => x.file === s.frame);
  return f ? { frame: f.file, timeSec: f.timeSec, score: s.score } : null;
}

export function isIdentityTransform(t: SplatOverlay['transform']): boolean {
  const [x, y, z, w] = t.rotation;
  return Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6 && Math.abs(z) < 1e-6 && Math.abs(Math.abs(w) - 1) < 1e-6 &&
    Math.abs(t.scale - 1) < 1e-6 && t.position.every((v) => Math.abs(v) < 1e-6);
}

/** Heading of a horizontal vector in degrees, [0, 360). Yaw 0 faces +Z. */
export function headingDeg(x: number, z: number): number {
  const d = (Math.atan2(x, z) * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}

/**
 * SPEC 14.8. `match` is the photo's nearest editor frame (null or a score above 0.22 means none). With a camera
 * registered within 0.5 s of that frame and a splat whose transform is no longer the identity, the camera is taken
 * through the transform `p_world = scale * rotate(rotation, p_raw) + position` and gives the spot and facing.
 */
export function suggestPinPose(_pin: Pick<PhotoPin, 'id'>, match: FrameMatch | null, cameras: FrameCamera[],
  splat: SplatOverlay | null | undefined, layout: Layout | null | undefined): NonNullable<PhotoPin['suggested']> {
  if (!match || !isMatch(match.score)) {
    return { at: null, yawDeg: null, roomId: null, frame: null, score: match?.score ?? 1, source: 'none' };
  }
  const frameOnly = { at: null, yawDeg: null, roomId: null, frame: match.frame, score: match.score, source: 'frame-only' as const };
  if (!splat || isIdentityTransform(splat.transform)) return frameOnly;
  let cam: FrameCamera | null = null;
  let bestDt = Infinity;
  for (const c of cameras) {
    const dt = Math.abs(c.timeSec - match.timeSec);
    if (dt < bestDt) { bestDt = dt; cam = c; }
  }
  if (!cam || bestDt > CAMERA_MATCH_SEC) return frameOnly;
  const { rotation, scale, position } = splat.transform;
  const r: Vec3 = rotateY(rotation, cam.centre);
  const at: Vec2 = { x: scale * r.x + position[0], z: scale * r.z + position[2] };
  const f = rotateY(rotation, cam.forward);
  const yawDeg = Math.hypot(f.x, f.z) < 1e-6 ? null : headingDeg(f.x, f.z);
  const roomId = layout ? roomAt(layout, at)?.id ?? null : null;
  return { at, yawDeg, roomId, frame: match.frame, score: match.score, source: 'frame-pose' };
}

/** Merge freshly published photos into the stored pins: existing ids keep their placement, new ones start unplaced. */
export function mergePins(existing: PhotoPinsFile, fresh: PhotoPin[]): PhotoPinsFile {
  const old = new Map(existing.pins.map((p) => [p.id, p]));
  return {
    version: 1,
    pins: fresh.map((n) => {
      const o = old.get(n.id);
      if (!o) return n;
      const merged: PhotoPin = { ...n, at: o.at, yawDeg: o.yawDeg, roomId: o.roomId, placedBy: o.placedBy };
      if (o.caption) merged.caption = o.caption;
      return merged;
    }),
  };
}
