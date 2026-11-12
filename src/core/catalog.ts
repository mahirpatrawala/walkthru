import type { AccessRule, Box, CatalogItem, FurnitureItem, FurnitureKind, Side } from '../types';

const BED_ACCESS: AccessRule[] = [{ sides: ['left', 'right'], minM: 0.6, mode: 'any' }];
const BED_WORDS: Record<Side, string> = {
  front: 'at the foot', back: 'at the head', left: 'on the left', right: 'on the right',
};
const SOFA_WORDS: Record<Side, string> = {
  front: 'in front', back: 'behind', left: 'on the left', right: 'on the right',
};
const DINING_WORDS: Record<Side, string> = {
  front: 'on the near side', back: 'on the far side', left: 'on the left', right: 'on the right',
};

function bed(id: string, name: string, sizeLabel: string, fw: number, fd: number, iw: number, id_: number): CatalogItem {
  return {
    id, kind: 'bed', name, sizeLabel,
    footprint: { w: fw, d: fd }, heightM: 0.9, surfaceHeightM: 0.5,
    inner: { w: iw, d: id_ },
    access: BED_ACCESS.map(copyRule), sideWords: { ...BED_WORDS },
  };
}

function copyRule(r: AccessRule): AccessRule {
  return { sides: [...r.sides], minM: r.minM, mode: r.mode };
}

/** SPEC 4.4. Beds are Indian mattress sizes; the footprint adds a 5 cm frame all round. */
export const CATALOG: CatalogItem[] = [
  bed('bed-single', 'Single bed', '91 × 183 cm (36 × 72 in)', 1.01, 1.93, 0.91, 1.83),
  bed('bed-double', 'Double bed', '122 × 183 cm (48 × 72 in)', 1.32, 1.93, 1.22, 1.83),
  bed('bed-queen', 'Queen bed', '152 × 198 cm (60 × 78 in)', 1.62, 2.08, 1.52, 1.98),
  bed('bed-king', 'King bed', '183 × 198 cm (72 × 78 in)', 1.93, 2.08, 1.83, 1.98),
  {
    id: 'sofa-3', kind: 'sofa', name: '3-seat sofa', sizeLabel: '210 × 90 cm',
    footprint: { w: 2.1, d: 0.9 }, heightM: 0.85, surfaceHeightM: 0.43,
    access: [{ sides: ['front'], minM: 0.75, mode: 'all' }], sideWords: { ...SOFA_WORDS },
  },
  {
    id: 'dining-6', kind: 'dining', name: '6-seat dining table', sizeLabel: '180 × 90 cm table',
    footprint: { w: 1.8, d: 1.7 }, heightM: 0.95, surfaceHeightM: 0.75,
    access: [{ sides: ['front', 'back'], minM: 0.6, mode: 'all' }], sideWords: { ...DINING_WORDS },
  },
  {
    id: 'wardrobe-2', kind: 'wardrobe', name: '2-door wardrobe', sizeLabel: '120 × 60 × 210 cm',
    footprint: { w: 1.2, d: 0.6 }, heightM: 2.1, surfaceHeightM: 2.1,
    access: [{ sides: ['front'], minM: 0.9, mode: 'all' }], sideWords: { ...SOFA_WORDS },
  },
];

/** Defaults for broker-tagged real items (SPEC 4.4). */
export const REAL_ITEM_DEFAULTS: Record<FurnitureKind, { heightM: number; surfaceHeightM: number }> = {
  bed: { heightM: 0.55, surfaceHeightM: 0.5 },
  sofa: { heightM: 0.85, surfaceHeightM: 0.43 },
  counter: { heightM: 0.85, surfaceHeightM: 0.85 },
  wardrobe: { heightM: 2.1, surfaceHeightM: 2.1 },
  dining: { heightM: 0.95, surfaceHeightM: 0.75 },
};

export function catalogItem(id: string): CatalogItem {
  const item = CATALOG.find((c) => c.id === id);
  if (!item) throw new Error(`Unknown catalogue item: ${id}`);
  return item;
}

function cm(m: number): number {
  return Math.round(m * 100);
}

/**
 * The catalogue entry for an item with a `catalogId`; otherwise a synthesised entry (real items,
 * 4.4): size and heights from the item itself, access rules and side words from the first
 * catalogue item of its kind. Counters have no catalogue entry, so they get "all of front >= 0.90"
 * with the sofa's side words.
 */
export function specFor(item: FurnitureItem): CatalogItem {
  if (item.catalogId) {
    const found = CATALOG.find((c) => c.id === item.catalogId);
    if (found) return found;
  }
  const first = CATALOG.find((c) => c.kind === item.kind);
  const access: AccessRule[] = first
    ? first.access.map(copyRule)
    : [{ sides: ['front'], minM: 0.9, mode: 'all' }];
  const sideWords: Record<Side, string> = first ? { ...first.sideWords } : { ...SOFA_WORDS };
  const spec: CatalogItem = {
    id: item.catalogId ?? `real-${item.kind}`,
    kind: item.kind,
    name: item.label,
    sizeLabel: `${cm(item.box.w)} × ${cm(item.box.d)} cm`,
    footprint: { w: item.box.w, d: item.box.d },
    heightM: item.heightM,
    surfaceHeightM: item.surfaceHeightM,
    access,
    sideWords,
  };
  if (item.inner) spec.inner = { ...item.inner };
  return spec;
}

let seq = 0;

/** A new furniture item from a catalogue entry. The id is unique within the session. */
export function itemFromCatalog(id: string, box: Box, source: 'real' | 'virtual'): FurnitureItem {
  const spec = catalogItem(id);
  seq += 1;
  const item: FurnitureItem = {
    id: `${spec.id}-${Date.now().toString(36)}${seq.toString(36)}`,
    source,
    kind: spec.kind,
    catalogId: spec.id,
    label: spec.name,
    box: { ...box },
    heightM: spec.heightM,
    surfaceHeightM: spec.surfaceHeightM,
  };
  if (spec.inner) item.inner = { ...spec.inner };
  return item;
}
