// Owned by C11a (look-light). SPEC 16.5 "Interior lights". Fixtures (tube lights, cove lights, fan lights, lamps) declare themselves with
// `object.userData.walkthruLight = 'tube' | 'cove' | 'fan' | 'lamp'` (or through Look.registerInteriorLight). The time of day then
// drives them: a mesh's emissive intensity, a THREE.Light's intensity, and a small POOL of real point lights that this class moves to
// the fixtures nearest the walker (so a flat of 20 fixtures costs the same as one of 2). With no fixtures at all, each room gets one
// virtual ceiling point so Night and Evening still light the rooms. Pure three, no DOM; it runs under Node.
import * as THREE from 'three';
import { roomAt } from '../core/layout-geom';
import type { Layout, Vec2 } from '../types';
import { interiorLevel } from './grade';
import type { Grade, InteriorLightKind } from './grade';

export const LIGHT_KINDS: InteriorLightKind[] = ['tube', 'cove', 'fan', 'lamp'];
export function isLightKind(v: unknown): v is InteriorLightKind { return typeof v === 'string' && (LIGHT_KINDS as string[]).includes(v); }

/** colour and full-power intensity (candela) of the pooled point light a fixture of each kind gets; a flat is lit by about 2 to 4 of them */
const POOL_LIGHT: Record<InteriorLightKind, { colour: string; intensity: number }> = {
  tube: { colour: '#FFE2BC', intensity: 9 },
  cove: { colour: '#FFC48A', intensity: 7 },
  fan: { colour: '#FFE6C4', intensity: 7 },
  lamp: { colour: '#FFC892', intensity: 6 },
};
const POOL_DISTANCE = 6.5;

interface Emitter {
  obj: THREE.Object3D | null;
  kind: InteriorLightKind;
  /** world position the pooled light takes */ pos: THREE.Vector3;
  roomId: string | null;
  virtual: boolean;
}

interface PoolSlot {
  light: THREE.PointLight;
  emitter: Emitter | null;
  /** 0..1 fade of this slot, so a light that changes fixture dims out, moves, and comes back instead of popping */
  fade: number;
  want: Emitter | null;
}

export class InteriorLights {
  private emitters: Emitter[] = [];
  private registered = new Set<THREE.Object3D>();
  private roots: THREE.Object3D[] = [];
  private pool: PoolSlot[] = [];
  private poolSize = 0;
  private grade: Grade | null = null;
  private layout: Layout;
  private clock = 0;
  private scanned = false;
  /** the real fixtures found by the last scan (meshes, lights) with the level they are driven at */
  private driven: Array<{ obj: THREE.Object3D; kind: InteriorLightKind }> = [];

  constructor(private readonly scene: THREE.Scene, layout: Layout) { this.layout = layout; }

  setLayout(layout: Layout): void { this.layout = layout; this.scanned = false; }
  setRoots(roots: Array<THREE.Object3D | undefined>): void { this.roots = roots.filter((r): r is THREE.Object3D => !!r); this.scanned = false; }

  register(obj: THREE.Object3D, kind: InteriorLightKind): void {
    obj.userData.walkthruLight = kind;
    this.registered.add(obj);
    this.scanned = false;
  }

  /** how many pooled real lights to keep (0 on the low tier: emissive fixtures only) */
  setPoolSize(n: number): void {
    if (n === this.poolSize) return;
    this.poolSize = n;
    while (this.pool.length > n) { const s = this.pool.pop()!; this.scene.remove(s.light); s.light.dispose(); }
    while (this.pool.length < n) {
      const light = new THREE.PointLight('#ffffff', 0, POOL_DISTANCE, 2);
      light.castShadow = false;
      light.visible = false;
      light.name = 'interior-pool';
      this.scene.add(light);
      this.pool.push({ light, emitter: null, fade: 0, want: null });
    }
  }

  setGrade(g: Grade): void { this.grade = g; this.apply(); }

  /** number of real fixtures found plus virtual room lights (for tests and the debug hook) */
  count(): { fixtures: number; virtual: number } {
    this.scan();
    return { fixtures: this.emitters.filter((e) => !e.virtual).length, virtual: this.emitters.filter((e) => e.virtual).length };
  }

  /** Walks the roots for `userData.walkthruLight`. Call after fixtures are added; Look does it on attach(), refresh() and setLayout(). */
  scan(force = false): void {
    if (this.scanned && !force) return;
    this.scanned = true;
    this.driven = [];
    const found: Emitter[] = [];
    const seen = new Set<THREE.Object3D>();
    const visit = (o: THREE.Object3D): void => {
      if (seen.has(o)) return;
      seen.add(o);
      const k = o.userData?.walkthruLight;
      if (isLightKind(k)) {
        this.driven.push({ obj: o, kind: k });
        if (!(o as THREE.Light).isLight) found.push(this.emitterFor(o, k));
        else if (o.userData.walkthruPool === true) found.push(this.emitterFor(o, k));
        // children of a fixture group are driven by the group's kind unless they declare their own
        o.traverse((c) => { if (c !== o && c.userData?.walkthruLight === undefined) { seen.add(c); if ((c as THREE.Mesh).isMesh || (c as THREE.Light).isLight) this.driven.push({ obj: c, kind: k }); } });
        return;
      }
      for (const c of o.children) visit(c);
    };
    for (const r of this.roots) visit(r);
    for (const r of this.registered) visit(r);
    if (found.length === 0) {
      for (const room of this.layout.rooms) {
        if (room.roomType === 'balcony' || room.polygon.length < 3) continue;
        let cx = 0, cz = 0;
        for (const p of room.polygon) { cx += p.x; cz += p.z; }
        cx /= room.polygon.length; cz /= room.polygon.length;
        const kind: InteriorLightKind = room.roomType === 'living' ? 'cove' : 'tube';
        found.push({ obj: null, kind, pos: new THREE.Vector3(cx, this.layout.wallHeightM - 0.25, cz), roomId: room.id, virtual: true });
      }
    }
    this.emitters = found;
    for (const s of this.pool) { s.emitter = null; s.want = null; }
    this.apply();
  }

