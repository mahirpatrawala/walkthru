// The active style (SPEC 16.13): which pack is showing, whether the home's design sheet is in force, and the resolution of one item's
// params and roles with the provenance of each value.
//
// Order per value, strongest first:
//   1. the DRAWING / elevation (structure only: bays, shutters per bay, drawer strip, base gap, handle height, base height). The
//      fill colours of a drawing are not finishes and never reach this path (they stay with the Classic look).
//   2. the VIEWER's own per-item choice (`item.finish`, "Change look"), for look only: it wins over the sheet and the pack
//   3. the design SHEET (while the designer's look is on, see below)
//   4. the PACK
//   5. the generator's own default (params only)
// The designer's look is on while the active pack is the sheet's pack. When the viewer picks another pack in the Style picker, the
// sheet's finishes are not applied (the viewer asked for that pack's look), the drawing's structure still is.
import type { FurnitureItem } from '../types';
import { pieceRule } from '../core/pieces';
import { finishDef } from './finishes';
import type { FinishDef } from './finishes';
import { GENERATORS, lookKindOf, sanitizeParams } from './gen';
import type { FinishChoice } from './design-sheet';
import type { LookKind, MatSpec, Roles } from './gen';
import type { ItemDesign } from './furniture-real';
import { CLASSIC_PACK_ID, DEFAULT_PACK_ID, getPack } from './packs';
import type { StylePack } from './packs';
import type { DesignSheet, SheetSource } from './design-sheet';

export type Prov = 'drawing' | 'sheet' | 'viewer' | 'pack' | 'default';

export interface StyleState {
  /** the pack whose roles and defaults are in force */
  pack: StylePack;
  /** the home's design sheet, null when it has none */
  sheet: DesignSheet | null;
  /** the sheet's finishes are applied (the active pack is the sheet's own) */
  designerLook: boolean;
}

let state: StyleState = { pack: getPack(CLASSIC_PACK_ID) as StylePack, sheet: null, designerLook: false };
const listeners = new Set<() => void>();

export function getStyle(): StyleState { return state; }
export function onStyleChange(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

/**
 * Sets the style. `packId` picks a pack; with a `sheet` and no `packId` the designer's look is on (the sheet's pack). Picking the
 * sheet's own pack by id also turns the designer's look on. An unknown pack id falls back to the default pack.
 */
export function setStyle(o: { packId?: string; sheet?: DesignSheet | null }): StyleState {
  const sheet = o.sheet === undefined ? state.sheet : o.sheet;
  const wanted = o.packId ?? sheet?.pack ?? DEFAULT_PACK_ID;
  const pack = getPack(wanted) ?? getPack(sheet?.pack ?? DEFAULT_PACK_ID) ?? (getPack(DEFAULT_PACK_ID) as StylePack);
  state = { pack, sheet, designerLook: !!sheet && sheet.pack === pack.id };
  for (const cb of [...listeners]) cb();
  return state;
}

/** back to today's look, no sheet (what a headless test starts with) */
export function resetStyle(): void {
  state = { pack: getPack(CLASSIC_PACK_ID) as StylePack, sheet: null, designerLook: false };
  for (const cb of [...listeners]) cb();
}

/** the sheet's own choices count only while the designer's look is on */
export function sheetInForce(s: StyleState = state): DesignSheet | null { return s.designerLook ? s.sheet : null; }

export function matOf(id: string | undefined | null): MatSpec | null {
  const f: FinishDef | null = finishDef(id);
  return f ? { key: f.material, tint: f.colour } : null;
}

export interface ResolvedLook {
  kind: LookKind;
  params: Record<string, unknown>;
  roles: Roles;
  /** `param:<name>` and `role:<name>` -> where the value came from */
  prov: Record<string, Prov>;
  /** the finish ids behind the roles, for a label */
  finishIds: Record<string, string>;
  packId: string;
  /** how the sheet's values are labelled, when any of them is in use */
  sheetSource: SheetSource | null;
}

/** what the drawing gives for an item's structure, as generator params (only the keys a drawing really gave) */
export function drawingParams(kind: LookKind, d: ItemDesign | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!d) return out;
  if (kind === 'wardrobe' && d.wardrobe) {
    const w = d.wardrobe;
    out.bays = w.bays; out.shuttersPerBay = w.shuttersPerBay; out.drawerStripM = w.drawerStripM; out.plinthM = w.baseGapM;
    out.handleYM = w.handleYM; out.handleLenM = w.handleLenM;
    if (typeof w.loftM === 'number' && w.loftM > 0) out.loftM = w.loftM;
  }
  if (kind === 'bed' && d.bed) out.baseTopM = d.bed.baseTopM;
  return out;
}

/**
 * What a finish choice ({ primary, secondary, fabric, style }, the slots of "Change look" in finishes.ts) means for this kind of piece:
 * generator params (a bed's style is a real shape) and role -> finish id. The meaning of each slot is the same as the palette's labels:
 * bed = Frame / Headboard / Bedding, sofa = Legs / Fabric, wardrobe = Shutters / Handles, table = Top / Legs (and a seat fabric).
 */
