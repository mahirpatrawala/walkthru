// The door leaf as a mesh: a flush panel (35 mm, as high as the opening's head less the frame) with a lever handle on both faces.
// Pure three, no DOM. The group's origin is the hinge (or, for a sliding leaf, the leaf's near end) at the floor; its +X runs along
// the panel towards the free edge, so placing it is a translation and one rotation about Y.
import * as THREE from 'three';
import { DOOR_FLOOR_GAP_M, DOOR_THICKNESS_M, leafSegment } from '../core/doors';
import type { Door } from '../core/doors';
import type { DoorStyle } from '../building/space-host';

export interface DoorModel {
  group: THREE.Group;
  /** put the leaf at `pos` (a hinged leaf's angle in radians, a sliding leaf's travel in metres) */
  setPos(pos: number): void;
  /** the panel's colour from the active style (a wood or laminate finish), or null for the default teak laminate */
  setPanelColour(hex: string | null): void;
  dispose(): void;
}

/** Lever handle height above the floor, metres (a standard 1.0 m). */
const HANDLE_Y_M = 1.0;

/** A plate or sign with text on it, as a canvas texture (none under Node, where there is no canvas: the plate is then plain). */
function textTexture(text: string, w: number, h: number, bg: string, fg: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256; c.height = Math.max(32, Math.round(256 * (h / w)));
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = fg; g.globalAlpha = 0.5; g.lineWidth = 4; g.strokeRect(6, 6, c.width - 12, c.height - 12); g.globalAlpha = 1;
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 ${Math.round(c.height * (text.length > 5 ? 0.34 : 0.56))}px system-ui, sans-serif`;
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildDoorModel(d: Door, frameColor: string, style?: DoorStyle): DoorModel {
  const group = new THREE.Group();
  group.name = `door:${d.id}`;
  const kind = style?.kind ?? 'plain';
  // a building's main door is a heavier slab; the rest keep the 35 mm flush leaf
  const T = kind === 'main' ? 0.045 : kind === 'glass' ? 0.04 : DOOR_THICKNESS_M;
  const H = Math.max(0.5, d.topM - DOOR_FLOOR_GAP_M);
  const W = d.panelWidthM;
  // a teak-laminate flush door: lighter than the dark frame so the panel reads as wood, not a black slab
  const defaultPanel = kind === 'main' ? new THREE.Color('#7B5334') : kind === 'lift' ? new THREE.Color('#D9DDDF') : kind === 'stairs' ? new THREE.Color('#6F8076') : kind === 'glass' ? new THREE.Color('#2B3033') : new THREE.Color(frameColor).lerp(new THREE.Color('#A9794E'), 0.75);
  const panelMat = new THREE.MeshStandardMaterial({ color: defaultPanel.clone(), roughness: kind === 'lift' ? 0.45 : 0.55, metalness: kind === 'lift' ? 0.3 : kind === 'glass' ? 0.6 : 0 });
  const styled = kind !== 'plain';
  const extra: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const handleMat = new THREE.MeshStandardMaterial({ color: '#B9B4AA', roughness: 0.32, metalness: 0.75 });
  const geoms: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, mat: THREE.Material, name: string, x: number, y: number, z: number, rotX = 0): THREE.Mesh => {
    geoms.push(g);
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.position.set(x, y, z);
    m.rotation.x = rotX;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  // which local face is the room's: local +Z points inward while the leaf hangs from the edge's start, outward when it hangs from the end
  const plateSide = (style?.plateSide ?? 1) * (d.hinge === 'start' ? 1 : -1);
  const mat = (m: THREE.Material): THREE.Material => { extra.push(m); return m; };
  if (kind === 'glass') {
    // a slim satin-aluminium frame (4.5 cm stiles and head, a 12 cm kick rail) round a pane of lightly tinted, reflective glass, a stainless pull bar on both faces
    const frame = mat(new THREE.MeshStandardMaterial({ color: '#C5CBCF', roughness: 0.32, metalness: 0.55 }));
    const glass = mat(new THREE.MeshPhysicalMaterial({ color: '#9DBFC8', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.3, specularIntensity: 1, envMapIntensity: 1.6, side: THREE.DoubleSide }));
    const pull = mat(new THREE.MeshStandardMaterial({ color: '#DDE0E2', roughness: 0.22, metalness: 0.65 }));
    const stile = 0.045, rail = 0.045, railLow = 0.12;
    add(new THREE.BoxGeometry(stile, H, T), frame, 'door-frame', stile / 2, DOOR_FLOOR_GAP_M + H / 2, 0);
    add(new THREE.BoxGeometry(stile, H, T), frame, 'door-frame', W - stile / 2, DOOR_FLOOR_GAP_M + H / 2, 0);
    add(new THREE.BoxGeometry(W - 2 * stile, rail, T), frame, 'door-frame', W / 2, DOOR_FLOOR_GAP_M + H - rail / 2, 0);
    add(new THREE.BoxGeometry(W - 2 * stile, railLow, T), frame, 'door-frame', W / 2, DOOR_FLOOR_GAP_M + railLow / 2, 0);
    const pane = add(new THREE.BoxGeometry(W - 2 * stile, H - rail - railLow, 0.008), glass, 'door-glass', W / 2, DOOR_FLOOR_GAP_M + railLow + (H - rail - railLow) / 2, 0);
    pane.castShadow = false;
    // the pull sits near the free edge, a hand's width in from the stile
    const px = W - stile - 0.07;
    for (const sd of [1, -1]) {
      add(new THREE.CylinderGeometry(0.0155, 0.0155, 0.7, 14), pull, 'door-handle', px, 1.05, sd * (T / 2 + 0.055), 0);
      for (const dy of [0.28, -0.28]) add(new THREE.CylinderGeometry(0.008, 0.008, 0.055, 8), pull, 'door-handle', px, 1.05 + dy, sd * (T / 2 + 0.0275), Math.PI / 2);
    }
  } else {
    add(new THREE.BoxGeometry(W, H, T), panelMat, 'door-panel', W / 2, DOOR_FLOOR_GAP_M + H / 2, 0);
  }
  if (kind === 'lift') {
    // two leaves meeting in the middle, a dark joint and a pair of call-button plates beside the opening are drawn by the lobby
    const dark = mat(new THREE.MeshStandardMaterial({ color: '#2A2C2E', roughness: 0.6 }));
    for (const sd of [1, -1]) add(new THREE.BoxGeometry(0.008, H - 0.02, 0.004), dark, 'door-joint', W / 2, DOOR_FLOOR_GAP_M + H / 2, sd * (T / 2 + 0.002));
  } else if (kind === 'stairs') {
    const glass = mat(new THREE.MeshStandardMaterial({ color: '#BFDDE2', roughness: 0.1, transparent: true, opacity: 0.45 }));
    for (const sd of [1, -1]) add(new THREE.BoxGeometry(0.22, 0.55, 0.004), glass, 'door-vision', W / 2, 1.55, sd * (T / 2 + 0.002));
  }
  // the handle sits by the free edge, on both faces: a round rose and a short lever pointing back along the panel
  const hx = W - 0.07;
  if (kind !== 'glass' && kind !== 'lift') for (const side of [1, -1]) {
    add(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 20), handleMat, 'door-handle', hx, HANDLE_Y_M, side * (T / 2 + 0.006), Math.PI / 2);
    add(new THREE.BoxGeometry(0.115, 0.018, 0.016), handleMat, 'door-handle', hx - 0.045, HANDLE_Y_M - 0.012, side * (T / 2 + 0.034));
    add(new THREE.BoxGeometry(0.018, 0.018, 0.034), handleMat, 'door-handle', hx, HANDLE_Y_M - 0.004, side * (T / 2 + 0.017));
  }
  // a number plate (a flat's door) or a sign (the stairs), on the face the style names
  if (style?.text) {
    const plateW = style.kind === 'stairs' ? 0.34 : 0.2, plateH = style.kind === 'stairs' ? 0.1 : 0.1;
    const tex = style.kind === 'stairs' ? textTexture(style.text, plateW, plateH, '#1F5A3B', '#FFFFFF') : textTexture(style.text, plateW, plateH, '#B08D3C', '#2B1D10');
    if (tex) textures.push(tex);
    const plate = mat(new THREE.MeshStandardMaterial({ color: tex ? '#FFFFFF' : '#B08D3C', map: tex ?? null, roughness: 0.4, metalness: tex ? 0 : 0.7 }));
    add(new THREE.BoxGeometry(plateW, plateH, 0.008), plate, 'door-plate', W / 2, style.kind === 'stairs' ? 1.95 : 1.55, plateSide * (T / 2 + 0.004));
  }
  void styled;
  group.userData.doorId = d.id;
  const setPos = (pos: number): void => {
    const s = leafSegment(d, pos);
    group.position.set(s.a.x, 0, s.a.z);
    // local +X (1, 0, 0) turned by rotation.y = t points at (cos t, 0, -sin t)
    group.rotation.y = Math.atan2(-s.dir.z, s.dir.x);
    group.updateMatrixWorld(true);
  };
  setPos(0);
  return {
    group,
    setPos,
    // the style's door finish is for ordinary doors; a main, lift or stairs door keeps its own
    setPanelColour(hex) { if (kind === 'plain') panelMat.color.set(hex ?? defaultPanel); },
    dispose() {
      group.removeFromParent();
      for (const g of geoms) g.dispose();
      panelMat.dispose();
      handleMat.dispose();
      for (const m of extra) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
