// Dabs for a ground with no end: grids of small squares round the eye, each square holding dabs that are only its
// number. Every dab belongs to one finest square for good, so its place, direction and colour never change; with
// distance, one dab in four (then one in sixteen, and so on) is drawn larger to stand for its neighbours, and as
// the eye nears it shrinks back while the others grow in round it. Nothing is stored and nothing is swapped.
//
// A ground gives `body`, GLSL for makeDab, which calls ringCell (which square am I?) and ringGrow (how whole, and
// how much larger than true size things are at this distance). See the forest floor in src/world/floor.js.
import * as THREE from 'three';
import { dabMaterial, dabGeometry, dabMesh } from './dabs.js';

// The squares are drawn as grids round the eye, one grid a level, each level's squares twice the last's. A square
// of a level stands for one finest square inside it, found by choosing one of its four quarters, then one of that
// quarter's, and so on down. A square that its own parent chose is left to the parent's level to draw, so every
// dab is drawn by exactly one level: the coarsest that chose it.
export const RING = (n) => /* glsl */ `
uniform float uCell;   // this level's square of ground
uniform float uCell0;  // the finest square
uniform vec2 uOrigin;
uniform float uLevel;
uniform float uTop;
uniform float uNear;   // within this, everything is drawn at its true size
const float RN = ${n}.0;
// each: every dab of a square has its own descent (a carpet); otherwise they share it (the fronds of one clump)
bool ringCell(float salt, bool each, out vec2 cell, out float sub) {
  float id = float(gl_InstanceID);
  sub = floor(id / (RN * RN));
  float k = id - sub * RN * RN;
  vec2 block = uOrigin + vec2(mod(k, RN), floor(k / RN)) - RN * 0.5;
  float s = salt + (each ? sub * 17.0 : 0.0);
  if (uLevel < uTop - 0.5) {
    vec2 parent = floor(block * 0.5);
    vec2 pick = parent * 2.0 + step(0.5, hash4(parent, s + (uLevel + 1.0) * 3.3).xy);
    if (pick == block) return false;
  }
  cell = block;
  for (float i = uLevel; i > 0.5; i -= 1.0) cell = cell * 2.0 + step(0.5, hash4(cell, s + i * 3.3).xy);
  return true;
}
// How whole a dab of this level is at this distance, and (lod) how many times its true size things there are drawn.
float ringGrow(float dist, out float lod) {
  lod = max(dist / uNear, 1.0);
  if (uLevel > uTop - 0.5) return 1.0 - smoothstep(0.86, 1.0, dist / (RN * 0.5 * uCell));
  return smoothstep(0.0, 1.0, uLevel + 1.0 - log2(lod));
}
`;

export function groundRings(shared, { head = '', body, per, n, cell0, levels, minPx, maxPx, cells }) {
  const group = new THREE.Group();
  const geometry = dabGeometry(n * n * per);
  const list = [];
  for (let k = 0; k < levels; k++) {
    const cell = cell0 * 2 ** k;
    const material = dabMaterial(shared, {
      head: head + RING(n), body, minPx, maxPx, cells,
      uniforms: {
        uCell: { value: cell }, uCell0: { value: cell0 }, uOrigin: { value: new THREE.Vector2() }, uLevel: { value: k }, uTop: { value: levels - 1 },
        // a level's grid has to reach as far as its dabs are drawn: twice as far with each level
        uNear: { value: (n * cell0 / 4) * 0.92 },
      },
    });
    const mesh = dabMesh(geometry, material, 2);
    group.add(mesh);
    list.push({ cell, material });
  }
  return {
    group,
    follow(x, z) { for (const l of list) l.material.uniforms.uOrigin.value.set(Math.floor(x / l.cell), Math.floor(z / l.cell)); },
  };
}
