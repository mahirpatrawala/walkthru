// C12a/C12b: stroke text for exploded-CAD text in the synthetic sets (SPEC 17.10 "stroke text"). C12b swapped the hand-drawn
// stand-in faces for the real public-domain Hershey data (src/understand/hershey): simplex, duplex and complex. A fourth,
// 'distorted', is a seeded warp of simplex that the reader's templates do not contain (SPEC 17.12 item 4); the generator
// never picks it by itself, a test or an eval option asks for it.
import type { Font } from './types';
import { distortion, layoutString, stringWidth } from '../../src/understand/hershey';
import type { StrokeOpts } from '../../src/understand/hershey';

export const hasGlyph = (_ch: string): boolean => true;
const optsOf = (capH: number, font: Font, slantDeg: number, widthScale: number): StrokeOpts => ({ capH, face: font === 'distorted' ? 'simplex' : font, slantDeg, widthScale });
const warpOf = (font: Font): ReturnType<typeof distortion> | undefined => (font === 'distorted' ? distortion(7, 1) : undefined);

/** String width in the same unit as capH. */
export function strokeWidth(str: string, capH: number, font: Font, slantDeg: number, widthScale: number): number {
  return stringWidth(str, optsOf(capH, font, slantDeg, widthScale));
}

export interface StrokeTextOpts { capH: number; font: Font; slantDeg: number; widthScale: number; rot: number }
/**
 * Polylines (x right, y down, origin at the baseline start) for a string, rotated by `rot` degrees on screen (0 reads to
 * the right, -90 reads upward).
 */
export function strokeText(str: string, ox: number, oy: number, o: StrokeTextOpts): { pts: [number, number][]; closed: boolean }[] {
  const cos = Math.cos((o.rot * Math.PI) / 180), sin = Math.sin((o.rot * Math.PI) / 180);
  const local = layoutString(str, optsOf(o.capH, o.font, o.slantDeg, o.widthScale), warpOf(o.font));
  return local.map((poly) => ({
    pts: poly.map(([lx, lyUp]) => { const ly = -lyUp; return [ox + lx * cos - ly * sin, oy + lx * sin + ly * cos] as [number, number]; }),
    closed: false,
  }));
}
