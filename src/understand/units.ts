// C12a. Unit and number-format parsers, driven by lexicon/units.json (SPEC 17.4 "Units", 17.12 item 3).
// Pure TypeScript. Format decides the unit, not a note on the sheet: a quote mark means feet and inches, a bare integer
// of 3 to 5 digits means millimetres, a decimal with an m marker means metres. `core/units.parseLength` (C0) is left
// alone; this is the tolerant helper SPEC 17.5 asks for.
import U from './lexicon/units.json';
import F from './lexicon/furniture.json';

const M_PER_IN = 0.0254;
export const SQFT_M2 = 0.09290304;
export type LengthKind = 'ftin' | 'inch' | 'mm' | 'cm' | 'm' | 'bare-mm' | 'bare-m' | 'bare-ft';
export interface ParsedLength { m: number; kind: LengthKind; raw: string }

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const byLen = (xs: string[]): string[] => [...xs].sort((a, b) => b.length - a.length);
const alt = (xs: string[]): string => byLen(xs).map(esc).join('|');
/** "sq. ft." -> sq[\s.]*ft\.? : dots and spaces between the pieces are optional */
const loose = (entry: string): string => {
  const pieces = entry.split(/[.\s]+/).filter(Boolean).map(esc);
  return `${pieces.join('[\\s.]*')}\\.?`;
};
const looseAlt = (xs: string[]): string => byLen(xs).map(loose).join('|');

const FRAC: Record<string, number> = U.fractionGlyphs;
const FRAC_CLASS = Object.keys(FRAC).join('');
const NUM = '\\d+(?:\\.\\d+)?';
const SLASH_FRAC = '\\d+\\s*\\/\\s*\\d+';
const INCH_VAL = `(?:${NUM}(?:\\s*(?:${SLASH_FRAC}|[${FRAC_CLASS}]))?|${SLASH_FRAC}|[${FRAC_CLASS}])`;
const FEET_MARK = `(?:${alt(U.feet.filter((x) => x !== "'"))}\\b|')`;
const INCH_MARK = `(?:${alt(U.inches.filter((x) => x !== '"'))}\\b|")`;
const METRIC_MARK = `(?:${alt([...U.mm, ...U.cm, ...U.metres])})(?![a-z])`;

const LEN_FTIN = `${NUM}\\s*${FEET_MARK}\\s*-?\\s*(?:${INCH_VAL}\\s*${INCH_MARK}?)?`;
const LEN_INCH = `${INCH_VAL}\\s*${INCH_MARK}`;
const LEN_METRIC = `${NUM}\\s*${METRIC_MARK}`;
/** one length, any of the formats; the alternation order puts the most specific first */
export const LENGTH_SRC = `(?:${LEN_FTIN}|${LEN_INCH}|${LEN_METRIC}|${NUM})`;
const SEP = `(?:\\s*(?:x|×|\\*)\\s*|\\s+by\\s+)`;
const SIZE_RE = new RegExp(`(${LENGTH_SRC})${SEP}(${LENGTH_SRC})`, 'i');
const AREA_FT_RE = new RegExp(`(${NUM})\\s*(?:${looseAlt(U.areaFeet)})(?![a-z0-9])`, 'i');
const AREA_M_RE = new RegExp(`(${NUM})\\s*(?:${looseAlt(U.areaMetres)})(?![a-z0-9²])`, 'i');

function normalise(text: string): string {
  return text
    .replace(/[‘’′ʹ]/g, "'")
    .replace(/[“”″ʺ]/g, '"')
    .replace(/''/g, '"')
    .replace(/ /g, ' ')
    .trim();
}

/** Inches in one inch-value: "11", "5 1/2", "5½", "1/2" */
function inchesOf(s: string): number | null {
  let t = s.trim();
  if (!t) return 0;
  let total = 0;
  const g = t.match(new RegExp(`[${FRAC_CLASS}]`));
  if (g) { total += FRAC[g[0]]; t = t.replace(g[0], ' ').trim(); }
  const sf = t.match(new RegExp(`(?:(${NUM})\\s+)?(\\d+)\\s*\\/\\s*(\\d+)`));
  if (sf) { total += (sf[1] ? parseFloat(sf[1]) : 0) + parseInt(sf[2], 10) / parseInt(sf[3], 10); t = t.replace(sf[0], ' ').trim(); }
  if (t) { if (!new RegExp(`^${NUM}$`).test(t)) return null; total += parseFloat(t); }
  return total;
}

