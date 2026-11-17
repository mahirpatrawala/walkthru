// The door leaf as a mesh: a flush panel (35 mm, as high as the opening's head less the frame) with a lever handle on both faces.
// Pure three, no DOM. The group's origin is the hinge (or, for a sliding leaf, the leaf's near end) at the floor; its +X runs along
// the panel towards the free edge, so placing it is a translation and one rotation about Y.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_NOISE, GLSL_WOOD } from '../look/procedural';
import { furnitureKit } from '../look/furniture-materials';
import { DOOR_FLOOR_GAP_M, DOOR_THICKNESS_M, fixedPaneSegment, leafSegment } from '../core/doors';
import type { Door } from '../core/doors';
import type { DoorStyle } from '../building/space-host';

export interface DoorModel {
  group: THREE.Group;
  /** put the leaf at `pos` (a hinged leaf's angle in radians, a sliding leaf's travel in metres) */
  setPos(pos: number): void;
  /** the panel's colour from the active style (a wood or laminate finish), or null for the default teak laminate */
  setPanelColour(hex: string | null): void;
  /** the style's whole door finish: a colour and whether the wood grain shows (a wood), or null for the default teak laminate */
  setPanelFinish(f: { colour: string; grain: boolean } | null): void;
  /** the style's hardware colour (handles, hinges, plates), or null for brushed steel */
  setHandleColour(hex: string | null): void;
  dispose(): void;
}

/** Lever handle height above the floor, metres (a standard 1.0 m). */
const HANDLE_Y_M = 1.0;

/** A plate or sign with text on it, as a canvas texture (none under Node, where there is no canvas: the plate is then plain). Drawn at 1,024 px wide: read from 1 m on a 2x screen it is as sharp as the wall (SPEC 16.18). */
function textTexture(text: string, w: number, h: number, bg: string, fg: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const K = 4;
  const c = document.createElement('canvas');
  c.width = 256 * K; c.height = Math.max(32, Math.round(256 * (h / w))) * K;
  const g = c.getContext('2d');
  if (!g) return null;
  g.scale(K, K);
  const W = 256, H = c.height / K;
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = fg; g.globalAlpha = 0.5; g.lineWidth = 4; g.strokeRect(6, 6, W - 12, H - 12); g.globalAlpha = 1;
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 ${Math.round(H * (text.length > 5 ? 0.34 : 0.56))}px system-ui, sans-serif`;
  g.fillText(text, W / 2, H / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** A door leaf's lacquered wood: the colour, times a grain computed from the position on the leaf (vertical grain, in metres), so it is sharp at any distance (SPEC 16.18). */
function woodLeafMaterial(color: THREE.Color, roughness: number): { mat: THREE.MeshStandardMaterial; grain: { value: number } } {
  // a lacquered finish: a thin clear coat over the wood, so a window or a lamp leaves a soft highlight on the leaf
  const mat = new THREE.MeshPhysicalMaterial({ color, roughness: Math.max(roughness, 0.3), metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.18 });
  const grain = { value: 1 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWood = grain;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWoodP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWoodP = position;')
      // the leaf's UV runs 0..1 over a face: the (optional) realistic normal map repeats 0.6 m, grain running up the leaf
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_NORMALMAP\nvNormalMapUv *= vec2(1.5, 3.5);\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWoodP;\nuniform float uWood;\n${GLSL_NOISE}\n${GLSL_WOOD}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
if (uWood > 0.5) {
  vec2 g = vec2(vWoodP.y, vWoodP.x + vWoodP.z * 3.7);
  diffuseColor.rgb *= lkWoodTone(g, max(fwidth(g.x), fwidth(g.y)));
}`);
  };
  mat.customProgramCacheKey = () => 'walkthru-door-wood-v3';
  return { mat, grain };
}

