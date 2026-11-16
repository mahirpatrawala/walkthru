// Owned by furnish-edit. The finish palette: pure data and lookups, no three.js, so the buyer UI, the mesh generators and the
// tests all read the same table. `FurnitureItem.finish` (src/types.ts) holds ids from this file, never colours and never sizes.
//
// Honesty (SPEC 16.2): a finish is the viewer's own choice of look. It never changes a box, a height or a fit verdict, and on a
// piece that came with the home it is stored in "My layout" (the per-viewer overlay), never in the property.
import type { FurnitureItem } from '../types';
import { pieceRule } from '../core/pieces';

export type SwatchGroup = 'wood' | 'laminate' | 'fabric' | 'metal' | 'bedding';

export interface Swatch {
  id: string;
  name: string;
  group: SwatchGroup;
  /** '#rrggbb', the base colour of the material (a wood keeps its grain as detail around it) */
  hex: string;
  /** true for woods: the grain texture stays on; solid laminates, fabrics and metals are plain colour */
  grain?: boolean;
  /** PBR hints for a material that takes this swatch */
  roughness: number;
  metalness: number;
}

const wood = (id: string, name: string, hex: string): Swatch => ({ id, name, group: 'wood', hex, grain: true, roughness: 0.48, metalness: 0 });
const lam = (id: string, name: string, hex: string): Swatch => ({ id, name, group: 'laminate', hex, roughness: 0.42, metalness: 0 });
const fab = (id: string, name: string, hex: string): Swatch => ({ id, name, group: 'fabric', hex, roughness: 0.95, metalness: 0 });
const met = (id: string, name: string, hex: string, roughness: number): Swatch => ({ id, name, group: 'metal', hex, roughness, metalness: 0.8 });
const bedding = (id: string, name: string, hex: string): Swatch => ({ id, name, group: 'bedding', hex, roughness: 0.92, metalness: 0 });

/** Every swatch there is. Ids are stable: they are stored in layouts and in shared links. */
export const PALETTE: readonly Swatch[] = [
  // woods
  wood('wood-oak', 'Oak', '#C9A878'),
  wood('wood-walnut', 'Walnut', '#A87C56'),
  wood('wood-teak', 'Teak', '#B07D3F'),
  wood('wood-white', 'White laminate', '#F1EFEA'),
  wood('wood-wenge', 'Wenge', '#4A352B'),
  // solid laminates
  lam('lam-navy', 'Navy', '#2D3D5C'),
  lam('lam-sage', 'Sage', '#9DB09A'),
  lam('lam-terracotta', 'Terracotta', '#C0674A'),
  lam('lam-charcoal', 'Charcoal', '#3C3F43'),
  lam('lam-ivory', 'Ivory', '#F0E9DA'),
  // fabrics
  fab('fab-beige', 'Beige linen', '#CDBFA9'),
  fab('fab-grey', 'Grey', '#8F9296'),
  fab('fab-navy', 'Navy', '#34476B'),
  fab('fab-mustard', 'Mustard', '#D2A23C'),
  fab('fab-teal', 'Teal', '#2F7F82'),
  fab('fab-maroon', 'Maroon', '#7A2E3A'),
  // metals (handles, knobs, legs)
  met('metal-steel', 'Brushed steel', '#B8B8B8', 0.35),
  met('metal-brass', 'Brass', '#C9A24B', 0.3),
  met('metal-black', 'Matt black', '#25262A', 0.5),
  met('metal-rose', 'Rose gold', '#C98D7B', 0.3),
  // bedding (the bedcover)
  bedding('bed-white', 'White', '#F1EEE8'),
  bedding('bed-cream', 'Cream', '#E6D9BE'),
  bedding('bed-grey', 'Grey', '#A7A9AC'),
  bedding('bed-sage', 'Sage', '#A9B8A0'),
  bedding('bed-blush', 'Blush', '#DDB5AA'),
  bedding('bed-navy', 'Navy', '#41557A'),
  bedding('bed-mustard', 'Mustard', '#D8AE55'),
  bedding('bed-teal', 'Teal', '#4A9094'),
];

const BY_ID = new Map(PALETTE.map((s) => [s.id, s]));

