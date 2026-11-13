// C12c. Notes, legends and title blocks are text, not rooms. A block is notes matter when its words are drafting boilerplate
// (the title-block lexicon, the notes words of the elevation lexicon) or its shape is a paragraph: several lines, or long ones.
// Used by the importer so a general-notes paragraph never becomes a room label and never claims a space as a room.
import tb from './lexicon/titleblock.json';
import type { LabelBlock } from '../import/labels';
import { pageKindWords } from './lexicon';

const WORDS: string[] = (tb as { words: string[] }).words.map((w) => w.toLowerCase());
const wordRe = (w: string): RegExp => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
const RES = WORDS.map(wordRe);

export function isNotesText(text: string): boolean {
  const t = text.toLowerCase();
  if (RES.some((r) => r.test(t))) return true;
  return pageKindWords(text).some((k) => k === 'notes');
}

/** A text block that is notes, legend or title-block matter. */
export function isNotesBlock(b: LabelBlock): boolean {
  const lines = b.lines.map((l) => l.text);
  const all = lines.join(' ');
  if (isNotesText(all)) return true;
  // paragraph shape: four or more lines, or one very long line, or a sentence ("all dimensions in ...", "do not scale ...")
  if (lines.length >= 4) return true;
  if (lines.some((l) => l.length > 48)) return true;
  if (/\b(all|do not|dimensions|unless|refer|to be|shall|must)\b/i.test(all) && all.split(/\s+/).length >= 5) return true;
  return false;
}
