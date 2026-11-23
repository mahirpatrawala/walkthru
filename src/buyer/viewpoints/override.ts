// An authored list of views (SPEC 2.10): `viewpoints` in a scene's property.json, or on a building's space, replaces the generated list.
// Pure. Each entry: { id?, room?, name?, x, z, yawDeg, pitchDeg?, eyeM? } in the scene's frame (metres, degrees; forward is (sin yaw, cos yaw),
// pitch is degrees below level), and optionally `pano` (pano.ts). An entry whose point is in no whole room, or that is not numbers, is left out and said so.
import type { Layout } from '../../types';
import { pointInPolygon } from '../../core/geometry';
import { VIEW_EYE_M, groupIntoTabs } from './compose';
import type { PanoRef, Viewpoint } from './compose';
import { parsePano } from './pano';

export interface ViewpointSpec { id?: string; room?: string; name?: string; x: number; z: number; yawDeg: number; pitchDeg?: number; eyeM?: number; pano?: PanoRef }

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The authored views, or null when `raw` is not a list (no override: the generated views are used). An empty list is an override too: the
 * home then has no views. `warnings` says what was left out and why.
 */
export function viewpointsFromSpec(raw: unknown, layout: Layout, sceneBase: string | null = null): { views: Viewpoint[]; warnings: string[] } | null {
  if (!Array.isArray(raw)) return null;
  const warnings: string[] = [];
  const out: Omit<Viewpoint, 'tabId' | 'tabLabel'>[] = [];
  const perRoom = new Map<string, number>();
  raw.forEach((e: unknown, i) => {
    const s = e as Partial<ViewpointSpec> | null;
    if (!s || typeof s !== 'object' || !isNum(s.x) || !isNum(s.z) || !isNum(s.yawDeg)) { warnings.push(`viewpoints[${i}]: needs numbers x, z and yawDeg`); return; }
    const p = { x: s.x, z: s.z };
    const named = typeof s.room === 'string' ? layout.rooms.find((r) => r.id === s.room) : undefined;
    const room = named && pointInPolygon(p, named.polygon) ? named : layout.rooms.find((r) => !r.partial && pointInPolygon(p, r.polygon));
    if (!room || room.partial) { warnings.push(`viewpoints[${i}]: (${s.x}, ${s.z}) is not inside a whole room`); return; }
    const n = (perRoom.get(room.id) ?? 0) + 1;
    perRoom.set(room.id, n);
    let id = typeof s.id === 'string' && ID_RE.test(s.id) ? s.id : `${room.id}-${n}`;
    if (out.some((v) => v.id === id)) { warnings.push(`viewpoints[${i}]: id "${id}" is used twice; numbered instead`); id = `${room.id}-${n}-${i}`; }
    const name = typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 80) : room.label;
    const phrase = name.startsWith(`${room.label} · `) ? name.slice(room.label.length + 3) : name;
    out.push({
      id, roomId: room.id, roomLabel: room.label, phrase, name, x: s.x, z: s.z,
      eyeM: isNum(s.eyeM) ? Math.max(1.0, Math.min(2.0, s.eyeM)) : VIEW_EYE_M,
      yawDeg: ((s.yawDeg % 360) + 360) % 360, pitchDeg: isNum(s.pitchDeg) ? Math.max(-30, Math.min(45, s.pitchDeg)) : 4,
      kind: 'authored', source: 'authored',
      ...(s.pano !== undefined && parsePano(s.pano, sceneBase) ? { pano: parsePano(s.pano, sceneBase) as PanoRef } : {}),
    });
  });
  // authored views keep the author's order inside each tab
  return { views: groupIntoTabs(layout, out).views, warnings };
}
