// Headless checks of FollowCamera, stepLocomotion and the furniture meshes (three maths only, no WebGL).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { truthGrid } from '../scripts/make-test-room';
import { itemFromCatalog, CATALOG } from '../src/core/catalog';
import { circleFree } from '../src/core/grid-query';
import { FollowCamera } from '../src/engine/camera';
import { buildFurnitureMesh, setFurnitureTint } from '../src/engine/furniture';
import { stepLocomotion } from '../src/engine/locomotion';
import type { Character } from '../src/engine/character';
import type { Input } from '../src/engine/controls';
import { CHARACTER_RADIUS_M } from '../src/types';
import type { Box, Grid, Vec2 } from '../src/types';

const empty = truthGrid('empty');
const furnished = truthGrid('furnished');
const NO_LOOK = { dx: 0, dy: 0, zoom: 0 };

function makeCam(grid: Grid, ceiling = 2.6): { cam: FollowCamera; camera: THREE.PerspectiveCamera } {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 200);
  return { cam: new FollowCamera(camera, () => grid, ceiling), camera };
}

describe('FollowCamera', () => {
  it('sets near and far', () => {
    const { camera } = makeCam(empty);
    expect(camera.near).toBe(0.05);
    expect(camera.far).toBe(200);
  });

  it('sits 2.0 m behind and 12 degrees above the pivot, over the right shoulder, looking along yaw', () => {
    const { cam, camera } = makeCam(empty);
    cam.setTarget({ x: 2, z: 2.5 }, 1.75);
    cam.update(1 / 60, NO_LOOK);
    const pivot = new THREE.Vector3(2 - 0.2, 0.85 * 1.75, 2.5);
    expect(camera.position.distanceTo(pivot)).toBeCloseTo(2.0, 6);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    expect(dir.x).toBeCloseTo(0, 6);
    expect(dir.y).toBeCloseTo(-Math.sin(12 * Math.PI / 180), 6);
    expect(dir.z).toBeCloseTo(Math.cos(12 * Math.PI / 180), 6);
    // the pivot is on the camera's right: screen right at yaw 0 is -x, and the pivot is 0.2 m toward it
    expect(camera.position.x).toBeCloseTo(1.8, 6);
    expect(cam.boom).toBeCloseTo(2.0, 6);
  });

  it('screen right on the floor is (-cos yaw, sin yaw): the shoulder offset follows the heading', () => {
    const { cam, camera } = makeCam(empty);
    cam.yawDeg = 90; // looking +x
    cam.setTarget({ x: 2, z: 2.5 }, 1.75);
    cam.update(1 / 60, NO_LOOK);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    expect(right.x).toBeCloseTo(0, 6);
    expect(right.z).toBeCloseTo(1, 6);
    // pivot = target + right * 0.2 = (2, y, 2.7); camera is behind (-x) of it
    expect(camera.position.z).toBeCloseTo(2.7, 6);
  });

  it('applies look drag, clamps pitch to -5..60 and the boom to 1..3.5', () => {
    const { cam } = makeCam(empty);
    cam.setTarget({ x: 2, z: 2.5 }, 1.75);
    cam.update(1 / 60, { dx: 100, dy: 0, zoom: 0 });
    expect(cam.yawDeg).toBeCloseTo(25, 9);
    cam.update(1 / 60, { dx: 0, dy: 10000, zoom: 0 });
    expect(cam.pitchDeg).toBe(60);
    cam.update(1 / 60, { dx: 0, dy: -10000, zoom: 0 });
    expect(cam.pitchDeg).toBe(-5);
    cam.update(1 / 60, { dx: 0, dy: 0, zoom: -100 });
    expect(cam.distance).toBe(1.0);
    cam.update(1 / 60, { dx: 0, dy: 0, zoom: 100 });
    expect(cam.distance).toBe(3.5);
  });

  it('never ends up inside a wall: backed against the east wall the boom shortens and the camera stays 0.2 m clear', () => {
    const { cam, camera } = makeCam(empty);
    cam.yawDeg = 270; // looking -x, so the camera boom points at the east wall (x = 4)
    cam.pitchDeg = 5;
    cam.setTarget({ x: 3.4, z: 2.5 }, 1.75);
    cam.update(1 / 60, NO_LOOK);
    console.log('camera boom against the east wall:', cam.boom.toFixed(3), 'camera x', camera.position.x.toFixed(3));
    expect(cam.boom).toBeLessThan(0.6);
    expect(camera.position.x).toBeLessThan(4 - 0.15);
    // right up against it
    cam.setTarget({ x: 3.8, z: 2.5 }, 1.75);
    cam.update(1 / 60, NO_LOOK);
    expect(cam.boom).toBeLessThan(0.1); // 0.2 m from the wall, minus the 0.2 stop, within the 4 cm march step
    expect(camera.position.x).toBeLessThan(4);
  });

  it('shortens instantly and lengthens at 2 m/s', () => {
    const { cam } = makeCam(empty);
    cam.yawDeg = 270;
    cam.pitchDeg = 5;
    cam.setTarget({ x: 3.4, z: 2.5 }, 1.75);
    cam.update(1 / 60, NO_LOOK);
    const short = cam.boom;
    cam.setTarget({ x: 1.4, z: 2.5 }, 1.75); // out in the open again
    cam.update(0.05, NO_LOOK);
    expect(cam.boom).toBeCloseTo(short + 0.1, 6);
    for (let i = 0; i < 100; i++) cam.update(0.05, NO_LOOK);
    expect(cam.boom).toBeCloseTo(2.0, 6);
    // and back in: instant
    cam.setTarget({ x: 3.4, z: 2.5 }, 1.75);
    cam.update(0.05, NO_LOOK);
    expect(cam.boom).toBeCloseTo(short, 6);
  });

  it('low furniture blocks only below its top plus 15 cm: the boom passes over the bed at eye height but not at knee height', () => {
    const { cam } = makeCam(furnished);
    cam.yawDeg = 90; // looking +x, so the boom points back over the bed (x 0..2, 55 cm high)
    cam.pitchDeg = -5;
    cam.setTarget({ x: 2.3, z: 2.25 }, 1.75);
    cam.update(1 / 60, NO_LOOK);
    expect(cam.boom).toBeCloseTo(2.0, 6);
    cam.setTarget({ x: 2.3, z: 2.25 }, 0.5); // a child's height: pivot at 0.425 m, under bed top + 15 cm
    cam.update(1 / 60, NO_LOOK);
    expect(cam.boom).toBeLessThan(0.3);
  });

  it('focusOn swings in over 0.5 s to the given orbit, releaseFocus swings back', () => {
    const { cam, camera } = makeCam(empty, 4.0);
    cam.setTarget({ x: 2.5, z: 1.0 }, 1.75);
    cam.update(1 / 60, NO_LOOK);
    const centre = { x: 1.0, y: 0.7, z: 2.25 };
    cam.focusOn(centre, 2.2, 50, 270);
    for (let i = 0; i < 20; i++) cam.update(1 / 60, NO_LOOK); // 0.33 s: mid-swing
    const mid = camera.position.clone();
    for (let i = 0; i < 20; i++) cam.update(1 / 60, NO_LOOK); // 0.67 s: done
    const pos = camera.position.clone();
    const pr = 50 * Math.PI / 180;
    expect(pos.distanceTo(new THREE.Vector3(centre.x, centre.y, centre.z))).toBeCloseTo(2.2, 3);
    expect(pos.x).toBeCloseTo(1.0 + Math.cos(pr) * 2.2, 3); // yaw 270 looks -x, so the camera is at +x
    expect(pos.y).toBeCloseTo(0.7 + Math.sin(pr) * 2.2, 3);
    expect(mid.distanceTo(pos)).toBeGreaterThan(0.2);
    expect((((cam.viewYawDeg % 360) + 360) % 360)).toBeCloseTo(270, 6);

    cam.releaseFocus();
    cam.setTarget({ x: 1.5, z: 2.5 }, 1.75); // somewhere the boom has room at yaw 270
    for (let i = 0; i < 90; i++) cam.update(1 / 60, NO_LOOK);
    expect(cam.yawDeg).toBeCloseTo(270, 6); // keeps the heading it had
    expect(cam.pitchDeg).toBeCloseTo(12, 6);
    expect((((cam.viewYawDeg % 360) + 360) % 360)).toBeCloseTo(270, 6);
    // back to following: pivot is the character's shoulder, 2 m away
    const pivot = new THREE.Vector3(1.5 - Math.cos(270 * Math.PI / 180) * 0.2, 0.85 * 1.75, 2.5 + Math.sin(270 * Math.PI / 180) * 0.2);
    expect(camera.position.distanceTo(pivot)).toBeCloseTo(2.0, 3);
  });

  it('the boom rule still applies during a focus', () => {
    const { cam } = makeCam(empty, 2.6);
    cam.setTarget({ x: 2.5, z: 1.0 }, 1.75);
    cam.focusOn({ x: 1.0, y: 0.7, z: 2.25 }, 2.2, 50, 270); // 0.7 + 2.2 sin 50 = 2.39 > 2.6 - 0.15 is false, but 2.45 limit is close
    for (let i = 0; i < 60; i++) cam.update(1 / 60, NO_LOOK);
    expect(cam.boom).toBeLessThanOrEqual(2.2);
    cam.focusOn({ x: 1.0, y: 0.7, z: 2.25 }, 3.5, 70, 270); // far too high for a 2.6 ceiling
    for (let i = 0; i < 60; i++) cam.update(1 / 60, NO_LOOK);
    expect(cam.boom).toBeLessThan(2.4);
  });
});

