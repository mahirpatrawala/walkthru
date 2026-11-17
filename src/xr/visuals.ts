// What the viewer sees of the page's own machinery, apart from the home: the two controller bodies, the teleport arc and its landing ring, the pointer
// line, the door marker with its words, the fade, the toast and the debug readout. Everything hangs from `root`, which lives as long as the page does and
// is moved from one home's scene to the next; `dispose()` gives back every geometry, material and texture.
import * as THREE from 'three';
import { CanvasMesh, CARD, FONT, OCHRE, roundRect } from './canvas-mesh';
import type { V3 } from './teleport';

const OK = 0x3fbf7f;
const BAD = 0xd64545;
const NEUTRAL = 0xfffdf8;
const ARC_DOTS = 56;

export class Visuals {
  readonly root = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly labels: CanvasMesh[] = [];
  private readonly arc: THREE.InstancedMesh;
  private readonly arcMat: THREE.MeshBasicMaterial;
  private readonly reticle = new THREE.Group();
  private readonly reticleMat: THREE.MeshBasicMaterial;
  private readonly marker: THREE.Mesh;
  private readonly doorLabel: CanvasMesh;
  private doorText = '';
  private readonly fadeMesh: THREE.Mesh;
  private readonly fadeMat: THREE.MeshBasicMaterial;
  private readonly toastMesh: CanvasMesh;
  private toastLeft = 0;
  private readonly loadingMesh: CanvasMesh;
  private loadingText = '';
  readonly debug: CanvasMesh;
  private readonly lines = new Map<THREE.Object3D, THREE.Line>();
  private readonly bodies: THREE.Mesh[] = [];
  private readonly dummy = new THREE.Object3D();

