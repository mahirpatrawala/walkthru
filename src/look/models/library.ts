// The model library (SPEC 16.15): which CC0 model can stand in for which piece, how each of its parts maps onto the finish palette, and
// the sizes MEASURED on the shipped GLBs (manifest.json, written by tools/optimise-look-models.mjs). Nothing here knows a home: a piece
// of furniture takes a model only through `planFurniture` (fit.ts: the drawn box wins), a piece of decor through `decorChoice`.
import type { FurnitureItem } from '../../types';
import type { LookKind, Roles } from '../gen';
import type { MatSpec } from '../gen';
import type { ResolvedLook } from '../style';
import manifest from './manifest.json';
import { FIT_TOL, decorScale, fitModel, surfaceMatches } from './fit';
import type { Dims, FitResult } from './fit';

export type DecorModelKind = 'plant' | 'jug' | 'fruit' | 'clock';
export type ModelFamily = LookKind | DecorModelKind;
export type ModelTier = 'low' | 'full';

/** a shipped file; its SHA-256 is in public/look/models/models.lock.json */
export interface ModelFile { file: string; bytes: number }
export interface PartFacts { tris: { low: number; full: number }; detailMean: number; /** spread of light and dark in the diffuse map, relative to its mean */ detailCv?: number; material: { baseColor: number[] } }
/** one shipped model, as measured: sizes in metres in the model's own frame (x width, y height, z depth; front +Z) */
export interface ModelInfo {
  id: string;
  dims: { w: number; h: number; d: number };
  place: 'floor' | 'wall';
  /** height of the seat or the top, measured on the model */
  surfaceM?: number;
  files: Record<ModelTier, ModelFile>;
  parts: Record<string, PartFacts>;
  tris: Record<ModelTier, number>;
}

const MODELS = (manifest as unknown as { models: Record<string, ModelInfo> }).models;
export function modelInfo(id: string): ModelInfo | null { return MODELS[id] ?? null; }
export function allModelIds(): string[] { return Object.keys(MODELS); }
export const modelUrl = (id: string, tier: ModelTier): string | null => { const f = MODELS[id]?.files[tier]; return f ? `/look/models/${f.file}` : null; };

/** how a part of a model takes the finish palette: role names tried in order (the pack's, the sheet's and the viewer's roles). No role = the model's own material. */
export interface PartUse {
  role?: string[];
  /** 'skip': left out of the bake's object-AO atlas (SPEC 16.14): a part made of hundreds of separate pieces (leaves, slats) would eat the whole atlas. It is still a movable mesh and is probe-lit like all furniture. */
  bake?: 'skip';
}
export interface LibModel {
  id: string;
  label: string;
  family: ModelFamily;
  parts: Record<string, PartUse>;
  /** replaces the whole generated piece, or only the chairs of a dining set */
  use: 'whole' | 'chairs' | 'decor';
  /** looks the same turned a quarter (a round or squarish table): the better orientation is tried */
  turnable?: boolean;
}

/** furniture, in order of preference (the sizes decide which one a piece can take) */
export const FURNITURE_MODELS: LibModel[] = [
  { id: 'dining_chair_02', label: 'Padded dining chair', family: 'dining', use: 'chairs', parts: { fabric: { role: ['fabric', 'accent'] }, legs: { role: ['case', 'legs'] } } },
  { id: 'side_table_01', label: 'Oak side table', family: 'side', use: 'whole', turnable: true, parts: { body: { role: ['top', 'case'] } } },
  { id: 'modern_wooden_cabinet', label: 'Slatted TV cabinet', family: 'dresser', use: 'whole', parts: { body: { role: ['case', 'top'] }, slats: { role: ['case', 'top'], bake: 'skip' }, legs: { role: ['handle', 'plinth'] } } },
];

/** decor: free to use at any size the planner asks for (it is out of every measurement), scaled uniformly */
export const DECOR_MODELS: LibModel[] = [
  { id: 'potted_plant_01', label: 'Potted plant', family: 'plant', use: 'decor', parts: { pot: {}, leaves: { bake: 'skip' } } },
  { id: 'potted_plant_02', label: 'Potted plant', family: 'plant', use: 'decor', parts: { pot: {}, leaves: { bake: 'skip' } } },
  { id: 'ceramic_vase_01', label: 'Ceramic vase', family: 'jug', use: 'decor', parts: { body: {} } },
  { id: 'ceramic_vase_04', label: 'Ceramic jug', family: 'jug', use: 'decor', parts: { body: {} } },
  { id: 'jug_01', label: 'Painted jug', family: 'jug', use: 'decor', parts: { body: {} } },
  { id: 'ceramic_vase_02', label: 'Ceramic vase', family: 'jug', use: 'decor', parts: { body: {} } },
  { id: 'wooden_bowl_01', label: 'Wooden fruit bowl', family: 'fruit', use: 'decor', parts: { body: {} } },
  { id: 'wall_clock', label: 'Wall clock', family: 'clock', use: 'decor', parts: { body: {} } },
];

/** the fruit of a bowl, placed in fractions of the bowl's radius so it scales with it: model id, x, z (of the radius), lift above the bowl's floor (m at scale 1), yaw */
export const FRUIT_IN_BOWL: { id: string; x: number; z: number; lift: number; yaw: number; scale: number }[] = [
  { id: 'food_apple_01', x: -0.38, z: 0.1, lift: 0.028, yaw: 20, scale: 0.9 },
  { id: 'food_apple_01', x: 0.3, z: -0.25, lift: 0.028, yaw: 140, scale: 0.9 },
  { id: 'lemon', x: 0.1, z: 0.45, lift: 0.03, yaw: 70, scale: 1 },
  { id: 'food_pomegranate_01', x: -0.05, z: -0.1, lift: 0.04, yaw: 200, scale: 0.9 },
  { id: 'lemon', x: 0.42, z: 0.2, lift: 0.03, yaw: 10, scale: 1 },
];
export const FRUIT_IDS = [...new Set(FRUIT_IN_BOWL.map((f) => f.id))];

