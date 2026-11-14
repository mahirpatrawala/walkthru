// The registry of the style generators (SPEC 16.13): for each look kind its default params, a builder, which params are enums or
// ranges (so a design sheet's JSON can be checked), and how a viewer's finish choice (`FurnitureItem.finish`) maps onto roles.
// Every builder is a pure function (env, size, params, roles) -> THREE.Group, in metres, in the item's frame.
import type * as THREE from 'three';
import type { FurnitureItem } from '../../types';
import type { GenEnv, GenSize, Roles } from './core';
import { BED_BASES, BED_DEFAULTS, BED_HEADBOARDS, buildBed } from './bed';
import type { BedParams } from './bed';
import { BENCH_DEFAULTS, DINING_DEFAULTS, SOFA_DEFAULTS, buildBench, buildDining, buildSofa } from './seating';
import type { BenchParams, DiningParams, SofaParams } from './seating';
import { COUNTER_DEFAULTS, DRESSER_DEFAULTS, SIDE_DEFAULTS, STUDY_DEFAULTS, buildCounter, buildDresser, buildSide, buildStudy } from './casegoods';
import type { CounterParams, DresserParams, SideParams, StudyParams } from './casegoods';
import { HANDLE_STYLES, SHUTTER_STYLES, WARDROBE_DEFAULTS, buildWardrobe } from './wardrobe';
import type { WardrobeParams } from './wardrobe';

export type LookKind = 'bed' | 'sofa' | 'bench' | 'wardrobe' | 'study' | 'side' | 'dresser' | 'counter' | 'dining';
export const LOOK_KINDS: LookKind[] = ['bed', 'sofa', 'bench', 'wardrobe', 'study', 'side', 'dresser', 'counter', 'dining'];

/** which kind of piece an item is: by `kind`, and for a counter by its label */
export function lookKindOf(item: Pick<FurnitureItem, 'kind' | 'label'>): LookKind {
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

/** how a viewer's `finish` ({ primary, secondary, fabric, style }) lands on this kind's roles and params */
export interface ViewerMap { primary: string[]; secondary: string[]; fabric: string[]; style?: string }

type Params = Record<string, unknown>;
interface GenSpec {
  defaults: Params;
  build(env: GenEnv, size: GenSize, p: Params, roles: Roles): THREE.Group;
  enums: Record<string, readonly string[]>;
  ranges: Record<string, [number, number]>;
  viewer: ViewerMap;
}
const enumsOf = (...l: [string, readonly string[]][]): Record<string, readonly string[]> => Object.fromEntries(l);
const COUNTER_HANDLES = ['groove', 'knob', 'bar'] as const;

export const GENERATORS: Record<LookKind, GenSpec> = {
  wardrobe: {
    defaults: WARDROBE_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildWardrobe(e, s, p as unknown as WardrobeParams, r),
    enums: enumsOf(['shutterStyle', SHUTTER_STYLES], ['handle', HANDLE_STYLES]),
    ranges: { bays: [0, 8], shuttersPerBay: [1, 4], loftM: [0, 0.8], plinthM: [0, 0.2], drawerStripM: [0, 0.4], handleYM: [0, 3], handleLenM: [0, 1.4] },
    viewer: { primary: ['case', 'flute'], secondary: ['handle'], fabric: [], style: 'shutterStyle' },
  },
  bed: {
    defaults: BED_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildBed(e, s, p as unknown as BedParams, r),
    enums: enumsOf(['base', BED_BASES], ['headboard', BED_HEADBOARDS], ['duvet', ['quilted', 'plain', 'none']]),
    ranges: { baseTopM: [0, 0.6], pillows: [0, 6], cushions: [0, 4] },
    viewer: { primary: ['bedFrame', 'headboard'], secondary: ['cushion'], fabric: ['duvet'], style: 'headboard' },
  },
  sofa: {
    defaults: SOFA_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildSofa(e, s, p as unknown as SofaParams, r),
    enums: enumsOf(['arms', ['round', 'box', 'none']], ['legs', ['wood', 'metal', 'plinth']], ['chaise', ['auto', 'none', 'left', 'right']]),
    ranges: { seats: [0, 5], cushions: [0, 4] },
    viewer: { primary: ['legs'], secondary: ['cushion'], fabric: ['fabric'], style: 'arms' },
  },
  bench: {
    defaults: BENCH_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildBench(e, s, p as unknown as BenchParams, r),
    enums: enumsOf(['shape', ['rect', 'curved-end', 'curved-both']], ['curveSide', ['left', 'right']]),
    ranges: { radiusM: [0, 1] },
    viewer: { primary: ['case'], secondary: [], fabric: ['accent'], style: 'shape' },
  },
  study: {
    defaults: STUDY_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildStudy(e, s, p as unknown as StudyParams, r),
    enums: enumsOf(['top', ['slab', 'thick']], ['pedestal', ['right', 'left', 'none']], ['handle', COUNTER_HANDLES]),
    ranges: { drawers: [1, 5] },
    viewer: { primary: ['case', 'drawerFront'], secondary: ['top'], fabric: [], style: 'handle' },
  },
  side: {
    defaults: SIDE_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildSide(e, s, p as unknown as SideParams, r),
    enums: enumsOf(['style', ['drawer', 'open', 'legs']], ['handle', COUNTER_HANDLES]),
    ranges: {},
    viewer: { primary: ['case', 'drawerFront'], secondary: ['top'], fabric: [], style: 'style' },
  },
  dresser: {
    defaults: DRESSER_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildDresser(e, s, p as unknown as DresserParams, r),
    enums: enumsOf(['base', ['plinth', 'legs']], ['handle', COUNTER_HANDLES]),
    ranges: { fronts: [0, 8], nicheM: [0, 1.2] },
    viewer: { primary: ['case', 'drawerFront'], secondary: ['top'], fabric: [], style: 'handle' },
  },
  counter: {
    defaults: COUNTER_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildCounter(e, s, p as unknown as CounterParams, r),
    enums: enumsOf(['shutterStyle', SHUTTER_STYLES], ['handle', COUNTER_HANDLES]),
    ranges: {},
    viewer: { primary: ['case'], secondary: ['top'], fabric: [], style: 'shutterStyle' },
  },
  dining: {
    defaults: DINING_DEFAULTS as unknown as Params, build: (e, s, p, r) => buildDining(e, s, p as unknown as DiningParams, r),
    enums: enumsOf(['chair', ['padded', 'slat']], ['legs', ['tapered', 'square']]),
    ranges: { chairs: [2, 8] },
    viewer: { primary: ['case'], secondary: ['top'], fabric: ['fabric'], style: 'chair' },
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
export type { GenEnv, GenSize, MatSpec, Roles } from './core';
