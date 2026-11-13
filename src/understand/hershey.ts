// C12b. SPEC 17.3 / 17.5 item 2: the Hershey stroke fonts as glyph templates and as a renderer. Pure TypeScript.
// The data (hershey-data.ts) is the public-domain Hershey distribution, pinned to one commit with each file's sha256 recorded.
// Glyph space: x right from the glyph's left bound, y UP from the baseline, capital height 21 units (Hershey's own scale).
import { HERSHEY_FACES, HERSHEY_SOURCE } from './hershey-data';

export type Face = 'simplex' | 'duplex' | 'complex';
export const FACES: Face[] = ['simplex', 'duplex', 'complex'];
/** Capital height in glyph units. */
export const CAP_H = 21;
/** y of the x-height line, for the lowercase of these faces (about 14 units). */
export const X_H = 14;
export type Poly = [number, number][];
export interface HGlyph { ch: string; advance: number; strokes: Poly[]; /** ink box in glyph units */ box: [number, number, number, number] }

export { HERSHEY_SOURCE };
/** What the glyph data was built from, for the record (also printed by the evaluation). */
export const hersheyProvenance = (): { source: typeof HERSHEY_SOURCE; faces: { face: string; file: string; sha256: string; glyphs: number }[] } => ({
  source: HERSHEY_SOURCE,
  faces: Object.entries(HERSHEY_FACES).map(([face, f]) => ({ face, file: f.file, sha256: f.sha256, glyphs: Math.min(95, f.lines.length) })),
});

const R = 'R'.charCodeAt(0);
const num = (s: string): number => parseInt(s.trim(), 10);

/** One jhf line: 5 chars glyph number, 3 chars vertex count, then coordinate pairs, each char = code - 'R'. " R" lifts the pen. */
function parseLine(line: string, ch: string): HGlyph {
  const n = num(line.slice(5, 8));
  const body = line.slice(8);
  const left = body.charCodeAt(0) - R, right = body.charCodeAt(1) - R;
  const strokes: Poly[] = [];
  let cur: Poly = [];
  for (let k = 1; k < n; k++) {
    const a = body[2 * k], b = body[2 * k + 1];
    if (a === ' ' && b === 'R') { if (cur.length) strokes.push(cur); cur = []; continue; }
    cur.push([a.charCodeAt(0) - R - left, 9 - (b.charCodeAt(0) - R)]);
  }
  if (cur.length) strokes.push(cur);
  const pts = strokes.flat();
  const box: HGlyph['box'] = pts.length ? [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] : [0, 0, 0, 0];
  return { ch, advance: right - left, strokes, box };
}

const cache = new Map<string, Map<string, HGlyph>>();

/** A combined fraction glyph (the Hershey ASCII sets have none): numerator, slash, denominator. */
function fraction(base: Map<string, HGlyph>, num_: string, den: string, ch: string): HGlyph {
  const put = (g: HGlyph, s: number, dx: number, dy: number): Poly[] => g.strokes.map((st) => st.map(([x, y]) => [x * s + dx, y * s + dy] as [number, number]));
  const n = base.get(num_)!, d = base.get(den)!;
  const s = 0.5;
  const strokes: Poly[] = [...put(n, s, 0, 11), [[6, 0], [15, 21]], ...put(d, s, 11, 0)];
  const pts = strokes.flat();
  return { ch, advance: 22, strokes, box: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] };
}

export function fontOf(face: Face): Map<string, HGlyph> {
  let m = cache.get(face);
  if (m) return m;
  const src = HERSHEY_FACES[face];
  m = new Map();
  src.lines.slice(0, 95).forEach((line, i) => { const ch = String.fromCharCode(32 + i); m!.set(ch, parseLine(line, ch)); });
  m.set('½', fraction(m, '1', '2', '½'));
  m.set('¼', fraction(m, '1', '4', '¼'));
  m.set('¾', fraction(m, '3', '4', '¾'));
  m.set('×', m.get('x')!);
  cache.set(face, m);
  return m;
}

/** Every character the reader holds a template for. */
export const templateChars = (face: Face = 'simplex'): string[] => [...fontOf(face).keys()].filter((c) => c !== ' ' && c !== '×');
export const hasGlyph = (ch: string, face: Face = 'simplex'): boolean => fontOf(face).has(ch);
const GAP_FRACTION = 0.15;
/** The advance of a space, in glyph units. */
export const SPACE_ADVANCE = 14;
const advanceOf = (face: Face, ch: string): number => { const g = fontOf(face).get(ch); return g ? g.advance : SPACE_ADVANCE; };
void GAP_FRACTION;

export interface StrokeOpts { capH: number; face: Face; slantDeg: number; widthScale: number }
/** Width of a string in the same units as capH. */
export function stringWidth(str: string, o: StrokeOpts): number {
  const s = o.capH / CAP_H;
  let w = 0;
  for (const ch of str) w += advanceOf(o.face, ch) * s * o.widthScale;
  return w;
}
/**
 * Polylines of a string in a local frame: x right, y UP, origin at the baseline start. Unknown characters advance as a space.
 * Slant shears x by tan(slant) per unit of height; widthScale stretches x.
 */
export function layoutString(str: string, o: StrokeOpts, warp?: (p: [number, number], ch: string) => [number, number]): Poly[] {
  const s = o.capH / CAP_H;
  const shear = Math.tan((o.slantDeg * Math.PI) / 180);
  const out: Poly[] = [];
  let pen = 0;
  const font = fontOf(o.face);
  for (const ch of str) {
    const g = font.get(ch);
    if (!g) { pen += SPACE_ADVANCE * s * o.widthScale; continue; }
    for (const st of g.strokes) {
      out.push(st.map((p0) => {
        const p = warp ? warp(p0, ch) : p0;
        return [pen + (p[0] + shear * p[1]) * s * o.widthScale, p[1] * s] as [number, number];
      }));
    }
    pen += g.advance * s * o.widthScale;
  }
  return out;
}

/**
 * A seeded distortion of a face, standing in for a font the templates do not hold (SPEC 17.12 item 4). Each glyph gets a
 * smooth warp (a gentle sine bend in x and y) and a different stroke curvature, strong enough that template distances rise
 * but a person still reads it. Same seed, same warp.
 */
export function distortion(seed: number, amount = 1): (p: [number, number], ch: string) => [number, number] {
  const hash = (n: number): number => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
  return (p, ch) => {
    const c = ch.charCodeAt(0);
    const ax = (hash(seed * 131 + c) - 0.5) * 2, ay = (hash(seed * 137 + c) - 0.5) * 2, ph = hash(seed * 151 + c) * 6.28;
    const f = amount * 1.0;
    return [p[0] + f * (1.7 * Math.sin(p[1] * 0.28 + ph) + 1.6 * ax * (p[1] / CAP_H)), p[1] + f * (1.4 * Math.sin(p[0] * 0.33 + ph * 0.7) + 1.3 * ay * (p[0] / 12))];
  };
}