  private emitterFor(o: THREE.Object3D, kind: InteriorLightKind): Emitter {
    o.updateWorldMatrix(true, true);
    const pos = new THREE.Vector3();
    if ((o as THREE.Light).isLight) o.getWorldPosition(pos);
    else {
      const box = new THREE.Box3().setFromObject(o);
      if (box.isEmpty()) o.getWorldPosition(pos);
      else { box.getCenter(pos); pos.y = kind === 'cove' ? box.max.y : box.min.y - 0.05; }
    }
    const room = roomAt(this.layout, { x: pos.x, z: pos.z });
    return { obj: o, kind, pos, roomId: room?.id ?? null, virtual: false };
  }

  /** Sets the level of every fixture for the current grade. Cheap: no scene traversal. */
  apply(): void {
    const g = this.grade;
    if (!g) return;
    for (const d of this.driven) {
      const level = interiorLevel(d.kind, g);
      const o = d.obj;
      if ((o as THREE.Light).isLight) {
        const l = o as THREE.PointLight;
        l.userData.walkthruBase ??= l.intensity;
        l.intensity = (l.userData.walkthruBase as number) * level;
        l.visible = level > 0.01;
      } else if ((o as THREE.Mesh).isMesh) {
        const mats = ((o as THREE.Mesh).material ? ([] as THREE.Material[]).concat((o as THREE.Mesh).material as THREE.Material | THREE.Material[]) : []) as THREE.MeshStandardMaterial[];
        for (const m of mats) {
          if (m.emissiveIntensity === undefined || !m.emissive) continue;
          m.userData.walkthruBase ??= m.emissiveIntensity;
          m.emissiveIntensity = (m.userData.walkthruBase as number) * level;
        }
      }
    }
    // pool: levels follow the grade; positions follow the walker in update()
    for (const s of this.pool) this.styleSlot(s);
  }

  private styleSlot(s: PoolSlot): void {
    const g = this.grade;
    if (!g) return;
    // `visible` follows the grade, not the slot, so the number of lights in the shaders only changes when the preset crosses on/off
    // (three recompiles every lit material when it does)
    s.light.visible = Math.max(g.interior.tube, g.interior.cove) > 0.01;
    if (!s.emitter) { s.light.intensity = 0; return; }
    const level = interiorLevel(s.emitter.kind, g) * s.fade;
    const spec = POOL_LIGHT[s.emitter.kind];
    s.light.color.set(spec.colour);
    s.light.intensity = spec.intensity * level;
  }

  /** Move the pooled lights to the fixtures nearest the walker. Call once a frame with the camera position and dt in seconds. */
  update(dt: number, at: Vec2): void {
    if (this.pool.length === 0 || !this.grade) return;
    this.scan();
    const g = this.grade;
    const anyOn = Math.max(g.interior.tube, g.interior.cove) > 0.01;
    this.clock += dt;
    if (anyOn && this.clock > 0.2) {
      this.clock = 0;
      const here = roomAt(this.layout, at)?.id ?? null;
      const ranked = this.emitters
        .filter((e) => interiorLevel(e.kind, g) > 0.01)
        .map((e) => ({ e, d: Math.hypot(e.pos.x - at.x, e.pos.z - at.z) + (e.roomId === here ? 0 : 6) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, this.pool.length)
        .map((x) => x.e);
      // keep slots that still hold a wanted emitter, hand the rest to the newcomers
      const free = this.pool.filter((s) => !s.want || !ranked.includes(s.want));
      const taken = new Set(this.pool.map((s) => s.want).filter((w): w is Emitter => !!w && ranked.includes(w)));
      for (const e of ranked) {
        if (taken.has(e)) continue;
        const s = free.shift();
        if (s) s.want = e;
      }
      for (const s of free) s.want = null;
    }
    if (!anyOn) for (const s of this.pool) s.want = null;
    const step = Math.min(1, dt / 0.25);
    for (const s of this.pool) {
      if (s.emitter !== s.want) {
        s.fade = Math.max(0, s.fade - step);
        if (s.fade <= 0) { s.emitter = s.want; if (s.emitter) s.light.position.copy(s.emitter.pos); }
      } else if (s.emitter) s.fade = Math.min(1, s.fade + step);
      this.styleSlot(s);
    }
  }

  dispose(): void {
    for (const s of this.pool) { this.scene.remove(s.light); s.light.dispose(); }
    this.pool = [];
    this.emitters = [];
    this.driven = [];
    this.registered.clear();
  }
}