/** The lever set of one face: a round rose, a neck and a lever pointing back along the leaf, a long plate behind with a key slot (merged into one geometry). Built for the +z face; mirrored for -z. */
function leverGeometry(hx: number, hy: number, z0: number, side: 1 | -1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const put = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0): void => {
    g.rotateX(rx); g.rotateZ(rz);
    g.translate(x, y, z * side);
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  const plate = new THREE.BoxGeometry(0.04, 0.2, 0.004);
  put(plate, hx, hy - 0.03, z0 + 0.002);
  put(new THREE.CylinderGeometry(0.0275, 0.0275, 0.01, 24), hx, hy, z0 + 0.009, Math.PI / 2);
  put(new THREE.CylinderGeometry(0.0095, 0.0095, 0.034, 14), hx, hy, z0 + 0.03, Math.PI / 2);
  put(new THREE.CylinderGeometry(0.0085, 0.0085, 0.13, 14), hx - 0.065, hy - 0.004, z0 + 0.044, 0, Math.PI / 2);
  put(new THREE.SphereGeometry(0.0085, 12, 8), hx - 0.13, hy - 0.004, z0 + 0.044);
  put(new THREE.CylinderGeometry(0.0085, 0.0085, 0.02, 12), hx, hy - 0.004, z0 + 0.04, Math.PI / 2);
  put(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 16), hx, hy - 0.095, z0 + 0.007, Math.PI / 2);
  return mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
}

/** Three hinge knuckles on the hinge edge (a barrel 15 mm across, 95 mm long), merged. */
function hingeGeometry(H: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const y of [0.24, H * 0.5 + 0.02, H - 0.2]) {
    const g = new THREE.CylinderGeometry(0.0075, 0.0075, 0.095, 12);
    g.translate(-0.0005, DOOR_FLOOR_GAP_M + y, 0);
    parts.push(g.toNonIndexed());
  }
  return mergeGeometries(parts, false) ?? new THREE.BufferGeometry();
}

