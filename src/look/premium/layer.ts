// SPEC 16.24 "2K top quality", the material side. While the look is at 2K this layer walks the scene, says what each surface really is (pbr.ts), promotes its
// material to a physical one in place (promote.ts) and gives it the active room's reflection probe (probes.ts). Leaving 2K demotes every material it touched and
// frees the probes. The shell's own shared materials (walls, floors, ceilings: custom shaders), foliage, water and the walker are never touched here.
import * as THREE from 'three';
import type { Layout } from '../../types';
import { classify } from './pbr';
import type { PbrClass } from './pbr';
import { Mirrors } from './mirrors';
import { RoomProbes } from './probes';
import { demote, isPromoted, makeProbeUniforms, promote, promotedClass } from './promote';
import type { ProbeUniforms } from './promote';

export interface PremiumStats { shown: string; mirrors: number; mirrorsDrawn: number; promoted: number; byClass: Partial<Record<PbrClass, number>>; probes: number; captures: number; active: string }

export interface PremiumOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  layout: Layout;
  /** open-air: the box of a room means nothing, the probe is only a sky and a ground */
  outdoor: boolean;
  /** the walker and anything else a probe must not see */
  hide: () => THREE.Object3D[];
}

/** a mesh the layer leaves alone: the walker, a sky, an overlay, instanced foliage */
function skip(o: THREE.Object3D): boolean {
  if ((o as THREE.SkinnedMesh).isSkinnedMesh || (o as THREE.InstancedMesh).isInstancedMesh) return true;
  if (o.userData.noPremium) return true;
  return false;
}

