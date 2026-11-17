// SPEC 16.24 "Real reflections": a reflection probe per room. When the walker is in a room the room is captured once into a cube (one face a frame, so no
// frame is longer than a face), filtered into a PMREM, and every promoted material reads it with the room's box as the parallax correction (promote.ts):
// metal, glaze, glass and polished stone then show this room and its windows, not a generic sky. Captures are cached per room, invalidated when the light,
// the furniture or the time of day changes, and everything (cubes, PMREM, generator) is freed with `dispose`. No shadow map is re-rendered by a capture.
import * as THREE from 'three';
import type { Layout } from '../../types';
import type { ProbeUniforms } from './promote';

export interface ProbeRoom {
  id: string;
  poly: { x: number; z: number }[];
  min: THREE.Vector3; max: THREE.Vector3;
  /** where the cube is taken from: the point of the room farthest from its walls, at eye height */
  eye: THREE.Vector3;
}

export function pointInPoly(x: number, z: number, poly: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function edgeDistance(x: number, z: number, poly: { x: number; z: number }[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return best;
}

/** the rooms a probe is taken in: every room with a real polygon */
export function probeRooms(layout: Layout, eyeM = 1.35): ProbeRoom[] {
  const out: ProbeRoom[] = [];
  for (const r of layout.rooms) {
    if (r.polygon.length < 3) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of r.polygon) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    let best = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 }, bd = pointInPoly((x0 + x1) / 2, (z0 + z1) / 2, r.polygon) ? edgeDistance((x0 + x1) / 2, (z0 + z1) / 2, r.polygon) : -1;
    for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) {
      const x = x0 + ((x1 - x0) * i) / 10, z = z0 + ((z1 - z0) * j) / 10;
      if (!pointInPoly(x, z, r.polygon)) continue;
      const d = edgeDistance(x, z, r.polygon);
      if (d > bd + 0.05) { bd = d; best = { x, z }; }
    }
    out.push({ id: r.id, poly: r.polygon, min: new THREE.Vector3(x0, 0, z0), max: new THREE.Vector3(x1, Math.max(2.2, layout.wallHeightM), z1), eye: new THREE.Vector3(best.x, Math.min(eyeM, layout.wallHeightM - 0.4), best.z) });
  }
  return out;
}

/** the room the camera is in, or the nearest one when it is in none (a doorway, a balcony) */
export function roomAt(rooms: ProbeRoom[], x: number, z: number): ProbeRoom | null {
  let near: ProbeRoom | null = null, nd = Infinity;
  for (const r of rooms) {
    if (pointInPoly(x, z, r.poly)) return r;
    const d = edgeDistance(x, z, r.poly);
    if (d < nd) { nd = d; near = r; }
  }
  return near;
}

interface Cube { rt: THREE.WebGLCubeRenderTarget; face: number; ready: boolean }
const FACES = 6;

