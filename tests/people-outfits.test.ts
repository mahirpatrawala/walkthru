// SPEC 16.6.11: the man, the woman and the child wear a top and trousers (shorts for the child), not a long skirted garment; the elder keeps
// her saree. Checked on the shipped GLBs, in the bind pose, without a browser.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OUTFITS, SKIN_TONES, TOP_TINTS, fabricColour, stylePerson } from '../src/look/people-materials';
import { BODY_CHIPS_CM, BODY_DEFAULT_CM, tintForPerson } from '../src/buyer/person-store';
import type { PersonBody } from '../src/look/people';

const DIR = path.resolve(import.meta.dirname, '../public/characters');
const BODIES: PersonBody[] = ['man', 'woman', 'elder', 'child'];
const have = BODIES.every((b) => fs.existsSync(path.join(DIR, `person-${b}.glb`)) && fs.existsSync(path.join(DIR, `person-${b}-low.glb`)));

function parse(file: string): Promise<GLTF> {
  const buf = fs.readFileSync(path.join(DIR, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  l.register(() => ({ name: 'skip-textures', loadTexture: () => Promise.resolve(null) }) as never);
  return new Promise((res, rej) => l.parse(ab, '', res, rej));
}
function parts(gltf: GLTF): Map<string, THREE.SkinnedMesh> {
  const m = new Map<string, THREE.SkinnedMesh>();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => { const s = o as THREE.SkinnedMesh; if (s.isSkinnedMesh) m.set(s.name, s); });
  return m;
}
/** bind-pose vertices of a part as [x, y, z] in world space (y up), skinned at the rest pose */
function verts(s: THREE.SkinnedMesh): number[][] {
  s.updateWorldMatrix(true, false);
  s.skeleton.update();
  const out: number[][] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < s.geometry.getAttribute('position').count; i++) { s.getVertexPosition(i, v); out.push([v.x, v.y, v.z]); }
  return out;
}

describe.skipIf(!have)('outfits (16.6.11)', () => {
  for (const tier of ['', '-low']) {
    for (const body of BODIES) {
      it(`${body}${tier}: a top that ends at the hip and two separate legs, nothing hangs between them`, async () => {
        const p = parts(await parse(`person-${body}${tier}.glb`));
        const skin = verts(p.get('skin')!);
        const y0 = Math.min(...verts(p.get('shoes')!).map((v) => v[1])), H = Math.max(...skin.map((v) => v[1])) - y0;
        const rel = (v: number[]) => (v[1] - y0) / H;
        // the top ends at the hip joint (0.50 to 0.54 of the height, the crotch is at about 0.45): no kurta, no kameez, no dress
        const top = verts(p.get('top')!);
        expect(Math.min(...top.map(rel))).toBeGreaterThan(body === 'elder' ? 0.46 : 0.495);   // (the elder's tunic is cut to mid-hip and she stoops)
        // the bottom is trousers or shorts: between 0.18 and 0.40 of the height no vertex sits on the midline at the front or the back, so no cloth hangs between the legs
        const bottom = verts(p.get('bottom')!);
        const mid = bottom.filter((v) => rel(v) > 0.18 && rel(v) < 0.4);
        expect(mid.length).toBeGreaterThan(20);
        // (the legs may touch at the knees: the vertices on the midline are then between the legs, not at the front or the back of a skirt)
        const zc = mid.reduce((a, v) => a + v[2], 0) / mid.length;
        for (const v of mid) if (Math.abs(v[0]) / H < 0.006) expect(Math.abs(v[2] - zc) / H).toBeLessThan(0.035);
        // (only the man has a wrap part at all, his shirt buttons: nobody has a dupatta or a pallu)
        const wrap = p.get('wrap');
        if (body === 'man') expect(Math.min(...verts(wrap!).map(rel))).toBeGreaterThan(0.495);
        else expect(wrap).toBeUndefined();
        // the legs reach the shoes (trousers) or sit just above the knee (the child's shorts)
        const low = Math.min(...bottom.map(rel));
        if (body === 'child') { expect(low).toBeGreaterThan(0.28); expect(low).toBeLessThan(0.36); } else expect(low).toBeLessThan(0.1);
      });
    }
  }

  for (const body of BODIES) {
    it(`${body}: the top takes the viewer's tint, the trousers and shorts never do`, async () => {
      const gltf = await parse(`person-${body}.glb`);
      const p = parts(gltf);
      const look = stylePerson([...p.values()], body, 2);
      const colour = (role: string) => `#${(p.get(role)!.material as THREE.MeshStandardMaterial).color.getHexString()}`;
      const bottom0 = colour('bottom');
      const trim0 = colour('trim');
      expect(bottom0.toLowerCase()).toBe(new THREE.Color(OUTFITS[body].bottom).getHexString().replace(/^/, '#').toLowerCase());
      for (const tint of ['#1FA3A3', '#B71C6C', '#7A5AF0', '#FF0000']) {
        look.setTop(tint);
        expect(colour('top')).toBe(`#${fabricColour(tint).getHexString()}`);
        expect(colour('bottom')).toBe(bottom0);
        expect(colour('trim')).toBe(trim0);
      }
    });
  }

  it('the first impression is believable: no crimson shirt on the default man, every tint stays off skin and on offer', () => {
    expect(tintForPerson('man', BODY_DEFAULT_CM.man).toLowerCase()).not.toBe('#b71c6c');
    expect(tintForPerson('child', BODY_DEFAULT_CM.child).toLowerCase()).not.toBe('#b71c6c');
    // every older tint is still selectable by someone's quick heights
    const offered = new Set<string>();
    for (const b of BODIES) for (const cm of BODY_CHIPS_CM[b]) offered.add(tintForPerson(b, cm).toLowerCase());
    for (const t of ['#1fa3a3', '#b71c6c', '#7a5af0']) expect(offered.has(t)).toBe(true);
    // none of a person's tops reads as skin (40 degrees of hue from every skin tone, as 16.6.9a)
    const hsl = (c: THREE.Color) => { const o = { h: 0, s: 0, l: 0 }; c.getHSL(o, THREE.SRGBColorSpace); return o; };
    for (const b of BODIES) for (const tint of TOP_TINTS[b]) {
      const t = hsl(fabricColour(tint));
      for (const skin of SKIN_TONES) {
        const s = hsl(new THREE.Color(skin));
        expect(Math.min(Math.abs(t.h - s.h), 1 - Math.abs(t.h - s.h)) * 360, `${b} ${tint} against ${skin}`).toBeGreaterThanOrEqual(40);
      }
    }
  });
});
