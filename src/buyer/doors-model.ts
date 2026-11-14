// The door leaf as a mesh: a flush panel (35 mm, as high as the opening's head less the frame) with a lever handle on both faces.
// Pure three, no DOM. The group's origin is the hinge (or, for a sliding leaf, the leaf's near end) at the floor; its +X runs along
// the panel towards the free edge, so placing it is a translation and one rotation about Y.
import * as THREE from 'three';
import { DOOR_FLOOR_GAP_M, DOOR_THICKNESS_M, leafSegment } from '../core/doors';
import type { Door } from '../core/doors';

export interface DoorModel {
  group: THREE.Group;
  /** put the leaf at `pos` (a hinged leaf's angle in radians, a sliding leaf's travel in metres) */
  setPos(pos: number): void;
  dispose(): void;
}

/** Lever handle height above the floor, metres (a standard 1.0 m). */
const HANDLE_Y_M = 1.0;

export function buildDoorModel(d: Door, frameColor: string): DoorModel {
  const group = new THREE.Group();
  group.name = `door:${d.id}`;
  const T = DOOR_THICKNESS_M;
  const H = Math.max(0.5, d.topM - DOOR_FLOOR_GAP_M);
  const W = d.panelWidthM;
  const panelMat = new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.55, metalness: 0 });
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
  add(new THREE.BoxGeometry(W, H, T), panelMat, 'door-panel', W / 2, DOOR_FLOOR_GAP_M + H / 2, 0);
  // the handle sits by the free edge, on both faces: a round rose and a short lever pointing back along the panel
  const hx = W - 0.07;
  for (const side of [1, -1]) {
    add(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 20), handleMat, 'door-handle', hx, HANDLE_Y_M, side * (T / 2 + 0.006), Math.PI / 2);
    add(new THREE.BoxGeometry(0.115, 0.018, 0.016), handleMat, 'door-handle', hx - 0.045, HANDLE_Y_M - 0.012, side * (T / 2 + 0.034));
    add(new THREE.BoxGeometry(0.018, 0.018, 0.034), handleMat, 'door-handle', hx, HANDLE_Y_M - 0.004, side * (T / 2 + 0.017));
  }
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
    dispose() {
      group.removeFromParent();
      for (const g of geoms) g.dispose();
      panelMat.dispose();
      handleMat.dispose();
    },
  };
}