export class RoomProbes {
  private rooms: ProbeRoom[];
  private readonly cubes = new Map<string, Cube>();
  private readonly cam = new THREE.CubeCamera(0.05, 80, new THREE.WebGLCubeRenderTarget(4));
  private pmrem: THREE.PMREMGenerator | null = null;
  private target: THREE.WebGLRenderTarget | null = null;
  private activeId = '';
  private shownId = '';
  private candidate = { id: '', since: 0 };
  private clock = 0;
  private disposed = false;
  /** the texture every promoted material reads (stable: its contents change, the object does not); null until the first room is captured */
  texture: THREE.Texture | null = null;
  onTexture: ((t: THREE.Texture | null) => void) | null = null;
  /** things hidden while a face is rendered (the walker, its shadow) */
  hide: () => THREE.Object3D[] = () => [];
  /** captures finished, for the tests and the report */
  captures = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene, layout: Layout, private readonly u: ProbeUniforms, public size = 256, private readonly boxed = true) {
    this.rooms = probeRooms(layout);
    this.cam.renderTarget.dispose();
    // the six face cameras are only aimed (px, nx, py, ny, pz, nz) by this call, which CubeCamera.update makes itself; a probe that renders the faces one at a time must make it
    this.cam.coordinateSystem = renderer.coordinateSystem;
    this.cam.updateCoordinateSystem();
  }

  setLayout(layout: Layout): void { this.rooms = probeRooms(layout); this.invalidate(); }

  /** the sky's environment changed size (the 2K sky is a larger one): every cube is taken again at the new size */
  resize(size: number): void {
    if (size === this.size) return;
    this.size = size;
    for (const c of this.cubes.values()) c.rt.dispose();
    this.cubes.clear();
    this.target?.dispose();
    this.target = null;
    this.texture = null;
    this.shownId = '';
    this.onTexture?.(null);
  }

  /** the light, the furniture or the hour changed: every cached room is stale; the active one is captured again (the old picture stays until the new one is done) */
  invalidate(): void {
    // a drag of the time slider or of a piece asks again and again: the pictures are retaken once it has been quiet for 0.4 s
    this.staleAt = this.clock + 0.4;
  }
  private staleAt = -1;

  private cubeOf(id: string): Cube {
    let c = this.cubes.get(id);
    if (!c) {
      const rt = new THREE.WebGLCubeRenderTarget(this.size, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      c = { rt, face: 0, ready: false };
      this.cubes.set(id, c);
    }
    return c;
  }

  /** once a frame, before the main render */
  update(dt: number, camX: number, camZ: number): void {
    if (this.disposed || this.rooms.length === 0) return;
    this.clock += dt;
    if (this.staleAt >= 0 && this.clock >= this.staleAt) {
      this.staleAt = -1;
      for (const c of this.cubes.values()) { c.ready = false; c.face = 0; }
    }
    const here = roomAt(this.rooms, camX, camZ);
    if (!here) return;
    if (here.id !== this.activeId) {
      if (this.candidate.id !== here.id) this.candidate = { id: here.id, since: this.clock };
      // a room is taken after the camera has been in it for a moment (not while passing a doorway), and at once for the first
      if (!this.activeId || this.clock - this.candidate.since > 0.25) this.activate(here);
    } else this.candidate.id = '';
    const room = this.rooms.find((r) => r.id === this.activeId);
    if (!room) return;
    const cube = this.cubeOf(room.id);
    if (!cube.ready) this.captureFace(room, cube);
  }

  private activate(room: ProbeRoom): void {
    this.activeId = room.id;
    // the picture and the box it is corrected to change together, when the room's own cube is ready (until then the last room's picture keeps its own box)
    const c = this.cubes.get(room.id);
    if (c?.ready) this.filter(c, room);
  }

  private captureFace(room: ProbeRoom, cube: Cube): void {
    const { renderer, scene } = this;
    const hidden = this.hide().filter((o) => o.visible);
    for (const o of hidden) o.visible = false;
    const prevRT = renderer.getRenderTarget();
    const prevAuto = renderer.shadowMap.autoUpdate;
    const prevXr = renderer.xr.enabled;
    renderer.shadowMap.autoUpdate = false;
    renderer.xr.enabled = false;
    this.cam.position.copy(room.eye);
    this.cam.updateMatrixWorld(true);
    // the faces are cameras of the cube camera (px, nx, py, ny, pz, nz)
    const faceCam = this.cam.children[cube.face] as THREE.PerspectiveCamera;
    renderer.setRenderTarget(cube.rt, cube.face);
    renderer.clear();
    renderer.render(scene, faceCam);
    renderer.setRenderTarget(prevRT);
    renderer.shadowMap.autoUpdate = prevAuto;
    renderer.xr.enabled = prevXr;
    for (const o of hidden) o.visible = true;
    cube.face++;
    if (cube.face >= FACES) {
      cube.face = 0;
      cube.ready = true;
      this.captures++;
      if (room.id === this.activeId) this.filter(cube, room);
    }
  }

  private filter(cube: Cube, room: ProbeRoom): void {
    this.u.uBoxMin.value.copy(room.min); this.u.uBoxMax.value.copy(room.max); this.u.uProbePos.value.copy(room.eye);
    this.u.uBoxOn.value = this.boxed ? 1 : 0;
    this.shownId = room.id;
    this.pmrem ??= new THREE.PMREMGenerator(this.renderer);
    const prevRT = this.renderer.getRenderTarget();
    this.target = this.pmrem.fromCubemap(cube.rt.texture, this.target);
    this.renderer.setRenderTarget(prevRT);
    if (this.texture !== this.target.texture) { this.texture = this.target.texture; this.onTexture?.(this.texture); }
  }

  /** for the checks: the mean linear colour of each face of the active room's cube (px, nx, py, ny, pz, nz), read back */
  faceMeans(): number[][] | null {
    const c = this.cubes.get(this.shownId);
    if (!c) return null;
    const n = c.rt.width, out: number[][] = [];
    const buf = new Uint16Array(n * n * 4);
    for (let f = 0; f < FACES; f++) {
      this.renderer.readRenderTargetPixels(c.rt, 0, 0, n, n, buf, f);
      let r = 0, g = 0, b = 0, lo = Infinity, hi = 0;
      for (let i = 0; i < buf.length; i += 4) {
        const R = THREE.DataUtils.fromHalfFloat(buf[i]), G = THREE.DataUtils.fromHalfFloat(buf[i + 1]), B = THREE.DataUtils.fromHalfFloat(buf[i + 2]);
        r += R; g += G; b += B;
        const l = 0.2126 * R + 0.7152 * G + 0.0722 * B; lo = Math.min(lo, l); hi = Math.max(hi, l);
      }
      const k = n * n;
      out.push([+(r / k).toFixed(3), +(g / k).toFixed(3), +(b / k).toFixed(3), +lo.toFixed(3), +hi.toFixed(3)]);
    }
    return out;
  }

  /** a room's own box and the active room, for the tests */
  get active(): string { return this.activeId; }
  /** the room whose picture the materials are reading now */
  get shown(): string { return this.shownId; }
  get roomList(): readonly ProbeRoom[] { return this.rooms; }
  get cubeCount(): number { return this.cubes.size; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of this.cubes.values()) c.rt.dispose();
    this.cubes.clear();
    this.target?.dispose();
    this.target = null;
    this.pmrem?.dispose();
    this.pmrem = null;
    this.texture = null;
    this.onTexture?.(null);
  }
}
