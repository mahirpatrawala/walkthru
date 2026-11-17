// A small board over every door of a home, on both sides, naming the room the door leads to (SPEC 18.12). The names are the
// rooms' own labels from the drawing; the door onto the outside reads "Exit". A shared space of a building (a lobby, a gym)
// carries the building's own signboards instead (src/building/signs.ts), so its outside doors get none here.
import * as THREE from 'three';
import { resolveDoors } from '../core/doors';
import type { Door } from '../core/doors';
import type { Layout, SpaceKind } from '../types';
import { signLook } from '../look/sign-style';
import type { SignLook } from '../look/sign-style';

export const DOOR_LABEL_HEIGHT_M = 0.13;
export const DOOR_LABEL_GAP_M = 0.06;
const THICK_M = 0.012;
export const DOOR_LABEL_TEXTURE_SCALE = 2;

/** Board width for its words: 5 cm a letter plus margins, between 0.34 m and 1.3 m. */
export function doorLabelWidthM(text: string): number {
  return Math.min(1.3, Math.max(0.34, 0.14 + text.length * 0.05));
}

export interface DoorLabel { doorId: string; /** 1: the board hangs in the door's own room, -1: on the other side */ side: 1 | -1; text: string }

/** a drawing's shorthand, spelled out on a signboard (the room keeps its own label everywhere else) */
const SIGN_WORDS: Record<string, string> = {
  mbr: 'Master Bedroom', br: 'Bedroom', bedrm: 'Bedroom', kit: 'Kitchen', wc: 'WC', toi: 'Toilet', bal: 'Balcony', balc: 'Balcony',
  liv: 'Living', lvg: 'Living', din: 'Dining', dng: 'Dining', pass: 'Passage', util: 'Utility', utl: 'Utility',
};
/**
 * The words a signboard shows for a room label: a plan's abbreviations ("Mbr", "Kit", "W.c.") are spelled out, word by word, so a sign
 * never reads as a code; any other label is shown as it is. Pure.
 */
export function signText(label: string): string {
  return label.trim().split(/\s+/).map((w) => SIGN_WORDS[w.toLowerCase().replace(/\./g, '')] ?? w).join(' ');
}

/** What each side of each door says. Pure. */
export function doorLabels(layout: Layout, spaceKind: SpaceKind = 'home'): DoorLabel[] {
  const name = (id: string | null): string | null => { const l = id ? layout.rooms.find((r) => r.id === id)?.label?.trim() : ''; return l ? signText(l) : null; };
  const out: DoorLabel[] = [];
  for (const d of resolveDoors(layout)) {
    const other = d.rooms[0] === d.roomId ? d.rooms[1] : d.rooms[0];
    const own = name(d.roomId), far = name(other);
    if (other === null) { if (spaceKind === 'home') out.push({ doorId: d.id, side: 1, text: 'Exit' }); continue; }
    if (far) out.push({ doorId: d.id, side: 1, text: far });
    if (own) out.push({ doorId: d.id, side: -1, text: own });
  }
  return out;
}

function board(text: string, w: number, look: SignLook = signLook()): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  // drawn in a 96 px high design space and scaled up (about 2,200 px a metre: sharp at arm's length on a 2x screen, SPEC 16.18)
  const K = DOOR_LABEL_TEXTURE_SCALE;
  c.height = 96 * K; c.width = Math.round(96 * K * (w / (DOOR_LABEL_HEIGHT_M * look.scale)));
  const g = c.getContext('2d');
  if (!g) return null;
  g.scale(K, K);
  const W = c.width / K, H = c.height / K;
  g.fillStyle = look.bg; g.fillRect(0, 0, W, H);
  if (look.border) { g.strokeStyle = look.border; g.lineWidth = 4; g.strokeRect(5, 5, W - 10, H - 10); }
  g.fillStyle = look.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  let px = 60;
  g.font = `${look.weight} ${px}px system-ui, sans-serif`;
  while (px > 20 && g.measureText(text).width > W - 36) { px -= 2; g.font = `${look.weight} ${px}px system-ui, sans-serif`; }
  g.fillText(text, W / 2, H / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function mountDoorLabels(scene: THREE.Object3D, layout: Layout, spaceKind: SpaceKind = 'home'): { count: number; dispose(): void } {
  const doors = new Map<string, Door>(resolveDoors(layout).map((d) => [d.id, d]));
  const group = new THREE.Group();
  group.name = 'door-labels';
  const freed: { dispose(): void }[] = [];
  for (const l of doorLabels(layout, spaceKind)) {
    const d = doors.get(l.doorId);
    if (!d) continue;
    const look = signLook();
    const lh = DOOR_LABEL_HEIGHT_M * look.scale;
    const y = d.headM + DOOR_LABEL_GAP_M + lh / 2;
    if (y + lh / 2 > layout.wallHeightM - 0.02) continue;
    const w = doorLabelWidthM(l.text) * (look.scale < 1 ? 0.82 : 1);
    const tex = board(l.text, w, look);
    const side = new THREE.MeshStandardMaterial({ color: look.border ? look.bg : '#D9D5CD', roughness: 0.6 });
    const face = new THREE.MeshStandardMaterial({ color: tex ? '#FFFFFF' : look.bg, map: tex, roughness: 0.55, emissive: '#FFFFFF', emissiveMap: tex, emissiveIntensity: tex ? (look.border ? 0.18 : 0.04) : 0 });
    const geo = new THREE.BoxGeometry(w, lh, THICK_M);
    const mesh = new THREE.Mesh(geo, [side, side, side, side, face, side]);
    mesh.name = `door-label:${l.doorId}:${l.side}`;
    // `edgeA` runs along the wall's face in the door's own room; the far face is `depth` along `out`. The board stands proud of its face
    const u = (d.u0 + d.u1) / 2;
    const off = l.side === 1 ? -THICK_M / 2 : d.depth + THICK_M / 2;
    mesh.position.set(d.edgeA.x + d.dir.x * u + d.out.x * off, y, d.edgeA.z + d.dir.z * u + d.out.z * off);
    // the face looks away from the wall: into the door's own room (against `out`) on side 1, along `out` on the other
    mesh.rotation.y = Math.atan2(-l.side * d.out.x, -l.side * d.out.z);
    mesh.receiveShadow = true;
    group.add(mesh);
    freed.push(geo, side, face);
    if (tex) freed.push(tex);
  }
  scene.add(group);
  return { count: group.children.length, dispose() { group.removeFromParent(); for (const x of freed) x.dispose(); } };
}
