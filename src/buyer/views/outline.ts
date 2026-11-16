// A soft glowing outline round a piece of furniture, for the doll house's hover and tap. Inverted hulls: every mesh of the piece is drawn a second time
// with its faces turned inside out and its welded, smoothed vertices pushed along their normals by a fixed number of screen pixels, so what shows is a
// constant-width rim just outside the silhouette (a wide faint one under a thin strong one: the glow). Nothing is added to the piece itself; the hulls
// live in one group of the scene and `clear()` and `dispose()` remove them and free their geometry.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const OUTLINE_COLOUR = '#FF7A45';

const VERT = /* glsl */ `
uniform float uPx;
uniform vec2 uView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mv;
  vec3 vn = normalize(normalMatrix * normal);
  vec2 dir = (projectionMatrix * vec4(vn, 0.0)).xy;
  float l = length(dir);
  dir = l > 1e-5 ? dir / l : vec2(0.0);
  clip.xy += dir * (uPx * 2.0 / uView) * clip.w;
  gl_Position = clip;
}`;
const FRAG = /* glsl */ `
uniform vec3 uColour;
uniform float uAlpha;
void main() { gl_FragColor = vec4(uColour, uAlpha); }`;

export interface Outline {
  /** outlines these roots (null clears) */
  set(roots: readonly THREE.Object3D[] | null): void;
  /** call each frame: keeps the hulls on their pieces and the width right for the viewport */
  update(viewportW: number, viewportH: number, pixelRatio: number): void;
  readonly active: boolean;
  dispose(): void;
}

export function createOutline(scene: THREE.Scene): Outline {
  const group = new THREE.Group();
  group.name = 'dollhouse-outline';
  scene.add(group);
  const hullOf = new Map<THREE.BufferGeometry, THREE.BufferGeometry | null>();
  const colour = new THREE.Color(OUTLINE_COLOUR);
  const mk = (px: number, alpha: number): THREE.ShaderMaterial => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, transparent: alpha < 1, depthWrite: false, toneMapped: false,
    uniforms: { uPx: { value: px }, uView: { value: new THREE.Vector2(1, 1) }, uColour: { value: colour.clone() }, uAlpha: { value: alpha } },
  });
  const core = mk(2.4, 1);
  const glow = mk(9, 0.22);
  const glow2 = mk(5.5, 0.3);
  const mats = [core, glow, glow2];
  const pairs: { src: THREE.Mesh; hulls: THREE.Mesh[] }[] = [];
  let live: readonly THREE.Object3D[] | null = null;

  const hullGeometry = (g: THREE.BufferGeometry): THREE.BufferGeometry | null => {
    if (hullOf.has(g)) return hullOf.get(g) ?? null;
    let out: THREE.BufferGeometry | null = null;
    const pos = g.getAttribute('position');
    if (pos && pos.count >= 3 && pos.count < 200000) {
      // positions only, welded, so the normals are smooth and a box does not come apart at its corners
      const h = new THREE.BufferGeometry();
      h.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos.array as ArrayLike<number>).slice(0, pos.count * pos.itemSize), pos.itemSize));
      const idx = g.getIndex();
      if (idx) h.setIndex(new THREE.BufferAttribute(new Uint32Array(idx.array as ArrayLike<number>), 1));
      try {
        out = mergeVertices(h, 1e-4);
        out.computeVertexNormals();
        h.dispose();
      } catch { out = null; }
    }
    hullOf.set(g, out);
    return out;
  };

  const clear = (): void => {
    for (const p of pairs) for (const h of p.hulls) group.remove(h);
    pairs.length = 0;
    live = null;
  };

  return {
    set(roots) {
      clear();
      if (!roots || roots.length === 0) return;
      live = roots;
      for (const root of roots) {
        root.updateWorldMatrix(true, true);
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
          const hg = hullGeometry(m.geometry);
          if (!hg) return;
          const hulls = mats.map((mat, i) => {
            const h = new THREE.Mesh(hg, mat);
            h.matrixAutoUpdate = false;
            h.renderOrder = 6 - i;
            h.frustumCulled = false;
            h.raycast = () => {};
            group.add(h);
            return h;
          });
          pairs.push({ src: m, hulls });
        });
      }
    },
    update(w, h, pr) {
      for (const mat of mats) (mat.uniforms.uView.value as THREE.Vector2).set(w * pr, h * pr);
      // a pixel is a device pixel: scale the widths with the ratio so the rim looks the same on a dense screen
      core.uniforms.uPx.value = 2.4 * pr; glow.uniforms.uPx.value = 9 * pr; glow2.uniforms.uPx.value = 5.5 * pr;
      for (const p of pairs) {
        p.src.updateWorldMatrix(true, false);
        const v = p.src.visible;
        for (const hu of p.hulls) { hu.matrix.copy(p.src.matrixWorld); hu.matrixWorld.copy(p.src.matrixWorld); hu.visible = v; }
      }
    },
    get active() { return live !== null; },
    dispose() {
      clear();
      scene.remove(group);
      for (const g of hullOf.values()) g?.dispose();
      hullOf.clear();
      for (const m of mats) m.dispose();
    },
  };
}