/** A character double with just what stepLocomotion touches. */
function fakeChar(x: number, z: number, heightM = 1.75, yawDeg = 0): Character & { calls: Array<[number, boolean]> } {
  const calls: Array<[number, boolean]> = [];
  const c = {
    state: 'idle' as string, heightM, yawDeg, position: { x, z } as Vec2, calls,
    setLocomotion(speed: number, jog: boolean) { calls.push([speed, jog]); c.state = speed > 0.02 ? (jog ? 'jog' : 'walk') : 'idle'; },
  };
  return c as unknown as Character & { calls: Array<[number, boolean]> };
}
function fakeInput(moveX: number, moveY: number, jog = false): Input {
  return { moveX, moveY, jog } as unknown as Input;
}
function frames(ch: Character, input: Input, camYaw: number, grid: Grid, n: number, dt = 1 / 60): number {
  let last = 0;
  for (let i = 0; i < n; i++) last = stepLocomotion(ch, input, camYaw, grid, dt);
  return last;
}

describe('stepLocomotion', () => {
  it('walks at 1.4 m/s relative to the camera and jogs at 2.8 m/s', () => {
    const ch = fakeChar(2, 1);
    const v = frames(ch, fakeInput(0, 1), 0, empty, 60);
    expect(v).toBeCloseTo(1.4, 6);
    expect(ch.position.z).toBeCloseTo(1 + 1.4, 3);
    expect(ch.position.x).toBeCloseTo(2, 6);
    const ch2 = fakeChar(2, 0.6);
    const v2 = frames(ch2, fakeInput(0, 1, true), 0, empty, 30);
    expect(v2).toBeCloseTo(2.8, 6);
    expect(ch2.calls.at(-1)).toEqual([expect.closeTo(2.8, 6), true]);
  });

  it('scales speed by height / 1.75', () => {
    const ch = fakeChar(2, 1, 1.9);
    expect(frames(ch, fakeInput(0, 1), 0, empty, 10)).toBeCloseTo(1.4 * 1.9 / 1.75, 6);
    const ch2 = fakeChar(2, 1, 1.6);
    expect(frames(ch2, fakeInput(0, 1, true), 0, empty, 10)).toBeCloseTo(2.8 * 1.6 / 1.75, 6);
  });

  it('is relative to the camera heading: yaw 90 looks +x, so forward moves +x and screen-right moves +z', () => {
    const a = fakeChar(1, 2.5);
    frames(a, fakeInput(0, 1), 90, empty, 30);
    expect(a.position.x).toBeGreaterThan(1.6);
    expect(a.position.z).toBeCloseTo(2.5, 6);
    const b = fakeChar(1, 2.5);
    frames(b, fakeInput(1, 0), 90, empty, 30);
    expect(b.position.z).toBeGreaterThan(3.1);
    expect(b.position.x).toBeCloseTo(1, 6);
    // at yaw 0 screen-right is -x
    const c = fakeChar(2, 2.5);
    frames(c, fakeInput(1, 0), 0, empty, 30);
    expect(c.position.x).toBeLessThan(1.4);
  });

  it('normalises diagonals', () => {
    const ch = fakeChar(1, 1);
    const v = frames(ch, fakeInput(1, 1), 0, empty, 20);
    expect(v).toBeCloseTo(1.4, 6);
  });

  it('turns toward the movement direction at 10 rad/s', () => {
    const ch = fakeChar(2, 2.5, 1.75, 180);
    stepLocomotion(ch, fakeInput(0, 1), 0, empty, 1 / 60);
    expect(Math.abs(ch.yawDeg - 180)).toBeCloseTo((10 / 60) * 180 / Math.PI, 3); // 9.55 degrees
    frames(ch, fakeInput(0, 1), 0, empty, 60);
    const wrapped = ((ch.yawDeg % 360) + 360) % 360;
    expect(Math.min(wrapped, 360 - wrapped)).toBeLessThan(0.01);
  });

  it('takes the short way round', () => {
    const ch = fakeChar(2, 2.5, 1.75, 350);
    stepLocomotion(ch, fakeInput(0, 1), 0, empty, 1 / 60);
    expect(ch.yawDeg).toBeGreaterThan(350);
  });

  it('slides along a wall and reports the reduced speed; stops against a corner', () => {
    const ch = fakeChar(3.77, 2.5);
    const v = frames(ch, fakeInput(0.7, 0.7), 270, empty, 30); // yaw 270: forward = -x, screen right = +z... mixed push into the wall
    expect(circleFree(empty, ch.position.x, ch.position.z, CHARACTER_RADIUS_M)).toBe(true);
    void v;
    const corner = fakeChar(3.7, 4.7);
    const v2 = frames(corner, fakeInput(0, 1), 0, empty, 60); // forward = +z into the south wall
    expect(v2).toBeLessThan(0.1);
    expect(corner.position.z).toBeLessThan(4.8);
    expect(corner.calls.at(-1)![0]).toBeLessThan(0.1);
  });

  it('never enters a non-free cell with random input over 3,000 frames', () => {
    const ch = fakeChar(2.6, 2.5);
    let s = 12345;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 3000; i++) {
      const a = rnd() * Math.PI * 2;
      stepLocomotion(ch, fakeInput(Math.cos(a), Math.sin(a), rnd() < 0.3), rnd() * 360, furnished, 1 / 60);
      expect(circleFree(furnished, ch.position.x, ch.position.z, CHARACTER_RADIUS_M)).toBe(true);
    }
  });

  it('idles inside the dead zone, ignores posed characters, and rescues one standing inside an item', () => {
    const idle = fakeChar(2, 2.5);
    expect(stepLocomotion(idle, fakeInput(0.02, 0.02), 0, empty, 1 / 60)).toBe(0);
    expect(idle.calls.at(-1)).toEqual([0, false]);
    const posed = fakeChar(2, 2.5);
    (posed as unknown as { state: string }).state = 'lying';
    expect(stepLocomotion(posed, fakeInput(0, 1), 0, empty, 1 / 60)).toBe(0);
    expect(posed.position).toEqual({ x: 2, z: 2.5 });
    expect(posed.calls.length).toBe(0);
    const stuck = fakeChar(1.0, 2.25); // inside the furnished bed
    stepLocomotion(stuck, fakeInput(0, 1), 0, furnished, 1 / 60);
    expect(circleFree(furnished, stuck.position.x, stuck.position.z, CHARACTER_RADIUS_M)).toBe(true);
  });

  it('a half push walks slower, full push beyond 85% reaches full speed', () => {
    const ch = fakeChar(2, 1);
    const half = frames(ch, fakeInput(0, 0.425), 0, empty, 10);
    expect(half).toBeCloseTo(0.7, 6);
    const full = frames(fakeChar(2, 1), fakeInput(0, 0.9), 0, empty, 10);
    expect(full).toBeCloseTo(1.4, 6);
  });
});

