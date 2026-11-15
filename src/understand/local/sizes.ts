// Local raster path, reading printed sizes out of OCR text. OCR garbles the marks of a size most: the foot mark vanishes ("100"" for
// 10'0""), a comma stands for a point, an x comes back as K or %. This turns one OCR line into the sizes it could mean, most likely first.
// The caller never believes one: a candidate is only ever promoted by a geometry check (SPEC 17.5), and one picked from several by
// geometry stays unverified. Pure TypeScript.
import { findArea, parseLengthLoose, parseSizeLoose } from '../units';

const IN = 0.0254;
export interface SizeCand { w: number; l: number; /** 0 = the text says it plainly, higher = a repair */ rank: number; text: string }

export function ocrNormalise(s: string): string {
  return s
    // marks: prime, acute, grave and degree signs stand for the foot mark, double prime and curly quotes for the inch mark
    .replace(/[°º˚]/g, "'").replace(/[‘’′´`]/g, "'").replace(/[“”″‟„]/g, '"').replace(/''/g, '"')
    // PP-OCR writes the dash of 12'-0" as a minus, en dash, CJK dash or a colon-like mark, and the x as a multiplication sign or a look-alike
    .replace(/[−–—‒―一ー‐‑﹣－]/g, '-').replace(/[×✕✖Ⅹ✗хХ]/g, 'x')
    .replace(/[⁺＋﹢]/g, '+')
    .replace(/(\d)\*(?=\s*[xX×%]|\s*$)/g, '$1"')
    // a digit read as a letter, only where the neighbours are digits or marks (never inside a word)
    .replace(/(?<=[\d'"\-.,])[OoQDU](?=[\d'"\-.,xX\s]|$)|(?<=^|\s)[OQ](?=\d)/g, '0')
    .replace(/(?<=[\d'"\-.,])[lI](?=[\d'"\-.,xX\s]|$)|(?<=^|[\s'"\-])[lI](?=\d)/g, '1')
    .replace(/(?<=[\d'"\-.,])[Ss](?=[\d'"\-.,xX\s]|$)|(?<=^|[\s'"x\-])[Ss](?=\d)/g, '5')
    .replace(/(?<=\d)B(?=[\d'"\-.,xX\s]|$)/g, '8')
    // a zero inside a word is an O
    .replace(/(?<=[A-Za-z])0(?=[A-Za-z])/g, 'O')
    // a fraction stuck to the digit before it: "01/2" is 0 and 1/2, "51/2" is 5 and 1/2
    .replace(/(\d)([1-3]\/[2348])(?!\d)/g, '$1 $2')
    .replace(/[|¦_]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Lengths one half of a size could be (metres), most likely first. */
function halfCands(h: string): { m: number; rank: number }[] {
  const t = h.trim();
  const out: { m: number; rank: number }[] = [];
  const add = (m: number, rank: number): void => { if (m > 0.3 && m < 30 && !out.some((o) => Math.abs(o.m - m) < 1e-6)) out.push({ m, rank }); };
  const plain = parseLengthLoose(t);
  if (plain && (plain.kind === 'ftin' || plain.kind === 'mm' || plain.kind === 'm')) add(plain.m, 0);
  if (plain && plain.kind === 'inch') add(plain.m, 4);
  // a decimal with a comma or a space for the point: "3,66", "3 66" is not trusted
  let m = t.match(/^(\d)[.,](\d{2})$/);
  if (m) add(parseFloat(`${m[1]}.${m[2]}`), 0);
  m = t.match(/^(\d{1,2})[.,](\d{1,2})\s*(?:m|mtr)?$/i);
  if (m) add(parseFloat(`${m[1]}.${m[2]}`), 0);
  // millimetres: 3 to 5 plain digits
  if (/^\d{4,5}$/.test(t)) add(parseInt(t, 10) / 1000, 0);
  // feet and inches with a mark lost: "10-0"", "100"", "7'10", "710""
  const q = t.replace(/[\s]+/g, '');
  m = q.match(/^(\d{1,2})['\-](\d{1,2})["'*]?$/);
  if (m && parseInt(m[2], 10) <= 11) add((parseInt(m[1], 10) * 12 + parseInt(m[2], 10)) * IN, 1);
  // the inch mark read as one more digit ("10-22" is 10'-2", "4-81" is 4'-8"): an inch value above 11 whose first digit alone is one
  if (m && parseInt(m[2], 10) > 11 && m[2].length === 2 && /[1279]/.test(m[2][1])) add((parseInt(m[1], 10) * 12 + parseInt(m[2][0], 10)) * IN, 3);
  m = q.match(/^(\d{1,2})["']?$/);
  if (m) { const f = parseInt(m[1], 10); if (f >= 3 && f <= 40) add(f * 12 * IN, 1); }
  m = q.match(/^(\d{2,3})"?$/);
  if (m) {
    const d = m[1];
    // digits with the foot mark lost: first one or two digits are feet, the rest inches (never above 11)
    for (const k of [d.length - 1, d.length - 2]) {
      if (k < 1 || k > 2) continue;
      const ft = parseInt(d.slice(0, k), 10), inch = parseInt(d.slice(k), 10);
      if (ft >= 3 && ft <= 40 && inch <= 11) add((ft * 12 + inch) * IN, 2);
    }
  }
  return out;
}

/** The sizes an OCR string could state ("BEDROOM 12-0" X 100"" -> 12'0" x 10'0"), most likely first. */
export function ocrSizeCandidates(text: string): SizeCand[] {
  const t = ocrNormalise(text);
  const out: SizeCand[] = [];
  const push = (w: number, l: number, rank: number): void => { if (!out.some((o) => Math.abs(o.w - w) < 1e-6 && Math.abs(o.l - l) < 1e-6)) out.push({ w, l, rank, text: t }); };
  // a plain, well-formed size first
  const plain = parseSizeLoose(t);
  if (plain) push(plain.w, plain.l, 0);
  // the size is the last "a x b" in the line: cut out the name in front of it
  const parts = t.split(/\s*[xX×%*]\s*|\s+[kK]\s+/);
  if (parts.length >= 2) {
    // the left half's number is the tail of the first part (a name may precede it); the right half's is the head of the last part
    const left = parts[parts.length - 2].match(/(\d[\d.,'"\-\s/]*)$/);
    const right = parts[parts.length - 1].match(/^(\d[\d.,'"\-/]*(?:\s\d\/\d["']?)?)/);
    if (left && right) {
      const A = halfCands(left[1]), B = halfCands(right[1]);
      for (const a of A) for (const b of B) push(a.m, b.m, a.rank + b.rank);
    }
  }
  // a size glued on with no space: "3.66x3.35"
  const g = t.match(/(\d[.,]\d{2})\s*[xX×%*]\s*(\d[.,]\d{2})/);
  if (g) push(parseFloat(g[1].replace(',', '.')), parseFloat(g[2].replace(',', '.')), 0);
  return out.sort((a, b) => a.rank - b.rank).slice(0, 4);
}

/** A printed area in square metres ("102.08 Sq.m.", "620 SQ.FT"), or null. */
export const ocrArea = (text: string): number | null => findArea(ocrNormalise(text))?.m2 ?? null;
