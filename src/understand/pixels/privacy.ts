// C12d. SPEC 17.16 item 10: minimal crops only. Two layers.
//   1. Shape: text blocks (title block, notes, legend) are found in the picture and whited out before anything is sent (views.ts).
//   2. Words: a string a model returns that reads like title-block or contact matter is dropped from the answer and counted.
// The lexicon is data (lexicon/titleblock.json), generic drafting words. Never a name.
import T from '../lexicon/titleblock.json';
import { tokens } from '../lexicon';

const PHRASES = (T.words as string[]).map((w) => tokens(w).join(' ')).filter(Boolean);
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const LONG_NUMBER = /\d[\d\s().+-]{7,}\d/;

/** True when a string looks like title-block text, an address, a phone number or an email. */
export function isTitleBlockText(text: string): boolean {
  if (EMAIL.test(text)) return true;
  const m = text.match(LONG_NUMBER);
  if (m && (m[0].match(/\d/g)?.length ?? 0) >= 9 && !/['"]/.test(m[0])) return true;
  const joined = ` ${tokens(text).join(' ')} `;
  return PHRASES.some((p) => joined.includes(` ${p} `));
}
