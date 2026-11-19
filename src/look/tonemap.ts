// SPEC 16.26. The tone curve of the tiers that have no post-processing chain (low, and a phone's medium).
// The high chain (post.ts) tone maps with ACES and then pulls the mid-tones apart (grade effect: contrast about 18% grey), which is what gives a room
// clean bright whites and dark corners instead of a grey-white wash. A material cannot run that second step with three's own ACES, so the same two
// steps are written once as three's CustomToneMapping hook: ACES, then a mild contrast about the mean of a lit interior. One shader function, no pass, no texture:
// free on every tier. `installTierToneMap()` is a no-op (and says so) when three's chunk is not the one this knows, and the plain ACES stays.
import * as THREE from 'three';

/** contrast about 18% grey after ACES, on the tiers that have no grade pass (the grade's own contrast on the others is stronger, it has AO behind it) */
export const TIER_CONTRAST = 1.2;
/** the same pivot as the grade pass of the high chain (post.ts CONTRAST_PIVOT) */
export const TIER_PIVOT = 0.42;

const NEEDLE = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
let state: 'unknown' | 'ok' | 'unsupported' = 'unknown';

export function installTierToneMap(): boolean {
  if (state !== 'unknown') return state === 'ok';
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  if (typeof chunk !== 'string' || !chunk.includes(NEEDLE) || !chunk.includes('ACESFilmicToneMapping')) { state = 'unsupported'; return false; }
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(NEEDLE, `vec3 CustomToneMapping( vec3 color ) {\n\tcolor = ACESFilmicToneMapping( color );\n\tfloat l1 = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );\n\tfloat l2 = l1 > ${TIER_PIVOT.toFixed(3)} ? ( l1 - ${TIER_PIVOT.toFixed(3)} ) * ${TIER_CONTRAST.toFixed(3)} + ${TIER_PIVOT.toFixed(3)} : ${TIER_PIVOT.toFixed(3)} * pow( l1 / ${TIER_PIVOT.toFixed(3)}, ${TIER_CONTRAST.toFixed(3)} );\n\treturn l1 > 1e-4 ? color * ( l2 / l1 ) : color;\n}`);
  state = 'ok';
  return true;
}
