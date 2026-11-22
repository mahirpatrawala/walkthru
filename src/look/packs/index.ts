// Style packs (SPEC 16.13): named, data-only sets that map ROLES to finish ids and give each generator its defaults. A pack never
// changes a size: it has no field that could. The JSON files beside this one are the packs; `classic` is today's look (the 16.6.5
// builders in furniture-real.ts, untouched) and is the only pack with `classic: true`.
import type { LookKind } from '../gen';
import { LOOK_KINDS, sanitizeParams } from '../gen';
import { knownFinish } from '../finishes';
import { libModel } from '../models/library';
import type { ModelFamily, ModelPolicy } from '../models/library';
import warmOakNavy from './warm-oak-navy.json';
import walnutWhite from './walnut-white.json';
import lightScandinavian from './light-scandinavian.json';
import cleanContrast from './clean-contrast.json';
import cleanContrastDark from './clean-contrast-dark.json';
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
  room: { wall?: string; floor?: string; ceiling?: string; /** a bathroom with no finish of its own: tiled walls and a matt tiled floor (SPEC 16.19) */ wet?: { wall?: string; floor?: string }; /** floor finish by room type, used where nothing names a floor for the room (SPEC 16.20: planks in living rooms, bedrooms and passages) */ floorByType?: Partial<Record<string, string>>; /** floor finish by the kind of a shared space of a building: a timber look in a hall, a polished tile in a lobby */ floorBySpace?: Partial<Record<string, string>> };
  /** typical decor this pack adds to rooms that have no design sheet */
  decor: { rug?: boolean; curtains?: boolean };
  /** the dark or warm accents of the shell itself: skirting, door frames and architraves, door handles (finish ids; SPEC 16.18). Absent = the wall's own colour, the layout's frame colour, brushed steel */
  trim?: { skirting?: string; frame?: string; handle?: string; /** window grills: a finish id for a thin light grill, absent = the kit's own dark one */ grill?: string };
  /** floor tile formats in metres as [along the room's longest wall, across it]: `large` in a room of 12 m2 or more with a short side of 3 m or more, `standard` in other rooms, and the joint width. A tile the drawing gives always wins (SPEC 16.11) */
  tiles?: { large?: [number, number]; standard?: [number, number]; groutMm?: number };
  /** per family (a look kind or a decor kind): "generator" keeps the parametric piece, or model ids in order of preference; a family it does not name takes any model that fits (SPEC 16.15). Absent in Classic. */
  models?: ModelPolicy;
}

const MODEL_FAMILIES: ModelFamily[] = ['bed', 'sofa', 'bench', 'ottoman', 'wardrobe', 'study', 'side', 'dresser', 'counter', 'dining', 'plant', 'jug', 'fruit', 'clock'];

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
  const rawWet = (o.room as Record<string, unknown> | undefined)?.wet as Record<string, unknown> | undefined;
  if (rawWet && typeof rawWet === 'object') {
    const wet: { wall?: string; floor?: string } = {};
    for (const k of ['wall', 'floor'] as const) { const v = rawWet[k]; if (typeof v === 'string') { if (knownFinish(v)) wet[k] = v; else dropped.push(`room.wet.${k}: unknown finish ${v}`); } }
    room.wet = wet;
  }
  const rawByType = (o.room as Record<string, unknown> | undefined)?.floorByType as Record<string, unknown> | undefined;
  if (rawByType && typeof rawByType === 'object') {
    const byType: Record<string, string> = {};
    for (const [t, v] of Object.entries(rawByType)) { if (typeof v === 'string' && knownFinish(v)) byType[t] = v; else dropped.push(`room.floorByType.${t}: unknown finish ${String(v)}`); }
    room.floorByType = byType;
  }
  const rawBySpace = (o.room as Record<string, unknown> | undefined)?.floorBySpace as Record<string, unknown> | undefined;
  if (rawBySpace && typeof rawBySpace === 'object') {
    const bySpace: Record<string, string> = {};
    for (const [t, v] of Object.entries(rawBySpace)) { if (typeof v === 'string' && knownFinish(v)) bySpace[t] = v; else dropped.push(`room.floorBySpace.${t}: unknown finish ${String(v)}`); }
    room.floorBySpace = bySpace;
  }
  let models: ModelPolicy | undefined;
  if (o.models && typeof o.models === 'object' && !o.classic) {
    models = {};
    for (const [fam, v] of Object.entries(o.models as Record<string, unknown>)) {
      if (!(MODEL_FAMILIES as string[]).includes(fam)) { dropped.push(`models.${fam}: not a family`); continue; }
      if (v === 'generator') { models[fam as ModelFamily] = 'generator'; continue; }
      if (Array.isArray(v)) {
        const ids = v.filter((x): x is string => typeof x === 'string');
        const ok = ids.filter((id) => libModel(id)?.family === fam);
        for (const id of ids) if (!ok.includes(id)) dropped.push(`models.${fam}: ${id} is not a model for it`);
        models[fam as ModelFamily] = ok;
      } else dropped.push(`models.${fam}: expected "generator" or a list of model ids`);
    }
  }
  const trim: NonNullable<StylePack['trim']> = {};
  for (const k of ['skirting', 'frame', 'handle', 'grill'] as const) {
    const v = (o.trim as Record<string, unknown> | undefined)?.[k];
    if (typeof v === 'string') { if (knownFinish(v)) trim[k] = v; else dropped.push(`trim.${k}: unknown finish ${v}`); }
  }
  const tiles: NonNullable<StylePack['tiles']> = {};
  const rawTiles = (o.tiles ?? {}) as Record<string, unknown>;
  const fmt = (v: unknown): [number, number] | undefined => (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && x >= 0.2 && x <= 1.6) ? [v[0] as number, v[1] as number] : undefined);
  const big = fmt(rawTiles.large), std = fmt(rawTiles.standard);
  if (big) tiles.large = big; else if (rawTiles.large !== undefined) dropped.push('tiles.large: expected [a, b] between 0.2 and 1.6 m');
  if (std) tiles.standard = std; else if (rawTiles.standard !== undefined) dropped.push('tiles.standard: expected [a, b] between 0.2 and 1.6 m');
  if (typeof rawTiles.groutMm === 'number' && rawTiles.groutMm >= 1 && rawTiles.groutMm <= 6) tiles.groutMm = rawTiles.groutMm; else if (rawTiles.groutMm !== undefined) dropped.push('tiles.groutMm: expected 1 to 6');
  const d = (o.decor ?? {}) as Record<string, unknown>;
  const pack: StylePack = {
    id: o.id, name: o.name, blurb: typeof o.blurb === 'string' ? o.blurb : '', ...(o.classic === true ? { classic: true } : {}),
    roles, generators, room, decor: { rug: d.rug === true, curtains: d.curtains === true }, ...(models ? { models } : {}),
    ...(Object.keys(trim).length ? { trim } : {}), ...(Object.keys(tiles).length ? { tiles } : {}),
  };
  return { pack, dropped };
}

const RAW = [cleanContrast, cleanContrastDark, lightScandinavian, warmOakNavy, walnutWhite, classic];
export const PACKS: StylePack[] = RAW.map((r) => loadPack(r).pack).filter((p): p is StylePack => !!p);
/** the pack a home with no design sheet and no saved choice opens in (SPEC 16.18); it was Light Scandinavian */
export const DEFAULT_PACK_ID = 'clean-contrast';
export const CLASSIC_PACK_ID = 'classic';

export function getPack(id: string | undefined | null): StylePack | null {
  return PACKS.find((p) => p.id === id) ?? null;
}
