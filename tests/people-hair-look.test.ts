// SPEC 16.6.12: hair that reads as hair. The bodies carry a vertex colour on the hair (strand-to-strand shade in rgb, a feathered hairline in alpha), the
// hairline is ragged and not a clean curve, and the page's hair material is matte so no light on the crown can read as a bald patch. Checked on the shipped
// GLBs without a browser.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { stylePerson } from '../src/look/people-materials';
import type { PersonBody } from '../src/look/people';

const DIR = process.env.PEOPLE_DIR || path.resolve(import.meta.dirname, '../public/characters');   // (PEOPLE_DIR: check a directory of candidate or older builds)
const BODIES: PersonBody[] = ['man', 'woman', 'elder', 'child'];
const have = BODIES.every((b) => fs.existsSync(path.join(DIR, `person-${b}.glb`)) && fs.existsSync(path.join(DIR, `person-${b}-low.glb`)));

function parse(file: string): Promise<GLTF> {
  const buf = fs.readFileSync(path.join(DIR, file));
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  l.register(() => ({ name: 'skip-textures', loadTexture: () => Promise.resolve(null) }) as never);
  return new Promise((res, rej) => l.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
}
function skinned(gltf: GLTF): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh); });
  return out;
}

describe.skipIf(!have)('hair reads as hair (16.6.12)', () => {
  for (const tier of ['', '-low']) {
    for (const body of BODIES) {
      it(`${body}${tier}: a shade and a feathered edge on the hair, a ragged hairline, a matte material`, async () => {
        const gltf = await parse(`person-${body}${tier}.glb`);
        gltf.scene.updateMatrixWorld(true);
        const meshes = skinned(gltf);
        const hair = meshes.find((m) => m.name === 'hair')!;
        const col = hair.geometry.getAttribute('color');
        expect(col, 'the hair has a vertex colour').toBeTruthy();
        expect(col.itemSize, 'rgb is the shade and a is the feathered edge').toBe(4);
        // the shade varies from strand to strand and never goes above 1 or near black
        let lo = 1, hi = 0, faded = 0, solid = 0;
        for (let i = 0; i < col.count; i++) {
          lo = Math.min(lo, col.getX(i)); hi = Math.max(hi, col.getX(i));
          if (col.getW(i) < 0.15) faded++; else if (col.getW(i) > 0.95) solid++;
        }
        expect(hi).toBeGreaterThan(0.9);
        expect(lo).toBeGreaterThan(0.5);
        expect(hi - lo, 'strand shading is visible').toBeGreaterThan(0.12);
        expect(faded, 'a ring of the hair fades out at the hairline').toBeGreaterThan(20);
        expect(solid, 'and the rest stays solid').toBeGreaterThan(col.count / 3);
        // the hairline is ragged: the lowest ring (alpha 0) does not lie at one height. The bind pose, heights in metres relative to the person's height.
        const pos = hair.geometry.getAttribute('position');
        const ys: number[] = [];
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) if (col.getW(i) < 0.02) { hair.getVertexPosition(i, v); v.applyMatrix4(hair.matrixWorld); ys.push(v.y); }
        // (the first body tier has every vertex; the low tier drops about 40 % of them, so only the spread is asked of both)
        const spread = Math.max(...ys) - Math.min(...ys);
        const box = new THREE.Box3().setFromObject(hair);
        const front = ys.filter((y) => y > box.min.y + (box.max.y - box.min.y) * 0.5).length;     // the forehead and the sides of the hairline are higher up the head
        expect(spread, `hairline spread ${spread.toFixed(3)} m`).toBeGreaterThan(0.03);
        expect(front).toBeGreaterThan(0);
        // the material the page gives it: matte, no sheen band, vertex colours and the alpha hash on
        stylePerson(meshes, body, 2);
        const hm = hair.material as THREE.MeshPhysicalMaterial;
        expect(hm.roughness).toBeGreaterThanOrEqual(0.95);
        expect(hm.specularIntensity, 'a specular lobe is what read as a pale bald patch on the crown').toBeLessThanOrEqual(0.1);
        expect(hm.sheen).toBeLessThanOrEqual(0.3);
        expect(hm.metalness).toBe(0);
        expect(hm.vertexColors).toBe(true);
        expect(hm.alphaHash).toBe(true);
      }, 60000);
    }
  }
});
