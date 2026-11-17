// The registry of the style generators (SPEC 16.13): for each look kind its default params, a builder, which params are enums or
// ranges (so a design sheet's JSON can be checked), and how a viewer's finish choice (`FurnitureItem.finish`) maps onto roles.
// Every builder is a pure function (env, size, params, roles) -> THREE.Group, in metres, in the item's frame.
import type * as THREE from 'three';
import type { FurnitureItem } from '../../types';
import { pieceRule } from '../../core/pieces';
import type { GenEnv, GenSize, Roles } from './core';
import { BED_BASES, BED_DEFAULTS, BED_HEADBOARDS, buildBed } from './bed';
import type { BedParams } from './bed';
import { BENCH_DEFAULTS, DINING_DEFAULTS, SOFA_DEFAULTS, buildBench, buildDining, buildSofa } from './seating';
import type { BenchParams, DiningParams, SofaParams } from './seating';
import { COUNTER_DEFAULTS, DRESSER_DEFAULTS, SIDE_DEFAULTS, STUDY_DEFAULTS, buildCounter, buildDresser, buildSide, buildStudy } from './casegoods';
import type { CounterParams, DresserParams, SideParams, StudyParams } from './casegoods';
import { HANDLE_STYLES, SHUTTER_STYLES, WARDROBE_DEFAULTS, buildWardrobe } from './wardrobe';
import type { WardrobeParams } from './wardrobe';
import { SWING_DEFAULTS, SWING_VARIANTS, buildSwing } from './swing';
import type { SwingParams } from './swing';
import { CABINET_DEFAULTS, CABINET_VARIANTS, TABLEX_DEFAULTS, TABLE_VARIANTS, TVUNIT_DEFAULTS, buildCabinet, buildTableX, buildTvUnit } from './home';
import type { CabinetParams, TableXParams, TvUnitParams } from './home';
import { BEDX_DEFAULTS, BEDX_VARIANTS, SEATX_DEFAULTS, SEATX_VARIANTS, buildBedX, buildSeatX } from './seatx';
import type { BedXParams, SeatXParams } from './seatx';
import { APPLIANCE_DEFAULTS, APPLIANCE_VARIANTS, FIT_DEFAULTS, FIT_VARIANTS, OUTDOOR_DEFAULTS, OUTDOOR_VARIANTS, buildAppliance, buildFit, buildOutdoor } from './appliance';
import type { ApplianceParams, FitParams, OutdoorParams } from './appliance';
import { BATH_DEFAULTS, BATH_VARIANTS, buildBath } from './bath';
import type { BathParams } from './bath';
import { CARDIO_DEFAULTS, CARDIO_VARIANTS, buildCardio } from './cardio';
import type { CardioParams } from './cardio';
import { STRENGTH_DEFAULTS, STRENGTH_VARIANTS, buildStrength } from './strength';
import type { StrengthParams } from './strength';
import { FREEW_DEFAULTS, FREEW_VARIANTS, buildFreeWeights } from './freew';
import type { FreeWParams } from './freew';
import { STUDIO_DEFAULTS, STUDIO_VARIANTS, buildStudio } from './studio';
import type { StudioParams } from './studio';
import { LOBBY_DEFAULTS, LOBBY_VARIANTS, buildLobby } from './lobby';
import type { LobbyParams } from './lobby';
import { HALL_DEFAULTS, HALL_VARIANTS, buildHall } from './hall';
import type { HallParams } from './hall';
import { POOL_DEFAULTS, POOL_VARIANTS, buildPool } from './pool';
import type { PoolParams } from './pool';
import { GARDEN_DEFAULTS, GARDEN_VARIANTS, buildGarden } from './garden';
import type { GardenParams } from './garden';

export type LookKind = 'bed' | 'sofa' | 'bench' | 'wardrobe' | 'study' | 'side' | 'dresser' | 'counter' | 'dining'
  // the families added with the catalogue's second table (src/core/catalog-more.ts): each takes a `variant` param that names the piece
  | 'swing' | 'tvunit' | 'cabinet' | 'tablex' | 'seatx' | 'bedx' | 'appliance' | 'fit' | 'outdoor' | 'bath'
  // the shared spaces of a building (src/core/catalog-gym.ts, catalog-lobby.ts, catalog-hall.ts)
  | 'cardio' | 'strength' | 'freew' | 'studio' | 'lobby' | 'hall'
  // the pool deck and the garden (src/core/catalog-pool.ts, catalog-garden.ts)
  | 'pool' | 'garden';
export const LOOK_KINDS: LookKind[] = ['bed', 'sofa', 'bench', 'wardrobe', 'study', 'side', 'dresser', 'counter', 'dining', 'swing', 'tvunit', 'cabinet', 'tablex', 'seatx', 'bedx', 'appliance', 'fit', 'outdoor', 'bath', 'cardio', 'strength', 'freew', 'studio', 'lobby', 'hall', 'pool', 'garden'];

