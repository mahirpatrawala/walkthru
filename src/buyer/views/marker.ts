// The walker's place in the doll house: a dot with a ring and a view cone lying on the floor, kept the same size on the screen however far the
// camera is. Flat and unlit; made when the doll house is entered and removed (geometry, material) when it is left.
import * as THREE from 'three';

export const MARKER_COLOUR = '#C0502E';
const CONE_HALF_DEG = 34;
const MARKER_Y = 0.03;
/** the dot's radius in marker units */
const R_DOT = 0.26;

export interface Marker {
  group: THREE.Group;
  /** `yawDeg` is the heading (forward = (sin, cos)); `scale` metres per unit of marker size (the camera distance, over a constant) */
  set(x: number, z: number, yawDeg: number, scale: number): void;
  setVisible(v: boolean): void;
  dispose(): void;
}

export function createMarker(scene: THREE.Scene): Marker {
  const group = new THREE.Group();
  group.name = 'dollhouse-marker';
  const disposables: Array<{ dispose(): void }> = [];

  // cone: an apex at the dot and an arc 1 unit away, strong at the apex and gone at the arc (vertex alpha)
  const steps = 14;
  const pos: number[] = [], col: number[] = [];
  const c = new THREE.Color(MARKER_COLOUR);
  const push = (x: number, z: number, a: number): void => { pos.push(x, 0, z); col.push(c.r, c.g, c.b, a); };
  for (let k = 0; k < steps; k++) {
    const a0 = ((-CONE_HALF_DEG + (2 * CONE_HALF_DEG * k) / steps) * Math.PI) / 180;
    const a1 = ((-CONE_HALF_DEG + (2 * CONE_HALF_DEG * (k + 1)) / steps) * Math.PI) / 180;
    // forward is +z at yaw 0; counter-clockwise seen from above so the face looks up
    push(0, 0, 0.62); push(Math.sin(a1), Math.cos(a1), 0); push(Math.sin(a0), Math.cos(a0), 0);
  }
  const coneGeo = new THREE.BufferGeometry();
  coneGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  coneGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  // on the floor: the cone, a soft contact shadow, the white ring and the dot are depth tested, so they lie on the floor and a wall in front hides them;
  // a faint copy of the ring and the dot is drawn over everything, so the walker is still found in a room the near walls hide
  const flat = (extra: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, ...extra });
  const coneMat = flat({ vertexColors: true, transparent: true, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.name = 'dollhouse-marker-cone';
  cone.renderOrder = 20;
  cone.raycast = () => {};
  const rig = new THREE.Group();
  rig.add(cone);

  const shadowGeo = new THREE.CircleGeometry(0.62, 40);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = flat({ color: '#000000', transparent: true, opacity: 0.22 });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.position.y = -0.004;
  shadow.renderOrder = 19;
  shadow.raycast = () => {};
  const ringGeo = new THREE.RingGeometry(R_DOT, R_DOT + 0.12, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = flat({ color: '#ffffff' });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.002;
  ring.renderOrder = 21;
  ring.raycast = () => {};
  const dotGeo = new THREE.CircleGeometry(R_DOT, 32);
  dotGeo.rotateX(-Math.PI / 2);
  const dotMat = flat({ color: MARKER_COLOUR });
  const dot = new THREE.Mesh(dotGeo, dotMat);
  dot.position.y = 0.004;
  dot.renderOrder = 22;
  dot.raycast = () => {};
  const ghostMat = flat({ color: MARKER_COLOUR, transparent: true, opacity: 0.4, depthTest: false });
  const ghost = new THREE.Mesh(dotGeo, ghostMat);
  ghost.position.y = 0.006;
  ghost.renderOrder = 1030;
  ghost.raycast = () => {};
  const ghostRingMat = flat({ color: '#ffffff', transparent: true, opacity: 0.4, depthTest: false });
  const ghostRing = new THREE.Mesh(ringGeo, ghostRingMat);
  ghostRing.position.y = 0.005;
  ghostRing.renderOrder = 1029;
  ghostRing.raycast = () => {};
  rig.add(shadow, ring, dot, ghostRing, ghost);
  group.add(rig);
  group.position.y = MARKER_Y;
  disposables.push(coneGeo, coneMat, ringGeo, ringMat, dotGeo, dotMat, shadowGeo, shadowMat, ghostMat, ghostRingMat);
  scene.add(group);

  return {
    group,
    set(x, z, yawDeg, scale) {
      group.position.x = x;
      group.position.z = z;
      rig.rotation.y = (yawDeg * Math.PI) / 180;
      // the cone's length and the dot's size scale together; the cone is 1.9 marker units long
      rig.scale.set(scale, 1, scale);
      cone.scale.set(1.9, 1, 1.9);
    },
    setVisible(v) { group.visible = v; },
    dispose() {
      scene.remove(group);
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}