export function swatch(id: string | undefined | null): Swatch | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}
export const swatchesIn = (...groups: SwatchGroup[]): Swatch[] => PALETTE.filter((s) => groups.includes(s.group));

// ---------------------------------------------------------------- styles

export type StyleOption = { id: string; name: string };
export const BED_STYLES: readonly StyleOption[] = [
  { id: 'panel', name: 'Panel' },
  { id: 'upholstered', name: 'Upholstered' },
  { id: 'storage', name: 'Storage box' },
];

// ---------------------------------------------------------------- families and their choices

export type FinishFamily = 'bed' | 'sofa' | 'wardrobe' | 'table' | 'chair'
  // the second catalogue table (src/core/catalog-more.ts): a swing, storage, appliances, a bean bag, bunk beds and cots, a plain single colour, sanitary ware
  | 'swing' | 'storage' | 'appliance' | 'pouf' | 'bunk' | 'plain' | 'sanitary';
export type FinishSlotKey = 'primary' | 'secondary' | 'fabric' | 'style';
export type Finish = NonNullable<FurnitureItem['finish']>;

export interface FinishSlot {
  key: FinishSlotKey;
  label: string;
  /** palette ids (or style ids for the `style` slot) the viewer can pick */
  options: string[];
}

const ids = (list: readonly { id: string }[]): string[] => list.map((s) => s.id);
const WOODS_LAMS = ids(swatchesIn('wood', 'laminate'));

export const FAMILY_SLOTS: Record<FinishFamily, FinishSlot[]> = {
  bed: [
    { key: 'primary', label: 'Frame', options: WOODS_LAMS },
    { key: 'fabric', label: 'Headboard', options: ids(swatchesIn('fabric')) },
    { key: 'secondary', label: 'Bedding', options: ids(swatchesIn('bedding')) },
    { key: 'style', label: 'Style', options: ids(BED_STYLES) },
  ],
  sofa: [
    { key: 'fabric', label: 'Fabric', options: ids(swatchesIn('fabric')) },
    { key: 'primary', label: 'Legs', options: [...ids(swatchesIn('wood')), ...ids(swatchesIn('metal'))] },
  ],
  wardrobe: [
    { key: 'primary', label: 'Shutters', options: WOODS_LAMS },
    { key: 'secondary', label: 'Handles', options: ids(swatchesIn('metal')) },
  ],
  table: [
    { key: 'primary', label: 'Top', options: WOODS_LAMS },
    { key: 'secondary', label: 'Legs', options: [...WOODS_LAMS, ...ids(swatchesIn('metal'))] },
  ],
  chair: [
    { key: 'fabric', label: 'Seat', options: ids(swatchesIn('fabric')) },
    { key: 'primary', label: 'Legs', options: [...ids(swatchesIn('wood')), ...ids(swatchesIn('metal'))] },
  ],
  swing: [
    { key: 'primary', label: 'Wood', options: ids(swatchesIn('wood')) },
    { key: 'fabric', label: 'Cushion', options: ids(swatchesIn('fabric')) },
    { key: 'secondary', label: 'Chains', options: ids(swatchesIn('metal')) },
  ],
  storage: [
    { key: 'primary', label: 'Body', options: WOODS_LAMS },
    { key: 'secondary', label: 'Handles', options: ids(swatchesIn('metal')) },
  ],
  appliance: [
    { key: 'primary', label: 'Colour', options: ['wood-white', 'lam-ivory', 'metal-steel', 'lam-charcoal', 'metal-black', 'lam-navy', 'lam-terracotta'] },
  ],
  pouf: [
    { key: 'fabric', label: 'Cover', options: ids(swatchesIn('fabric')) },
  ],
  bunk: [
    { key: 'primary', label: 'Frame', options: WOODS_LAMS },
    { key: 'secondary', label: 'Bedding', options: ids(swatchesIn('bedding')) },
  ],
  plain: [
    { key: 'primary', label: 'Colour', options: [...WOODS_LAMS, ...ids(swatchesIn('fabric'))] },
  ],
  sanitary: [
    { key: 'secondary', label: 'Fittings', options: ids(swatchesIn('metal')) },
  ],
};

