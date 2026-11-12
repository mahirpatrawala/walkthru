import { describe, expect, it } from 'vitest';
import { CATALOG, catalogItem, itemFromCatalog, specFor } from '../src/core/catalog';
import type { FurnitureItem } from '../src/types';

const BED_WORDS = { front: 'at the foot', back: 'at the head', left: 'on the left', right: 'on the right' };
const SOFA_WORDS = { front: 'in front', back: 'behind', left: 'on the left', right: 'on the right' };

describe('catalogue matches SPEC 4.4 exactly', () => {
  const beds = [
    ['bed-single', 'Single bed', '91 × 183 cm (36 × 72 in)', 1.01, 1.93, 0.91, 1.83],
    ['bed-double', 'Double bed', '122 × 183 cm (48 × 72 in)', 1.32, 1.93, 1.22, 1.83],
    ['bed-queen', 'Queen bed', '152 × 198 cm (60 × 78 in)', 1.62, 2.08, 1.52, 1.98],
    ['bed-king', 'King bed', '183 × 198 cm (72 × 78 in)', 1.93, 2.08, 1.83, 1.98],
  ] as const;
  it('has seven items in table order', () => {
    expect(CATALOG.map((c) => c.id)).toEqual(['bed-single', 'bed-double', 'bed-queen', 'bed-king', 'sofa-3', 'dining-6', 'wardrobe-2']);
  });
  for (const [id, name, label, fw, fd, iw, idp] of beds) {
    it(id, () => {
      expect(catalogItem(id)).toEqual({
        id, kind: 'bed', name, sizeLabel: label, footprint: { w: fw, d: fd }, heightM: 0.9, surfaceHeightM: 0.5,
        inner: { w: iw, d: idp }, access: [{ sides: ['left', 'right'], minM: 0.6, mode: 'any' }], sideWords: BED_WORDS,
      });
    });
  }
  it('sofa-3', () => {
    expect(catalogItem('sofa-3')).toEqual({
      id: 'sofa-3', kind: 'sofa', name: '3-seat sofa', sizeLabel: '210 × 90 cm', footprint: { w: 2.1, d: 0.9 },
      heightM: 0.85, surfaceHeightM: 0.43, access: [{ sides: ['front'], minM: 0.75, mode: 'all' }], sideWords: SOFA_WORDS,
    });
  });
  it('dining-6', () => {
    expect(catalogItem('dining-6')).toEqual({
      id: 'dining-6', kind: 'dining', name: '6-seat dining table', sizeLabel: '180 × 90 cm table', footprint: { w: 1.8, d: 1.7 },
      heightM: 0.95, surfaceHeightM: 0.75, access: [{ sides: ['front', 'back'], minM: 0.6, mode: 'all' }],
      sideWords: { front: 'on the near side', back: 'on the far side', left: 'on the left', right: 'on the right' },
    });
  });
  it('wardrobe-2', () => {
    expect(catalogItem('wardrobe-2')).toEqual({
      id: 'wardrobe-2', kind: 'wardrobe', name: '2-door wardrobe', sizeLabel: '120 × 60 × 210 cm', footprint: { w: 1.2, d: 0.6 },
      heightM: 2.1, surfaceHeightM: 2.1, access: [{ sides: ['front'], minM: 0.9, mode: 'all' }], sideWords: SOFA_WORDS,
    });
  });
  it('unknown id throws', () => {
    expect(() => catalogItem('nope')).toThrow(/nope/);
  });
});

describe('specFor and itemFromCatalog', () => {
  it('itemFromCatalog copies size and heights from the entry', () => {
    const box = { cx: 1, cz: 2, w: 1.93, d: 2.08, yawDeg: 90 };
    const item = itemFromCatalog('bed-king', box, 'virtual');
    expect(item.source).toBe('virtual');
    expect(item.kind).toBe('bed');
    expect(item.catalogId).toBe('bed-king');
    expect(item.label).toBe('King bed');
    expect(item.heightM).toBe(0.9);
    expect(item.surfaceHeightM).toBe(0.5);
    expect(item.inner).toEqual({ w: 1.83, d: 1.98 });
    expect(item.box).toEqual(box);
    expect(itemFromCatalog('bed-king', box, 'virtual').id).not.toBe(item.id);
  });
  it('specFor a catalogue item returns the entry', () => {
    const item = itemFromCatalog('sofa-3', { cx: 0, cz: 0, w: 2.1, d: 0.9, yawDeg: 0 }, 'virtual');
    expect(specFor(item)).toBe(catalogItem('sofa-3'));
  });
  it('specFor a real bed uses its own size and the first bed entry rules', () => {
    const real: FurnitureItem = { id: 'bed-1', source: 'real', kind: 'bed', label: 'Bed',
      box: { cx: 1, cz: 2.25, w: 1.5, d: 2, yawDeg: 90 }, heightM: 0.55, surfaceHeightM: 0.55 };
    const s = specFor(real);
    expect(s.footprint).toEqual({ w: 1.5, d: 2 });
    expect(s.heightM).toBe(0.55);
    expect(s.surfaceHeightM).toBe(0.55);
    expect(s.access).toEqual([{ sides: ['left', 'right'], minM: 0.6, mode: 'any' }]);
    expect(s.sideWords).toEqual(BED_WORDS);
    expect(s.inner).toBeUndefined();
    expect(s.name).toBe('Bed');
  });
  it('specFor a real counter: all of front >= 0.90, sofa words', () => {
    const real: FurnitureItem = { id: 'c', source: 'real', kind: 'counter', label: 'Counter',
      box: { cx: 0, cz: 0, w: 2, d: 0.6, yawDeg: 0 }, heightM: 0.85, surfaceHeightM: 0.85 };
    const s = specFor(real);
    expect(s.access).toEqual([{ sides: ['front'], minM: 0.9, mode: 'all' }]);
    expect(s.sideWords).toEqual(SOFA_WORDS);
  });
});
