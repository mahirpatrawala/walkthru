// Procedural furniture meshes (SPEC 4.4, "Procedural look"). All boxes, matte, opaque. three only; runs under Node.
import * as THREE from 'three';
import type { FurnitureItem, FurnitureKind, Tone } from '../types';

const DEG = Math.PI / 180;
const TONE_COLOURS: Record<Tone, string> = { good: '#1E9E5A', warn: '#E0A100', bad: '#D64545' };
const TINT_LERP = 0.45;

const C_BED_FRAME = '#8A6F55';
const C_MATTRESS = '#EDEAE4';
const C_PILLOW = '#FFFFFF';
const C_SOFA = '#6E7F8D';
const C_DINING = '#9B7B5C';
const C_CASE = '#C9B79C';
const C_SEAM = '#8E7B5E';

/** Adds an axis-aligned box. (x, z) is the centre in the item's frame, y0..y1 the vertical span. */
function addBox(
  group: THREE.Group, name: string, colour: string,
  x: number, z: number, w: number, d: number, y0: number, y1: number,
): THREE.Mesh {
  const h = Math.max(0.001, y1 - y0);
  const geo = new THREE.BoxGeometry(Math.max(0.001, w), h, Math.max(0.001, d));
  const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.9, metalness: 0 });
  mat.userData.baseColor = mat.color.getHex();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.position.set(x, y0 + h / 2, z);
  group.add(mesh);
  return mesh;
}

function buildBed(g: THREE.Group, item: FurnitureItem): void {
  const { w, d } = item.box;
  const inner = item.inner ?? { w, d };
  addBox(g, 'frame', C_BED_FRAME, 0, 0, w, d, 0, Math.min(0.3, item.surfaceHeightM));
  addBox(g, 'mattress', C_MATTRESS, 0, 0, inner.w, inner.d, 0.3, Math.max(0.31, item.surfaceHeightM));
  // headboard: 0.05 deep across the back, up to the item's height
  addBox(g, 'headboard', C_BED_FRAME, 0, -d / 2 + 0.025, w, 0.05, 0, Math.max(item.heightM, item.surfaceHeightM + 0.05));
  // pillows 0.45 x 0.30 x 0.10 at the head, one for a single bed
  const pz = -inner.d / 2 + 0.15;
  const py = Math.max(0.31, item.surfaceHeightM);
  const xs = inner.w < 1.1 ? [0] : [-inner.w / 4, inner.w / 4];
  xs.forEach((x, i) => addBox(g, `pillow${i}`, C_PILLOW, x, pz, 0.45, 0.3, py, py + 0.1));
}

function buildSofa(g: THREE.Group, item: FurnitureItem): void {
  const { w, d } = item.box;
  const seat = item.surfaceHeightM;
  addBox(g, 'base', C_SOFA, 0, 0, w, d, 0, seat);
  addBox(g, 'backrest', C_SOFA, 0, -d / 2 + 0.125, w, 0.25, 0, item.heightM);
  for (const s of [-1, 1]) addBox(g, s < 0 ? 'arm-left' : 'arm-right', C_SOFA, s * (w / 2 - 0.075), 0, 0.15, d, 0, seat + 0.2);
}

function buildDining(g: THREE.Group, item: FurnitureItem): void {
  const { w, d } = item.box;
  const top = item.surfaceHeightM;
  // the table is 0.9 deep inside the footprint; chairs take the rest
  const tableD = Math.max(0.5, d - 0.8);
  addBox(g, 'top', C_DINING, 0, 0, w, tableD, top - 0.04, top);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    addBox(g, 'leg', C_DINING, sx * (w / 2 - 0.06), sz * (tableD / 2 - 0.06), 0.06, 0.06, 0, top - 0.04);
  }
  const cz = tableD / 2 + 0.19;
  for (const side of [-1, 1]) {
    for (const x of [-0.6, 0, 0.6]) {
      const px = x * (w / 1.8);
      addBox(g, 'chair-seat', C_DINING, px, side * cz, 0.42, 0.42, 0.43, 0.45);
      addBox(g, 'chair-back', C_DINING, px, side * (cz + 0.19), 0.42, 0.04, 0.45, 0.95);
      for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
        addBox(g, 'chair-leg', C_DINING, px + lx * 0.18, side * cz + lz * 0.18, 0.04, 0.04, 0, 0.43);
      }
    }
  }
}

function buildCase(g: THREE.Group, item: FurnitureItem): void {
  const { w, d } = item.box;
  addBox(g, 'body', C_CASE, 0, 0, w, d, 0, item.heightM);
  if (item.kind === 'wardrobe') {
    // 1 cm door seam line down the front centre
    addBox(g, 'seam', C_SEAM, 0, d / 2 + 0.002, 0.01, 0.004, 0.03, Math.max(0.1, item.heightM - 0.03));
  }
}

const BUILDERS: Record<FurnitureKind, (g: THREE.Group, item: FurnitureItem) => void> = {
  bed: buildBed, sofa: buildSofa, dining: buildDining, wardrobe: buildCase, counter: buildCase,
};

/**
 * One group per item, origin at the footprint centre on the floor, local +Z = front, local +X = right (3.1).
 * Positioned at (cx, 0, cz) with rotation.y = yawDeg, so it can be added to the scene as is.
 * Every mesh owns its material (tints are per item); dispose geometries and materials when removing it.
 */
export function buildFurnitureMesh(item: FurnitureItem): THREE.Group {
  const g = new THREE.Group();
  g.name = `furniture:${item.id}`;
  g.userData.itemId = item.id;
  g.userData.kind = item.kind;
  const build = BUILDERS[item.kind];
  if (build) build(g, item);
  else console.error(`[walkthru] buildFurnitureMesh: unknown furniture kind "${String(item.kind)}" on ${item.id}`);
  g.position.set(item.box.cx, 0, item.box.cz);
  g.rotation.y = item.box.yawDeg * DEG;
  g.updateMatrixWorld(true);
  return g;
}

/** Tints every material toward the verdict colour (lerp 0.45 from its own colour). `null` restores the originals. */
export function setFurnitureTint(group: THREE.Group, tone: Tone | null): void {
  const target = tone ? new THREE.Color(TONE_COLOURS[tone]) : null;
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial;
      if (!mat.color) continue;
      if (mat.userData.baseColor === undefined) mat.userData.baseColor = mat.color.getHex();
      mat.color.setHex(mat.userData.baseColor as number);
      if (target) mat.color.lerp(target, TINT_LERP);
    }
  });
}