export const FAMILY_NAMES: Record<FinishFamily, string> = {
  bed: 'bed', sofa: 'sofa', wardrobe: 'wardrobe', table: 'table', chair: 'chair', swing: 'swing', storage: 'storage unit', appliance: 'appliance', pouf: 'bean bag',
  bunk: 'bed', plain: 'piece', sanitary: 'fitting',
};

/**
 * Which choices a piece has. A kitchen counter has none: it is a fitted platform with a stone top, not a piece of loose
 * furniture, so it gets no "Change look".
 */
export function finishFamily(item: Pick<FurnitureItem, 'kind' | 'label' | 'catalogId'> & { box?: { w: number; d: number } }): FinishFamily | null {
  // a piece of the second catalogue table names its own family (or none)
  const rule = pieceRule(item.catalogId);
  if (rule) return rule.family;
  switch (item.kind) {
    case 'bed': return 'bed';
    case 'wardrobe': return 'wardrobe';
    case 'dining': return 'table';
    case 'sofa': {
      if (item.catalogId === 'armchair' || /chair/i.test(item.label ?? '') || (item.box && item.box.w < 1.0)) return 'chair';
      return 'sofa';
    }
    default: {
      const l = item.label ?? '';
      if (/study|desk|side|bedside|night|table/i.test(l)) return 'table';
      return null;
    }
  }
}

/** True when `id` is a legal pick for this slot of this family. */
export function slotAccepts(family: FinishFamily, key: FinishSlotKey, id: string): boolean {
  const slot = FAMILY_SLOTS[family].find((s) => s.key === key);
  return !!slot && slot.options.includes(id);
}

/**
 * A finish with only the picks that are legal for the family; unknown or foreign ids are dropped (a stored or shared layout may
 * come from anywhere). Returns undefined when nothing is left.
 */
