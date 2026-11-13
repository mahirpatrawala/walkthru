// C12b. Is a string the kind of thing a drawing says? Shared by the glyph reader (which only takes strokes away from the linework for
// strings that pass) and the page-level text step. Lengths, sizes, areas, numbers, or words the lexicons know. Pure TypeScript.
import { findArea, findSize, parseLengthLoose } from './units';
import { fixtureClassOf, furnitureOf, isRoomLabel, pageKindWords, tokens } from './lexicon';

const LOOKALIKE: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', S: '5', B: '8', Z: '2' };
/** In a string that is otherwise digits and length marks, a letter that looks like a digit is the digit (a glyph reader cannot tell 0 from O alone). */
export function numericRepair(str: string): string {
  if (!/\d|['"]/.test(str)) return str;
  const rest = str.replace(/[OolISBZ]/g, '');
  if (!/^[\d'"\-./½¼¾ xXmM]*$/.test(rest) || !/[\d'"]/.test(rest)) return str;
  return str.replace(/[OolISBZ]/g, (c) => LOOKALIKE[c]);
}

export function plausibleText(str: string, meanDistance = 0): boolean {
  const s = str.trim();
  if (s.length < 2) return false;
  if (numericRepair(s) !== s && plausibleText(numericRepair(s), meanDistance)) return true;
  if (parseLengthLoose(s) || findSize(s) || findArea(s)) return true;
  if (/^[\d'"\-./½¼¾ xX×]+$/.test(s) && /\d/.test(s)) return true;
  const t = tokens(s);
  if (isRoomLabel(s) || furnitureOf(s, false) || fixtureClassOf(s) || pageKindWords(s, false).length) return true;
  // ordinary words: letters only, set in a clean hand
  // (three letters or more with a vowel: two looped quote marks read as `jj` are not a word)
  return meanDistance <= 0.05 && t.length > 0 && t.every((w) => /^[a-z]{3,}$/i.test(w) && /[aeiouy]/i.test(w));
}
