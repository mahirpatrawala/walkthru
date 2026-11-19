// The tower of the inventory picker in three.js (SPEC 22.3): every unit is one instance of one box mesh, coloured through the instance's own colour, so
// colouring the tower by status is 80 colour writes into one buffer and one draw call (one material, whatever the number of units). It turns with a drag,
// picks a unit with a tap, and draws only when something changed. Loaded lazily by the building page (three.js is not part of the start page's chunk).
import * as THREE from 'three';
import type { UnitStatus } from '../inventory/types';
import { cellColour, COLOURS, clampOrbit, dragOrbit, framing, orbitPosition } from './tower-model';
import type { Orbit, TowerGeometry } from './tower-model';

export interface TowerView {
  setStatuses(units: Record<string, UnitStatus> | null): void;
  setByStatus(on: boolean): void;
  select(id: string | null): void;
  /** stops drawing and frees everything */
  destroy(): void;
  debug: { instances: number; drawCalls(): number; materials(): number; screenOf(id: string): { x: number; y: number } | null; byStatus(): boolean; frames(): number };
}

export interface TowerOptions {
  geometry: TowerGeometry;
  onPick(unitId: string): void;
  statuses?: Record<string, UnitStatus> | null;
  byStatus?: boolean;
  selected?: string | null;
}

