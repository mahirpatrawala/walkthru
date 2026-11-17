// SPEC 16.24 "Mirrors reflect": at 2K a bathroom mirror, a vanity mirror or a gym's mirror wall shows the room, drawn again from the mirrored camera into a small render
// target. Only the nearest two mirrors that face the camera and are in view are drawn each frame (a mirror farther than 7 m, or behind the camera, shows the probe's
// reflection of the glass beneath instead), so the cost is two extra scene passes at most, and none when no mirror is in sight. The shell behind the mirror is clipped
// (the mirror's own plane), so nothing from the next room shows in it. All render targets, materials and geometries are freed with `dispose`.
import * as THREE from 'three';

export interface MirrorQuad { centre: THREE.Vector3; normal: THREE.Vector3; corners: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3] }

const UP = new THREE.Vector3(0, 1, 0);

/** the planar glass faces of a mesh named `kit:mirror` (many triangles of several mirrors, in world space): one quad per connected piece of glass */
export function mirrorQuadsOfKit(mesh: THREE.Mesh): MirrorQuad[] {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const idx = mesh.geometry.index;
  const nTri = (idx ? idx.count : pos.count) / 3;
  const v = (i: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
  const tris: THREE.Vector3[][] = [];
  for (let t = 0; t < nTri; t++) tris.push([v(t * 3), v(t * 3 + 1), v(t * 3 + 2)]);
  // union-find on shared corners (to a millimetre)
  const parent = tris.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const at = new Map<string, number>();
  const key = (p: THREE.Vector3): string => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)},${Math.round(p.z * 1000)}`;
  tris.forEach((tr, i) => { for (const p of tr) { const k = key(p); const j = at.get(k); if (j === undefined) at.set(k, i); else parent[find(i)] = find(j); } });
  const groups = new Map<number, THREE.Vector3[][]>();
  tris.forEach((tr, i) => { const r = find(i); const l = groups.get(r) ?? []; l.push(tr); groups.set(r, l); });
  const out: MirrorQuad[] = [];
  for (const g of groups.values()) {
    const n = new THREE.Vector3().crossVectors(g[0][1].clone().sub(g[0][0]), g[0][2].clone().sub(g[0][0])).normalize();
    if (n.lengthSq() < 0.5 || Math.abs(n.y) > 0.5 || !isFinite(n.x)) continue; // an upright mirror only
    out.push(quadOf(g.flat(), n));
  }
  return out;
}

/** the quad that bounds `pts` (all on one upright plane of normal n) */
export function quadOf(pts: THREE.Vector3[], n: THREE.Vector3): MirrorQuad {
  const right = new THREE.Vector3().crossVectors(UP, n).normalize();
  let u0 = Infinity, u1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { const u = p.dot(right); u0 = Math.min(u0, u); u1 = Math.max(u1, u); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const base = pts[0].clone().sub(right.clone().multiplyScalar(pts[0].dot(right))).sub(UP.clone().multiplyScalar(pts[0].y)); // the plane's offset along n
  const P = (u: number, y: number): THREE.Vector3 => base.clone().add(right.clone().multiplyScalar(u)).add(UP.clone().multiplyScalar(y));
  const corners: MirrorQuad['corners'] = [P(u0, y0), P(u1, y0), P(u1, y1), P(u0, y1)];
  return { centre: P((u0 + u1) / 2, (y0 + y1) / 2), normal: n.clone(), corners };
}

/** the front face of a thin box named `mirror-glass` (a vanity's mirror): its +z face in the mesh's own frame, to world */
export function mirrorQuadOfBox(mesh: THREE.Mesh): MirrorQuad | null {
  mesh.geometry.computeBoundingBox();
  const b = mesh.geometry.boundingBox;
  if (!b) return null;
  const m = mesh.matrixWorld;
  const c = (x: number, y: number): THREE.Vector3 => new THREE.Vector3(x, y, b.max.z).applyMatrix4(m);
  const n = new THREE.Vector3(0, 0, 1).transformDirection(m);
  if (Math.abs(n.y) > 0.5) return null;
  const q = quadOf([c(b.min.x, b.min.y), c(b.max.x, b.max.y), c(b.min.x, b.max.y), c(b.max.x, b.min.y)], n);
  return q;
}

const VERT = /* glsl */ `
uniform mat4 textureMatrix; varying vec4 vUv;
void main() { vUv = textureMatrix * vec4( position, 1.0 ); gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
`;
const FRAG = /* glsl */ `
uniform sampler2D tDiffuse; uniform vec3 uTint; varying vec4 vUv;
void main() {
  vec3 c = texture2DProj( tDiffuse, vUv ).rgb * uTint;
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Mirror { quad: MirrorQuad; mesh: THREE.Mesh; rt: THREE.WebGLRenderTarget; mat: THREE.ShaderMaterial; geo: THREE.BufferGeometry; matrix: THREE.Matrix4 }

export class Mirrors {
  private mirrors: Mirror[] = [];
  private readonly vcam = new THREE.PerspectiveCamera();
  private readonly frustum = new THREE.Frustum();
  private readonly pv = new THREE.Matrix4();
  private signature = '';
  /** drawn this frame, for the checks */
  active = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene, private readonly maxActive = 2, private readonly rtWidth = 768) {}

  get count(): number { return this.mirrors.length; }

  /** finds the mirrors in the scene and builds an overlay for each; cheap to call when nothing changed (the set of mirror meshes is compared first) */
  rescan(): void {
    const meshes: THREE.Mesh[] = [];
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.name === 'kit:mirror' || m.name === 'mirror-glass') && !m.userData.mirrorOverlay) meshes.push(m);
    });
    const sig = meshes.map((m) => `${m.uuid}:${m.geometry.uuid}`).join('|');
    if (sig === this.signature) return;
    this.signature = sig;
    this.clear();
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const quads = mesh.name === 'kit:mirror' ? mirrorQuadsOfKit(mesh) : [mirrorQuadOfBox(mesh)].filter((q): q is MirrorQuad => !!q);
      for (const q of quads) this.add(q);
    }
  }

  private add(q: MirrorQuad): void {
    const off = q.normal.clone().multiplyScalar(0.0012);
    const c = q.corners.map((p) => p.clone().add(off));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(c.flatMap((p) => [p.x, p.y, p.z]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const rt = new THREE.WebGLRenderTarget(this.rtWidth, Math.round(this.rtWidth * 0.5625), { type: THREE.HalfFloatType, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const matrix = new THREE.Matrix4();
    const mat = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: rt.texture }, textureMatrix: { value: matrix }, uTint: { value: new THREE.Color(0.93, 0.95, 0.96) } }, vertexShader: VERT, fragmentShader: FRAG, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'mirror-overlay';
    mesh.userData.mirrorOverlay = true; mesh.userData.noPremium = true;
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false; mesh.frustumCulled = false;
    mesh.raycast = () => { /* a mirror is never hit by a ray */ };
    this.scene.add(mesh);
    this.mirrors.push({ quad: q, mesh, rt, mat, geo, matrix });
  }

  /** once a frame before the main render: draw the nearest facing mirrors that are in view */
  update(camera: THREE.PerspectiveCamera, hide: THREE.Object3D[] = []): void {
    this.active = 0;
    if (this.mirrors.length === 0) return;
    camera.updateMatrixWorld();
    const cam = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const cand = this.mirrors
      .map((m) => ({ m, d: m.quad.centre.distanceTo(cam), facing: m.quad.normal.dot(cam.clone().sub(m.quad.centre)) }))
      .filter((c) => c.d < 7 && c.facing > 0.05 && this.inView(c.m))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.maxActive);
    for (const m of this.mirrors) m.mesh.visible = false;
    if (cand.length === 0) return;
    const overlays = this.mirrors.map((m) => m.mesh);
    const hidden = hide.filter((o) => o.visible);
    for (const o of hidden) o.visible = false;
    const { renderer, scene } = this;
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.shadowMap.autoUpdate, prevClip = renderer.clippingPlanes, prevXr = renderer.xr.enabled;
    renderer.shadowMap.autoUpdate = false; renderer.xr.enabled = false;
    for (const { m } of cand) {
      const q = m.quad;
      // the mirrored camera: position, up and look-at reflected in the mirror's plane
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(q.normal, q.centre);
      const fwd = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
      const up = new THREE.Vector3(0, 1, 0).transformDirection(camera.matrixWorld);
      const refl = (p: THREE.Vector3): THREE.Vector3 => p.clone().sub(q.normal.clone().multiplyScalar(2 * plane.distanceToPoint(p)));
      const vp = refl(cam), look = refl(cam.clone().add(fwd));
      const vcam = this.vcam;
      vcam.fov = camera.fov; vcam.aspect = camera.aspect; vcam.near = camera.near; vcam.far = camera.far;
      vcam.position.copy(vp);
      vcam.up.copy(up).sub(q.normal.clone().multiplyScalar(2 * up.dot(q.normal)));
      vcam.lookAt(look);
      vcam.updateProjectionMatrix(); vcam.updateMatrixWorld(); vcam.matrixWorldInverse.copy(vcam.matrixWorld).invert();
      m.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);
      if (m.rt.width !== this.rtWidth || m.rt.height !== Math.round(this.rtWidth / Math.max(0.5, camera.aspect))) m.rt.setSize(this.rtWidth, Math.max(2, Math.round(this.rtWidth / Math.max(0.5, camera.aspect))));
      for (const o of overlays) o.visible = false;
      // everything behind the glass is the next room: clipped
      renderer.clippingPlanes = [plane];
      renderer.setRenderTarget(m.rt);
      renderer.clear();
      renderer.render(scene, vcam);
    }
    renderer.clippingPlanes = prevClip;
    renderer.setRenderTarget(prevRT);
    renderer.shadowMap.autoUpdate = prevAuto; renderer.xr.enabled = prevXr;
    for (const o of hidden) o.visible = true;
    for (const { m } of cand) m.mesh.visible = true;
    this.active = cand.length;
  }

  private inView(m: Mirror): boolean {
    for (const c of m.quad.corners) if (this.frustum.containsPoint(c)) return true;
    return this.frustum.containsPoint(m.quad.centre);
  }

  private clear(): void {
    for (const m of this.mirrors) { m.mesh.removeFromParent(); m.rt.dispose(); m.mat.dispose(); m.geo.dispose(); }
    this.mirrors = [];
  }

  dispose(): void { this.clear(); this.signature = ''; }
}
