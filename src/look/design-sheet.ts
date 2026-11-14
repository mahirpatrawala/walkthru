// The design sheet (SPEC 16.13): an optional public/scenes/<id>/design.json that records a designer's choices for one home as DATA:
// which style pack it is built on, per-item generator params and finishes, per-room wall / floor / ceiling finishes, and the decor
// (curtains, rug, AC, lights, panelling, a slatted wall) with where it goes. It carries no sizes: a size is the drawing's, and a
// sheet that tries to carry one has that field ignored. It names no client and no project.
import { FINISHES } from './finishes';
import { LOOK_KINDS, sanitizeParams } from './gen';
import type { LookKind } from './gen';

/** the finish choice of `FurnitureItem.finish`, which a sheet may also give per item */
export interface FinishChoice { primary?: string; secondary?: string; fabric?: string; style?: string }

export interface SheetItem {
  /** generator params (validated per look kind) */
  params?: Record<string, unknown>;
  /** role -> finish id, direct overrides of the pack's roles */
  roles?: Record<string, string>;
  finish?: FinishChoice;
}
export interface SheetRoom { wall?: string; floor?: string; ceiling?: string }

/** where a decor piece stands on a wall: the room, the wall edge (the index of the room polygon edge), and how far along it */
interface OnWall { roomId: string; edge: number; u0: number; u1: number }
export type SheetFixture =
  | ({ kind: 'curtain'; sheer?: boolean; drape?: 'sides' | 'left' | 'right' | 'none'; trackYM?: number } & OnWall)
  | { kind: 'rug'; roomId: string; aroundItem?: string; margin?: { head?: number; foot?: number; side?: number }; x?: number; z?: number; w?: number; d?: number; yawDeg?: number }
  | { kind: 'ac'; roomId: string; edge: number; u: number; y: number }
  | { kind: 'downlights'; roomId: string; points: [number, number][] }
  | { kind: 'bowl-lights'; roomId: string; edge: number; us: number[]; y: number }
  | ({ kind: 'panelling'; pitchM?: number; tierM?: number; y0M?: number; y1M?: number } & OnWall)
  | ({ kind: 'slat-wall'; y0M?: number; y1M?: number; pitchM?: number } & OnWall)
  | { kind: 'ceiling-band'; roomId: string; x0: number; z0: number; x1: number; z1: number; dropM?: number }
  | ({ kind: 'window-seat'; depthM?: number; heightM?: number; shape?: 'rect' | 'curved-end' | 'curved-both'; curveSide?: 'left' | 'right' } & OnWall);

export type SheetSource = 'designer-renders' | 'broker' | 'typical';
export interface DesignSheet {
  version: 1;
  /** the pack the designer's look is built on */
  pack: string;
  /** who made these choices; 'designer-renders' is labelled "from the designer's renders" */
  source: SheetSource;
  note?: string;
  items: Record<string, SheetItem>;
  rooms: Record<string, SheetRoom>;
  fixtures: SheetFixture[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fid = (v: unknown): string | undefined => (typeof v === 'string' && FINISHES[v] ? v : undefined);

function cleanFinish(raw: unknown): FinishChoice | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: FinishChoice = {};
  if (fid(o.primary)) out.primary = o.primary as string;
  if (fid(o.secondary)) out.secondary = o.secondary as string;
  if (fid(o.fabric)) out.fabric = o.fabric as string;
  if (typeof o.style === 'string') out.style = o.style;
  return Object.keys(out).length ? out : undefined;
}

/** The look kind a sheet item is validated against: by its id's prefix (`wardrobe-1`), else any kind accepts its own keys. */
function kindOfItemId(id: string, kinds: Record<string, LookKind> | undefined): LookKind | null {
  if (kinds?.[id]) return kinds[id];
  const m = /^([a-z]+)-/.exec(id);
  if (!m) return null;
  return (LOOK_KINDS as string[]).includes(m[1]) ? (m[1] as LookKind) : null;
}

/** Reads a design sheet leniently: anything not usable is dropped, never thrown. `kinds` maps item id -> look kind for validating params. */
export function parseDesignSheet(json: unknown, kinds?: Record<string, LookKind>): DesignSheet | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (o.version !== 1 || typeof o.pack !== 'string') return null;
  const items: Record<string, SheetItem> = {};
  for (const [id, raw] of Object.entries((o.items ?? {}) as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const it: SheetItem = {};
    const kind = (typeof r.look === 'string' && (LOOK_KINDS as string[]).includes(r.look) ? (r.look as LookKind) : null) ?? kindOfItemId(id, kinds);
    if (r.params && typeof r.params === 'object') {
      // params are checked against the generator when the kind is known; sizes are never params
      it.params = kind ? sanitizeParams(kind, r.params) : { ...(r.params as Record<string, unknown>) };
    }
    if (r.roles && typeof r.roles === 'object') {
      const roles: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.roles as Record<string, unknown>)) if (fid(v)) roles[k] = v as string;
      if (Object.keys(roles).length) it.roles = roles;
    }
    const f = cleanFinish(r.finish);
    if (f) it.finish = f;
    items[id] = it;
  }
  const rooms: Record<string, SheetRoom> = {};
  for (const [id, raw] of Object.entries((o.rooms ?? {}) as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const rm: SheetRoom = {};
    if (fid(r.wall)) rm.wall = r.wall as string;
    if (fid(r.floor)) rm.floor = r.floor as string;
    if (fid(r.ceiling)) rm.ceiling = r.ceiling as string;
    rooms[id] = rm;
  }
  const fixtures: SheetFixture[] = [];
  const KINDS = ['curtain', 'rug', 'ac', 'downlights', 'bowl-lights', 'panelling', 'slat-wall', 'ceiling-band', 'window-seat'];
  if (Array.isArray(o.fixtures)) {
    for (const raw of o.fixtures as Record<string, unknown>[]) {
      if (!raw || typeof raw !== 'object' || typeof raw.kind !== 'string' || !KINDS.includes(raw.kind) || typeof raw.roomId !== 'string') continue;
      const onWall = ['curtain', 'panelling', 'slat-wall', 'window-seat'].includes(raw.kind);
      if (onWall && !(isNum(raw.edge) && isNum(raw.u0) && isNum(raw.u1) && raw.u1 > raw.u0)) continue;
      if ((raw.kind === 'ac') && !(isNum(raw.edge) && isNum(raw.u) && isNum(raw.y))) continue;
      if (raw.kind === 'bowl-lights' && !(isNum(raw.edge) && Array.isArray(raw.us) && raw.us.every(isNum) && isNum(raw.y))) continue;
      if (raw.kind === 'downlights' && !(Array.isArray(raw.points) && raw.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNum)))) continue;
      if (raw.kind === 'ceiling-band' && !(isNum(raw.x0) && isNum(raw.z0) && isNum(raw.x1) && isNum(raw.z1))) continue;
      fixtures.push(raw as unknown as SheetFixture);
    }
  }
  const source: SheetSource = o.source === 'designer-renders' || o.source === 'broker' ? o.source : 'typical';
  return { version: 1, pack: o.pack, source, ...(typeof o.note === 'string' ? { note: o.note } : {}), items, rooms, fixtures };
}

/** Reads the optional design.json of a scene. Missing, HTML (a dev server's index page) or broken: null. */
export async function fetchDesignSheet(sceneId: string): Promise<DesignSheet | null> {
  try {
    const res = await fetch(`/scenes/${sceneId}/design.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const text = await res.text();
    if (/^\s*</.test(text)) return null;
    return parseDesignSheet(JSON.parse(text));
  } catch {
    return null;
  }
}
