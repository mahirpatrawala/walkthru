import { describe, expect, it } from 'vitest';
import { scoreLabelSet, summariseLabel, blankLabel, addLabel } from '../scripts/eval/label-score';
import type { LabelTruth } from '../scripts/eval/label-score';

const truth: LabelTruth = { schema: 'label-v1', rooms: [
  { name: 'BEDROOM', roomType: 'bedroom', widthM: 3, lengthM: 4, areaM2: 12, printed: ['3.00 x 4.00'] },
  { name: 'TOILET', roomType: 'bathroom', widthM: 1.5, lengthM: 2.4, areaM2: 3.6, printed: ['1.50 x 2.40'] },
  { name: 'FOYER', roomType: 'other', printed: [] },
] };

describe('label-truth scoring', () => {
  it('pairs by size and label, judges verified rooms against the printed size', () => {
    const s = scoreLabelSet({ attempted: true, rooms: [
      { label: 'Bed Room', roomType: 'bedroom', sides: [3, 4], areaM2: 12, status: 'verified', method: 'walls' },
      { label: 'Toilet', roomType: 'bathroom', sides: [1.5, 2.6], areaM2: 3.9, status: 'verified', method: 'walls' },
      { label: 'Foyer', roomType: 'other', sides: [1, 2], areaM2: 2, status: 'unverified', method: 'label-rect' },
    ] }, truth);
    expect(s.matched).toBe(3); expect(s.typed).toBe(3); expect(s.sizeRight).toBe(1);
    expect(s.verified).toEqual({ right: 1, wrong: 1, unjudged: 0 });
    expect(s.wallMatched).toBe(2); expect(s.wallSizeRight).toBe(1);
    expect(s.disagree.n).toBe(1); expect(s.disagree.verified).toBe(1);
  });
  it('a refused input misses every room and judges nothing', () => {
    const s = scoreLabelSet({ attempted: false, error: 'refused', rooms: [] }, truth);
    expect(s.matched).toBe(0); expect(s.missedDetail).toHaveLength(3);
    const t = blankLabel(); addLabel(t, s);
    expect(summariseLabel(t).find((r) => r.key === 'wrongVerified')!.value).toBe('n/a');
  });
  it('a verified room that matches nothing is unjudged, and wrong only in the strict reading', () => {
    const s = scoreLabelSet({ attempted: true, rooms: [{ label: 'Hall', roomType: 'living', sides: [9, 9], areaM2: 81, status: 'verified' }] }, truth);
    expect(s.verified.unjudged).toBe(1); expect(s.verifiedStrict).toEqual({ n: 1, wrong: 1 });
  });
});