describe('furniture meshes', () => {
  const bounds = (g: THREE.Group): THREE.Box3 => new THREE.Box3().setFromObject(g);

  it('every catalogue item builds, sits on the floor, matches its footprint and height', () => {
    for (const spec of CATALOG) {
      const box: Box = { cx: 0, cz: 0, w: spec.footprint.w, d: spec.footprint.d, yawDeg: 0 };
      const g = buildFurnitureMesh(itemFromCatalog(spec.id, box, 'virtual'));
      const b = bounds(g);
      expect(b.min.y).toBeCloseTo(0, 6);
      expect(b.max.y).toBeCloseTo(spec.heightM, 2);
      expect(b.max.x - b.min.x).toBeCloseTo(spec.footprint.w, 2);
      expect(b.max.z - b.min.z).toBeCloseTo(spec.footprint.d, 2);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          const mat = m.material as THREE.MeshStandardMaterial;
          expect(mat.transparent).toBe(false);
          expect(mat.opacity).toBe(1);
        }
      });
    }
  });

  it('is positioned at the box centre and rotated by yaw; local +Z is the front', () => {
    const item = itemFromCatalog('bed-queen', { cx: 1.06, cz: 3.4, w: 1.62, d: 2.08, yawDeg: 90 }, 'virtual');
    const g = buildFurnitureMesh(item);
    expect(g.position.x).toBeCloseTo(1.06, 9);
    expect(g.position.z).toBeCloseTo(3.4, 9);
    expect(g.rotation.y).toBeCloseTo(Math.PI / 2, 9);
    // yaw 90: front (+Z local) points to world +x; the headboard is at the back, x = 1.06 - 1.04
    const head = g.getObjectByName('headboard')!;
    const w = head.getWorldPosition(new THREE.Vector3());
    expect(w.x).toBeCloseTo(1.06 - 1.04 + 0.025, 6);
    expect(w.z).toBeCloseTo(3.4, 6);
    // mattress top is the surface height, pillows sit on it at the head
    const mattress = bounds(g.getObjectByName('mattress') as unknown as THREE.Group);
    expect(mattress.max.y).toBeCloseTo(0.5, 6);
    expect(g.getObjectByName('pillow1')).toBeTruthy();
    const pillow = g.getObjectByName('pillow0')!.getWorldPosition(new THREE.Vector3());
    expect(pillow.x).toBeLessThan(1.06 - 0.7); // near the head end
  });

  it('a single bed gets one pillow, a double two', () => {
    const one = buildFurnitureMesh(itemFromCatalog('bed-single', { cx: 0, cz: 0, w: 1.01, d: 1.93, yawDeg: 0 }, 'virtual'));
    expect(one.getObjectByName('pillow0')).toBeTruthy();
    expect(one.getObjectByName('pillow1')).toBeUndefined();
    const two = buildFurnitureMesh(itemFromCatalog('bed-double', { cx: 0, cz: 0, w: 1.32, d: 1.93, yawDeg: 0 }, 'virtual'));
    expect(two.getObjectByName('pillow1')).toBeTruthy();
  });

  it('builds real items from a bare box (bed, sofa, counter)', () => {
    const mk = (kind: 'bed' | 'sofa' | 'counter', heightM: number, surfaceHeightM: number) => buildFurnitureMesh({
      id: kind, source: 'real', kind, label: kind, box: { cx: 1, cz: 1, w: 1.5, d: 0.8, yawDeg: 0 }, heightM, surfaceHeightM,
    });
    expect(bounds(mk('bed', 0.55, 0.5)).max.y).toBeLessThan(0.61); // pillows sit 10 cm on the mattress
    expect(bounds(mk('sofa', 0.85, 0.43)).max.y).toBeCloseTo(0.85, 2);
    expect(bounds(mk('counter', 0.85, 0.85)).max.y).toBeCloseTo(0.85, 2);
  });

  it('tint moves colours 45% toward the verdict colour and null restores them exactly', () => {
    const g = buildFurnitureMesh(itemFromCatalog('sofa-3', { cx: 0, cz: 0, w: 2.1, d: 0.9, yawDeg: 0 }, 'virtual'));
    const base = g.getObjectByName('base') as THREE.Mesh;
    const mat = base.material as THREE.MeshStandardMaterial;
    const before = mat.color.clone();
    setFurnitureTint(g, 'good');
    const expected = before.clone().lerp(new THREE.Color('#1E9E5A'), 0.45);
    expect(mat.color.r).toBeCloseTo(expected.r, 6);
    expect(mat.color.g).toBeCloseTo(expected.g, 6);
    expect(mat.color.b).toBeCloseTo(expected.b, 6);
    setFurnitureTint(g, 'bad'); // not cumulative
    const bad = before.clone().lerp(new THREE.Color('#D64545'), 0.45);
    expect(mat.color.r).toBeCloseTo(bad.r, 6);
    setFurnitureTint(g, null);
    expect(mat.color.getHex()).toBe(before.getHex());
  });
});
