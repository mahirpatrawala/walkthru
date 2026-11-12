// Owned by C3. 3D overlays: a flat outline ribbon around a footprint, and a measuring line with end dots and a
// label. All opaque (no alpha blending, SPEC 1), so they sort sanely against a splat. Browser use; the geometry
// builders are plain three and also run under Node (labels are skipped without a canvas).
import * as THREE from 'three';
import { boxCorners } from '../core/geometry';
import type { Box, Tone, Vec3 } from '../types';
import type { OverlayHandle, Overlays } from './context';

export const TONE_COLORS: Record<Tone, string> = { good: '#1E9E5A', warn: '#E0A100', bad: '#D64545' };
export function toneColor(tone: Tone): string {
  return TONE_COLORS[tone];
}

const RIBBON_M = 0.035;
const LINE_RADIUS_M = 0.006;
const DOT_RADIUS_M = 0.022;
const LABEL_HEIGHT = 0.05; // sprite height as a fraction-ish of the view (sizeAttenuation off)

/** A flat ring of width `t` just inside the box outline, as one geometry at height y. */
export function outlineGeometry(box: Box, y: number, t: number = RIBBON_M): THREE.BufferGeometry {
  const k = Math.max(0.005, Math.min(t, box.w / 2 - 0.005, box.d / 2 - 0.005));
  const outer = boxCorners(box);
  const inner = boxCorners({ ...box, w: Math.max(0.01, box.w - 2 * k), d: Math.max(0.01, box.d - 2 * k) });
  const pos: number[] = [];
  const tri = (a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }): void => {
    pos.push(a.x, y, a.z, b.x, y, b.z, c.x, y, c.z);
  };
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tri(outer[i], outer[j], inner[j]);
    tri(outer[i], inner[j], inner[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function labelSprite(text: string, color: string): THREE.Sprite | null {
  if (typeof document === 'undefined' || !text) return null;
  const font = '600 26px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  if (!g) return null;
  g.font = font;
  const padX = 16;
  const w = Math.ceil(g.measureText(text).width) + padX * 2;
  const h = 44;
  c.width = w;
  c.height = h;
  g.font = font;
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#FFFFFF';
  g.beginPath();
  g.roundRect(1, 1, w - 2, h - 2, 12);
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = color;
  g.stroke();
  g.fillStyle = '#1A1A1A';
  g.textBaseline = 'middle';
  g.fillText(text, padX, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // opaque with an alpha test: the rounded corners cut out, nothing is blended
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: false, alphaTest: 0.5, depthTest: false, depthWrite: false, sizeAttenuation: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(LABEL_HEIGHT * (w / h), LABEL_HEIGHT, 1);
  s.renderOrder = 1002;
  return s;
}

function disposeObject(o: THREE.Object3D): void {
  o.removeFromParent();
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as { material?: THREE.Material | THREE.Material[] }).material;
    const list = Array.isArray(mat) ? mat : mat ? [mat] : [];
    for (const x of list) {
      (x as THREE.SpriteMaterial).map?.dispose();
      x.dispose();
    }
  });
}

export function createOverlays(scene: THREE.Scene): Overlays & { root: THREE.Group; dispose(): void } {
  const root = new THREE.Group();
  root.name = 'overlays';
  scene.add(root);
  const byTag = new Map<string, Set<{ obj: THREE.Object3D; handle: OverlayHandle }>>();

  const track = (obj: THREE.Object3D, tag: string): OverlayHandle => {
    root.add(obj);
    let set = byTag.get(tag);
    if (!set) byTag.set(tag, (set = new Set()));
    const rec = { obj, handle: null as unknown as OverlayHandle };
    rec.handle = {
      remove() {
        if (!set!.delete(rec)) return;
        disposeObject(obj);
      },
    };
    set.add(rec);
    return rec.handle;
  };

  return {
    root,
    outlineBox(box, y, color, tag = 'default') {
      const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(outlineGeometry(box, y), mat);
      mesh.name = 'outline';
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      return track(mesh, tag);
    },
    line(a: Vec3, b: Vec3, label: string, color: string, tag = 'default') {
      const g = new THREE.Group();
      g.name = 'measure-line';
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false });
      const va = new THREE.Vector3(a.x, a.y, a.z);
      const vb = new THREE.Vector3(b.x, b.y, b.z);
      const len = va.distanceTo(vb);
      if (len > 1e-4) {
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(LINE_RADIUS_M, LINE_RADIUS_M, len, 8, 1), mat);
        cyl.position.copy(va).add(vb).multiplyScalar(0.5);
        cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
        cyl.renderOrder = 1000;
        g.add(cyl);
      }
      for (const p of len > 1e-4 ? [va, vb] : [va]) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(DOT_RADIUS_M, 14, 10), mat);
        dot.position.copy(p);
        dot.renderOrder = 1001;
        g.add(dot);
      }
      const sprite = labelSprite(label, color);
      if (sprite) {
        sprite.position.copy(va).add(vb).multiplyScalar(0.5);
        // anchor the label's bottom edge a little above the line, so it never covers the line or its end dots
        sprite.center.set(0.5, -0.45);
        g.add(sprite);
      }
      g.frustumCulled = false;
      return track(g, tag);
    },
    clear(tag) {
      const tags = tag === undefined ? [...byTag.keys()] : [tag];
      for (const t of tags) {
        const set = byTag.get(t);
        if (!set) continue;
        for (const rec of [...set]) rec.handle.remove();
        byTag.delete(t);
      }
    },
    dispose() {
      this.clear();
      root.removeFromParent();
    },
  };
}
