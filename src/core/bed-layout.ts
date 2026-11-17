// What lies on a bed, and where a person lies on it. Pure. One place decides both, so every bed builder (the style generator, the classic
// bed, the grey-box bed) puts its pillows where `liePose` (src/core/poses.ts) puts the head.
//
// A bed carries its mattress, a flat quilt and sleeping pillows: two on a mattress 1.2 m wide or more, one on a single. Nothing else
// (no accent cushions, bolsters, throws or runners): a person lies on the whole of the mattress, and anything standing on it would be in them.
//
// Bed-local frame: x along the width, z along the length, the head at -z, the box centred on the origin (as the builders draw it).

/** the deepest headboard any builder draws: the sleeping area starts no nearer the head end of the box than this */
export const BED_HEADBOARD_M = 0.075;
/** a mattress this wide or wider sleeps two: two pillows, and a person lies on the half they came from */
export const BED_TWO_WIDE_M = 1.2;
export const PILLOW_DEPTH_M = 0.4;
/** a sleeping pillow lies flat and low: a head resting on the mattress top sinks into it instead of vanishing behind it */
export const PILLOW_HEIGHT_M = 0.1;
export const PILLOW_MAX_WIDTH_M = 0.66;
/** how far the quilt may stand above the mattress top: a person lies ON it, it never reaches into them */
export const QUILT_PROUD_M = 0.012;
/** crown of the head to the middle of the head */
export const HEAD_CENTRE_M = 0.11;
/** the crown lies this far from the head line when the mattress is long enough */
const CROWN_INSET_M = 0.05;

export interface BedPillow { x: number; z: number; w: number; d: number }
export interface BedLayout {
  /** the mattress a person lies on */
  mw: number; md: number;
  /** where the sleeping area starts (clear of a headboard) and where the mattress ends */
  headZ: number; footZ: number;
  /** pillow footprints (centre and size), one per sleeper */
  pillows: BedPillow[];
  /** the quilt starts here (just clear of the pillows) and runs to the foot */
  quiltZ0: number;
}

type Size = { w: number; d: number };

export function bedLayout(box: Size, inner?: Size): BedLayout {
  const mw = Math.min(inner?.w ?? box.w, box.w), md = Math.min(inner?.d ?? box.d, box.d);
  const headZ = Math.max(-md / 2, -box.d / 2 + BED_HEADBOARD_M), footZ = md / 2;
  const two = mw >= BED_TWO_WIDE_M;
  const pw = Math.min(PILLOW_MAX_WIDTH_M, two ? mw / 2 - 0.05 : mw - 0.1);
  const pd = Math.min(PILLOW_DEPTH_M, Math.max(0.1, (footZ - headZ) / 3));
  const z = headZ + 0.01 + pd / 2;
  const pillows = (two ? [-mw / 4, mw / 4] : [0]).map((x) => ({ x, z, w: pw, d: pd }));
  return { mw, md, headZ, footZ, pillows, quiltZ0: headZ + 0.01 + pd + 0.03 };
}

/**
 * Where the crown of a lying person's head is along the bed (bed-local z), for a person `heightM` tall: 5 cm inside the head line, moved
 * toward the head end of the mattress (never nearer than 5 cm to it) when the feet would otherwise overhang the foot.
 */
export function lieCrownZ(box: Size, inner: Size | undefined, heightM: number): number {
  const L = bedLayout(box, inner);
  return Math.min(L.headZ + CROWN_INSET_M, Math.max(-L.md / 2 + CROWN_INSET_M, L.footZ - heightM));
}

/** Which side of the bed a person lies on (bed-local x), given the side they came from: the middle of a single, a pillow of a double. */
export function lieLateral(box: Size, inner: Size | undefined, approachLateral: number): number {
  const L = bedLayout(box, inner);
  return L.pillows.length < 2 ? 0 : Math.sign(approachLateral) * (L.mw / 4);
}