  constructor(camera: THREE.Camera) {
    this.root.name = 'xr-root';
    this.root.add(camera);
    const g = <T extends THREE.BufferGeometry>(x: T): T => { this.geos.push(x); return x; };
    const m = <T extends THREE.Material>(x: T): T => { this.mats.push(x); return x; };

    // the teleport arc: dots, so it reads at any distance in a headset (a WebGL line is one pixel wide)
    this.arcMat = m(new THREE.MeshBasicMaterial({ color: NEUTRAL, toneMapped: false, transparent: true, opacity: 0.95 }));
    this.arc = new THREE.InstancedMesh(g(new THREE.SphereGeometry(1, 8, 6)), this.arcMat, ARC_DOTS);
    this.arc.frustumCulled = false;
    this.arc.count = 0;
    this.arc.renderOrder = 910;
    this.root.add(this.arc);

    // the landing ring on the floor
    this.reticleMat = m(new THREE.MeshBasicMaterial({ color: OK, toneMapped: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    const ring = new THREE.Mesh(g(new THREE.RingGeometry(0.17, 0.23, 32)), this.reticleMat);
    const disc = new THREE.Mesh(g(new THREE.CircleGeometry(0.17, 32)), m(new THREE.MeshBasicMaterial({ color: OK, toneMapped: false, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })));
    ring.rotation.x = disc.rotation.x = -Math.PI / 2;
    this.reticle.add(ring, disc);
    this.reticle.renderOrder = 910;
    this.reticle.visible = false;
    this.root.add(this.reticle);
    this.reticleDisc = disc.material as THREE.MeshBasicMaterial;

    // the door marker and its words
    this.marker = new THREE.Mesh(g(new THREE.SphereGeometry(0.03, 12, 8)), m(new THREE.MeshBasicMaterial({ color: OCHRE, toneMapped: false, depthTest: false, transparent: true })));
    this.marker.renderOrder = 930;
    this.marker.visible = false;
    this.root.add(this.marker);
    this.doorLabel = this.label(0.4, 0.1, 400, 100, 935);
    this.doorLabel.mesh.visible = false;
    this.root.add(this.doorLabel.mesh);

    // the fade: a dark sphere round the head, drawn over everything
    this.fadeMat = m(new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
    this.fadeMesh = new THREE.Mesh(g(new THREE.SphereGeometry(0.6, 16, 10)), this.fadeMat);
    this.fadeMesh.renderOrder = 1000;
    this.fadeMesh.frustumCulled = false;
    this.fadeMesh.visible = false;
    camera.add(this.fadeMesh);

    // "Loading ..." on top of the black while a home is swapped
    this.loadingMesh = this.label(0.9, 0.12, 900, 120, 1001);
    this.loadingMesh.mesh.position.set(0, 0, -0.5);
    this.loadingMesh.mesh.visible = false;
    camera.add(this.loadingMesh.mesh);

    // a toast: a line of words a little below where the viewer is looking, where it was said
    this.toastMesh = this.label(1.0, 0.12, 1000, 120, 940);
    this.toastMesh.mesh.visible = false;
    this.root.add(this.toastMesh.mesh);

    // the debug readout, small, at the lower left of the view
    this.debug = this.label(0.5, 0.26, 640, 333, 945);
    this.debug.mesh.position.set(-0.27, -0.24, -0.75);
    this.debug.mesh.visible = false;
    camera.add(this.debug.mesh);
  }

  private readonly reticleDisc: THREE.MeshBasicMaterial;

  private label(w: number, h: number, pw: number, ph: number, order: number): CanvasMesh {
    const c = new CanvasMesh(w, h, pw, ph, { renderOrder: order, depthTest: false });
    this.labels.push(c);
    return c;
  }

  /** Gives each pointer object a small body and a pointer line (the line is hidden until something is aimed at). */
  dress(objects: THREE.Object3D[]): void {
    for (const o of objects) {
      if (this.lines.has(o)) continue;
      const geo = new THREE.BoxGeometry(0.035, 0.035, 0.11);
      const mat = new THREE.MeshBasicMaterial({ color: 0x4a4039, toneMapped: false });
      const body = new THREE.Mesh(geo, mat);
      body.position.z = 0.05;
      o.add(body);
      this.bodies.push(body);
      this.geos.push(geo); this.mats.push(mat);
      const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
      const lm = new THREE.LineBasicMaterial({ color: NEUTRAL, toneMapped: false, transparent: true, opacity: 0.85 });
      const line = new THREE.Line(lg, lm);
      line.frustumCulled = false;
      line.visible = false;
      o.add(line);
      this.lines.set(o, line);
      this.geos.push(lg); this.mats.push(lm);
    }
  }

  /** The pointer line of one hand: `lengthM` long along the hand's -z, or hidden. */
  setLine(obj: THREE.Object3D, lengthM: number | null, colour: number = NEUTRAL): void {
    const line = this.lines.get(obj);
    if (!line) return;
    line.visible = lengthM !== null;
    if (lengthM !== null) { line.scale.set(1, 1, Math.max(0.05, lengthM)); (line.material as THREE.LineBasicMaterial).color.setHex(colour); }
  }

  /** The arc through `points` (home coordinates), and the landing ring when it ended on the floor. */
  setArc(points: V3[] | null, landing: { point: V3; ok: boolean } | null): void {
    if (!points || points.length < 2) { this.arc.count = 0; this.reticle.visible = false; return; }
    const ok = landing ? landing.ok : true;
    const colour = landing ? (ok ? OK : BAD) : NEUTRAL;
    this.arcMat.color.setHex(colour);
    const n = Math.min(points.length, ARC_DOTS);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      // dots grow a little with distance so they stay legible
      const s = 0.011 + 0.0035 * (i / n);
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.arc.setMatrixAt(i, this.dummy.matrix);
    }
    this.arc.count = n;
    this.arc.instanceMatrix.needsUpdate = true;
    if (landing) {
      this.reticle.position.set(landing.point.x, 0.012, landing.point.z);
      this.reticleMat.color.setHex(colour);
      this.reticleDisc.color.setHex(colour);
      this.reticle.visible = true;
    } else this.reticle.visible = false;
  }

  /** The marker and words over a door the pointer is on, turned toward the head. `null` hides them. */
  setDoor(at: V3 | null, text: string, head: V3 | null): void {
    if (!at) { this.marker.visible = false; this.doorLabel.mesh.visible = false; return; }
    this.marker.position.set(at.x, at.y, at.z);
    this.marker.visible = true;
    if (text !== this.doorText) {
      this.doorText = text;
      this.doorLabel.draw((ctx, w, h) => {
        ctx.fillStyle = 'rgba(31, 24, 20, 0.92)'; roundRect(ctx, 0, 0, w, h, 30); ctx.fill();
        ctx.fillStyle = CARD; ctx.font = `700 46px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, w / 2, h / 2 + 2);
      });
    }
    this.doorLabel.mesh.position.set(at.x, at.y + 0.13, at.z);
    if (head) this.doorLabel.mesh.rotation.set(0, Math.atan2(head.x - at.x, head.z - at.z), 0);
    this.doorLabel.mesh.visible = true;
  }

  setFade(alpha: number): void {
    this.fadeMat.opacity = alpha;
    this.fadeMesh.visible = alpha > 0.001;
  }

  /** The words on the black while a home loads; null hides them. */
  setLoading(text: string | null): void {
    if (text === null) { this.loadingMesh.mesh.visible = false; this.loadingText = ''; return; }
    if (text !== this.loadingText) {
      this.loadingText = text;
      this.loadingMesh.draw((ctx, w, h) => {
        ctx.fillStyle = CARD; ctx.font = `700 52px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, w / 2, h / 2);
      });
    }
    this.loadingMesh.mesh.visible = true;
  }

  /** Says something for a few seconds, a metre ahead of the head along its heading, a little below the eyes. */
  toast(text: string, head: V3, forward: V3, seconds = 3): void {
    const l = Math.hypot(forward.x, forward.z) || 1;
    this.toastMesh.draw((ctx, w, h) => {
      ctx.fillStyle = 'rgba(31, 24, 20, 0.92)'; roundRect(ctx, 0, 0, w, h, 34); ctx.fill();
      ctx.fillStyle = CARD; ctx.font = `600 38px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let t = text;
      while (t.length > 3 && ctx.measureText(t).width > w - 60) t = t.slice(0, -2);
      ctx.fillText(t === text ? t : `${t}…`, w / 2, h / 2 + 2);
    });
    this.toastMesh.setOpacity(1);
    this.toastMesh.mesh.position.set(head.x + (forward.x / l) * 1.0, head.y - 0.38, head.z + (forward.z / l) * 1.0);
    this.toastMesh.mesh.rotation.set(0, Math.atan2(head.x - this.toastMesh.mesh.position.x, head.z - this.toastMesh.mesh.position.z), 0);
    this.toastMesh.mesh.visible = true;
    this.toastLeft = seconds;
  }

  update(dt: number): void {
    if (this.toastLeft > 0) {
      this.toastLeft -= dt;
      if (this.toastLeft <= 0) this.toastMesh.mesh.visible = false;
      else this.toastMesh.setOpacity(Math.min(1, this.toastLeft / 0.6));
    }
  }

  /** Everything that belongs to a session goes out of sight (the session ended). */
  rest(): void {
    this.setArc(null, null);
    this.setDoor(null, '', null);
    this.setFade(0);
    this.setLoading(null);
    this.toastMesh.mesh.visible = false;
    this.toastLeft = 0;
    for (const l of this.lines.values()) l.visible = false;
    this.debug.mesh.visible = false;
  }

  /** The controller bodies and lines are only for a session. */
  setPointersVisible(v: boolean): void {
    for (const b of this.bodies) b.visible = v;
  }

  dispose(): void {
    for (const l of this.labels) l.dispose();
    this.arc.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const [o, line] of this.lines) o.remove(line);
    for (const b of this.bodies) b.removeFromParent();
    this.fadeMesh.removeFromParent();
    this.root.removeFromParent();
  }
}