export function buildDoorModel(d: Door, frameColor: string, style?: DoorStyle): DoorModel {
  // `root` stays where the door is; `group` is the leaf that moves (a sliding door's fixed pane is a child of the root)
  const root = new THREE.Group();
  root.name = `door:${d.id}`;
  const group = new THREE.Group();
  group.name = `leaf:${d.id}`;
  root.add(group);
  const kind = style?.kind ?? 'plain';
  // a sliding leaf is the balcony's glazed door (an aluminium frame round tinted glass), not a flush panel; a building's portal styles keep their own look
  const glazed = kind === 'glass' || (kind === 'plain' && d.kind === 'sliding');
  // a building's main door is a heavier slab; the rest keep the 35 mm flush leaf
  const T = kind === 'main' ? 0.045 : glazed ? 0.04 : DOOR_THICKNESS_M;
  const H = Math.max(0.5, d.topM - DOOR_FLOOR_GAP_M);
  const W = d.panelWidthM;
  // a teak-laminate flush door: lighter than the dark frame so the panel reads as wood, not a black slab
  const defaultPanel = kind === 'main' ? new THREE.Color('#806750') : kind === 'lift' ? new THREE.Color('#D9DDDF') : kind === 'stairs' ? new THREE.Color('#6F8076') : kind === 'glass' ? new THREE.Color('#2B3033') : new THREE.Color(frameColor).lerp(new THREE.Color('#A9794E'), 0.75);
  const wood = woodLeafMaterial(defaultPanel.clone(), kind === 'lift' ? 0.45 : 0.42);
  const panelMat = wood.mat;
  panelMat.metalness = kind === 'lift' ? 0.3 : kind === 'glass' ? 0.6 : 0;
  // a plain flush door is wood or laminate (grain on by default); a lift, glass or stairs door is a plain colour
  wood.grain.value = kind === 'plain' || kind === 'main' ? 1 : 0;
  // SPEC 16.21: with the Realistic materials layer on, a laminate or veneer leaf gets a fine photographed grain in its normal map, which the clear coat turns into a soft sheen
  if (kind === 'plain' && !glazed) furnitureKit.adopt(panelMat, 'laminate', 0.9);
  // the dark groove round the leaf's face: a slab the leaf's own size, a hair behind the face, under a core a little smaller
  const gapMat = new THREE.MeshStandardMaterial({ color: '#8C847A', roughness: 0.9 });
  const styled = kind !== 'plain';
  const extra: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const handleMat = new THREE.MeshStandardMaterial({ color: '#B9B4AA', roughness: 0.32, metalness: 0.75 });
  const DEFAULT_HANDLE = new THREE.Color('#B9B4AA');
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
  if (glazed) {
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
    // the leaf: a core with eased edges (2.5 mm) over a dark slab of the leaf's full size, so a fine shadow groove runs round the face. The size, thickness and place are the door's.
    add(new THREE.BoxGeometry(W, H, T - 0.004), gapMat, 'door-gap', W / 2, DOOR_FLOOR_GAP_M + H / 2, 0).castShadow = false;
    add(new RoundedBoxGeometry(W - 0.005, H - 0.005, T, 2, 0.0025), panelMat, 'door-panel', W / 2, DOOR_FLOOR_GAP_M + H / 2, 0);
    if (kind !== 'lift') add(hingeGeometry(H), handleMat, 'door-hinges', 0, 0, 0);
  }
  if (glazed && d.kind === 'sliding' && d.panes === 2) {
    // the fixed pane of the pair: the far half of the opening, never moving, a hair behind the sliding pane so the two do not fight where they overlap when shut
    const fx = fixedPaneSegment(d);
    const fixed = new THREE.Group();
    fixed.name = `fixed-pane:${d.id}`;
    const frame = mat(new THREE.MeshStandardMaterial({ color: '#C5CBCF', roughness: 0.32, metalness: 0.55 }));
    const glass = mat(new THREE.MeshPhysicalMaterial({ color: '#9DBFC8', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.3, specularIntensity: 1, envMapIntensity: 1.6, side: THREE.DoubleSide }));
    const stile = 0.045, rail = 0.045, railLow = 0.12;
    const addF = (g: THREE.BufferGeometry, m: THREE.Material, name: string, x: number, y: number): void => {
      geoms.push(g);
      const me = new THREE.Mesh(g, m);
      me.name = name; me.position.set(x, y, 0); me.castShadow = name !== 'door-glass'; me.receiveShadow = true;
      fixed.add(me);
    };
    addF(new THREE.BoxGeometry(stile, H, T), frame, 'door-frame', stile / 2, DOOR_FLOOR_GAP_M + H / 2);
    addF(new THREE.BoxGeometry(stile, H, T), frame, 'door-frame', W - stile / 2, DOOR_FLOOR_GAP_M + H / 2);
    addF(new THREE.BoxGeometry(W - 2 * stile, rail, T), frame, 'door-frame', W / 2, DOOR_FLOOR_GAP_M + H - rail / 2);
    addF(new THREE.BoxGeometry(W - 2 * stile, railLow, T), frame, 'door-frame', W / 2, DOOR_FLOOR_GAP_M + railLow / 2);
    addF(new THREE.BoxGeometry(W - 2 * stile, H - rail - railLow, 0.008), glass, 'door-glass', W / 2, DOOR_FLOOR_GAP_M + railLow + (H - rail - railLow) / 2);
    fixed.position.set(fx.a.x - d.swingNormal.x * 0.012, 0, fx.a.z - d.swingNormal.z * 0.012);
    fixed.rotation.y = Math.atan2(-fx.dir.z, fx.dir.x);
    root.add(fixed);
  }
  if (kind === 'lift') {
    // two leaves meeting in the middle, a dark joint and a pair of call-button plates beside the opening are drawn by the lobby
    const dark = mat(new THREE.MeshStandardMaterial({ color: '#2A2C2E', roughness: 0.6 }));
    for (const sd of [1, -1]) add(new THREE.BoxGeometry(0.008, H - 0.02, 0.004), dark, 'door-joint', W / 2, DOOR_FLOOR_GAP_M + H / 2, sd * (T / 2 + 0.002));
    // a brushed-steel surround (10 cm wide, a head 10 cm deep, standing 16 mm proud of the wall on both faces) and a call-button plate beside it at 1.05 m
    const steel = mat(new THREE.MeshStandardMaterial({ color: '#B4B8BB', roughness: 0.36, metalness: 0.4 }));
    const lit = mat(new THREE.MeshStandardMaterial({ color: '#E9E6DF', roughness: 0.3, metalness: 0.2, emissive: new THREE.Color('#FFD9A0'), emissiveIntensity: 0.35 }));
    const wd = Math.max(0.12, d.depth) + 0.032, headTop = Math.max(d.headM, d.topM) + 0.1;
    add(new THREE.BoxGeometry(0.1, headTop, wd), steel, 'lift-surround', -0.1, headTop / 2, 0);
    add(new THREE.BoxGeometry(0.1, headTop, wd), steel, 'lift-surround', W + 0.1, headTop / 2, 0);
    add(new THREE.BoxGeometry(W + 0.3, 0.1, wd), steel, 'lift-surround', W / 2, headTop - 0.05, 0);
    for (const sd of [1, -1]) {
      const zf = sd * (Math.max(0.12, d.depth) / 2 + 0.004);
      add(new THREE.BoxGeometry(0.09, 0.2, 0.008), steel, 'lift-call-plate', W + 0.28, 1.05, zf);
      for (const by of [1.1, 1.0]) add(new THREE.CylinderGeometry(0.014, 0.014, 0.006, 16).rotateX(Math.PI / 2), lit, 'lift-call-button', W + 0.28, by, zf + sd * 0.006);
    }
  } else if (kind === 'stairs') {
    const glass = mat(new THREE.MeshStandardMaterial({ color: '#BFDDE2', roughness: 0.1, transparent: true, opacity: 0.45 }));
    for (const sd of [1, -1]) add(new THREE.BoxGeometry(0.22, 0.55, 0.004), glass, 'door-vision', W / 2, 1.55, sd * (T / 2 + 0.002));
  }
  // the handle sits by the free edge, on both faces: a lever set (rose, neck, lever, long plate with a key slot)
  const hx = W - 0.07;
  if (!glazed && kind !== 'lift') for (const side of [1, -1] as const) {
    add(leverGeometry(hx, HANDLE_Y_M, T / 2, side), handleMat, 'door-handle', 0, 0, 0);
  }
  // a number plate (a flat's door) or a sign (the stairs), on the face the style names
  if (style?.text) {
    const plateW = style.kind === 'stairs' ? 0.34 : style.kind === 'main' ? 0.32 : 0.2, plateH = style.kind === 'main' ? 0.15 : 0.1; // a flat's main door: a number plate that reads from down the corridor
    const tex = style.kind === 'stairs' ? textTexture(style.text, plateW, plateH, '#1F5A3B', '#FFFFFF') : textTexture(style.text, plateW, plateH, '#B08D3C', '#2B1D10');
    if (tex) textures.push(tex);
    const plate = mat(new THREE.MeshStandardMaterial({ color: tex ? '#FFFFFF' : '#B08D3C', map: tex ?? null, roughness: 0.4, metalness: tex ? 0 : 0.7 }));
    add(new THREE.BoxGeometry(plateW, plateH, 0.008), plate, 'door-plate', W / 2, style.kind === 'stairs' ? 1.95 : 1.55, plateSide * (T / 2 + 0.004));
  }
  void styled;
  group.userData.doorId = d.id;
  root.userData.doorId = d.id;
  const setPos = (pos: number): void => {
    const s = leafSegment(d, pos);
    group.position.set(s.a.x, 0, s.a.z);
    // local +X (1, 0, 0) turned by rotation.y = t points at (cos t, 0, -sin t)
    group.rotation.y = Math.atan2(-s.dir.z, s.dir.x);
    group.updateMatrixWorld(true);
  };
  setPos(0);
  return {
    group: root,
    setPos,
    // the style's door finish is for ordinary doors; a main, lift or stairs door keeps its own
    setPanelColour(hex) { if (kind === 'plain') panelMat.color.set(hex ?? defaultPanel); },
    setPanelFinish(f) {
      if (kind !== 'plain') return;
      panelMat.color.set(f ? f.colour : defaultPanel);
      wood.grain.value = f ? (f.grain ? 1 : 0) : 1;
    },
    setHandleColour(hex) {
      // a dark finish is a coated metal: part diffuse, so it keeps a shape and a highlight instead of reading as a black hole
      handleMat.color.set(hex ?? DEFAULT_HANDLE); handleMat.roughness = hex ? 0.34 : 0.32; handleMat.metalness = hex ? 0.3 : 0.75;
    },
    dispose() {
      root.removeFromParent();
      for (const g of geoms) g.dispose();
      panelMat.dispose();
      gapMat.dispose();
      handleMat.dispose();
      for (const m of extra) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
