// C12c: notes, legends and title blocks never become room labels.
import { describe, expect, it } from 'vitest';
import { groupTextBlocks } from '../src/import/labels';
import { isNotesBlock } from '../src/understand/notes-block';
import type { VText } from '../src/import/types';

const lines = (strs: string[]): VText[] => strs.map((str, i) => ({ str, x: 100, y: 100 + i * 8, width: str.length * 3, size: 5, angle: 0 }));
const blocks = (strs: string[]) => groupTextBlocks(lines(strs));

describe('notes blocks', () => {
  it('a general-notes paragraph and a title-block block are notes', () => {
    expect(blocks(['NOTES', 'ALL DIMENSIONS IN MILLIMETRE', 'DO NOT SCALE FROM THIS DRAWING', 'FOR DISCUSSION ONLY']).every(isNotesBlock)).toBe(true);
    expect(blocks(['DRAWN BY', 'CHECKED BY']).every(isNotesBlock)).toBe(true);
  });
  it('a room label with a size is not', () => {
    expect(blocks(['KITCHEN', "9'0\"X10'0\""]).some(isNotesBlock)).toBe(false);
    expect(blocks(['BED ROOM']).some(isNotesBlock)).toBe(false);
  });
});
