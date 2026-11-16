// What the doll house stands on: a large pale ground with a faint grid and a soft shadow under the building (the wall caps are wall-cut.ts's, they ride
// the walls as these are cut). It is made when the mode is entered and taken away (geometry, material, texture) when
// it is left, so nothing of them stays in the scene during the walk.
import * as THREE from 'three';
import type { Layout, Vec2 } from '../../types';
import type { Bounds } from './framing';

export const GROUND_COLOUR = '#F7F8FB';
export const GROUND_Y = -0.02;
/** how far (m) the building's soft shadow slides away from the key light */
const SHADOW_SLIDE_M = 0.22;

export interface Stage {
  group: THREE.Group;
  /** the ground tint, as a CSS colour, so the backdrop can match it */
  dispose(): void;
}

function groundShadowTexture(layout: Layout, rect: { x0: number; z0: number; x1: number; z1: number }, slide: Vec2): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  const w = rect.x1 - rect.x0, h = rect.z1 - rect.z0;
  const px = size / Math.max(w, h);
  const toPx = (p: Vec2): [number, number] => [(p.x + slide.x - rect.x0) * px, (p.z + slide.z - rect.z0) * px];
  g.lineJoin = 'round';
  // a soft edge without relying on canvas blur filters (Safari): the outline stroked wider and wider at a low alpha
  const passes = 14;
  for (let k = passes; k >= 1; k--) {
    const widthM = 0.09 * k * k * 0.22 + 0.1;
    g.strokeStyle = `rgba(255,255,255,${(0.1 + 0.02 * (passes - k)).toFixed(3)})`;
    g.lineWidth = widthM * px;
    for (const r of layout.rooms) {
      if (r.polygon.length < 3) continue;
      g.beginPath();
      r.polygon.forEach((p, i) => { const [x, y] = toPx(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath();
      g.stroke();
    }
  }
  g.fillStyle = '#fff';
  for (const r of layout.rooms) {
    if (r.polygon.length < 3) continue;
    g.beginPath();
    r.polygon.forEach((p, i) => { const [x, y] = toPx(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function createStage(o: { scene: THREE.Scene; layout: Layout; bounds: Bounds; keyAzimuth: number; ground: boolean; /** the soft shadow of the building on the ground (not for an open-air space, whose rooms are the whole site) */ shadow?: boolean }): Stage {
  const { layout, bounds } = o;
  const group = new THREE.Group();
  group.name = 'dollhouse-stage';
  const disposables: Array<{ dispose(): void }> = [];

  // ---- ground
  if (o.ground) {
    const span = Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0);
    const pad = Math.max(3.5, span * 0.3);
    const rect = { x0: bounds.x0 - pad, z0: bounds.z0 - pad, x1: bounds.x0 - pad + Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) + pad * 2, z1: bounds.z0 - pad + Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) + pad * 2 };
    // centre the square on the building
    const cx = (bounds.x0 + bounds.x1) / 2, cz = (bounds.z0 + bounds.z1) / 2;
    const half = (Math.max(bounds.x1 - bounds.x0, bounds.z1 - bounds.z0) + pad * 2) / 2;
    rect.x0 = cx - half; rect.x1 = cx + half; rect.z0 = cz - half; rect.z1 = cz + half;
    // the light comes from the key's side, so the shadow falls away from it
    const slide = { x: -Math.sin(o.keyAzimuth) * SHADOW_SLIDE_M, z: -Math.cos(o.keyAzimuth) * SHADOW_SLIDE_M };
    const shadowTex = o.shadow === false ? null : groundShadowTexture(layout, rect, slide);
    const radius = Math.max(60, span * 6);
    const geo = new THREE.CircleGeometry(radius, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: GROUND_COLOUR, transparent: true, depthWrite: true });
    const uniforms = {
      uCentre: { value: new THREE.Vector2(cx, cz) },
      uFade: { value: new THREE.Vector2(radius * 0.38, radius * 0.98) },
      uShadow: { value: shadowTex },
      uRect: { value: new THREE.Vector4(rect.x0, rect.z0, rect.x1 - rect.x0, rect.z1 - rect.z0) },
      uHasShadow: { value: shadowTex ? 1 : 0 },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vGW; uniform vec2 uCentre; uniform vec2 uFade; uniform sampler2D uShadow; uniform vec4 uRect; uniform float uHasShadow;
float wtLine(vec2 p, float w) { vec2 q = abs(fract(p - 0.5) - 0.5) / max(fwidth(p), vec2(1e-5)); return 1.0 - min(min(q.x, q.y) / w, 1.0); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  float d = length(vGW.xz - uCentre);
  float fade = 1.0 - smoothstep(uFade.x, uFade.y, d);
  float minor = wtLine(vGW.xz, 1.0);
  float major = wtLine(vGW.xz / 5.0, 1.15);
  float gridFade = 1.0 - smoothstep(uFade.x * 0.15, uFade.x * 0.9, d);
  diffuseColor.rgb *= 1.0 - gridFade * (0.075 * minor + 0.11 * major);
  if (uHasShadow > 0.5) {
    vec2 uv = (vGW.xz - uRect.xy) / uRect.zw;
    float s = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : texture2D(uShadow, uv).r;
    diffuseColor.rgb *= 1.0 - 0.34 * s;
  }
  diffuseColor.a *= fade;
}`);
    };
    mat.customProgramCacheKey = () => 'dollhouse-ground';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'dollhouse-ground';
    mesh.position.set(cx, GROUND_Y, cz);
    mesh.raycast = () => {};
    mesh.renderOrder = -1;
    group.add(mesh);
    disposables.push(geo, mat);
    if (shadowTex) disposables.push(shadowTex);
  }

  o.scene.add(group);
  return {
    group,
    dispose() {
      o.scene.remove(group);
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}