export function finishLayer(kind: LookKind, f: FinishChoice, current: Record<string, unknown> = {}): { params: Record<string, unknown>; roles: Record<string, string> } {
  const params: Record<string, unknown> = {};
  const roles: Record<string, string> = {};
  const set = (names: string[], id: string | undefined): void => { if (id) for (const n of names) roles[n] = id; };
  const isMetal = (id: string | undefined): boolean => finishDef(id)?.kind === 'metal';
  switch (kind) {
    case 'bed': {
      const style = f.style;
      if (style === 'upholstered') params.headboard = 'upholstered';
      else if (style === 'panel') { params.headboard = 'panel'; if (current.base === 'box') params.base = 'platform'; }
      else if (style === 'storage') { params.base = 'box'; if (current.headboard === 'none') params.headboard = 'panel'; }
      else if (f.fabric && current.headboard !== 'upholstered') params.headboard = 'upholstered';
      // the same rules as the old recolour pass: a panel bed carries its wood across the headboard, an upholstered one wraps the frame in fabric
      const headboard = style === 'panel' && (f.primary || !f.fabric) ? f.primary : f.fabric ?? undefined;
      const frame = style === 'upholstered' && f.fabric ? f.fabric : f.primary;
      set(['bedFrame'], frame); set(['headboard'], headboard); set(['duvet'], f.secondary);
      break;
    }
    case 'sofa':
      set(['fabric'], f.fabric); set(['legs'], f.primary);
      if (f.primary) params.legs = isMetal(f.primary) ? 'metal' : 'wood';
      break;
    case 'wardrobe':
      set(['case', 'flute'], f.primary); set(['handle'], f.secondary);
      break;
    case 'bench':
      set(['case'], f.primary); set(['accent'], f.fabric);
      break;
    case 'swing':
      set(['case', 'swingWood', 'basket'], f.primary); set(['chain'], f.secondary); set(['cushion'], f.fabric);
      break;
    case 'tvunit': case 'cabinet':
      set(['case', 'top', 'drawerFront', 'almirah'], f.primary); set(['handle', 'almirahHandle'], f.secondary);
      break;
    case 'appliance': case 'fit':
      set(['applianceBody', 'case'], f.primary);
      break;
    case 'outdoor':
      set(['case', 'accent'], f.primary);
      break;
    case 'bath':
      set(['fittings', 'handle'], f.secondary);
      break;
    case 'bedx':
      set(['bedFrame', 'case'], f.primary); set(['bedding', 'duvet'], f.secondary);
      break;
    case 'seatx':
      set(['fabric', 'cushion'], f.fabric); set(['legs'], f.primary);
      if (f.primary) params.legs = isMetal(f.primary) ? 'metal' : 'wood';
      break;
    default: // study, side, dresser, counter, dining: Top / Legs (and a seat fabric)
      set(['top'], f.primary); set(['case', 'drawerFront', 'legs'], f.secondary); set(['fabric'], f.fabric);
      break;
  }
  return { params, roles };
}

/** Resolves an item's look under the current style (or `st`). Returns null in the Classic pack, which uses the 16.6.5 builders. */
export function resolveLook(item: Pick<FurnitureItem, 'id' | 'kind' | 'label' | 'finish'> & { catalogId?: string }, drawing?: ItemDesign, st: StyleState = state): ResolvedLook | null {
  const rule = pieceRule(item.catalogId);
  if (st.pack.classic) {
    // Classic is today's look of the original pieces; the second catalogue table has no old builders and takes the plainest pack's finishes
    if (!rule) return null;
    st = { ...st, pack: getPack('walnut-white') ?? st.pack };
  }
  const kind = lookKindOf(item);
  const spec = GENERATORS[kind];
  const pack = st.pack;
  const sheet = sheetInForce(st);
  const si = sheet?.items[item.id];
  const prov: Record<string, Prov> = {};
  const finishIds: Record<string, string> = {};

  // ---- params, weakest first: default, pack, sheet, viewer, drawing
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec.defaults)) { params[k] = Array.isArray(v) ? [...v] : v; prov[`param:${k}`] = 'default'; }
  const put = (src: Record<string, unknown>, p: Prov): void => { for (const [k, v] of Object.entries(src)) { params[k] = v; prov[`param:${k}`] = p; } };
  put(sanitizeParams(kind, pack.generators[kind]), 'pack');
  // what makes this row the piece it is (a swing's variant, a storage bed's box base): over the pack, under the viewer's own pick
  if (rule) put(sanitizeParams(kind, rule.look.params), 'default');

  // ---- roles, weakest first
  const roles: Roles = {};
  const setRole = (name: string, id: string | undefined, p: Prov): void => {
    const m = matOf(id);
    if (!m || !id) return;
    roles[name] = m; prov[`role:${name}`] = p; finishIds[name] = id;
  };
  for (const [name, id] of Object.entries(pack.roles)) setRole(name, id, 'pack');
  const layer = (fc: FinishChoice | undefined, p: Prov): void => {
    if (!fc) return;
    const l = finishLayer(kind, fc, params);
    put(sanitizeParams(kind, l.params), p);
    for (const [name, id] of Object.entries(l.roles)) setRole(name, id, p);
  };
  layer(si?.finish, 'sheet');
  if (si?.params) put(sanitizeParams(kind, si.params), 'sheet');
  if (si?.roles) for (const [name, id] of Object.entries(si.roles)) setRole(name, id, 'sheet');
  layer(item.finish, 'viewer');
  put(sanitizeParams(kind, drawingParams(kind, drawing)), 'drawing');
  // the drawing's handle height and length are for the handle it drew (a plain bar): a long bar centres itself on the shutter
  if (kind === 'wardrobe' && params.handle === 'long-bar' && prov['param:handleYM'] === 'drawing') { params.handleYM = 0; prov['param:handleYM'] = 'default'; }

  const usesSheet = Object.values(prov).includes('sheet');
  return { kind, params, roles, prov, finishIds, packId: pack.id, sheetSource: usesSheet && sheet ? sheet.source : null };
}

