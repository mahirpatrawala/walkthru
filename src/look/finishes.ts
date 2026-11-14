// Owned by furnish-edit. The finish palette: pure data and lookups, no three.js, so the buyer UI, the mesh generators and the
// tests all read the same table. `FurnitureItem.finish` (src/types.ts) holds ids from this file, never colours and never sizes.
//
// Honesty (SPEC 16.2): a finish is the viewer's own choice of look. It never changes a box, a height or a fit verdict, and on a
// piece that came with the home it is stored in "My layout" (the per-viewer overlay), never in the property.
import type { FurnitureItem } from '../types';

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

export type FinishFamily = 'bed' | 'sofa' | 'wardrobe' | 'table' | 'chair';
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
};

export const FAMILY_NAMES: Record<FinishFamily, string> = { bed: 'bed', sofa: 'sofa', wardrobe: 'wardrobe', table: 'table', chair: 'chair' };

/**
 * Which choices a piece has. A kitchen counter has none: it is a fitted platform with a stone top, not a piece of loose
 * furniture, so it gets no "Change look".
 */
export function finishFamily(item: Pick<FurnitureItem, 'kind' | 'label' | 'catalogId'> & { box?: { w: number; d: number } }): FinishFamily | null {
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