export class PremiumLayer {
  private readonly u: ProbeUniforms = makeProbeUniforms();
  private probes: RoomProbes | null = null;
  private mirrors: Mirrors | null = null;
  /** the shell's window panes, which the 2K level draws as real glass (their own thin blue-white sheet is put back when it is left) */
  private panes: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; glass: THREE.MeshStandardMaterial }[] = [];
  private readonly mats = new Set<THREE.MeshStandardMaterial>();
  private on = false;
  private clock = 0;
  private opts: PremiumOptions;

  constructor(opts: PremiumOptions) { this.opts = opts; }

  get enabled(): boolean { return this.on; }

  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (on) {
      // the probe is laid out like the sky's environment (a cube of the same size), so the one cube-UV lookup of the shader reads either
      this.probes = new RoomProbes(this.opts.renderer, this.opts.scene, this.opts.layout, this.u, this.envSize(), !this.opts.outdoor);
      this.probes.hide = this.opts.hide;
      this.mirrors = new Mirrors(this.opts.renderer, this.opts.scene);
      this.probes.onTexture = (t) => {
        // a probe laid out differently from the sky's environment would be read with the wrong cube-UV constants: keep the sky's reflection then
        const env = this.opts.scene.environment as (THREE.Texture & { image?: { height?: number } }) | null;
        const same = !t || !env?.image?.height || (t as THREE.Texture & { image: { height: number } }).image.height === env.image.height;
        if (!same) console.warn('[walkthru] room probe is not the size of the sky environment: reflections stay the sky\'s');
        this.u.uProbeMap.value = same ? t : null; this.u.uProbeOn.value = t && same ? 1 : 0;
      };
      this.rescan();
    } else {
      for (const m of this.mats) demote(m);
      this.mats.clear();
      for (const p of this.panes) { p.mesh.material = p.original; demote(p.glass); p.glass.dispose(); }
      this.panes = [];
      this.mirrors?.dispose();
      this.mirrors = null;
      this.probes?.dispose();
      this.probes = null;
      this.u.uProbeMap.value = null; this.u.uProbeOn.value = 0;
    }
  }

  /** a rebuilt piece has new materials, a new room has new furniture: find what is not promoted yet */
  rescan(): void {
    if (!this.on) return;
    const seen = new Set<THREE.MeshStandardMaterial>();
    this.opts.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || skip(o)) return;
      const arr = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of arr) {
        if (isPromoted(m)) { seen.add(m as THREE.MeshStandardMaterial); continue; }
        if (m.type !== 'MeshStandardMaterial' || m.userData.shared === true) continue;
        const std = m as THREE.MeshStandardMaterial;
        const cls = classify({
          mat: std.name, part: mesh.name, parent: mesh.parent?.name ?? '',
          rgb: [std.color.r, std.color.g, std.color.b], roughness: std.roughness, metalness: std.metalness,
          transparent: std.transparent, vertexColors: !!std.vertexColors, emissive: std.emissiveIntensity > 0.05 && std.emissive.getHex() !== 0,
          decor: std.userData.decor === true, tag: std.userData.pbr as PbrClass | undefined,
        });
        if (!cls) continue;
        promote(std, cls, this.u);
        seen.add(std);
      }
    });
    this.mirrors?.rescan();
    this.glaze();
    // a material that no mesh uses any more (a piece was rebuilt and its old parts disposed) is forgotten
    this.mats.clear();
    for (const m of seen) this.mats.add(m);
  }

  /** the shell's panes (one mesh named `panes`, a thin pale sheet) become real glass: clear, a faint reflection of the room, more at a low angle */
  private glaze(): void {
    const meshes: THREE.Mesh[] = [];
    this.opts.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.name === 'panes' && !this.panes.some((p) => p.mesh === m)) meshes.push(m); });
    for (const mesh of meshes) {
      const glass = new THREE.MeshStandardMaterial({ color: '#F4F9FB', roughness: 0.04, metalness: 0, side: THREE.DoubleSide, name: 'pane-glass' });
      glass.userData.noBaked = true;
      promote(glass, 'glass', this.u);
      this.panes.push({ mesh, original: mesh.material, glass });
      mesh.material = glass;
    }
  }

  /** the active room's filtered picture, or null (the pool's water mirrors it) */
  get probeTexture(): THREE.Texture | null { return this.on ? this.u.uProbeMap.value : null; }

  /** once a frame before the main render: the nearest mirrors that face the camera are drawn again from the mirrored camera */
  updateMirrors(camera: THREE.PerspectiveCamera): void { this.mirrors?.update(camera, this.opts.hide()); }

  /** the uniforms every promoted material shares, for the checks (a capture script drives them) */
  get uniforms(): ProbeUniforms { return this.u; }

  faceMeans(): number[][] | null { return this.probes?.faceMeans() ?? null; }

  /** the light, the hour or the furniture changed: every probe picture is stale */
  invalidate(): void { this.probes?.invalidate(); }

  update(dt: number, camX: number, camZ: number): void {
    if (!this.on) return;
    this.clock += dt;
    if (this.clock > 1) { this.clock = 0; this.rescan(); }
    if (this.probes) {
      const want = this.envSize();
      if (want !== this.probes.size) this.probes.resize(want);
      this.probes.update(dt, camX, camZ);
    }
  }

  /** the probe is a cube of the size the sky's environment was filtered from, so the one cube-UV lookup of the shader reads either */
  private envSize(): number {
    const env = this.opts.scene.environment as (THREE.Texture & { image?: { height?: number } }) | null;
    return env?.image?.height ? Math.max(64, Math.min(512, Math.round(env.image.height / 4))) : 256;
  }

  setLayout(layout: Layout): void { this.opts = { ...this.opts, layout }; this.probes?.setLayout(layout); }

  stats(): PremiumStats {
    const byClass: Partial<Record<PbrClass, number>> = {};
    for (const m of this.mats) { const c = promotedClass(m); if (c) byClass[c] = (byClass[c] ?? 0) + 1; }
    return { promoted: this.mats.size, byClass, probes: this.probes?.cubeCount ?? 0, mirrors: this.mirrors?.count ?? 0, mirrorsDrawn: this.mirrors?.active ?? 0, captures: this.probes?.captures ?? 0, active: this.probes?.active ?? '', shown: this.probes?.shown ?? '' };
  }

  dispose(): void { this.setEnabled(false); }
}