/**
 * Metres from one length string. `bare` says what a number with no marker means: 'auto' (3 to 5 digit integer =
 * millimetres, anything else = metres), or force 'm', 'mm' or 'ft'.
 */
export function parseLengthLoose(text: string, bare: 'auto' | 'm' | 'mm' | 'ft' = 'auto'): ParsedLength | null {
  const t = normalise(text);
  if (!t) return null;
  let m: RegExpMatchArray | null;
  const fin = new RegExp(`^(${NUM})\\s*${FEET_MARK}\\s*-?\\s*(?:(${INCH_VAL})\\s*${INCH_MARK}?)?$`, 'i');
  if ((m = t.match(fin))) {
    const inch = m[2] ? inchesOf(m[2]) : 0;
    if (inch === null) return null;
    const v = (parseFloat(m[1]) * 12 + inch) * M_PER_IN;
    return v > 0 ? { m: v, kind: 'ftin', raw: text } : null;
  }
  if ((m = t.match(new RegExp(`^(${INCH_VAL})\\s*${INCH_MARK}$`, 'i')))) {
    const inch = inchesOf(m[1]);
    return inch && inch > 0 ? { m: inch * M_PER_IN, kind: 'inch', raw: text } : null;
  }
  if ((m = t.match(new RegExp(`^(${NUM})\\s*(${METRIC_MARK})$`, 'i')))) {
    const v = parseFloat(m[1]); const u = m[2].toLowerCase();
    const isMm = U.mm.includes(u), isCm = U.cm.includes(u);
    const r = isMm ? v / 1000 : isCm ? v / 100 : v;
    return r > 0 ? { m: r, kind: isMm ? 'mm' : isCm ? 'cm' : 'm', raw: text } : null;
  }
  if ((m = t.match(new RegExp(`^(${NUM})$`)))) {
    const v = parseFloat(m[1]);
    if (!(v > 0)) return null;
    const mode = bare === 'auto' ? (/^\d{3,5}$/.test(m[1]) ? 'mm' : 'm') : bare;
    if (mode === 'mm') return { m: v / 1000, kind: 'bare-mm', raw: text };
    if (mode === 'ft') return { m: v * 12 * M_PER_IN, kind: 'bare-ft', raw: text };
    return { m: v, kind: 'bare-m', raw: text };
  }
  return null;
}

const isBare = (s: string): boolean => new RegExp(`^${NUM}$`).test(normalise(s));

/** A pair of lengths "11'0"X12'6"", "3350 x 3660", "3.2 x 2.4 m". A bare part takes the unit of the other part. */
export function parseSizeLoose(text: string): { w: number; l: number } | null {
  const m = normalise(text).match(new RegExp(`^${SIZE_RE.source}$`, 'i'));
  return m ? sizeFromParts(m[1], m[2]) : null;
}
function sizeFromParts(a: string, b: string): { w: number; l: number } | null {
  let bareA: 'auto' | 'm' | 'mm' | 'ft' = 'auto', bareB: 'auto' | 'm' | 'mm' | 'ft' = 'auto';
  if (isBare(a) && !isBare(b)) { const pb = parseLengthLoose(b); if (pb) bareA = pb.kind === 'mm' ? 'mm' : pb.kind === 'ftin' || pb.kind === 'inch' ? 'ft' : 'm'; }
  if (isBare(b) && !isBare(a)) { const pa = parseLengthLoose(a); if (pa) bareB = pa.kind === 'mm' ? 'mm' : pa.kind === 'ftin' || pa.kind === 'inch' ? 'ft' : 'm'; }
  // two bare numbers: both integers of 3+ digits are millimetres, otherwise metres
  const w = parseLengthLoose(a, bareA), l = parseLengthLoose(b, bareB);
  if (!w || !l) return null;
  if (w.kind === 'bare-m' && l.kind === 'bare-m' && (w.m > 60 || l.m > 60)) return null;
  return { w: w.m, l: l.m };
}