/** which kind of piece an item is: by `kind`, and for a counter by its label */
export function lookKindOf(item: Pick<FurnitureItem, 'kind' | 'label'> & { catalogId?: string }): LookKind {
  // a catalogue piece of the second table names its generator itself
  const rule = pieceRule(item.catalogId);
  if (rule) return rule.look.kind as LookKind;
  switch (item.kind) {
    case 'bed': return 'bed';
    case 'sofa': return /bench|window seat|settee/i.test(item.label ?? '') ? 'bench' : 'sofa';
    case 'wardrobe': return 'wardrobe';
    case 'dining': return 'dining';
    default: {
      const l = item.label ?? '';
      if (/window seat|bench|settee/i.test(l)) return 'bench';
      if (/study|desk/i.test(l)) return 'study';
      if (/side|bedside|night/i.test(l)) return 'side';
      if (/dresser|tv|console|sideboard|storage unit/i.test(l)) return 'dresser';
      return 'counter';
    }
  }
}

type Params = Record<string, unknown>;
interface GenSpec {
  defaults: Params;
  build(env: GenEnv, size: GenSize, p: Params, roles: Roles): THREE.Group;
  enums: Record<string, readonly string[]>;
  ranges: Record<string, [number, number]>;
}
const enumsOf = (...l: [string, readonly string[]][]): Record<string, readonly string[]> => Object.fromEntries(l);
const COUNTER_HANDLES = ['groove', 'knob', 'bar'] as const;

export const GENERATORS: Record<LookKind, GenSpec> = {
  wardrobe: {
    defaults: WARDROBE_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildWardrobe(e, s, p as unknown as WardrobeParams, r),
    enums: enumsOf(['shutterStyle', SHUTTER_STYLES], ['handle', HANDLE_STYLES]),
    ranges: { bays: [0, 8], shuttersPerBay: [1, 4], loftM: [0, 0.8], plinthM: [0, 0.2], drawerStripM: [0, 0.4], handleYM: [0, 3], handleLenM: [0, 1.4] },
  },
  bed: {
    defaults: BED_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildBed(e, s, p as unknown as BedParams, r),
    enums: enumsOf(['base', BED_BASES], ['headboard', BED_HEADBOARDS], ['duvet', ['quilted', 'plain', 'none']]),
    ranges: { baseTopM: [0, 0.6] },
  },
  sofa: {
    defaults: SOFA_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildSofa(e, s, p as unknown as SofaParams, r),
    enums: enumsOf(['arms', ['round', 'box', 'none']], ['legs', ['wood', 'metal', 'plinth']], ['chaise', ['auto', 'none', 'left', 'right']]),
    ranges: { seats: [0, 5], cushions: [0, 2] },
  },
  bench: {
    defaults: BENCH_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildBench(e, s, p as unknown as BenchParams, r),
    enums: enumsOf(['shape', ['rect', 'curved-end', 'curved-both']], ['curveSide', ['left', 'right']]),
    ranges: { radiusM: [0, 1] },
  },
  study: {
    defaults: STUDY_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildStudy(e, s, p as unknown as StudyParams, r),
    enums: enumsOf(['top', ['slab', 'thick']], ['pedestal', ['right', 'left', 'none']], ['handle', COUNTER_HANDLES]),
    ranges: { drawers: [1, 5] },
  },
  side: {
    defaults: SIDE_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildSide(e, s, p as unknown as SideParams, r),
    enums: enumsOf(['style', ['drawer', 'open', 'legs']], ['handle', COUNTER_HANDLES]),
    ranges: {},
  },
  dresser: {
    defaults: DRESSER_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildDresser(e, s, p as unknown as DresserParams, r),
    enums: enumsOf(['base', ['plinth', 'legs']], ['handle', COUNTER_HANDLES]),
    ranges: { fronts: [0, 8], nicheM: [0, 1.2] },
  },
  counter: {
    defaults: COUNTER_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildCounter(e, s, p as unknown as CounterParams, r),
    enums: enumsOf(['shutterStyle', SHUTTER_STYLES], ['handle', COUNTER_HANDLES]),
    ranges: {},
  },
  dining: {
    defaults: DINING_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildDining(e, s, p as unknown as DiningParams, r),
    enums: enumsOf(['chair', ['padded', 'slat']], ['legs', ['tapered', 'square']]),
    ranges: { chairs: [2, 8] },
  },
  swing: {
    defaults: SWING_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildSwing(e, s, p as unknown as SwingParams, r),
    enums: enumsOf(['variant', SWING_VARIANTS]), ranges: {},
  },
  tvunit: {
    defaults: TVUNIT_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildTvUnit(e, s, p as unknown as TvUnitParams, r),
    enums: enumsOf(['base', ['legs', 'plinth']], ['handle', COUNTER_HANDLES]), ranges: { tvW: [0.3, 1.8], tvH: [0.2, 1.0] },
  },
  cabinet: {
    defaults: CABINET_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildCabinet(e, s, p as unknown as CabinetParams, r),
    enums: enumsOf(['variant', CABINET_VARIANTS], ['handle', COUNTER_HANDLES]), ranges: { liftM: [0, 2.6] },
  },
  tablex: {
    defaults: TABLEX_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildTableX(e, s, p as unknown as TableXParams, r),
    enums: enumsOf(['variant', TABLE_VARIANTS], ['legs', ['square', 'tapered', 'metal']], ['handle', COUNTER_HANDLES]), ranges: {},
  },
  seatx: {
    defaults: SEATX_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildSeatX(e, s, p as unknown as SeatXParams, r),
    enums: enumsOf(['variant', SEATX_VARIANTS], ['legs', ['wood', 'metal']]), ranges: {},
  },
  bedx: {
    defaults: BEDX_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildBedX(e, s, p as unknown as BedXParams, r),
    enums: enumsOf(['variant', BEDX_VARIANTS]), ranges: {},
  },
  appliance: {
    defaults: APPLIANCE_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildAppliance(e, s, p as unknown as ApplianceParams, r),
    enums: enumsOf(['variant', APPLIANCE_VARIANTS]), ranges: { liftM: [0, 2.6] },
  },
  fit: {
    defaults: FIT_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildFit(e, s, p as unknown as FitParams, r),
    enums: enumsOf(['variant', FIT_VARIANTS]), ranges: {},
  },
  outdoor: {
    defaults: OUTDOOR_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildOutdoor(e, s, p as unknown as OutdoorParams, r),
    enums: enumsOf(['variant', OUTDOOR_VARIANTS]), ranges: {},
  },
  cardio: {
    defaults: CARDIO_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildCardio(e, s, p as unknown as CardioParams, r),
    enums: enumsOf(['variant', CARDIO_VARIANTS]), ranges: {},
  },
  strength: {
    defaults: STRENGTH_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildStrength(e, s, p as unknown as StrengthParams, r),
    enums: enumsOf(['variant', STRENGTH_VARIANTS]), ranges: {},
  },
  freew: {
    defaults: FREEW_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildFreeWeights(e, s, p as unknown as FreeWParams, r),
    enums: enumsOf(['variant', FREEW_VARIANTS]), ranges: {},
  },
  studio: {
    defaults: STUDIO_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildStudio(e, s, p as unknown as StudioParams, r),
    enums: enumsOf(['variant', STUDIO_VARIANTS]), ranges: { liftM: [0, 2.6] },
  },
  lobby: {
    defaults: LOBBY_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildLobby(e, s, p as unknown as LobbyParams, r),
    enums: enumsOf(['variant', LOBBY_VARIANTS]), ranges: { liftM: [0, 2.6] },
  },
  hall: {
    defaults: HALL_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildHall(e, s, p as unknown as HallParams, r),
    enums: enumsOf(['variant', HALL_VARIANTS]), ranges: { liftM: [0, 2.6] },
  },
  pool: {
    defaults: POOL_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildPool(e, s, p as unknown as PoolParams, r),
    enums: enumsOf(['variant', POOL_VARIANTS]), ranges: { canopyM: [1.5, 4], liftM: [0, 2.6] },
  },
  garden: {
    defaults: GARDEN_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildGarden(e, s, p as unknown as GardenParams, r),
    enums: enumsOf(['variant', GARDEN_VARIANTS]), ranges: {},
  },
  bath: {
    defaults: BATH_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildBath(e, s, p as unknown as BathParams, r),
    enums: enumsOf(['variant', BATH_VARIANTS]), ranges: { liftM: [0, 2.6] },
  },
};

