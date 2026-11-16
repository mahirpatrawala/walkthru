// SPEC 16.18: resolution-independent surface detail. Nothing here is a bitmap: every pattern is computed from the position on the surface, in
// metres, so it is as sharp at 30 cm as at 3 m (a photo texture stretched over metres is what made walls, doors and tiles look soft). The
// fine terms fade out where one pixel covers more than the grain (derivatives), which also keeps them from shimmering at a distance.

/** value noise: `lkHash` (0..1) and `lkVN`, a smooth noise of a 2D point (one cell per unit) */
export const GLSL_NOISE = /* glsl */ `
float lkHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lkVN(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lkHash(i), lkHash(i + vec2(1.0, 0.0)), f.x), mix(lkHash(i + vec2(0.0, 1.0)), lkHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

/**
 * Wood grain as a multiplier around 1: `g.x` is metres along the grain, `g.y` metres across it, `fw` the size of a pixel in metres on the
 * surface (fine pores fade out when a pixel is wider than about 2 mm). Streaks stretched 25:1 along the grain at three sizes and a slow
 * warped ring for the figure; the mean is about 1 so a finish's colour stays the mean colour of the surface (SPEC 16.2 rule 2).
 */
export const GLSL_WOOD = /* glsl */ `
float lkWoodTone(vec2 g, float fw) {
  float a = lkVN(vec2(g.x * 2.2, g.y * 55.0));
  float b = lkVN(vec2(g.x * 5.0 + 17.0, g.y * 150.0));
  float c = lkVN(vec2(g.x * 14.0 + 3.0, g.y * 480.0));
  float fade = 1.0 - smoothstep(0.0012, 0.004, fw);
  float ring = sin((g.y * 40.0 + lkVN(vec2(g.x * 1.3, g.y * 9.0)) * 6.0)) * 0.5 + 0.5;
  float t = a * 0.5 + b * 0.32 + c * 0.18 * fade;
  t = mix(t, ring, 0.18);
  return 0.82 + 0.36 * t;
}
`;