const ALL: LibModel[] = [...FURNITURE_MODELS, ...DECOR_MODELS];
export function libModel(id: string): LibModel | null { return ALL.find((m) => m.id === id) ?? null; }

// ---------------------------------------------------------------- the style pack's say

/** a pack's `models` field: per family, 'generator' (never a model) or model ids in preference order. A family it does not mention takes every model of the library. */
export type ModelPolicy = Partial<Record<ModelFamily, 'generator' | string[]>>;

let enabled = true;
/** `?models=off` (checks and before/after pictures): the generated pieces only, whatever the pack says */
export function setModelsEnabled(on: boolean): void { enabled = on; }
export function modelsEnabled(): boolean { return enabled; }

/** the models of `family` a pack allows, in its order. No pack (the Classic look) allows none. */
export function candidates(family: ModelFamily, policy: ModelPolicy | null): LibModel[] {
  if (!policy || !enabled) return [];
  const want = policy[family];
  const all = ALL.filter((m) => m.family === family && modelInfo(m.id));
  if (want === 'generator') return [];
  if (!want) return all;
  const ordered = want.map((id) => all.find((m) => m.id === id)).filter((m): m is LibModel => !!m);
  return ordered;
}

// ---------------------------------------------------------------- furniture

/** What the generated dining chair occupies (the generator's constants): seat width, and a seat plus a leaning back deep. The height is the item's. */
export const CHAIR_SLOT = { w: 0.44, d: 0.58 };

export interface FurniturePlan {
  model: LibModel;
  info: ModelInfo;
  fit: FitResult;
}

/**
 * Which model, if any, may stand in for this piece. All of these must hold, otherwise the generator stays:
 *  - the pack allows a model for the family (and the piece is not under the Classic look);
 *  - nothing the DRAWING, the DESIGN SHEET or the VIEWER chose about the piece's shape (a generator param) would be lost (finish roles are fine: they recolour);
 *  - the model fits the drawn box and height within FIT_TOL on every axis, and its seat or top lands within 3 cm of the item's surface height.
 * A dining chair is checked against the chair's slot instead (CHAIR_SLOT, item height), and must leave the table's middle free.
 */
export function planFurniture(item: Pick<FurnitureItem, 'box' | 'heightM' | 'surfaceHeightM' | 'finish'>, look: ResolvedLook | null, policy: ModelPolicy | null): FurniturePlan | null {
  if (!look || !policy) return null;
  if (item.finish?.style) return null;
  for (const [k, v] of Object.entries(look.prov)) if (k.startsWith('param:') && (v === 'drawing' || v === 'sheet' || v === 'viewer')) return null;
  let best: FurniturePlan | null = null;
  for (const model of candidates(look.kind, policy)) {
    if (model.use === 'decor') continue;
    const info = modelInfo(model.id);
    if (!info) continue;
    let fit: FitResult;
    if (model.use === 'chairs') {
      // the chairs of a table: the chair slot, and both rows must leave the middle of the footprint clear
      const turned = item.box.d > item.box.w * 1.25;
      const depth = turned ? item.box.w : item.box.d;
      fit = fitModel(info.dims, { w: CHAIR_SLOT.w, h: item.heightM, d: CHAIR_SLOT.d });
      if (fit.ok && info.dims.d * fit.scale.z > depth / 2 - 0.005) fit = { ...fit, ok: false };
      if (fit.ok && !surfaceMatches(info.surfaceM, fit.scale.y, 0.45, 0.03)) fit = { ...fit, ok: false };
    } else {
      fit = fitModel(info.dims, { w: item.box.w, h: item.heightM, d: item.box.d }, FIT_TOL, !!model.turnable);
      if (fit.ok && !surfaceMatches(info.surfaceM, fit.scale.y, item.surfaceHeightM)) fit = { ...fit, ok: false };
    }
    if (fit.ok && (!best || fit.worst < best.fit.worst)) best = { model, info, fit };
  }
  return best;
}

/** the spec of the first of `names` the roles define, or null (the part keeps the model's own material) */
export function pickRole(roles: Roles, names: string[] | undefined): MatSpec | null {
  for (const n of names ?? []) if (roles[n]) return roles[n];
  return null;
}

// ---------------------------------------------------------------- decor

export interface DecorChoice { model: LibModel; info: ModelInfo; scale: number }
/** A decor piece's model, chosen by its seed so a home's pieces differ but never flicker between builds. Null: the generator draws it. */
export function decorChoice(kind: string, piece: { w: number; d: number; height: number; seed: number; wall?: boolean }, policy: ModelPolicy | null): DecorChoice | null {
  const list = candidates(kind as DecorModelKind, policy).filter((m) => m.use === 'decor');
  if (list.length === 0) return null;
  const model = list[piece.seed % list.length];
  const info = modelInfo(model.id);
  if (!info) return null;
  if (kind === 'fruit') {
    // a bowl that takes the piece's footprint, with fruit in it
    return { model, info, scale: Math.max(0.5, Math.min(1.3, piece.w / info.dims.w)) };
  }
  return { model, info, scale: decorScale(info.dims, piece) };
}

export type { Dims };
