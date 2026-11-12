// Paint on the wanderer himself. A few hundred dabs are pinned to points of his clothes, skin, boots and hair and
// carried with them as he moves: each frame every pin is put through the same bones as the skin it sits on, along
// with the way its stroke runs (down a leg, along a sleeve, round the head) and the way its surface faces.
import * as THREE from 'three';
import { dabMaterial, dabGeometry, dabMesh } from './dabs.js';

/**
 * palettes: [[light, half-tone, shade, (its own colour, for a lamp's light)], ...]. parts: [{ mesh, count, accept(p), style(p, n) -> { pal, size: [across, along], dir } }],
 * where p and n are a point of the mesh and its normal in the pose it was made in.
 */
export function pinDabs(shared, palettes, parts) {
  let seed = 9151;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pins = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const part of parts) {
    const g = part.mesh.geometry, pos = g.attributes.position, nrm = g.attributes.normal, index = g.index;
    const tris = index ? index.count / 3 : pos.count / 3;
    const at = (t, k) => (index ? index.getX(t * 3 + k) : t * 3 + k);
    // larger faces are chosen more often, so the pins are spread evenly over the surface
    const sums = new Float32Array(tris);
    let total = 0;
    for (let t = 0; t < tris; t++) {
      a.fromBufferAttribute(pos, at(t, 0)); b.fromBufferAttribute(pos, at(t, 1)); c.fromBufferAttribute(pos, at(t, 2));
      total += b.sub(a).cross(c.sub(a)).length();
      sums[t] = total;
    }
    for (let made = 0, tries = 0; made < part.count && tries < part.count * 40; tries++) {
      const want = rand() * total;
      let lo = 0, hi = tris - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (sums[mid] < want) lo = mid + 1; else hi = mid; }
      const v = at(lo, Math.floor(rand() * 3));
      const p = new THREE.Vector3().fromBufferAttribute(pos, v), n = new THREE.Vector3().fromBufferAttribute(nrm, v);
      if (part.accept && !part.accept(p)) continue;
      const s = part.style(p, n);
      pins.push({ mesh: part.mesh, v, p, n, d: s.dir.clone().normalize(), pal: s.pal, size: s.size, seed: rand() * 1000 });
      made++;
    }
  }
  const count = pins.length;
  const aPos = new Float32Array(count * 3), aDir = new Float32Array(count * 3), aNrm = new Float32Array(count * 3), aData = new Float32Array(count * 4);
  pins.forEach((pin, i) => aData.set([pin.seed, pin.size[0], pin.size[1], pin.pal], i * 4));
  const geometry = dabGeometry(count, { aPos: [aPos, 3], aDir: [aDir, 3], aNrm: [aNrm, 3] }, true);
  geometry.setAttribute('aData', new THREE.InstancedBufferAttribute(aData, 4));
  const list = (k) => palettes.map((p) => `vec3(${p[k].map((x) => x.toFixed(3))})`).join(', ');
  const n = palettes.length;
  const mesh = dabMesh(geometry, dabMaterial(shared, {
    head: /* glsl */ `
      in vec3 aPos; in vec3 aDir; in vec3 aNrm; in vec4 aData;
      const vec3 FIG_L[${n}] = vec3[${n}](${list(0)});
      const vec3 FIG_M[${n}] = vec3[${n}](${list(1)});
      const vec3 FIG_S[${n}] = vec3[${n}](${list(2)});
      const vec3 FIG_A[${n}] = vec3[${n}](${palettes.map((p) => `vec3(${(p[3] ?? p[0]).map((x) => x.toFixed(3))})`).join(', ')});`,
    body: /* glsl */ `
      void makeDab(inout Dab d) {
        vec3 Nn = normalize(aNrm);
        // on the far side of him: not ours to paint
        if (dot(Nn, normalize(cameraPosition - aPos)) < -0.05) { d.alive = 0.0; return; }
        vec4 r = hash4(aData.x);
        int k = int(aData.w + 0.5);
        float lit = sunAt(aPos + Nn * 0.08) * clamp(dot(Nn, uSunDir) * 0.85 + 0.42, 0.0, 1.0);
        vec3 c = paint3(FIG_L[k], FIG_M[k], FIG_S[k], lit, r.x);
        // warm light thrown up by the leaves on the ground, cool light from the sky into the shade
        c += uBounce * max(-Nn.y, 0.0) * (1.0 - lit);
        c = mix(c, c * vec3(0.86, 0.92, 1.18), (1.0 - lit) * max(Nn.y, 0.0) * 0.6);
        c = jitter(c, r.yzw, 0.45);
        c += FIG_A[k] * uLampCol * lampAt(aPos, Nn);
        d.pos = aPos;
        d.dir = aDir;
        d.size = aData.yz * (0.8 + 0.45 * r.y);
        d.c1 = hazed(c, aPos);
        d.c2 = hazed(jitter(c * 1.22, r.wxy, 0.5), aPos);
        d.seed = aData.x;
        d.lift = 0.3;
        d.turnabout = 1.0;
      }`,
    minPx: [2.5, 4], maxPx: [200, 400], cells: [0, 6],
  }), 5);

  return {
    mesh,
    count,
    update() {
      for (let i = 0; i < count; i++) {
        const pin = pins[i], m = pin.mesh, k = i * 3;
        a.copy(pin.p); if (m.isSkinnedMesh) m.applyBoneTransform(pin.v, a); a.applyMatrix4(m.matrixWorld);
        b.copy(pin.p).addScaledVector(pin.n, 0.03); if (m.isSkinnedMesh) m.applyBoneTransform(pin.v, b); b.applyMatrix4(m.matrixWorld);
        c.copy(pin.p).addScaledVector(pin.d, 0.03); if (m.isSkinnedMesh) m.applyBoneTransform(pin.v, c); c.applyMatrix4(m.matrixWorld);
        aPos[k] = a.x; aPos[k + 1] = a.y; aPos[k + 2] = a.z;
        aNrm[k] = b.x - a.x; aNrm[k + 1] = b.y - a.y; aNrm[k + 2] = b.z - a.z;
        aDir[k] = c.x - a.x; aDir[k + 1] = c.y - a.y; aDir[k + 2] = c.z - a.z;
      }
      for (const name of ['aPos', 'aDir', 'aNrm']) geometry.attributes[name].needsUpdate = true;
    },
  };
}
