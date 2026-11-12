// Owned by C5. The live 3D preview (SPEC 2.2): buildShell + buildFurnitureMesh + OrbitControls, rebuilt after commit().
// The viewer (a WebGL renderer) is created the first time something asks for it, so the page costs nothing until the
// broker opens the preview or a step such as the scan overlay needs `ctx.viewer`.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PropertyFile } from '../types';
import { createViewer } from '../engine/viewer';
import type { Viewer } from '../engine/viewer';
import { buildShell, disposeShell } from '../engine/shell';
import { buildFurnitureMesh } from '../engine/furniture';

export interface Preview {
  /** creates the viewer on first use */
  viewer(): Viewer;
  show(on: boolean): void;
  isVisible(): boolean;
  /** the draft changed: rebuild on the next frame if visible, else when next shown */
  markDirty(): void;
  /** swing the orbit camera to look at the layout */
  frame(): void;
  /** what is currently in the scene, for automated checks */
  stats(): { shellChildren: number; furniture: number; error: string | null };
  dispose(): void;
}

export function createPreview(container: HTMLElement, getProperty: () => PropertyFile): Preview {
  let viewer: Viewer | null = null;
  let controls: OrbitControls | null = null;
  let content: THREE.Group | null = null;
  let shell: THREE.Group | null = null;
  let visible = false;
  let dirty = true;
  let raf = 0;
  let framed = false;
  let lastError: string | null = null;
  let furnitureCount = 0;

  const ensure = (): Viewer => {
    if (viewer) return viewer;
    viewer = createViewer(container, { hasSplat: false });
    controls = new OrbitControls(viewer.camera, viewer.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI * 0.495;
    viewer.onFrame(() => { if (visible) controls?.update(); });
    return viewer;
  };

  const disposeContent = (): void => {
    if (!content || !viewer) return;
    viewer.scene.remove(content);
    if (shell) disposeShell(shell);
    content.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (shell && isInside(m, shell))) return;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.dispose();
    });
    content = null;
    shell = null;
  };

  function isInside(o: THREE.Object3D, root: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
    return false;
  }

  const rebuild = (): void => {
    raf = 0;
    if (!viewer) return;
    dirty = false;
    disposeContent();
    const prop = getProperty();
    try {
      const group = new THREE.Group();
      group.name = 'editor-preview';
      shell = buildShell(prop.layout);
      // seen from above: take the ceilings off
      for (const ch of shell.children) if (ch.name.startsWith('ceiling:')) ch.visible = false;
      group.add(shell);
      furnitureCount = 0;
      for (const f of prop.furniture) {
        try { group.add(buildFurnitureMesh(f)); furnitureCount++; } catch (err) { console.error('[walkthru] preview furniture failed', err); }
      }
      if (prop.layout.rooms.length > 0) {
        const marker = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 16), new THREE.MeshBasicMaterial({ color: '#16a34a' }));
        marker.position.set(prop.spawn.x, 0.25, prop.spawn.z);
        marker.name = 'spawn-marker';
        group.add(marker);
      }
      content = group;
      viewer.scene.add(group);
      lastError = null;
    } catch (err) {
      // a half-drawn layout can fail to build; keep the last good picture off and say why
      lastError = err instanceof Error ? err.message : String(err);
      console.warn('[walkthru] preview rebuild failed:', lastError);
      shell = null;
      content = null;
    }
    if (!framed && prop.layout.rooms.length > 0) frame();
  };

  function frame(): void {
    if (!viewer || !controls) return;
    const prop = getProperty();
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const r of prop.layout.rooms) for (const p of r.polygon) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    if (!isFinite(x0)) { x0 = -2; x1 = 2; z0 = -2; z1 = 2; }
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const r = Math.max(2, Math.hypot(x1 - x0, z1 - z0) / 2);
    const dist = r / Math.tan((viewer.camera.fov * Math.PI) / 360) * 1.15;
    controls.target.set(cx, 0.8, cz);
    viewer.camera.position.set(cx + dist * 0.45, dist * 0.75, cz + dist * 0.75);
    controls.update();
    framed = true;
  }

  return {
    viewer: ensure,
    show(on) {
      visible = on;
      container.style.display = on ? 'block' : 'none';
      if (on) {
        ensure();
        viewer!.renderer.setSize(container.clientWidth || 1, container.clientHeight || 1, false);
        viewer!.camera.aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
        viewer!.camera.updateProjectionMatrix();
        if (dirty) rebuild();
      }
    },
    isVisible: () => visible,
    markDirty() {
      dirty = true;
      if (visible && viewer && !raf) raf = requestAnimationFrame(rebuild);
    },
    frame,
    stats: () => ({ shellChildren: shell?.children.length ?? 0, furniture: furnitureCount, error: lastError }),
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      controls?.dispose();
      disposeContent();
      viewer?.dispose();
      viewer = null;
    },
  };
}