/** the words for a value's provenance, as the look panel and an item's card say them */
export function provLabel(p: Prov, sheetSource: SheetSource | null): string {
  switch (p) {
    case 'drawing': return 'from the drawing';
    case 'sheet': return sheetSource === 'designer-renders' ? "from the designer's renders" : sheetSource === 'broker' ? "from the broker's design sheet" : 'from the design sheet';
    case 'viewer': return 'your choice';
    default: return 'typical finish (style pack)';
  }
}

/** one line for an item's card: the finish and where it came from, e.g. "Finish: from the designer's renders (Warm Oak & Navy)" */
export function finishNote(r: ResolvedLook | null, packName: string): string {
  if (!r) return 'Furniture style is illustrative. Sizes are exact.';
  const roleProv = Object.entries(r.prov).filter(([k]) => k.startsWith('role:')).map(([, v]) => v);
  const top: Prov = roleProv.includes('viewer') ? 'viewer' : roleProv.includes('sheet') ? 'sheet' : 'pack';
  const drawn = Object.entries(r.prov).some(([k, v]) => k.startsWith('param:') && v === 'drawing');
  return `Finish ${provLabel(top, r.sheetSource)} (${packName}).${drawn ? ' Bays, shutters and handle height are from the drawing.' : ''} Sizes are exact.`;
}

/** the room finish ids in force for a room: sheet room > pack room, with the provenance of each */
export function roomFinishIds(roomId: string, st: StyleState = state): { wall?: [string, Prov]; floor?: [string, Prov]; ceiling?: [string, Prov] } {
  const out: { wall?: [string, Prov]; floor?: [string, Prov]; ceiling?: [string, Prov] } = {};
  if (st.pack.classic) return out;
  const sheetRoom = sheetInForce(st)?.rooms[roomId];
  for (const k of ['wall', 'floor', 'ceiling'] as const) {
    const s = sheetRoom?.[k];
    if (s) out[k] = [s, 'sheet'];
    else if (st.pack.room[k]) out[k] = [st.pack.room[k] as string, 'pack'];
  }
  return out;
}

/** what a door panel is made of under the active style: its colour and whether the wood grain shows (a wood finish keeps its grain, a laminate or paint is plain); null in Classic */
export function doorPanelFinish(st: StyleState = getStyle()): { colour: string; grain: boolean } | null {
  if (st.pack.classic) return null;
  const id = sheetInForce(st)?.items.decor?.roles?.door ?? st.pack.roles.door;
  const f = finishDef(id);
  return f ? { colour: f.colour, grain: f.kind === 'wood' } : null;
}

/** The pack's accents of the shell itself (SPEC 16.18): skirting, frame and handle colours; every field null where the pack names none (and always in Classic). */
export function trimColours(st: StyleState = getStyle()): { skirting: string | null; frame: string | null; handle: string | null; /** the frame is a wood (its grain shows), not paint */ frameGrain: boolean } {
  if (st.pack.classic) return { skirting: null, frame: null, handle: null, frameGrain: true };
  const t = st.pack.trim ?? {};
  const frame = finishDef(t.frame);
  return { skirting: finishDef(t.skirting)?.colour ?? null, frame: frame?.colour ?? null, handle: finishDef(t.handle)?.colour ?? null, frameGrain: frame ? frame.kind === 'wood' : true };
}

/** the colour of door panels under the active style: the sheet's or the pack's `door` role (a wood or laminate finish), null in Classic */
export function doorPanelColour(st: StyleState = getStyle()): string | null {
  if (st.pack.classic) return null;
  const id = sheetInForce(st)?.items.decor?.roles?.door ?? st.pack.roles.door;
  return finishDef(id)?.colour ?? null;
}