/** Null when this browser cannot make a WebGL context: the floor list still works. */
export function mountTowerView(host: HTMLElement, o: TowerOptions): TowerView | null {
  const g = o.geometry;
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); } catch { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = 'bi-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'The tower, in three dimensions. Drag to turn it, tap a flat to pick it, or use the arrow keys. The list beside it does the same.');
  canvas.dataset.testid = 'tower-canvas';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const fr = framing(g);
  const camera = new THREE.PerspectiveCamera(34, 1, 1, fr.radius * 14);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcdbfa8, 1.9));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.3);
  sun.position.set(-0.6, 1, 0.8);
  scene.add(sun);

  // one box, one material, all units as instances
  const box = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(box, material, g.cells.length);
  mesh.frustumCulled = false;
  const m4 = new THREE.Matrix4();
  g.cells.forEach((c, i) => { m4.compose(new THREE.Vector3(c.x, c.y, c.z), new THREE.Quaternion(), new THREE.Vector3(c.w, c.h, c.d)); mesh.setMatrixAt(i, m4); });
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  const indexOf = new Map(g.cells.map((c, i) => [c.unit.id, i] as const));

  // the outlines of every unit, one buffer
  const edgeSrc = new THREE.EdgesGeometry(box);
  const ep = edgeSrc.getAttribute('position') as THREE.BufferAttribute;
  const lines = new Float32Array(g.cells.length * ep.count * 3);
  g.cells.forEach((c, i) => { for (let k = 0; k < ep.count; k++) { const o3 = (i * ep.count + k) * 3; lines[o3] = ep.getX(k) * c.w + c.x; lines[o3 + 1] = ep.getY(k) * c.h + c.y; lines[o3 + 2] = ep.getZ(k) * c.d + c.z; } });
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(lines, 3));
  const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x4a3a30 }));
  edges.frustumCulled = false;
  scene.add(edges);
  edgeSrc.dispose();

  // the base (the lobby and clubhouse levels) and the ground
  const extras: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  if (g.base) {
    const bg = new THREE.BoxGeometry(g.base.w, g.base.h, g.base.d), bm = new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(...COLOURS.base, THREE.SRGBColorSpace) });
    const b = new THREE.Mesh(bg, bm);
    b.position.y = g.base.h / 2 - 0.05;
    scene.add(b); extras.push({ geo: bg, mat: bm });
  }
  const gg = new THREE.CircleGeometry(fr.radius * 2.6, 48), gm = new THREE.MeshLambertMaterial({ color: new THREE.Color().setRGB(0.92, 0.87, 0.78, THREE.SRGBColorSpace) });
  const ground = new THREE.Mesh(gg, gm);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.1;
  scene.add(ground); extras.push({ geo: gg, mat: gm });

  // ---- state
  let statuses = o.statuses ?? null;
  let byStatus = o.byStatus ?? false;
  let selected = o.selected ?? null;
  let hovered: string | null = null;
  let fit = fr.distFor(34, 1);
  let orbit: Orbit = { ...fr.orbit, dist: fit };
  let moved = false; // the person has turned or zoomed: a resize then keeps their view
  let dirty = true, raf = 0, destroyed = false, frames = 0;
  const col = new THREE.Color();

  function paint(): void {
    g.cells.forEach((c, i) => {
      const [r, gr, b] = cellColour(statuses?.[c.unit.id], byStatus, c.unit.id === selected, c.unit.id === hovered);
      col.setRGB(r, gr, b, THREE.SRGBColorSpace);
      mesh.setColorAt(i, col);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  paint();

  function frame(): void {
    raf = 0;
    if (destroyed || !dirty) return;
    dirty = false;
    const p = orbitPosition(orbit, fr.target);
    camera.position.set(p.x, p.y, p.z);
    camera.lookAt(fr.target.x, fr.target.y, fr.target.z);
    renderer.render(scene, camera);
    frames++;
  }
  const want = (): void => { dirty = true; if (!raf && !destroyed) raf = requestAnimationFrame(frame); };

  function resize(): void {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // a narrow canvas needs the tower further away to stay whole
    camera.fov = w / h < 0.9 ? 42 : 34;
    camera.updateProjectionMatrix();
    fit = fr.distFor(camera.fov, camera.aspect);
    orbit = moved ? clampOrbit(orbit, fit) : { ...orbit, dist: fit };
    want();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(host);
  resize();

  // ---- picking and turning
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pickAt(clientX: number, clientY: number): string | null {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    camera.updateMatrixWorld(true);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(mesh, false)[0];
    return hit && hit.instanceId !== undefined ? g.cells[hit.instanceId].unit.id : null;
  }
  let down: { x: number; y: number; id: number; moved: boolean } | null = null;
  canvas.style.touchAction = 'pan-y';
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic event */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (down && e.pointerId === down.id) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) > 6) down.moved = true;
      if (down.moved) {
        // a touch drag that is mostly vertical belongs to the page's scroll (touch-action: pan-y), so only the sideways part reaches us
        moved = true;
        orbit = dragOrbit(orbit, e.clientX - down.x, e.pointerType === 'mouse' ? e.clientY - down.y : 0, canvas.clientWidth, fit);
        down.x = e.clientX; down.y = e.clientY;
        want();
      }
      return;
    }
    if (e.pointerType === 'mouse') {
      const id = pickAt(e.clientX, e.clientY);
      if (id !== hovered) { hovered = id; canvas.style.cursor = id ? 'pointer' : 'grab'; paint(); want(); }
    }
  });
  const end = (e: PointerEvent, cancelled: boolean): void => {
    if (!down || e.pointerId !== down.id) return;
    const moved = down.moved;
    down = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (!moved && !cancelled) { const id = pickAt(e.clientX, e.clientY); if (id) o.onPick(id); }
  };
  canvas.addEventListener('pointerup', (e) => end(e, false));
  canvas.addEventListener('pointercancel', (e) => end(e, true));
  canvas.addEventListener('pointerleave', () => { if (hovered) { hovered = null; paint(); want(); } });
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // the page's own scroll is never taken
    e.preventDefault();
    moved = true;
    orbit = clampOrbit({ ...orbit, dist: orbit.dist * Math.exp(e.deltaY * 0.0015) }, fit);
    want();
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    const step = 0.12;
    let o2: Orbit | null = null;
    if (e.key === 'ArrowLeft') o2 = { ...orbit, yaw: orbit.yaw - step };
    else if (e.key === 'ArrowRight') o2 = { ...orbit, yaw: orbit.yaw + step };
    else if (e.key === 'ArrowUp') o2 = { ...orbit, pitch: orbit.pitch + step / 2 };
    else if (e.key === 'ArrowDown') o2 = { ...orbit, pitch: orbit.pitch - step / 2 };
    else if (e.key === '+' || e.key === '=') o2 = { ...orbit, dist: orbit.dist * 0.9 };
    else if (e.key === '-') o2 = { ...orbit, dist: orbit.dist / 0.9 };
    else if (e.key === '0' || e.key === 'Home') { o2 = { ...fr.orbit, dist: fit }; moved = false; }
    if (!o2) return;
    e.preventDefault();
    if (e.key !== '0' && e.key !== 'Home') moved = true;
    orbit = clampOrbit(o2, fit);
    want();
  });
  canvas.addEventListener('dblclick', () => { orbit = { ...fr.orbit, dist: fit }; moved = false; want(); });
  canvas.style.cursor = 'grab';

  return {
    setStatuses(u) { statuses = u; paint(); want(); },
    setByStatus(on) { byStatus = on; paint(); want(); },
    select(id) { selected = id; paint(); want(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      box.dispose(); material.dispose(); mesh.dispose(); edgeGeo.dispose(); (edges.material as THREE.Material).dispose();
      for (const x of extras) { x.geo.dispose(); x.mat.dispose(); }
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
    debug: {
      instances: g.cells.length,
      drawCalls: () => renderer.info.render.calls,
      materials: () => new Set([material.uuid, ...extras.map((x) => x.mat.uuid), edges.material instanceof THREE.Material ? edges.material.uuid : '']).size,
      screenOf(id) {
        const i = indexOf.get(id);
        if (i === undefined) return null;
        const c = g.cells[i];
        // the face of the box that looks at the camera, not its middle (which a nearer unit can stand in front of)
        const dx = camera.position.x - c.x, dz = camera.position.z - c.z, dl = Math.hypot(dx, dz) || 1;
        const reach = (Math.abs(dz / dl) * c.d / 2 + Math.abs(dx / dl) * c.w / 2) * 0.96;
        const v = new THREE.Vector3(c.x + (dx / dl) * reach, c.y, c.z + (dz / dl) * reach).project(camera);
        const r = canvas.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
      byStatus: () => byStatus,
      frames: () => frames,
    },
  };
}
