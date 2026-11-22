// SPEC 16.26. The tone curve of the tiers that have no post-processing chain (low, and a phone's medium).
// The high chain (post.ts) tone maps with ACES and then pulls the mid-tones apart (grade effect: contrast about 18% grey), which is what gives a room
// clean bright whites and dark corners instead of a grey-white wash. A material cannot run that second step with three's own ACES, so the same two
// steps are written once as three's CustomToneMapping hook: ACES, then a mild contrast about the mean of a lit interior. One shader function, no pass, no texture:
// free on every tier. `installTierToneMap()` is a no-op (and says so) when three's chunk is not the one this knows, and the plain ACES stays.
import * as THREE from 'three';

/** contrast after ACES, on the tiers that have no grade pass (the grade's own contrast on the others is stronger, it has AO behind it); 1.2 until SPEC 16.27 */
export const TIER_CONTRAST = 1.3;
/** the same pivot as the grade pass of the high chain (post.ts CONTRAST_PIVOT; 0.42 until SPEC 16.27) */
export const TIER_PIVOT = 0.3;
/** the highlight shoulder (linear): a bright wall or a sunlit floor flattens towards it instead of clipping (0.92 until SPEC 16.27, as post.ts; since then the tone mapper's white lands on it) */
export const TIER_SHOULDER = 0.98;

/** SPEC 16.27: how far the tone mapper's white is made to land on the shoulder. The grade pass does it fully by day and not at all in Evening and Night
 *  (grade.ts `curveOf`); this curve is one for every hour (a shader constant), so it goes half way: whites reach sRGB 241 instead of 230, and a night
 *  room lit by its lamps is not washed out on a phone */
export const TIER_WHITE = 0.5;
export function tierNorm(): number { return 1 + ((1 - Math.exp(-((1 - TIER_PIVOT) * TIER_CONTRAST) / (TIER_SHOULDER - TIER_PIVOT))) - 1) * TIER_WHITE; }

const NEEDLE = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
let state: 'unknown' | 'ok' | 'unsupported' = 'unknown';

export function installTierToneMap(): boolean {
  if (state !== 'unknown') return state === 'ok';
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  if (typeof chunk !== 'string' || !chunk.includes(NEEDLE) || !chunk.includes('ACESFilmicToneMapping')) { state = 'unsupported'; return false; }
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(NEEDLE, `vec3 CustomToneMapping( vec3 color ) {\n\tcolor = ACESFilmicToneMapping( color );\n\tfloat l1 = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );\n\tfloat l2 = l1 > ${TIER_PIVOT.toFixed(3)} ? ${TIER_PIVOT.toFixed(3)} + ${(TIER_SHOULDER - TIER_PIVOT).toFixed(3)} * ( 1.0 - exp( -( l1 - ${TIER_PIVOT.toFixed(3)} ) * ${TIER_CONTRAST.toFixed(3)} / ${(TIER_SHOULDER - TIER_PIVOT).toFixed(3)} ) ) / ${tierNorm().toFixed(4)} : ${TIER_PIVOT.toFixed(3)} * pow( l1 / ${TIER_PIVOT.toFixed(3)}, ${TIER_CONTRAST.toFixed(3)} );\n\treturn l1 > 1e-4 ? color * ( l2 / l1 ) : color;\n}`);
  state = 'ok';
  return true;
}
