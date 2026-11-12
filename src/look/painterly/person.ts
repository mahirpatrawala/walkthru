// Owned by C11c. The person in the painting. SPEC 16.7 says the character is hidden; the brief for this build asks for the person to be painted
// too, so this is an addition that can be switched off (`createPainting(..., { person: false })`).
//
// How it maps onto the painter (vendor/oilpaint/src/oilpaint/pins.js, written for Patch's starter man):
//   * the body is a flat underpainting: a SkinnedMesh that shares our character's geometry and skeleton, so it follows every pose,
//     in one plain mid colour per part (skin, top, trousers, shoes, hair);
//   * a few hundred to a few thousand dabs are pinned to the same parts with `pinDabs` and carried through the skeleton each frame;
//   * the figure sits on layer 1 so the painter's own figure-shadow picture (createShade) draws his shadow on the floor.
// Colours are the ones the walk-through shows: the skin tone, the top's tint, the fixed trousers, shoes and hair of people-materials.ts.
import * as THREE from 'three';
import { pinDabs } from '../../../vendor/oilpaint/src/oilpaint/index.js';
import { HAIR, SHOES, SKIN_TONES, TROUSERS, clampTone } from '../people-materials';
import { paintMix } from './palettes';
import type { RGB } from './palettes';

export interface PaintedPerson {
  readonly group: THREE.Group;
  /** call every frame before drawing: the skeleton's matrices, the pinned dabs */
  update(): void;
  /** where he stands, for the figure-shadow picture */
  position(out: THREE.Vector3): THREE.Vector3;
  readonly stats: { pins: number; meshes: string[] };
  dispose(): void;
}

type Role = 'skin' | 'top' | 'bottom' | 'shoes' | 'hair';
const ROLES: Role[] = ['skin', 'top', 'bottom', 'shoes', 'hair'];
/** [across, along] of one dab, metres, and dabs per square metre of the part */
const STYLE: Record<Role, { size: [number, number]; perM2: number }> = {
  skin: { size: [0.02, 0.04], perM2: 2200 },
  top: { size: [0.03, 0.07], perM2: 1500 },
  bottom: { size: [0.03, 0.07], perM2: 1500 },
  shoes: { size: [0.028, 0.055], perM2: 1500 },
  hair: { size: [0.022, 0.05], perM2: 2200 },
};

function hexOf(c: THREE.Color): string { return '#' + c.getHexString(); }

/** a palette for the pins: light, half-tone (the walk-through's colour), shade. The pins are lit by sun only, so the shade mix is
 *  half-way to the painter's shadow: a figure out of the sun is shaded, not black. */
function pinPalette(hex: string): number[][] {
  const m = paintMix(hex);
  const mid = (a: RGB, b: RGB, t: number): number[] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  return [m.l, m.m, mid(m.m, m.s, 0.5), m.m];
}

