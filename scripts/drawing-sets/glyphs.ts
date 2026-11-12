// C12a: a small single-stroke font for exploded-CAD text (SPEC 17.10 "stroke text"). The glyph shapes are written here in
// the manner of the Hershey Simplex face; they are not the Hershey data (C12b brings the public-domain templates). Three
// faces: simplex (one line), duplex (each line doubled) and complex (serifs on stroke ends).
import type { Font } from './types';

/** Glyph box: x 0..4, y 0..6 (y up). Each glyph is a list of polylines. */
const G: Record<string, number[][][]> = {};
const def = (ch: string, spec: string): void => {
  G[ch] = spec.split(';').map((p) => p.trim().split(/\s+/).map((pt) => pt.split(',').map(Number)));
};
def('0', '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0');
def('1', '0.8,4.6 2,6 2,0; 1,0 3,0');
def('2', '0,5 1,6 3,6 4,5 4,4 0,0 4,0');
def('3', '0,5 1,6 3,6 4,5 4,4 3,3 1.5,3; 3,3 4,2 4,1 3,0 1,0 0,1');
def('4', '3,0 3,6 0,2 4,2');
def('5', '4,6 0,6 0,3 3,3 4,2 4,1 3,0 1,0 0,1');
def('6', '3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2 3,3 0,3');
def('7', '0,6 4,6 1,0');
def('8', '1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3');
def('9', '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,4 1,3 4,3');
def("'", '2.2,6 1.7,3.8');
def('"', '1,6 0.8,4; 2.8,6 2.6,4');
def('-', '0.5,3 3.5,3');
def('.', '1.6,0 2.4,0 2.4,0.8 1.6,0.8 1.6,0');
def('/', '0,0 4,6');
def(',', '2,0.6 2,0 1.5,-0.8');
def('=', '0,2 4,2; 0,4 4,4');
def('(', '3,6 1.5,4 1.5,2 3,0');
def(')', '1,6 2.5,4 2.5,2 1,0');
def(':', '2,1 2,1.6; 2,4 2,4.6');
def('½', '0,5 1,6 1,2; 1.8,0 4,3.4; 2.6,3.2 3.6,3.2 3.6,2.2 2.6,2.2 2.6,3.2');
def('×', '0.5,1 3.5,5; 0.5,5 3.5,1');
def('A', '0,0 2,6 4,0; 0.8,2 3.2,2');
def('B', '0,0 0,6 3,6 4,5 4,4 3,3 0,3; 3,3 4,2 4,1 3,0 0,0');
def('C', '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1');
def('D', '0,0 0,6 2,6 4,4 4,2 2,0 0,0');
def('E', '4,6 0,6 0,0 4,0; 0,3 3,3');
def('F', '4,6 0,6 0,0; 0,3 3,3');
def('G', '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2,3');
def('H', '0,0 0,6; 4,0 4,6; 0,3 4,3');
def('I', '1,0 3,0; 2,0 2,6; 1,6 3,6');
def('J', '4,6 4,1 3,0 1,0 0,1');
def('K', '0,0 0,6; 4,6 0,2; 1.5,3.5 4,0');
def('L', '0,6 0,0 4,0');
def('M', '0,0 0,6 2,3 4,6 4,0');
def('N', '0,0 0,6 4,0 4,6');
def('O', '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0');
def('P', '0,0 0,6 3,6 4,5 4,4 3,3 0,3');
def('Q', '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0; 2.5,1.5 4,0');
def('R', '0,0 0,6 3,6 4,5 4,4 3,3 0,3; 2,3 4,0');
def('S', '4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1');
def('T', '0,6 4,6; 2,6 2,0');
def('U', '0,6 0,1 1,0 3,0 4,1 4,6');
def('V', '0,6 2,0 4,6');
def('W', '0,6 1,0 2,3 3,0 4,6');
def('X', '0,6 4,0; 0,0 4,6');
def('Y', '0,6 2,3 4,6; 2,3 2,0');
def('Z', '0,6 4,6 0,0 4,0');

export const GLYPH_ADVANCE = 5.2;
export const GLYPH_SPACE = 3;

export function hasGlyph(ch: string): boolean { return G[ch.toUpperCase()] !== undefined || ch === ' '; }
/** String width in glyph units (4 wide glyph + gap), before scaling. */
export function glyphUnits(str: string): number {
  let w = 0;
  for (const ch of str) w += ch === ' ' ? GLYPH_SPACE : G[ch.toUpperCase()] ? GLYPH_ADVANCE : GLYPH_SPACE;
  return w;
}

export interface StrokeTextOpts { capH: number; font: Font; slantDeg: number; widthScale: number; rot: number }
/**
 * Polylines (x right, y down, origin at the baseline start) for a string, rotated by `rot` degrees on screen (0 reads to
 * the right, -90 reads upward). Lowercase is drawn as small capitals.
 */
export function strokeText(str: string, ox: number, oy: number, o: StrokeTextOpts): { pts: [number, number][]; closed: boolean }[] {
  const out: { pts: [number, number][]; closed: boolean }[] = [];
  const s = o.capH / 6;
  const slant = Math.tan((o.slantDeg * Math.PI) / 180);
  const cos = Math.cos((o.rot * Math.PI) / 180), sin = Math.sin((o.rot * Math.PI) / 180);
  let pen = 0;
  const place = (gx: number, gy: number, scale: number): [number, number] => {
    const lx = pen + (gx + slant * gy) * s * o.widthScale * scale;
    const ly = -gy * s * scale;
    return [ox + lx * cos - ly * sin, oy + lx * sin + ly * cos];
  };
  const emit = (poly: number[][], scale: number, dx: number, dy: number): void => {
    const pts = poly.map(([gx, gy]) => place(gx + dx, gy + dy, scale));
    out.push({ pts, closed: false });
  };
  for (const ch of str) {
    const lower = ch !== ch.toUpperCase();
    const sc = lower ? 0.78 : 1;
    const g = G[ch.toUpperCase()];
    if (!g) { pen += GLYPH_SPACE * s * o.widthScale; continue; }
    for (const poly of g) {
      emit(poly, sc, 0, 0);
      if (o.font === 'duplex') emit(poly, sc, 0.28, 0);
      if (o.font === 'complex') {
        // serifs: a short cross-stroke at both ends of every polyline
        for (const e of [poly[0], poly[poly.length - 1]]) emit([[e[0] - 0.45, e[1]], [e[0] + 0.45, e[1]]], sc, 0, 0);
      }
    }
    pen += GLYPH_ADVANCE * s * o.widthScale * sc;
  }
  return out;
}
