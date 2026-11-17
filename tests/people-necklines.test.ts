// SPEC 16.6.12 (second pass): nothing near-white at the neck unless the garment is white. The neck band of the woman's top, the elder's tunic and the child's
// T-shirt was a separate cream part (`trim`, #EDE4CF to #F2F0EA) that read as a white strip or as white slivers at the collar on every tint; it now takes the top's
// own colour, a little darker (like the man's collar). Render-free: each garment's resolved colour (material colour times the vertex colour) is compared with
// the top's, and the area of near-white cloth within 5 cm of the neck joint is added up from the GLB's triangles.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { TOP_TINTS, fabricColour, stylePerson } from '../src/look/people-materials';
import type { PersonBody } from '../src/look/people';

const DIR = process.env.PEOPLE_DIR || path.resolve(import.meta.dirname, '../public/characters');
const BODIES: PersonBody[] = ['man', 'woman', 'elder', 'child'];
const have = BODIES.every((b) => fs.existsSync(path.join(DIR, `person-${b}.glb`)) && fs.existsSync(path.join(DIR, `person-${b}-low.glb`)));

function parse(file: string): Promise<GLTF> {
  const buf = fs.readFileSync(path.join(DIR, file));
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  l.register(() => ({ name: 'skip-textures', loadTexture: () => Promise.resolve(null) }) as never);
  return new Promise((res, rej) => l.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
}
const lum = (c: THREE.Color): number => { const s = c.clone().convertLinearToSRGB(); return 0.2126 * s.r + 0.7152 * s.g + 0.0722 * s.b; };
/** a colour reads as white when every sRGB channel is above 0.8 and they are within 0.12 of each other */
const nearWhite = (c: THREE.Color): boolean => { const s = c.clone().convertLinearToSRGB(); const hi = Math.max(s.r, s.g, s.b), lo = Math.min(s.r, s.g, s.b); return lo > 0.8 && hi - lo < 0.12; };

/** area (cm2) of the triangles of a part within `r` metres of the neck joint (bind pose) */
function areaNear(gltf: GLTF, part: string, r: number): number {
  gltf.scene.updateMatrixWorld(true);
  let neck: THREE.Object3D | null = null;
  gltf.scene.traverse((o) => { if (o.name === 'neck_01') neck = o; });
  const n = new THREE.Vector3().setFromMatrixPosition(neck!.matrixWorld);
  let mesh: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.name === part) mesh = o as THREE.SkinnedMesh; });
  const m = mesh as THREE.SkinnedMesh | null;
  if (!m) return 0;
  m.skeleton.update();
  const idx = m.geometry.getIndex()!;
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let area = 0;
  for (let t = 0; t < idx.count; t += 3) {
    for (let k = 0; k < 3; k++) { m.getVertexPosition(idx.getX(t + k), p[k]); p[k].applyMatrix4(m.matrixWorld); }
    const c = p[0].clone().add(p[1]).add(p[2]).multiplyScalar(1 / 3);
    if (c.distanceTo(n) < r) area += new THREE.Triangle(p[0], p[1], p[2]).getArea() * 1e4;
  }
  return area;
}

describe.skipIf(!have)('no white at the neck unless the garment is white (16.6.12)', () => {
  for (const tier of ['', '-low']) {
    for (const body of BODIES) {
      it(`${body}${tier}: the neck band takes the top's colour, a little darker, on every tint; no near-white cloth within 5 cm of the neck`, async () => {
        const gltf = await parse(`person-${body}${tier}.glb`);
        const meshes: THREE.SkinnedMesh[] = [];
        gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
        const look = stylePerson(meshes, body, 2);
        const byName = new Map(meshes.map((m) => [m.name, m.material as THREE.MeshStandardMaterial]));
        for (const tint of [...TOP_TINTS[body], '#FFFFFF']) {
          look.setTop(tint);
          const top = byName.get('top')!.color;
          expect(top.getHexString()).toBe(fabricColour(tint).getHexString());
          if (body !== 'man') {
            const band = byName.get('trim')!.color;
            expect(lum(band), `band ${band.getHexString()} against top ${top.getHexString()} (${tint})`).toBeLessThan(lum(top));
            expect(lum(band)).toBeGreaterThan(lum(top) * 0.7);                // darker, not a dark line
            if (!nearWhite(top)) expect(nearWhite(band), `white band on tint ${tint}`).toBe(false);
          }
          // every garment part: what is near-white near the neck must be as small as a button
          if (!nearWhite(top)) {
            for (const part of ['top', 'bottom', 'trim', 'wrap']) {
              const c = byName.get(part)?.color;
              if (c && nearWhite(c)) expect(areaNear(gltf, part, 0.05), `${part} is white within 5 cm of the neck on ${tint}`).toBeLessThan(0.6);
            }
          }
        }
      });
    }
  }
});