export function paintPerson(shared: Parameters<typeof pinDabs>[0], character: { object: THREE.Object3D; tone: number }): PaintedPerson | null {
  const skinned: THREE.SkinnedMesh[] = [];
  character.object.traverse((o) => { const s = o as THREE.SkinnedMesh; if (s.isSkinnedMesh && ROLES.includes(s.name as Role)) skinned.push(s); });
  const byRole = new Map<Role, THREE.SkinnedMesh>();
  for (const s of skinned) if (!byRole.has(s.name as Role)) byRole.set(s.name as Role, s);
  if (byRole.size === 0) return null; // the mannequin has none of these parts: nothing to paint

  const colour: Record<Role, string> = {
    skin: SKIN_TONES[clampTone(character.tone)],
    top: byRole.get('top') ? hexOf((byRole.get('top')!.material as THREE.MeshStandardMaterial).color) : '#E8823A',
    bottom: byRole.get('bottom') ? hexOf((byRole.get('bottom')!.material as THREE.MeshStandardMaterial).color) : TROUSERS.male,
    shoes: SHOES,
    hair: HAIR,
  };

  const group = new THREE.Group();
  group.name = 'painted-person';
  const mats: THREE.Material[] = [];
  // flat underpainting: the walk-through's colour a little under, as the kit does for its own faces
  for (const [role, src] of byRole) {
    const [r, g, b] = paintMix(colour[role]).m;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(r * 0.82, g * 0.82, b * 0.82), side: THREE.FrontSide });
    mats.push(mat);
    const sm = new THREE.SkinnedMesh(src.geometry, mat);
    sm.bind(src.skeleton, src.bindMatrix);
    sm.frustumCulled = false;
    sm.layers.enable(1); // he casts a shadow in the painter's figure-shadow picture
    group.add(sm);
  }

  // where clothes cover the skin, no skin dabs: a hash of every clothing vertex (bind pose), then a distance test
  const cover = new Map<string, number>();
  const CELL = 0.05;
  const key = (x: number, y: number, z: number): string => `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
  for (const role of ['top', 'bottom', 'shoes'] as Role[]) {
    const m = byRole.get(role);
    if (!m) continue;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) { const k = key(pos.getX(i), pos.getY(i), pos.getZ(i)); cover.set(k, (cover.get(k) ?? 0) + 1); }
  }
  const covered = (p: THREE.Vector3): boolean => {
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), cz = Math.floor(p.z / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (cover.has(`${cx + dx},${cy + dy},${cz + dz}`)) return true;
    return false;
  };

  const area = (m: THREE.SkinnedMesh): number => {
    const pos = m.geometry.getAttribute('position');
    const idx = m.geometry.getIndex();
    const n = idx ? idx.count : pos.count;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let s = 0;
    for (let i = 0; i + 2 < n; i += 3) {
      const [i0, i1, i2] = idx ? [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)] : [i, i + 1, i + 2];
      a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
      s += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    return s;
  };

  const UP = new THREE.Vector3(0, 1, 0);
  const OUT = new THREE.Vector3(1, 0, 0);
  // the body files are made standing with the arms out sideways (a T): strokes on a sleeve or an arm run along it, everything else runs down
  const bb = (byRole.get('skin') ?? [...byRole.values()][0]).geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute((byRole.get('skin') ?? [...byRole.values()][0]).geometry.getAttribute('position') as THREE.BufferAttribute);
  const armX = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)) * 0.3;
  const armY = bb.min.y + (bb.max.y - bb.min.y) * 0.55;
  const tPose = bb.max.x - bb.min.x > (bb.max.y - bb.min.y) * 0.9;
  const palettes = ROLES.map((r) => pinPalette(colour[r]));
  const parts: Parameters<typeof pinDabs>[2] = [];
  for (const [role, src] of byRole) {
    const st = STYLE[role];
    const exposed = role === 'skin' ? (p: THREE.Vector3): boolean => !covered(p) : undefined;
    parts.push({
      mesh: src,
      count: Math.min(3500, Math.max(40, Math.round(area(src) * st.perM2 * (role === 'skin' ? 0.35 : 1)))),
      accept: exposed,
      style: (p: THREE.Vector3) => ({ pal: ROLES.indexOf(role), size: st.size, dir: tPose && (role === 'skin' || role === 'top') && Math.abs(p.x) > armX && p.y > armY ? OUT : UP }),
    });
  }
  const pins = pinDabs(shared, palettes, parts);
  pins.mesh.layers.set(0);
  group.add(pins.mesh);

  const root = character.object;
  return {
    group,
    update() {
      group.visible = root.visible;
      if (!root.visible) return;
      root.updateMatrixWorld(true);
      pins.update();
    },
    position(out) { return root.getWorldPosition(out); },
    stats: { pins: pins.count, meshes: [...byRole.keys()] },
    dispose() {
      for (const m of mats) m.dispose();
      pins.mesh.geometry.dispose();
      (pins.mesh.material as THREE.Material).dispose();
    },
  };
}
