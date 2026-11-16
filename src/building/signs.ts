// Signboards over a shared space's portal doors: a dark board with the name of where the door leads, fixed to the wall above the
// door head on the room's own side (SPEC 18.12). The words come from the building file (portal-looks.signText), never invented here.
import * as THREE from 'three';
import { doorFrame } from './geom';
import { computeEdgeFrames } from '../core/layout-geom';
import { signText } from './portal-looks';
import type { MountedSpace } from './space-host';
import type { BuildingFile, Space } from './types';

export const SIGN_HEIGHT_M = 0.2;
/** Gap between the door head and the board's lower edge. */
export const SIGN_GAP_M = 0.07;
const SIGN_THICK_M = 0.014;

/** Board width for its words: 7.5 cm a letter plus margins, between 0.5 m and 1.8 m. */
export function signWidthM(text: string): number {
  return Math.min(1.8, Math.max(0.5, 0.2 + text.length * 0.075));
}

function board(text: string, w: number): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.height = 128; c.width = Math.round(128 * (w / SIGN_HEIGHT_M));
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#23292E'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#C9A657'; g.lineWidth = 5; g.strokeRect(7, 7, c.width - 14, c.height - 14);
  g.fillStyle = '#F6F2E8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let px = 84;
  g.font = `700 ${px}px system-ui, sans-serif`;
  while (px > 24 && g.measureText(text).width > c.width - 48) { px -= 2; g.font = `700 ${px}px system-ui, sans-serif`; }
  g.fillText(text, c.width / 2, c.height / 2 + 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export interface SignsHandle { count: number; dispose(): void }

export function mountSigns(m: MountedSpace, space: Space, b?: BuildingFile): SignsHandle {
  const frames = computeEdgeFrames(m.layout);
  const group = new THREE.Group();
  group.name = 'portal-signs';
  const freed: { dispose(): void }[] = [];
  const wallH = m.layout.wallHeightM;
  for (const p of space.portals) {
    const text = signText(p, space, b);
    const f = text ? doorFrame(m.layout, p.opening, frames) : null;
    if (!text || !f) continue;
    const y = f.headM + SIGN_GAP_M + SIGN_HEIGHT_M / 2;
    if (y + SIGN_HEIGHT_M / 2 > wallH - 0.02) continue; // no wall above the door to carry a board
    const w = signWidthM(text);
    const tex = board(text, w);
    const side = new THREE.MeshStandardMaterial({ color: '#23292E', roughness: 0.6 });
    const face = new THREE.MeshStandardMaterial({ color: tex ? '#FFFFFF' : '#23292E', map: tex, roughness: 0.55, emissive: '#FFFFFF', emissiveMap: tex, emissiveIntensity: tex ? 0.18 : 0 });
    const geo = new THREE.BoxGeometry(w, SIGN_HEIGHT_M, SIGN_THICK_M);
    // box faces: +x, -x, +y, -y, +z (the front), -z
    const mesh = new THREE.Mesh(geo, [side, side, side, side, face, side]);
    mesh.name = `sign:${p.id}`;
    // the frame's centre is on the room's inside face line; the board stands proud of it, facing into the room
    mesh.position.set(f.centre.x - f.out.x * SIGN_THICK_M / 2, y, f.centre.z - f.out.z * SIGN_THICK_M / 2);
    mesh.rotation.y = Math.atan2(-f.out.x, -f.out.z);
    mesh.castShadow = false; mesh.receiveShadow = true;
    group.add(mesh);
    freed.push(geo, side, face);
    if (tex) freed.push(tex);
  }
  m.viewer.scene.add(group);
  return { count: group.children.length, dispose() { group.removeFromParent(); for (const x of freed) x.dispose(); } };
}
