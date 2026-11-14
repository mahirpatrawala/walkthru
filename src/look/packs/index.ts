// Style packs (SPEC 16.13): named, data-only sets that map ROLES to finish ids and give each generator its defaults. A pack never
// changes a size: it has no field that could. The JSON files beside this one are the packs; `classic` is today's look (the 16.6.5
// builders in furniture-real.ts, untouched) and is the only pack with `classic: true`.
import type { LookKind } from '../gen';
import { LOOK_KINDS, sanitizeParams } from '../gen';
import { knownFinish } from '../finishes';
import warmOakNavy from './warm-oak-navy.json';
import walnutWhite from './walnut-white.json';
import lightScandinavian from './light-scandinavian.json';
import classic from './classic.json';

export interface StylePack {
  id: string;
  name: string;
  blurb: string;
  /** today's look: the generators are not used */
  classic?: boolean;
  /** role name -> finish id (src/look/finishes.ts) */
  roles: Record<string, string>;
  /** per look kind, params that differ from the generator's own defaults */
  generators: Partial<Record<LookKind, Record<string, unknown>>>;
  /** finishes of the room itself, used where the drawing and the video gave none */
  room: { wall?: string; floor?: string; ceiling?: string };
  /** typical decor this pack adds to rooms that have no design sheet */
  decor: { rug?: boolean; curtains?: boolean };
}

/** Checks a pack read from JSON: every finish id exists, every generator param is valid. Returns the cleaned pack and what it dropped. */
export function loadPack(raw: unknown): { pack: StylePack | null; dropped: string[] } {
  const dropped: string[] = [];
  if (!raw || typeof raw !== 'object') return { pack: null, dropped: ['not an object'] };
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !/^[a-z0-9-]+$/.test(o.id) || typeof o.name !== 'string') return { pack: null, dropped: ['id or name missing'] };
  const roles: Record<string, string> = {};
  for (const [k, v] of Object.entries((o.roles ?? {}) as Record<string, unknown>)) {
    if (typeof v === 'string' && knownFinish(v)) roles[k] = v; else dropped.push(`role ${k}: unknown finish ${String(v)}`);
  }
  const generators: StylePack['generators'] = {};
  for (const kind of LOOK_KINDS) {
    const g = (o.generators as Record<string, unknown> | undefined)?.[kind];
    if (g === undefined) continue;
    const clean = sanitizeParams(kind, g);
    for (const k of Object.keys(g as object)) if (!(k in clean)) dropped.push(`${kind}.${k}: not a valid param`);
    generators[kind] = clean;
  }
  const room: StylePack['room'] = {};
  for (const k of ['wall', 'floor', 'ceiling'] as const) {
    const v = (o.room as Record<string, unknown> | undefined)?.[k];
    if (typeof v === 'string') { if (knownFinish(v)) room[k] = v; else dropped.push(`room.${k}: unknown finish ${v}`); }
  }
  const d = (o.decor ?? {}) as Record<string, unknown>;
  const pack: StylePack = {
    id: o.id, name: o.name, blurb: typeof o.blurb === 'string' ? o.blurb : '', ...(o.classic === true ? { classic: true } : {}),
    roles, generators, room, decor: { rug: d.rug === true, curtains: d.curtains === true },
  };
  return { pack, dropped };
}

const RAW = [lightScandinavian, warmOakNavy, walnutWhite, classic];
export const PACKS: StylePack[] = RAW.map((r) => loadPack(r).pack).filter((p): p is StylePack => !!p);
export const DEFAULT_PACK_ID = 'light-scandinavian';
export const CLASSIC_PACK_ID = 'classic';

export function getPack(id: string | undefined | null): StylePack | null {
  return PACKS.find((p) => p.id === id) ?? null;
}