/** The first "a x b" size in a string, with where it sits. */
export function findSize(text: string): { w: number; l: number; index: number; length: number } | null {
  const t = normalise(text);
  const m = t.match(SIZE_RE);
  if (!m || m.index === undefined) return null;
  const s = sizeFromParts(m[1], m[2]);
  return s ? { ...s, index: m.index, length: m[0].length } : null;
}
export function stripSize(text: string): string {
  const f = findSize(text);
  return f ? (text.slice(0, f.index) + ' ' + text.slice(f.index + f.length)).replace(/\s+/g, ' ').trim() : text;
}
/** Square metres from "150 SQFT", "150 SQ.FT.", "14 SQ M". */
export function findArea(text: string): { m2: number; index: number; length: number } | null {
  const t = normalise(text);
  const f = t.match(AREA_FT_RE);
  if (f && f.index !== undefined) return { m2: parseFloat(f[1]) * SQFT_M2, index: f.index, length: f[0].length };
  const a = t.match(AREA_M_RE);
  if (a && a.index !== undefined) return { m2: parseFloat(a[1]), index: a.index, length: a[0].length };
  return null;
}

/** True when the string is nothing but a size or an area (a label's dimension line). */
export function isSizeOnly(text: string): boolean {
  const s = normalise(text);
  if (!s) return false;
  const z = findSize(s);
  if (z && (s.slice(0, z.index) + s.slice(z.index + z.length)).trim() === '') return true;
  const a = findArea(s);
  return !!a && (s.slice(0, a.index) + s.slice(a.index + a.length)).trim() === '';
}

// ---------------------------------------------------------------- running length (WARDROBE 9'0" RFT and its kin)
const RUN_MARKERS = F.runningLength.markers;
const RUN_UNIT = (marker: string): 'ft' | 'm' => {
  const k = marker.toLowerCase().replace(/[.\s]+/g, '');
  for (const g of RUN_MARKERS) if (g.words.some((w) => w.toLowerCase().replace(/[.\s/]+/g, '') === k.replace(/\//g, ''))) return g.unit as 'ft' | 'm';
  return 'ft';
};
const RUN_MARK_SRC = `(?:${looseAlt(RUN_MARKERS.flatMap((g) => g.words))})`;
const RUN_AFTER = new RegExp(`(${LENGTH_SRC})\\s*(${RUN_MARK_SRC})(?![a-z])`, 'i');
const RUN_BEFORE = new RegExp(`(?<![a-z])(${RUN_MARK_SRC})\\s*[=:]?\\s*(${LENGTH_SRC})`, 'i');
const RUN_BARE_MARK = new RegExp(`(?<![a-z])${RUN_MARK_SRC}(?![a-z])`, 'i');

/** Metres from a running-length note: 9'0"RFT, 9'0" RFT, 9 R.FT, RFT 9', 2.7 RMT. Null when the text has none. */
export function parseRunningLength(text: string): { m: number; index: number; length: number } | null {
  const t = normalise(text);
  let m = t.match(RUN_AFTER);
  if (m && m.index !== undefined) {
    const unit = RUN_UNIT(m[2]);
    const p = parseLengthLoose(m[1], unit === 'ft' ? 'ft' : 'm');
    if (p) return { m: p.m, index: m.index, length: m[0].length };
  }
  m = t.match(RUN_BEFORE);
  if (m && m.index !== undefined) {
    const unit = RUN_UNIT(m[1]);
    const p = parseLengthLoose(m[2], unit === 'ft' ? 'ft' : 'm');
    if (p) return { m: p.m, index: m.index, length: m[0].length };
  }
  return null;
}
/** True when a running-length marker is present at all (even with no readable number). */
export function hasRunningMarker(text: string): boolean { return RUN_BARE_MARK.test(normalise(text)); }
