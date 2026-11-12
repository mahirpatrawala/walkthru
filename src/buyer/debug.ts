// Owned by C3. `?debug=1`: a flat overlay of the collision grid on the floor (SPEC C3 "Debug"). Alpha-blended, debug only.
import * as THREE from 'three';
import { GRID_FREE, GRID_VOID } from '../types';
import type { Grid } from '../types';

export interface GridOverlay {
  /** rebuild the texture from the grid (call after furniture changes) */
  update(grid: Grid): void;
  dispose(): void;
}

/** RGBA for one cell: free = faint green, void = faint grey, obstacle = red that deepens with height. */
export function cellColor(v: number): [number, number, number, number] {
  if (v === GRID_FREE) return [40, 190, 90, 40];
  if (v === GRID_VOID) return [90, 90, 100, 28];
  const k = Math.min(1, v / 250);
  return [220, Math.round(70 - 40 * k), Math.round(70 - 40 * k), 110 + Math.round(90 * k)];
}

export function createGridOverlay(scene: THREE.Scene, grid: Grid): GridOverlay {
  let mesh: THREE.Mesh | null = null;
  let tex: THREE.DataTexture | null = null;

  const build = (g: Grid): void => {
    dispose();
    const { nx, nz, cellM } = g;
    const data = new Uint8Array(nx * nz * 4);
    for (let j = 0; j < nz; j++) {
      // texture row 0 is the plane's max-z edge once the plane is laid flat, so flip rows
      const row = nz - 1 - j;
      for (let i = 0; i < nx; i++) {
        const [r, gg, b, a] = cellColor(g.cells[j * nx + i]);
        const o = (row * nx + i) * 4;
        data[o] = r; data[o + 1] = gg; data[o + 2] = b; data[o + 3] = a;
      }
    }
    tex = new THREE.DataTexture(data, nx, nz, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(nx * cellM, nz * cellM), mat);
    mesh.name = 'debug-grid';
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(g.originX + (nx * cellM) / 2, 0.02, g.originZ + (nz * cellM) / 2);
    mesh.renderOrder = 2;
    scene.add(mesh);
  };

  function dispose(): void {
    if (!mesh) return;
    mesh.removeFromParent();
    mesh.geometry.dispose();
    (mesh.material as THREE.MeshBasicMaterial).dispose();
    tex?.dispose();
    mesh = null;
    tex = null;
  }

  build(grid);
  return { update: build, dispose };
}