export function sanitizeFinish(family: FinishFamily | null, raw: unknown): Finish | undefined {
  if (!family || !raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: Finish = {};
  for (const key of ['primary', 'secondary', 'fabric', 'style'] as FinishSlotKey[]) {
    const v = o[key];
    if (typeof v === 'string' && slotAccepts(family, key, v)) out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function sameFinish(a: Finish | undefined, b: Finish | undefined): boolean {
  const k = (f: Finish | undefined): string => (f ? `${f.primary ?? ''}|${f.secondary ?? ''}|${f.fabric ?? ''}|${f.style ?? ''}` : '|||');
  return k(a) === k(b);
}

/** A finish with this slot set (or cleared with null), then sanitised. */
export function withPick(family: FinishFamily, current: Finish | undefined, key: FinishSlotKey, id: string | null): Finish | undefined {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  if (id === null) delete next[key]; else next[key] = id;
  return sanitizeFinish(family, next);
}

/** A resolved finish: the swatches behind each id, for a mesh builder. Missing picks stay undefined (the piece's own default). */
export interface ResolvedFinish { primary?: Swatch; secondary?: Swatch; fabric?: Swatch; style?: string }
export function resolveFinish(finish: FurnitureItem['finish'] | undefined): ResolvedFinish {
  const out: ResolvedFinish = {};
  if (!finish) return out;
  const p = swatch(finish.primary); if (p) out.primary = p;
  const s = swatch(finish.secondary); if (s) out.secondary = s;
  const f = swatch(finish.fabric); if (f) out.fabric = f;
  if (finish.style) out.style = finish.style;
  return out;
}

// ---------------------------------------------------------------- "Surprise me": curated, coherent combinations

const SCHEMES: Record<FinishFamily, Finish[]> = {
  bed: [
    { primary: 'wood-walnut', fabric: 'fab-beige', secondary: 'bed-white', style: 'storage' },
    { primary: 'wood-oak', fabric: 'fab-grey', secondary: 'bed-sage', style: 'panel' },
    { primary: 'wood-wenge', fabric: 'fab-mustard', secondary: 'bed-cream', style: 'upholstered' },
    { primary: 'lam-ivory', fabric: 'fab-teal', secondary: 'bed-white', style: 'upholstered' },
    { primary: 'lam-navy', fabric: 'fab-grey', secondary: 'bed-blush', style: 'panel' },
    { primary: 'wood-teak', fabric: 'fab-maroon', secondary: 'bed-cream', style: 'storage' },
  ],
  sofa: [
    { fabric: 'fab-grey', primary: 'wood-oak' },
    { fabric: 'fab-teal', primary: 'wood-walnut' },
    { fabric: 'fab-mustard', primary: 'metal-black' },
    { fabric: 'fab-navy', primary: 'metal-brass' },
    { fabric: 'fab-maroon', primary: 'wood-wenge' },
    { fabric: 'fab-beige', primary: 'wood-teak' },
  ],
  wardrobe: [
    { primary: 'wood-walnut', secondary: 'metal-brass' },
    { primary: 'lam-ivory', secondary: 'metal-steel' },
    { primary: 'lam-sage', secondary: 'metal-brass' },
    { primary: 'lam-navy', secondary: 'metal-rose' },
    { primary: 'wood-oak', secondary: 'metal-black' },
    { primary: 'lam-charcoal', secondary: 'metal-steel' },
  ],
  table: [
    { primary: 'wood-walnut', secondary: 'metal-black' },
    { primary: 'wood-oak', secondary: 'wood-oak' },
    { primary: 'wood-teak', secondary: 'wood-wenge' },
    { primary: 'wood-white', secondary: 'metal-brass' },
    { primary: 'lam-charcoal', secondary: 'metal-steel' },
    { primary: 'wood-wenge', secondary: 'metal-rose' },
  ],
  chair: [
    { fabric: 'fab-teal', primary: 'wood-walnut' },
    { fabric: 'fab-mustard', primary: 'metal-black' },
    { fabric: 'fab-grey', primary: 'wood-oak' },
    { fabric: 'fab-maroon', primary: 'metal-brass' },
    { fabric: 'fab-navy', primary: 'wood-teak' },
  ],
  swing: [
    { primary: 'wood-teak', fabric: 'fab-mustard', secondary: 'metal-brass' },
    { primary: 'wood-walnut', fabric: 'fab-maroon', secondary: 'metal-brass' },
    { primary: 'wood-oak', fabric: 'fab-teal', secondary: 'metal-steel' },
    { primary: 'wood-wenge', fabric: 'fab-beige', secondary: 'metal-black' },
    { primary: 'wood-white', fabric: 'fab-navy', secondary: 'metal-rose' },
  ],
  storage: [
    { primary: 'wood-walnut', secondary: 'metal-brass' },
    { primary: 'wood-oak', secondary: 'metal-black' },
    { primary: 'lam-ivory', secondary: 'metal-steel' },
    { primary: 'wood-teak', secondary: 'metal-brass' },
    { primary: 'lam-charcoal', secondary: 'metal-rose' },
    { primary: 'lam-sage', secondary: 'metal-brass' },
  ],
  appliance: [
    { primary: 'wood-white' }, { primary: 'metal-steel' }, { primary: 'lam-charcoal' }, { primary: 'lam-ivory' }, { primary: 'lam-navy' },
  ],
  pouf: [{ fabric: 'fab-teal' }, { fabric: 'fab-mustard' }, { fabric: 'fab-grey' }, { fabric: 'fab-maroon' }, { fabric: 'fab-navy' }],
  bunk: [
    { primary: 'wood-oak', secondary: 'bed-sage' }, { primary: 'wood-white', secondary: 'bed-blush' }, { primary: 'lam-navy', secondary: 'bed-grey' },
    { primary: 'wood-teak', secondary: 'bed-cream' }, { primary: 'lam-sage', secondary: 'bed-teal' },
  ],
  plain: [
    { primary: 'lam-terracotta' }, { primary: 'lam-sage' }, { primary: 'lam-charcoal' }, { primary: 'wood-teak' }, { primary: 'fab-teal' },
  ],
  sanitary: [{ secondary: 'metal-steel' }, { secondary: 'metal-black' }, { secondary: 'metal-brass' }, { secondary: 'metal-rose' }],
};

/** A coherent combination for the family, never the one in `current`. `rand` is Math.random unless a test injects one. */
export function surpriseFinish(family: FinishFamily, current?: Finish, rand: () => number = Math.random): Finish {
  const pool = SCHEMES[family].filter((s) => !sameFinish(s, current));
  const list = pool.length > 0 ? pool : SCHEMES[family];
  return { ...list[Math.min(list.length - 1, Math.floor(rand() * list.length))] };
}
export const finishSchemes = (family: FinishFamily): Finish[] => SCHEMES[family].map((s) => ({ ...s }));

/** Words for a finish, for a chip or a label: "Walnut frame, Teal headboard". */
export function describeFinish(family: FinishFamily, finish: Finish | undefined): string {
  if (!finish) return '';
  const parts: string[] = [];
  for (const slot of FAMILY_SLOTS[family]) {
    const v = finish[slot.key];
    if (!v) continue;
    const name = slot.key === 'style' ? (BED_STYLES.find((s) => s.id === v)?.name ?? v) : (swatch(v)?.name ?? v);
    parts.push(`${slot.label.toLowerCase()} ${name.toLowerCase()}`);
  }
  return parts.join(', ');
}

// ---------------------------------------------------------------- style-pack finishes (src/look/style.ts, src/look/gen)
//
// The palette above is what a VIEWER picks ("Change look"). Style packs and design sheets name finishes by their own ids, which also
// carry the kind of material the style generators make them of. `finishDef` reads both tables, so a pack, a sheet and a viewer's pick
// all resolve to one colour + material, and the pack ids can be written as the viewer's ids (aliases below).
import type { MatKey } from './furniture-materials';

export type FinishKind = 'wood' | 'laminate' | 'paint' | 'fabric' | 'metal' | 'stone' | 'tile' | 'sheer';
export interface FinishDef {
  id: string;
  name: string;
  /** '#rrggbb', the mean colour of the finished surface */
  colour: string;
  /** the material kind it is made of (a key of furniture-materials.ts) */
  material: MatKey;
  kind: FinishKind;
}
const F = (id: string, name: string, colour: string, material: MatKey, kind: FinishKind): FinishDef => ({ id, name, colour, material, kind });

export const FINISH_LIST: FinishDef[] = [
  F('oak', 'Natural oak', '#CDAB8A', 'wood', 'wood'),
  F('oak-light', 'Light oak', '#D9BC92', 'wood', 'wood'),
  F('oak-warm', 'Warm oak', '#C08A52', 'wood', 'wood'),
  F('walnut-deep', 'Deep walnut', '#5A3F2E', 'wood', 'wood'),
  F('ash-white', 'White-washed ash', '#E3D7C4', 'wood', 'wood'),
  F('walnut', 'Walnut', '#7B5B45', 'wood', 'wood'),
  F('teak', 'Teak', '#A9713F', 'wood', 'wood'),
  F('white-laminate', 'White laminate', '#F1EFEA', 'laminate', 'laminate'),
  F('white-gloss', 'White gloss', '#F6F4F0', 'gloss', 'laminate'),
  F('cream-laminate', 'Cream laminate', '#E4D8C4', 'laminate', 'laminate'),
  F('navy-matte', 'Navy matte laminate', '#49547A', 'laminate', 'laminate'),
  F('charcoal-matte', 'Charcoal matte laminate', '#3B3D41', 'laminate', 'laminate'),
  F('sage-matte', 'Sage matte laminate', '#8C9A86', 'laminate', 'laminate'),
  F('grey-matte', 'Light grey matte laminate', '#B9B8B3', 'laminate', 'laminate'),
  F('wall-beige', 'Warm beige paint', '#E9DAC4', 'paint', 'paint'),
  F('wall-cream', 'Cream paint', '#EFE6D6', 'paint', 'paint'),
  F('wall-white', 'Warm white paint', '#F2EFE9', 'paint', 'paint'),
  F('wall-bright', 'Bright warm white paint', '#F8F6F1', 'paint', 'paint'),
  F('wall-greige', 'Greige paint', '#D3C9BB', 'paint', 'paint'),
  F('wall-stone', 'Stone grey paint', '#CFCCC5', 'paint', 'paint'),
  F('ceiling-white', 'Ceiling white', '#F7F5F0', 'paint', 'paint'),
  F('linen-beige', 'Beige linen', '#CDBBA3', 'weave', 'fabric'),
  F('quilt-beige', 'Beige quilted cotton', '#DACBB5', 'quilt', 'fabric'),
  F('quilt-white', 'White quilted cotton', '#EEEBE4', 'quilt', 'fabric'),
  F('cotton-white', 'White cotton', '#F1EEE8', 'cotton', 'fabric'),
  F('weave-grey', 'Grey weave', '#8E9AA6', 'weave', 'fabric'),
  F('weave-charcoal', 'Charcoal weave', '#4A4C52', 'weave', 'fabric'),
  F('weave-sand', 'Sand weave', '#B9A88F', 'weave', 'fabric'),
  F('weave-sage', 'Sage weave', '#8E9B84', 'weave', 'fabric'),
  F('weave-navy', 'Navy weave', '#2B3A5C', 'weave', 'fabric'),
  F('ticking-navy', 'Navy ticking stripe', '#FFFFFF', 'stripe', 'fabric'),
  F('shag-grey', 'Grey shag', '#B3AEA6', 'shag', 'fabric'),
  F('shag-ivory', 'Ivory shag', '#D9D2C4', 'shag', 'fabric'),
  F('drape-grey', 'Grey drape', '#A0A3A8', 'drape', 'fabric'),
  F('drape-sand', 'Sand drape', '#B7A68E', 'drape', 'fabric'),
  F('drape-sage', 'Sage drape', '#8D9886', 'drape', 'fabric'),
  F('sheer-white', 'White sheer', '#F7F4EE', 'sheer', 'sheer'),
  F('black-metal', 'Matt black metal', '#1D1D1F', 'blackMetal', 'metal'),
  F('brass', 'Brushed brass', '#D4AD66', 'brass', 'metal'),
  F('steel', 'Brushed steel', '#B8B8B8', 'metal', 'metal'),
  F('black-stone', 'Black stone', '#1B1B1D', 'granite', 'stone'),
  F('white-stone', 'White stone', '#E9E6E0', 'gloss', 'stone'),
  F('tile-beige-gloss', 'Glossy beige tile', '#F2E3CA', 'gloss', 'tile'),
  F('tile-ivory-gloss', 'Glossy ivory tile', '#ECE4D6', 'gloss', 'tile'),
  F('tile-grey', 'Soft grey tile', '#C9C6C0', 'gloss', 'tile'),
  F('tile-stone', 'Light stone tile', '#B6B3AA', 'gloss', 'tile'),
  F('tile-stone-grey', 'Mid stone-grey tile', '#A9A7A1', 'gloss', 'tile'),
  F('tile-sand', 'Sand tile', '#D8C9AE', 'gloss', 'tile'),
];
export const FINISHES: Record<string, FinishDef> = Object.fromEntries(FINISH_LIST.map((f) => [f.id, f]));

/** The viewer's palette ids as style finishes: the material kind each group is made of. */
function fromSwatch(s: Swatch): FinishDef {
  const material: MatKey = s.group === 'wood' ? 'wood'
    : s.group === 'laminate' ? 'laminate'
      : s.group === 'fabric' ? 'weave'
        : s.group === 'bedding' ? 'quilt'
          : s.id === 'metal-black' ? 'blackMetal' : s.id === 'metal-steel' ? 'metal' : 'brass';
  const kind: FinishKind = s.group === 'bedding' ? 'fabric' : s.group;
  // white "wood" is a white laminate, not a grain
  return { id: s.id, name: s.name, colour: s.hex, material: s.id === 'wood-white' ? 'laminate' : material, kind };
}

/** A finish by id from either table (the style table first); null for an unknown id. */
export function finishDef(id: string | undefined | null): FinishDef | null {
  if (!id) return null;
  const own = FINISHES[id];
  if (own) return own;
  const s = swatch(id);
  return s ? fromSwatch(s) : null;
}
/** true when `id` names a finish in either table */
export const knownFinish = (id: unknown): id is string => typeof id === 'string' && finishDef(id) !== null;

/** ids of one kind from the style table, for a picker */
export function finishesOfKind(kind: FinishKind): FinishDef[] {
  return FINISH_LIST.filter((f) => f.kind === kind);
}