/** The params of `raw` that are valid for `kind` (a known key, the right type, an allowed enum value, inside its range). Never throws. */
export function sanitizeParams(kind: LookKind, raw: unknown): Params {
  const out: Params = {};
  if (!raw || typeof raw !== 'object') return out;
  const spec = GENERATORS[kind];
  for (const [k, v] of Object.entries(raw as Params)) {
    if (!(k in spec.defaults)) continue;
    const def = spec.defaults[k];
    if (Array.isArray(def)) {
      if (Array.isArray(v) && v.length === def.length && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) out[k] = [...v];
    } else if (typeof def === 'number') {
      const [lo, hi] = spec.ranges[k] ?? [0, 10];
      if (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi) out[k] = v;
    } else if (typeof def === 'boolean') {
      if (typeof v === 'boolean') out[k] = v;
    } else if (typeof def === 'string') {
      const allowed = spec.enums[k];
      if (typeof v === 'string' && (!allowed || allowed.includes(v))) out[k] = v;
    }
  }
  return out;
}

export function sizeOf(item: Pick<FurnitureItem, 'box' | 'heightM' | 'surfaceHeightM' | 'inner'>): GenSize {
  return { w: item.box.w, d: item.box.d, h: item.heightM, s: item.surfaceHeightM, inner: item.inner ? { w: item.inner.w, d: item.inner.d } : undefined };
}

export { GEN_QUALITY } from './core';
export { genQuality, setUltraDetail, ultraDetail, ULTRA_QUALITY } from './ultra';
export type { GenEnv, GenSize, MatSpec, Roles } from './core';
