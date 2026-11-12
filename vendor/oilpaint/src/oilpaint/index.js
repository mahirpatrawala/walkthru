// Oil paint: a way of drawing a three.js scene as thick oil paint, stroke by stroke. Nothing is filtered after the
// fact; everything in the picture is a dab of the brush pinned to the world. See the README for the idea and
// src/main.js for a whole scene built with it.
//
//   const shared = createShared();                 the sun, wind, mist and maps every dab reads
//   shared.tBrush.value = createBrushSheet();      the brush marks, made in code
//   dabMaterial / dabGeometry / dabMesh            dabs of your own: you write makeDab in GLSL
//   groundRings                                    an endless ground of dabs that never shift as the eye moves
//   pinDabs                                        dabs pinned to any mesh, rigged or not, and carried with it
//   createShade                                    where the sun reaches: the still world once, a moving thing each frame
//   createFrame                                    the canvas: sun in the mist, the weave, the varnish
export { createShared, COMMON, SUN, WIND, EXTENT, LAND_RES } from './common.js';
export { createBrushSheet, BRUSH_COLS, BRUSH_ROWS } from './brush.js';
export { dabMaterial, dabGeometry, dabMesh } from './dabs.js';
export { groundRings, RING } from './ground.js';
export { pinDabs } from './pins.js';
export { createShade } from './shade.js';
export { createFrame } from './finish.js';
